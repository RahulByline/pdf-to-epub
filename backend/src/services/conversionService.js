import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { getEpubOutputDir, getHtmlIntermediateDir } from '../config/fileStorage.js';
import { PdfExtractionService } from './pdfExtractionService.js';
import { GeminiService } from './geminiService.js';
import { JobConcurrencyService } from './jobConcurrencyService.js';

// Note: Full EPUB conversion would require:
// - EPUB generation library (epub-gen or similar)
// - PDF parsing and text extraction
// - Image extraction and processing
// - OCR capabilities (Tesseract.js)
// - Layout analysis
// This is a simplified version that maintains the structure

export class ConversionService {
  static async startConversion(pdfDocumentId) {
    const pdf = await PdfDocumentModel.findById(pdfDocumentId);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + pdfDocumentId);
    }

    const job = await ConversionJobModel.create({
      pdfDocumentId,
      status: 'PENDING',
      currentStep: 'STEP_0_CLASSIFICATION',
      progressPercentage: 0
    });

    // Start async conversion (in a real implementation, use a job queue)
    this.processConversion(job.id).catch(error => {
      console.error('Conversion error:', error);
      ConversionJobModel.update(job.id, {
        status: 'FAILED',
        errorMessage: error.message
      });
    });

    return this.convertToDTO(job);
  }

  static async processConversion(jobId) {
    // Acquire concurrency slot
    await JobConcurrencyService.acquire(jobId);
    
    try {
      // Get conversion job and PDF document
      const job = await ConversionJobModel.findById(jobId);
      if (!job) {
        throw new Error('Conversion job not found');
      }

      const pdf = await PdfDocumentModel.findById(job.pdf_document_id);
      if (!pdf || !pdf.file_path) {
        throw new Error('PDF document not found or file path missing');
      }

      // Resolve and verify PDF file path
      let pdfFilePath = pdf.file_path;
      // If path doesn't exist, try to resolve it relative to uploads directory
      try {
        await fs.access(pdfFilePath);
      } catch (accessError) {
        // Try resolving relative to uploads directory
        const { getUploadDir } = await import('../config/fileStorage.js');
        const uploadDir = getUploadDir();
        const fileName = path.basename(pdfFilePath);
        const resolvedPath = path.join(uploadDir, fileName);
        try {
          await fs.access(resolvedPath);
          pdfFilePath = resolvedPath;
          console.log(`[Job ${jobId}] Resolved PDF path: ${pdfFilePath}`);
        } catch (resolvedError) {
          throw new Error(`PDF file not found at ${pdf.file_path} or ${resolvedPath}`);
        }
      }

      const steps = [
        { step: 'STEP_0_CLASSIFICATION', progress: 5 },
        { step: 'STEP_1_TEXT_EXTRACTION', progress: 15 },
        { step: 'STEP_2_LAYOUT_ANALYSIS', progress: 30 },
        { step: 'STEP_3_SEMANTIC_STRUCTURING', progress: 45 },
        { step: 'STEP_4_ACCESSIBILITY', progress: 60 },
        { step: 'STEP_5_CONTENT_CLEANUP', progress: 75 },
        { step: 'STEP_6_SPECIAL_CONTENT', progress: 85 },
        { step: 'STEP_7_EPUB_GENERATION', progress: 95 },
        { step: 'STEP_8_QA_REVIEW', progress: 100 }
      ];

      await ConversionJobModel.update(jobId, {
        status: 'IN_PROGRESS',
        currentStep: steps[0].step,
        progressPercentage: steps[0].progress
      });

      // STEP 1: Extract text from PDF
      await ConversionJobModel.update(jobId, {
        currentStep: steps[1].step,
        progressPercentage: steps[1].progress
      });

      console.log(`[Job ${jobId}] Extracting text from PDF: ${pdfFilePath}`);

      // Prefer Gemini-based extraction when enabled; fallback to local extraction.
      let textData = null;
      const useGeminiExtraction = (process.env.GEMINI_TEXT_EXTRACTION || '').toLowerCase() === 'true';
      if (useGeminiExtraction) {
        try {
          textData = await GeminiService.extractTextFromPdf(pdfFilePath);
          if (textData) {
            console.log(`[Job ${jobId}] Extracted text via Gemini (${textData.totalPages} pages)`);
          } else {
            console.warn(`[Job ${jobId}] Gemini extraction returned no data, falling back to local parser`);
          }
        } catch (aiError) {
          console.warn(`[Job ${jobId}] Gemini extraction failed, falling back to local parser: ${aiError.message}`);
          textData = null;
        }
      }

      if (!textData) {
        textData = await PdfExtractionService.extractText(pdfFilePath);
        console.log(`[Job ${jobId}] Extracted text via local parser (${textData.totalPages} pages)`);
      }

      // STEP 2-3: Structure content using Gemini (if available)
      await ConversionJobModel.update(jobId, {
        currentStep: steps[2].step,
        progressPercentage: steps[2].progress
      });

      let structuredContent;
      try {
        structuredContent = await GeminiService.structureContent(textData.pages);
        console.log(`[Job ${jobId}] Content structured using Gemini`);
      } catch (error) {
        if (error.message?.includes('QUOTA_EXHAUSTED')) {
          console.warn(`[Job ${jobId}] Gemini quota exhausted (daily limit reached). Continuing without AI structuring.`);
        } else {
          console.warn(`[Job ${jobId}] Gemini structuring failed, using default structure:`, error.message);
        }
        structuredContent = { pages: textData.pages, structured: null };
      }

      // STEP 4-5: Clean content
      await ConversionJobModel.update(jobId, {
        currentStep: steps[4].step,
        progressPercentage: steps[4].progress
      });

      // STEP 6: Render PDF pages as images (fixed-layout approach)
      await ConversionJobModel.update(jobId, {
        currentStep: steps[5].step,
        progressPercentage: steps[5].progress
      });

      const htmlIntermediateDir = getHtmlIntermediateDir();
      const jobImagesDir = path.join(htmlIntermediateDir, `job_${jobId}`);
      await fs.mkdir(jobImagesDir, { recursive: true }).catch(() => {});

      console.log(`[Job ${jobId}] Rendering PDF pages as images (fixed-layout)...`);
      const pageImagesData = await PdfExtractionService.renderPagesAsImages(pdfFilePath, jobImagesDir);
      console.log(`[Job ${jobId}] Rendered ${pageImagesData.images.length} page images`);

      // STEP 7: Generate EPUB
      await ConversionJobModel.update(jobId, {
        currentStep: steps[6].step,
        progressPercentage: steps[6].progress
      });

      // Generate EPUB file with actual content
      const epubOutputDir = getEpubOutputDir();
      const epubFileName = `converted_${jobId}.epub`;
      const epubFilePath = path.join(epubOutputDir, epubFileName);

      await fs.mkdir(epubOutputDir, { recursive: true }).catch(() => {});

      console.log(`[Job ${jobId}] Generating EPUB file (fixed-layout, one page per file)...`);
      const epubBuffer = await this.generateFixedLayoutEpub(
        jobId,
        textData,
        structuredContent,
        pageImagesData,
        pdf.original_file_name || `Document ${jobId}`
      );

      await fs.writeFile(epubFilePath, epubBuffer);
      console.log(`[Job ${jobId}] EPUB file generated: ${epubFilePath}`);

      // STEP 8: Mark as completed
      await ConversionJobModel.update(jobId, {
        status: 'COMPLETED',
        currentStep: steps[8].step,
        progressPercentage: steps[8].progress,
        epubFilePath,
        completedAt: new Date()
      });

      // Cleanup temporary images directory
      try {
        await fs.rm(jobImagesDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(`[Job ${jobId}] Could not cleanup temp images directory:`, cleanupError.message);
      }

    } catch (error) {
      console.error(`[Job ${jobId}] Conversion error:`, error);
      await ConversionJobModel.update(jobId, {
        status: 'FAILED',
        errorMessage: error.message
      });
      throw error;
    } finally {
      // Always release concurrency slot
      JobConcurrencyService.release(jobId);
    }
  }

  /**
   * Generate fixed-layout EPUB file (one XHTML file per page, like epub_app)
   * Preserves PDF structure exactly
   */
  static async generateFixedLayoutEpub(jobId, textData, structuredContent, pageImagesData, documentTitle) {
    // Load audio syncs for this job if they exist
    const { AudioSyncModel } = await import('../models/AudioSync.js');
    const audioSyncs = await AudioSyncModel.findByJobId(jobId).catch(() => []);
    
    const zip = new JSZip();
    
    // mimetype must be first and uncompressed
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    
    // META-INF/container.xml
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    zip.file('META-INF/container.xml', containerXml);
    
    const docTitle = this.escapeHtml(
      structuredContent?.structured?.title || 
      textData.metadata?.title || 
      documentTitle || 
      `Converted Document ${jobId}`
    );
    
    const pageImages = pageImagesData.images || [];
    const renderedWidth = pageImagesData.renderedWidth || 0;
    const renderedHeight = pageImagesData.renderedHeight || 0;
    const pageWidthPoints = pageImagesData.maxWidth || 612.0;
    const pageHeightPoints = pageImagesData.maxHeight || 792.0;
    
    // Generate one XHTML file per page (fixed-layout)
    const manifestItems = [];
    const spineItems = [];
    const tocItems = [];
    
    for (let i = 0; i < textData.pages.length; i++) {
      const page = textData.pages[i];
      const pageNum = page.pageNumber;
      const pageImage = pageImages.find(img => img.pageNumber === pageNum);
      
      const fileName = `page_${pageNum}.xhtml`;
      
      // Use actual page dimensions for this specific page (not max dimensions)
      const actualPageWidthPoints = page.width || pageWidthPoints;
      const actualPageHeightPoints = page.height || pageHeightPoints;
      
      // Calculate rendered dimensions for this specific page at 300 DPI
      const dpi = 300;
      const scale = dpi / 72;
      const actualRenderedWidth = Math.ceil(actualPageWidthPoints * scale);
      const actualRenderedHeight = Math.ceil(actualPageHeightPoints * scale);
      
      const pageXhtml = this.generateFixedLayoutPageXHTML(
        page,
        pageImage,
        pageNum,
        actualPageWidthPoints,
        actualPageHeightPoints,
        actualRenderedWidth,
        actualRenderedHeight
      );
      
      zip.file(`OEBPS/${fileName}`, pageXhtml);
      
      const itemId = `page-${pageNum}`;
      // Check if this page has a SMIL file (for audio sync)
      const hasSmil = audioSyncs && audioSyncs.some(s => (s.pageNumber || s.page_number) === pageNum);
      const smilRef = hasSmil ? ` media-overlay="page_${pageNum}.smil"` : '';
      manifestItems.push(`<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml" properties="svg"${smilRef}/>`);
      spineItems.push(`<itemref idref="${itemId}"/>`);
      tocItems.push(`<li><a href="${fileName}">Page ${pageNum}</a></li>`);
    }
    
    // Add page images to manifest and zip
    // Create images directory structure
    for (const img of pageImages) {
      try {
        const imageData = await fs.readFile(img.path);
        // Use image/ directory for EPUB structure
        const imageFileName = img.fileName.replace(/^image\//, ''); // Remove existing image/ prefix if any
        const imagePath = `image/${imageFileName}`;
        zip.file(`OEBPS/${imagePath}`, imageData);
        
        const imageId = `img-page-${img.pageNumber}`;
        manifestItems.push(`<item id="${imageId}" href="${imagePath}" media-type="image/png"/>`);
        
        // Update pageImage object for XHTML generation
        img.epubPath = imagePath;
      } catch (imgError) {
        console.warn(`[Job ${jobId}] Could not add page image ${img.fileName}:`, imgError.message);
      }
    }
    
    // Generate fixed-layout CSS (ensure CSS directory exists in manifest)
    const cssContent = this.generateFixedLayoutCSS(pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight);
    zip.file('OEBPS/css/fixed-layout.css', cssContent);
    manifestItems.push(`<item id="css-fixed-layout" href="css/fixed-layout.css" media-type="text/css"/>`);
    
    // Ensure nav is in manifest before generating OPF
    if (!manifestItems.some(item => item.includes('id="nav"'))) {
      manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
    }
    
    // Handle audio and SMIL files if audio syncs exist
    let audioFileName = null;
    const smilFileNames = [];
    if (audioSyncs && audioSyncs.length > 0) {
      // Get the audio file path from the first sync (they should all use the same file)
      const firstSync = audioSyncs[0];
      // Try both camelCase and snake_case property names
      const audioFilePath = firstSync.audioFilePath || firstSync.audio_file_path;
      
      if (audioFilePath) {
        try {
          // Check if audio file exists
          await fs.access(audioFilePath);
          const audioData = await fs.readFile(audioFilePath);
          const audioExt = path.extname(audioFilePath) || '.mp3';
          audioFileName = `audio/audio_${jobId}${audioExt}`;
          zip.file(`OEBPS/${audioFileName}`, audioData);
          
          // Determine audio MIME type
          let audioMimeType = 'audio/mpeg'; // Default to MP3
          if (audioExt === '.wav') audioMimeType = 'audio/wav';
          else if (audioExt === '.ogg') audioMimeType = 'audio/ogg';
          else if (audioExt === '.m4a') audioMimeType = 'audio/mp4';
          
          manifestItems.push(`<item id="audio" href="${audioFileName}" media-type="${audioMimeType}"/>`);
          
          // Generate SMIL files for each page
          const syncsByPage = {};
          for (const sync of audioSyncs) {
            const pageNum = sync.pageNumber || sync.page_number;
            if (!syncsByPage[pageNum]) {
              syncsByPage[pageNum] = [];
            }
            syncsByPage[pageNum].push(sync);
          }
          
          for (const pageNum in syncsByPage) {
            const pageSyncs = syncsByPage[pageNum];
            const smilFileName = `page_${pageNum}.smil`;
            const smilContent = this.generateSMILContent(parseInt(pageNum), pageSyncs, audioFileName, textData);
            zip.file(`OEBPS/${smilFileName}`, smilContent);
            smilFileNames.push(smilFileName);
            manifestItems.push(`<item id="smil-page-${pageNum}" href="${smilFileName}" media-type="application/smil+xml"/>`);
          }
          
          console.log(`[Job ${jobId}] Added audio file and ${smilFileNames.length} SMIL files`);
        } catch (audioError) {
          console.warn(`[Job ${jobId}] Could not add audio file:`, audioError.message);
          console.warn(`[Job ${jobId}] Audio file path was: ${audioFilePath}`);
        }
      } else {
        console.warn(`[Job ${jobId}] Audio syncs exist but no audioFilePath found. First sync:`, JSON.stringify(firstSync, null, 2));
      }
    } else {
      console.log(`[Job ${jobId}] No audio syncs found - EPUB will be generated without audio`);
    }
    
    // Generate content.opf with fixed-layout metadata
    const contentOpf = this.generateFixedLayoutContentOpf(
      jobId,
      docTitle,
      manifestItems,
      spineItems,
      pageWidthPoints,
      pageHeightPoints,
      renderedWidth,
      renderedHeight,
      smilFileNames
    );
    zip.file('OEBPS/content.opf', contentOpf);
    
    // Generate nav.xhtml
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Navigation</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
      ${tocItems.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
    zip.file('OEBPS/nav.xhtml', navXhtml);
    
    // Generate EPUB buffer
    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      streamFiles: false
    });
  }
  
  /**
   * Generate fixed-layout page XHTML (one page per file, like epub_app)
   */
  static generateFixedLayoutPageXHTML(page, pageImage, pageNumber, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight) {
    let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>`;
    
    if (renderedWidth > 0 && renderedHeight > 0) {
      html += `
  <meta name="viewport" content="width=${renderedWidth}px, height=${renderedHeight}px, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>`;
    }
    
    html += `
  <title>Page ${pageNumber}</title>
  <link rel="stylesheet" type="text/css" href="css/fixed-layout.css"/>
</head>
<body class="fixed-layout-page" epub:type="pagebreak">
  <div class="page-container" id="page-${pageNumber}">`;
    
      // Page image (decorative, hidden from screen readers)
      if (pageImage) {
        // Use epubPath if available, otherwise construct from fileName
        const imagePath = pageImage.epubPath || `image/${pageImage.fileName.replace(/^image\//, '')}`;
        html += `
    <img src="${this.escapeHtml(imagePath)}" alt="" class="page-image" aria-hidden="true"/>`;
      }
    
    // Text content for accessibility (overlay on image)
    html += `
    <div class="text-content" role="article" aria-label="Page ${pageNumber} content">`;
    
    // Add text blocks in reading order
    const textBlocks = page.textBlocks || [];
    // Sort by reading order if available, otherwise by Y position (top to bottom)
    const sortedBlocks = [...textBlocks].sort((a, b) => {
      const yA = a.boundingBox?.y || 0;
      const yB = b.boundingBox?.y || 0;
      // Higher Y = top of page, so reverse order
      return yB - yA;
    });
    
    for (const block of sortedBlocks) {
      const blockHtml = this.convertTextBlockToHTML(block, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight);
      if (blockHtml) {
        html += '\n      ' + blockHtml;
      }
    }
    
    html += `
    </div>
  </div>
</body>
</html>`;
    
    return html;
  }
  
  /**
   * Convert text block to HTML with absolute positioning
   * Matches Java version exactly: uses percentages based on PDF point dimensions
   */
  static convertTextBlockToHTML(block, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight) {
    if (!block.text || block.text.trim().length === 0) {
      return '';
    }
    
    const text = this.escapeHtml(block.text.trim());
    const blockId = block.id || `block_${block.pageNumber || 0}_0`;
    
    // Calculate position (convert from PDF coordinates to HTML)
    // PDF coordinates: origin at bottom-left, Y increases upward
    // HTML coordinates: origin at top-left, Y increases downward
    let positionStyle = '';
    if (block.boundingBox && pageWidthPoints > 0 && pageHeightPoints > 0) {
      const bbox = block.boundingBox;
      const pdfX = bbox.x || 0;
      const pdfY = bbox.y || 0; // Y coordinate (from bottom in PDF)
      const pdfWidth = bbox.width || 0;
      const pdfHeight = bbox.height || 0;
      
      // Convert Y from bottom to top (PDF to HTML coordinate system)
      // Java version tries both and picks the one that makes sense
      // In PDF: y=0 is at bottom, y increases upward
      // bbox.y is the BOTTOM Y coordinate (minY in the group)
      // To get HTML top: htmlTop = pageHeight - (bottomY + height)
      const htmlTopFromBottom = pageHeightPoints - pdfY - pdfHeight;
      const htmlTopFromTop = pdfY; // Alternative: Y might be from top
      
      // Use the conversion that makes sense (should be between 0 and pageHeight)
      let htmlTop;
      if (htmlTopFromBottom >= 0 && htmlTopFromBottom <= pageHeightPoints) {
        // Conversion from bottom makes sense (most common case)
        htmlTop = htmlTopFromBottom;
      } else if (htmlTopFromTop >= 0 && htmlTopFromTop <= pageHeightPoints) {
        // Y might be from top instead
        htmlTop = htmlTopFromTop;
      } else {
        // Both failed, use bottom conversion and clamp
        htmlTop = Math.max(0, Math.min(pageHeightPoints, htmlTopFromBottom));
      }
      
      // Use percentage based on PDF point dimensions (like Java version)
      // This ensures the text scales proportionally with the rendered image
      let leftPercent = (pdfX / pageWidthPoints) * 100.0;
      let topPercent = (htmlTop / pageHeightPoints) * 100.0;
      let widthPercent = (pdfWidth / pageWidthPoints) * 100.0;
      let heightPercent = (pdfHeight / pageHeightPoints) * 100.0;
      
      // Ensure values are within valid range
      leftPercent = Math.max(0, Math.min(100, leftPercent));
      topPercent = Math.max(0, Math.min(100, topPercent));
      widthPercent = Math.max(0, Math.min(100 - leftPercent, widthPercent));
      heightPercent = Math.max(0, Math.min(100 - topPercent, heightPercent));
      
      // Add font size if available (convert from points to percentage)
      let fontSizeStyle = '';
      if (block.fontSize && block.fontSize > 0) {
        const fontSizePercent = (block.fontSize / pageHeightPoints) * 100.0;
        fontSizeStyle = ` font-size: ${fontSizePercent.toFixed(2)}%;`;
      }
      
      positionStyle = ` style="position: absolute; left: ${leftPercent.toFixed(4)}%; top: ${topPercent.toFixed(4)}%; width: ${widthPercent.toFixed(4)}%; height: ${heightPercent.toFixed(4)}%;${fontSizeStyle}"`;
    }
    
    // Determine HTML tag based on block type
    const type = block.type || 'paragraph';
    const level = block.level || 2;
    
    // Add epub:type for media overlay support (for SMIL synchronization)
    const epubType = type === 'heading' ? ' epub:type="title"' : '';
    
    if (type === 'heading') {
      const hLevel = Math.max(1, Math.min(6, level));
      return `<h${hLevel} id="${this.escapeHtml(blockId)}"${epubType}${positionStyle}>${text}</h${hLevel}>`;
    } else if (type === 'list-item') {
      return `<p id="${this.escapeHtml(blockId)}" class="list-item"${epubType}${positionStyle}>${text}</p>`;
    } else {
      return `<p id="${this.escapeHtml(blockId)}"${epubType}${positionStyle}>${text}</p>`;
    }
  }
  
  /**
   * Generate fixed-layout CSS
   */
  static generateFixedLayoutCSS(pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight) {
    const width = renderedWidth > 0 ? `${renderedWidth}px` : '100vw';
    const height = renderedHeight > 0 ? `${renderedHeight}px` : '100vh';
    
    return `/* Fixed Layout EPUB Styles - Full Screen Constant Display */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  width: ${width};
  height: ${height};
  overflow: hidden;
  position: fixed;
  top: 0;
  left: 0;
}

.fixed-layout-page {
  margin: 0;
  padding: 0;
  overflow: hidden;
  width: ${width};
  height: ${height};
  position: fixed;
  top: 0;
  left: 0;
  display: block;
}

.page-container {
  position: relative;
  width: ${width};
  height: ${height};
  margin: 0;
  padding: 0;
  overflow: hidden;
  display: block;
  background-color: white;
}

.page-image {
  width: ${width};
  height: ${height};
  object-fit: contain;
  object-position: top left;
  display: block;
  margin: 0;
  padding: 0;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
}

.text-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none; /* Allow clicking through to image */
}

.text-content p,
.text-content h1,
.text-content h2,
.text-content h3,
.text-content h4,
.text-content h5,
.text-content h6 {
  color: transparent; /* Make text transparent - only highlight shows (like Kitaboo) */
  background: transparent;
  margin: 0;
  padding: 0;
  pointer-events: auto; /* Allow text selection */
  user-select: text;
  -webkit-user-select: text;
  font-size: inherit;
  line-height: 1.2;
  transition: background-color 0.1s ease;
}

/* Yellow highlight when text is being read (active audio sync) - like Kitaboo */
.text-content p.epub-media-overlay-active,
.text-content h1.epub-media-overlay-active,
.text-content h2.epub-media-overlay-active,
.text-content h3.epub-media-overlay-active,
.text-content h4.epub-media-overlay-active,
.text-content h5.epub-media-overlay-active,
.text-content h6.epub-media-overlay-active {
  background-color: rgba(255, 255, 0, 0.6) !important; /* Bright yellow highlight */
  color: transparent;
  transition: background-color 0.1s ease;
}

.text-content p::selection,
.text-content h1::selection,
.text-content h2::selection,
.text-content h3::selection {
  background: rgba(255, 255, 0, 0.5); /* Yellow highlight for selection */
  color: transparent;
}`;
  }
  
  /**
   * Generate fixed-layout content.opf
   */
  static generateFixedLayoutContentOpf(jobId, docTitle, manifestItems, spineItems, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, smilFileNames = []) {
    const viewport = renderedWidth > 0 && renderedHeight > 0 
      ? `${renderedWidth}x${renderedHeight}` 
      : 'device-widthxdevice-height';
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">conversion-job-${jobId}</dc:identifier>
    <dc:title>${docTitle}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>PDF to EPUB Converter</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:viewport">width=${renderedWidth || 1200},height=${renderedHeight || 1600}</meta>
    ${smilFileNames.length > 0 ? '<meta property="media:active-class">epub-media-overlay-active</meta>' : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="nav">
    <itemref idref="nav" linear="no"/>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  }

  /**
   * Generate EPUB file from extracted content (legacy method - kept for compatibility)
   */
  static async generateEpubFromContent(jobId, textData, structuredContent, images, documentTitle) {
    const zip = new JSZip();
    
    // mimetype must be first and uncompressed
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    
    // META-INF/container.xml
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    zip.file('META-INF/container.xml', containerXml);
    
    // Prepare chapters from structured content or default to pages
    const chapters = structuredContent?.structured?.chapters || null;
    const docTitle = this.escapeHtml(
      structuredContent?.structured?.title || 
      textData.metadata?.title || 
      documentTitle || 
      `Converted Document ${jobId}`
    );
    
    // Generate XHTML chapters
    const manifestItems = [];
    const spineItems = [];
    const tocItems = [];
    
    if (chapters && chapters.length > 0) {
      // Use structured chapters
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const chapterId = `chapter-${i + 1}`;
        const fileName = `${chapterId}.xhtml`;
        
        // Get text for this chapter from pages
        const chapterPages = textData.pages.filter(p => 
          p.pageNumber >= chapter.startPage && p.pageNumber <= chapter.endPage
        );
        
        // Find images for this chapter's pages
        const chapterImages = images.filter(img => 
          img.pageNumber >= chapter.startPage && img.pageNumber <= chapter.endPage
        );
        
        const chapterText = chapterPages.map(p => {
          // Find images on this page
          const pageImages = chapterImages.filter(img => img.pageNumber === p.pageNumber);
          let imageHtml = '';
          if (pageImages.length > 0) {
            imageHtml = pageImages.map(img => 
              `<img src="images/${img.fileName}" alt="Image from page ${p.pageNumber}" style="max-width: 100%; height: auto;"/>`
            ).join('\n  ');
          }
          
          // Escape HTML and format paragraphs
          const escapedText = this.escapeHtml(p.text);
          const paragraphs = escapedText.split(/\n\s*\n/).filter(l => l.trim());
          const paraHtml = paragraphs.map(para => `<p>${para.replace(/\n/g, ' ')}</p>`).join('\n  ');
          
          return `${imageHtml ? imageHtml + '\n  ' : ''}${paraHtml}`;
        }).join('\n  ');
        
        const chapterTitle = this.escapeHtml(chapter.title);
        const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${chapterTitle}</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <h1>${chapterTitle}</h1>
  ${chapterText}
</body>
</html>`;
        
        zip.file(`OEBPS/${fileName}`, chapterXhtml);
        manifestItems.push(`<item id="${chapterId}" href="${fileName}" media-type="application/xhtml+xml"/>`);
        spineItems.push(`<itemref idref="${chapterId}"/>`);
        tocItems.push(`<li><a href="${fileName}">${this.escapeHtml(chapter.title)}</a></li>`);
      }
    } else {
      // Fallback: Create one chapter per page or group pages
      const pagesPerChapter = 5; // Group 5 pages per chapter
      let chapterNum = 1;
      
      for (let i = 0; i < textData.pages.length; i += pagesPerChapter) {
        const pageGroup = textData.pages.slice(i, i + pagesPerChapter);
        const chapterId = `chapter-${chapterNum}`;
        const fileName = `${chapterId}.xhtml`;
        const chapterTitle = `Chapter ${chapterNum}`;
        
        const chapterText = pageGroup.map(page => {
          // Find images on this page
          const pageImages = images.filter(img => img.pageNumber === page.pageNumber);
          let imageHtml = '';
          if (pageImages.length > 0) {
            imageHtml = pageImages.map(img => 
              `<img src="images/${img.fileName}" alt="Image from page ${page.pageNumber}" style="max-width: 100%; height: auto;"/>`
            ).join('\n    ');
          }
          
          // Clean and escape HTML
          let cleanText = page.text || '';
          // Remove null characters first
          cleanText = cleanText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
          const escapedText = this.escapeHtml(cleanText);
          const paragraphs = escapedText.split(/\n\s*\n/).filter(l => l.trim());
          const paraHtml = paragraphs.map(para => `<p>${para.replace(/\n/g, ' ')}</p>`).join('\n    ');
          
          return `<h2>Page ${page.pageNumber}</h2>\n    ${imageHtml ? imageHtml + '\n    ' : ''}${paraHtml}`;
        }).join('\n  ');
        
        const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${chapterTitle}</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <h1>${chapterTitle}</h1>
  ${chapterText}
</body>
</html>`;
        
        zip.file(`OEBPS/${fileName}`, chapterXhtml);
        manifestItems.push(`<item id="${chapterId}" href="${fileName}" media-type="application/xhtml+xml"/>`);
        spineItems.push(`<itemref idref="${chapterId}"/>`);
        tocItems.push(`<li><a href="${fileName}">${chapterTitle}</a></li>`);
        
        chapterNum++;
      }
    }
    
    // Add images to manifest and zip
    if (images.length > 0) {
      // Create images directory placeholder (needed for proper EPUB structure)
      zip.file('OEBPS/images/.gitkeep', '');
      
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        try {
          if (await fs.access(img.path).then(() => true).catch(() => false)) {
            const imageData = await fs.readFile(img.path);
            zip.file(`OEBPS/images/${img.fileName}`, imageData);
            
            const mediaType = img.format === 'jpg' ? 'image/jpeg' : 
                             img.format === 'png' ? 'image/png' : 
                             `image/${img.format}`;
            manifestItems.push(`<item id="img-${i}" href="images/${img.fileName}" media-type="${mediaType}"/>`);
          }
        } catch (imgError) {
          console.warn(`[Job ${jobId}] Could not add image ${img.fileName}:`, imgError.message);
        }
      }
    }
    
    // Generate content.opf
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">conversion-job-${jobId}</dc:identifier>
    <dc:title>${docTitle}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>PDF to EPUB Converter</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="nav">
    <itemref idref="nav" linear="no"/>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
    zip.file('OEBPS/content.opf', contentOpf);
    
    // Generate nav.xhtml
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Navigation</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
      ${tocItems.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
    zip.file('OEBPS/nav.xhtml', navXhtml);
    
    // Generate EPUB buffer
    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      streamFiles: false
    });
  }

  static async getConversionJob(jobId) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }
    return this.convertToDTO(job);
  }

  static async getConversionsByPdf(pdfDocumentId) {
    const jobs = await ConversionJobModel.findByPdfDocumentId(pdfDocumentId);
    return jobs.map(job => this.convertToDTO(job));
  }

  static async getConversionsByStatus(status) {
    const jobs = await ConversionJobModel.findByStatus(status);
    return jobs.map(job => this.convertToDTO(job));
  }

  static async getReviewRequired() {
    const jobs = await ConversionJobModel.findByRequiresReview();
    return jobs.map(job => this.convertToDTO(job));
  }

  static async updateJobStatus(jobId, updates) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }
    
    const updatedJob = await ConversionJobModel.update(jobId, updates);
    return this.convertToDTO(updatedJob);
  }

  static async deleteConversionJob(jobId) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }

    // Delete EPUB file if exists
    if (job.epub_file_path) {
      try {
        await fs.unlink(job.epub_file_path);
      } catch (error) {
        console.error('Error deleting EPUB file:', error);
      }
    }

    await ConversionJobModel.delete(jobId);
  }

  /**
   * Escape HTML special characters and remove invalid XML characters
   */
  static escapeHtml(text) {
    if (!text) return '';
    return String(text)
      // Remove null characters and other invalid XML characters (0x0-0x8, 0xB-0xC, 0xE-0x1F)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static convertToDTO(job) {
    return {
      id: job.id,
      pdfDocumentId: job.pdf_document_id,
      status: job.status,
      currentStep: job.current_step,
      progressPercentage: job.progress_percentage,
      epubFilePath: job.epub_file_path,
      errorMessage: job.error_message,
      confidenceScore: job.confidence_score,
      requiresReview: job.requires_review,
      reviewedBy: job.reviewed_by,
      reviewedAt: job.reviewed_at,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at
    };
  }
}

