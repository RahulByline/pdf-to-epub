import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

/**
 * Get pdfjs-dist library configured for Node.js
 */
async function getPdfjsLib() {
  // Import pdfjs-dist legacy build (works better in Node.js)
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  // For Node.js, we don't need to set workerSrc - it will work without it
  // The worker is only needed for browser environments
  // Just return the library as-is
  
  return pdfjsLib;
}

/**
 * Service for extracting text and images from PDF files
 * Replicates epub_app approach: extracts text with coordinates and renders pages as images
 */
export class PdfExtractionService {
  /**
   * Extract text content from PDF with coordinates (like epub_app)
   * @param {string} pdfFilePath - Path to the PDF file
   * @returns {Promise<Object>} Object with pages array containing text blocks with coordinates
   */
  static async extractText(pdfFilePath) {
    try {
      const pdfjsLib = await getPdfjsLib();
      const dataBuffer = await fs.readFile(pdfFilePath);
      // Convert Node.js Buffer to Uint8Array (required by pdfjs-dist)
      const uint8Array = new Uint8Array(dataBuffer);
      const loadingTask = pdfjsLib.getDocument({ 
        data: uint8Array,
        verbosity: 0,
        // Suppress font warnings
        standardFontDataUrl: undefined
      });
      
      const pdfDoc = await loadingTask.promise;
      
      // Ensure document is fully loaded
      const totalPages = pdfDoc.numPages;
      
      if (!totalPages || totalPages === 0) {
        throw new Error('PDF has no pages or failed to load');
      }
      
      console.log(`[PDF] Loaded document with ${totalPages} pages`);
      
      const pages = [];
      let allText = '';
      
      // Extract text with coordinates from each page
      // pdfjs uses 0-based indexing: page 1 = index 0, page 2 = index 1, etc.
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const pageNum = pageIndex + 1; // 1-based page number for display/storage
        
        try {
          // Validate page index before accessing
          if (pageIndex < 0 || pageIndex >= totalPages) {
            throw new Error(`Invalid page index: ${pageIndex} (total pages: ${totalPages})`);
          }
          
          // Get the page - handle page 0 issues (some PDFs have problems with first page)
          let page;
          try {
            page = await pdfDoc.getPage(pageIndex);
          } catch (getPageError) {
            // If page 0 fails, try to get page 1 (index 1) as a fallback
            if (pageIndex === 0 && getPageError.message.includes('Invalid page request')) {
              console.warn(`[Page 1] PDF structure issue - page 0 not accessible, trying page 1 (index 1) as fallback...`);
              try {
                // Try to get page 1 (index 1) instead
                if (totalPages > 1) {
                  page = await pdfDoc.getPage(1);
                  console.log(`[Page 1] Successfully loaded page 1 (index 1) as fallback for page 0`);
                } else {
                  throw getPageError; // If only one page and it fails, throw original error
                }
              } catch (fallbackError) {
                console.warn(`[Page 1] Fallback also failed, skipping invalid page:`, fallbackError.message);
                // Skip invalid pages - don't create blank page
                continue; // Skip to next page
              }
            } else {
              throw getPageError; // Re-throw if it's a different error or not page 0
            }
          }
          const viewport = page.getViewport({ scale: 1.0 });
          
          // Get text content with positions
          const textContent = await page.getTextContent({ normalizeWhitespace: false });
          const textItems = textContent.items || [];
          
          // Group text items into blocks based on proximity (like epub_app)
          const textBlocks = this.groupTextItemsIntoBlocks(textItems, viewport, pageNum);
          
          // Store viewport in blocks for alignment detection
          textBlocks.forEach(block => {
            if (block.boundingBox) {
              block.viewport = viewport;
            }
          });
          
          // Combine all text for this page
          const pageText = textBlocks.map(block => block.text).join(' ');
          allText += pageText + '\n\n';
          
          pages.push({
            pageNumber: pageNum,
            text: pageText,
            textBlocks: textBlocks,
            charCount: pageText.length,
            width: viewport.width,
            height: viewport.height
          });
        } catch (pageError) {
          console.error(`[Page ${pageNum}] Error extracting text:`, pageError.message);
          // Continue with next page instead of failing completely
          pages.push({
            pageNumber: pageNum,
            text: '',
            textBlocks: [],
            charCount: 0,
            width: 612, // Default US Letter width
            height: 792 // Default US Letter height
          });
        }
      }
      
      // Get metadata (fallback to pdf-parse if needed)
      let metadata = {};
      try {
        const pdfData = await pdfParse(dataBuffer);
        metadata = {
          title: pdfData.info?.Title || '',
          author: pdfData.info?.Author || '',
          subject: pdfData.info?.Subject || '',
          creator: pdfData.info?.Creator || '',
          producer: pdfData.info?.Producer || '',
          creationDate: pdfData.info?.CreationDate || null,
          modificationDate: pdfData.info?.ModDate || null
        };
      } catch (metaError) {
        console.warn('Could not extract metadata from PDF:', metaError.message);
      }
      
      return {
        pages,
        totalPages,
        metadata
      };
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }
  
  /**
   * Group text items into logical blocks based on proximity (replicates epub_app logic)
   */
  static groupTextItemsIntoBlocks(textItems, viewport, pageNumber) {
    if (!textItems || textItems.length === 0) {
      return [];
    }
    
    // Sort by Y position (top to bottom), then X (left to right)
    // PDF coordinates: Y increases upward from bottom, but we want top-to-bottom reading
    const sortedItems = [...textItems].sort((a, b) => {
      const yDiff = (b.transform[5] || 0) - (a.transform[5] || 0); // Higher Y first
      if (Math.abs(yDiff) > 1) return yDiff;
      return (a.transform[4] || 0) - (b.transform[4] || 0); // Then by X
    });
    
    const blocks = [];
    let currentBlock = null;
    
    // Calculate average line height
    const lineHeights = [];
    for (let i = 1; i < sortedItems.length; i++) {
      const y1 = sortedItems[i - 1].transform[5] || 0;
      const y2 = sortedItems[i].transform[5] || 0;
      if (Math.abs(y1 - y2) > 1) {
        lineHeights.push(Math.abs(y1 - y2));
      }
    }
    const avgLineHeight = lineHeights.length > 0 
      ? lineHeights.reduce((a, b) => a + b, 0) / lineHeights.length 
      : 12.0;
    
    // Refined thresholds for better block granularity (improves TTS experience)
    // Make thresholds more strict to create more logical blocks
    const verticalThreshold = avgLineHeight * 1.5; // Reduced from 2.0 - tighter vertical grouping
    const horizontalThreshold = Math.max(30, avgLineHeight * 2.5); // Reduced from 3.0 - tighter horizontal grouping
    const maxLineGap = avgLineHeight * 0.6; // Reduced from 0.8 - stricter line detection
    const paragraphBreakThreshold = avgLineHeight * 3.0; // New: larger gap indicates paragraph break
    
    for (const item of sortedItems) {
      if (!item.str || item.str.trim().length === 0) continue;
      
      const x = item.transform[4] || 0;
      const y = item.transform[5] || 0;
      const width = item.width || 0;
      // item.height might be font size, but we need actual text height
      // For proper bounding box, use font size * 1.3 to account for ascent (80%) + descent (20%)
      // Large decorative text needs more height coverage
      const fontSize = item.transform[0] || item.height || 12;
      // Use actual item.height if available, otherwise estimate from font size
      // For large text, multiply by 1.3 to ensure full coverage
      const height = item.height ? Math.max(item.height, fontSize * 1.1) : (fontSize * 1.3);
      
      if (!currentBlock) {
        // Start new block
        currentBlock = {
          id: `block_${pageNumber}_${blocks.length}`,
          text: item.str,
          items: [item],
          minX: x,
          maxX: x + width,
          minY: y,
          maxY: y + height,
          pageNumber: pageNumber
        };
      } else {
        // Check if item belongs to current block
        const lastItem = currentBlock.items[currentBlock.items.length - 1];
        const lastX = lastItem.transform[4] || 0;
        const lastY = lastItem.transform[5] || 0;
        const lastWidth = lastItem.width || 0;
        
        const verticalDistance = Math.abs(y - lastY);
        const horizontalDistance = x - (lastX + lastWidth);
        
        // Check for paragraph break (large vertical gap)
        const isParagraphBreak = verticalDistance > paragraphBreakThreshold;
        
        // Check if on same line
        const sameLine = verticalDistance < maxLineGap && horizontalDistance < horizontalThreshold;
        
        // Check if same block (same line OR within vertical threshold with similar horizontal alignment)
        // But force break on paragraph gaps
        const sameBlock = !isParagraphBreak && (
          sameLine || 
          (verticalDistance < verticalThreshold && 
           Math.abs(x - currentBlock.minX) < viewport.width * 0.85) // Reduced from 0.9 for stricter alignment
        );
        
        if (sameBlock) {
          currentBlock.items.push(item);
          if (sameLine && horizontalDistance > width * 0.5) {
            currentBlock.text += ' ';
          } else if (!sameLine && verticalDistance > maxLineGap) {
            // Add line break for multi-line blocks
            currentBlock.text += ' ';
          }
          currentBlock.text += item.str;
          currentBlock.minX = Math.min(currentBlock.minX, x);
          currentBlock.maxX = Math.max(currentBlock.maxX, x + width);
          // For Y coordinates in PDF: higher Y = closer to top, lower Y = closer to bottom
          // minY = lowest baseline (bottom-most text), maxY = highest baseline + height (top-most text)
          // Calculate proper height for this item
          const itemFontSize = item.transform[0] || item.height || 12;
          const itemHeight = item.height || (itemFontSize * 1.2); // Full glyph height
          currentBlock.minY = Math.min(currentBlock.minY, y); // Lowest baseline
          // maxY should be the highest point of text (highest baseline + its height)
          // In PDF coords, y is baseline, so top of text is y + height
          currentBlock.maxY = Math.max(currentBlock.maxY, y + itemHeight);
        } else {
          // Finish current block and start new one
          const finishedBlock = this.createTextBlock(currentBlock, viewport);
          finishedBlock.viewport = viewport;
          
          // 🎯 CRITICAL FIX: Set reading order before pushing
          finishedBlock.readingOrder = blocks.length;
          
          blocks.push(finishedBlock);
          currentBlock = {
            id: `block_${pageNumber}_${blocks.length}`,
            text: item.str,
            items: [item],
            minX: x,
            maxX: x + width,
            minY: y,
            maxY: y + height,
            pageNumber: pageNumber
          };
        }
      }
    }
    
    if (currentBlock) {
      const finishedBlock = this.createTextBlock(currentBlock, viewport);
      finishedBlock.viewport = viewport;
      
      // 🎯 CRITICAL FIX: Set reading order for the final block
      finishedBlock.readingOrder = blocks.length;
      
      blocks.push(finishedBlock);
    }
    
    return blocks;
  }
  
  /**
   * Create a text block object from grouped items
   */
  static createTextBlock(blockData, viewport) {
    // Determine block type (heading, paragraph, etc.)
    const text = blockData.text.trim();
    let type = 'paragraph';
    let level = null;
    
    // Simple heuristics for heading detection
    if (text.length < 100) {
      if (text.match(/^Chapter \d+/) || text.match(/^\d+\.\s+[A-Z]/)) {
        type = 'heading';
        level = 1;
      } else if (text.match(/^\d+\.\d+\s+/)) {
        type = 'heading';
        level = 2;
      } else if (text === text.toUpperCase() && text.length > 3) {
        type = 'heading';
        level = 2;
      }
    }
    
    // Get font info from first item
    const firstItem = blockData.items[0];
    const fontSize = firstItem.transform[0] || 12;
    const fontName = firstItem.fontName || 'Unknown';
    const isBold = fontName.toLowerCase().includes('bold');
    const isItalic = fontName.toLowerCase().includes('italic');
    
    // Extract color information
    let textColor = '#000000'; // Default black
    if (firstItem.color) {
      // PDF.js returns color as [r, g, b] array (0-1 range)
      if (Array.isArray(firstItem.color) && firstItem.color.length >= 3) {
        const r = Math.round(firstItem.color[0] * 255);
        const g = Math.round(firstItem.color[1] * 255);
        const b = Math.round(firstItem.color[2] * 255);
        textColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      } else if (typeof firstItem.color === 'string') {
        textColor = firstItem.color;
      }
    }
    
    // Extract text alignment (heuristic based on position)
    let textAlign = 'left';
    const blockCenterX = (blockData.minX + blockData.maxX) / 2;
    const viewportWidth = blockData.viewport?.width || 612;
    const leftMargin = viewportWidth * 0.1;
    const rightMargin = viewportWidth * 0.9;
    
    if (blockData.minX > rightMargin) {
      textAlign = 'right';
    } else if (blockCenterX > viewportWidth * 0.4 && blockCenterX < viewportWidth * 0.6) {
      textAlign = 'center';
    }
    
    return {
      id: blockData.id,
      text: text,
      type: type,
      level: level,
      boundingBox: {
        x: blockData.minX,
        y: blockData.minY, // Y from bottom of page
        width: blockData.maxX - blockData.minX,
        height: blockData.maxY - blockData.minY,
        pageNumber: blockData.pageNumber
      },
      fontName: fontName,
      fontSize: fontSize,
      isBold: isBold,
      isItalic: isItalic,
      textColor: textColor,
      textAlign: textAlign,
      readingOrder: null // Will be set later
    };
  }

  /**
   * Render PDF pages as images (like epub_app fixed-layout approach)
   * Uses Puppeteer to render PDF pages at 300 DPI (equivalent to Java PDFRenderer)
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save rendered page images
   * @returns {Promise<Array>} Array of image objects with paths and metadata
   */
  static async renderPagesAsImages(pdfFilePath, outputDir) {
    try {
      await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
      
      // Verify PDF file exists
      await fs.access(pdfFilePath);
      
      // Get PDF page count using pdf-parse
      const pdfData = await fs.readFile(pdfFilePath);
      const pdfParseResult = await pdfParse(pdfData);
      const totalPages = pdfParseResult.numpages;
      
      if (totalPages === 0) {
        throw new Error('PDF has no pages');
      }
      
      console.log(`[PDF] Total pages in PDF: ${totalPages}`);
      
      // Get page dimensions using pdfjs-dist (just for dimensions, not rendering)
      const pdfjsLib = await getPdfjsLib();
      const uint8Array = new Uint8Array(pdfData);
      let pdfDoc = await pdfjsLib.getDocument({ 
        data: uint8Array,
        verbosity: 0,
        // Suppress font warnings - not needed for our use case
        standardFontDataUrl: undefined,
        // Additional options to help with problematic PDFs
        stopAtErrors: false, // Continue processing even if there are errors
        maxImageSize: 1024 * 1024 * 10, // 10MB max image size
        isEvalSupported: false, // Disable eval for security
        useSystemFonts: false, // Don't use system fonts
        disableFontFace: false, // Allow font face loading
        // Try to handle corrupted or non-standard PDFs
        disableAutoFetch: false, // Allow auto-fetching of resources
        disableStream: false, // Allow streaming
        disableRange: false // Allow range requests
      }).promise;
      
      let maxWidth = 0;
      let maxHeight = 0;
      
      // First pass: Get max page dimensions
      // Note: pdfjs uses 0-based indexing for getPage()
      for (let i = 0; i < totalPages; i++) {
        try {
          // pdfjs getPage uses 0-based index
          let pdfPage;
          try {
            pdfPage = await pdfDoc.getPage(i);
          } catch (pageError) {
            // If page 0 fails, try page 1 (index 1) as fallback
            if (i === 0 && pageError.message.includes('Invalid page request') && totalPages > 1) {
              console.warn(`[Page 1] Could not get dimensions: Invalid page request. Trying page 1 (index 1) as fallback...`);
              try {
                pdfPage = await pdfDoc.getPage(1);
              } catch (fallbackError) {
                console.warn(`[Page 1] Fallback also failed:`, fallbackError.message);
                // Use default dimensions if we can't get them
                if (maxWidth === 0) maxWidth = 612; // US Letter width in points
                if (maxHeight === 0) maxHeight = 792; // US Letter height in points
                continue;
              }
            } else {
              console.warn(`[Page ${i + 1}] Could not get dimensions:`, pageError.message);
              // Use default dimensions if we can't get them
              if (maxWidth === 0) maxWidth = 612; // US Letter width in points
              if (maxHeight === 0) maxHeight = 792; // US Letter height in points
              continue;
            }
          }
          const viewport = pdfPage.getViewport({ scale: 1.0 });
          maxWidth = Math.max(maxWidth, viewport.width);
          maxHeight = Math.max(maxHeight, viewport.height);
        } catch (pageError) {
          console.warn(`[Page ${i + 1}] Unexpected error getting dimensions:`, pageError.message);
          // Use default dimensions if we can't get them
          if (maxWidth === 0) maxWidth = 612; // US Letter width in points
          if (maxHeight === 0) maxHeight = 792; // US Letter height in points
        }
      }
      
      // Don't destroy yet - we'll need it for getting individual page dimensions
      // We'll destroy it after we're done with all rendering
      
      // Render at 300 DPI (like epub_app - renderImageWithDPI(300))
      const dpi = 300;
      const scale = dpi / 72; // 300 DPI = 300/72 points per pixel
      const maxRenderedWidth = Math.ceil(maxWidth * scale);
      const maxRenderedHeight = Math.ceil(maxHeight * scale);
      
      // Use Puppeteer with embedded PDF.js to render PDF pages (like Java PDFRenderer)
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
      
      const pageImages = [];
      // Convert PDF to base64 for embedding
      const pdfBase64 = Buffer.from(pdfData).toString('base64');
      
      try {
        // Render each page using PDF.js embedded in HTML
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          try {
            // Get actual page dimensions for this page FIRST (before creating browser page)
            // Handle page 1 (index 0) which might fail
            let pdfPage = null;
            let viewport = null;
            // pdfjs getPage expects 1-based page numbers
            let actualPageIndex = pageNum; // 1-based index for pdfjs
            let retryCount = 0;
            const maxRetries = 3;
            
            // Try to get page with retry logic (especially for page 1)
            while (retryCount < maxRetries && !pdfPage) {
              try {
                pdfPage = await pdfDoc.getPage(actualPageIndex);
                viewport = pdfPage.getViewport({ scale: 1.0 });
                break; // Success, exit retry loop
              } catch (pageError) {
                retryCount++;
                
                // Special handling for page 1 (index 0)
                if (pageNum === 1 && pageError.message.includes('Invalid page request')) {
                  if (retryCount === 1) {
                    // Strategy 1: Wait a bit and retry (sometimes PDF needs time to initialize)
                    console.warn(`[Page 1] Could not get page: Invalid page request. Retrying (attempt ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms
                    continue;
                  } else if (retryCount === 2) {
                    // Strategy 2: Try to reload the document and retry
                    console.warn(`[Page 1] Retry failed. Reloading PDF document and retrying...`);
                    try {
                      // Re-read PDF and create new document instance
                      const freshPdfData = await fs.readFile(pdfFilePath);
                      const freshUint8Array = new Uint8Array(freshPdfData);
                      const freshPdfDoc = await pdfjsLib.getDocument({ 
                        data: freshUint8Array,
                        verbosity: 0,
                        standardFontDataUrl: undefined,
                        stopAtErrors: false,
                        maxImageSize: 1024 * 1024 * 10,
                        isEvalSupported: false,
                        useSystemFonts: false,
                        disableFontFace: false,
                        disableAutoFetch: false,
                        disableStream: false,
                        disableRange: false
                      }).promise;
                      pdfPage = await freshPdfDoc.getPage(actualPageIndex);
                      viewport = pdfPage.getViewport({ scale: 1.0 });
                      // Update pdfDoc reference for future use
                      await pdfDoc.destroy().catch(() => {});
                      pdfDoc = freshPdfDoc;
                      console.log(`[Page 1] Successfully loaded after document reload!`);
                      break; // Success
                    } catch (reloadError) {
                      console.warn(`[Page 1] Document reload also failed:`, reloadError.message);
                      // Continue to final fallback
                    }
                  } else {
                    // Strategy 3: Skip this page entirely - don't create blank page
                    console.warn(`[Page ${pageNum}] All retries failed. Skipping invalid page (will not be included in EPUB).`);
                    continue; // Skip to next page - don't render or create blank page
                  }
                } else {
                  // For other pages, just throw the error (will be caught by outer try-catch)
                  throw pageError;
                }
              }
            }
            
            // If we still don't have a page object after all retries, try rendering anyway via Puppeteer
            // Some PDFs have page 1 that can't be accessed via pdfjs but can still be rendered
            if (!pdfPage || !viewport) {
              console.warn(`[Page ${pageNum}] Could not load page via pdfjs after all retries. Attempting direct Puppeteer render...`);
              // Use default dimensions and try to render anyway
              const fallbackPageWidthPoints = maxWidth || 612;
              const fallbackPageHeightPoints = maxHeight || 792;
              const fallbackPageRenderedWidth = Math.ceil(fallbackPageWidthPoints * scale);
              const fallbackPageRenderedHeight = Math.ceil(fallbackPageHeightPoints * scale);
              
              // We'll render this page using Puppeteer with page number, even without pdfjs page object
              const browserPage = await browser.newPage();
              try {
                // Create HTML that renders the specific page using PDF.js
                const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    body { margin: 0; padding: 0; background: white; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="pdf-canvas"></canvas>
  <script>
    (async function() {
      const pdfData = atob('${pdfBase64}');
      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const targetPageNum = ${pageNum};
      const page = await pdf.getPage(targetPageNum - 1); // pdfjs uses 0-based index
      const viewport = page.getViewport({ scale: ${scale} });
      const canvas = document.getElementById('pdf-canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport: viewport }).promise;
    })().catch(err => {
      console.error('PDF render error:', err);
      // If rendering fails, create a blank white canvas
      const canvas = document.getElementById('pdf-canvas');
      const context = canvas.getContext('2d');
      canvas.width = ${fallbackPageRenderedWidth};
      canvas.height = ${fallbackPageRenderedHeight};
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
    });
  </script>
</body>
</html>`;
                
                await browserPage.setContent(htmlContent);
                await browserPage.waitForTimeout(2000); // Wait for PDF.js to render
                
                const screenshot = await browserPage.screenshot({
                  type: 'png',
                  fullPage: true,
                  clip: {
                    x: 0,
                    y: 0,
                    width: fallbackPageRenderedWidth,
                    height: fallbackPageRenderedHeight
                  }
                });
                
                await browserPage.close();
                
                const imageFileName = `page_${pageNum}_render.png`;
                const imagePath = path.join(outputDir, imageFileName);
                await fs.writeFile(imagePath, screenshot);
                
                pageImages.push({
                  pageNumber: pageNum,
                  path: imagePath,
                  fileName: imageFileName,
                  width: fallbackPageRenderedWidth,
                  height: fallbackPageRenderedHeight,
                  pageWidthPoints: fallbackPageWidthPoints,
                  pageHeightPoints: fallbackPageHeightPoints,
                  renderFailed: false
                });
                
                console.log(`[PDF Page ${pageNum} → EPUB Page ${pageImages.length}] Rendered via Puppeteer fallback: ${fallbackPageRenderedWidth}x${fallbackPageRenderedHeight}px (${fallbackPageWidthPoints}x${fallbackPageHeightPoints}pt)`);
                continue; // Successfully rendered, move to next page
              } catch (puppeteerError) {
                await browserPage.close().catch(() => {});
                console.warn(`[Page ${pageNum}] Puppeteer fallback also failed:`, puppeteerError.message);
                // Last resort: create a blank white image placeholder
                const sharp = (await import('sharp')).default;
                const blankImage = await sharp({
                  create: {
                    width: fallbackPageRenderedWidth,
                    height: fallbackPageRenderedHeight,
                    channels: 3,
                    background: { r: 255, g: 255, b: 255 }
                  }
                }).png().toBuffer();
                
                const imageFileName = `page_${pageNum}_render.png`;
                const imagePath = path.join(outputDir, imageFileName);
                await fs.writeFile(imagePath, blankImage);
                
                pageImages.push({
                  pageNumber: pageNum,
                  path: imagePath,
                  fileName: imageFileName,
                  width: fallbackPageRenderedWidth,
                  height: fallbackPageRenderedHeight,
                  pageWidthPoints: fallbackPageWidthPoints,
                  pageHeightPoints: fallbackPageHeightPoints,
                  renderFailed: true
                });
                
                console.log(`[PDF Page ${pageNum} → EPUB Page ${pageImages.length}] Created blank placeholder: ${fallbackPageRenderedWidth}x${fallbackPageRenderedHeight}px`);
                continue; // Created placeholder, move to next page
              }
            }
            
            const pageWidthPoints = viewport.width;
            const pageHeightPoints = viewport.height;
            const pageRenderedWidth = Math.ceil(pageWidthPoints * scale);
            const pageRenderedHeight = Math.ceil(pageHeightPoints * scale);
            
            // Only create browser page if we're actually rendering
            const page = await browser.newPage();
            
            // Create HTML with embedded PDF.js to render the specific page
            const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: white;
      overflow: hidden;
    }
    #pdf-container {
      width: ${pageRenderedWidth}px;
      height: ${pageRenderedHeight}px;
      position: relative;
      background: white;
    }
    canvas {
      display: block;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div id="pdf-container">
    <canvas id="pdf-canvas"></canvas>
  </div>
  <script>
    (async function() {
        const pdfData = atob('${pdfBase64}');
                const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
                const pageIndex = ${pageNum}; // pdfjs getPage is 1-based
                const page = await pdf.getPage(pageIndex);
        
        const viewport = page.getViewport({ scale: ${scale} });
        const canvas = document.getElementById('pdf-canvas');
        const context = canvas.getContext('2d');
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
    })();
  </script>
</body>
</html>`;
            
            // Set viewport
            await page.setViewport({
              width: pageRenderedWidth,
              height: pageRenderedHeight,
              deviceScaleFactor: 1
            });
            
            // Load the HTML
            await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
            
            // Wait for PDF to render
            await page.waitForFunction(
              () => {
                const canvas = document.getElementById('pdf-canvas');
                return canvas && canvas.width > 0 && canvas.height > 0;
              },
              { timeout: 30000 }
            );
            
            // Additional wait to ensure rendering is complete
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Take screenshot
            // Keep EPUB page number aligned with the PDF page number to prevent off-by-one shifts
            const epubPageNumber = pageNum;
            const imageFileName = `page_${epubPageNumber}.png`;
            const imagePath = path.join(outputDir, imageFileName);
            
            const screenshot = await page.screenshot({
              type: 'png',
              fullPage: false,
              clip: {
                x: 0,
                y: 0,
                width: pageRenderedWidth,
                height: pageRenderedHeight
              }
            });

            await fs.writeFile(imagePath, screenshot);

            // If page is smaller than max, create a canvas at max size and center it (like Java)
            // Ensure all extend values are non-negative
            let finalImagePath = imagePath;
            if (pageRenderedWidth < maxRenderedWidth || pageRenderedHeight < maxRenderedHeight) {
              const topExtend = Math.max(0, Math.floor((maxRenderedHeight - pageRenderedHeight) / 2));
              const bottomExtend = Math.max(0, Math.ceil((maxRenderedHeight - pageRenderedHeight) / 2));
              const leftExtend = Math.max(0, Math.floor((maxRenderedWidth - pageRenderedWidth) / 2));
              const rightExtend = Math.max(0, Math.ceil((maxRenderedWidth - pageRenderedWidth) / 2));
              
              // Only extend if we have positive values
              if (topExtend > 0 || bottomExtend > 0 || leftExtend > 0 || rightExtend > 0) {
                const finalImage = await sharp(imagePath)
                  .extend({
                    top: topExtend,
                    bottom: bottomExtend,
                    left: leftExtend,
                    right: rightExtend,
                    background: { r: 255, g: 255, b: 255 }
                  })
                  .toBuffer();
                
                await fs.writeFile(imagePath, finalImage);
              }
            }
            
            // Store both PDF page number (original) and EPUB page number (matching PDF page)
            pageImages.push({
              pdfPageNumber: pageNum, // Original PDF page number
              pageNumber: epubPageNumber, // EPUB page number matches PDF page number
              path: imagePath,
              fileName: imageFileName,
              width: maxRenderedWidth,
              height: maxRenderedHeight,
              pageWidth: pageWidthPoints,
              pageHeight: pageHeightPoints,
              renderFailed: false
            });
            
            console.log(`[PDF Page ${pageNum} → EPUB Page ${epubPageNumber}] Rendered successfully: ${maxRenderedWidth}x${maxRenderedHeight}px (${pageWidthPoints}x${pageHeightPoints}pt)`);
            
            await page.close();
          } catch (pageError) {
            console.error(`[Page ${pageNum}] Failed to render:`, pageError.message);
            // Create a blank placeholder to preserve page numbering and avoid text/page misalignment
            try {
              const fallbackPageWidthPoints = maxWidth || 612;
              const fallbackPageHeightPoints = maxHeight || 792;
              const fallbackPageRenderedWidth = Math.ceil(fallbackPageWidthPoints * scale);
              const fallbackPageRenderedHeight = Math.ceil(fallbackPageHeightPoints * scale);

              const sharp = (await import('sharp')).default;
              const blankImage = await sharp({
                create: {
                  width: fallbackPageRenderedWidth,
                  height: fallbackPageRenderedHeight,
                  channels: 3,
                  background: { r: 255, g: 255, b: 255 }
                }
              }).png().toBuffer();

              const imageFileName = `page_${pageNum}.png`;
              const imagePath = path.join(outputDir, imageFileName);
              await fs.writeFile(imagePath, blankImage);

              pageImages.push({
                pdfPageNumber: pageNum,
                pageNumber: pageNum,
                path: imagePath,
                fileName: imageFileName,
                width: fallbackPageRenderedWidth,
                height: fallbackPageRenderedHeight,
                pageWidth: fallbackPageWidthPoints,
                pageHeight: fallbackPageHeightPoints,
                renderFailed: true
              });

              console.warn(`[Page ${pageNum}] Render failed. Inserted blank placeholder to preserve ordering (${fallbackPageRenderedWidth}x${fallbackPageRenderedHeight}px).`);
            } catch (placeholderError) {
              console.warn(`[Page ${pageNum}] Failed to create placeholder after render error:`, placeholderError.message);
            }
          }
        }
      } finally {
        await browser.close();
        // Clean up PDF document
        try {
          await pdfDoc.destroy();
        } catch (destroyError) {
          // Ignore destroy errors
        }
      }
      
      console.log(`[PDF] Rendered ${pageImages.length} page images (expected ${totalPages} pages)`);
      if (pageImages.length !== totalPages) {
        console.warn(`[PDF] WARNING: Page count mismatch! Rendered ${pageImages.length} images but PDF has ${totalPages} pages`);
      }
      
      return {
        images: pageImages,
        maxWidth: maxWidth,
        maxHeight: maxHeight,
        renderedWidth: maxRenderedWidth,
        renderedHeight: maxRenderedHeight
      };
    } catch (error) {
      console.error('Error rendering PDF pages as images:', error);
      throw new Error(`Failed to render PDF pages: ${error.message}`);
    }
  }
  
  /**
   * Extract images from PDF (embedded images)
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save extracted images
   * @returns {Promise<Array>} Array of image objects with paths and metadata
   */
  static async extractImages(pdfFilePath, outputDir) {
    try {
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
      
      const pdfBytes = await fs.readFile(pdfFilePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();
      
      const images = [];
      let imageIndex = 0;
      
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        
        // Extract embedded images from the page
        const embeddedImages = await page.node.context.enumerateIndirectObjects();
        
        for (const [ref, object] of embeddedImages) {
          try {
            // Check if object is an image (XObject with Subtype 'Image')
            if (object instanceof pdfDoc.context.constructor.dict && 
                object.get('Subtype')?.toString() === '/Image') {
              
              const width = object.get('Width')?.value || 0;
              const height = object.get('Height')?.value || 0;
              
              // Try to extract image data
              let imageData;
              let imageFormat = 'png';
              
              try {
                // Get the raw image stream
                const stream = object.get('stream');
                if (stream) {
                  imageData = stream.contents;
                  
                  // Determine format from ColorSpace
                  const colorSpace = object.get('ColorSpace')?.toString();
                  const filter = object.get('Filter')?.toString();
                  
                  if (filter?.includes('/DCTDecode')) {
                    imageFormat = 'jpg';
                  } else if (filter?.includes('/JPXDecode')) {
                    imageFormat = 'jp2';
                  } else {
                    imageFormat = 'png';
                  }
                  
                  // Save image
                  const imageFileName = `image_${pageIndex + 1}_${imageIndex}.${imageFormat}`;
                  const imagePath = path.join(outputDir, imageFileName);
                  
                  // Process and save image using sharp
                  await sharp(imageData).toFile(imagePath);
                  
                  images.push({
                    pageNumber: pageIndex + 1,
                    index: imageIndex,
                    path: imagePath,
                    fileName: imageFileName,
                    width,
                    height,
                    format: imageFormat
                  });
                  
                  imageIndex++;
                }
              } catch (imgError) {
                console.warn(`Could not extract image ${imageIndex} from page ${pageIndex + 1}:`, imgError.message);
              }
            }
          } catch (err) {
            // Skip objects that aren't images
            continue;
          }
        }
      }
      
      // Alternative approach: Render pages as images if no embedded images found
      if (images.length === 0) {
        console.log('No embedded images found, rendering pages as images...');
        // This would require pdf2pic or similar library
        // For now, we'll proceed without images
      }
      
      return images;
    } catch (error) {
      console.error('Error extracting images from PDF:', error);
      // Don't throw - images are optional
      return [];
    }
  }

  /**
   * Extract both text and images from PDF
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save extracted images
   * @returns {Promise<Object>} Object containing text and images
   */
  static async extractContent(pdfFilePath, outputDir) {
    const [textData, images] = await Promise.all([
      this.extractText(pdfFilePath),
      this.extractImages(pdfFilePath, outputDir).catch(() => [])
    ]);
    
    return {
      text: textData,
      images,
      hasImages: images.length > 0
    };
  }
}

