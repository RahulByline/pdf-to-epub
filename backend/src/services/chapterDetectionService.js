import { GeminiService } from './geminiService.js';
import { AiConfigService } from './aiConfigService.js';

/**
 * Chapter Detection Service
 * Uses AI to intelligently detect chapter boundaries in PDF documents
 */
export class ChapterDetectionService {
  
  /**
   * Detect chapter boundaries using AI analysis
   * @param {Array} pages - Array of pages with text blocks
   * @param {Object} options - Detection options
   * @returns {Promise<Array>} - Array of chapter objects
   */
  static async detectChapters(pages, options = {}) {
    try {
      const aiConfig = await AiConfigService.getActiveConfiguration();
      if (!aiConfig || !aiConfig.apiKey) {
        console.warn('[ChapterDetection] No AI config available, falling back to heuristic detection');
        return this.detectChaptersHeuristic(pages, options);
      }

      // Prepare document structure for AI analysis
      const documentStructure = this.prepareDocumentStructure(pages);
      
      const prompt = `Analyze this document structure and identify chapter boundaries. Look for:

1. **Chapter Titles/Headings**: Text that clearly indicates new chapters (e.g., "Chapter 1", "Introduction", "Conclusion")
2. **Page Breaks**: Significant content breaks that suggest new sections
3. **Font Changes**: Major heading fonts that indicate chapter starts
4. **Content Themes**: Shifts in topic or subject matter
5. **Numbering Patterns**: Sequential numbering or lettering systems

Document Structure:
${JSON.stringify(documentStructure, null, 2)}

Return a JSON response with this structure:
{
  "chapters": [
    {
      "title": "Chapter Title",
      "startPage": 1,
      "endPage": 5,
      "confidence": 0.95,
      "reason": "Clear chapter heading found"
    }
  ],
  "detectionMethod": "ai",
  "totalChapters": 3
}

Rules:
- Each page should belong to exactly one chapter
- Chapters should not overlap
- Include confidence scores (0.0-1.0)
- Provide reasoning for each chapter boundary
- If no clear chapters found, create logical sections based on content flow`;

      const response = await GeminiService.generateContent(prompt);
      const result = this.parseAIResponse(response);
      
      if (result && result.chapters && result.chapters.length > 0) {
        console.log(`[ChapterDetection] AI detected ${result.chapters.length} chapters`);
        return this.validateAndBuildChapters(result.chapters, pages);
      }
      
      // Fallback to heuristic if AI fails
      console.warn('[ChapterDetection] AI detection failed, using heuristic approach');
      return this.detectChaptersHeuristic(pages, options);
      
    } catch (error) {
      console.error('[ChapterDetection] AI detection error:', error.message);
      return this.detectChaptersHeuristic(pages, options);
    }
  }

  /**
   * Heuristic chapter detection (fallback method)
   */
  static detectChaptersHeuristic(pages, options = {}) {
    const chapters = [];
    let currentChapter = null;
    let chapterCounter = 0;

    for (const page of pages) {
      const isNewChapter = this.isChapterBoundary(page, currentChapter, options);
      
      if (isNewChapter) {
        if (currentChapter) {
          chapters.push(currentChapter);
        }
        
        chapterCounter++;
        const chapterTitle = this.extractChapterTitle(page) || `Chapter ${chapterCounter}`;
        
        currentChapter = {
          title: chapterTitle,
          startPage: page.pageNumber,
          endPage: page.pageNumber,
          pages: [page],
          confidence: 0.8,
          reason: 'Heuristic detection based on headings and structure'
        };
      } else if (currentChapter) {
        currentChapter.endPage = page.pageNumber;
        currentChapter.pages.push(page);
      }
    }

    if (currentChapter) {
      chapters.push(currentChapter);
    }

    // Ensure we have at least one chapter
    if (chapters.length === 0) {
      chapters.push({
        title: 'Content',
        startPage: 1,
        endPage: pages.length,
        pages: pages,
        confidence: 0.6,
        reason: 'Single chapter fallback'
      });
    }

    console.log(`[ChapterDetection] Heuristic detected ${chapters.length} chapters`);
    return chapters;
  }

  /**
   * Check if a page represents a chapter boundary
   */
  static isChapterBoundary(page, currentChapter, options) {
    if (!page.textBlocks || page.textBlocks.length === 0) {
      return false;
    }

    const firstBlock = page.textBlocks[0];
    
    // Check for explicit chapter indicators
    if (this.hasChapterIndicators(firstBlock)) {
      return true;
    }

    // Check for major heading (large font, bold, etc.)
    if (this.isMajorHeading(firstBlock, page)) {
      return true;
    }

    // Check for page number patterns (new chapter often starts on odd pages)
    if (options.respectPageNumbers && page.pageNumber % 2 === 1 && currentChapter) {
      const hasSignificantBreak = this.hasSignificantContentBreak(page, currentChapter);
      if (hasSignificantBreak) {
        return true;
      }
    }

    // First page is always a chapter start
    if (!currentChapter && page.pageNumber === 1) {
      return true;
    }

    return false;
  }

  /**
   * Check for explicit chapter indicators in text
   */
  static hasChapterIndicators(textBlock) {
    if (!textBlock || !textBlock.text) return false;
    
    const text = textBlock.text.toLowerCase().trim();
    
    // Common chapter patterns
    const chapterPatterns = [
      /^chapter\s+\d+/i,
      /^chapter\s+[ivxlcdm]+/i,  // Roman numerals
      /^part\s+\d+/i,
      /^section\s+\d+/i,
      /^\d+\.\s+/,  // "1. Introduction"
      /^[ivxlcdm]+\.\s+/i,  // "I. Introduction"
      /^introduction$/i,
      /^conclusion$/i,
      /^epilogue$/i,
      /^prologue$/i,
      /^preface$/i,
      /^appendix/i,
      /^bibliography$/i,
      /^references$/i,
      /^index$/i
    ];

    return chapterPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Check if text block is a major heading
   */
  static isMajorHeading(textBlock, page) {
    if (!textBlock) return false;

    // Check font size (major headings are typically larger)
    const avgFontSize = this.calculateAveragePageFontSize(page);
    if (textBlock.fontSize && avgFontSize && textBlock.fontSize > avgFontSize * 1.5) {
      return true;
    }

    // Check if it's classified as a heading
    if (textBlock.type === 'heading1' || textBlock.type === 'title') {
      return true;
    }

    // Check position (headings often appear at top of page)
    if (textBlock.y && page.height && textBlock.y < page.height * 0.2) {
      return true;
    }

    return false;
  }

  /**
   * Extract chapter title from page
   */
  static extractChapterTitle(page) {
    if (!page.textBlocks) return null;

    // Look for the first significant text block
    for (const block of page.textBlocks) {
      if (block.text && block.text.trim().length > 0) {
        // Clean up the title
        let title = block.text.trim();
        
        // Limit title length
        if (title.length > 100) {
          title = title.substring(0, 97) + '...';
        }
        
        return title;
      }
    }

    return null;
  }

  /**
   * Calculate average font size for a page
   */
  static calculateAveragePageFontSize(page) {
    if (!page.textBlocks) return 12;

    const fontSizes = page.textBlocks
      .filter(block => block.fontSize && typeof block.fontSize === 'number')
      .map(block => block.fontSize);

    if (fontSizes.length === 0) return 12;

    return fontSizes.reduce((sum, size) => sum + size, 0) / fontSizes.length;
  }

  /**
   * Check for significant content break between pages
   */
  static hasSignificantContentBreak(page, currentChapter) {
    if (!currentChapter || !currentChapter.pages.length) return false;

    const lastPage = currentChapter.pages[currentChapter.pages.length - 1];
    
    // Check for blank pages or pages with minimal content
    if (!page.textBlocks || page.textBlocks.length < 2) {
      return false;
    }

    // Check for topic shift (this would require more sophisticated analysis)
    // For now, use simple heuristics
    const pageGap = page.pageNumber - lastPage.pageNumber;
    return pageGap > 1; // More than one page gap suggests intentional break
  }

  /**
   * Prepare document structure for AI analysis
   */
  static prepareDocumentStructure(pages) {
    return pages.slice(0, 20).map(page => ({  // Limit to first 20 pages for analysis
      pageNumber: page.pageNumber,
      textBlocks: (page.textBlocks || []).slice(0, 5).map(block => ({  // First 5 blocks per page
        text: block.text ? block.text.substring(0, 200) : '',  // First 200 chars
        type: block.type,
        fontSize: block.fontSize,
        fontName: block.fontName,
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height
      }))
    }));
  }

  /**
   * Parse AI response and extract chapter information
   */
  static parseAIResponse(response) {
    try {
      // Remove markdown code blocks if present
      let responseText = response.trim();
      const codeBlockMatch = responseText.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        responseText = codeBlockMatch[1].trim();
      }

      // Try to parse JSON
      const result = JSON.parse(responseText);
      
      // Validate structure
      if (result.chapters && Array.isArray(result.chapters)) {
        return result;
      }
      
      return null;
    } catch (error) {
      console.warn('[ChapterDetection] Failed to parse AI response:', error.message);
      return null;
    }
  }

  /**
   * Validate AI-detected chapters and build chapter objects
   */
  static validateAndBuildChapters(aiChapters, pages) {
    const chapters = [];
    const pageMap = new Map(pages.map(p => [p.pageNumber, p]));

    for (const aiChapter of aiChapters) {
      if (!aiChapter.startPage || !aiChapter.endPage) continue;

      const chapterPages = [];
      for (let pageNum = aiChapter.startPage; pageNum <= aiChapter.endPage; pageNum++) {
        const page = pageMap.get(pageNum);
        if (page) {
          chapterPages.push(page);
        }
      }

      if (chapterPages.length > 0) {
        chapters.push({
          title: aiChapter.title || `Chapter ${chapters.length + 1}`,
          startPage: aiChapter.startPage,
          endPage: aiChapter.endPage,
          pages: chapterPages,
          confidence: aiChapter.confidence || 0.8,
          reason: aiChapter.reason || 'AI detection'
        });
      }
    }

    // Ensure all pages are included
    const coveredPages = new Set();
    chapters.forEach(chapter => {
      chapter.pages.forEach(page => coveredPages.add(page.pageNumber));
    });

    const uncoveredPages = pages.filter(page => !coveredPages.has(page.pageNumber));
    if (uncoveredPages.length > 0) {
      // Add uncovered pages to the last chapter or create a new one
      if (chapters.length > 0) {
        chapters[chapters.length - 1].pages.push(...uncoveredPages);
        chapters[chapters.length - 1].endPage = Math.max(...uncoveredPages.map(p => p.pageNumber));
      } else {
        chapters.push({
          title: 'Content',
          startPage: Math.min(...uncoveredPages.map(p => p.pageNumber)),
          endPage: Math.max(...uncoveredPages.map(p => p.pageNumber)),
          pages: uncoveredPages,
          confidence: 0.6,
          reason: 'Fallback for uncovered pages'
        });
      }
    }

    return chapters;
  }
}