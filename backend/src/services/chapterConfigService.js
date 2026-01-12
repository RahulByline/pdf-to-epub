import fs from 'fs/promises';
import path from 'path';

/**
 * Chapter Configuration Service
 * Allows manual configuration of chapter boundaries for specific documents
 */
export class ChapterConfigService {
  
  /**
   * Save chapter configuration for a document
   * @param {string} documentId - Document identifier (job ID or PDF hash)
   * @param {Array} chapterConfig - Chapter configuration
   * @returns {Promise<void>}
   */
  static async saveChapterConfig(documentId, chapterConfig) {
    const configDir = path.join(process.cwd(), 'backend', 'chapter_configs');
    await fs.mkdir(configDir, { recursive: true });
    
    const configPath = path.join(configDir, `${documentId}.json`);
    
    const config = {
      documentId,
      chapters: chapterConfig,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`[ChapterConfig] Saved configuration for document ${documentId}`);
  }
  
  /**
   * Load chapter configuration for a document
   * @param {string} documentId - Document identifier
   * @returns {Promise<Object|null>} - Chapter configuration or null if not found
   */
  static async loadChapterConfig(documentId) {
    try {
      const configDir = path.join(process.cwd(), 'backend', 'chapter_configs');
      const configPath = path.join(configDir, `${documentId}.json`);
      
      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      console.log(`[ChapterConfig] Loaded configuration for document ${documentId}`);
      return config;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`[ChapterConfig] Error loading config for ${documentId}:`, error.message);
      }
      return null;
    }
  }
  
  /**
   * Apply manual chapter configuration to pages
   * @param {Array} pages - Document pages
   * @param {string} documentId - Document identifier
   * @returns {Promise<Array>} - Chapters with manual configuration applied
   */
  static async applyManualConfiguration(pages, documentId) {
    const config = await this.loadChapterConfig(documentId);
    
    if (!config || !config.chapters) {
      return null; // No manual configuration found
    }
    
    const chapters = [];
    const pageMap = new Map(pages.map(p => [p.pageNumber, p]));
    
    for (const chapterConfig of config.chapters) {
      const chapterPages = [];
      
      // Handle different configuration formats
      if (chapterConfig.pageRange) {
        // Format: { title: "Chapter 1", pageRange: "1-10" }
        const [start, end] = chapterConfig.pageRange.split('-').map(n => parseInt(n.trim()));
        for (let pageNum = start; pageNum <= end; pageNum++) {
          const page = pageMap.get(pageNum);
          if (page) chapterPages.push(page);
        }
      } else if (chapterConfig.pages) {
        // Format: { title: "Chapter 1", pages: [1, 2, 3, 4, 5] }
        for (const pageNum of chapterConfig.pages) {
          const page = pageMap.get(pageNum);
          if (page) chapterPages.push(page);
        }
      } else if (chapterConfig.startPage && chapterConfig.endPage) {
        // Format: { title: "Chapter 1", startPage: 1, endPage: 10 }
        for (let pageNum = chapterConfig.startPage; pageNum <= chapterConfig.endPage; pageNum++) {
          const page = pageMap.get(pageNum);
          if (page) chapterPages.push(page);
        }
      }
      
      if (chapterPages.length > 0) {
        chapters.push({
          title: chapterConfig.title || `Chapter ${chapters.length + 1}`,
          startPage: Math.min(...chapterPages.map(p => p.pageNumber)),
          endPage: Math.max(...chapterPages.map(p => p.pageNumber)),
          pages: chapterPages,
          confidence: 1.0,
          reason: 'Manual configuration',
          isManual: true
        });
      }
    }
    
    console.log(`[ChapterConfig] Applied manual configuration: ${chapters.length} chapters`);
    return chapters;
  }
  
  /**
   * Create chapter configuration from page ranges
   * @param {Array} pageRanges - Array of page range objects
   * @returns {Array} - Chapter configuration
   * 
   * Example:
   * [
   *   { title: "Introduction", pageRange: "1-5" },
   *   { title: "Chapter 1: Getting Started", pageRange: "6-20" },
   *   { title: "Chapter 2: Advanced Topics", pageRange: "21-35" }
   * ]
   */
  static createConfigFromPageRanges(pageRanges) {
    return pageRanges.map((range, index) => ({
      title: range.title || `Chapter ${index + 1}`,
      pageRange: range.pageRange,
      order: index + 1
    }));
  }
  
  /**
   * Create chapter configuration from page numbers
   * @param {Array} chapterDefinitions - Array of chapter definitions
   * @returns {Array} - Chapter configuration
   * 
   * Example:
   * [
   *   { title: "Introduction", pages: [1, 2, 3, 4, 5] },
   *   { title: "Chapter 1", pages: [6, 7, 8, 9, 10, 11, 12] }
   * ]
   */
  static createConfigFromPageNumbers(chapterDefinitions) {
    return chapterDefinitions.map((def, index) => ({
      title: def.title || `Chapter ${index + 1}`,
      pages: def.pages,
      order: index + 1
    }));
  }
  
  /**
   * Auto-generate chapter configuration based on page count
   * @param {number} totalPages - Total number of pages
   * @param {number} pagesPerChapter - Pages per chapter (default: 10)
   * @returns {Array} - Auto-generated chapter configuration
   */
  static autoGenerateConfig(totalPages, pagesPerChapter = 10) {
    const chapters = [];
    let currentPage = 1;
    let chapterNumber = 1;
    
    while (currentPage <= totalPages) {
      const endPage = Math.min(currentPage + pagesPerChapter - 1, totalPages);
      
      chapters.push({
        title: `Chapter ${chapterNumber}`,
        startPage: currentPage,
        endPage: endPage,
        order: chapterNumber
      });
      
      currentPage = endPage + 1;
      chapterNumber++;
    }
    
    return chapters;
  }
  
  /**
   * Validate chapter configuration
   * @param {Array} chapterConfig - Chapter configuration to validate
   * @param {number} totalPages - Total pages in document
   * @returns {Object} - Validation result
   */
  static validateConfiguration(chapterConfig, totalPages) {
    const errors = [];
    const warnings = [];
    const coveredPages = new Set();
    
    for (let i = 0; i < chapterConfig.length; i++) {
      const chapter = chapterConfig[i];
      
      // Check required fields
      if (!chapter.title) {
        errors.push(`Chapter ${i + 1}: Missing title`);
      }
      
      // Determine page range
      let pages = [];
      if (chapter.pageRange) {
        const [start, end] = chapter.pageRange.split('-').map(n => parseInt(n.trim()));
        if (isNaN(start) || isNaN(end)) {
          errors.push(`Chapter ${i + 1}: Invalid page range format`);
          continue;
        }
        for (let p = start; p <= end; p++) pages.push(p);
      } else if (chapter.pages) {
        pages = chapter.pages;
      } else if (chapter.startPage && chapter.endPage) {
        for (let p = chapter.startPage; p <= chapter.endPage; p++) pages.push(p);
      } else {
        errors.push(`Chapter ${i + 1}: No page specification found`);
        continue;
      }
      
      // Check page validity
      for (const pageNum of pages) {
        if (pageNum < 1 || pageNum > totalPages) {
          errors.push(`Chapter ${i + 1}: Page ${pageNum} is out of range (1-${totalPages})`);
        }
        
        if (coveredPages.has(pageNum)) {
          errors.push(`Chapter ${i + 1}: Page ${pageNum} is already assigned to another chapter`);
        }
        
        coveredPages.add(pageNum);
      }
    }
    
    // Check coverage
    const uncoveredPages = [];
    for (let p = 1; p <= totalPages; p++) {
      if (!coveredPages.has(p)) {
        uncoveredPages.push(p);
      }
    }
    
    if (uncoveredPages.length > 0) {
      warnings.push(`Pages not covered by any chapter: ${uncoveredPages.join(', ')}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      coverage: (coveredPages.size / totalPages) * 100
    };
  }
  
  /**
   * Get all saved configurations
   * @returns {Promise<Array>} - List of all configurations
   */
  static async getAllConfigurations() {
    try {
      const configDir = path.join(process.cwd(), 'backend', 'chapter_configs');
      const files = await fs.readdir(configDir);
      
      const configs = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const configPath = path.join(configDir, file);
          const configData = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(configData);
          configs.push({
            documentId: config.documentId,
            title: config.title || 'Untitled',
            chapters: config.chapters.length,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt
          });
        }
      }
      
      return configs;
    } catch (error) {
      console.warn('[ChapterConfig] Error listing configurations:', error.message);
      return [];
    }
  }
  
  /**
   * Delete chapter configuration
   * @param {string} documentId - Document identifier
   * @returns {Promise<boolean>} - Success status
   */
  static async deleteConfiguration(documentId) {
    try {
      const configDir = path.join(process.cwd(), 'backend', 'chapter_configs');
      const configPath = path.join(configDir, `${documentId}.json`);
      
      await fs.unlink(configPath);
      console.log(`[ChapterConfig] Deleted configuration for document ${documentId}`);
      return true;
    } catch (error) {
      console.warn(`[ChapterConfig] Error deleting config for ${documentId}:`, error.message);
      return false;
    }
  }
}