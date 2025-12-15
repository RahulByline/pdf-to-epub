import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import JSZip from 'jszip';
import { AiPdfService } from './aiPdfService.js';

/**
 * Advanced EPUB3 Generator
 * Generates complete EPUB3 packages with word-level IDs, mapping files,
 * image classification, OCR support, SMIL files, and JavaScript utilities
 * Uses AI for intelligent text extraction and layout preservation
 */
export class Epub3Generator {
  constructor(pdfFilePath, outputDir, jobId) {
    this.pdfFilePath = pdfFilePath;
    this.outputDir = outputDir;
    this.jobId = jobId;
    this.tempEpubDir = path.join(outputDir, `temp_epub_${jobId}`);
    
    // Global counters for unique IDs
    this.paragraphCounter = 0;
    this.wordCounter = 0;
    this.imageCounter = 0;
    
    // Storage for mappings and content
    this.wordMapping = {};
    this.pages = []; // Changed from chapters to pages
    this.images = {
      figures: [],
      tables: [],
      diagrams: [],
      others: []
    };
    this.ocrData = [];
    this.metadata = {
      title: '',
      author: 'Unknown',
      language: 'en',
      identifier: `urn:uuid:${jobId}`
    };
  }

  /**
   * Main entry point - Generate complete EPUB3 package
   */
  async generate() {
    try {
      // Step 1: Create directory structure
      await this.createDirectoryStructure();
      
      // Step 2: Parse PDF and extract content
      const pdfData = await this.parsePdf();
      
      // Step 3: Extract and classify images using AI
      await this.extractAndClassifyImages(pdfData);
      
      // Step 4: Generate XHTML pages with word-level IDs using AI
      await this.generateXhtmlPages(pdfData);
      
      // Step 5: Generate mapping files
      await this.generateMappingFiles();
      
      // Step 6: Generate OCR files (if needed)
      await this.generateOcrFiles();
      
      // Step 7: Generate SMIL files
      await this.generateSmilFiles();
      
      // Step 8: Generate JavaScript files
      await this.generateJavaScriptFiles();
      
      // Step 9: Generate CSS
      await this.generateCss();
      
      // Step 10: Generate OPF manifest
      await this.generateOpf();
      
      // Step 11: Generate navigation document
      await this.generateNav();
      
      // Step 12: Generate container.xml
      await this.generateContainer();
      
      // Step 13: Package EPUB
      const epubPath = await this.packageEpub();
      
      // Step 14: Cleanup temp directory
      await this.cleanup();
      
      return epubPath;
    } catch (error) {
      console.error('Error generating EPUB3:', error);
      await this.cleanup().catch(() => {});
      throw error;
    }
  }

  /**
   * Create EPUB3 directory structure
   */
  async createDirectoryStructure() {
    const dirs = [
      'META-INF',
      'xhtml',
      'mapping',
      'images/figures',
      'images/tables',
      'images/diagrams',
      'images/others',
      'css',
      'js',
      'smil',
      'ocr'
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.tempEpubDir, dir), { recursive: true });
    }
  }

  /**
   * Parse PDF and extract text and metadata
   */
  async parsePdf() {
    try {
      console.log(`[EPUB3 ${this.jobId}] Reading PDF file: ${this.pdfFilePath}`);
      const pdfBuffer = await fs.readFile(this.pdfFilePath);
      console.log(`[EPUB3 ${this.jobId}] PDF file read, size: ${pdfBuffer.length} bytes`);
      
      console.log(`[EPUB3 ${this.jobId}] Parsing PDF with pdf-parse...`);
      const pdfData = await pdfParse(pdfBuffer);
      console.log(`[EPUB3 ${this.jobId}] PDF parsed successfully. Pages: ${pdfData.numpages}, Text length: ${pdfData.text?.length || 0}`);
      
      // Extract metadata
      if (pdfData.info && pdfData.info.Title) {
        this.metadata.title = pdfData.info.Title;
      } else {
        this.metadata.title = `Document ${this.jobId}`;
      }
      
      if (pdfData.info && pdfData.info.Author) {
        this.metadata.author = pdfData.info.Author;
      }
      
      // Split text into pages (approximate - pdf-parse doesn't always preserve page breaks)
      const numPages = pdfData.numpages || 1; // Ensure we have at least 1 page
      const textPages = this.splitTextIntoPages(pdfData.text, numPages);
      console.log(`[EPUB3 ${this.jobId}] Text split into ${textPages.length} pages`);
      
      return {
        text: pdfData.text,
        textPages,
        numPages: numPages, // Use consistent property name
        numpages: numPages, // Also include lowercase for compatibility
        metadata: pdfData.info
      };
    } catch (error) {
      console.error(`[EPUB3 ${this.jobId}] Error parsing PDF:`, error);
      throw new Error(`Failed to parse PDF: ${error.message}`);
    }
  }

  /**
   * Split text into pages (approximate method)
   */
  splitTextIntoPages(text, numPages) {
    if (numPages <= 1) {
      return [text];
    }
    
    const lines = text.split('\n');
    const linesPerPage = Math.ceil(lines.length / numPages);
    const pages = [];
    
    for (let i = 0; i < numPages; i++) {
      const start = i * linesPerPage;
      const end = Math.min((i + 1) * linesPerPage, lines.length);
      pages.push(lines.slice(start, end).join('\n'));
    }
    
    return pages;
  }

  /**
   * Extract and classify images from PDF using AI
   */
  async extractAndClassifyImages(pdfData) {
    try {
      // Use AI service to extract and classify images
      const images = await AiPdfService.extractAndClassifyImages(this.pdfFilePath);
      
      // Organize images by category
      for (const img of images) {
        if (img.category === 'figure') {
          this.images.figures.push(img);
        } else if (img.category === 'table') {
          this.images.tables.push(img);
        } else if (img.category === 'diagram') {
          this.images.diagrams.push(img);
        } else {
          this.images.others.push(img);
        }
      }
      
      console.log(`Extracted and classified ${images.length} images`);
    } catch (error) {
      console.warn('AI image extraction failed, continuing without images:', error.message);
    }
  }

  /**
   * Generate XHTML pages with word-level IDs using AI for structure extraction
   * Each PDF page becomes an XHTML page, preserving layout
   */
  async generateXhtmlPages(pdfData) {
    // Reset counters for new generation
    this.paragraphCounter = 0;
    this.wordCounter = 0;
    this.wordMapping = {};
    this.pages = [];
    
    // Use numPages consistently (support both numPages and numpages for compatibility)
    const totalPages = pdfData.numPages || pdfData.numpages || 1;
    
    // Ensure we have at least one page
    if (totalPages === 0) {
      console.warn(`[EPUB3 ${this.jobId}] PDF has 0 pages, creating a single empty page`);
      const emptyContent = {
        headers: [],
        paragraphs: [{ text: 'This PDF appears to be empty or could not be parsed.' }],
        lists: [],
        tables: []
      };
      await this.writePageXhtml(1, emptyContent);
      return;
    }
    
    // Process each page individually
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      const pageNumber = pageIndex + 1;
      console.log(`[EPUB3 ${this.jobId}] Processing page ${pageNumber}/${totalPages}...`);
      
      try {
        // Try to use AI to extract structured content from page
        let structuredContent;
        try {
          structuredContent = await AiPdfService.extractTextFromPage(
            this.pdfFilePath,
            pageNumber
          );
          console.log(`[EPUB3 ${this.jobId}] Page ${pageNumber}: AI extraction successful`);
        } catch (aiError) {
          console.warn(`[EPUB3 ${this.jobId}] Page ${pageNumber}: AI extraction failed, using fallback:`, aiError.message);
          // Fallback: use simple text extraction
          const pageText = pdfData.textPages[pageIndex] || '';
          structuredContent = AiPdfService.fallbackStructure(pageText);
        }
        
        // Ensure we have valid content structure
        if (!structuredContent || (!structuredContent.headers && !structuredContent.paragraphs)) {
          console.warn(`[EPUB3 ${this.jobId}] Page ${pageNumber}: Invalid content structure, creating default`);
          structuredContent = {
            headers: [],
            paragraphs: [{ text: pdfData.textPages[pageIndex] || `Page ${pageNumber} content` }],
            lists: [],
            tables: []
          };
        }
        
        // Generate XHTML for this page with layout preservation
        await this.writePageXhtml(pageNumber, structuredContent);
        console.log(`[EPUB3 ${this.jobId}] Page ${pageNumber}: XHTML generated`);
      } catch (error) {
        console.error(`[EPUB3 ${this.jobId}] Error processing page ${pageNumber}:`, error);
        // Fallback: use simple text extraction
        try {
          const pageText = pdfData.textPages[pageIndex] || `Page ${pageNumber}`;
          const fallbackContent = AiPdfService.fallbackStructure(pageText);
          await this.writePageXhtml(pageNumber, fallbackContent);
          console.log(`[EPUB3 ${this.jobId}] Page ${pageNumber}: Fallback XHTML generated`);
        } catch (fallbackError) {
          console.error(`[EPUB3 ${this.jobId}] Page ${pageNumber}: Fallback also failed:`, fallbackError);
          // Last resort: create a minimal page
          try {
            const minimalContent = {
              headers: [{ level: 1, text: `Page ${pageNumber}` }],
              paragraphs: [{ text: 'Content could not be extracted from this page.' }],
              lists: [],
              tables: []
            };
            await this.writePageXhtml(pageNumber, minimalContent);
            console.log(`[EPUB3 ${this.jobId}] Page ${pageNumber}: Minimal page created`);
          } catch (minimalError) {
            console.error(`[EPUB3 ${this.jobId}] Page ${pageNumber}: Even minimal page creation failed:`, minimalError);
            throw new Error(`Failed to process page ${pageNumber}: ${minimalError.message}`);
          }
        }
      }
    }
    
    // Verify pages were created
    if (this.pages.length === 0) {
      throw new Error('No pages were generated from the PDF. The EPUB file would be empty.');
    }
    
    console.log(`[EPUB3 ${this.jobId}] Successfully generated ${this.pages.length} pages`);
  }

  /**
   * Process a paragraph and add word-level IDs (page-based)
   */
  processParagraph(text, pageNumber, startWordIndex) {
    this.paragraphCounter++;
    const paraId = `p${String(this.paragraphCounter).padStart(4, '0')}`;
    
    // Split text into words (handle punctuation)
    const words = this.splitIntoWords(text);
    const wordSpans = [];
    
    words.forEach((word, index) => {
      if (word.trim().length === 0) {
        wordSpans.push(word); // Preserve whitespace
        return;
      }
      
      this.wordCounter++;
      const wordId = `w${String(this.wordCounter).padStart(5, '0')}`;
      
      // Store in mapping (page-based)
      this.wordMapping[wordId] = {
        text: word.trim(),
        page: pageNumber,
        index: startWordIndex + index + 1,
        paragraphId: paraId,
        boundingBox: null // Would be filled from PDF coordinates if available
      };
      
      wordSpans.push(`<span id="${wordId}">${this.escapeHtml(word)}</span>`);
    });
    
    return {
      paraId,
      html: `<p id="${paraId}">${wordSpans.join('')}</p>`,
      wordCount: words.filter(w => w.trim().length > 0).length
    };
  }

  /**
   * Split text into words while preserving spaces
   */
  splitIntoWords(text) {
    // Split by word boundaries but keep spaces
    const tokens = [];
    let currentWord = '';
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (/\s/.test(char)) {
        if (currentWord) {
          tokens.push(currentWord);
          currentWord = '';
        }
        tokens.push(char);
      } else {
        currentWord += char;
      }
    }
    
    if (currentWord) {
      tokens.push(currentWord);
    }
    
    return tokens;
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Write XHTML page file with layout preservation
   */
  async writePageXhtml(pageNumber, structuredContent) {
    const pageId = `page${pageNumber}`;
    const fileName = `${pageId}.xhtml`;
    const filePath = path.join(this.tempEpubDir, 'xhtml', fileName);
    
    // Process headers
    const headersHtml = structuredContent.headers?.map((header, idx) => {
      const headerText = this.processTextWithWordIds(header.text, pageNumber);
      return `<h${header.level || 1} id="h${pageNumber}_${idx}">${headerText.html}</h${header.level || 1}>`;
    }).join('\n    ') || '';
    
    // Process paragraphs with proper page number
    let wordIndexCounter = 0;
    const paragraphsHtml = structuredContent.paragraphs?.map((para, idx) => {
      const paraText = para.text || '';
      const processed = this.processParagraph(paraText, pageNumber, wordIndexCounter);
      wordIndexCounter += processed.wordCount;
      return processed.html;
    }).join('\n    ') || '';
    
    // Process lists
    const listsHtml = structuredContent.lists?.map((list, idx) => {
      const items = list.items?.map(item => {
        const itemText = this.processTextWithWordIds(item, pageNumber);
        return `<li>${itemText.html}</li>`;
      }).join('\n        ') || '';
      const tag = list.type === 'ordered' ? 'ol' : 'ul';
      return `<${tag} id="list${pageNumber}_${idx}">\n        ${items}\n      </${tag}>`;
    }).join('\n    ') || '';
    
    // Preserve page layout using CSS
    const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>Page ${pageNumber}</title>
  <link rel="stylesheet" type="text/css" href="../css/style.css"/>
  <style>
    .page-container {
      width: 100%;
      min-height: 100vh;
      padding: 2em;
      box-sizing: border-box;
      background-color: #ffffff;
    }
    .page-content {
      max-width: 100%;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <section id="${pageId}" epub:type="page" class="page-container">
    <div class="page-content">
      ${headersHtml}
      ${paragraphsHtml}
      ${listsHtml}
    </div>
  </section>
</body>
</html>`;
    
    await fs.writeFile(filePath, xhtmlContent, 'utf8');
    
    // Calculate word count
    const wordCount = structuredContent.paragraphs?.reduce((count, para) => {
      return count + (para.text?.split(/\s+/).filter(w => w.length > 0).length || 0);
    }, 0) || 0;
    
    // Add to pages array
    this.pages.push({
      id: pageId,
      number: pageNumber,
      fileName,
      wordCount
    });
    
    console.log(`[EPUB3 ${this.jobId}] Page ${pageNumber} written: ${fileName} (${wordCount} words)`);
  }
  
  /**
   * Process text and add word-level IDs
   */
  processTextWithWordIds(text, pageNumber) {
    const words = this.splitIntoWords(text);
    const wordSpans = [];
    
    words.forEach((word) => {
      if (word.trim().length === 0) {
        wordSpans.push(word);
        return;
      }
      
      this.wordCounter++;
      const wordId = `w${String(this.wordCounter).padStart(5, '0')}`;
      
      // Store in mapping
      this.wordMapping[wordId] = {
        text: word.trim(),
        page: pageNumber,
        wordId,
        boundingBox: null
      };
      
      wordSpans.push(`<span id="${wordId}">${this.escapeHtml(word)}</span>`);
    });
    
    return {
      html: wordSpans.join(''),
      wordCount: words.filter(w => w.trim().length > 0).length
    };
  }

  /**
   * Generate mapping.json
   */
  async generateMappingFiles() {
    // Generate mapping.json
    const mappingJson = JSON.stringify(this.wordMapping, null, 2);
    await fs.writeFile(
      path.join(this.tempEpubDir, 'mapping', 'mapping.json'),
      mappingJson,
      'utf8'
    );
    
    // Generate mapping.xml
    const mappingXml = this.generateMappingXml();
    await fs.writeFile(
      path.join(this.tempEpubDir, 'mapping', 'mapping.xml'),
      mappingXml,
      'utf8'
    );
  }

  /**
   * Generate mapping.xml content
   */
  generateMappingXml() {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<mapping>
`;
    
    for (const [wordId, data] of Object.entries(this.wordMapping)) {
      xml += `  <word id="${wordId}">
    <text><![CDATA[${data.text}]]></text>
    <page>${data.page || 'N/A'}</page>
    <index>${data.index || 'N/A'}</index>
    ${data.paragraphId ? `<paragraphId>${data.paragraphId}</paragraphId>` : ''}
    ${data.boundingBox ? `<boundingBox>${JSON.stringify(data.boundingBox)}</boundingBox>` : ''}
  </word>
`;
    }
    
    xml += `</mapping>`;
    return xml;
  }

  /**
   * Generate OCR files (placeholder - would use Tesseract.js in production)
   */
  async generateOcrFiles() {
    // TODO: Implement OCR using Tesseract.js if PDF is scanned
    // For now, create placeholder structure
    
    const ocrData = {
      pages: [],
      totalWords: this.wordCounter,
      confidence: 0.95, // Would be calculated from OCR confidence scores
      language: this.metadata.language
    };
    
    const ocrJson = JSON.stringify(ocrData, null, 2);
    await fs.writeFile(
      path.join(this.tempEpubDir, 'ocr', 'ocr_data.json'),
      ocrJson,
      'utf8'
    );
    
    // Generate ocr_words.xml
    const ocrXml = `<?xml version="1.0" encoding="UTF-8"?>
<ocrWords>
  <metadata>
    <totalWords>${ocrData.totalWords}</totalWords>
    <confidence>${ocrData.confidence}</confidence>
    <language>${ocrData.language}</language>
  </metadata>
  <!-- OCR word data would be inserted here -->
</ocrWords>`;
    
    await fs.writeFile(
      path.join(this.tempEpubDir, 'ocr', 'ocr_words.xml'),
      ocrXml,
      'utf8'
    );
  }

  /**
   * Generate SMIL files for each page
   */
  async generateSmilFiles() {
    for (const page of this.pages) {
      const smilContent = this.generatePageSmil(page);
      const fileName = `${page.id}.smil`;
      await fs.writeFile(
        path.join(this.tempEpubDir, 'smil', fileName),
        smilContent,
        'utf8'
      );
    }
  }

  /**
   * Generate SMIL content for a page
   */
  generatePageSmil(page) {
    let smil = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
`;
    
    // Group words by paragraph for SMIL structure
    const wordsByParagraph = {};
    for (const [wordId, data] of Object.entries(this.wordMapping)) {
      if (data.page === page.number && data.paragraphId) {
        if (!wordsByParagraph[data.paragraphId]) {
          wordsByParagraph[data.paragraphId] = [];
        }
        wordsByParagraph[data.paragraphId].push({ wordId, ...data });
      }
    }
    
    for (const [paraId, words] of Object.entries(wordsByParagraph)) {
      smil += `    <par id="${paraId}">
`;
      words.forEach(word => {
        smil += `      <text src="xhtml/${page.fileName}#${word.wordId}"/>
`;
      });
      smil += `    </par>
`;
    }
    
    smil += `  </body>
</smil>`;
    return smil;
  }

  /**
   * Generate JavaScript files for word tracking and highlighting
   */
  async generateJavaScriptFiles() {
    // Generate highlighter.js
    await fs.writeFile(
      path.join(this.tempEpubDir, 'js', 'highlighter.js'),
      this.getHighlighterJs(),
      'utf8'
    );
    
    // Generate wordTracker.js
    await fs.writeFile(
      path.join(this.tempEpubDir, 'js', 'wordTracker.js'),
      this.getWordTrackerJs(),
      'utf8'
    );
    
    // Generate navigation.js
    await fs.writeFile(
      path.join(this.tempEpubDir, 'js', 'navigation.js'),
      this.getNavigationJs(),
      'utf8'
    );
  }

  /**
   * Highlighter JavaScript
   */
  getHighlighterJs() {
    return `// Word Highlighter for EPUB3
(function() {
  'use strict';
  
  let currentHighlight = null;
  let highlightColor = '#ffff00';
  let selectedWordId = null;
  
  // Initialize highlighting
  function init() {
    // Add click handlers to all word spans
    document.querySelectorAll('span[id^="w"]').forEach(span => {
      span.style.cursor = 'pointer';
      span.addEventListener('click', function(e) {
        highlightWord(this.id);
        e.stopPropagation();
      });
    });
    
    // Clear highlight on document click
    document.addEventListener('click', function(e) {
      if (!e.target.closest('span[id^="w"]')) {
        clearHighlight();
      }
    });
  }
  
  // Highlight a word by ID
  function highlightWord(wordId) {
    clearHighlight();
    selectedWordId = wordId;
    const element = document.getElementById(wordId);
    if (element) {
      element.style.backgroundColor = highlightColor;
      element.style.fontWeight = 'bold';
      currentHighlight = element;
      
      // Dispatch custom event
      const event = new CustomEvent('wordHighlighted', {
        detail: { wordId, element, text: element.textContent }
      });
      document.dispatchEvent(event);
    }
  }
  
  // Clear current highlight
  function clearHighlight() {
    if (currentHighlight) {
      currentHighlight.style.backgroundColor = '';
      currentHighlight.style.fontWeight = '';
      currentHighlight = null;
      selectedWordId = null;
    }
  }
  
  // Highlight multiple words
  function highlightWords(wordIds) {
    clearHighlight();
    wordIds.forEach(wordId => {
      const element = document.getElementById(wordId);
      if (element) {
        element.style.backgroundColor = highlightColor;
      }
    });
  }
  
  // Set highlight color
  function setHighlightColor(color) {
    highlightColor = color;
  }
  
  // Get selected word ID
  function getSelectedWordId() {
    return selectedWordId;
  }
  
  // Export API
  window.Highlighter = {
    init,
    highlightWord,
    clearHighlight,
    highlightWords,
    setHighlightColor,
    getSelectedWordId
  };
  
  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
  }

  /**
   * Word Tracker JavaScript
   */
  getWordTrackerJs() {
    return `// Word Tracker for EPUB3 - Tracks word positions and provides navigation
(function() {
  'use strict';
  
  let wordMapping = null;
  let selectionStart = null;
  let selectionEnd = null;
  
  // Load mapping data
  async function loadMapping() {
    if (wordMapping) return wordMapping;
    
    try {
      const response = await fetch('mapping/mapping.json');
      wordMapping = await response.json();
      return wordMapping;
    } catch (error) {
      console.error('Failed to load word mapping:', error);
      return {};
    }
  }
  
  // Get word info by ID
  async function getWordInfo(wordId) {
    const mapping = await loadMapping();
    return mapping[wordId] || null;
  }
  
  // Find word ID by text and page
  async function findWordId(text, page) {
    const mapping = await loadMapping();
    for (const [wordId, data] of Object.entries(mapping)) {
      if (data.text === text && data.page === page) {
        return wordId;
      }
    }
    return null;
  }
  
  // Jump to specific word ID
  async function jumpToWord(wordId) {
    const info = await getWordInfo(wordId);
    if (!info) {
      console.warn('Word ID not found:', wordId);
      return false;
    }
    
    // Navigate to page if needed
    const pageFile = \`xhtml/page\${info.page}.xhtml\`;
    if (window.location.pathname.endsWith(pageFile)) {
      // Already in correct page
      const element = document.getElementById(wordId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (window.Highlighter) {
          window.Highlighter.highlightWord(wordId);
        }
        return true;
      }
    } else {
      // Navigate to page
      window.location.href = pageFile + '#' + wordId;
    }
    return false;
  }
  
  // Track text selection
  function trackSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const startElement = range.startContainer.parentElement;
      const endElement = range.endContainer.parentElement;
      
      if (startElement && startElement.id && startElement.id.startsWith('w')) {
        selectionStart = startElement.id;
      }
      if (endElement && endElement.id && endElement.id.startsWith('w')) {
        selectionEnd = endElement.id;
      }
    }
  }
  
  // Get selected word range
  function getSelectedRange() {
    return {
      start: selectionStart,
      end: selectionEnd
    };
  }
  
  // Initialize tracking
  function init() {
    document.addEventListener('mouseup', trackSelection);
    document.addEventListener('keyup', trackSelection);
  }
  
  // Export API
  window.WordTracker = {
    loadMapping,
    getWordInfo,
    findWordId,
    jumpToWord,
    getSelectedRange,
    init
  };
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
  }

  /**
   * Navigation JavaScript (page-based)
   */
  getNavigationJs() {
    return `// Navigation utilities for EPUB3 (Page-based)
(function() {
  'use strict';
  
  const pages = ${JSON.stringify(this.pages.map(p => ({
    id: p.id,
    number: p.number,
    fileName: p.fileName
  })))};
  
  // Get current page number
  function getCurrentPage() {
    const path = window.location.pathname;
    const match = path.match(/page(\\d+)\\.xhtml/);
    return match ? parseInt(match[1]) : 1;
  }
  
  // Navigate to next page
  function nextPage() {
    const current = getCurrentPage();
    if (current < pages.length) {
      window.location.href = \`xhtml/page\${current + 1}.xhtml\`;
    }
  }
  
  // Navigate to previous page
  function previousPage() {
    const current = getCurrentPage();
    if (current > 1) {
      window.location.href = \`xhtml/page\${current - 1}.xhtml\`;
    }
  }
  
  // Navigate to specific page
  function goToPage(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= pages.length) {
      window.location.href = \`xhtml/page\${pageNumber}.xhtml\`;
    }
  }
  
  // Get page list
  function getPages() {
    return pages;
  }
  
  // Export API
  window.Navigation = {
    getCurrentPage,
    nextPage,
    previousPage,
    goToPage,
    getPages
  };
})();
`;
  }

  /**
   * Generate CSS file with PDF layout preservation
   */
  async generateCss() {
    const css = `/* EPUB3 Styles - PDF Layout Preservation */
body {
  font-family: Georgia, serif;
  line-height: 1.6;
  margin: 0;
  padding: 0;
  color: #333;
  background-color: #ffffff;
}

/* Page container preserves PDF page layout */
.page-container {
  width: 100%;
  min-height: 100vh;
  padding: 2em;
  box-sizing: border-box;
  background-color: #ffffff;
  page-break-after: always;
}

.page-content {
  max-width: 100%;
  margin: 0 auto;
  position: relative;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 0.5em;
  margin-bottom: 0.3em;
  color: #222;
  font-weight: bold;
}

h1 {
  font-size: 1.8em;
  border-bottom: 2px solid #ddd;
  padding-bottom: 0.3em;
}

h2 {
  font-size: 1.4em;
}

h3 {
  font-size: 1.2em;
}

p {
  margin: 0.8em 0;
  text-align: justify;
  text-align-last: left;
}

/* Word-level spans for tracing */
span[id^="w"] {
  transition: background-color 0.2s ease;
  position: relative;
}

span[id^="w"]:hover {
  background-color: #f0f0f0;
  cursor: pointer;
}

span[id^="w"].highlighted {
  background-color: #ffff00;
  font-weight: bold;
}

/* Images preserve position and size */
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}

img[id^="img"] {
  object-fit: contain;
}

/* Lists preserve formatting */
ul, ol {
  margin: 0.8em 0;
  padding-left: 2em;
}

li {
  margin: 0.4em 0;
}

/* Tables preserve layout */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
}

table td, table th {
  border: 1px solid #ddd;
  padding: 0.5em;
  text-align: left;
}

/* Section styling */
section {
  margin-bottom: 2em;
}

section[epub:type="page"] {
  break-after: page;
}

/* Print styles */
@media print {
  body {
    margin: 0;
    padding: 0;
  }
  
  .page-container {
    page-break-after: always;
  }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .page-container {
    padding: 1em;
  }
  
  h1 { font-size: 1.5em; }
  h2 { font-size: 1.3em; }
  h3 { font-size: 1.1em; }
}
`;
    
    await fs.writeFile(
      path.join(this.tempEpubDir, 'css', 'style.css'),
      css,
      'utf8'
    );
  }

  /**
   * Generate OPF manifest
   */
  async generateOpf() {
    const manifestItems = [];
    const spineItems = [];
    
    // Add XHTML pages
    this.pages.forEach(page => {
      const itemId = `page-${page.number}`;
      manifestItems.push(`    <item id="${itemId}" href="xhtml/${page.fileName}" media-type="application/xhtml+xml"/>`);
      spineItems.push(`    <itemref idref="${itemId}"/>`);
    });
    
    // Add CSS
    manifestItems.push(`    <item id="css" href="css/style.css" media-type="text/css"/>`);
    
    // Add JavaScript files
    manifestItems.push(`    <item id="highlighter" href="js/highlighter.js" media-type="text/javascript"/>`);
    manifestItems.push(`    <item id="tracker" href="js/wordTracker.js" media-type="text/javascript"/>`);
    manifestItems.push(`    <item id="navigation" href="js/navigation.js" media-type="text/javascript"/>`);
    
    // Add mapping files
    manifestItems.push(`    <item id="mapping-json" href="mapping/mapping.json" media-type="application/json"/>`);
    manifestItems.push(`    <item id="mapping-xml" href="mapping/mapping.xml" media-type="application/xml"/>`);
    
    // Add SMIL files
    this.pages.forEach(page => {
      const itemId = `smil-${page.number}`;
      manifestItems.push(`    <item id="${itemId}" href="smil/${page.id}.smil" media-type="application/smil+xml"/>`);
    });
    
    // Add OCR files
    manifestItems.push(`    <item id="ocr-json" href="ocr/ocr_data.json" media-type="application/json"/>`);
    manifestItems.push(`    <item id="ocr-xml" href="ocr/ocr_words.xml" media-type="application/xml"/>`);
    
    // Add images (if any)
    Object.entries(this.images).forEach(([category, images]) => {
      images.forEach((img, index) => {
        const itemId = `img-${category}-${index}`;
        manifestItems.push(`    <item id="${itemId}" href="images/${category}/${img.fileName}" media-type="${img.mediaType}"/>`);
      });
    });
    
    // Add navigation document
    manifestItems.push(`    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
    
    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${this.metadata.identifier}</dc:identifier>
    <dc:title>${this.escapeXml(this.metadata.title)}</dc:title>
    <dc:creator>${this.escapeXml(this.metadata.author)}</dc:creator>
    <dc:language>${this.metadata.language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  
  <spine toc="nav">
${spineItems.join('\n')}
  </spine>
</package>`;
    
    await fs.writeFile(
      path.join(this.tempEpubDir, 'content.opf'),
      opfContent,
      'utf8'
    );
  }

  /**
   * Generate navigation document (nav.xhtml) - Page-based
   */
  async generateNav() {
    const navItems = this.pages.map(page => 
      `      <li><a href="xhtml/${page.fileName}">Page ${page.number}</a></li>`
    ).join('\n');
    
    const navContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>Navigation</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;
    
    await fs.writeFile(
      path.join(this.tempEpubDir, 'nav.xhtml'),
      navContent,
      'utf8'
    );
  }

  /**
   * Generate container.xml
   */
  async generateContainer() {
    const containerContent = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    
    await fs.writeFile(
      path.join(this.tempEpubDir, 'META-INF', 'container.xml'),
      containerContent,
      'utf8'
    );
    
    // Create mimetype file (must be uncompressed in EPUB)
    await fs.writeFile(
      path.join(this.tempEpubDir, 'mimetype'),
      'application/epub+zip',
      'utf8'
    );
  }

  /**
   * Package EPUB as ZIP file
   */
  async packageEpub() {
    const epubFileName = `converted_${this.jobId}.epub`;
    const epubFilePath = path.join(this.outputDir, epubFileName);
    
    // Create ZIP with proper EPUB structure
    // mimetype must be first and uncompressed per EPUB spec
    const zip = new JSZip();
    
    // Add mimetype first (uncompressed)
    const mimetypePath = path.join(this.tempEpubDir, 'mimetype');
    const mimetypeContent = await fs.readFile(mimetypePath, 'utf8');
    zip.file('mimetype', mimetypeContent, { compression: 'STORE' });
    
    // Add all other files (compressed)
    await this.addDirectoryToZip(zip, this.tempEpubDir, '', ['mimetype']);
    
    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      streamFiles: true
    });
    
    // Write EPUB file
    await fs.writeFile(epubFilePath, zipBuffer);
    
    return epubFilePath;
  }

  /**
   * Recursively add directory to ZIP
   */
  async addDirectoryToZip(zip, dirPath, zipPath, excludeFiles = []) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (excludeFiles.includes(entry.name)) {
        continue;
      }
      
      const fullPath = path.join(dirPath, entry.name);
      const zipEntryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        await this.addDirectoryToZip(zip, fullPath, zipEntryPath, excludeFiles);
      } else {
        const content = await fs.readFile(fullPath);
        zip.file(zipEntryPath, content);
      }
    }
  }

  /**
   * Cleanup temporary directory
   */
  async cleanup() {
    try {
      await fs.rm(this.tempEpubDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Error cleaning up temp directory:', error);
    }
  }

  /**
   * Escape XML special characters
   */
  escapeXml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

