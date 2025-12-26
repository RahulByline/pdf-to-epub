/**
 * Page Filter Utility
 * Detects and filters out pages that should not be read by TTS
 * (Table of Contents, Index pages, etc.)
 */

export class PageFilter {
  /**
   * Check if a page is a Table of Contents page
   * @param {Object} page - Page object with textBlocks or text content
   * @returns {boolean}
   */
  static isTocPage(page) {
    if (!page) return false;
    
    // Check page title/heading
    const title = page.title || page.heading || '';
    const titleLower = title.toLowerCase();
    
    // Check for TOC indicators in title
    if (titleLower.includes('table of contents') || 
        titleLower.includes('contents') ||
        titleLower === 'toc' ||
        titleLower.includes('table des matières')) {
      return true;
    }
    
    // Check text content for TOC patterns
    let pageText = '';
    if (page.textBlocks && Array.isArray(page.textBlocks)) {
      pageText = page.textBlocks
        .map(block => block.text || '')
        .join(' ')
        .toLowerCase();
    } else if (page.text) {
      pageText = page.text.toLowerCase();
    } else if (page.content) {
      pageText = page.content.toLowerCase();
    }
    
    // TOC indicators in content
    const tocPatterns = [
      /table\s+of\s+contents/i,
      /^contents$/i,
      /^toc$/i,
      /chapter\s+\d+\s+page\s+\d+/i, // "Chapter 1 ... Page 5" pattern
      /^\s*(chapter|section|part)\s+\d+\s+\.\.\.\s+\d+\s*$/i, // "Chapter 1 ... 5" pattern
    ];
    
    // Check if page has TOC-like structure (multiple "Chapter X ... Page Y" patterns)
    const chapterPageMatches = pageText.match(/(chapter|section|part)\s+\d+.*?(?:page|\.\.\.)\s*\d+/gi);
    if (chapterPageMatches && chapterPageMatches.length >= 3) {
      // If we find 3+ chapter/page references, it's likely a TOC
      return true;
    }
    
    // Check for TOC patterns
    for (const pattern of tocPatterns) {
      if (pattern.test(pageText) || pattern.test(titleLower)) {
        return true;
      }
    }
    
    // Check if page has mostly navigation links (common in TOC)
    if (page.textBlocks) {
      const linkCount = page.textBlocks.filter(block => 
        block.href || block.link || (block.text && /^\d+$/.test(block.text.trim()))
      ).length;
      
      // If more than 50% of blocks are links or page numbers, likely TOC
      if (linkCount > page.textBlocks.length * 0.5 && page.textBlocks.length > 5) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if a page is an Index page
   * @param {Object} page - Page object with textBlocks or text content
   * @returns {boolean}
   */
  static isIndexPage(page) {
    if (!page) return false;
    
    // Check page title/heading
    const title = page.title || page.heading || '';
    const titleLower = title.toLowerCase();
    
    // Check for Index indicators in title
    if (titleLower.includes('index') || 
        titleLower.includes('indice') ||
        titleLower.includes('register')) {
      return true;
    }
    
    // Check text content for Index patterns
    let pageText = '';
    if (page.textBlocks && Array.isArray(page.textBlocks)) {
      pageText = page.textBlocks
        .map(block => block.text || '')
        .join(' ')
        .toLowerCase();
    } else if (page.text) {
      pageText = page.text.toLowerCase();
    } else if (page.content) {
      pageText = page.content.toLowerCase();
    }
    
    // Index indicators in content
    const indexPatterns = [
      /^index$/i,
      /^indice$/i,
      /^\s*\w+\s*\.\.\.\s*\d+\s*$/i, // "word ... 123" pattern (typical index entry)
    ];
    
    // Check if page has index-like structure (multiple "word ... page" patterns)
    const indexEntryMatches = pageText.match(/\w+\s*\.\.\.\s*\d+/gi);
    if (indexEntryMatches && indexEntryMatches.length >= 10) {
      // If we find 10+ index entries, it's likely an index page
      return true;
    }
    
    // Check for index patterns
    for (const pattern of indexPatterns) {
      if (pattern.test(pageText) || pattern.test(titleLower)) {
        return true;
      }
    }
    
    // Check if page has mostly alphabetical entries with page numbers
    if (page.textBlocks) {
      const indexLikeBlocks = page.textBlocks.filter(block => {
        const text = (block.text || '').trim();
        // Pattern: word(s) followed by dots and numbers
        return /^[a-zA-Z\s]+\s*\.\.\.\s*\d+$/.test(text);
      }).length;
      
      // If more than 60% of blocks match index pattern, likely index
      if (indexLikeBlocks > page.textBlocks.length * 0.6 && page.textBlocks.length > 5) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if a page should be skipped for TTS
   * @param {Object} page - Page object
   * @returns {boolean} - true if page should be skipped
   */
  static shouldSkipPage(page) {
    return this.isTocPage(page) || this.isIndexPage(page);
  }
  
  /**
   * Filter pages to exclude TOC and Index pages
   * @param {Array} pages - Array of page objects
   * @returns {Array} - Filtered pages array
   */
  static filterPages(pages) {
    if (!Array.isArray(pages)) return pages;
    
    return pages.filter(page => !this.shouldSkipPage(page));
  }
}

