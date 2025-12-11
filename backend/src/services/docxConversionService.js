// Stub file - docxConversionService is no longer used
// This file exists to prevent module loading errors
export class DocxConversionService {
  static async checkLibreOfficeAvailable() {
    return false;
  }
  static async convertPdfToDocx() {
    throw new Error('DOCX conversion is not supported');
  }
  static async convertDocxToHtml() {
    throw new Error('DOCX conversion is not supported');
  }
  static getMediaTypeFromExtension() {
    return 'image/png';
  }
}
