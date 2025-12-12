import { createWorker } from 'tesseract.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * OCR Service using Tesseract.js for text extraction from images
 * Useful for scanned PDFs or image-based PDFs
 */
export class OcrService {
  static _worker = null;
  static _initialized = false;

  /**
   * Initialize Tesseract worker
   * @param {string} lang - Language code (e.g., 'eng', 'eng+fra')
   * @returns {Promise<Object>} Tesseract worker instance
   */
  static async initializeWorker(lang = 'eng') {
    if (this._worker && this._initialized) {
      return this._worker;
    }

    try {
      console.log(`[OCR] Initializing Tesseract worker (language: ${lang})...`);
      this._worker = await createWorker(lang, 1, {
        logger: (m) => {
          // Only log important messages to avoid spam
          if (m.status === 'recognizing text' && m.progress === 1) {
            console.log(`[OCR] Page recognition complete`);
          }
        }
      });
      this._initialized = true;
      console.log(`[OCR] Tesseract worker initialized successfully`);
      return this._worker;
    } catch (error) {
      console.error('[OCR] Failed to initialize Tesseract worker:', error);
      throw error;
    }
  }

  /**
   * Terminate the worker (cleanup)
   */
  static async terminateWorker() {
    if (this._worker) {
      try {
        await this._worker.terminate();
        this._worker = null;
        this._initialized = false;
        console.log('[OCR] Tesseract worker terminated');
      } catch (error) {
        console.warn('[OCR] Error terminating worker:', error.message);
      }
    }
  }

  /**
   * Extract text from a single image using OCR
   * @param {string} imagePath - Path to the image file
   * @param {Object} options - OCR options
   * @returns {Promise<Object>} OCR result with text and confidence
   */
  static async extractTextFromImage(imagePath, options = {}) {
    const {
      lang = 'eng',
      psm = 6, // Page segmentation mode: 6 = uniform block of text
      oem = 3, // OCR Engine mode: 3 = default
      getBoundingBoxes = false
    } = options;

    try {
      // Initialize worker if needed
      const worker = await this.initializeWorker(lang);

      // Set OCR parameters
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_ocr_engine_mode: oem
      });

      // Perform OCR
      const { data } = await worker.recognize(imagePath);

      const result = {
        text: data.text || '',
        confidence: data.confidence || 0,
        words: data.words || [],
        lines: data.lines || [],
        paragraphs: data.paragraphs || []
      };

      // Add bounding boxes if requested
      if (getBoundingBoxes && data.words) {
        result.boundingBoxes = data.words.map(word => ({
          text: word.text,
          bbox: word.bbox,
          confidence: word.confidence
        }));
      }

      return result;
    } catch (error) {
      console.error(`[OCR] Error extracting text from image ${imagePath}:`, error);
      throw error;
    }
  }

  /**
   * Extract text from PDF pages using OCR
   * Requires pages to be rendered as images first
   * @param {string} pdfFilePath - Path to PDF file
   * @param {string} imagesDir - Directory containing rendered page images
   * @param {Object} options - OCR options
   * @returns {Promise<Object>} Text data with pages array
   */
  static async extractTextFromPdfPages(pdfFilePath, imagesDir, options = {}) {
    const {
      lang = 'eng',
      psm = 6,
      getBoundingBoxes = false
    } = options;

    try {
      // Check if images directory exists
      try {
        await fs.access(imagesDir);
      } catch {
        throw new Error(`Images directory not found: ${imagesDir}. Please render pages as images first.`);
      }

      // Get all page images
      const files = await fs.readdir(imagesDir);
      const pageImages = files
        .filter(f => f.match(/^page_\d+\.png$/i))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)[0]);
          const numB = parseInt(b.match(/\d+/)[0]);
          return numA - numB;
        });

      if (pageImages.length === 0) {
        throw new Error(`No page images found in ${imagesDir}`);
      }

      console.log(`[OCR] Found ${pageImages.length} page images, starting OCR...`);

      const pages = [];
      const worker = await this.initializeWorker(lang);

      // Set OCR parameters
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_ocr_engine_mode: 3
      });

      // Process each page
      for (let i = 0; i < pageImages.length; i++) {
        const imageFile = pageImages[i];
        const imagePath = path.join(imagesDir, imageFile);
        const pageNumber = parseInt(imageFile.match(/\d+/)[0]);

        try {
          console.log(`[OCR] Processing page ${pageNumber}/${pageImages.length}...`);
          
          const ocrResult = await this.extractTextFromImage(imagePath, {
            lang,
            psm,
            getBoundingBoxes
          });

          // Convert OCR words to text blocks (for compatibility with existing structure)
          const textBlocks = ocrResult.boundingBoxes?.map((word, idx) => ({
            id: `ocr_block_${pageNumber}_${idx}`,
            text: word.text,
            type: 'paragraph',
            boundingBox: {
              x: word.bbox.x0,
              y: word.bbox.y0,
              width: word.bbox.x1 - word.bbox.x0,
              height: word.bbox.y1 - word.bbox.y0,
              pageNumber
            },
            confidence: word.confidence
          })) || [];

          pages.push({
            pageNumber,
            text: ocrResult.text,
            textBlocks,
            charCount: ocrResult.text.length,
            confidence: ocrResult.confidence,
            width: 0, // Will be set from image dimensions if needed
            height: 0
          });

          console.log(`[OCR] Page ${pageNumber}: Extracted ${ocrResult.text.length} characters (confidence: ${ocrResult.confidence.toFixed(1)}%)`);
        } catch (pageError) {
          console.error(`[OCR] Error processing page ${pageNumber}:`, pageError.message);
          pages.push({
            pageNumber,
            text: '',
            textBlocks: [],
            charCount: 0,
            confidence: 0,
            width: 0,
            height: 0
          });
        }
      }

      return {
        pages,
        totalPages: pages.length,
        metadata: {
          extractionMethod: 'OCR',
          ocrEngine: 'Tesseract.js',
          language: lang,
          averageConfidence: pages.reduce((sum, p) => sum + (p.confidence || 0), 0) / pages.length
        }
      };
    } catch (error) {
      console.error('[OCR] Error extracting text from PDF pages:', error);
      throw error;
    }
  }

  /**
   * Extract text from PDF using OCR (renders pages first, then OCRs them)
   * @param {string} pdfFilePath - Path to PDF file
   * @param {Object} options - OCR and rendering options
   * @returns {Promise<Object>} Text data with pages array
   */
  static async extractTextFromPdf(pdfFilePath, options = {}) {
    const {
      lang = 'eng',
      psm = 6,
      tempDir = null,
      dpi = 300
    } = options;

    try {
      // Import PdfExtractionService dynamically to avoid circular dependencies
      const { PdfExtractionService } = await import('./pdfExtractionService.js');
      const { getHtmlIntermediateDir } = await import('../config/fileStorage.js');
      
      // Create temporary directory for rendered images
      const imagesDir = tempDir || path.join(getHtmlIntermediateDir(), `ocr_${Date.now()}`);
      await fs.mkdir(imagesDir, { recursive: true });

      console.log(`[OCR] Rendering PDF pages as images (${dpi} DPI)...`);
      
      // Render pages as images
      const pageImagesData = await PdfExtractionService.renderPagesAsImages(pdfFilePath, imagesDir);
      
      console.log(`[OCR] Rendered ${pageImagesData.images.length} pages, starting OCR...`);

      // Extract text using OCR
      const textData = await this.extractTextFromPdfPages(pdfFilePath, imagesDir, {
        lang,
        psm,
        getBoundingBoxes: true
      });

      // Add page dimensions from rendered images
      textData.pages.forEach((page, idx) => {
        const pageImage = pageImagesData.images.find(img => img.pageNumber === page.pageNumber);
        if (pageImage) {
          page.width = pageImage.pageWidth || 612;
          page.height = pageImage.pageHeight || 792;
        }
      });

      // Cleanup temporary images directory (optional)
      if (!tempDir) {
        try {
          await fs.rm(imagesDir, { recursive: true, force: true });
          console.log(`[OCR] Cleaned up temporary images directory`);
        } catch (cleanupError) {
          console.warn(`[OCR] Could not cleanup temp directory:`, cleanupError.message);
        }
      }

      return textData;
    } catch (error) {
      console.error('[OCR] Error extracting text from PDF:', error);
      throw error;
    }
  }

  /**
   * Get available OCR languages
   * @returns {Promise<Array>} Array of available language codes
   */
  static async getAvailableLanguages() {
    try {
      const worker = await this.initializeWorker('eng');
      const { data } = await worker.getLanguages();
      return data.languages || [];
    } catch (error) {
      console.error('[OCR] Error getting available languages:', error);
      return ['eng']; // Default to English
    }
  }
}

