import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import mammoth from 'mammoth';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Service for extracting content from Word (DOCX) files
 * Converts DOCX to HTML pages and extracts text with structure
 */
export class WordExtractionService {
  /**
   * Extract text content from DOCX and convert to HTML pages
   * @param {string} docxFilePath - Path to the DOCX file
   * @returns {Promise<Object>} Object with pages array containing HTML content and text blocks
   */
  static async extractText(docxFilePath) {
    try {
      console.log('[WordExtraction] Reading Word document file...');
      const fileBuffer = await fs.readFile(docxFilePath);
      
      // Yield to event loop before CPU-intensive operation
      await new Promise(resolve => setImmediate(resolve));
      
      console.log('[WordExtraction] Converting DOCX to HTML (this may take a moment for large documents)...');
      console.log('[WordExtraction] File size:', fileBuffer.length, 'bytes');
      
      // Use worker thread for mammoth conversion to prevent blocking the main event loop
      // This allows the server to remain responsive during CPU-intensive conversion
      const useWorkerThread = process.env.USE_MAMMOTH_WORKER !== 'false'; // Default to true
      
      let result;
      if (useWorkerThread && fileBuffer.length > 100000) { // Use worker for files > 100KB
        console.log('[WordExtraction] Using worker thread for large document conversion...');
        result = await this.convertWithWorker(docxFilePath);
      } else {
        // For small files, use direct conversion (faster, no worker overhead)
        console.log('[WordExtraction] Using direct conversion (small file or worker disabled)...');
        result = await this.convertDirectly(fileBuffer);
      }

      let htmlContent = result.value;
      const messages = result.messages || [];

      // Yield to event loop after mammoth conversion
      await new Promise(resolve => setImmediate(resolve));

      console.log('[WordExtraction] Processing HTML content...');
      console.log(`[WordExtraction] HTML content size: ${(htmlContent.length / 1024 / 1024).toFixed(2)} MB`);
      
      // Extract and preserve inline styles from the HTML
      // Mammoth preserves inline styles in style attributes, but we need to ensure they're kept
      console.log('[WordExtraction] Preserving inline styles...');
      htmlContent = await this.preserveInlineStylesAsync(htmlContent);
      
      // Yield to event loop after preserving styles
      await new Promise(resolve => setImmediate(resolve));
      
      // Split HTML into pages based on page breaks or logical sections
      console.log('[WordExtraction] Splitting HTML into pages...');
      const pages = this.splitHtmlIntoPages(htmlContent);
      
      // Yield to event loop after splitting pages
      await new Promise(resolve => setImmediate(resolve));
      
      console.log(`[WordExtraction] Split into ${pages.length} pages, extracting text blocks...`);

      // Extract text blocks from each page
      // Process in batches to avoid blocking event loop
      const pagesWithBlocks = [];
      const totalPages = pages.length;
      for (let index = 0; index < pages.length; index++) {
        const pageHtml = pages[index];
        const textBlocks = this.extractTextBlocksFromHtml(pageHtml, index + 1);
        const allText = textBlocks.map(block => block.text).join(' ').trim();
        
        pagesWithBlocks.push({
          pageNumber: index + 1,
          html: pageHtml,
          text: allText,
          textBlocks: textBlocks,
          charCount: allText.length,
          width: 612, // Default US Letter width in points
          height: 792 // Default US Letter height in points
        });
        
        // Log progress every 10 pages or on last page
        if ((index + 1) % 10 === 0 || index === pages.length - 1) {
          console.log(`[WordExtraction] Processed ${index + 1}/${totalPages} pages...`);
        }
        
        // Yield to event loop every 5 pages (more frequent for large documents)
        if (index > 0 && (index + 1) % 5 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      
      console.log(`[WordExtraction] Completed processing ${pagesWithBlocks.length} pages`);

      return {
        pages: pagesWithBlocks,
        totalPages: pagesWithBlocks.length,
        metadata: {
          title: this.extractTitle(htmlContent),
          language: 'en',
          messages: messages
        },
        allText: pagesWithBlocks.map(p => p.text).join('\n\n')
      };
    } catch (error) {
      console.error('[WordExtraction] Error extracting text from DOCX:', error);
      throw new Error(`Failed to extract text from DOCX: ${error.message}`);
    }
  }

  /**
   * Convert Word document using worker thread (non-blocking)
   * @param {string} docxFilePath - Path to the DOCX file
   * @returns {Promise<Object>} Result object with html and messages
   */
  static async convertWithWorker(docxFilePath) {
    return new Promise((resolve, reject) => {
      // Use file URL for ES modules (required for worker threads in ES modules)
      const workerUrl = new URL('../workers/mammothWorker.js', import.meta.url);
      
      const worker = new Worker(workerUrl, {
        workerData: {
          docxFilePath: docxFilePath,
          // Options are handled in the worker itself (functions can't be serialized)
          options: {
            includeDefaultStyleMap: true,
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
              "p[style-name='Heading 4'] => h4:fresh",
              "p[style-name='Heading 5'] => h5:fresh",
              "p[style-name='Heading 6'] => h6:fresh",
              "r[style-name='Strong'] => strong",
              "r[style-name='Emphasis'] => em"
            ],
            preserveEmptyParagraphs: true
            // convertImage is handled in the worker itself
          }
        }
      });
      
      worker.on('message', (message) => {
        if (message.success) {
          resolve({
            value: message.html,
            messages: message.messages || []
          });
        } else {
          reject(new Error(message.error || 'Worker conversion failed'));
        }
        worker.terminate();
      });
      
      worker.on('error', (error) => {
        console.error('[WordExtraction] Worker error:', error);
        reject(error);
        worker.terminate();
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Convert Word document directly (for small files)
   * @param {Buffer} fileBuffer - File buffer
   * @returns {Promise<Object>} Result object with html and messages
   */
  static async convertDirectly(fileBuffer) {
    const result = await mammoth.convertToHtml(
      { buffer: fileBuffer },
      {
        includeDefaultStyleMap: true,
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh",
          "r[style-name='Strong'] => strong",
          "r[style-name='Emphasis'] => em"
        ],
        preserveEmptyParagraphs: true,
        convertImage: mammoth.images.imgElement((image) => {
          return image.read("base64").then((imageBuffer) => {
            const imgAttrs = {
              src: `data:${image.contentType};base64,${imageBuffer.toString("base64")}`,
              alt: image.altText || ''
            };
            
            if (image.width) imgAttrs.width = image.width;
            if (image.height) imgAttrs.height = image.height;
            
            const styleParts = [];
            if (image.width) styleParts.push(`width: ${image.width}px`);
            if (image.height) styleParts.push(`height: ${image.height}px`);
            if (image.style) styleParts.push(image.style);
            
            if (styleParts.length > 0) {
              imgAttrs.style = styleParts.join('; ');
            }
            
            return imgAttrs;
          });
        })
      }
    );
    
    return result;
  }

  /**
   * Split HTML content into pages
   * Uses page breaks, section breaks, or logical content divisions
   */
  static splitHtmlIntoPages(htmlContent) {
    // Look for explicit page breaks
    const pageBreakRegex = /<p[^>]*>.*?<\/p>\s*<p[^>]*>.*?<\/p>/gi;
    const hasPageBreaks = htmlContent.includes('page-break') || htmlContent.includes('pagebreak');
    
    if (hasPageBreaks) {
      // Split on page breaks
      return htmlContent
        .split(/<div[^>]*class="page-break"[^>]*>/i)
        .filter(page => page.trim().length > 0)
        .map(page => page.trim());
    }

    // Split by headings or large content blocks
    // Group content between major headings (h1, h2) as separate pages
    const headingSplitRegex = /(<h[1-2][^>]*>.*?<\/h[1-2]>)/gi;
    const parts = htmlContent.split(headingSplitRegex);
    
    const pages = [];
    let currentPage = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.match(/^<h[1-2]/i)) {
        // If we have accumulated content, save it as a page
        if (currentPage.trim().length > 0) {
          pages.push(currentPage.trim());
          currentPage = '';
        }
        currentPage = part;
      } else {
        currentPage += part;
        
        // If current page is getting too long, split it
        if (currentPage.length > 50000) { // ~50KB of HTML
          pages.push(currentPage.trim());
          currentPage = '';
        }
      }
    }
    
    // Add the last page
    if (currentPage.trim().length > 0) {
      pages.push(currentPage.trim());
    }

    // If no logical splits found, create a single page
    if (pages.length === 0) {
      pages.push(htmlContent);
    }

    return pages;
  }

  /**
   * Extract text blocks from HTML with structure
   * Preserves style information for proper rendering
   */
  static extractTextBlocksFromHtml(htmlContent, pageNumber) {
    const blocks = [];
    
    // Remove script tags but preserve style tags (they contain important CSS)
    const cleanHtml = htmlContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    // Note: We keep <style> tags - they'll be extracted separately
    
    // Extract paragraphs, headings, and other block elements
    // Capture full element including attributes to preserve styles
    const blockRegex = /<(p|h[1-6]|div|li|span|td|th)[^>]*>(.*?)<\/\1>/gi;
    let match;
    let blockIndex = 0;
    
    while ((match = blockRegex.exec(cleanHtml)) !== null) {
      const fullMatch = match[0];
      const tag = match[1].toLowerCase();
      const attributes = fullMatch.substring(fullMatch.indexOf('<') + 1, fullMatch.indexOf('>'));
      const content = match[2];
      
      // Extract style attribute if present
      const styleMatch = attributes.match(/style="([^"]*)"/i);
      const inlineStyle = styleMatch ? styleMatch[1] : null;
      
      // Extract color from style or color attribute
      let textColor = null;
      if (inlineStyle) {
        const colorMatch = inlineStyle.match(/color:\s*([^;]+)/i);
        if (colorMatch) textColor = colorMatch[1].trim();
      }
      const colorAttrMatch = attributes.match(/color="([^"]*)"/i);
      if (colorAttrMatch && !textColor) textColor = colorAttrMatch[1];
      
      // Remove nested HTML tags to get plain text
      const text = content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (text.length > 0) {
        const blockId = `block_${pageNumber}_${blockIndex}`;
        const isHeading = tag.startsWith('h');
        const headingLevel = isHeading ? parseInt(tag.charAt(1)) : null;
        
        blocks.push({
          id: blockId,
          text: text,
          type: isHeading ? 'heading' : 'paragraph',
          headingLevel: headingLevel,
          readingOrder: blockIndex,
          // Preserve style information
          style: inlineStyle || null,
          textColor: textColor || null,
          boundingBox: {
            x: 72, // Default left margin (1 inch = 72 points)
            y: 72 + (blockIndex * 20), // Approximate Y position
            width: 468, // Default width (8.5 inch - 2 inch margins = 6.5 inch = 468 points)
            height: 20, // Approximate line height
            pageNumber: pageNumber
          }
        });
        
        blockIndex++;
      }
    }

    return blocks;
  }

  /**
   * Preserve inline styles from Word document HTML
   * Ensures colors, fonts, spacing, alignment, and positioning are maintained
   */
  /**
   * Async version of preserveInlineStyles that yields to event loop between operations
   * @param {string} htmlContent - HTML content to process
   * @returns {Promise<string>} Processed HTML with preserved inline styles
   */
  static async preserveInlineStylesAsync(htmlContent) {
    const totalLength = htmlContent.length;
    const LARGE_FILE_THRESHOLD = 5000000; // 5MB
    
    // For very large files, skip style preservation (mammoth already preserves most styles)
    // This prevents blocking the event loop
    if (totalLength > LARGE_FILE_THRESHOLD) {
      console.log(`[WordExtraction] Large file detected (${(totalLength / 1024 / 1024).toFixed(2)} MB), skipping additional style preservation (mammoth already preserves styles)`);
      return htmlContent;
    }
    
    console.log(`[WordExtraction] Preserving inline styles (${(totalLength / 1024 / 1024).toFixed(2)} MB)...`);
    
    let preservedHtml = htmlContent;
    
    // Apply each replacement with yielding between operations
    console.log('[WordExtraction] Applying text-align styles...');
    preservedHtml = preservedHtml.replace(
      /style="([^"]*)"([^>]*)align="([^"]*)"([^>]*>)/gi,
      (match, styleBefore, attrsBefore, align, attrsAfter) => {
        const existingStyle = styleBefore || '';
        const textAlign = `text-align: ${align};`;
        const newStyle = existingStyle ? `${existingStyle} ${textAlign}` : textAlign;
        return `style="${newStyle}"${attrsBefore}${attrsAfter}`;
      }
    );
    await new Promise(resolve => setImmediate(resolve));
    
    console.log('[WordExtraction] Applying color styles...');
    preservedHtml = preservedHtml.replace(
      /([^>]*)color="([^"]*)"([^>]*>)/gi,
      (match, before, color, after) => {
        if (before.includes('style=')) {
          return match.replace(/style="([^"]*)"/i, (styleMatch, styleContent) => {
            return `style="${styleContent} color: ${color};"`;
          });
        } else {
          return `${before}style="color: ${color};"${after}`;
        }
      }
    );
    await new Promise(resolve => setImmediate(resolve));
    
    console.log('[WordExtraction] Applying font-family styles...');
    preservedHtml = preservedHtml.replace(
      /([^>]*)face="([^"]*)"([^>]*>)/gi,
      (match, before, fontFamily, after) => {
        if (before.includes('style=')) {
          return match.replace(/style="([^"]*)"/i, (styleMatch, styleContent) => {
            return `style="${styleContent} font-family: ${fontFamily};"`;
          });
        } else {
          return `${before}style="font-family: ${fontFamily};"${after}`;
        }
      }
    );
    await new Promise(resolve => setImmediate(resolve));
    
    console.log('[WordExtraction] Applying font-size styles...');
    preservedHtml = preservedHtml.replace(
      /([^>]*)size="([^"]*)"([^>]*>)/gi,
      (match, before, size, after) => {
        const fontSize = size ? `${parseInt(size) * 0.5}pt` : '12pt';
        if (before.includes('style=')) {
          return match.replace(/style="([^"]*)"/i, (styleMatch, styleContent) => {
            return `style="${styleContent} font-size: ${fontSize};"`;
          });
        } else {
          return `${before}style="font-size: ${fontSize};"${after}`;
        }
      }
    );
    await new Promise(resolve => setImmediate(resolve));
    
    console.log('[WordExtraction] Completed style preservation');
    return preservedHtml;
  }

  static preserveInlineStyles(htmlContent) {
    // Mammoth already preserves inline styles in style attributes
    // But we need to ensure they're properly formatted for EPUB
    
    // Preserve all style attributes on elements
    // Convert common Word styles to CSS
    let preservedHtml = htmlContent;
    
    // Preserve text-align styles
    preservedHtml = preservedHtml.replace(
      /style="([^"]*)"([^>]*)align="([^"]*)"([^>]*>)/gi,
      (match, styleBefore, attrsBefore, align, attrsAfter) => {
        const existingStyle = styleBefore || '';
        const textAlign = `text-align: ${align};`;
        const newStyle = existingStyle ? `${existingStyle} ${textAlign}` : textAlign;
        return `style="${newStyle}"${attrsBefore}${attrsAfter}`;
      }
    );
    
    // Preserve color attributes
    preservedHtml = preservedHtml.replace(
      /([^>]*)color="([^"]*)"([^>]*>)/gi,
      (match, before, color, after) => {
        // Check if style attribute exists
        if (before.includes('style=')) {
          return match.replace(/style="([^"]*)"/i, (styleMatch, styleContent) => {
            return `style="${styleContent} color: ${color};"`;
          });
        } else {
          return `${before}style="color: ${color};"${after}`;
        }
      }
    );
    
    // Preserve font-family attributes
    preservedHtml = preservedHtml.replace(
      /([^>]*)face="([^"]*)"([^>]*>)/gi,
      (match, before, fontFamily, after) => {
        if (before.includes('style=')) {
          return match.replace(/style="([^"]*)"/i, (styleMatch, styleContent) => {
            return `style="${styleContent} font-family: ${fontFamily};"`;
          });
        } else {
          return `${before}style="font-family: ${fontFamily};"${after}`;
        }
      }
    );
    
    // Preserve font-size attributes
    preservedHtml = preservedHtml.replace(
      /([^>]*)size="([^"]*)"([^>]*>)/gi,
      (match, before, size, after) => {
        // Convert Word size to CSS (Word uses points, 1-1638, where 1 = 0.5pt, 2 = 1pt, etc.)
        const fontSize = size ? `${parseInt(size) * 0.5}pt` : '12pt';
        if (before.includes('style=')) {
          return match.replace(/style="([^"]*)"/i, (styleMatch, styleContent) => {
            return `style="${styleContent} font-size: ${fontSize};"`;
          });
        } else {
          return `${before}style="font-size: ${fontSize};"${after}`;
        }
      }
    );
    
    return preservedHtml;
  }

  /**
   * Extract title from HTML content
   */
  static extractTitle(htmlContent) {
    // Try to find first h1
    const h1Match = htmlContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match) {
      return h1Match[1].replace(/<[^>]+>/g, '').trim();
    }
    
    // Try to find title in first paragraph
    const firstPMatch = htmlContent.match(/<p[^>]*>(.*?)<\/p>/i);
    if (firstPMatch) {
      const text = firstPMatch[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 0 && text.length < 200) {
        return text;
      }
    }
    
    return 'Untitled Document';
  }

  /**
   * Convert DOCX to HTML pages (for EPUB generation)
   * Returns array of HTML page content
   * @param {string} docxFilePath - Path to the DOCX file
   * @param {string} outputDir - Directory to save HTML pages
   * @param {Function} progressCallback - Optional callback for progress updates (currentPage, totalPages)
   */
  static async convertToHtmlPages(docxFilePath, outputDir, progressCallback = null) {
    try {
      await fs.mkdir(outputDir, { recursive: true });
      
      const textData = await this.extractText(docxFilePath);
      const htmlPages = [];
      const totalPages = textData.pages.length;
      
      for (let i = 0; i < textData.pages.length; i++) {
        const page = textData.pages[i];
        const pageNumber = i + 1;
        
        // Call progress callback if provided (await it if it's async)
        if (progressCallback && typeof progressCallback === 'function') {
          try {
            await progressCallback(pageNumber, totalPages);
          } catch (callbackErr) {
            console.warn(`[WordExtraction] Progress callback error:`, callbackErr);
            // Continue processing even if callback fails
          }
        }
        
        // Save HTML page
        const htmlFileName = `page_${pageNumber}.html`;
        const htmlPath = path.join(outputDir, htmlFileName);
        await fs.writeFile(htmlPath, page.html, 'utf8');
        
        htmlPages.push({
          pageNumber: pageNumber,
          path: htmlPath,
          fileName: htmlFileName,
          html: page.html,
          width: page.width,
          height: page.height,
          pageWidthPoints: page.width,
          pageHeightPoints: page.height
        });
        
        // Yield to event loop every 5 pages to prevent blocking
        if (i > 0 && i % 5 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      
      return {
        pages: htmlPages,
        textData: textData,
        renderedWidth: 612, // Default width
        renderedHeight: 792, // Default height
        maxWidth: 612,
        maxHeight: 792
      };
    } catch (error) {
      console.error('[WordExtraction] Error converting DOCX to HTML pages:', error);
      throw new Error(`Failed to convert DOCX to HTML pages: ${error.message}`);
    }
  }

  /**
   * Convert Word document to HTML pages using AI (Gemini vision)
   * Renders pages as images and uses AI to generate perfectly formatted HTML
   * @param {string} docxFilePath - Path to the DOCX file
   * @param {string} outputDir - Directory to save rendered images
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Object>} Object with pages array containing AI-generated HTML
   */
  static async convertToHtmlPagesWithAI(docxFilePath, outputDir, progressCallback = null) {
    const { GeminiService } = await import('./geminiService.js');
    const { PdfExtractionService } = await import('./pdfExtractionService.js');
    
    try {
      await fs.mkdir(outputDir, { recursive: true });
      
      // IMPORTANT: Gemini API cannot read Word documents directly - it only supports PDFs and images
      // We MUST convert Word pages to images first. Since browsers can't open Word files directly,
      // we need to convert Word to PDF first, then render PDF pages as images.
      
      // Step 1: Convert Word to PDF (using mammoth HTML as intermediate step - required for rendering)
      // Note: This is the ONLY use of mammoth - just to get HTML that can be printed to PDF
      console.log('[WordExtraction] Step 1: Converting Word document to PDF (mammoth used only for PDF conversion, not processing)...');
      console.log('[WordExtraction] Note: Word files cannot be opened directly in browsers. Converting to PDF first.');
      
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      // Use mammoth ONLY to get HTML for PDF conversion (not for processing)
      console.log('[WordExtraction] Extracting HTML from Word document (mammoth - for PDF conversion only)...');
      const textData = await this.extractText(docxFilePath);
      const fullHtml = textData.pages.map(p => p.html).join('\n\n');
      
      console.log(`[WordExtraction] HTML extracted (${(fullHtml.length / 1024).toFixed(1)} KB), converting to PDF...`);
      
      // Convert HTML to PDF using Puppeteer
      const pdfPath = path.join(outputDir, 'document.pdf');
      const page = await browser.newPage();
      
      // Set a longer timeout for large documents (120 seconds)
      page.setDefaultTimeout(120000);
      page.setDefaultNavigationTimeout(120000);
      
      // Wrap HTML in proper document structure and set content
      // Use 'load' instead of 'networkidle0' to avoid waiting for external resources
      const wrappedHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 20px; font-family: Arial, sans-serif; background: white; }
    ${this.getDefaultStyles()}
  </style>
</head>
<body>${fullHtml}</body>
</html>`;
      
      console.log('[WordExtraction] Setting HTML content in Puppeteer (this may take a moment for large documents)...');
      await page.setContent(wrappedHtml, { 
        waitUntil: 'load',  // Changed from 'networkidle0' to 'load' - faster and more reliable
        timeout: 120000  // 120 second timeout
      });
      
      console.log('[WordExtraction] HTML loaded, generating PDF...');
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });
      await page.close();
      await browser.close();
      
      console.log(`[WordExtraction] ✓ Word document converted to PDF: ${pdfPath}`);
      
      // Step 2: Render PDF pages as images (DOCX → PDF → Images)
      console.log('[WordExtraction] Step 2: Rendering PDF pages as images (1654x2339px at 200% scale)...');
      const imagesDir = path.join(outputDir, 'images');
      const pdfImages = await PdfExtractionService.renderPagesAsImages(pdfPath, imagesDir);
      
      console.log(`[WordExtraction] ✓ Rendered ${pdfImages.images.length} pages as images`);
      
      // Step 3: Send each image directly to Gemini Vision API (Images → Gemini → HTML/XHTML)
      console.log(`[WordExtraction] Step 3: Sending ${pdfImages.images.length} page images to Gemini Vision API...`);
      
      const htmlPages = [];
      
      for (let i = 0; i < pdfImages.images.length; i++) {
        const imageData = pdfImages.images[i];
        const pageNumber = imageData.pageNumber;
        
        try {
          console.log(`[WordExtraction] Page ${pageNumber}/${pdfImages.images.length}: Sending image to Gemini Vision API...`);
          
          if (progressCallback) {
            await progressCallback(pageNumber, pdfImages.images.length);
          }
          
          try {
            // Send image directly to Gemini - this is where the actual conversion happens
            const aiResult = await GeminiService.convertWordPageImageToHtml(
              imageData.path,
              pageNumber,
              {
                width: imageData.width || 1654,
                height: imageData.height || 2339,
                priority: 1
              }
            );
            
            console.log(`[WordExtraction] ✓ Page ${pageNumber}: Gemini converted image to HTML/XHTML (${(aiResult.html.length / 1024).toFixed(1)} KB)`);
            
            // Extract text blocks from AI-generated HTML
            const textBlocks = aiResult.textBlocks || [];
            const allText = textBlocks.map(block => block.text).join(' ').trim();
            
            // Save HTML to file
            const htmlFileName = `page_${pageNumber}.html`;
            const htmlPath = path.join(outputDir, htmlFileName);
            await fs.writeFile(htmlPath, aiResult.html, 'utf8');
            
            htmlPages.push({
              pageNumber: pageNumber,
              path: htmlPath,
              fileName: htmlFileName,
              html: aiResult.html,
              text: allText,
              textBlocks: textBlocks,
              charCount: allText.length,
              width: aiResult.width,
              height: aiResult.height,
              pageWidthPoints: aiResult.width,
              pageHeightPoints: aiResult.height
            });
            
            // Yield to event loop after each page
            await new Promise(resolve => setImmediate(resolve));
          } catch (aiError) {
            console.warn(`[WordExtraction] Page ${pageNumber}: Gemini conversion failed:`, aiError.message);
            // Create empty page if Gemini fails
            htmlPages.push({
              pageNumber: pageNumber,
              path: path.join(outputDir, `page_${pageNumber}.html`),
              fileName: `page_${pageNumber}.html`,
              html: '<div class="word-content" style="position: relative; width: 1654px; height: 2339px; background: white;"></div>',
              text: '',
              textBlocks: [],
              charCount: 0,
              width: 1654,
              height: 2339,
              pageWidthPoints: 1654,
              pageHeightPoints: 2339
            });
          }
        } catch (pageError) {
          console.error(`[WordExtraction] Error processing page ${pageNumber}:`, pageError.message);
        }
      }
      
      console.log(`[WordExtraction] ✓ Successfully processed ${htmlPages.length} pages: DOCX → PDF → Images → Gemini → HTML/XHTML`);
      
      return {
        pages: htmlPages,
        textData: {
          pages: htmlPages.map(p => ({
            pageNumber: p.pageNumber,
            text: p.text,
            textBlocks: p.textBlocks,
            charCount: p.charCount,
            width: p.width,
            height: p.height
          })),
          totalPages: htmlPages.length,
          metadata: textData.metadata || { title: 'Extracted Document', language: 'en' }
        },
        renderedWidth: 1654,
        renderedHeight: 2339,
        maxWidth: 1654,
        maxHeight: 2339
      };
    } catch (error) {
      console.error('[WordExtraction] Error converting DOCX to images and processing with Gemini:', error);
      throw new Error(`Failed to convert DOCX to images and process with Gemini: ${error.message}`);
    }
  }

  /**
   * OLD METHOD - Kept for fallback or page-by-page processing
   * Convert Word document to HTML pages using AI (page-by-page HTML enhancement)
   */
  static async convertToHtmlPagesWithAIPageByPage(docxFilePath, outputDir, progressCallback = null) {
    const { GeminiService } = await import('./geminiService.js');
    
    try {
      await fs.mkdir(outputDir, { recursive: true });
      
      // Step 1: Get initial HTML from mammoth (for structure)
      console.log('[WordExtraction] Step 1: Converting DOCX to HTML with mammoth...');
      const textData = await this.extractText(docxFilePath);
      const initialHtml = textData.pages.map(p => p.html).join('\n\n');
      
      // Step 2: Split into pages
      const pages = this.splitHtmlIntoPages(initialHtml);
      console.log(`[WordExtraction] Step 2: Split into ${pages.length} pages`);
      
      // Step 3: Send HTML pages directly to Gemini for enhancement (no image rendering needed!)
      console.log('[WordExtraction] Step 3: Sending HTML pages directly to AI for enhancement (faster than image conversion)...');
      
      const htmlPages = [];
      
      for (let i = 0; i < pages.length; i++) {
        const pageHtml = pages[i];
        const pageNumber = i + 1;
        
        try {
          // Step 4: Use Gemini to enhance HTML directly (much faster than image conversion)
          console.log(`[WordExtraction] Step 4: Enhancing page ${pageNumber} HTML with AI...`);
          
          if (progressCallback) {
            await progressCallback(pageNumber, pages.length);
          }
          
          try {
            console.log(`[WordExtraction] Calling GeminiService.convertWordPageHtmlToEnhancedHtml for page ${pageNumber}...`);
            const aiResult = await GeminiService.convertWordPageHtmlToEnhancedHtml(
              pageHtml,
              pageNumber,
              {
                width: 792, // Default US Letter width in points
                height: 612, // Default US Letter height in points
                priority: 1
              }
            );
            console.log(`[WordExtraction] Successfully received AI-enhanced HTML for page ${pageNumber}`);
            
            // Extract text blocks from AI-generated HTML
            const textBlocks = aiResult.textBlocks || [];
            const allText = textBlocks.map(block => block.text).join(' ').trim();
            
            htmlPages.push({
              pageNumber: pageNumber,
              html: aiResult.html,
              text: allText,
              textBlocks: textBlocks,
              charCount: allText.length,
              width: aiResult.width,
              height: aiResult.height,
              pageWidthPoints: aiResult.width,
              pageHeightPoints: aiResult.height
            });
            
            // Yield to event loop after each page
            await new Promise(resolve => setImmediate(resolve));
          } catch (aiError) {
            console.warn(`[WordExtraction] AI conversion failed for page ${pageNumber}, using mammoth HTML:`, aiError.message);
            // Fallback to mammoth HTML
            const textBlocks = this.extractTextBlocksFromHtml(pageHtml, pageNumber);
            const allText = textBlocks.map(block => block.text).join(' ').trim();
            
            htmlPages.push({
              pageNumber: pageNumber,
              html: pageHtml,
              text: allText,
              textBlocks: textBlocks,
              charCount: allText.length,
              width: 792,
              height: 612,
              pageWidthPoints: 792,
              pageHeightPoints: 612
            });
          }
        } catch (pageError) {
          console.error(`[WordExtraction] Error processing page ${pageNumber}:`, pageError.message);
          // Create empty page as fallback
          htmlPages.push({
            pageNumber: pageNumber,
            html: '<div class="page-container"><p>Error loading page</p></div>',
            text: '',
            textBlocks: [],
            charCount: 0,
            width: 792,
            height: 612,
            pageWidthPoints: 792,
            pageHeightPoints: 612
          });
        }
      }
      
      return {
        pages: htmlPages,
        textData: {
          pages: htmlPages.map(p => ({
            pageNumber: p.pageNumber,
            text: p.text,
            textBlocks: p.textBlocks,
            charCount: p.charCount,
            width: p.width,
            height: p.height
          })),
          totalPages: htmlPages.length,
          metadata: textData.metadata
        },
        renderedWidth: 1654,
        renderedHeight: 2339,
        maxWidth: 1654,
        maxHeight: 2339
      };
    } catch (error) {
      console.error('[WordExtraction] Error converting DOCX to HTML pages with AI:', error);
      throw new Error(`Failed to convert DOCX to HTML pages with AI: ${error.message}`);
    }
  }

  /**
   * Get default CSS styles for rendering Word HTML
   * @returns {string} CSS styles
   */
  static getDefaultStyles() {
    return `
      * { box-sizing: border-box; }
      body { margin: 0; padding: 20px; background: white; }
      p { margin: 0.5em 0; }
      h1, h2, h3, h4, h5, h6 { margin: 1em 0 0.5em 0; }
      table { border-collapse: collapse; width: 100%; }
      td, th { padding: 4px; border: 1px solid #ddd; }
      img { max-width: 100%; height: auto; }
    `;
  }
}

