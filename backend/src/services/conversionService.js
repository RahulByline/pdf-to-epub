import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { getEpubOutputDir, getHtmlIntermediateDir } from '../config/fileStorage.js';
import { PdfExtractionService } from './pdfExtractionService.js';
import { GeminiService } from './geminiService.js';
import { JobConcurrencyService } from './jobConcurrencyService.js';
import { TextBasedConversionPipeline } from './textBasedConversionPipeline.js';
// TtsService and mapTimingsToBlocks removed - using player's built-in TTS instead of generating audio files

export class ConversionService {
  /**
   * Convert PDF to EPUB by converting each page to PNG and processing through Gemini for XHTML
   * @param {string} jobId - Conversion job ID
   * @param {string} pdfFilePath - Path to PDF file
   * @param {Array} steps - Conversion steps array
   * @returns {Promise<{epubPath: string}>} EPUB file path
   */
  static async convertPdfToXhtmlViaPng(jobId, pdfFilePath, steps) {
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const epubOutputDir = getEpubOutputDir();
    
    // Create job-specific directories
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    const jobPngDir = path.join(htmlIntermediateDir, `job_${jobId}_png`);
    await fs.mkdir(jobHtmlDir, { recursive: true });
    await fs.mkdir(jobPngDir, { recursive: true });

    // Step 1: Convert PDF pages to PNG images
    await ConversionJobModel.update(jobId, {
      currentStep: steps[1].step,
      progressPercentage: steps[1].progress
    });

    console.log(`[Job ${jobId}] Converting PDF pages to PNG images...`);
    const renderResult = await PdfExtractionService.renderPagesAsImages(pdfFilePath, jobPngDir);
    const pageImages = renderResult?.images || renderResult || [];
    
    if (!Array.isArray(pageImages) || pageImages.length === 0) {
      throw new Error('Failed to convert PDF pages to PNG images');
    }

    console.log(`[Job ${jobId}] Converted ${pageImages.length} pages to PNG`);

    // Step 2: Process each PNG through Gemini to get XHTML and CSS
    await ConversionJobModel.update(jobId, {
      currentStep: steps[2].step,
      progressPercentage: steps[2].progress
    });

    // Fixed-layout flag and page dimensions from rendered images
    const useFixedLayout = (process.env.USE_FIXED_LAYOUT_EPUB || 'false').toLowerCase() === 'true';
    // Get page dimensions from rendered images (use first page as reference, or max dimensions)
    const firstPageImage = pageImages[0];
    const pageWidthPoints = firstPageImage?.pageWidth || renderResult?.maxWidth || 612;
    const pageHeightPoints = firstPageImage?.pageHeight || renderResult?.maxHeight || 792;
    const renderedWidth = firstPageImage?.width || renderResult?.renderedWidth || Math.ceil(pageWidthPoints * (200 / 72));
    const renderedHeight = firstPageImage?.height || renderResult?.renderedHeight || Math.ceil(pageHeightPoints * (200 / 72));
    
    const xhtmlPages = [];
    
    for (let i = 0; i < pageImages.length; i++) {
      const pageImage = pageImages[i];
      const progress = steps[2].progress + Math.floor((steps[3].progress - steps[2].progress) * (i + 1) / pageImages.length);
      
      await ConversionJobModel.update(jobId, {
        currentStep: steps[2].step,
        progressPercentage: progress
      });

      console.log(`[Job ${jobId}] Processing page ${pageImage.pageNumber}/${pageImages.length} through Gemini...`);
      
      const xhtmlResult = await GeminiService.convertPngToXhtml(pageImage.path, pageImage.pageNumber);
      
      if (xhtmlResult && xhtmlResult.xhtml && (xhtmlResult.css !== undefined)) {
        // Save XHTML file
        const xhtmlFileName = `page_${pageImage.pageNumber}.xhtml`;
        const xhtmlFilePath = path.join(jobHtmlDir, xhtmlFileName);
        
        // Get page-specific dimensions
        const currentPageWidth = pageImage.pageWidth || pageWidthPoints;
        const currentPageHeight = pageImage.pageHeight || pageHeightPoints;
        const currentRenderedWidth = pageImage.width || renderedWidth;
        const currentRenderedHeight = pageImage.height || renderedHeight;
        
        // Embed CSS in the XHTML if not already present and sanitize common XML issues
        let xhtmlContent = xhtmlResult.xhtml;
        
        // First, unescape any escaped characters that might have come from JSON parsing
        // Handle double-escaped backslashes (\\\\ -> \)
        xhtmlContent = xhtmlContent.replace(/\\\\/g, '\\');
        // Unescape quotes and control characters
        xhtmlContent = xhtmlContent.replace(/\\"/g, '"');
        xhtmlContent = xhtmlContent.replace(/\\'/g, "'");
        xhtmlContent = xhtmlContent.replace(/\\n/g, '\n');
        xhtmlContent = xhtmlContent.replace(/\\r/g, '\r');
        xhtmlContent = xhtmlContent.replace(/\\t/g, '\t');
        
        // Normalize DOCTYPE declaration - fix malformed quotes and ensure proper format
        // Replace any DOCTYPE with properly formatted one using straight double quotes
        const correctDoctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
        xhtmlContent = xhtmlContent.replace(
          /<!DOCTYPE\s+html[^>]*>/i,
          correctDoctype
        );
        
        // Fix common DOCTYPE URL typo from Gemini (in case it's in the content elsewhere)
        xhtmlContent = xhtmlContent.replace(
          /http:\/\/www\.w3\.org\/TR\/xhtml\/DTD\/xhtml1-strict\.dtd/gi,
          'http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd'
        );
        
        // Escape bare ampersands that are not part of an entity, to avoid xmlParseEntityRef errors
        xhtmlContent = xhtmlContent.replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;');
        
        // Add viewport meta tag for fixed-layout (must be before other meta tags)
        const viewportMeta = useFixedLayout
          ? `<meta name="viewport" content="width=${currentPageWidth},height=${currentPageHeight}"/>`
          : `<meta name="viewport" content="width=device-width, initial-scale=1.0"/>`;
        
        // Check if XHTML already has a <style> tag with CSS
        const hasStyleTag = xhtmlContent.includes('<style');
        const hasLinkTag = xhtmlContent.includes('<link');
        
        // Only inject CSS if there's no style tag AND there's actual CSS content to inject
        if (!hasStyleTag && !hasLinkTag && xhtmlResult.css && xhtmlResult.css.trim()) {
          // Insert CSS before </head> or at the beginning of <body>
          if (xhtmlContent.includes('</head>')) {
            xhtmlContent = xhtmlContent.replace('</head>', `<style type="text/css">\n${xhtmlResult.css}\n</style>\n</head>`);
          } else if (xhtmlContent.includes('<body>')) {
            xhtmlContent = xhtmlContent.replace('<body>', `<head><style type="text/css">\n${xhtmlResult.css}\n</style></head>\n<body>`);
          } else {
            // If no head/body structure, wrap in proper XHTML
            xhtmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
${viewportMeta}
<title>Page ${pageImage.pageNumber}</title>
<style type="text/css">
${xhtmlResult.css}
</style>
</head>
<body>
${xhtmlContent}
</body>
</html>`;
          }
        } else if (!hasStyleTag && !hasLinkTag) {
          // No style tag and no CSS from Gemini - add minimal style block for proper EPUB rendering
          const minimalCss = `/* Minimal styles for EPUB rendering */
body { margin: 0; padding: 0; }
.-epub-media-overlay-active { background-color: #ffff00; }`;
          
          if (xhtmlContent.includes('</head>')) {
            xhtmlContent = xhtmlContent.replace('</head>', `<style type="text/css">\n${minimalCss}\n</style>\n</head>`);
          } else if (xhtmlContent.includes('<body>')) {
            xhtmlContent = xhtmlContent.replace('<body>', `<head><style type="text/css">\n${minimalCss}\n</style></head>\n<body>`);
          }
        }
        
        // Add viewport meta tag if not present
        if (!xhtmlContent.includes('name="viewport"')) {
          if (xhtmlContent.includes('<head>')) {
            xhtmlContent = xhtmlContent.replace('<head>', `<head>\n${viewportMeta}`);
          } else if (xhtmlContent.includes('</head>')) {
            xhtmlContent = xhtmlContent.replace('</head>', `${viewportMeta}\n</head>`);
          }
        } else {
          // Replace existing viewport if fixed-layout
          if (useFixedLayout) {
            xhtmlContent = xhtmlContent.replace(
              /<meta\s+name="viewport"[^>]*\/?>/i,
              viewportMeta
            );
          }
        }

        // Add full-page layout normalization CSS
        const fullPageCss = useFixedLayout
          ? [
              `html, body { margin: 0; padding: 0; width: ${currentPageWidth}px; height: ${currentPageHeight}px; overflow: hidden; }`,
              'body { background-color: #ffffff; position: relative; }',
              '.container, .page { width: 100%; height: 100%; margin: 0; padding: 0; box-sizing: border-box; position: relative; }'
            ].join('\n')
          : [
              'html, body { margin: 0; padding: 0; height: 100%; }',
              'body { background-color: #ffffff; }',
              '.container, .page { width: 100%; max-width: none; margin: 0 auto; box-sizing: border-box; }'
            ].join('\n');
        
        // Add EPUB media overlay active class CSS (for read-aloud highlighting)
        const mediaOverlayCss = `
/* EPUB 3 Media Overlay Active Class - for read-aloud highlighting */
.-epub-media-overlay-active,
.epub-media-overlay-active,
[class*="epub-media-overlay-active"] {
  background-color: rgba(255, 255, 0, 0.5) !important;
  transition: background-color 0.2s ease;
}`;
        
        if (xhtmlContent.includes('</head>')) {
          // Check if style tag exists, if so append to it, otherwise create new one
          if (xhtmlContent.includes('<style')) {
            // Append to existing style tag
            xhtmlContent = xhtmlContent.replace(
              '</style>',
              `${mediaOverlayCss}\n</style>`
            );
            // Also add fullPageCss if not already present
            if (!xhtmlContent.includes('html, body {')) {
              xhtmlContent = xhtmlContent.replace(
                '</style>',
                `\n${fullPageCss}\n</style>`
              );
            }
          } else {
            // Create new style tag
            xhtmlContent = xhtmlContent.replace(
              '</head>',
              `<style type="text/css">\n${fullPageCss}\n${mediaOverlayCss}\n</style>\n</head>`
            );
          }
        }
        
        // CRITICAL: Ensure every text element has a unique ID
        xhtmlContent = this.ensureAllTextElementsHaveIds(xhtmlContent, pageImage.pageNumber);
        
        await fs.writeFile(xhtmlFilePath, xhtmlContent, 'utf8');
        
        xhtmlPages.push({
          pageNumber: pageImage.pageNumber,
          xhtmlPath: xhtmlFilePath,
          xhtmlFileName: xhtmlFileName,
          css: xhtmlResult.css,
          pageWidth: currentPageWidth,
          pageHeight: currentPageHeight,
          renderedWidth: currentRenderedWidth,
          renderedHeight: currentRenderedHeight
        });
        
        console.log(`[Job ${jobId}] Page ${pageImage.pageNumber} converted to XHTML successfully`);
      } else {
        console.warn(`[Job ${jobId}] Failed to convert page ${pageImage.pageNumber} to XHTML, skipping`);
      }
    }

    if (xhtmlPages.length === 0) {
      throw new Error('Failed to convert any pages to XHTML');
    }

    // Step 3: Generate EPUB from XHTML pages
    await ConversionJobModel.update(jobId, {
      currentStep: steps[7].step,
      progressPercentage: steps[7].progress
    });

    console.log(`[Job ${jobId}] Generating EPUB from ${xhtmlPages.length} XHTML pages...`);
    
    const epubPath = await this.generateEpubFromXhtmlPages(
      xhtmlPages,
      epubOutputDir,
      jobId,
      {
        title: `Converted PDF - Job ${jobId}`,
        fixedLayout: useFixedLayout,
        pageWidth: pageWidthPoints,
        pageHeight: pageHeightPoints,
        renderedWidth: renderedWidth,
        renderedHeight: renderedHeight
      }
    );

    return { epubPath };
  }

  /**
   * Generate EPUB file from XHTML pages
   * @param {Array} xhtmlPages - Array of {pageNumber, xhtmlPath, xhtmlFileName, css, pageWidth, pageHeight, renderedWidth, renderedHeight}
   * @param {string} outputDir - Output directory
   * @param {string} jobId - Job ID
   * @param {Object} options - Options {title, fixedLayout, pageWidth, pageHeight, renderedWidth, renderedHeight}
   * @returns {Promise<string>} Path to generated EPUB file
   */
  static async generateEpubFromXhtmlPages(xhtmlPages, outputDir, jobId, options = {}) {
    const useFixedLayout = options.fixedLayout || false;
    const pageWidth = options.pageWidth || 612;
    const pageHeight = options.pageHeight || 792;
    const tempEpubDir = path.join(outputDir, `temp_${jobId}`);
    const oebpsDir = path.join(tempEpubDir, 'OEBPS');
    const metaInfDir = path.join(tempEpubDir, 'META-INF');
    
    // Create directories
    await fs.mkdir(oebpsDir, { recursive: true });
    await fs.mkdir(metaInfDir, { recursive: true });
    
    // Copy XHTML files to OEBPS directory
    const xhtmlFiles = [];
    for (const page of xhtmlPages) {
      const destPath = path.join(oebpsDir, page.xhtmlFileName);
      await fs.copyFile(page.xhtmlPath, destPath);
      xhtmlFiles.push({
        id: `page-${page.pageNumber}`,
        href: `OEBPS/${page.xhtmlFileName}`,
        mediaType: 'application/xhtml+xml'
      });
    }
    
    // Generate OPF file with fixed-layout support
    const fixedLayoutMeta = useFixedLayout
      ? `    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">landscape</meta>
    <meta property="rendition:viewport">width=${pageWidth},height=${pageHeight}</meta>`
      : '';
    
    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"${useFixedLayout ? ' xmlns:rendition="http://www.idpf.org/2013/rendition"' : ''}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${jobId}</dc:identifier>
    <dc:title>${this.escapeXml(options.title || 'Converted PDF')}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
${fixedLayoutMeta}
  </metadata>
  <manifest>
    <item id="nav" href="OEBPS/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${xhtmlFiles.map(f => `    <item id="${f.id}" href="${f.href}" media-type="${f.mediaType}"/>`).join('\n')}
  </manifest>
  <spine toc="nav"${useFixedLayout ? ' page-progression-direction="ltr"' : ''}>
${xhtmlFiles.map(f => `    <itemref idref="${f.id}"/>`).join('\n')}
  </spine>
</package>`;
    
    await fs.writeFile(path.join(tempEpubDir, 'content.opf'), opfContent, 'utf8');
    
    // Generate navigation XHTML
    const navContent = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8"/>
<title>Navigation</title>
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
${xhtmlPages.map((p, i) => `    <li><a href="${p.xhtmlFileName}">Page ${p.pageNumber}</a></li>`).join('\n')}
  </ol>
</nav>
</body>
</html>`;
    
    await fs.writeFile(path.join(oebpsDir, 'nav.xhtml'), navContent, 'utf8');
    
    // Generate container.xml
    const containerContent = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    
    await fs.writeFile(path.join(metaInfDir, 'container.xml'), containerContent, 'utf8');
    
    // Generate mimetype file
    await fs.writeFile(path.join(tempEpubDir, 'mimetype'), 'application/epub+zip', 'utf8');
    
    // Create EPUB ZIP file
    const epubFileName = `converted_${jobId}.epub`;
    const epubPath = path.join(outputDir, epubFileName);
    
    const zip = new JSZip();
    
    // Add mimetype first (must be uncompressed and first file)
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    
    // Add all other files
    const addDirectoryToZip = async (dirPath, zipPath = '') => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const zipEntryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          await addDirectoryToZip(fullPath, zipEntryPath);
        } else {
          // For XHTML files, read as text and sanitize before adding to ZIP
          if (entry.name.endsWith('.xhtml')) {
            let content = await fs.readFile(fullPath, 'utf8');
            // Sanitize XHTML to fix any escaped characters or malformed DOCTYPEs
            // Use the same sanitization logic as in epubService
            content = content.replace(/\\\\/g, '\\');
            content = content.replace(/\\"/g, '"');
            content = content.replace(/\\'/g, "'");
            content = content.replace(/\\n/g, '\n');
            content = content.replace(/\\r/g, '\r');
            content = content.replace(/\\t/g, '\t');
            // Normalize DOCTYPE
            const correctDoctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
            content = content.replace(/<!DOCTYPE\s+html[^>]*>/i, correctDoctype);
            zip.file(zipEntryPath, content);
          } else {
            const content = await fs.readFile(fullPath);
            zip.file(zipEntryPath, content);
          }
        }
      }
    };
    
    await addDirectoryToZip(tempEpubDir);
    
    // Generate EPUB file
    const epubBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });
    
    await fs.writeFile(epubPath, epubBuffer);
    
    // Cleanup temp directory
    await fs.rm(tempEpubDir, { recursive: true, force: true }).catch(() => {});
    
    return epubPath;
  }

  static escapeXml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Ensure every text element in XHTML has a unique ID
   * This is critical for audio sync - every text element must be syncable
   * @param {string} xhtmlContent - XHTML content to process
   * @param {number} pageNumber - Page number for ID prefix
   * @returns {string} - XHTML content with all text elements having unique IDs
   */
  static ensureAllTextElementsHaveIds(xhtmlContent, pageNumber) {
    try {
      // Validate XHTML content before parsing
      if (!xhtmlContent || typeof xhtmlContent !== 'string') {
        console.warn(`[ConversionService] Invalid XHTML content for page ${pageNumber}: not a string`);
        return xhtmlContent;
      }
      
      // Check for basic XHTML structure
      if (!xhtmlContent.includes('<html') && !xhtmlContent.includes('<!DOCTYPE')) {
        console.warn(`[ConversionService] XHTML content for page ${pageNumber} doesn't appear to be valid XHTML`);
        return xhtmlContent;
      }
      
      // Try parsing with error handling
      let dom;
      try {
        dom = new JSDOM(xhtmlContent, { 
          contentType: 'text/xml',
          strict: false, // Be more lenient with parsing
          pretendToBeVisual: false
        });
      } catch (parseError) {
        console.error(`[ConversionService] JSDOM parse error for page ${pageNumber}:`, parseError.message);
        console.error(`[ConversionService] XHTML preview (first 500 chars):`, xhtmlContent.substring(0, 500));
        // Try to fix common issues and retry
        let fixedContent = xhtmlContent;
        // Remove any remaining markdown artifacts
        fixedContent = fixedContent.replace(/^```(?:xml|html|xhtml)?\s*\n?/i, '');
        fixedContent = fixedContent.replace(/\n?```\s*$/i, '');
        // Try again with fixed content
        try {
          dom = new JSDOM(fixedContent, { 
            contentType: 'text/xml',
            strict: false
          });
          console.log(`[ConversionService] Successfully parsed after fixing markdown artifacts`);
        } catch (retryError) {
          console.error(`[ConversionService] Still failed after fix attempt:`, retryError.message);
          // Return original content if we can't parse it
          return xhtmlContent;
        }
      }
      
      const document = dom.window.document;
      
      // Text-containing elements that should have IDs
      const textElementTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'li', 'td', 'th', 'header', 'footer', 'section', 'article', 'aside', 'blockquote', 'figcaption', 'label', 'a'];
      
      // Consistent ID counter format matching Gemini's expected format
      // Format: page{N}_[type][number] or page{N}_[type][number]_[subtype][number]
      let idCounter = {
        h: 0,           // All headers (h1-h6) use same sequential counter
        header: 0,      // Header elements
        footer: 0,      // Footer elements
        p: 0,           // Paragraphs
        div: 0,         // Divs
        li: 0,          // List items
        td: 0,          // Table cells
        th: 0,          // Table headers
        section: 0,     // Sections
        article: 0,     // Articles
        aside: 0,       // Asides
        blockquote: 0,  // Blockquotes
        figcaption: 0,  // Figure captions
        label: 0,       // Labels
        a: 0            // Links
      };
      
      // Track sentence counters per paragraph: { 'p1': 0, 'p2': 0, ... }
      const sentenceCounters = {};
      // Track word counters per sentence: { 'p1_s1': 0, 'p1_s2': 0, ... }
      const wordCounters = {};
      
      // First pass: Scan existing IDs to initialize counters correctly
      const scanExistingIds = (element) => {
        if (!element || element.nodeType !== 1) return;
        
        const existingId = element.getAttribute('id');
        if (existingId) {
          const id = existingId.trim();
          const prefix = `page${pageNumber}_`;
          
          if (id.startsWith(prefix)) {
            const suffix = id.substring(prefix.length);
            
            // Match h1, h2, h3, etc. (format: h{N}) - all headers use same counter
            const hMatch = suffix.match(/^h(\d+)$/);
            if (hMatch) {
              const num = parseInt(hMatch[1], 10);
              if (!idCounter.h || idCounter.h < num) {
                idCounter.h = num;
              }
            }
            
            // Match paragraphs (format: p{N})
            const pMatch = suffix.match(/^p(\d+)$/);
            if (pMatch) {
              const num = parseInt(pMatch[1], 10);
              if (!idCounter.p || idCounter.p < num) {
                idCounter.p = num;
              }
            }
            
            // Match sentences (format: [type]{N}_s{N} - supports all element types)
            const sMatch = suffix.match(/^([a-z]+)(\d+)_s(\d+)$/);
            if (sMatch) {
              const parentType = sMatch[1]; // e.g., 'p', 'h', 'li', 'td', 'header'
              const parentNum = parseInt(sMatch[2], 10);
              const sNum = parseInt(sMatch[3], 10);
              const parentKey = `${parentType}${parentNum}`;
              if (!sentenceCounters[parentKey] || sentenceCounters[parentKey] < sNum) {
                sentenceCounters[parentKey] = sNum;
              }
            }
            
            // Match words (format: [type]{N}_s{N}_w{N} - supports all element types)
            const wMatch = suffix.match(/^([a-z]+)(\d+)_s(\d+)_w(\d+)$/);
            if (wMatch) {
              const parentType = wMatch[1]; // e.g., 'p', 'h', 'li', 'td', 'header'
              const parentNum = parseInt(wMatch[2], 10);
              const sNum = parseInt(wMatch[3], 10);
              const wNum = parseInt(wMatch[4], 10);
              const sKey = `${parentType}${parentNum}_s${sNum}`;
              if (!wordCounters[sKey] || wordCounters[sKey] < wNum) {
                wordCounters[sKey] = wNum;
              }
            }
            
            // Match other elements (format: [type]{N})
            const otherMatch = suffix.match(/^([a-zA-Z]+)(\d+)$/);
            if (otherMatch && !hMatch && !pMatch) {
              const type = otherMatch[1];
              const num = parseInt(otherMatch[2], 10);
              const counterKey = type.toLowerCase();
              if (!idCounter[counterKey] || idCounter[counterKey] < num) {
                idCounter[counterKey] = num;
              }
            }
          }
        }
        
        // Process children
        const children = Array.from(element.children || []);
        children.forEach(child => scanExistingIds(child));
      };
      
      // Get body element once for reuse
      const body = document.querySelector('body');
      
      // Scan body for existing IDs to initialize counters
      if (body) {
        scanExistingIds(body);
      } else {
        // Scan all elements if no body
        const allElements = document.querySelectorAll('*');
        allElements.forEach(el => scanExistingIds(el));
      }
      
      // Function to check if element contains text (directly or in children)
      const hasTextContent = (element) => {
        if (!element) return false;
        const text = element.textContent?.trim() || '';
        if (text.length > 0) return true;
        // Check if it has child elements with text
        const children = element.children || [];
        for (let i = 0; i < children.length; i++) {
          if (hasTextContent(children[i])) return true;
        }
        return false;
      };
      
      // Function to generate unique ID following consistent format
      const generateId = (tagName, parentId = null, isSentence = false, isWord = false) => {
        const prefix = `page${pageNumber}_`;
        
        // Handle hierarchical IDs (sentences and words)
        if (isWord && parentId) {
          // Word ID: page{N}_p{N}_s{N}_w{N}
          const wordKey = parentId;
          if (!wordCounters[wordKey]) wordCounters[wordKey] = 0;
          wordCounters[wordKey]++;
          return `${parentId}_w${wordCounters[wordKey]}`;
        }
        
        if (isSentence && parentId) {
          // Sentence ID: page{N}_[type]{N}_s{N} (supports all element types: p, h, li, td, th, header, footer, div, etc.)
          // Match pattern: [type][number] at the end (e.g., p1, h1, li1, td1, header1, etc.)
          const parentMatch = parentId.match(/([a-z]+)(\d+)$/);
          if (parentMatch) {
            const parentType = parentMatch[1]; // e.g., 'p', 'h', 'li', 'td', 'header'
            const parentNum = parentMatch[2];  // e.g., '1', '2', '3'
            const parentKey = `${parentType}${parentNum}`;
            if (!sentenceCounters[parentKey]) sentenceCounters[parentKey] = 0;
            sentenceCounters[parentKey]++;
            return `${parentId}_s${sentenceCounters[parentKey]}`;
          }
        }
        
        // Handle header tags (h1, h2, h3, etc.) - consistent format: page{N}_h{N} (sequential, not by level)
        // All headers use the same counter regardless of level (h1, h2, h3 all increment same counter)
        if (tagName.startsWith('h') && tagName.length === 2) {
          // Use a single 'h' counter for all header levels to maintain consistency
          if (!idCounter.h) idCounter.h = 0;
          idCounter.h++;
          return `${prefix}h${idCounter.h}`;
        }
        
        // Handle other elements - consistent format: page{N}_[type][number]
        const counterKey = tagName.toLowerCase();
        if (!idCounter[counterKey]) {
          // Initialize counter for this tag type
          idCounter[counterKey] = 0;
        }
        idCounter[counterKey]++;
        
        return `${prefix}${counterKey}${idCounter[counterKey]}`;
      };
      
      // Process all elements in the document (depth-first to handle nested elements properly)
      const processElement = (element, parentId = null) => {
        if (!element || element.nodeType !== 1) return; // Not an element node
        
        const tagName = element.tagName?.toLowerCase();
        if (!tagName) {
          // Not a valid element, process children
          const children = Array.from(element.children || []);
          children.forEach(child => processElement(child, parentId));
          return;
        }
        
        // Check if element has text content (directly or in children)
        const directText = (element.textContent || '').trim();
        const hasDirectText = directText.length > 0 && 
          Array.from(element.childNodes || []).some(node => 
            node.nodeType === 3 && node.textContent?.trim().length > 0
          );
        
        // Check if element already has an ID
        let existingId = element.getAttribute('id');
        if (existingId) existingId = existingId.trim();
        
        // Determine if this element needs an ID
        const needsId = textElementTags.includes(tagName) && 
          (hasDirectText || hasTextContent(element)) &&
          (!existingId || existingId === '');
        
        if (needsId) {
          // Generate ID - maintain consistent hierarchy
          let newId;
          const parent = element.parentElement;
          const parentIdAttr = parent ? parent.getAttribute('id') : null;
          
          // Check if this span should be part of hierarchical structure (sentence or word)
          if (tagName === 'span' && parentIdAttr) {
            const parentTag = parent.tagName?.toLowerCase();
            const currentClass = element.getAttribute('class') || '';
            const hasSyncSentenceClass = currentClass.includes('sync-sentence');
            const hasSyncWordClass = currentClass.includes('sync-word');
            
            // Check if parent is a sentence span (has _s{N} in ID, e.g., page1_p1_s1, page1_h1_s1, page1_li1_s1, etc.)
            // OR if this span has sync-word class and parent is a sentence
            const isParentSentence = parentTag === 'span' && (
              parentIdAttr.match(/[a-z]+\d+_s\d+$/) || // Matches p1_s1, h1_s1, li1_s1, td1_s1, etc.
              parentIdAttr.match(/_s\d+$/) // Generic sentence pattern
            );
            
            if (hasSyncWordClass || isParentSentence) {
              // This is a word inside a sentence - generate word-level ID
              // Parent should be a sentence (parentId_s{N})
              newId = generateId(tagName, parentIdAttr, false, true);
            }
            // Check if parent is a text-containing element (p, h1-h6, li, td, th, header, footer, div, section, etc.)
            // OR if this span has sync-sentence class
            else if (hasSyncSentenceClass || (
              ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'header', 'footer', 'div', 'section', 'article', 'aside'].includes(parentTag) &&
              parentIdAttr && 
              !parentIdAttr.match(/_s\d+/) && // Parent is not already a sentence
              !parentIdAttr.match(/_w\d+/)    // Parent is not already a word
            )) {
              // This is a sentence inside a parent element - generate sentence-level ID
              newId = generateId(tagName, parentIdAttr, true, false);
            }
            // Check if parent is a sentence span (has _s{N} but no _w{N})
            else if (parentTag === 'span' && parentIdAttr.match(/[a-z]+\d+_s\d+$/) && !parentIdAttr.match(/_w\d+$/)) {
              // This is a word inside a sentence
              newId = generateId(tagName, parentIdAttr, false, true);
            }
            else {
              // Regular span (not hierarchical) - assign non-hierarchical ID
              newId = generateId(tagName, parentIdAttr);
            }
          } else if (tagName === 'p') {
            // Paragraph element - generate paragraph-level ID
            newId = generateId(tagName, parentIdAttr);
            // Ensure paragraph has paragraph-block class for CSS
            const currentClass = element.getAttribute('class') || '';
            if (!currentClass.includes('paragraph-block')) {
              element.setAttribute('class', currentClass ? `${currentClass} paragraph-block` : 'paragraph-block');
            }
          } else {
            // Non-span, non-paragraph element or span without hierarchical parent
            newId = generateId(tagName, parentIdAttr);
          }
          
          element.setAttribute('id', newId);
          // Also ensure data-read-aloud is set
          if (!element.getAttribute('data-read-aloud')) {
            element.setAttribute('data-read-aloud', 'true');
          }
          // Ensure proper classes for hierarchical structure
          if (tagName === 'span') {
            const currentClass = element.getAttribute('class') || '';
            // If this is a word-level ID (has _w in ID), ensure sync-word class
            if (newId.includes('_w') && !currentClass.includes('sync-word')) {
              element.setAttribute('class', currentClass ? `${currentClass} sync-word` : 'sync-word');
            }
            // If this is a sentence-level ID (has _s but not _w), ensure sync-sentence class
            else if (newId.includes('_s') && !newId.includes('_w') && !currentClass.includes('sync-sentence')) {
              element.setAttribute('class', currentClass ? `${currentClass} sync-sentence` : 'sync-sentence');
            }
          }
          console.log(`[ConversionService] Assigned ID "${newId}" to <${tagName}> element: "${directText.substring(0, 50)}..."`);
          existingId = newId; // Update for children
        }
        
        // Process children recursively with current element's ID as parent
        const children = Array.from(element.children || []);
        children.forEach(child => processElement(child, existingId || parentId));
      };
      
      // Start processing from body, or root if no body (reuse body from above)
      if (body) {
        processElement(body);
      } else {
        // No body tag, process all elements
        const allElements = document.querySelectorAll('*');
        allElements.forEach(el => processElement(el));
      }
      
      // Serialize back to XHTML string
      const serializer = new dom.window.XMLSerializer();
      let result = serializer.serializeToString(document);
      
      // Fix DOCTYPE if needed
      if (!result.includes('<!DOCTYPE')) {
        const doctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
        result = doctype + '\n' + result;
      }
      
      return result;
    } catch (error) {
      console.error(`[ConversionService] Error ensuring IDs for page ${pageNumber}:`, error.message);
      // Return original content if processing fails
      return xhtmlContent;
    }
  }

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
    await JobConcurrencyService.acquire(jobId);
    
    try {
      const job = await ConversionJobModel.findById(jobId);
      if (!job) {
        throw new Error('Conversion job not found');
      }

      const pdf = await PdfDocumentModel.findById(job.pdf_document_id);
      if (!pdf || !pdf.file_path) {
        throw new Error('PDF document not found or file path missing');
      }

      let pdfFilePath = pdf.file_path;
      try {
        await fs.access(pdfFilePath);
      } catch (accessError) {
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

      await ConversionJobModel.update(jobId, {
        currentStep: steps[1].step,
        progressPercentage: steps[1].progress
      });

      // Check if we should use PNG-to-XHTML conversion flow
      const usePngToXhtmlFlow = (process.env.USE_PNG_TO_XHTML_FLOW || 'true').toLowerCase() === 'true';
      
      if (usePngToXhtmlFlow) {
        console.log(`[Job ${jobId}] Using PNG-to-XHTML conversion flow...`);
        try {
          const result = await this.convertPdfToXhtmlViaPng(jobId, pdfFilePath, steps);
          await ConversionJobModel.update(jobId, {
            status: 'COMPLETED',
            currentStep: steps[steps.length - 1].step,
            progressPercentage: 100,
            epubFilePath: result.epubPath
          });
          console.log(`[Job ${jobId}] PNG-to-XHTML conversion completed: ${result.epubPath}`);
          return;
        } catch (pngError) {
          console.error(`[Job ${jobId}] PNG-to-XHTML flow failed, falling back to standard conversion:`, pngError.message);
          // Fall through to standard conversion
        }
      }

      console.log(`[Job ${jobId}] Extracting text from PDF: ${pdfFilePath}`);

      let textData = null;
      const useGeminiExtraction = (process.env.GEMINI_TEXT_EXTRACTION || '').toLowerCase() === 'true';
      if (useGeminiExtraction) {
        try {
          textData = await GeminiService.extractTextFromPdf(pdfFilePath);
          if (textData) {
            console.log(`[Job ${jobId}] Extracted text via Gemini (${textData.totalPages} pages)`);
          }
        } catch (aiError) {
          console.warn(`[Job ${jobId}] Gemini extraction failed, trying next method: ${aiError.message}`);
          textData = null;
        }
      }

      if (!textData) {
        const useOcrExtraction = (process.env.USE_OCR_EXTRACTION || '').toLowerCase() === 'true';
        if (useOcrExtraction) {
          try {
            const { OcrService } = await import('./ocrService.js');
            const ocrLang = process.env.OCR_LANGUAGE || 'eng';
            textData = await OcrService.extractTextFromPdf(pdfFilePath, {
              lang: ocrLang,
              psm: parseInt(process.env.OCR_PSM || '6'),
              dpi: parseInt(process.env.OCR_DPI || '300')
            });
            if (textData) {
              console.log(`[Job ${jobId}] Extracted text via Tesseract OCR (${textData.totalPages} pages, avg confidence: ${textData.metadata.averageConfidence?.toFixed(1)}%)`);
            }
          } catch (ocrError) {
            console.warn(`[Job ${jobId}] OCR extraction failed, falling back to pdfjs-dist: ${ocrError.message}`);
            textData = null;
          }
        }
      }

      if (!textData) {
        textData = await PdfExtractionService.extractText(pdfFilePath);
        console.log(`[Job ${jobId}] Extracted text via pdfjs-dist (${textData.totalPages} pages)`);
      }

      await ConversionJobModel.update(jobId, {
        currentStep: steps[2].step,
        progressPercentage: steps[2].progress
      });

      // Use new text-based conversion pipeline
      const useTextBasedPipeline = (process.env.USE_TEXT_BASED_PIPELINE || 'true').toLowerCase() === 'true';
      
      if (useTextBasedPipeline) {
        console.log(`[Job ${jobId}] Using text-based EPUB3 conversion pipeline...`);
        
        await ConversionJobModel.update(jobId, {
          currentStep: steps[3].step,
          progressPercentage: steps[3].progress
        });
        
        try {
          const epubOutputDir = getEpubOutputDir();
          const result = await TextBasedConversionPipeline.convert(
            pdfFilePath,
            epubOutputDir,
            jobId,
            {
              generateAudio: true,
              useAI: true,
              ocrLang: process.env.OCR_LANGUAGE || 'eng',
              ocrDpi: parseInt(process.env.OCR_DPI || '300'),
              ocrPsm: parseInt(process.env.OCR_PSM || '6')
            }
          );
          
          await ConversionJobModel.update(jobId, {
            status: 'COMPLETED',
            currentStep: steps[steps.length - 1].step,
            progressPercentage: 100,
            epubFilePath: result.epubPath
          });
          
          console.log(`[Job ${jobId}] Text-based EPUB3 conversion completed: ${result.epubPath}`);
          return;
        } catch (pipelineError) {
          console.error(`[Job ${jobId}] Text-based pipeline failed, falling back to legacy:`, pipelineError.message);
          // Fall through to legacy conversion
        }
      }
      
      // Legacy conversion (image-based) - kept as fallback
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

      for (const page of textData.pages) {
        if (!page || !page.text || page.text.trim().length === 0) continue;
        const hasBlocks = Array.isArray(page.textBlocks) && page.textBlocks.length > 0;
        if (hasBlocks) continue;
        
        const blockTimeout = 65000;
        const blockTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Text block creation timeout after 65s')), blockTimeout)
        );
        
        try {
          const pageWidth = page.width || textData.metadata?.width || 612;
          const pageHeight = page.height || textData.metadata?.height || 792;
          const blocksPromise = GeminiService.createTextBlocksFromText(
            page.text,
            page.pageNumber,
            pageWidth,
            pageHeight
          );
          
          const blocks = await Promise.race([blocksPromise, blockTimeoutPromise]);
          page.textBlocks = blocks;
          console.log(`[Job ${jobId}] Created ${blocks.length} AI text blocks for page ${page.pageNumber}`);
        } catch (blockErr) {
          if (blockErr.message.includes('timeout')) {
            console.warn(`[Page ${page.pageNumber}] Text block creation timed out, using simple blocks`);
            const pageWidth = page.width || textData.metadata?.width || 612;
            const pageHeight = page.height || textData.metadata?.height || 792;
            page.textBlocks = GeminiService.createSimpleTextBlocks(
              page.text,
              page.pageNumber,
              pageWidth,
              pageHeight
            );
            console.log(`[Job ${jobId}] Created ${page.textBlocks.length} simple text blocks for page ${page.pageNumber} (timeout fallback)`);
          } else {
            console.warn(`[Job ${jobId}] Could not create AI text blocks for page ${page.pageNumber}: ${blockErr.message}`);
          }
        }
      }

      await ConversionJobModel.update(jobId, {
        currentStep: steps[4].step,
        progressPercentage: steps[4].progress
      });

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

      const useVisionExtraction = (process.env.GEMINI_VISION_EXTRACTION || 'true').toLowerCase() === 'true';
      if (useVisionExtraction && pageImagesData.images.length > 0) {
        await ConversionJobModel.update(jobId, {
          currentStep: 'STEP_6_VISION_EXTRACTION',
          progressPercentage: 70
        });

        console.log(`[Job ${jobId}] Extracting text from rendered images using AI Vision API (${pageImagesData.images.length} pages)...`);
        const visionExtractedPages = [];
        const totalPages = pageImagesData.images.length;
        
        for (let i = 0; i < pageImagesData.images.length; i++) {
          const image = pageImagesData.images[i];
          const pageNumber = i + 1;
          
          const progress = 70 + Math.floor((i / totalPages) * 15);
          await ConversionJobModel.update(jobId, {
            currentStep: 'STEP_6_VISION_EXTRACTION',
            progressPercentage: progress
          }).catch(() => {});
          
          console.log(`[Job ${jobId}] Processing page ${pageNumber}/${totalPages}...`);
          
          try {
            const extractionTimeout = 65000;
            const extractionPromise = GeminiService.extractTextFromImage(image.path, pageNumber);
            const extractionTimeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Extraction timeout after 65s')), extractionTimeout)
            );
            
            const extractedText = await Promise.race([extractionPromise, extractionTimeoutPromise]);
            
            if (extractedText) {
              const correctionTimeout = 30000;
              const correctionPromise = GeminiService.correctExtractedText(extractedText, pageNumber);
              const correctionTimeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Correction timeout after 30s')), correctionTimeout)
              );
              
              let correctedText;
              try {
                correctedText = await Promise.race([correctionPromise, correctionTimeoutPromise]);
              } catch (correctionError) {
                console.warn(`[Job ${jobId}] Page ${pageNumber}: Text correction failed, using extracted text:`, correctionError.message);
                correctedText = extractedText;
              }
              
              console.log(`[Job ${jobId}] Creating structured text blocks for page ${pageNumber} using AI...`);
              let textBlocks = [];
              try {
                const pageWidth = image.width || 612;
                const pageHeight = image.height || 792;
                textBlocks = await GeminiService.createTextBlocksFromText(
                  correctedText,
                  pageNumber,
                  pageWidth,
                  pageHeight
                );
                console.log(`[Job ${jobId}] ✓ Page ${pageNumber}: AI created ${textBlocks.length} text blocks`);
              } catch (blockError) {
                console.warn(`[Job ${jobId}] Page ${pageNumber}: Failed to create text blocks with AI:`, blockError.message);
              }
              
              visionExtractedPages.push({
                pageNumber,
                text: correctedText,
                textBlocks: textBlocks,
                charCount: correctedText.length,
                width: image.width || 612,
                height: image.height || 792
              });
              
              console.log(`[Job ${jobId}] ✓ Page ${pageNumber}/${totalPages}: Extracted and corrected ${correctedText.length} characters, created ${textBlocks.length} text blocks`);
            } else {
              console.warn(`[Job ${jobId}] Page ${pageNumber}: Vision extraction returned no text, using original`);
              const originalPage = textData.pages.find(p => p.pageNumber === pageNumber);
              if (originalPage) {
                visionExtractedPages.push(originalPage);
              }
            }
          } catch (error) {
            console.warn(`[Job ${jobId}] Page ${pageNumber}: Vision extraction failed (${error.message}), using original text`);
            const originalPage = textData.pages.find(p => p.pageNumber === pageNumber);
            if (originalPage) {
              visionExtractedPages.push(originalPage);
            }
          }
        }

        if (visionExtractedPages.length > 0) {
          textData.pages = visionExtractedPages;
          textData.totalPages = visionExtractedPages.length;
          console.log(`[Job ${jobId}] Extracted text from ${visionExtractedPages.length} pages using AI Vision API`);
        }
      }

      await ConversionJobModel.update(jobId, {
        currentStep: steps[6].step,
        progressPercentage: steps[6].progress
      });

      const epubOutputDir = getEpubOutputDir();
      const jobDir = path.join(epubOutputDir, `job_${jobId}`);
      await fs.mkdir(jobDir, { recursive: true }).catch(() => {});
      
      // Create assets directories
      const assetsDir = path.join(jobDir, 'assets');
      const imagesDir = path.join(assetsDir, 'images');
      const audioDir = path.join(assetsDir, 'audio');
      await fs.mkdir(imagesDir, { recursive: true }).catch(() => {});
      await fs.mkdir(audioDir, { recursive: true }).catch(() => {});
      
      // Save textData to JSON file for API access
      const textDataPath = path.join(jobDir, `text_data_${jobId}.json`);
      try {
        await fs.writeFile(textDataPath, JSON.stringify(textData, null, 2), 'utf8');
        console.log(`[Job ${jobId}] Saved text data to ${textDataPath}`);
      } catch (saveError) {
        console.warn(`[Job ${jobId}] Could not save text data:`, saveError.message);
      }

      const epubFileName = `converted_${jobId}.epub`;
      const epubFilePath = path.join(epubOutputDir, epubFileName);

      await fs.mkdir(epubOutputDir, { recursive: true }).catch(() => {});

      console.log(`[Job ${jobId}] Generating EPUB file (fixed-layout, one page per file)...`);
      const epubBuffer = await this.generateFixedLayoutEpub(
        jobId,
        textData,
        structuredContent,
        pageImagesData,
        pdf.original_file_name || `Document ${jobId}`,
        pdfFilePath
      );

      try {
        const { EpubValidator } = await import('../utils/epubValidator.js');
        const validation = await EpubValidator.validate(epubBuffer);
        if (!validation.valid) {
          console.warn(`[Job ${jobId}] ⚠️ EPUB validation errors:`, validation.errors);
        }
        if (validation.warnings.length > 0) {
          console.warn(`[Job ${jobId}] ⚠️ EPUB validation warnings:`, validation.warnings);
        }
        if (validation.valid) {
          console.log(`[Job ${jobId}] ✓ EPUB validation passed: ${validation.stats.totalFiles} files, ${validation.stats.xhtmlFiles} pages, ${validation.stats.imageFiles} images`);
        }
      } catch (validationError) {
        console.warn(`[Job ${jobId}] Could not validate EPUB:`, validationError.message);
      }

      await fs.writeFile(epubFilePath, epubBuffer);
      console.log(`[Job ${jobId}] EPUB file generated: ${epubFilePath} (${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

      await ConversionJobModel.update(jobId, {
        status: 'COMPLETED',
        currentStep: steps[8].step,
        progressPercentage: steps[8].progress,
        epubFilePath,
        completedAt: new Date()
      });

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
      JobConcurrencyService.release(jobId);
    }
  }

  /**
   * Generate stable block ID based on content and position
   */
  static generateStableBlockId(text, x, y, pageNumber) {
    const content = `${pageNumber}_${text}_${x.toFixed(2)}_${y.toFixed(2)}`;
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return `block_${hash.substring(0, 12)}`;
  }

  /**
   * Migrate sync data to use stable block IDs
   */
  static migrateSyncsToStableIds(textBlocks, syncData) {
    // Create mapping from old IDs to stable IDs
    const idMapping = {};
    textBlocks.forEach(block => {
      const bbox = block.boundingBox || {};
      const stableId = this.generateStableBlockId(
        block.text || '',
        bbox.x || 0,
        bbox.y || 0,
        block.pageNumber || 0
      );
      idMapping[block.id] = stableId;
      block.id = stableId; // Update block ID
    });

    // Update sync data with new IDs
    return syncData.map(sync => ({
      ...sync,
      id: idMapping[sync.id] || sync.id
    }));
  }

  static async regenerateEpub(jobId, options = {}) {
    const { granularity = null } = options; // 'word', 'sentence', 'paragraph', or null for all
    
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found');
    }

    if (job.status !== 'COMPLETED') {
      throw new Error('Can only regenerate EPUB for completed conversions');
    }

    const pdf = await PdfDocumentModel.findById(job.pdf_document_id);
    if (!pdf || !pdf.file_path) {
      throw new Error('PDF document not found or file path missing');
    }

    console.log(`[Job ${jobId}] Regenerating EPUB${granularity ? ` with ${granularity}-level audio sync` : ''}`);

    const epubOutputDir = getEpubOutputDir();
    const { getHtmlIntermediateDir } = await import('../config/fileStorage.js');
    const htmlIntermediateDir = getHtmlIntermediateDir();
    
    // Load XHTML files from the html_intermediate directory (same as initial generation)
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    
    console.log(`[Job ${jobId}] Regenerating EPUB using XHTML files from: ${jobHtmlDir}`);
    
    // Check if XHTML files exist
    let xhtmlFiles = [];
    try {
      const files = await fs.readdir(jobHtmlDir);
      xhtmlFiles = files
        .filter(f => f.endsWith('.xhtml') && f.startsWith('page_'))
        .map(f => {
          const pageMatch = f.match(/page_(\d+)\.xhtml/);
          return {
            pageNumber: pageMatch ? parseInt(pageMatch[1]) : 0,
            xhtmlPath: path.join(jobHtmlDir, f),
            xhtmlFileName: f
          };
        })
        .filter(f => f.pageNumber > 0)
        .sort((a, b) => a.pageNumber - b.pageNumber);
      
      console.log(`[Job ${jobId}] Found ${xhtmlFiles.length} XHTML files in html directory`);
    } catch (err) {
      console.warn(`[Job ${jobId}] Could not read XHTML directory: ${err.message}`);
    }
    
    if (xhtmlFiles.length === 0) {
      throw new Error(`No XHTML files found for job ${jobId}. Cannot regenerate EPUB.`);
      }

    // Load audio sync data from database
    const { AudioSyncModel } = await import('../models/AudioSync.js');
    const audioSyncs = await AudioSyncModel.findByJobId(jobId).catch(() => []);
    const activeSyncs = audioSyncs.filter(s => s.should_read !== false && s.should_read !== 0);
    
    console.log(`[Job ${jobId}] Loaded ${audioSyncs.length} total syncs, ${activeSyncs.length} active syncs`);
    
    // Debug: Log first sync to see its structure
    if (audioSyncs.length > 0) {
      const firstSync = audioSyncs[0];
      console.log(`[Job ${jobId}] First sync audio_file_path: ${firstSync.audio_file_path || firstSync.audioFilePath || 'not set'}`);
    }
    
    // Check for audio file - same logic as generateFixedLayoutEpub
    let audioFilePath = null;
    let audioFileName = null;
    
    // Method 1: Check if any sync has audioFilePath (same as generateFixedLayoutEpub)
    if (audioSyncs.length > 0) {
      const firstSync = audioSyncs[0];
      const syncAudioPath = firstSync.audioFilePath || firstSync.audio_file_path;
      
      if (syncAudioPath) {
        let actualAudioFilePath = syncAudioPath;
        
        // Handle relative paths that start with 'audio/' or 'uploads/'
        if (!path.isAbsolute(syncAudioPath)) {
          if (syncAudioPath.startsWith('audio/')) {
            const { getUploadDir } = await import('../config/fileStorage.js');
            const uploadDir = getUploadDir();
            const audioFileNameOnly = path.basename(syncAudioPath);
            actualAudioFilePath = path.join(uploadDir, 'audio', audioFileNameOnly);
          } else if (syncAudioPath.startsWith('uploads/')) {
            actualAudioFilePath = path.join(htmlIntermediateDir, '..', syncAudioPath);
          } else {
            actualAudioFilePath = path.join(htmlIntermediateDir, '..', syncAudioPath);
          }
        }
        
        console.log(`[Job ${jobId}] Checking sync audio path: ${actualAudioFilePath}`);
    try {
          await fs.access(actualAudioFilePath);
          audioFilePath = actualAudioFilePath;
          audioFileName = path.basename(actualAudioFilePath);
          console.log(`[Job ${jobId}] Found audio file from sync: ${audioFilePath}`);
        } catch (e) {
          console.log(`[Job ${jobId}] Audio file from sync not found: ${actualAudioFilePath}`);
        }
      }
    }
    
    // Method 2: Check standard locations if not found in sync
    if (!audioFilePath) {
      const possibleAudioFiles = [
        path.join(htmlIntermediateDir, '..', 'uploads', 'tts_audio', `combined_audio_${jobId}.mp3`),
        path.join(epubOutputDir, `job_${jobId}`, 'audio', `combined_audio_${jobId}.mp3`),
        path.join(htmlIntermediateDir, '..', 'audio', `combined_audio_${jobId}.mp3`),
        path.join(htmlIntermediateDir, '..', 'uploads', 'audio', `combined_audio_${jobId}.mp3`)
      ];
      
      for (const audioPath of possibleAudioFiles) {
        console.log(`[Job ${jobId}] Checking audio path: ${audioPath}`);
        try {
          await fs.access(audioPath);
          audioFilePath = audioPath;
          audioFileName = path.basename(audioPath);
          console.log(`[Job ${jobId}] Found audio file at: ${audioFilePath}`);
          break;
        } catch (e) {
          // Continue to next path
        }
      }
    }
    
    if (!audioFilePath) {
      console.log(`[Job ${jobId}] No audio file found - SMIL files will not be generated`);
    }
    
    await ConversionJobModel.update(jobId, {
      status: 'IN_PROGRESS',
      currentStep: 'STEP_7_EPUB_GENERATION',
      progressPercentage: 95
    });

    // Create temp directory structure (same as generateEpubFromXhtmlPages)
    const tempEpubDir = path.join(epubOutputDir, `temp_regen_${jobId}`);
    const oebpsDir = path.join(tempEpubDir, 'OEBPS');
    const metaInfDir = path.join(tempEpubDir, 'META-INF');
    
    await fs.mkdir(oebpsDir, { recursive: true });
    await fs.mkdir(metaInfDir, { recursive: true });
    
    // Copy XHTML files to OEBPS directory
    const manifestItems = [];
    const spineItems = [];
    const smilFiles = [];
    
    // Group syncs by page number
    const syncsByPage = {};
    for (const sync of activeSyncs) {
      // Ensure pageNum is always a number (handle legacy string data like "page-1")
      let pageNum = 1;
      if (sync.page_number) {
        if (typeof sync.page_number === 'number') {
          pageNum = sync.page_number;
        } else {
          // Extract number from string like "page-1", "page_2", or just "1"
          const match = String(sync.page_number).match(/(\d+)/);
          pageNum = match ? parseInt(match[1], 10) : 1;
        }
      }
      if (!syncsByPage[pageNum]) {
        syncsByPage[pageNum] = [];
      }
      syncsByPage[pageNum].push(sync);
    }
    
    // Debug: log sync distribution
    console.log(`[Job ${jobId}] Syncs by page:`, Object.entries(syncsByPage).map(([p, s]) => `Page ${p}: ${s.length} syncs`).join(', '));
    
    for (const page of xhtmlFiles) {
      // Copy XHTML file
      const destPath = path.join(oebpsDir, page.xhtmlFileName);
      await fs.copyFile(page.xhtmlPath, destPath);
      
      const pageId = `page-${page.pageNumber}`;
      const pageSyncs = syncsByPage[page.pageNumber] || [];
      
      // Check if this page has audio syncs
      let smilRef = null;
      if (pageSyncs.length > 0 && audioFileName) {
        // Generate SMIL file for this page
        const smilFileName = `page_${page.pageNumber}.smil`;
        const smilContent = this.generateSMILContent(
          page.pageNumber, 
          pageSyncs, 
          audioFileName, 
          null, // textData not needed for simple SMIL
          {}, // pageIdMapping
          page.xhtmlFileName
        );
        
        await fs.writeFile(path.join(oebpsDir, smilFileName), smilContent, 'utf8');
        smilFiles.push({
          id: `smil-${page.pageNumber}`,
          href: smilFileName,
          pageId: pageId
        });
        smilRef = `smil-${page.pageNumber}`;
        
        console.log(`[Job ${jobId}] Generated SMIL file: ${smilFileName} with ${pageSyncs.length} syncs`);
      }
      
      manifestItems.push({
        id: pageId,
        href: page.xhtmlFileName,
        mediaType: 'application/xhtml+xml',
        mediaOverlay: smilRef
      });
      
      spineItems.push({
        idref: pageId,
        mediaOverlay: smilRef
      });
    }
    
    // Add audio file to EPUB if exists (in audio/ subdirectory for SMIL compatibility)
    if (audioFilePath && audioFileName) {
      try {
        const audioDir = path.join(oebpsDir, 'audio');
        await fs.mkdir(audioDir, { recursive: true });
        const audioBuffer = await fs.readFile(audioFilePath);
        await fs.writeFile(path.join(audioDir, audioFileName), audioBuffer);
        manifestItems.push({
          id: 'audio-main',
          href: `audio/${audioFileName}`,
          mediaType: 'audio/mpeg'
        });
        console.log(`[Job ${jobId}] Added audio file to EPUB: audio/${audioFileName}`);
      } catch (err) {
        console.warn(`[Job ${jobId}] Could not add audio file: ${err.message}`);
      }
    }
    
    // Add SMIL files to manifest
    for (const smil of smilFiles) {
      manifestItems.push({
        id: smil.id,
        href: smil.href,
        mediaType: 'application/smil+xml'
      });
    }
    
    // Generate OPF file
    const title = pdf.original_file_name || `Converted PDF - Job ${jobId}`;
    const manifestXml = manifestItems
      .map(item => {
        // Add OEBPS/ prefix to href since OPF is at root level
        const href = `OEBPS/${item.href}`;
        let attrs = `id="${item.id}" href="${href}" media-type="${item.mediaType}"`;
        if (item.mediaOverlay) {
          attrs += ` media-overlay="${item.mediaOverlay}"`;
        }
        return `    <item ${attrs}/>`;
      })
      .join('\n');
    
    const spineXml = spineItems
      .map(item => `    <itemref idref="${item.idref}"/>`)
      .join('\n');
    
    // Calculate total audio duration for media overlay metadata
    let totalDuration = 0;
    for (const sync of activeSyncs) {
      if (sync.end_time) {
        totalDuration = Math.max(totalDuration, parseFloat(sync.end_time) || 0);
      }
    }
    
    const mediaOverlayMeta = audioFileName && smilFiles.length > 0 
      ? `\n    <meta property="media:duration">${totalDuration.toFixed(3)}s</meta>
    <meta property="media:active-class">-epub-media-overlay-active</meta>`
      : '';
    
    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${jobId}</dc:identifier>
    <dc:title>${this.escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>${mediaOverlayMeta}
  </metadata>
  <manifest>
    <item id="nav" href="OEBPS/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestXml}
  </manifest>
  <spine toc="nav">
${spineXml}
  </spine>
</package>`;
    
    await fs.writeFile(path.join(tempEpubDir, 'content.opf'), opfContent, 'utf8');
    
    // Generate navigation XHTML
    const navContent = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8"/>
<title>Navigation</title>
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
${xhtmlFiles.map(p => `    <li><a href="${p.xhtmlFileName}">Page ${p.pageNumber}</a></li>`).join('\n')}
  </ol>
</nav>
</body>
</html>`;
    
    await fs.writeFile(path.join(oebpsDir, 'nav.xhtml'), navContent, 'utf8');
    
    // Generate container.xml
    const containerContent = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    
    await fs.writeFile(path.join(metaInfDir, 'container.xml'), containerContent, 'utf8');
    
    // Generate mimetype file
    await fs.writeFile(path.join(tempEpubDir, 'mimetype'), 'application/epub+zip', 'utf8');
    
    // Create EPUB ZIP file
    const epubFileName = `converted_${jobId}.epub`;
    const epubFilePath = path.join(epubOutputDir, epubFileName);
    
    const zip = new JSZip();
    
    // Add mimetype first (must be uncompressed and first file)
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    
    // Add all other files
    const addDirectoryToZip = async (dirPath, zipPath = '') => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const zipEntryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
        
        if (entry.name === 'mimetype') continue; // Already added
        
        if (entry.isDirectory()) {
          await addDirectoryToZip(fullPath, zipEntryPath);
        } else {
          // For XHTML files, read as text and sanitize
          if (entry.name.endsWith('.xhtml')) {
            let content = await fs.readFile(fullPath, 'utf8');
            // Sanitize XHTML
            content = content.replace(/\\\\/g, '\\');
            content = content.replace(/\\"/g, '"');
            content = content.replace(/\\'/g, "'");
            content = content.replace(/\\n/g, '\n');
            content = content.replace(/\\r/g, '\r');
            content = content.replace(/\\t/g, '\t');
            // Normalize DOCTYPE
            const correctDoctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
            content = content.replace(/<!DOCTYPE\s+html[^>]*>/i, correctDoctype);
            zip.file(zipEntryPath, content);
          } else {
            const content = await fs.readFile(fullPath);
            zip.file(zipEntryPath, content);
          }
        }
      }
    };
    
    await addDirectoryToZip(tempEpubDir);
    
    // Generate EPUB file
    const epubBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    await fs.writeFile(epubFilePath, epubBuffer);
    
    // Cleanup temp directory
    await fs.rm(tempEpubDir, { recursive: true, force: true }).catch(() => {});
    
    console.log(`[Job ${jobId}] EPUB regenerated: ${epubFilePath} (${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`[Job ${jobId}] Summary: ${xhtmlFiles.length} pages, ${smilFiles.length} SMIL files, audio: ${audioFileName ? 'yes' : 'no'}`);

    await ConversionJobModel.update(jobId, {
      status: 'COMPLETED',
      currentStep: 'STEP_8_QA_REVIEW',
      progressPercentage: 100,
      epubFilePath,
      completedAt: new Date()
    });

    return {
      jobId,
      epubFilePath,
      smilFilesGenerated: smilFiles.length,
      hasAudio: !!audioFileName,
      message: 'EPUB regenerated successfully with updated sync files'
    };
  }

  static async generateFixedLayoutEpub(jobId, textData, structuredContent, pageImagesData, documentTitle, pdfFilePath = null) {
    const { AudioSyncModel } = await import('../models/AudioSync.js');
    const audioSyncs = await AudioSyncModel.findByJobId(jobId).catch(() => []);
    let hasAudio = audioSyncs && audioSyncs.length > 0;
    
    const epubOutputDir = getEpubOutputDir();
    const jobDir = path.join(epubOutputDir, `job_${jobId}`);
    const imagesDir = path.join(jobDir, 'assets', 'images');
    // Ensure images directory exists
    await fs.mkdir(imagesDir, { recursive: true }).catch(() => {});
    const zip = new JSZip();
    
    const mimetypeContent = 'application/epub+zip';
    zip.file('mimetype', mimetypeContent, { 
      compression: 'STORE'
    });
    
    const mimetypeFile = zip.files['mimetype'];
    if (mimetypeFile) {
      if (!mimetypeFile.options) {
        mimetypeFile.options = {};
      }
      mimetypeFile.options.compression = 'STORE';
      mimetypeFile.options.compressionOptions = null;
    }
    
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
    
    // Normalize and sort page images by pageNumber to keep alignment with PDF order
    const pageImages = (pageImagesData.images || [])
      .filter(img => img && (img.pageNumber || img.pdfPageNumber))
      .map(img => ({
        ...img,
        pageNumber: img.pageNumber || img.pdfPageNumber || 0,
        pdfPageNumber: img.pdfPageNumber || img.pageNumber || img.pageNumber || 0,
        renderFailed: !!img.renderFailed
      }))
      .sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
    const renderedWidth = pageImagesData.renderedWidth || 0;
    const renderedHeight = pageImagesData.renderedHeight || 0;
    const pageWidthPoints = pageImagesData.maxWidth || 612.0;
    const pageHeightPoints = pageImagesData.maxHeight || 792.0;
    
    let actualPdfPageCount = pageImages.length;
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await fs.readFile(pdfFilePath);
      const pdfParseResult = await pdfParse(pdfData);
      actualPdfPageCount = pdfParseResult.numpages;
      console.log(`[Job ${jobId}] Actual PDF has ${actualPdfPageCount} pages (from PDF file)`);
    } catch (err) {
      console.warn(`[Job ${jobId}] Could not get PDF page count, using rendered images count: ${pageImages.length}`);
    }
    
    const totalPages = Math.max(actualPdfPageCount, pageImages.length, textData.pages?.length || 0);
    console.log(`[Job ${jobId}] EPUB generation: ${totalPages} total pages (PDF: ${actualPdfPageCount}, images: ${pageImages.length}, text: ${textData.pages?.length || 0})`);
    
    const manifestItems = [];
    const spineItems = [];
    const tocItems = [];
    const smilFileNames = [];

    console.log(`[Job ${jobId}] Page images after normalization: ${pageImages.length}`);
    pageImages.slice(0, 5).forEach(img => {
      console.log(`[Job ${jobId}] pageImage pageNumber=${img.pageNumber}, pdfPageNumber=${img.pdfPageNumber}, renderFailed=${img.renderFailed}, file=${img.fileName}`);
    });
    // Track mapping from source block IDs to actual XHTML IDs per page (for SMIL/audio and TTS alignment)
    let pageIdMappings = {};
    
    // If no page images, try to extract XHTML pages from existing EPUB
    let epubXhtmlPages = [];
    if (pageImages.length === 0 && textData.pages && textData.pages.length > 0) {
      console.log(`[Job ${jobId}] No page images found, attempting to extract XHTML from existing EPUB...`);
      try {
        const { EpubService } = await import('./epubService.js');
        const epubSections = await EpubService.getEpubSections(jobId);
        if (epubSections && epubSections.length > 0) {
          epubXhtmlPages = epubSections.map((section, idx) => ({
            pageNumber: section.sectionId || idx + 1,
            xhtml: section.xhtml,
            title: section.title || `Page ${section.sectionId || idx + 1}`
          }));
          console.log(`[Job ${jobId}] Extracted ${epubXhtmlPages.length} XHTML pages from existing EPUB`);
        }
      } catch (epubExtractError) {
        console.warn(`[Job ${jobId}] Could not extract XHTML from EPUB:`, epubExtractError.message);
      }
    }
    
    // STEP 1: Add images to EPUB FIRST and track which ones succeeded
    // This ensures we know which pages have valid images before generating XHTML
    const successfullyAddedImages = new Map(); // Map<pageNumber, epubPath>
    for (const img of pageImages) {
      try {
        // Verify image file exists before trying to add it
        await fs.access(img.path);
        const imageData = await fs.readFile(img.path);
        // Use 'images/' (plural) directory for EPUB standard
        const imageFileName = img.fileName.replace(/^(image|images)\//, '');
        const imagePath = `images/${imageFileName}`;
        zip.file(`OEBPS/${imagePath}`, imageData);
        
        // Copy image to assets directory for API access
        const assetsImageFileName = `page_${img.pageNumber}_render.png`;
        const assetsImagePath = path.join(imagesDir, assetsImageFileName);
        try {
          await fs.copyFile(img.path, assetsImagePath);
        } catch (copyError) {
          console.warn(`[Job ${jobId}] Could not copy image to assets:`, copyError.message);
        }
        
        const imageId = `page-img-${img.pageNumber}`;
        const imageMimeType = img.fileName.toLowerCase().endsWith('.jpg') || img.fileName.toLowerCase().endsWith('.jpeg') 
          ? 'image/jpeg' 
          : 'image/png';
        manifestItems.push(`<item id="${imageId}" href="${imagePath}" media-type="${imageMimeType}"/>`);
        
        img.epubPath = imagePath;
        successfullyAddedImages.set(img.pageNumber, imagePath);
        console.log(`[Job ${jobId}] Successfully added image for page ${img.pageNumber}: ${imagePath}`);
      } catch (imgError) {
        console.warn(`[Job ${jobId}] Could not add page image ${img.fileName} (page ${img.pageNumber}):`, imgError.message);
        // Don't set epubPath - this page will be skipped
      }
    }
    
    // STEP 2: Generate XHTML pages
    // If no page images, generate from XHTML sections or textData pages
    if (pageImages.length === 0 && (epubXhtmlPages.length > 0 || textData.pages.length > 0)) {
      console.log(`[Job ${jobId}] No page images found, generating pages from XHTML/textData...`);
      const pagesToGenerate = epubXhtmlPages.length > 0 ? epubXhtmlPages : textData.pages.map((p, idx) => ({
        pageNumber: p.pageNumber || idx + 1,
        xhtml: null, // Will be generated from text
        title: `Page ${p.pageNumber || idx + 1}`
      }));
      
      for (let i = 0; i < pagesToGenerate.length; i++) {
        const pageInfo = pagesToGenerate[i];
        const actualPageNum = pageInfo.pageNumber || i + 1;
        const fileName = `page_${actualPageNum}.xhtml`;
        
        // Check if we have an image for this page
        const pageImage = successfullyAddedImages.has(actualPageNum) 
          ? { 
              pageNumber: actualPageNum, 
              fileName: `page_${actualPageNum}_render.png`, 
              epubPath: successfullyAddedImages.get(actualPageNum), 
              path: pageImages.find(img => img.pageNumber === actualPageNum)?.path 
            }
          : null;
        
        let pageXhtml;
        if (pageInfo.xhtml) {
          // Use existing XHTML from EPUB, but update image paths if needed
          pageXhtml = pageInfo.xhtml;
          // If we have an image, ensure XHTML references it
          if (pageImage && pageImage.epubPath && !pageXhtml.includes(pageImage.epubPath)) {
            // Update image path in XHTML if it exists
            pageXhtml = pageXhtml.replace(/src="[^"]*image[^"]*"/g, `src="${pageImage.epubPath}"`);
            pageXhtml = pageXhtml.replace(/background-image:\s*url\([^)]*image[^)]*\)/g, `background-image: url(${pageImage.epubPath})`);
          }
        } else {
          // Generate XHTML from text data
          const page = textData.pages.find(p => p.pageNumber === actualPageNum) || textData.pages[i];
          if (page) {
            // Generate XHTML using generateHtmlBasedPageXHTML with actual image if available
            const imageForGeneration = pageImage || { pageNumber: actualPageNum, fileName: '', path: '', epubPath: '' };
            const { html } = this.generateHtmlBasedPageXHTML(
              page,
              imageForGeneration,
              actualPageNum,
              pageWidthPoints,
              pageHeightPoints,
              pageWidthPoints * (300/72),
              pageHeightPoints * (300/72),
              false
            );
            pageXhtml = html;
          } else {
            console.warn(`[Job ${jobId}] No text data for page ${actualPageNum}, creating empty page`);
            const emptyPage = {
              pageNumber: actualPageNum,
              text: '',
              textBlocks: [],
              width: pageWidthPoints,
              height: pageHeightPoints
            };
            const imageForGeneration = pageImage || { pageNumber: actualPageNum, fileName: '', path: '', epubPath: '' };
            const { html } = this.generateHtmlBasedPageXHTML(
              emptyPage,
              imageForGeneration,
              actualPageNum,
              pageWidthPoints,
              pageHeightPoints,
              pageWidthPoints * (300/72),
              pageHeightPoints * (300/72),
              false
            );
            pageXhtml = html;
          }
        }
        
        // Sanitize XHTML before adding
        const { EpubService } = await import('./epubService.js');
        pageXhtml = EpubService.sanitizeXhtml(pageXhtml);
        zip.file(`OEBPS/${fileName}`, pageXhtml);
        
        // Handle syncs and audio for this page (similar to the image-based flow)
        let syncs = [];
        let audioFileName = null;
        let pageAudioFileExists = false;
        
        try {
          const { AudioSyncModel } = await import('../models/AudioSync.js');
          const dbSyncs = await AudioSyncModel.findByJobId(jobId);
          
          const pageSyncs = dbSyncs
            .filter(sync => sync.page_number === actualPageNum)
            .filter(sync => {
              const notes = sync.notes || '';
              return !notes.includes('Read-aloud: disabled');
            })
            .map(sync => ({
              id: sync.block_id || sync.id,
              blockId: sync.block_id,
              clipBegin: sync.start_time,
              clipEnd: sync.end_time,
              startTime: sync.start_time,
              endTime: sync.end_time,
              shouldRead: !(sync.notes || '').includes('Read-aloud: disabled')
            }));
          
          if (pageSyncs.length > 0) {
            syncs = pageSyncs;
            const firstSync = dbSyncs.find(s => s.page_number === actualPageNum);
            if (firstSync && firstSync.audio_file_path) {
              let audioPath = firstSync.audio_file_path;
              if (path.isAbsolute(audioPath)) {
                audioPath = path.basename(audioPath);
              }
              audioPath = audioPath.replace(/^audio\//, '');
              
              // Extract just the filename for EPUB path (avoid absolute path issues)
              const audioFileNameOnly = path.basename(audioPath);
              
              if (audioFileNameOnly.includes('combined_audio')) {
                audioFileName = `audio/combined_audio_${jobId}.mp3`;
              } else {
                audioFileName = `audio/${audioFileNameOnly}`;
              }
              
              const { getTtsOutputDir, getUploadDir } = await import('../config/fileStorage.js');
              let audioFilePath = null;
              
              // Check if original path is absolute and exists
              const originalPath = firstSync.audio_file_path;
              if (path.isAbsolute(originalPath)) {
                try {
                  await fs.access(originalPath);
                  audioFilePath = originalPath;
                } catch (err) {
                  // Absolute path doesn't exist, try relative paths
                  audioFilePath = null;
                }
              }
              
              // If absolute path didn't work, try relative paths
              if (!audioFilePath) {
                if (audioFileNameOnly.includes('combined_audio') || audioFileNameOnly.startsWith('combined_audio_')) {
                  const ttsDir = getTtsOutputDir();
                  audioFilePath = path.join(ttsDir, `combined_audio_${jobId}.mp3`);
                } else {
                  const uploadDir = getUploadDir();
                  audioFilePath = path.join(uploadDir, 'audio', audioFileNameOnly);
                }
              }
              
              try {
                await fs.access(audioFilePath);
                const audioData = await fs.readFile(audioFilePath);
                zip.file(`OEBPS/${audioFileName}`, audioData);
                manifestItems.push(`<item id="audio-page-${actualPageNum}" href="${audioFileName}" media-type="audio/mpeg"/>`);
                hasAudio = true;
                pageAudioFileExists = true;
              } catch (audioError) {
                console.warn(`[Job ${jobId}] Audio file not found at ${audioFilePath} for page ${actualPageNum}`);
                syncs = [];
                audioFileName = null;
                pageAudioFileExists = false;
              }
            }
          }
        } catch (dbError) {
          // No syncs - that's OK
        }
        
        // Generate SMIL if we have syncs
        const activeSyncs = syncs.filter(sync => sync.shouldRead !== false);
        let hasSmil = false;
        const smilItemId = `smil-page${actualPageNum}`;
        
        // Debug logging for SMIL generation
        console.log(`[Job ${jobId}] Page ${actualPageNum} SMIL check: syncs=${syncs.length}, activeSyncs=${activeSyncs.length}, audioFileName=${audioFileName}, pageAudioFileExists=${pageAudioFileExists}`);
        
        if (activeSyncs.length > 0 && audioFileName && pageAudioFileExists) {
          hasSmil = true;
          const smilFileName = `page_${actualPageNum}.smil`;
          console.log(`[Job ${jobId}] Generating SMIL for page ${actualPageNum}: ${activeSyncs.length} active syncs, audio=${audioFileName}`);
          const smilContent = this.generateSMILContent(
            actualPageNum,
            activeSyncs,
            audioFileName,
            textData,
            {},
            fileName
          );
          zip.file(`OEBPS/${smilFileName}`, smilContent);
          smilFileNames.push(smilFileName);
          manifestItems.push(`<item id="${smilItemId}" href="${smilFileName}" media-type="application/smil+xml"/>`);
          console.log(`[Job ${jobId}] ✓ SMIL file generated: ${smilFileName}`);
        } else {
          if (activeSyncs.length === 0) {
            console.warn(`[Job ${jobId}] Page ${actualPageNum}: No active syncs (total syncs: ${syncs.length})`);
          }
          if (!audioFileName) {
            console.warn(`[Job ${jobId}] Page ${actualPageNum}: No audioFileName set`);
          }
          if (!pageAudioFileExists) {
            console.warn(`[Job ${jobId}] Page ${actualPageNum}: Audio file does not exist (pageAudioFileExists=false)`);
          }
        }
        
        const itemId = `page${actualPageNum}`;
        const pageProps = [];
        pageProps.push('rendition:layout-fixed');
        if (hasAudio) pageProps.push('rendition:page-spread-center');
        if (hasSmil) pageProps.push('media-overlay');
        const propsAttr = pageProps.length ? ` properties="${pageProps.join(' ')}"` : '';
        const mediaOverlayAttr = hasSmil ? ` media-overlay="${smilItemId}"` : '';
        manifestItems.push(`<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml"${propsAttr}${mediaOverlayAttr}/>`);
        const spineMediaOverlay = hasSmil ? ` media-overlay="${smilItemId}"` : '';
        spineItems.push(`<itemref idref="${itemId}"${spineMediaOverlay}/>`);
        tocItems.push(`<li><a href="${fileName}">Page ${actualPageNum}</a></li>`);
      }
    }
    
    // STEP 2 (original): Generate XHTML pages ONLY for pages with successfully added images
    for (let i = 0; i < pageImages.length; i++) {
      const pageImage = pageImages[i];
      const epubPageNum = pageImage.pageNumber;
      const pdfPageNum = pageImage.pdfPageNumber || pageImage.pageNumber;
      
      // CRITICAL: Only generate page if image was successfully added
      if (!successfullyAddedImages.has(epubPageNum)) {
        console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Image not found or failed to add, skipping page generation`);
        continue; // Skip this page if image is missing
      }
      
      let page = null;
      
      // PRIMARY: Match by exact page number (most reliable)
      page = textData.pages.find(p => p.pageNumber === epubPageNum);
      
      if (!page) {
        page = textData.pages.find(p => p.pageNumber === pdfPageNum);
      }
      
      // SECONDARY: Match by array index ONLY if page numbers match exactly
      // This prevents text bleeding from wrong pages
      if (!page && i < textData.pages.length) {
        const pageByIndex = textData.pages[i];
        // STRICT: Only use if page numbers match exactly (no tolerance)
        if (pageByIndex && pageByIndex.pageNumber === epubPageNum) {
          console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): Using text from array index ${i} (exact match: textData.pageNumber=${pageByIndex.pageNumber})`);
          page = pageByIndex;
        } else if (pageByIndex) {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Array index ${i} has pageNumber=${pageByIndex.pageNumber} (mismatch, skipping to prevent text bleeding)`);
        }
      }
      
      // TERTIARY: Try index-based fallback ONLY if pageNumber matches exactly
      if (!page && epubPageNum > 0 && textData.pages[epubPageNum - 1]) {
        const pageByIndex = textData.pages[epubPageNum - 1];
        // STRICT: Only use if page numbers match exactly
        if (pageByIndex.pageNumber === epubPageNum) {
          console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): Using text from index ${epubPageNum - 1} (exact match: textData.pageNumber=${pageByIndex.pageNumber})`);
          page = pageByIndex;
        } else {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Index ${epubPageNum - 1} has pageNumber=${pageByIndex.pageNumber} (mismatch, skipping to prevent text bleeding)`);
        }
      }
      
      // LAST RESORT: Create empty page if no exact match found
      if (!page) {
        console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): No exact matching text data found, creating EMPTY page (no text will be displayed)`);
        page = {
          pageNumber: epubPageNum,
          text: '', // Empty text - no fallback text
          textBlocks: [], // Empty textBlocks
          charCount: 0,
          width: pageWidthPoints,
          height: pageHeightPoints
        };
      } else {
        // VALIDATION: If matched page has different pageNumber, reject it to prevent text bleeding
        if (page.pageNumber !== epubPageNum && page.pageNumber !== pdfPageNum) {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Matched page has pageNumber=${page.pageNumber} (mismatch detected, using empty page to prevent text bleeding)`);
          page = {
            pageNumber: epubPageNum,
            text: '',
            textBlocks: [],
            charCount: 0,
            width: pageWidthPoints,
            height: pageHeightPoints
          };
        }
      }
      
      const hasText = page.text && page.text.trim().length > 0;
      const hasTextBlocks = page.textBlocks && page.textBlocks.length > 0;
      const textPreview = page.text ? page.text.substring(0, 100).replace(/\n/g, ' ') : '';
      const pageMatchStatus = page.pageNumber === epubPageNum ? 'EXACT_MATCH' : 
                              page.pageNumber === pdfPageNum ? 'PDF_PAGE_MATCH' : 
                              hasTextBlocks || hasText ? 'MISMATCH_WARNING' : 'EMPTY_PAGE';
      console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF ${pdfPageNum}): Match=${pageMatchStatus}, textData.pageNumber=${page.pageNumber}, textBlocks=${page.textBlocks?.length || 0}, textLength=${page.text?.length || 0}, preview="${textPreview.substring(0, 50)}..."`);
      
      // CRITICAL WARNING if page numbers don't match but text exists
      if (page.pageNumber !== epubPageNum && page.pageNumber !== pdfPageNum && (hasTextBlocks || hasText)) {
        console.error(`[Job ${jobId}] ⚠️ PAGE MISMATCH DETECTED: EPUB Page ${epubPageNum} matched with textData.pageNumber=${page.pageNumber} - This may cause text bleeding!`);
      }
      
      const actualPageNum = epubPageNum;
      page.pageNumber = actualPageNum;
      
      if (page.textBlocks && Array.isArray(page.textBlocks)) {
        page.textBlocks.forEach(block => {
          block.pageNumber = actualPageNum;
          if (block.boundingBox) {
            block.boundingBox.pageNumber = actualPageNum;
          }
        });
      }
      
      const fileName = `page_${actualPageNum}.xhtml`;
      
      const actualPageWidthPoints = page.width || pageWidthPoints;
      const actualPageHeightPoints = page.height || pageHeightPoints;
      
      const dpi = 300;
      const scale = dpi / 72;
      const actualRenderedWidth = Math.ceil(actualPageWidthPoints * scale);
      const actualRenderedHeight = Math.ceil(actualPageHeightPoints * scale);
      
      const pageCss = this.generateFixedLayoutCSS(
        actualPageWidthPoints,
        actualPageHeightPoints,
        actualRenderedWidth,
        actualRenderedHeight,
        hasAudio
      );
      
      // Generate XHTML and get ID mapping for SMIL sync
      // Use HTML-based pages with page image background for pixel-perfect layout
      const { html: rawPageXhtml, idMapping } = this.generateHtmlBasedPageXHTML(
        page,
        pageImage,
        actualPageNum,
        actualPageWidthPoints,
        actualPageHeightPoints,
        actualRenderedWidth,
        actualRenderedHeight,
        hasAudio
      );
      // Guard against accidental concatenation (trim anything after closing </html>)
      const pageXhtml = rawPageXhtml && rawPageXhtml.includes('</html>')
        ? rawPageXhtml.slice(0, rawPageXhtml.indexOf('</html>') + 7)
        : rawPageXhtml;
      
      // Store ID mapping for this page (for SMIL generation)
      if (!pageIdMappings) {
        pageIdMappings = {};
      }
      pageIdMappings[actualPageNum] = idMapping;
      
      zip.file(`OEBPS/${fileName}`, pageXhtml);
      
      // --- Syncs and audio (editorial override > TTS) ---
      let syncs = [];
      let audioFileName = null;
      let pageAudioFileExists = false; // Track if THIS page's audio file exists
      const orderedBlocks = (page.textBlocks || []).slice().sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
      
      // Check both locations for editorial syncs: job-specific and global
      const jobSyncDir = path.join(epubOutputDir, `job_${jobId}`, 'editorial_syncs');
      const jobSyncFilePath = path.join(jobSyncDir, `manual_page_syncs_${actualPageNum}.json`);
      const globalSyncFilePath = path.join(getHtmlIntermediateDir(), 'editorial_syncs', `manual_page_syncs_${actualPageNum}.json`);

      try {
        let syncData = null;
        // Try job-specific location first, then global
        try {
          syncData = await fs.readFile(jobSyncFilePath, 'utf8');
        } catch {
          syncData = await fs.readFile(globalSyncFilePath, 'utf8');
        }
        syncs = JSON.parse(syncData);
        audioFileName = `audio/page_${actualPageNum}_human.mp3`;
        console.log(`[Job ${jobId}] Loaded editorial syncs for page ${actualPageNum}.`);
        
        // Copy human audio file to EPUB if it exists
        const humanAudioPath = path.join(audioDir, `page_${actualPageNum}_human.mp3`);
        try {
          const audioData = await fs.readFile(humanAudioPath);
          zip.file(`OEBPS/${audioFileName}`, audioData);
          
          // Manifest entry for audio
          manifestItems.push(`<item id="audio-page-${actualPageNum}" href="${audioFileName}" media-type="audio/mpeg"/>`);
          hasAudio = true;
          pageAudioFileExists = true;
          console.log(`[Job ${jobId}] Added human audio file for page ${actualPageNum} to EPUB.`);
        } catch (audioError) {
          console.warn(`[Job ${jobId}] Human audio file not found at ${humanAudioPath}. Skipping SMIL generation to prevent auto-play without audio.`);
          // Clear syncs and audioFileName if audio doesn't exist - don't create SMIL without audio
          syncs = [];
          audioFileName = null;
          pageAudioFileExists = false;
        }
      } catch (e) {
        // No editorial syncs found - check database for TTS-generated or user-uploaded audio syncs
        try {
          const { AudioSyncModel } = await import('../models/AudioSync.js');
          const dbSyncs = await AudioSyncModel.findByJobId(jobId);
          
          // Filter syncs for this page and only those with shouldRead enabled
          const pageSyncs = dbSyncs
            .filter(sync => {
              const syncPageNum = sync.page_number || sync.pageNumber;
              return syncPageNum === actualPageNum;
            })
            .filter(sync => {
              // Check notes field for "Read-aloud: disabled" - if present, exclude it
              const notes = sync.notes || '';
              return !notes.includes('Read-aloud: disabled');
            })
            .map(sync => ({
              id: sync.block_id || sync.id,
              blockId: sync.block_id, // This should be the granular ID (e.g., "p1_s1")
              block_id: sync.block_id, // Keep both for compatibility
              clipBegin: sync.start_time || sync.startTime,
              clipEnd: sync.end_time || sync.endTime,
              startTime: sync.start_time || sync.startTime,
              endTime: sync.end_time || sync.endTime,
              shouldRead: !(sync.notes || '').includes('Read-aloud: disabled')
            }));
          
          console.log(`[Job ${jobId}] Page ${actualPageNum}: Found ${pageSyncs.length} syncs after filtering`);
          
          if (pageSyncs.length > 0) {
            syncs = pageSyncs;
            // Get audio file path from first sync
            const firstSync = dbSyncs.find(s => s.page_number === actualPageNum);
            if (firstSync && firstSync.audio_file_path) {
              // Extract audio file name and ensure it's in the right format
              const originalAudioPath = firstSync.audio_file_path;
              let audioFilePath = null;
              
              // Check if original path is absolute and exists
              if (path.isAbsolute(originalAudioPath)) {
                try {
                  await fs.access(originalAudioPath);
                  audioFilePath = originalAudioPath;
                  // Extract just the filename for EPUB path
                  const audioFileNameOnly = path.basename(originalAudioPath);
                  if (audioFileNameOnly.includes('combined_audio')) {
                    audioFileName = `audio/combined_audio_${jobId}.mp3`;
                  } else {
                    audioFileName = `audio/${audioFileNameOnly}`;
                  }
                } catch (err) {
                  // Absolute path doesn't exist, try relative paths
                  audioFilePath = null;
                }
              }
              
              // If absolute path didn't work, try relative paths
              if (!audioFilePath) {
                let audioPath = originalAudioPath;
                
                // Remove any leading "audio/" prefix if present
                audioPath = audioPath.replace(/^audio\//, '');
                
                // Remove absolute path prefix if somehow still present
                if (path.isAbsolute(audioPath)) {
                  audioPath = path.basename(audioPath);
                }
                
                if (audioPath.includes('combined_audio')) {
                  audioFileName = `audio/combined_audio_${jobId}.mp3`;
                } else {
                  audioFileName = `audio/${audioPath}`;
                }
                
                // Check if audio file exists and add to EPUB
                const { getTtsOutputDir, getUploadDir } = await import('../config/fileStorage.js');
                
                // Try TTS output dir first (for combined_audio files)
                if (audioPath.includes('combined_audio') || audioPath.startsWith('combined_audio_')) {
                  const ttsDir = getTtsOutputDir();
                  audioFilePath = path.join(ttsDir, `combined_audio_${jobId}.mp3`);
                } else {
                  // Try uploads/audio dir
                  const uploadDir = getUploadDir();
                  audioFilePath = path.join(uploadDir, 'audio', audioPath);
                }
              }
              
              try {
                // Check if file exists before trying to read
                await fs.access(audioFilePath);
                const audioData = await fs.readFile(audioFilePath);
                zip.file(`OEBPS/${audioFileName}`, audioData);
                manifestItems.push(`<item id="audio-page-${actualPageNum}" href="${audioFileName}" media-type="audio/mpeg"/>`);
                hasAudio = true;
                pageAudioFileExists = true;
                console.log(`[Job ${jobId}] Loaded ${pageSyncs.length} database syncs for page ${actualPageNum} (${pageSyncs.filter(s => s.shouldRead).length} enabled).`);
              } catch (audioError) {
                console.warn(`[Job ${jobId}] Audio file not found at ${audioFilePath}. Skipping SMIL generation.`);
                console.warn(`[Job ${jobId}] Original audio_file_path was: ${firstSync.audio_file_path}`);
                syncs = [];
                audioFileName = null;
                pageAudioFileExists = false;
              }
            }
          } else {
            console.log(`[Job ${jobId}] Page ${actualPageNum}: No database syncs found for this page`);
            syncs = [];
          }
        } catch (dbError) {
          console.warn(`[Job ${jobId}] Page ${actualPageNum}: Error loading syncs from database:`, dbError.message);
          syncs = [];
        }
      }

      // Generate SMIL for audio syncs (both human-recorded and TTS-generated with granular control)
      // Only generate if we have syncs AND audio file exists
      // Filter syncs to only include those with shouldRead === true (or not explicitly disabled)
      const activeSyncs = syncs.filter(sync => {
        // Check shouldRead flag if present
        if (sync.shouldRead !== undefined) {
          return sync.shouldRead === true;
        }
        // Default to true if not specified (backward compatibility)
        return true;
      });
      
      let hasSmil = false;
      const smilItemId = `smil-page${actualPageNum}`;
      
      // Debug logging for SMIL generation
      console.log(`[Job ${jobId}] Page ${actualPageNum} SMIL check: syncs=${syncs.length}, activeSyncs=${activeSyncs.length}, audioFileName=${audioFileName}, pageAudioFileExists=${pageAudioFileExists}`);
      
      // Generate SMIL if we have active syncs AND audio file exists
      if (activeSyncs.length > 0 && audioFileName && pageAudioFileExists) {
        hasSmil = true;
        const smilFileName = `page_${actualPageNum}.smil`;
        console.log(`[Job ${jobId}] Generating SMIL for page ${actualPageNum}: ${activeSyncs.length} active syncs, audio=${audioFileName}`);
        // Get XHTML content for reading order (from epubXhtmlPages if available)
        const pageXhtmlContent = epubXhtmlPages?.find(p => p.pageNumber === actualPageNum)?.xhtml || null;
        const smilContent = this.generateSMILContent(
          actualPageNum,
          activeSyncs, // Use filtered active syncs only (respects shouldRead flags)
          audioFileName,
          textData,
          pageIdMappings[actualPageNum],
          fileName, // Pass XHTML filename for textref
          null, // targetGranularity (not specified here)
          pageXhtmlContent // Pass XHTML content for reading order
        );
        zip.file(`OEBPS/${smilFileName}`, smilContent);
        smilFileNames.push(smilFileName);
        // SMIL manifest item - ID is what XHTML will reference
        manifestItems.push(`<item id="${smilItemId}" href="${smilFileName}" media-type="application/smil+xml"/>`);
        console.log(`[Job ${jobId}] ✓ SMIL file generated: ${smilFileName}`);
      } else {
        if (activeSyncs.length === 0) {
          console.warn(`[Job ${jobId}] Page ${actualPageNum}: No active syncs (total syncs: ${syncs.length})`);
        }
        if (!audioFileName) {
          console.warn(`[Job ${jobId}] Page ${actualPageNum}: No audioFileName set`);
        }
        if (!pageAudioFileExists) {
          console.warn(`[Job ${jobId}] Page ${actualPageNum}: Audio file does not exist (pageAudioFileExists=false)`);
        }
      }

      const itemId = `page${actualPageNum}`;
      const pageProps = [];
      // Fixed-layout EPUB requires rendition:layout-fixed
      pageProps.push('rendition:layout-fixed');
      if (hasAudio) pageProps.push('rendition:page-spread-center');
      if (hasSmil) pageProps.push('media-overlay');
      const propsAttr = pageProps.length ? ` properties="${pageProps.join(' ')}"` : '';
      // CRITICAL: media-overlay must point to SMIL item ID, not filename
      const mediaOverlayAttr = hasSmil ? ` media-overlay="${smilItemId}"` : '';
      manifestItems.push(`<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml"${propsAttr}${mediaOverlayAttr}/>`);
      // Spine itemref should also have media-overlay
      const spineMediaOverlay = hasSmil ? ` media-overlay="${smilItemId}"` : '';
      spineItems.push(`<itemref idref="${itemId}"${spineMediaOverlay}/>`);
      tocItems.push(`<li><a href="${fileName}">Page ${actualPageNum}</a></li>`);
    }
    
    // Images are now added BEFORE page generation (see STEP 1 above)
    // No need to add them again here
    
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Navigation</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <nav epub:type="toc" id="toc" hidden="true">
    <ol></ol>
  </nav>
</body>
</html>`;
    zip.file('OEBPS/nav.xhtml', navXhtml);
    
    let audioFileName = null;
    // smilFileNames already declared above (line 619)
    if (audioSyncs && audioSyncs.length > 0) {
      const firstSync = audioSyncs[0];
      const audioFilePath = firstSync.audioFilePath || firstSync.audio_file_path;
      
      if (audioFilePath) {
        // Fix audio file path - handle relative paths correctly
        let actualAudioFilePath = audioFilePath;
        
        // If path is relative (starts with 'audio/'), try to find it in uploads directory
        if (!path.isAbsolute(audioFilePath) && audioFilePath.startsWith('audio/')) {
          const { getUploadDir } = await import('../config/fileStorage.js');
          const uploadDir = getUploadDir();
          const audioFileNameOnly = path.basename(audioFilePath);
          actualAudioFilePath = path.join(uploadDir, 'audio', audioFileNameOnly);
        }
        
        try {
          await fs.access(actualAudioFilePath);
          const audioData = await fs.readFile(actualAudioFilePath);
          const audioExt = path.extname(actualAudioFilePath) || '.mp3';
          audioFileName = `audio/audio_${jobId}${audioExt}`;
          zip.file(`OEBPS/${audioFileName}`, audioData);
          
          let audioMimeType = 'audio/mpeg';
          if (audioExt === '.wav') audioMimeType = 'audio/wav';
          else if (audioExt === '.ogg') audioMimeType = 'audio/ogg';
          else if (audioExt === '.m4a') audioMimeType = 'audio/mp4';
          
          manifestItems.push(`<item id="audio" href="${audioFileName}" media-type="${audioMimeType}"/>`);
          
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
            // Get ID mapping for this page
            const pageIdMapping = pageIdMappings?.[parseInt(pageNum)] || {};
            const pageXhtmlFileName = `page_${pageNum}.xhtml`;
            // Get XHTML content for reading order (from epubXhtmlPages if available)
            const pageXhtmlContent = epubXhtmlPages?.find(p => p.pageNumber === parseInt(pageNum))?.xhtml || null;
            // Pass granularity to filter syncs at the desired level (word/sentence/paragraph)
            const smilContent = this.generateSMILContent(parseInt(pageNum), pageSyncs, audioFileName, textData, pageIdMapping, pageXhtmlFileName, granularity, pageXhtmlContent);
            zip.file(`OEBPS/${smilFileName}`, smilContent);
            smilFileNames.push(smilFileName);
            // Use page${pageNum} format to match spine itemref idref
            manifestItems.push(`<item id="smil-page${pageNum}" href="${smilFileName}" media-type="application/smil+xml"/>`);
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
    
    // Log SMIL generation summary
    console.log(`[Job ${jobId}] 📊 SMIL Generation Summary: ${smilFileNames.length} SMIL files generated`);
    if (smilFileNames.length > 0) {
      console.log(`[Job ${jobId}] ✓ SMIL files: ${smilFileNames.join(', ')}`);
    } else {
      console.warn(`[Job ${jobId}] ⚠️ No SMIL files were generated. Possible reasons:`);
      console.warn(`[Job ${jobId}]   - No syncs found in database`);
      console.warn(`[Job ${jobId}]   - Audio files not found`);
      console.warn(`[Job ${jobId}]   - All syncs have shouldRead=false`);
    }
    
    const sharedCss = this.generateFixedLayoutCSS(
      pageWidthPoints,
      pageHeightPoints,
      renderedWidth,
      renderedHeight
    );
    zip.file('OEBPS/css/fixed-layout.css', sharedCss);
    if (!manifestItems.some(item => item.includes('css/fixed-layout.css'))) {
      manifestItems.push(`<item id="css-shared" href="css/fixed-layout.css" media-type="text/css"/>`);
    }
    
    const contentOpf = this.generateFixedLayoutContentOpf(
      jobId,
      docTitle,
      manifestItems,
      spineItems,
      pageWidthPoints,
      pageHeightPoints,
      renderedWidth,
      renderedHeight,
      smilFileNames,
      hasAudio
    );
    zip.file('OEBPS/content.opf', contentOpf);
    
    if (manifestItems.length === 0) {
      throw new Error('EPUB manifest is empty - no content items found');
    }
    if (spineItems.length === 0) {
      throw new Error('EPUB spine is empty - no pages to display');
    }
    
    console.log(`[Job ${jobId}] EPUB structure: ${manifestItems.length} manifest items, ${spineItems.length} spine items, ${pageImages.length} images`);
    
    const epubBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      streamFiles: false,
      createFolders: false
    });
    
    console.log(`[Job ${jobId}] EPUB buffer generated: ${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    return epubBuffer;
  }
  
  /**
   * ✅ FIXED: TTS Read-Aloud Now Works
   * - Removed hidden="true" attribute
   * - Changed CSS to normal document flow
   * - Using allTextForTTS for clean text
   * - Position: relative (not absolute/fixed)
   * - No clipping (overflow: visible)
   */
  static generateFixedLayoutPageXHTML(page, pageImage, pageNumber, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, pageCss = null, hasAudio = false) {
    // Track ID mappings: blockId -> actual XHTML element ID
    const idMapping = {};
    let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>`;
    
    // Use simple viewport for reflowable content
    html += `
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Page ${pageNumber}</title>`;
    
    // 4-Layer Image Text Highlighting System CSS
    const simpleCss = `/*<![CDATA[*/
    body { font-family: Arial, sans-serif; margin: 20px; }
    .page-image { max-width: 100%; height: auto; margin-bottom: 20px; display: block; }
    .text-content { margin-top: 20px; }
    .text-content p, .text-content h1, .text-content h2, .text-content h3 { margin: 10px 0; }
    
    /* 4-LAYER IMAGE TEXT HIGHLIGHTING SYSTEM */
    
    /* LAYER 1: IMAGE LAYER (z-index: 1) - PDF page image */
    .image-container { 
      position: relative; 
      display: inline-block; 
      max-width: 100%; 
      width: 100%;
      line-height: 0;
    }
    .image-container img {
      display: block;
      width: 100%;
      height: auto;
      position: relative;
      z-index: 1;
    }
    
    /* LAYER 2: HIGHLIGHT LAYER (z-index: 2) - Transparent rectangles over image text */
    .highlight-overlays { 
      position: absolute; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      pointer-events: auto; /* Allow click interaction */
      z-index: 2;
      overflow: hidden;
    }
    .text-highlight-overlay { 
      position: absolute; 
      background-color: transparent; 
      border: 2px solid transparent;
      transition: all 0.3s ease;
      pointer-events: auto; /* Allow click to highlight */
      cursor: pointer;
      z-index: 2;
      box-sizing: border-box;
      opacity: 1;
      /* Smooth animations */
      will-change: background-color, border-color, box-shadow;
    }
    
    /* User click highlight (yellow) */
    .text-highlight-overlay.user-highlight {
      background-color: rgba(255, 255, 0, 0.4) !important;
      border-color: rgba(255, 200, 0, 0.8) !important;
      box-shadow: 0 0 8px rgba(255, 255, 0, 0.6) !important;
    }
    
    /* Multiple highlight colors */
    .text-highlight-overlay.highlight-yellow {
      background-color: rgba(255, 255, 0, 0.4) !important;
      border-color: rgba(255, 200, 0, 0.8) !important;
    }
    .text-highlight-overlay.highlight-green {
      background-color: rgba(0, 255, 0, 0.4) !important;
      border-color: rgba(0, 200, 0, 0.8) !important;
    }
    .text-highlight-overlay.highlight-pink {
      background-color: rgba(255, 192, 203, 0.4) !important;
      border-color: rgba(255, 150, 150, 0.8) !important;
    }
    .text-highlight-overlay.highlight-blue {
      background-color: rgba(173, 216, 230, 0.4) !important;
      border-color: rgba(100, 150, 255, 0.8) !important;
    }
    
    /* Active highlighting (when audio is playing) - EPUB 3 standard classes */
    .text-highlight-overlay.-epub-media-overlay-active,
    .text-highlight-overlay.epub-media-overlay-active,
    .text-highlight-overlay[class*="epub-media-overlay-active"] {
      background-color: rgba(255, 255, 0, 0.6) !important;
      border-color: rgba(255, 200, 0, 1) !important;
      box-shadow: 0 0 12px rgba(255, 255, 0, 0.8), 0 0 20px rgba(255, 255, 0, 0.4) !important;
      opacity: 1 !important;
      /* Pulse animation for read-aloud */
      animation: highlightPulse 1.5s ease-in-out infinite;
    }
    
    /* Playing state with stronger pulse */
    .text-highlight-overlay.-epub-media-overlay-playing,
    .text-highlight-overlay.epub-media-overlay-playing,
    .text-highlight-overlay[class*="epub-media-overlay-playing"] {
      background-color: rgba(255, 255, 0, 0.7) !important;
      border-color: rgba(255, 150, 0, 1) !important;
      box-shadow: 0 0 15px rgba(255, 255, 0, 1), 0 0 30px rgba(255, 255, 0, 0.6) !important;
      animation: highlightPulse 1s ease-in-out infinite;
    }
    
    /* Pulse animation for read-aloud */
    @keyframes highlightPulse {
      0%, 100% { 
        box-shadow: 0 0 12px rgba(255, 255, 0, 0.8), 0 0 20px rgba(255, 255, 0, 0.4);
      }
      50% { 
        box-shadow: 0 0 18px rgba(255, 255, 0, 1), 0 0 30px rgba(255, 255, 0, 0.7);
      }
    }
    
    /* LAYER 3: SELECTION LAYER (z-index: 3) - Invisible but selectable text */
    .selection-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none; /* Don't block clicks, but allow text selection */
      z-index: 3;
      overflow: hidden;
    }
    .selectable-text {
      position: absolute;
      color: transparent;
      opacity: 0.001; /* Nearly invisible but still selectable */
      user-select: text;
      -webkit-user-select: text;
      pointer-events: auto;
      z-index: 3;
      font-size: inherit;
      line-height: inherit;
      white-space: nowrap;
    }
    
    /* Visible text overlay - shows actual text on image at PDF coordinates */
    .visible-text-overlay {
      color: #000 !important;
      opacity: 1 !important;
      background: transparent !important;
      text-shadow: 0 0 2px rgba(255, 255, 255, 0.8), 0 0 2px rgba(255, 255, 255, 0.8); /* White outline for readability */
      -webkit-text-stroke: 0.3px rgba(255, 255, 255, 0.5); /* Subtle white stroke */
    }
    
    /* LAYER 4: TTS LAYER (z-index: 4) - Hidden text for screen readers */
    .tts-layer {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      z-index: 4;
    }
    
    /* Glow effect for active highlights */
    .text-highlight-overlay.active-glow {
      filter: drop-shadow(0 0 8px rgba(255, 255, 0, 0.8));
    }
/*]]>*/`;
    
    html += `
  <style type="text/css">${simpleCss}</style>
</head>
<body class="fixed-layout-page" id="page${pageNumber}">
  <div class="page-container">`;
    
    // Pre-collect text for flow layer (we'll populate this as we process blocks)
    const allTextForTTS = [];
    
    // First, collect text from textBlocks if available
    let textBlocks = (page.textBlocks || []).filter(block => {
      const blockPageNum = block.pageNumber || block.boundingBox?.pageNumber;
      const belongsToPage = !blockPageNum || blockPageNum === pageNumber;
      return belongsToPage;
    });
    
    // CRITICAL: Only create fallback text blocks if page.text is non-empty
    // This prevents generating text for blank/empty pages
    const hasPageText = page.text && page.text.trim().length > 0;
    
    if (textBlocks.length === 0 && hasPageText) {
      let cleanText = page.text;
      cleanText = cleanText.replace(/^(Page\s+)?\d+\s*$/gm, '');
      cleanText = cleanText.replace(/^Page\s+\d+[:\-]?\s*/gmi, '');
      cleanText = cleanText.trim();
      
      // Only create blocks if cleaned text is not empty
      if (cleanText.length > 0) {
        textBlocks = GeminiService.createSimpleTextBlocks(
          cleanText || page.text,
          pageNumber,
          pageWidthPoints,
          pageHeightPoints
        );
      }
    }
    
    // Emergency fallback ONLY if page.text exists and is non-empty
    if (textBlocks.length === 0 && hasPageText) {
      const trimmedText = page.text.trim();
      if (trimmedText.length > 0 && !trimmedText.match(/^Page\s+\d+[:\-]?\s*$/i)) {
        textBlocks = [{
          id: `emergency_block_${pageNumber}`,
          text: trimmedText,
          type: 'paragraph',
          level: null,
          isSimple: true,
          boundingBox: null,
          fontSize: 22,
          fontName: 'Arial',
          isBold: false,
          isItalic: false,
          readingOrder: 0,
          pageNumber: pageNumber
        }];
      }
    }
    
    // Final validation: If no textBlocks and no page.text, ensure we don't generate text
    if (textBlocks.length === 0 && !hasPageText) {
      console.log(`[Job ${pageNumber}] Page ${pageNumber}: No text blocks and no page.text - generating empty page (no text content)`);
    }
    
    // Collect all text for TTS flow layer
    for (const block of textBlocks) {
      if (block.text && block.text.trim().length > 0) {
        allTextForTTS.push(block.text.trim());
      }
    }
    
    // Generate flow text FIRST (before fixed layout)
    let ttsFlowText = '';
    
    // Strategy 1: Use collected text from blocks
    if (allTextForTTS.length > 0) {
      ttsFlowText = allTextForTTS
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
      console.log(`[Page ${pageNumber}] TTS: Using ${allTextForTTS.length} text blocks (${ttsFlowText.length} chars)`);
    }
    
    // Strategy 2: Use page.text if available
    if (!ttsFlowText && page.text && page.text.trim().length > 0) {
      ttsFlowText = page.text
        .replace(/\s+/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
      console.log(`[Page ${pageNumber}] TTS: Using page.text (${ttsFlowText.length} chars)`);
    }
    
    // Add image with highlight overlays if available
    if (pageImage) {
      const imagePath = pageImage.epubPath || `image/${pageImage.fileName.replace(/^image\//, '')}`;
      
      // Calculate scale factor for positioning (from PDF points to rendered pixels)
      // Note: These are calculated but not used directly since we use percentage-based positioning
      // They're kept for potential future use or debugging
      
      // 4-LAYER IMAGE TEXT HIGHLIGHTING SYSTEM
      html += `
    <div class="image-container" style="position: relative; display: inline-block; width: 100%; max-width: 100%;">`;
      
      // LAYER 1: IMAGE LAYER (z-index: 1)
      html += `
      <img src="${this.escapeHtml(imagePath)}" alt="Page ${pageNumber}" class="page-image" style="display: block; width: 100%; height: auto; position: relative; z-index: 1;" />`;
      
      // LAYER 2: HIGHLIGHT LAYER (z-index: 2) - Transparent rectangles over image text
      html += `
      <div class="highlight-overlays" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; z-index: 2; overflow: hidden;">`;
      
      // LAYER 3: SELECTION LAYER (z-index: 3) - Invisible but selectable text
      html += `
      <div class="selection-layer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3; overflow: hidden;">`;
      
      // LAYER 4: TTS LAYER (z-index: 4) - Hidden text for screen readers
      html += `
      <div class="tts-layer" aria-hidden="true">`;
      
      // Generate all layers for each text block with bounding box
      if (textBlocks.length > 0) {
        for (let i = 0; i < textBlocks.length; i++) {
          const block = textBlocks[i];
          if (block.boundingBox && block.text && block.text.trim().length > 0) {
            const blockId = block.id || block.blockId || `ocr_block_${pageNumber}_${i}`;
            const bbox = block.boundingBox;
            const escapedText = this.escapeHtml(block.text.trim());
            
            // Convert PDF coordinates to percentage-based positioning
            const leftPercent = ((bbox.x / pageWidthPoints) * 100).toFixed(4);
            const topFromTop = pageHeightPoints - (bbox.y + bbox.height);
            const topPercent = Math.max(0, Math.min(100, ((topFromTop / pageHeightPoints) * 100))).toFixed(4);
            const widthPercent = Math.max(0, Math.min(100, ((bbox.width / pageWidthPoints) * 100))).toFixed(4);
            const heightPercent = Math.max(0, Math.min(100, ((bbox.height / pageHeightPoints) * 100))).toFixed(4);
            
            // LAYER 2: Highlight overlay rectangle
            html += `
        <div id="${blockId}-highlight" 
             class="text-highlight-overlay" 
             role="text"
             aria-label="${escapedText.substring(0, 50)}"
             data-block-id="${blockId}"
             data-text="${this.escapeHtml(block.text.trim())}"
             style="left: ${leftPercent}%; 
                    top: ${topPercent}%; 
                    width: ${widthPercent}%; 
                    height: ${heightPercent}%;"></div>`;
            
            // LAYER 3: Selectable text (invisible but selectable) - positioned exactly over highlight
            html += `
        <span class="selectable-text" 
              id="${blockId}-selectable"
              style="position: absolute;
                     left: ${leftPercent}%; 
                     top: ${topPercent}%; 
                     width: ${widthPercent}%; 
                     height: ${heightPercent}%;
                     display: flex;
                     align-items: center;
                     padding: 2px;">${escapedText}</span>`;
            
            // LAYER 4: TTS text (hidden for screen readers)
            html += `
        <span class="tts-text" aria-label="${escapedText.substring(0, 100)}">${escapedText}</span>`;
            
            // Map highlight element for SMIL
            idMapping[blockId] = `${blockId}-highlight`;
          }
        }
      }
      
      // Close all layers (tts-layer, selection-layer, highlight-overlays, image-container)
      html += `
      </div>
      </div>
      </div>
    </div>`;
    }
    
    // Start text-content div - ensure it's accessible for TTS
    // Use epub:type="bodymatter" to mark as main content for TTS
    html += `
    <div class="text-content" epub:type="bodymatter" role="main" aria-label="Page ${pageNumber} content">`;
    
    // Generate paragraphs from textBlocks for ideal structure
    // Use individual blocks as separate paragraphs (like the ideal structure)
    let paraIndex = 0;
    
    if (textBlocks.length > 0) {
      // Use textBlocks directly - each block becomes a paragraph
      for (let i = 0; i < textBlocks.length; i++) {
        const block = textBlocks[i];
        if (block.text && block.text.trim().length > 0) {
          const blockId = block.id || block.blockId || `ocr_block_${pageNumber}_${i}`;
          const escapedText = this.escapeHtml(block.text.trim());
          html += `
     <p id="${blockId}" lang="en" xml:lang="en">${escapedText}</p>`;
          
          // Map block ID for SMIL sync
          // If block has bounding box, mapping already points to highlight overlay
          // Otherwise, map to paragraph element
          if (!idMapping[blockId]) {
            idMapping[blockId] = blockId;
          }
          paraIndex++;
        }
      }
    }
    
    // Fallback: if no blocks, use collected text
    if (paraIndex === 0 && ttsFlowText && ttsFlowText.trim().length > 0) {
      const escapedText = this.escapeHtml(ttsFlowText.trim());
      // Split into sentences for better paragraph structure
      const sentences = escapedText.split(/([.!?]\s+(?=[A-Z]))/).filter(s => s.trim().length > 0);
      let currentPara = '';
      
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length < 3 && /^[.!?\s]+$/.test(trimmed)) {
          continue;
        }
        
        if ((currentPara + sentence).length > 500 && currentPara.length > 0) {
          const cleanPara = currentPara.trim().replace(/\s+/g, ' ');
          if (cleanPara.length > 10) {
            const blockId = `ocr_block_${pageNumber}_${paraIndex}`;
            html += `
     <p id="${blockId}" lang="en" xml:lang="en">${cleanPara}</p>`;
            paraIndex++;
          }
          currentPara = sentence;
        } else {
          currentPara += sentence;
        }
      }
      
      if (currentPara.trim().length > 0) {
        const cleanPara = currentPara.trim().replace(/\s+/g, ' ');
        if (cleanPara.length > 10) {
          const blockId = `ocr_block_${pageNumber}_${paraIndex}`;
          html += `
     <p id="${blockId}" lang="en" xml:lang="en">${cleanPara}</p>`;
            paraIndex++;
        }
      }
      
      // Final fallback: single paragraph
      if (paraIndex === 0) {
        const blockId = `ocr_block_${pageNumber}_0`;
        html += `
     <p id="${blockId}" lang="en" xml:lang="en">${escapedText}</p>`;
        paraIndex = 1;
      }
    }
    
    // Last resort fallback
    if (paraIndex === 0) {
      const fallbackText = page.text && page.text.trim().length > 0 
        ? page.text.trim().replace(/\s+/g, ' ')
        : `Page ${pageNumber}`;
      const escapedFallback = this.escapeHtml(fallbackText);
      const blockId = `ocr_block_${pageNumber}_0`;
      html += `
     <p id="${blockId}" lang="en" xml:lang="en">${escapedFallback}</p>`;
      paraIndex = 1;
    }
    
    console.log(`[Page ${pageNumber}] TTS: Added ${paraIndex} paragraphs in ideal structure`);
    
    // Close text-content and page-container divs
    html += `
    </div>
  </div>`;
    
    // Add JavaScript for image text highlighting interaction
    const pageIdStr = `page${pageNumber}`;
    const highlightScript = `
  <script type="text/javascript">
  /*<![CDATA[*/
  (function() {
    'use strict';
    
    // Image Text Highlighting System
    const HighlightManager = {
      currentColor: 'yellow',
      pageId: '${pageIdStr}',
      colors: {
        yellow: 'highlight-yellow',
        green: 'highlight-green',
        pink: 'highlight-pink',
        blue: 'highlight-blue'
      },
      
      init: function() {
        // Load saved highlights from localStorage
        this.loadHighlights();
        
        // Attach click handlers to all highlight overlays
        const overlays = document.querySelectorAll('.text-highlight-overlay');
        overlays.forEach(overlay => {
          overlay.addEventListener('click', this.handleHighlightClick.bind(this));
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboard.bind(this));
      },
      
      handleHighlightClick: function(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const overlay = event.currentTarget;
        const blockId = overlay.getAttribute('data-block-id');
        
        // Toggle highlight
        if (overlay.classList.contains('user-highlight')) {
          // Remove highlight
          Object.values(this.colors).forEach(colorClass => {
            overlay.classList.remove(colorClass);
          });
          overlay.classList.remove('user-highlight');
          this.removeHighlight(blockId);
        } else {
          // Add highlight
          overlay.classList.add('user-highlight', this.colors[this.currentColor]);
          this.saveHighlight(blockId, this.currentColor);
        }
      },
      
      handleKeyboard: function(event) {
        // Ctrl+H to cycle highlight colors
        if (event.ctrlKey && event.key === 'h') {
          event.preventDefault();
          const colors = Object.keys(this.colors);
          const currentIndex = colors.indexOf(this.currentColor);
          this.currentColor = colors[(currentIndex + 1) % colors.length];
        }
      },
      
      saveHighlight: function(blockId, color) {
        try {
          const key = 'highlights_' + this.pageId;
          let highlights = JSON.parse(localStorage.getItem(key) || '{}');
          highlights[blockId] = { color: color, timestamp: Date.now() };
          localStorage.setItem(key, JSON.stringify(highlights));
        } catch (e) {
          console.warn('Could not save highlight:', e);
        }
      },
      
      removeHighlight: function(blockId) {
        try {
          const key = 'highlights_' + this.pageId;
          let highlights = JSON.parse(localStorage.getItem(key) || '{}');
          delete highlights[blockId];
          localStorage.setItem(key, JSON.stringify(highlights));
        } catch (e) {
          console.warn('Could not remove highlight:', e);
        }
      },
      
      loadHighlights: function() {
        try {
          const key = 'highlights_' + this.pageId;
          const highlights = JSON.parse(localStorage.getItem(key) || '{}');
          
          Object.keys(highlights).forEach(blockId => {
            const highlight = highlights[blockId];
            const overlay = document.getElementById(blockId + '-highlight');
            if (overlay && highlight.color) {
              overlay.classList.add('user-highlight', this.colors[highlight.color]);
            }
          });
        } catch (e) {
          console.warn('Could not load highlights:', e);
        }
      }
    };
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        HighlightManager.init();
      });
    } else {
      HighlightManager.init();
    }
  })();
  /*]]>*/
  </script>`;
    
    html += highlightScript;
    html += `
</body>
</html>`;
    
    // Return both the generated XHTML string and the ID mapping for SMIL/TTS alignment
    return { html, idMapping };
  }

  /**
   * Generate HTML-based page that recreates PDF layout exactly using HTML/CSS
   * Instead of rendering as image, creates exact HTML replica with positioned text and images
   */
  static generateHtmlBasedPageXHTML(page, pageImage, pageNumber, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, hasAudio = false) {
    const idMapping = {};

    const safeRenderedWidth = renderedWidth && renderedWidth > 0
      ? renderedWidth
      : Math.ceil((pageWidthPoints || 612) * (300 / 72));
    const safeRenderedHeight = renderedHeight && renderedHeight > 0
      ? renderedHeight
      : Math.ceil((pageHeightPoints || 792) * (300 / 72));

    // Use 'images/' (plural) directory for EPUB standard
    const imagePath = pageImage
      ? (pageImage.epubPath || `images/${pageImage.fileName.replace(/^(image|images)\//, '')}`)
      : '';

    // Default to invisible overlays (text present for TTS/search, hidden visually)
    const overlayVisible = (process.env.TEXT_OVERLAY_VISIBLE || 'false').toLowerCase() === 'true';
    const overlayClass = overlayVisible ? '' : 'overlay-hidden';

    let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${safeRenderedWidth}px, height=${safeRenderedHeight}px, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Page ${pageNumber}</title>`;

    // CSS for exact PDF layout recreation (fixed layout, pixel perfect)
    const htmlCss = `/*<![CDATA[*/
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    html, body {
      margin: 0;
      padding: 0;
      width: ${safeRenderedWidth}px;
      height: ${safeRenderedHeight}px;
      overflow: hidden;
      background-color: white;
      font-family: Arial, sans-serif;
    }
    
    .page-container {
      position: relative;
      width: ${safeRenderedWidth}px;
      height: ${safeRenderedHeight}px;
      background-color: white;
      overflow: hidden;
    }
    
    .page-bg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      z-index: 1;
      pointer-events: none;
    }

    .text-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 2;
      pointer-events: none;
    }

    /* LAYER 2: Highlight Target (Invisible but positioned for highlighting) */
    /* These blocks are absolutely positioned to match text on the image */
    /* They are invisible but provide the target for highlight CSS activation */
    .text-block {
      position: absolute;
      margin: 0;
      padding: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
      /* CRITICAL: Make invisible but keep for highlighting */
      color: transparent !important;
      opacity: 0 !important;
      /* Keep pointer-events for potential interaction, but text is invisible */
      pointer-events: none;
      overflow: visible;
      z-index: 2;
    }
    
    /* When media overlay activates, make highlight visible */
    .text-block.-epub-media-overlay-active,
    .text-block.epub-media-overlay-active {
      /* Highlight becomes visible when active */
      background-color: rgba(255, 255, 0, 0.4) !important;
      outline: 2px solid rgba(255, 200, 0, 0.8) !important;
      /* Text remains invisible - only highlight box is visible */
      color: transparent !important;
      opacity: 1 !important; /* Make highlight visible */
    }
    
    /* TTS flow text (hidden but accessible) */
    .tts-flow-text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
    
    /* LAYER 3: TTS Source (Hidden but accessible for TTS engine) */
    /* This layer provides sequential text for the player's built-in TTS */
    /* CRITICAL: Must be accessible to TTS but visually hidden */
    /* Using "screen reader only" technique - text in normal flow but visually hidden */
    /* This is the most compatible approach for EPUB TTS engines */
    /* Position: static keeps it in normal document flow for TTS accessibility */
    .text-content {
      position: static;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      clip-path: inset(50%);
      white-space: nowrap;
      border-width: 0;
      /* Ensure it's accessible to screen readers and TTS */
      /* Do NOT use visibility:hidden or display:none - it breaks TTS */
      /* Text is in normal flow for maximum TTS compatibility */
    }
    
    .text-content p,
    .text-content h1,
    .text-content h2,
    .text-content h3,
    .text-content h4,
    .text-content h5,
    .text-content h6 {
      margin: 0;
      padding: 0;
      color: #000;
      /* Text must be visible to TTS engine */
      /* Do NOT use visibility:hidden or display:none */
      display: block;
      position: static;
      /* Ensure text is readable by TTS */
      white-space: normal;
      word-wrap: break-word;
      /* Make sure text is accessible */
      font-size: 1em;
      line-height: 1.2;
      /* Text is accessible but visually hidden via parent clipping */
    }
    
    /* Media overlay highlighting */
    .text-block.-epub-media-overlay-active,
    .text-block.epub-media-overlay-active {
      background-color: rgba(255, 255, 0, 0.4) !important;
      outline: 2px solid rgba(255, 200, 0, 0.8) !important;
    }
    
    .text-block.-epub-media-overlay-playing,
    .text-block.epub-media-overlay-playing {
      background-color: rgba(255, 255, 0, 0.6) !important;
      outline: 3px solid rgba(255, 150, 0, 1) !important;
    }
/*]]>*/`;

    html += `
  <style type="text/css">${htmlCss}</style>
</head>
<body class="html-based-page ${overlayClass}" id="page${pageNumber}">
  <div class="page-container">`;
    // Layer 1: full-page background image
    if (imagePath) {
      html += `
    <img src="${this.escapeHtml(imagePath)}" alt="Page ${pageNumber}" class="page-bg" aria-hidden="true" />`;
    }

    // Layer 2: text overlays
    html += `
    <div class="text-layer">`;

    // Get text blocks for this page
    let textBlocks = (page.textBlocks || []).filter(block => {
      const blockPageNum = block.pageNumber || block.boundingBox?.pageNumber;
      return !blockPageNum || blockPageNum === pageNumber;
    });

    // If no text blocks, create from page text
    if (textBlocks.length === 0 && page.text && page.text.trim().length > 0) {
      textBlocks = GeminiService.createSimpleTextBlocks(
        page.text,
        pageNumber,
        pageWidthPoints,
        pageHeightPoints
      );
    }

    // Collect all text for TTS
    const allTextForTTS = [];

    // Scaling factors: PDF points -> rendered image pixels
    const scaleX = pageWidthPoints > 0 ? (safeRenderedWidth / pageWidthPoints) : 1;
    const scaleY = pageHeightPoints > 0 ? (safeRenderedHeight / pageHeightPoints) : 1;
    const avgScale = (scaleX + scaleY) / 2;

    // Generate positioned text blocks
    for (let i = 0; i < textBlocks.length; i++) {
      const block = textBlocks[i];
      if (!block.text || block.text.trim().length === 0) continue;

      const blockId = block.id || `block_${pageNumber}_${i}`;
      const escapedText = this.escapeHtml(block.text.trim());
      allTextForTTS.push(block.text.trim());

      let style = '';
      let tag = 'p';
      let attributes = '';
      let epubType = 'paragraph';

      // Determine HTML tag
      if (block.type === 'heading' && block.level) {
        const hLevel = Math.max(1, Math.min(6, block.level));
        tag = `h${hLevel}`;
        epubType = 'title';
        attributes = ` epub:type="${epubType}" aria-level="${hLevel}"`;
      } else if (block.type === 'list-item') {
        epubType = 'list-item';
        attributes = ` epub:type="${epubType}"`;
      } else {
        epubType = 'paragraph';
        attributes = ` epub:type="${epubType}"`;
      }

      // Position and styling
      if (block.boundingBox) {
        const bbox = block.boundingBox;
        
        // Validate bounding box coordinates
        if (bbox.x === undefined || bbox.y === undefined || bbox.width === undefined || bbox.height === undefined) {
          console.warn(`[Page ${pageNumber} Block ${blockId}] Invalid boundingBox, missing coordinates`);
        }
        
        // Convert PDF coordinates (points, bottom-up) to rendered pixels (top-down)
        // PDF coordinates: (0,0) is bottom-left, Y increases upward
        // Screen coordinates: (0,0) is top-left, Y increases downward
        const leftPx = (bbox.x || 0) * scaleX;
        const widthPx = Math.max(1, (bbox.width || 0) * scaleX); // Ensure minimum width
        const heightPx = Math.max(1, (bbox.height || 0) * scaleY); // Ensure minimum height
        // Convert Y from PDF bottom-up to screen top-down
        const topPx = Math.max(0, (pageHeightPoints - ((bbox.y || 0) + (bbox.height || 0))) * scaleY);

        // Font styling
        const fontSizePt = block.fontSize || (bbox.height ? bbox.height * 0.9 : 12);
        const fontSizePx = fontSizePt * avgScale;
        
        let fontFamily = 'Arial, sans-serif';
        if (block.fontName) {
          // Map common PDF font names to web-safe fonts
          const fontName = block.fontName.toLowerCase();
          if (fontName.includes('times') || fontName.includes('roman')) {
            fontFamily = 'Times, "Times New Roman", serif';
          } else if (fontName.includes('courier') || fontName.includes('mono')) {
            fontFamily = 'Courier, "Courier New", monospace';
          } else if (fontName.includes('helvetica') || fontName.includes('arial')) {
            fontFamily = 'Arial, Helvetica, sans-serif';
          }
        }

        let fontWeight = 'normal';
        if (block.isBold) {
          fontWeight = 'bold';
        }

        let fontStyle = 'normal';
        if (block.isItalic) {
          fontStyle = 'italic';
        }

        // Text color (from PDF extraction)
        const textColor = block.textColor || '#000000';
        
        // Text alignment
        const textAlign = block.textAlign || 'left';

        // Build style string with absolute positioning (CRITICAL for highlighting/TTS sync)
        // All coordinates must be in pixels and properly converted from PDF points
        style = `position: absolute; 
                 left: ${leftPx.toFixed(2)}px; 
                 top: ${topPx.toFixed(2)}px; 
                 width: ${widthPx.toFixed(2)}px; 
                 height: ${heightPx.toFixed(2)}px; 
                 font-size: ${fontSizePx.toFixed(2)}px; 
                 font-family: ${fontFamily}; 
                 font-weight: ${fontWeight}; 
                 font-style: ${fontStyle}; 
                 color: ${textColor}; 
                 text-align: ${textAlign}; 
                 line-height: ${(fontSizePx * 1.05).toFixed(2)}px;`;
        
        // Validate that positioning values are valid numbers
        if (isNaN(leftPx) || isNaN(topPx) || isNaN(widthPx) || isNaN(heightPx)) {
          console.error(`[Page ${pageNumber} Block ${blockId}] Invalid positioning values - left:${leftPx}, top:${topPx}, width:${widthPx}, height:${heightPx}`);
        }

        // Map for SMIL
        idMapping[blockId] = blockId;
      } else {
        // No bounding box - use flow layout
        // WARNING: Blocks without boundingBox cannot be highlighted accurately
        console.warn(`[Page ${pageNumber} Block ${blockId}] No boundingBox - using relative positioning (highlighting may not work)`);
        style = `position: relative; 
                 margin: 10px 0; 
                 font-size: 16px; 
                 color: #000000;`;
      }

      // Generate HTML element
      html += `
    <${tag} id="${blockId}" class="text-block" role="text"${attributes} style="${style}">${escapedText}</${tag}>`;
    }

    // Close text layer
    html += `
    </div>`;

    // Close page-container
    html += `
  </div>`;

    // Generate text-content div with paragraphs for TTS (like reference file)
    // This is essential for player's built-in TTS to work properly
    // CRITICAL: Place text-content OUTSIDE page-container so it's in normal document flow
    // This makes it accessible to TTS engines even though it's visually hidden
    html += `
  <div class="text-content" epub:type="bodymatter" role="main" aria-label="Page ${pageNumber} content" aria-hidden="false">`;
    
    // Generate paragraphs from textBlocks - each block becomes a paragraph with matching ID
    if (textBlocks.length > 0) {
      for (let i = 0; i < textBlocks.length; i++) {
        const block = textBlocks[i];
        if (block.text && block.text.trim().length > 0) {
          const blockId = block.id || `block_${pageNumber}_${i}`;
          const escapedText = this.escapeHtml(block.text.trim());
          html += `
    <p id="${blockId}" lang="en" xml:lang="en" aria-hidden="false">${escapedText}</p>`;
        }
      }
    } else if (allTextForTTS.length > 0) {
      // Fallback: use collected text
      const ttsText = allTextForTTS.join(' ').replace(/\s+/g, ' ').trim();
      const escapedText = this.escapeHtml(ttsText);
      html += `
    <p id="block_${pageNumber}_0" lang="en" xml:lang="en" aria-hidden="false">${escapedText}</p>`;
    }
    
    html += `
  </div>
</body>
</html>`;

    return { html, idMapping };
  }
  
  static convertTextBlockToHTML(block, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight) {
    if (!block.text || block.text.trim().length === 0) {
      return '';
    }
    
    const text = this.escapeHtml(block.text.trim());
    const blockId = block.id || `block_${block.pageNumber || 0}_0`;
    
    if (!block.boundingBox || block.isSimple) {
      const maxBlockLength = 500;
      if (text.length > maxBlockLength && !block.type || block.type === 'paragraph') {
        const sentences = text.split(/([.!?]\s+)/).filter(s => s.trim().length > 0);
        let currentPara = '';
        let paraHtml = '';
        let paraIndex = 0;
        
        for (const sentence of sentences) {
          if ((currentPara + sentence).length > maxBlockLength && currentPara.length > 0) {
            paraHtml += `<p id="${this.escapeHtml(blockId)}-para-${paraIndex}" class="flow-block" role="text">${currentPara.trim()}</p>\n      `;
            currentPara = sentence;
            paraIndex++;
          } else {
            currentPara += sentence;
          }
        }
        if (currentPara.trim().length > 0) {
          paraHtml += `<p id="${this.escapeHtml(blockId)}-para-${paraIndex}" class="flow-block" role="text">${currentPara.trim()}</p>`;
        }
        return paraHtml || `<p id="${this.escapeHtml(blockId)}" class="flow-block" role="text">${text}</p>`;
      }
      
      if (block.type === 'heading' && block.level) {
        const hLevel = Math.max(1, Math.min(6, block.level));
        return `<h${hLevel} id="${this.escapeHtml(blockId)}" class="flow-block" role="heading" aria-level="${hLevel}">${text}</h${hLevel}>`;
      }
      return `<p id="${this.escapeHtml(blockId)}" class="flow-block" role="text">${text}</p>`;
    }
    
    let positionStyle = '';
    if (block.boundingBox && pageWidthPoints > 0 && pageHeightPoints > 0) {
      const bbox = block.boundingBox;
      const pdfX = bbox.x || 0;
      const pdfY = bbox.y || 0;
      const pdfWidth = bbox.width || 0;
      const pdfHeight = bbox.height || 0;
      
      const htmlTopFromBottom = pageHeightPoints - pdfY - pdfHeight;
      const htmlTopFromTop = pdfY;
      
      let htmlTop;
      if (htmlTopFromBottom >= 0 && htmlTopFromBottom <= pageHeightPoints) {
        htmlTop = htmlTopFromBottom;
      } else if (htmlTopFromTop >= 0 && htmlTopFromTop <= pageHeightPoints) {
        htmlTop = htmlTopFromTop;
      } else {
        htmlTop = Math.max(0, Math.min(pageHeightPoints, htmlTopFromBottom));
      }
      
      let leftPercent = (pdfX / pageWidthPoints) * 100.0;
      let topPercent = (htmlTop / pageHeightPoints) * 100.0;
      let widthPercent = (pdfWidth / pageWidthPoints) * 100.0;
      let heightPercent = (pdfHeight / pageHeightPoints) * 100.0;
      
      leftPercent = Math.max(0, Math.min(100, leftPercent));
      topPercent = Math.max(0, Math.min(100, topPercent));
      widthPercent = Math.max(0, Math.min(100 - leftPercent, widthPercent));
      heightPercent = Math.max(0, Math.min(100 - topPercent, heightPercent));
      
      let fontSizeStyle = '';
      if (block.fontSize && block.fontSize > 0) {
        const fontSizePercent = (block.fontSize / pageHeightPoints) * 100.0;
        fontSizeStyle = ` font-size: ${fontSizePercent.toFixed(2)}%;`;
      }
      
      positionStyle = ` style="position: absolute; left: ${leftPercent.toFixed(4)}%; top: ${topPercent.toFixed(4)}%; width: ${widthPercent.toFixed(4)}%; height: ${heightPercent.toFixed(4)}%;${fontSizeStyle}"`;
    }
    
    const type = block.type || 'paragraph';
    const level = block.level || 2;
    
    const epubType = type === 'heading' ? ' epub:type="title"' : '';
    const roleAttr = ' role="text"';
    
    if (type === 'heading') {
      const hLevel = Math.max(1, Math.min(6, level));
      return `<h${hLevel} id="${this.escapeHtml(blockId)}"${epubType}${roleAttr} aria-level="${hLevel}"${positionStyle}>${text}</h${hLevel}>`;
    } else if (type === 'list-item') {
      return `<p id="${this.escapeHtml(blockId)}" class="list-item"${epubType}${roleAttr}${positionStyle}>${text}</p>`;
    } else {
      return `<p id="${this.escapeHtml(blockId)}"${epubType}${roleAttr}${positionStyle}>${text}</p>`;
    }
  }
  
  /**
   * ✅ FIXED CSS: TTS can now read text
   * - No screen-reader-only CSS (clip, 1px)
   * - Normal document flow for TTS text
   * - Visible and accessible to TTS
   */
  static generateFixedLayoutCSS(pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, hasAudio = false) {
    const width = renderedWidth > 0 ? `${renderedWidth}px` : '100vw';
    const height = renderedHeight > 0 ? `${renderedHeight}px` : '100vh';
    
    // For no-audio EPUBs, hide the fixed-layout container so TTS can focus on flow text
    const fixedContainerDisplay = hasAudio ? 'block' : 'none';
    
    return `/* Fixed Layout EPUB Styles - TTS Read-Aloud Now Works */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100vh;
  font-size: 16px;
  line-height: 1.6;
  /* CRITICAL: Normal flow for TTS - NO fixed, NO overflow hidden */
  position: static !important;
  overflow: visible !important;
}

.fixed-layout-container {
  display: ${fixedContainerDisplay}; /* Hidden for no-audio EPUBs to allow TTS to focus on flow text */
  position: fixed;
  top: 0;
  left: 0;
  width: ${width};
  height: ${height};
  max-width: ${width};
  max-height: ${height};
  margin: 0;
  padding: 0;
  overflow: hidden;
  z-index: 1; /* Lower than flow text (z-index: 999999) */
  background-color: white;
  box-sizing: border-box;
  /* CRITICAL: Do NOT block flow text - allow it to be accessible */
  pointer-events: none; /* Allow clicks/text selection to pass through */
  /* Ensure it doesn't prevent flow text from being read */
  isolation: isolate; /* Create new stacking context */
}

.fixed-layout-container img,
.fixed-layout-container .text-content {
  pointer-events: auto; /* But allow interaction with image/text overlay */
}

.page-image {
  width: ${width};
  height: ${height};
  max-width: ${width};
  max-height: ${height};
  object-fit: contain;
  object-position: top left;
  display: block;
  margin: 0;
  padding: 0;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  box-sizing: border-box;
}

.text-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
}

.text-content p,
.text-content h1,
.text-content h2,
.text-content h3,
.text-content h4,
.text-content h5,
.text-content h6 {
  color: #000;
  background: transparent;
  margin: 0;
  padding: 0;
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
  font-size: inherit;
  line-height: 1.2;
  transition: background-color 0.1s ease;
  visibility: visible;
  opacity: 1;
  display: block;
}

.text-content .flow-block {
  position: relative;
  display: block;
  margin: 1.5em auto;
  padding: 0.8em 1.2em;
  font-size: 22px;
  line-height: 1.8;
  color: #000 !important;
  background: rgba(255, 255, 255, 0.98);
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
  z-index: 10;
  width: 88%;
  max-width: 88%;
  margin-left: auto;
  margin-right: auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  word-wrap: break-word;
  overflow-wrap: break-word;
  visibility: visible;
  opacity: 1;
}

.text-content section {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 2% 0;
  justify-content: flex-start;
}

.flow-block {
  position: relative;
  display: block;
  margin: 0.5em 0;
  padding: 0.3em 0.5em;
  font-size: 22px;
  line-height: 1.6;
  color: #000 !important;
  background: rgba(255, 255, 255, 0.9);
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
  z-index: 10;
  visibility: visible;
  opacity: 1;
}

.text-content p.epub-media-overlay-active,
.text-content h1.epub-media-overlay-active,
.text-content h2.epub-media-overlay-active,
.text-content h3.epub-media-overlay-active,
.text-content h4.epub-media-overlay-active,
.text-content h5.epub-media-overlay-active,
.text-content h6.epub-media-overlay-active {
  background-color: rgba(255, 255, 0, 0.6) !important;
  color: #000;
  transition: background-color 0.1s ease;
}

.text-content p::selection,
.text-content h1::selection,
.text-content h2::selection,
.text-content h3::selection {
  background: rgba(255, 255, 0, 0.5);
  color: #000;
}

/* ✅✅✅ CRITICAL FIX: TTS text in NORMAL DOCUMENT FLOW */
/* NO screen-reader-only CSS (clip, 1px, hidden) */
/* TTS needs normal flow, visible text */
/* Paragraphs directly in body for maximum TTS compatibility */
body > p {
  margin: 1em 0 !important;
  padding: 1em !important;
  color: #000 !important;
  font-size: 1em !important; /* Use relative units for TTS compatibility */
  line-height: 1.6 !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  
  /* Normal flow - no absolute positioning */
  position: relative !important;
  left: auto !important;
  top: auto !important;
  width: auto !important;
  height: auto !important;
  
  /* Ensure TTS can read it */
  font-weight: normal !important;
  font-style: normal !important;
  /* Ensure text is not hidden from assistive technologies */
  -epub-speak: normal !important;
  speak: normal !important;
  /* Make text selectable for TTS */
  user-select: text !important;
  -webkit-user-select: text !important;
  pointer-events: auto !important;
}`;
  }
  
  static generateFixedLayoutContentOpf(jobId, docTitle, manifestItems, spineItems, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, smilFileNames = [], hasAudio = false) {
    // Generate UUID for identifier
    const uuid = `urn:uuid:${jobId}-${Date.now()}`;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:rendition="http://www.idpf.org/2013/rendition" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${this.escapeHtml(docTitle)}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="book-id">${uuid}</dc:identifier>
    <dc:publisher>PDF to EPUB Converter</dc:publisher>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">none</meta>
    <meta property="rendition:viewport">width=${pageWidthPoints},height=${pageHeightPoints}</meta>
    ${smilFileNames.length > 0 ? '<meta property="media:active-class">-epub-media-overlay-active</meta>' : ''}
    ${smilFileNames.length > 0 ? '<meta property="media:playback-active-class">-epub-media-overlay-playing</meta>' : ''}
    
    <!-- Accessibility metadata for read-aloud support -->
    <meta property="schema:accessibilityFeature">textToSpeech</meta>
    <meta property="schema:accessibilityFeature">readingOrder</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilitySummary">This EPUB contains accessible text content suitable for text-to-speech and read-aloud functionality.</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="nav">
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  }

  static async generateEpubFromContent(jobId, textData, structuredContent, images, documentTitle) {
    const zip = new JSZip();
    
    const mimetypeContent = 'application/epub+zip';
    zip.file('mimetype', mimetypeContent, { 
      compression: 'STORE'
    });
    
    const mimetypeFile = zip.files['mimetype'];
    if (mimetypeFile) {
      if (!mimetypeFile.options) {
        mimetypeFile.options = {};
      }
      mimetypeFile.options.compression = 'STORE';
      mimetypeFile.options.compressionOptions = null;
    }
    
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    zip.file('META-INF/container.xml', containerXml);
    
    const chapters = structuredContent?.structured?.chapters || null;
    const docTitle = this.escapeHtml(
      structuredContent?.structured?.title || 
      textData.metadata?.title || 
      documentTitle || 
      `Converted Document ${jobId}`
    );
    
    const manifestItems = [];
    const spineItems = [];
    const tocItems = [];
    
    if (chapters && chapters.length > 0) {
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const chapterId = `chapter-${i + 1}`;
        const fileName = `${chapterId}.xhtml`;
        
        const chapterPages = textData.pages.filter(p => 
          p.pageNumber >= chapter.startPage && p.pageNumber <= chapter.endPage
        );
        
        const chapterImages = images.filter(img => 
          img.pageNumber >= chapter.startPage && img.pageNumber <= chapter.endPage
        );
        
        const chapterText = chapterPages.map(p => {
          const pageImages = chapterImages.filter(img => img.pageNumber === p.pageNumber);
          let imageHtml = '';
          if (pageImages.length > 0) {
            imageHtml = pageImages.map(img => 
              `<img src="images/${img.fileName}" alt="Image from page ${p.pageNumber}" style="max-width: 100%; height: auto;"/>`
            ).join('\n  ');
          }
          
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
      const pagesPerChapter = 5;
      let chapterNum = 1;
      
      for (let i = 0; i < textData.pages.length; i += pagesPerChapter) {
        const pageGroup = textData.pages.slice(i, i + pagesPerChapter);
        const chapterId = `chapter-${chapterNum}`;
        const fileName = `${chapterId}.xhtml`;
        const chapterTitle = `Chapter ${chapterNum}`;
        
        const chapterText = pageGroup.map(page => {
          const pageImages = images.filter(img => img.pageNumber === page.pageNumber);
          let imageHtml = '';
          if (pageImages.length > 0) {
            imageHtml = pageImages.map(img => 
              `<img src="images/${img.fileName}" alt="Image from page ${page.pageNumber}" style="max-width: 100%; height: auto;"/>`
            ).join('\n    ');
          }
          
          let cleanText = page.text || '';
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
    
    if (images.length > 0) {
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
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
    zip.file('OEBPS/content.opf', contentOpf);
    
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

  static async getAllConversions() {
    const jobs = await ConversionJobModel.findAll();
    return jobs.map(job => this.convertToDTO(job));
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
   * Map AudioSync blockId to actual XHTML element ID
   * @param {Object} sync - AudioSync object with textBlockId/text_block_id/blockId
   * @param {number} pageNumber - Page number
   * @param {Array} textBlocks - Array of text blocks for this page
   * @param {Object} idMapping - Mapping of block IDs to XHTML IDs (from XHTML generation)
   * @returns {string} - The actual XHTML element ID
   */
  static mapSyncIdToXhtmlId(sync, pageNumber, textBlocks, idMapping = {}) {
    // Get the sync's block ID (handle different field names)
    // Granular IDs are saved as block_id (e.g., "page1_p1_s1" or legacy "p1_s1")
    const syncBlockId = sync.id || sync.blockId || sync.block_id || sync.textBlockId || sync.text_block_id;
    
    if (!syncBlockId) {
      console.warn(`[SMIL] No block ID found in sync:`, sync);
      return null;
    }
    
    // CRITICAL: For granular IDs, use them directly
    // These IDs match the XHTML element IDs generated by Gemini
    // Supports both new format (page1_p1_s1) and legacy format (p1_s1)
    if (syncBlockId.match(/^(page\d+_)?p\d+(_s\d+)?(_w\d+)?$/)) {
      // This is a granular ID (paragraph, sentence, or word level)
      return syncBlockId;
    }
    
    // First, check if we have a direct mapping from XHTML generation
    if (idMapping[syncBlockId]) {
      return idMapping[syncBlockId];
    }
    
    // Try to find matching block in textBlocks
    if (syncBlockId && textBlocks && textBlocks.length > 0) {
      const matchingBlock = textBlocks.find(b => {
        const blockId = b.id || b.blockId;
        return blockId === syncBlockId || 
               String(blockId) === String(syncBlockId) ||
               (blockId && String(blockId).includes(String(syncBlockId))) ||
               (syncBlockId && String(syncBlockId).includes(String(blockId)));
      });
      
      if (matchingBlock) {
        // Check if this block ID is in the mapping
        const blockId = matchingBlock.id || matchingBlock.blockId;
        if (idMapping[blockId]) {
          return idMapping[blockId];
        }
        // Fallback: use the block's ID directly (if it matches XHTML pattern)
        if (blockId) {
          return blockId;
        }
      }
    }
    
    // If syncBlockId looks like a valid XHTML ID, use it directly
    // This handles IDs like "block_1_2", "p1", "p1_s1", "page1_p1_s1", etc.
    if (syncBlockId && syncBlockId.match(/^[a-zA-Z0-9_-]+$/)) {
      return syncBlockId;
    }
    
    // ISSUE #3 FIX: Do NOT use tts-flow- fallback IDs
    // These IDs don't exist in XHTML and will cause silent highlight failures
    // Return null instead, and let the caller handle the error appropriately
    console.error(`[SMIL] Could not map syncBlockId "${syncBlockId}" to XHTML ID. No valid mapping found.`);
    return null;
  }

  static generateSMILContent(pageNumber, syncs, audioFileName, textData, idMapping = {}, xhtmlFileName = null, targetGranularity = null, xhtmlContent = null) {
    // Get the page data to access textBlocks
    const page = textData?.pages?.find(p => p.pageNumber === pageNumber);
    const textBlocks = page?.textBlocks || [];
    
    // Use provided XHTML filename or default
    const xhtmlFile = xhtmlFileName || `page_${pageNumber}.xhtml`;
    
    // Build reading order map from XHTML if available
    let readingOrderMap = new Map();
    if (xhtmlContent) {
      try {
        const dom = new JSDOM(xhtmlContent, { contentType: 'text/xml' });
        const document = dom.window.document;
        let readingOrder = 0;
        
        // Traverse document in reading order (depth-first)
        const traverse = (element) => {
          if (!element) return;
          
          // Check if element has an ID
          const id = element.getAttribute('id');
          if (id && id.trim()) {
            readingOrderMap.set(id.trim(), readingOrder++);
          }
          
          // Process children in order
          const children = Array.from(element.children || []);
          children.forEach(child => traverse(child));
        };
        
        // Start from body
        const body = document.querySelector('body');
        if (body) {
          traverse(body);
        } else {
          // If no body, traverse all elements
          const allElements = document.querySelectorAll('*');
          allElements.forEach(el => {
            const id = el.getAttribute('id');
            if (id && id.trim()) {
              readingOrderMap.set(id.trim(), readingOrder++);
            }
          });
        }
        
        console.log(`[SMIL Page ${pageNumber}] Built reading order map with ${readingOrderMap.size} elements`);
      } catch (error) {
        console.warn(`[SMIL Page ${pageNumber}] Could not parse XHTML for reading order: ${error.message}`);
      }
    }
    
    // Filter syncs by granularity if specified
    let filteredSyncs = syncs;
    if (targetGranularity) {
      const originalCount = syncs.length;
      filteredSyncs = syncs.filter(sync => {
        const blockId = sync.blockId || sync.block_id || '';
        switch (targetGranularity) {
          case 'word':
            // Words: IDs containing '_w' (e.g., page1_p1_s1_w1 or p1_s1_w1)
            return blockId.includes('_w');
          case 'sentence':
            // Sentences: IDs containing '_s' but not '_w' (e.g., page1_p1_s1 or p1_s1)
            return blockId.includes('_s') && !blockId.includes('_w');
          case 'paragraph':
            // Paragraphs: IDs without '_s' or '_w' (e.g., page1_p1 or p1)
            return !blockId.includes('_s') && !blockId.includes('_w');
          default:
            return true;
        }
      });
      
      // ISSUE #1 FIX: Granularity Mismatch - Up-sampling logic
      // If no matches found at requested granularity, try up-sampling from finer granularity
      if (filteredSyncs.length === 0 && originalCount > 0) {
        console.warn(`[SMIL Page ${pageNumber}] No ${targetGranularity}-level syncs found, attempting up-sampling...`);
        
        if (targetGranularity === 'paragraph') {
          // Up-sample from sentence level: group sentences by paragraph
          const paragraphMap = new Map();
          syncs.forEach(sync => {
            const blockId = sync.blockId || sync.block_id || '';
            // Extract paragraph ID from sentence ID (e.g., page1_p1_s1 -> page1_p1)
            const paraMatch = blockId.match(/^((?:page\d+_)?p\d+)(?:_s\d+)?(_w\d+)?$/);
            if (paraMatch) {
              const paraId = paraMatch[1];
              if (!paragraphMap.has(paraId)) {
                paragraphMap.set(paraId, { sentences: [], startTime: Infinity, endTime: -Infinity });
              }
              const paraData = paragraphMap.get(paraId);
              paraData.sentences.push(sync);
              const start = Number(sync.start_time ?? sync.startTime ?? sync.clipBegin ?? 0);
              const end = Number(sync.end_time ?? sync.endTime ?? sync.clipEnd ?? start + 5);
              paraData.startTime = Math.min(paraData.startTime, start);
              paraData.endTime = Math.max(paraData.endTime, end);
            }
          });
          
          // Convert paragraph groups back to sync objects
          filteredSyncs = Array.from(paragraphMap.entries()).map(([paraId, paraData]) => ({
            blockId: paraId,
            block_id: paraId,
            start_time: paraData.startTime,
            startTime: paraData.startTime,
            end_time: paraData.endTime,
            endTime: paraData.endTime,
            customText: paraData.sentences.map(s => s.customText || s.custom_text || '').join(' ').trim()
          }));
          
          console.log(`[SMIL Page ${pageNumber}] Up-sampled ${filteredSyncs.length} paragraph-level syncs from ${originalCount} sentence-level syncs`);
        } else if (targetGranularity === 'sentence') {
          // Up-sample from word level: group words by sentence
          const sentenceMap = new Map();
          syncs.forEach(sync => {
            const blockId = sync.blockId || sync.block_id || '';
            // Extract sentence ID from word ID (e.g., page1_p1_s1_w1 -> page1_p1_s1)
            const sentMatch = blockId.match(/^((?:page\d+_)?p\d+_s\d+)(_w\d+)?$/);
            if (sentMatch) {
              const sentId = sentMatch[1];
              if (!sentenceMap.has(sentId)) {
                sentenceMap.set(sentId, { words: [], startTime: Infinity, endTime: -Infinity });
              }
              const sentData = sentenceMap.get(sentId);
              sentData.words.push(sync);
              const start = Number(sync.start_time ?? sync.startTime ?? sync.clipBegin ?? 0);
              const end = Number(sync.end_time ?? sync.endTime ?? sync.clipEnd ?? start + 5);
              sentData.startTime = Math.min(sentData.startTime, start);
              sentData.endTime = Math.max(sentData.endTime, end);
            }
          });
          
          // Convert sentence groups back to sync objects
          filteredSyncs = Array.from(sentenceMap.entries()).map(([sentId, sentData]) => ({
            blockId: sentId,
            block_id: sentId,
            start_time: sentData.startTime,
            startTime: sentData.startTime,
            end_time: sentData.endTime,
            endTime: sentData.endTime,
            customText: sentData.words.map(w => w.customText || w.custom_text || '').join(' ').trim()
          }));
          
          console.log(`[SMIL Page ${pageNumber}] Up-sampled ${filteredSyncs.length} sentence-level syncs from ${originalCount} word-level syncs`);
        }
        
        // If still no matches after up-sampling, log critical error
        if (filteredSyncs.length === 0) {
          console.error(`[SMIL Page ${pageNumber}] CRITICAL: No syncs available for ${targetGranularity} granularity after up-sampling. SMIL file will be empty.`);
        }
      } else {
        console.log(`[SMIL Page ${pageNumber}] Filtered to ${filteredSyncs.length} ${targetGranularity}-level syncs from ${originalCount} total`);
      }
    }
    
    // ISSUE #4 FIX: Data Type Consistency - Ensure numeric types
    // CRITICAL FIX: Sort by hierarchy level first, then by start time
    // Hierarchy: words (most specific) -> sentences -> paragraphs (least specific)
    const getHierarchyLevel = (blockId) => {
      if (!blockId) return 3; // Unknown = lowest priority
      if (blockId.includes('_w')) return 1; // Words = highest priority (most specific)
      if (blockId.includes('_s')) return 2; // Sentences = medium priority
      return 3; // Paragraphs = lowest priority (least specific)
    };
    
    const sortedSyncs = [...filteredSyncs].sort((a, b) => {
      const blockIdA = a.blockId || a.block_id || '';
      const blockIdB = b.blockId || b.block_id || '';
      
      // CRITICAL: Sort by reading order first (if available), then by hierarchy, then by start time
      const readingOrderA = readingOrderMap.get(blockIdA);
      const readingOrderB = readingOrderMap.get(blockIdB);
      
      // If both have reading order, use it
      if (readingOrderA !== undefined && readingOrderB !== undefined) {
        return readingOrderA - readingOrderB;
      }
      
      // If only one has reading order, prioritize it
      if (readingOrderA !== undefined) return -1;
      if (readingOrderB !== undefined) return 1;
      
      // Fallback: sort by hierarchy level (words first, then sentences, then paragraphs)
      const levelA = getHierarchyLevel(blockIdA);
      const levelB = getHierarchyLevel(blockIdB);
      
      if (levelA !== levelB) {
        return levelA - levelB; // Lower level number = higher priority
      }
      
      // If same hierarchy level, sort by start time
      const startA = Number(a.start_time ?? a.startTime ?? a.clipBegin ?? 0);
      const startB = Number(b.start_time ?? b.startTime ?? b.clipBegin ?? 0);
      return startA - startB;
    });
    
    let bodyContent = '';
    let totalDuration = 0;
    let skippedCount = 0;
    
    // ISSUE #2: Audio Path - SMIL files are in OEBPS/, audio files are in OEBPS/audio/
    // Path is correct: audio/filename.mp3 (same directory level)
    let audioPath = audioFileName;
    if (!audioPath.startsWith('../') && !audioPath.startsWith('/')) {
      // If audio is in OEBPS/audio/, SMIL in OEBPS/ needs audio/ (same directory level)
      if (audioPath.includes('audio/')) {
        audioPath = audioPath.replace(/^.*?audio\//, 'audio/');
      } else {
        audioPath = `audio/${audioPath}`;
      }
    }
    
    // Track adjusted end times to prevent overlaps
    let lastAdjustedEndTime = 0;
    
    for (let i = 0; i < sortedSyncs.length; i++) {
      const sync = sortedSyncs[i];
      
      // Skip blocks where shouldRead is false (if present in sync data)
      if (sync.shouldRead === false) {
        continue;
      }
      
      // ISSUE #4 FIX: Ensure numeric types for timestamps
      let startTime = Number(sync.start_time ?? sync.startTime ?? sync.clipBegin ?? 0);
      let endTime = Number(sync.end_time ?? sync.endTime ?? sync.clipEnd ?? (startTime + 5));
      
      // FIXED: Map sync blockId to actual XHTML ID (needed for logging)
      // For granular IDs (p1_s1), the block_id should match the XHTML element ID directly
      let blockId = sync.blockId || sync.block_id || sync.id;
      
      // If blockId is not set, try mapping
      if (!blockId) {
        blockId = this.mapSyncIdToXhtmlId(sync, pageNumber, textBlocks, idMapping);
      }
      
      // CRITICAL FIX: Ensure minimum duration for natural reading pace
      // Very short durations cause "reading too fast" issue in EPUB players
      // Calculate minimum duration based on text length (natural reading pace: ~150 words/min = ~2.5 words/sec)
      const text = sync.customText || sync.custom_text || sync.text || '';
      const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
      const charCount = text.trim().length;
      
      // Minimum duration: 0.3s base + 0.1s per word (or 0.05s per character, whichever is longer)
      const minDurationByWords = 0.3 + (wordCount * 0.1);
      const minDurationByChars = 0.3 + (charCount * 0.05);
      const MIN_DURATION = Math.max(0.3, Math.max(minDurationByWords, minDurationByChars));
      
      const originalStartTime = startTime;
      const originalEndTime = endTime;
      const currentDuration = endTime - startTime;
      
      // Get next sync's original start time (before any adjustments)
      const nextSync = sortedSyncs[i + 1];
      const nextOriginalStartTime = nextSync ? Number(nextSync.start_time ?? nextSync.startTime ?? nextSync.clipBegin ?? Infinity) : Infinity;
      
      // STEP 1: CRITICAL - Ensure NO OVERLAP with previous block
      // Use lastAdjustedEndTime to track the actual end time of the previous processed block
      if (startTime < lastAdjustedEndTime) {
        const overlap = lastAdjustedEndTime - startTime;
        console.warn(`[SMIL Page ${pageNumber}] ⚠️ OVERLAP DETECTED: ${blockId} starts at ${startTime.toFixed(3)}s but previous block ends at ${lastAdjustedEndTime.toFixed(3)}s (overlap: ${overlap.toFixed(3)}s). Adjusting startTime.`);
        startTime = lastAdjustedEndTime + 0.05; // Add 50ms minimum gap
        // Recalculate endTime to maintain original duration
        const originalDuration = originalEndTime - originalStartTime;
        endTime = startTime + originalDuration;
        console.log(`[SMIL Page ${pageNumber}] Adjusted ${blockId}: start=${startTime.toFixed(3)}s, end=${endTime.toFixed(3)}s (original: ${originalStartTime.toFixed(3)}s-${originalEndTime.toFixed(3)}s)`);
      }
      
      // STEP 2: Ensure minimum duration is met (do this before adding pause)
      if ((endTime - startTime) < MIN_DURATION) {
        const minEndTime = startTime + MIN_DURATION;
        // Don't extend beyond next sync's start (leave 100ms gap)
        const safeEndTime = Math.min(minEndTime, nextOriginalStartTime - 0.1);
        
        if (safeEndTime > endTime) {
          endTime = safeEndTime;
          console.log(`[SMIL Page ${pageNumber}] Extended duration for ${blockId || 'unknown'}: ${(originalEndTime - originalStartTime).toFixed(3)}s -> ${(endTime - startTime).toFixed(3)}s (text: "${text.substring(0, 30)}...", ${wordCount} words)`);
        }
      }
      
      // STEP 3: ALWAYS add natural pause after speech to prevent abrupt cuts
      // This ensures there's silence between blocks for smooth reading experience
      const hasPeriod = text.trim().endsWith('.') || text.trim().endsWith('!') || text.trim().endsWith('?');
      const hasComma = text.trim().endsWith(',') || text.trim().endsWith(';') || text.trim().endsWith(':');
      
      // Calculate desired pause based on punctuation and text length
      let desiredPause = 0.3; // Default pause
      if (hasPeriod) {
        desiredPause = 0.5 + (wordCount * 0.02); // Longer pause after sentences (0.5-0.7s)
      } else if (hasComma) {
        desiredPause = 0.3; // Medium pause after clauses
      } else {
        desiredPause = 0.25; // Shorter pause for other blocks
      }
      
      // Cap pause at reasonable maximum
      desiredPause = Math.min(desiredPause, 0.8);
      
      // CRITICAL: Always ensure minimum pause (0.2s) to prevent abrupt cuts
      const minRequiredPause = 0.2; // Minimum 200ms pause for smooth transitions
      const actualPause = Math.max(desiredPause, minRequiredPause);
      
      // Calculate desired end time with pause
      const originalEndBeforePause = endTime;
      const desiredEndTime = endTime + actualPause;
      
      // Ensure we don't overlap with next block, but prioritize pause over tight spacing
      // Leave at least 0.1s gap before next block
      const maxSafeEndTime = nextOriginalStartTime - 0.1;
      
      if (desiredEndTime <= maxSafeEndTime) {
        // We have room for the full pause
        endTime = desiredEndTime;
        console.log(`[SMIL Page ${pageNumber}] Added ${actualPause.toFixed(2)}s pause after ${blockId || 'unknown'}: endTime extended from ${originalEndBeforePause.toFixed(3)}s to ${endTime.toFixed(3)}s (smooth transition)`);
      } else {
        // Limited room - use as much pause as possible without overlapping
        const availablePause = Math.max(0, maxSafeEndTime - endTime);
        if (availablePause >= minRequiredPause) {
          endTime = maxSafeEndTime;
          console.log(`[SMIL Page ${pageNumber}] Added ${availablePause.toFixed(2)}s pause after ${blockId || 'unknown'}: endTime extended from ${originalEndBeforePause.toFixed(3)}s to ${endTime.toFixed(3)}s (limited by next block)`);
        } else {
          // Very tight spacing - still add minimum pause and adjust next block if needed
          endTime = endTime + minRequiredPause;
          if (endTime > nextOriginalStartTime) {
            // Need to push next block forward
            console.warn(`[SMIL Page ${pageNumber}] ⚠️ Tight spacing: Adding ${minRequiredPause.toFixed(2)}s pause after ${blockId} requires adjusting next block start from ${nextOriginalStartTime.toFixed(3)}s`);
            // Note: We'll handle this in the next iteration, but for now ensure minimum gap
            endTime = Math.min(endTime, nextOriginalStartTime - 0.05);
          }
          console.log(`[SMIL Page ${pageNumber}] Added minimum ${minRequiredPause.toFixed(2)}s pause after ${blockId || 'unknown'}: endTime extended from ${originalEndBeforePause.toFixed(3)}s to ${endTime.toFixed(3)}s (tight spacing)`);
        }
      }
      
      // STEP 4: Final overlap check with next block (prevent extending into next block)
      if (endTime > nextOriginalStartTime) {
        console.warn(`[SMIL Page ${pageNumber}] ⚠️ End time ${endTime.toFixed(3)}s would overlap with next block starting at ${nextOriginalStartTime.toFixed(3)}s. Adjusting endTime.`);
        endTime = nextOriginalStartTime - 0.15; // Leave 150ms gap to prevent abrupt cuts
      }
      
      // STEP 5: Final validation - ensure minimum gap is maintained (prevents abrupt cuts)
      // Always leave at least 0.2s gap before next block for smooth transitions
      const gapToNext = nextOriginalStartTime - endTime;
      const minGap = 0.2; // Increased to 200ms for smoother transitions
      
      if (gapToNext < minGap) {
        if (gapToNext < 0) {
          // Overlap - must fix
          console.warn(`[SMIL Page ${pageNumber}] ⚠️ OVERLAP: ${blockId} endTime ${endTime.toFixed(3)}s overlaps with next block at ${nextOriginalStartTime.toFixed(3)}s. Adjusting.`);
          endTime = nextOriginalStartTime - minGap;
        } else {
          // Too close - adjust endTime to leave proper gap
          const adjustedEndTime = nextOriginalStartTime - minGap;
          if (adjustedEndTime > startTime) {
            const currentDuration = endTime - startTime;
            const adjustedDuration = adjustedEndTime - startTime;
            // Only adjust if we're not making the duration too short (at least 60% of original)
            if (adjustedDuration >= currentDuration * 0.6 && adjustedDuration >= 0.1) {
              endTime = adjustedEndTime;
              console.log(`[SMIL Page ${pageNumber}] Adjusted ${blockId} endTime from ${(endTime + minGap - gapToNext).toFixed(3)}s to ${endTime.toFixed(3)}s to ensure ${minGap.toFixed(2)}s gap before next block (prevents abrupt cut)`);
            } else {
              // Can't adjust without making duration too short - push next block forward instead
              console.warn(`[SMIL Page ${pageNumber}] ⚠️ Block ${blockId} is very close to next block (${gapToNext.toFixed(3)}s gap) but can't adjust endTime. Next block will be adjusted.`);
            }
          }
        }
      }
      
      // Log gap information for debugging
      if (i > 0) {
        const gap = startTime - lastAdjustedEndTime;
        if (gap < 0.2) {
          console.warn(`[SMIL Page ${pageNumber}] ⚠️ Small gap of ${gap.toFixed(3)}s between previous block and ${blockId} - may cause abrupt cut`);
        } else if (gap > 0.5) {
          console.log(`[SMIL Page ${pageNumber}] Large gap of ${gap.toFixed(2)}s before ${blockId} (natural pause in audio)`);
        } else {
          console.log(`[SMIL Page ${pageNumber}] Gap of ${gap.toFixed(2)}s before ${blockId} (good spacing)`);
        }
      }
      
      // Update lastAdjustedEndTime for next iteration
      lastAdjustedEndTime = endTime;
      
      // Log final timing for this block
      const blockDuration = endTime - startTime;
      const pauseAfter = i < sortedSyncs.length - 1 ? (sortedSyncs[i + 1] ? (Number(sortedSyncs[i + 1].start_time ?? sortedSyncs[i + 1].startTime ?? sortedSyncs[i + 1].clipBegin ?? Infinity) - endTime) : 0) : 0;
      if (i < 3 || pauseAfter < 0.15) {
        console.log(`[SMIL Page ${pageNumber}] Block ${blockId}: ${startTime.toFixed(3)}s-${endTime.toFixed(3)}s (duration: ${blockDuration.toFixed(3)}s, pause after: ${pauseAfter.toFixed(3)}s)`);
      }
      
      // Validate timestamps
      if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
        console.error(`[SMIL Page ${pageNumber}] Invalid timestamps for sync ${i}: start=${startTime}, end=${endTime}`);
        skippedCount++;
        continue;
      }
      
      // ISSUE #3 FIX: Silent Highlight Failure - Strict fallback logic
      // Instead of using tts-flow- IDs that don't exist in XHTML, skip the sync and log error
      if (!blockId) {
        console.error(`[SMIL Page ${pageNumber}] CRITICAL: Could not map sync ID ${sync.id || sync.blockId || sync.block_id} to XHTML element. Skipping sync to prevent silent highlight failure.`);
        skippedCount++;
        continue;
      }
      
      // Validate blockId format (should be valid for XHTML fragment)
      if (!blockId.match(/^[a-zA-Z0-9_-]+$/)) {
        console.error(`[SMIL Page ${pageNumber}] CRITICAL: Invalid blockId format: ${blockId}. This will not match XHTML IDs. Skipping sync.`);
        skippedCount++;
        continue;
      }
      
      // Additional validation: blockId should match expected patterns (granular IDs)
      // This prevents tts-flow- fallback IDs from being used
      if (blockId.startsWith('tts-flow-')) {
        console.error(`[SMIL Page ${pageNumber}] CRITICAL: BlockId ${blockId} is a fallback ID that won't exist in XHTML. Skipping sync to prevent silent highlight failure.`);
        skippedCount++;
        continue;
      }
      
      // Escape the blockId for use in URL fragment
      const escapedBlockId = this.escapeHtml(blockId);
      const escapedAudioPath = this.escapeHtml(audioPath);
      
      // Debug logging for first few syncs
      if (i < 3) {
        console.log(`[SMIL Page ${pageNumber}] Sync ${i}: blockId=${blockId}, clipBegin=${startTime.toFixed(3)}s, clipEnd=${endTime.toFixed(3)}s, duration=${(endTime - startTime).toFixed(3)}s, audioPath=${audioPath}`);
      }
      
      bodyContent += `    <par id="par-${escapedBlockId}">
      <text src="${this.escapeHtml(xhtmlFile)}#${escapedBlockId}"/>
      <audio src="${escapedAudioPath}" clipBegin="${startTime.toFixed(3)}s" clipEnd="${endTime.toFixed(3)}s"/>
    </par>\n`;
      
      totalDuration = Math.max(totalDuration, endTime);
    }
    
    if (skippedCount > 0) {
      console.warn(`[SMIL Page ${pageNumber}] Skipped ${skippedCount} syncs due to mapping failures or invalid data`);
    }
    
    // EPUB 3 SMIL structure with <seq> wrapper
    return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <head>
    <meta name="dtb:uid" content="conversion-job-${pageNumber}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalElapsedTime" content="${totalDuration.toFixed(3)}"/>
  </head>
  <body>
    <seq id="seq-page${pageNumber}" epub:textref="${this.escapeHtml(xhtmlFile)}">
${bodyContent}
    </seq>
  </body>
</smil>`;
  }

  static escapeHtml(text) {
    if (!text) return '';
    return String(text)
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