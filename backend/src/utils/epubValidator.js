import JSZip from 'jszip';
import fs from 'fs/promises';

/**
 * Validate EPUB structure
 */
export class EpubValidator {
  /**
   * Validate an EPUB file
   * @param {string|Buffer} epubPathOrBuffer - Path to EPUB file or buffer
   * @returns {Promise<Object>} Validation result
   */
  static async validate(epubPathOrBuffer) {
    const errors = [];
    const warnings = [];
    
    try {
      // Load EPUB
      let epubData;
      if (Buffer.isBuffer(epubPathOrBuffer)) {
        epubData = epubPathOrBuffer;
      } else {
        epubData = await fs.readFile(epubPathOrBuffer);
      }
      
      const zip = await JSZip.loadAsync(epubData);
      
      // Check required files
      const requiredFiles = [
        'mimetype',
        'META-INF/container.xml',
        'OEBPS/content.opf',
        'OEBPS/nav.xhtml'
      ];
      
      for (const file of requiredFiles) {
        if (!zip.files[file]) {
          errors.push(`Missing required file: ${file}`);
        }
      }
      
      // Check mimetype is uncompressed
      const mimetype = zip.files['mimetype'];
      if (mimetype && mimetype.options.compression !== 'STORE') {
        warnings.push('mimetype should be uncompressed (STORE)');
      }
      
      // Check mimetype content
      if (mimetype) {
        const mimetypeContent = await mimetype.async('string');
        if (mimetypeContent.trim() !== 'application/epub+zip') {
          errors.push(`Invalid mimetype content: ${mimetypeContent}`);
        }
      }
      
      // Check container.xml
      const container = zip.files['META-INF/container.xml'];
      if (container) {
        const containerContent = await container.async('string');
        if (!containerContent.includes('content.opf')) {
          errors.push('container.xml does not reference content.opf');
        }
      }
      
      // Count files
      const fileCount = Object.keys(zip.files).length;
      const xhtmlFiles = Object.keys(zip.files).filter(f => f.endsWith('.xhtml')).length;
      const imageFiles = Object.keys(zip.files).filter(f => f.match(/\.(png|jpg|jpeg)$/i)).length;
      
      return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
          totalFiles: fileCount,
          xhtmlFiles,
          imageFiles
        }
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to validate EPUB: ${error.message}`],
        warnings: [],
        stats: {}
      };
    }
  }
}

