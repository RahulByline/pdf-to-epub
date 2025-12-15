import { JSDOM } from 'jsdom';
import fs from 'fs/promises';
import path from 'path';
import { AiConfigService } from './aiConfigService.js';
import { GeminiService } from './geminiService.js';

/**
 * Semantic XHTML Generator
 * Generates EPUB3-compliant XHTML with semantic tags and unique IDs
 * Preserves visual appearance from PDF (images, styling, layout)
 */
export class SemanticXhtmlGenerator {
  constructor() {
    this.paragraphCounter = 0;
    this.headingCounter = {};
    this.imageCounter = 0;
    this.chapterCounter = 0;
    this.fontStyles = new Map(); // Store font styles for CSS generation
    this.images = []; // Store image references
  }
  
  /**
   * Generate XHTML pages from structured document
   * @param {Array} structuredPages - Pages with classified text blocks
   * @param {string} outputDir - Output directory
   * @param {Object} options - Options including pdfFilePath for image extraction
   * @returns {Promise<Array>} - Array of page objects with href and metadata
   */
  async generatePages(structuredPages, outputDir, options = {}) {
    const pages = [];
    this.images = [];
    this.fontStyles.clear();
    
    // Extract images from PDF if available
    if (options.pdfFilePath) {
      await this.extractImagesFromPdf(structuredPages, options.pdfFilePath, outputDir);
    }
    
    // Use AI to enhance structure preservation if configured
    const aiConfig = await AiConfigService.getCurrentConfiguration();
    if (aiConfig && aiConfig.apiKey && options.useAI !== false) {
      structuredPages = await this.enhanceStructureWithAI(structuredPages, aiConfig);
    }
    
    // Group pages into chapters (split by major headings)
    const chapters = this.groupIntoChapters(structuredPages);
    
    for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
      const chapter = chapters[chapterIdx];
      this.chapterCounter++;
      
      const chapterId = `chapter_${this.chapterCounter}`;
      const fileName = `${chapterId}.xhtml`;
      const filePath = path.join(outputDir, fileName);
      
      // Generate XHTML for this chapter
      const xhtmlContent = await this.generateChapterXhtml(chapter, chapterId, outputDir);
      
      await fs.writeFile(filePath, xhtmlContent, 'utf-8');
      
      pages.push({
        id: chapterId,
        href: fileName,
        title: chapter.title || `Chapter ${this.chapterCounter}`,
        pageNumbers: chapter.pages.map(p => p.pageNumber)
      });
    }
    
    return pages;
  }
  
  /**
   * Group pages into chapters based on structure
   */
  groupIntoChapters(pages) {
    const chapters = [];
    let currentChapter = null;
    
    for (const page of pages) {
      // Check if page starts with a major heading (new chapter)
      const firstBlock = page.textBlocks?.[0];
      const isNewChapter = firstBlock?.type === 'heading1' || 
                          firstBlock?.type === 'title' ||
                          (currentChapter === null && page.pageNumber === 1);
      
      if (isNewChapter && currentChapter) {
        chapters.push(currentChapter);
        currentChapter = null;
      }
      
      if (!currentChapter) {
        currentChapter = {
          title: firstBlock?.type === 'title' || firstBlock?.type === 'heading1' 
            ? firstBlock.text 
            : `Chapter ${chapters.length + 1}`,
          pages: []
        };
      }
      
      currentChapter.pages.push(page);
    }
    
    if (currentChapter) {
      chapters.push(currentChapter);
    }
    
    // If no chapters found, create one chapter with all pages
    if (chapters.length === 0) {
      chapters.push({
        title: 'Content',
        pages: pages
      });
    }
    
    return chapters;
  }
  
  /**
   * Generate XHTML for a single chapter
   * Uses Gemini AI to preserve exact PDF structure and alignment
   */
  async generateChapterXhtml(chapter, chapterId, outputDir) {
    const dom = new JSDOM('<!DOCTYPE html>', {
      contentType: 'application/xhtml+xml'
    });
    const doc = dom.window.document;
    
    // Create root HTML element
    const html = doc.createElement('html');
    html.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    html.setAttribute('xmlns:epub', 'http://www.idpf.org/2007/ops');
    html.setAttribute('xml:lang', 'en');
    html.setAttribute('lang', 'en');
    doc.appendChild(html);
    
    // Create head
    const head = doc.createElement('head');
    html.appendChild(head);
    
    const metaCharset = doc.createElement('meta');
    metaCharset.setAttribute('charset', 'UTF-8');
    head.appendChild(metaCharset);
    
    const title = doc.createElement('title');
    title.textContent = chapter.title || 'Chapter';
    head.appendChild(title);
    
    const link = doc.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('type', 'text/css');
    link.setAttribute('href', 'styles.css');
    head.appendChild(link);
    
    // Create body
    const body = doc.createElement('body');
    html.appendChild(body);
    
    // Create main section
    const section = doc.createElement('section');
    section.setAttribute('epub:type', 'bodymatter chapter');
    section.setAttribute('id', chapterId);
    body.appendChild(section);
    
    // Process each page in chapter
    for (const page of chapter.pages) {
      // Add page images if available
      const pageImages = this.images.filter(img => img.pageNumber === page.pageNumber);
      for (const img of pageImages) {
        const figure = this.createImageElement(doc, img, outputDir);
        if (figure) {
          section.appendChild(figure);
        }
      }
      
      if (!page.textBlocks || page.textBlocks.length === 0) continue;
      
      // Process each text block
      for (const block of page.textBlocks) {
        const element = this.createSemanticElement(doc, block, page);
        if (element) {
          section.appendChild(element);
        }
      }
    }
    
    // Convert to initial XHTML string
    let xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n${doc.documentElement.outerHTML}`;
    
    // Use Gemini to refine XHTML and preserve exact structure/alignment
    const aiConfig = await AiConfigService.getCurrentConfiguration();
    if (aiConfig && aiConfig.apiKey) {
      try {
        xhtmlContent = await this.refineXhtmlWithGemini(xhtmlContent, chapter, aiConfig);
      } catch (error) {
        console.warn(`[XHTML Generator] Gemini refinement failed for chapter ${chapterId}:`, error.message);
        // Continue with original XHTML if Gemini fails
      }
    }
    
    return xhtmlContent;
  }
  
  /**
   * Use Gemini AI to refine XHTML and preserve exact PDF structure and alignment
   */
  async refineXhtmlWithGemini(xhtmlContent, chapter, aiConfig) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(aiConfig.apiKey);
      const modelName = aiConfig.modelName || 'gemini-2.5-flash';
      const model = genAI.getGenerativeModel({ model: modelName });
      
      // Prepare structure data for Gemini
      const structureData = {
        chapterTitle: chapter.title,
        pages: chapter.pages.map(page => ({
          pageNumber: page.pageNumber,
          blocks: page.textBlocks?.map(block => ({
            text: block.text,
            type: block.type,
            fontSize: block.fontSize,
            fontName: block.fontName,
            fontFamily: block.fontFamily,
            textColor: block.textColor || block.color,
            textAlign: block.textAlign || block.alignment,
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height,
            lineHeight: block.lineHeight,
            letterSpacing: block.letterSpacing,
            wordSpacing: block.wordSpacing
          })) || []
        }))
      };
      
      const prompt = `You are an expert at converting PDF content to EPUB3 XHTML while preserving EXACT visual structure and alignment.

Original PDF Structure Data:
${JSON.stringify(structureData, null, 2)}

Current XHTML:
${xhtmlContent.substring(0, 10000)}

CRITICAL REQUIREMENTS:
1. Preserve EXACT font sizes from PDF (use inline styles or CSS classes)
2. Preserve EXACT text colors from PDF
3. Preserve EXACT text alignment (left, center, right, justify)
4. Preserve EXACT spacing and positioning relative to page layout
5. Maintain semantic HTML structure (use <h1>-<h6>, <p>, <section>, etc.)
6. Add unique IDs to all text elements for audio synchronization
7. Preserve line breaks and paragraph spacing exactly as in PDF
8. Use CSS or inline styles to match PDF appearance precisely
9. Ensure all text remains selectable and searchable
10. Preserve image positions and sizes

Return ONLY the complete, valid XHTML code that matches the PDF structure exactly. Include proper XML declaration and namespace attributes. Do not include any explanations or markdown formatting - only the XHTML code.`;
      
      const response = await model.generateContent(prompt);
      const responseText = await response.response.text();
      
      // Extract XHTML from response (remove markdown code blocks if present)
      let refinedXhtml = responseText.trim();
      
      // Remove markdown code blocks
      const codeBlockMatch = refinedXhtml.match(/```(?:xml|html|xhtml)?\n([\s\S]*?)\n```/);
      if (codeBlockMatch) {
        refinedXhtml = codeBlockMatch[1].trim();
      }
      
      // Ensure XML declaration is present
      if (!refinedXhtml.startsWith('<?xml')) {
        refinedXhtml = `<?xml version="1.0" encoding="UTF-8"?>\n${refinedXhtml}`;
      }
      
      // Validate that it's valid XHTML
      try {
        const parser = new JSDOM(refinedXhtml, {
          contentType: 'application/xhtml+xml'
        });
        // If parsing succeeds, return refined XHTML
        return refinedXhtml;
      } catch (parseError) {
        console.warn('[XHTML Generator] Gemini refined XHTML failed validation, using original');
        return xhtmlContent;
      }
    } catch (error) {
      console.warn('[XHTML Generator] Gemini refinement error:', error.message);
      return xhtmlContent; // Return original if refinement fails
    }
  }
  
  /**
   * Create semantic HTML element from text block
   * Preserves EXACT styling from PDF (font size, color, alignment, spacing)
   * Uses Gemini-enhanced structure data to maintain precise appearance
   */
  createSemanticElement(doc, block, page = null) {
    const type = block.type || 'paragraph';
    const text = block.text || '';
    
    if (!text.trim()) return null;
    
    let element = null;
    let id = null;
    let styleClass = null;
    
    switch (type) {
      case 'title':
        element = doc.createElement('h1');
        id = `title_${this.chapterCounter}`;
        styleClass = 'title-style';
        break;
        
      case 'heading1':
        element = doc.createElement('h1');
        if (!this.headingCounter[1]) this.headingCounter[1] = 0;
        this.headingCounter[1]++;
        id = `h1_${this.headingCounter[1]}`;
        styleClass = 'h1-style';
        break;
        
      case 'heading2':
        element = doc.createElement('h2');
        if (!this.headingCounter[2]) this.headingCounter[2] = 0;
        this.headingCounter[2]++;
        id = `h2_${this.headingCounter[2]}`;
        styleClass = 'h2-style';
        break;
        
      case 'heading3':
        element = doc.createElement('h3');
        if (!this.headingCounter[3]) this.headingCounter[3] = 0;
        this.headingCounter[3]++;
        id = `h3_${this.headingCounter[3]}`;
        styleClass = 'h3-style';
        break;
        
      case 'list_item':
        element = doc.createElement('li');
        this.paragraphCounter++;
        id = `li_${this.paragraphCounter}`;
        styleClass = 'li-style';
        break;
        
      case 'paragraph':
      default:
        element = doc.createElement('p');
        this.paragraphCounter++;
        id = `p_${this.paragraphCounter}`;
        styleClass = 'p-style';
        break;
    }
    
    // Set unique ID for audio synchronization
    if (id) {
      element.setAttribute('id', id);
    }
    
    // Apply EXACT styling from PDF to preserve structure and alignment
    const inlineStyles = [];
    
    // Font size - preserve exactly
    if (block.fontSize) {
      const fontSizePx = typeof block.fontSize === 'number' 
        ? `${block.fontSize}px` 
        : block.fontSize;
      inlineStyles.push(`font-size: ${fontSizePx}`);
    }
    
    // Font family - preserve exactly
    if (block.fontFamily || block.fontName) {
      const fontFamily = block.fontFamily || this.mapFontName(block.fontName);
      inlineStyles.push(`font-family: ${fontFamily}`);
    }
    
    // Text color - preserve exactly
    if (block.textColor || block.color) {
      const color = block.textColor || block.color;
      inlineStyles.push(`color: ${color}`);
    }
    
    // Text alignment - preserve exactly
    if (block.textAlign || block.alignment) {
      const align = block.textAlign || block.alignment;
      inlineStyles.push(`text-align: ${align}`);
    }
    
    // Line height - preserve exactly
    if (block.lineHeight) {
      inlineStyles.push(`line-height: ${block.lineHeight}`);
    }
    
    // Letter spacing - preserve exactly
    if (block.letterSpacing) {
      inlineStyles.push(`letter-spacing: ${block.letterSpacing}`);
    }
    
    // Word spacing - preserve exactly
    if (block.wordSpacing) {
      inlineStyles.push(`word-spacing: ${block.wordSpacing}`);
    }
    
    // Margins - preserve exactly
    if (block.marginTop !== undefined) {
      inlineStyles.push(`margin-top: ${block.marginTop}px`);
    }
    if (block.marginBottom !== undefined) {
      inlineStyles.push(`margin-bottom: ${block.marginBottom}px`);
    }
    if (block.marginLeft !== undefined) {
      inlineStyles.push(`margin-left: ${block.marginLeft}px`);
    }
    if (block.marginRight !== undefined) {
      inlineStyles.push(`margin-right: ${block.marginRight}px`);
    }
    
    // Padding - preserve exactly
    if (block.padding !== undefined) {
      inlineStyles.push(`padding: ${block.padding}px`);
    }
    
    // Position (relative positioning to maintain layout)
    if (block.x !== undefined && block.y !== undefined && page) {
      // Store position data for CSS positioning
      element.setAttribute('data-x', block.x.toString());
      element.setAttribute('data-y', block.y.toString());
      if (page.width) element.setAttribute('data-page-width', page.width.toString());
      if (page.height) element.setAttribute('data-page-height', page.height.toString());
    }
    
    // Set text content
    element.textContent = text;
    
    // Apply inline styles if any
    if (inlineStyles.length > 0) {
      element.setAttribute('style', inlineStyles.join('; '));
    }
    
    // Store style information for CSS generation
    if (styleClass) {
      this.fontStyles.set(styleClass, {
        fontSize: block.fontSize,
        fontName: block.fontName,
        fontFamily: block.fontFamily,
        textColor: block.textColor || block.color,
        textAlign: block.textAlign || block.alignment,
        lineHeight: block.lineHeight,
        letterSpacing: block.letterSpacing,
        wordSpacing: block.wordSpacing,
        marginTop: block.marginTop,
        marginBottom: block.marginBottom,
        marginLeft: block.marginLeft,
        marginRight: block.marginRight,
        padding: block.padding
      });
    }
    
    // Add data attributes for tracking and positioning
    element.setAttribute('data-block-type', type);
    if (block.fontSize) {
      element.setAttribute('data-font-size', block.fontSize.toString());
    }
    if (block.fontFamily || block.fontName) {
      element.setAttribute('data-font-family', block.fontFamily || block.fontName);
    }
    if (block.textColor || block.color) {
      element.setAttribute('data-text-color', block.textColor || block.color);
    }
    if (block.textAlign || block.alignment) {
      element.setAttribute('data-text-align', block.textAlign || block.alignment);
    }
    if (block.pageNumber) {
      element.setAttribute('data-page-number', block.pageNumber.toString());
    }
    if (block.x !== undefined && block.y !== undefined) {
      element.setAttribute('data-x', block.x.toString());
      element.setAttribute('data-y', block.y.toString());
    }
    if (page && page.width && page.height) {
      element.setAttribute('data-page-width', page.width.toString());
      element.setAttribute('data-page-height', page.height.toString());
    }
    
    return element;
  }
  
  /**
   * Build inline style from block properties
   * Preserves EXACT styling from PDF including all spacing and alignment
   */
  buildInlineStyle(block, page) {
    const styles = [];
    
    // Font size - preserve exactly (convert points to pixels if needed)
    if (block.fontSize) {
      let fontSize = block.fontSize;
      // If it's a number and seems like points (typically 8-72), convert to px
      if (typeof fontSize === 'number' && fontSize > 0 && fontSize < 200) {
        fontSize = `${(fontSize * 1.33).toFixed(2)}px`; // PDF points to CSS px
      } else if (typeof fontSize === 'string' && !fontSize.includes('px') && !fontSize.includes('em') && !fontSize.includes('%')) {
        // Assume it's a number string in points
        fontSize = `${(parseFloat(fontSize) * 1.33).toFixed(2)}px`;
      }
      styles.push(`font-size: ${fontSize}`);
    }
    
    // Font family - preserve exactly
    if (block.fontFamily) {
      styles.push(`font-family: ${block.fontFamily}`);
    } else if (block.fontName) {
      // Map PDF font names to web-safe fonts
      const fontFamily = this.mapFontName(block.fontName);
      styles.push(`font-family: ${fontFamily}`);
    }
    
    // Text color - preserve exactly
    if (block.textColor || block.color) {
      const color = block.textColor || block.color;
      styles.push(`color: ${color}`);
    }
    
    // Text alignment - preserve exactly
    if (block.textAlign || block.alignment) {
      const align = block.textAlign || block.alignment;
      styles.push(`text-align: ${align}`);
    }
    
    // Line height - preserve exactly
    if (block.lineHeight) {
      styles.push(`line-height: ${block.lineHeight}`);
    }
    
    // Letter spacing - preserve exactly
    if (block.letterSpacing) {
      styles.push(`letter-spacing: ${block.letterSpacing}`);
    }
    
    // Word spacing - preserve exactly
    if (block.wordSpacing) {
      styles.push(`word-spacing: ${block.wordSpacing}`);
    }
    
    // Margins - preserve exactly
    if (block.marginTop !== undefined) {
      styles.push(`margin-top: ${block.marginTop}px`);
    }
    if (block.marginBottom !== undefined) {
      styles.push(`margin-bottom: ${block.marginBottom}px`);
    }
    if (block.marginLeft !== undefined) {
      styles.push(`margin-left: ${block.marginLeft}px`);
    }
    if (block.marginRight !== undefined) {
      styles.push(`margin-right: ${block.marginRight}px`);
    }
    
    // Padding - preserve exactly
    if (block.padding !== undefined) {
      styles.push(`padding: ${block.padding}px`);
    }
    
    // Preserve positioning if available (for layout preservation)
    // Use relative positioning to maintain structure while keeping text selectable
    if (block.x !== undefined && block.y !== undefined && page && page.width && page.height) {
      // Store position data in attributes for CSS positioning
      // Calculate relative position for margin-based positioning
      const relativeX = ((block.x / page.width) * 100).toFixed(2);
      if (parseFloat(relativeX) > 0) {
        styles.push(`margin-left: ${relativeX}%`);
      }
    }
    
    return styles.length > 0 ? styles.join('; ') : null;
  }
  
  /**
   * Map PDF font names to web-safe fonts
   */
  mapFontName(pdfFontName) {
    if (!pdfFontName) return 'serif';
    
    const fontLower = pdfFontName.toLowerCase();
    
    // Serif fonts
    if (fontLower.includes('times') || fontLower.includes('serif')) {
      return '"Times New Roman", Times, serif';
    }
    
    // Sans-serif fonts
    if (fontLower.includes('arial') || fontLower.includes('helvetica') || fontLower.includes('sans')) {
      return 'Arial, Helvetica, sans-serif';
    }
    
    // Monospace fonts
    if (fontLower.includes('courier') || fontLower.includes('mono')) {
      return '"Courier New", Courier, monospace';
    }
    
    // Default
    return 'serif';
  }
  
  /**
   * Create image element with figure wrapper
   */
  createImageElement(doc, imageData, outputDir) {
    if (!imageData || !imageData.path) return null;
    
    this.imageCounter++;
    const imageId = `img_${this.imageCounter}`;
    const imageFileName = `image_${imageData.pageNumber}_${this.imageCounter}${path.extname(imageData.path)}`;
    const imageDestPath = path.join(outputDir, imageFileName);
    
    // Copy image to EPUB directory
    fs.copyFile(imageData.path, imageDestPath).catch(err => {
      console.warn(`[XHTML Generator] Failed to copy image: ${err.message}`);
    });
    
    const figure = doc.createElement('figure');
    figure.setAttribute('id', `fig_${imageId}`);
    figure.setAttribute('epub:type', 'figure');
    
    const img = doc.createElement('img');
    img.setAttribute('id', imageId);
    img.setAttribute('src', imageFileName);
    img.setAttribute('alt', imageData.alt || `Image ${this.imageCounter}`);
    
    if (imageData.width && imageData.height) {
      img.setAttribute('width', imageData.width.toString());
      img.setAttribute('height', imageData.height.toString());
    }
    
    figure.appendChild(img);
    
    if (imageData.caption) {
      const figcaption = doc.createElement('figcaption');
      figcaption.textContent = imageData.caption;
      figure.appendChild(figcaption);
    }
    
    return figure;
  }
  
  /**
   * Extract images from PDF pages
   */
  async extractImagesFromPdf(pages, pdfFilePath, outputDir) {
    try {
      const { PdfExtractionService } = await import('./pdfExtractionService.js');
      const imagesDir = path.join(outputDir, 'images');
      await fs.mkdir(imagesDir, { recursive: true });
      
      // Extract images from PDF
      const extractedImages = await PdfExtractionService.extractImages(pdfFilePath, imagesDir);
      
      // Map images to pages
      for (const img of extractedImages) {
        this.images.push({
          ...img,
          pageNumber: img.pageNumber || 1
        });
      }
      
      console.log(`[XHTML Generator] Extracted ${this.images.length} images from PDF`);
    } catch (error) {
      console.warn(`[XHTML Generator] Failed to extract images: ${error.message}`);
    }
  }
  
  /**
   * Enhance structure using AI to preserve exact PDF appearance
   */
  async enhanceStructureWithAI(pages, aiConfig) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(aiConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: aiConfig.modelName });
      
      const prompt = `Analyze this document structure and ensure the EPUB output maintains the EXACT visual appearance of the PDF:

${JSON.stringify(pages.map(p => ({
  pageNumber: p.pageNumber,
  blocks: p.textBlocks?.map(b => ({
    text: b.text?.substring(0, 100),
    type: b.type,
    fontSize: b.fontSize,
    fontName: b.fontName,
    textColor: b.textColor,
    x: b.x,
    y: b.y
  })) || []
})), null, 2)}

For each text block, verify:
1. Font size matches PDF exactly
2. Font family matches PDF
3. Text color matches PDF
4. Text alignment matches PDF
5. Positioning is preserved (relative to page dimensions)

Return JSON with enhanced structure preserving all visual properties.`;
      
      const response = await model.generateContent(prompt);
      const responseText = await response.response.text();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const enhanced = JSON.parse(jsonMatch[0]);
        // Apply enhancements to pages
        return enhanced.pages || pages;
      }
    } catch (error) {
      console.warn('[XHTML Generator] AI enhancement failed:', error.message);
    }
    
    return pages;
  }
  
  /**
   * Generate CSS for EPUB3
   * Preserves visual styling from PDF
   */
  async generateCSS(outputDir) {
    // Generate dynamic CSS based on extracted font styles
    let dynamicStyles = '';
    
    for (const [key, style] of this.fontStyles.entries()) {
      const cssRules = [];
      
      if (style.fontSize) {
        const fontSizePx = (style.fontSize * 1.33).toFixed(2);
        cssRules.push(`  font-size: ${fontSizePx}px`);
      }
      
      if (style.fontName) {
        const fontFamily = this.mapFontName(style.fontName);
        cssRules.push(`  font-family: ${fontFamily}`);
      }
      
      if (style.textColor) {
        cssRules.push(`  color: ${style.textColor}`);
      }
      
      if (style.textAlign) {
        cssRules.push(`  text-align: ${style.textAlign}`);
      }
      
      if (cssRules.length > 0) {
        dynamicStyles += `\n.${style.class}[data-font-size="${style.fontSize}"] {\n${cssRules.join(';\n')};\n}\n`;
      }
    }
    
    const css = `/* EPUB3 Semantic Styles - Preserving PDF Visual Appearance */
body {
  font-family: serif;
  line-height: 1.6;
  margin: 1em;
  padding: 0;
  color: #000;
  background-color: #fff;
}

/* Semantic text elements - MUST remain selectable */
p {
  margin: 0.5em 0;
  display: block;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 1em;
  margin-bottom: 0.5em;
  font-weight: bold;
  display: block;
}

h1 { font-size: 2em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }

/* Lists */
ul, ol {
  margin: 1em 0;
  padding-left: 2em;
  display: block;
}

li {
  margin: 0.5em 0;
  display: list-item;
}

/* Sections */
section[epub\\:type="chapter"] {
  display: block;
  margin: 0;
  padding: 0;
}

/* Images and Figures */
figure {
  margin: 1em 0;
  text-align: center;
  display: block;
}

figure img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

figcaption {
  margin-top: 0.5em;
  font-size: 0.9em;
  font-style: italic;
  text-align: center;
}

/* Text tracking for media overlays */
[data-block-type] {
  transition: background-color 0.3s ease;
}

[data-block-type].active {
  background-color: #ffeb3b;
  outline: 2px solid #fbc02d;
  border-radius: 2px;
}

/* Dynamic styles from PDF */
${dynamicStyles}
`;
    
    const cssPath = path.join(outputDir, 'styles.css');
    await fs.writeFile(cssPath, css, 'utf-8');
    console.log(`[XHTML Generator] Generated CSS with ${this.fontStyles.size} font style variations`);
  }
}

