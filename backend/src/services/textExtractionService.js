import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import { getPdfjsLib } from '../utils/pdfjsHelper.js';
import { OcrService } from './ocrService.js';

/**
 * Text Extraction Service
 * Extracts real text from PDFs (text-based or OCR for scanned)
 * Preserves reading order, positioning, and structure
 */
export class TextExtractionService {
  /**
   * Extract text from PDF with full metadata
   * @param {string} pdfFilePath - Path to PDF file
   * @param {boolean} isTextBased - Whether PDF is text-based
   * @param {Object} options - Extraction options
   * @returns {Promise<{pages: Array, metadata: Object}>}
   */
  static async extractText(pdfFilePath, isTextBased = true, options = {}) {
    if (isTextBased) {
      return await this.extractTextFromTextPdf(pdfFilePath, options);
    } else {
      return await this.extractTextFromScannedPdf(pdfFilePath, options);
    }
  }
  
  /**
   * Extract text from text-based PDF using pdfjs-dist
   * Preserves reading order, font info, and positioning
   */
  static async extractTextFromTextPdf(pdfFilePath, options = {}) {
    try {
      const pdfData = await fs.readFile(pdfFilePath);
      const pdfjsLib = await getPdfjsLib();
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const numPages = pdfDoc.numPages;
      
      const pages = [];
      
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum - 1);
        const viewport = page.getViewport({ scale: 1.0 });
        
        // Extract text content with positioning
        const textContent = await page.getTextContent();
        
        // Group text items into blocks (paragraphs, headings)
        const textBlocks = this.groupTextIntoBlocks(textContent.items, viewport);
        
        pages.push({
          pageNumber: pageNum,
          width: viewport.width,
          height: viewport.height,
          textBlocks: textBlocks,
          rawText: textContent.items.map(item => item.str).join(' ')
        });
      }
      
      // Also get metadata from pdf-parse
      const parsed = await pdfParse(pdfData);
      
      return {
        pages,
        totalPages: numPages,
        metadata: {
          title: parsed.info?.Title || '',
          author: parsed.info?.Author || '',
          extractionMethod: 'pdfjs-dist',
          textBased: true
        }
      };
    } catch (error) {
      console.error('[Text Extraction] Error extracting from text PDF:', error);
      throw error;
    }
  }
  
  /**
   * Extract text from scanned PDF using OCR
   */
  static async extractTextFromScannedPdf(pdfFilePath, options = {}) {
    try {
      const ocrLang = options.lang || 'eng';
      const dpi = options.dpi || 300;
      const psm = options.psm || 6;
      
      // Use OCR service to extract text
      const textData = await OcrService.extractTextFromPdf(pdfFilePath, {
        lang: ocrLang,
        dpi: dpi,
        psm: psm
      });
      
      return {
        pages: textData.pages || [],
        totalPages: textData.totalPages || 0,
        metadata: {
          ...textData.metadata,
          extractionMethod: 'OCR',
          textBased: false,
          ocrConfidence: textData.metadata?.averageConfidence || 0
        }
      };
    } catch (error) {
      console.error('[Text Extraction] Error extracting from scanned PDF:', error);
      throw error;
    }
  }
  
  /**
   * Group text items into logical blocks (paragraphs, headings)
   * Uses font size, positioning, and spacing to determine structure
   */
  static groupTextIntoBlocks(textItems, viewport) {
    if (!textItems || textItems.length === 0) return [];
    
    const blocks = [];
    let currentBlock = null;
    
    for (const item of textItems) {
      const fontSize = item.transform?.[0] || item.height || 12;
      const y = item.transform?.[5] || 0;
      const x = item.transform?.[4] || 0;
      const text = item.str || '';
      
      if (!text.trim()) continue;
      
      // Determine if this starts a new block
      const isNewBlock = !currentBlock || 
                        this.shouldStartNewBlock(currentBlock, item, viewport);
      
      if (isNewBlock && currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      
      if (!currentBlock) {
        currentBlock = {
          text: text,
          x: x,
          y: y,
          width: item.width || 0,
          height: fontSize,
          fontSize: fontSize,
          fontName: item.fontName || 'unknown',
          items: [item]
        };
      } else {
        // Append to current block
        currentBlock.text += (item.hasEOL ? '\n' : ' ') + text;
        currentBlock.items.push(item);
        currentBlock.width = Math.max(currentBlock.width, x + (item.width || 0) - currentBlock.x);
      }
    }
    
    if (currentBlock) {
      blocks.push(currentBlock);
    }
    
    return blocks;
  }
  
  /**
   * Determine if a new block should start based on spacing and formatting
   */
  static shouldStartNewBlock(currentBlock, newItem, viewport) {
    const currentY = currentBlock.y;
    const newY = newItem.transform?.[5] || 0;
    const currentFontSize = currentBlock.fontSize;
    const newFontSize = newItem.transform?.[0] || newItem.height || 12;
    
    // New block if:
    // 1. Significant vertical spacing (more than 1.5x font size)
    const verticalGap = Math.abs(newY - currentY);
    if (verticalGap > currentFontSize * 1.5) {
      return true;
    }
    
    // 2. Different font size (likely heading)
    if (Math.abs(newFontSize - currentFontSize) > 2) {
      return true;
    }
    
    // 3. New line with indentation (paragraph break)
    const currentX = currentBlock.x;
    const newX = newItem.transform?.[4] || 0;
    if (newItem.hasEOL && Math.abs(newX - currentX) > 20) {
      return true;
    }
    
    return false;
  }
}

