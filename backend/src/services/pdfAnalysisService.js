import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import { getPdfjsLib } from '../utils/pdfjsHelper.js';

/**
 * PDF Analysis Service
 * Determines if PDF is text-based or scanned/image-based
 */
export class PdfAnalysisService {
  /**
   * Analyze PDF to determine if it's text-based or scanned
   * @param {string} pdfFilePath - Path to PDF file
   * @returns {Promise<{isTextBased: boolean, confidence: number, textRatio: number, metadata: Object}>}
   */
  static async analyzePdf(pdfFilePath) {
    try {
      // Method 1: Try pdf-parse to extract text
      const pdfData = await fs.readFile(pdfFilePath);
      const parsed = await pdfParse(pdfData);
      
      const totalTextLength = parsed.text?.length || 0;
      const totalPages = parsed.numpages || 1;
      const avgTextPerPage = totalTextLength / totalPages;
      
      // Method 2: Use pdfjs-dist to check for text operators
      const pdfjsLib = await getPdfjsLib();
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      
      let textOperatorCount = 0;
      let imageOperatorCount = 0;
      const samplePages = Math.min(5, totalPages); // Sample first 5 pages
      
      for (let i = 0; i < samplePages; i++) {
        try {
          const page = await pdfDoc.getPage(i);
          const operators = await page.getOperatorList();
          
          // Count text vs image operators
          operators.fnArray.forEach((fn, idx) => {
            const opName = operators.fnArray[idx];
            if (opName === pdfjsLib.OPS.showText || 
                opName === pdfjsLib.OPS.showSpacedText ||
                opName === pdfjsLib.OPS.nextLineShowText ||
                opName === pdfjsLib.OPS.nextLineSetSpacingShowText) {
              textOperatorCount++;
            } else if (opName === pdfjsLib.OPS.paintImageXObject ||
                       opName === pdfjsLib.OPS.paintJpegXObject ||
                       opName === pdfjsLib.OPS.paintImageXObjectRepeat) {
              imageOperatorCount++;
            }
          });
        } catch (pageError) {
          console.warn(`[PDF Analysis] Error analyzing page ${i + 1}:`, pageError.message);
        }
      }
      
      // Calculate confidence metrics
      const textRatio = avgTextPerPage > 100 ? 1.0 : avgTextPerPage / 100;
      const operatorRatio = textOperatorCount > 0 
        ? textOperatorCount / (textOperatorCount + imageOperatorCount)
        : 0;
      
      // Decision logic
      const isTextBased = avgTextPerPage > 50 && operatorRatio > 0.3;
      const confidence = Math.min(1.0, (textRatio * 0.6 + operatorRatio * 0.4));
      
      return {
        isTextBased,
        confidence,
        textRatio,
        operatorRatio,
        avgTextPerPage,
        totalPages,
        textOperatorCount,
        imageOperatorCount,
        metadata: {
          title: parsed.info?.Title || '',
          author: parsed.info?.Author || '',
          pages: totalPages,
          textLength: totalTextLength
        }
      };
    } catch (error) {
      console.error('[PDF Analysis] Error analyzing PDF:', error);
      // Default to scanned if analysis fails
      return {
        isTextBased: false,
        confidence: 0.5,
        textRatio: 0,
        operatorRatio: 0,
        avgTextPerPage: 0,
        totalPages: 1,
        textOperatorCount: 0,
        imageOperatorCount: 0,
        metadata: {}
      };
    }
  }
  
  /**
   * Quick check if PDF has extractable text
   * @param {string} pdfFilePath - Path to PDF file
   * @returns {Promise<boolean>}
   */
  static async hasExtractableText(pdfFilePath) {
    try {
      const pdfData = await fs.readFile(pdfFilePath);
      const parsed = await pdfParse(pdfData);
      return (parsed.text?.length || 0) > 100; // At least 100 characters
    } catch {
      return false;
    }
  }
}
