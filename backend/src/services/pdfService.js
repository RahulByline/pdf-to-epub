import { PdfDocumentModel } from '../models/PdfDocument.js';
import fs from 'fs/promises';
import path from 'path';
import { getUploadDir, ensureDirectories } from '../config/fileStorage.js';
import { v4 as uuidv4 } from 'uuid';

// Note: This is a simplified version. Full PDF processing would require:
// - pdf-parse or pdf-lib for PDF reading
// - pdf2pic or similar for image extraction
// - Tesseract.js for OCR (if needed)
// - Image processing libraries

export class PdfService {
  static async getAllPdfs() {
    const pdfs = await PdfDocumentModel.findAll();
    return pdfs.map(pdf => this.convertToDTO(pdf));
  }

  static async getPdfDocument(id) {
    const pdf = await PdfDocumentModel.findById(id);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + id);
    }
    return this.convertToDTO(pdf);
  }

  static async uploadAndAnalyzePdf(file, audioFile = null) {
    await ensureDirectories();
    
    const uploadDir = getUploadDir();
    const fileName = uuidv4() + path.extname(file.originalname);
    const filePath = path.join(uploadDir, fileName);

    // Save file
    await fs.writeFile(filePath, file.buffer);

    // Get file stats
    const stats = await fs.stat(filePath);
    
    // TODO: Implement actual PDF analysis using pdf-parse or similar
    // For now, using placeholder values
    const totalPages = 1; // Would extract from PDF
    const documentType = 'OTHER';
    const pageQuality = 'DIGITAL_NATIVE';
    const languages = ['en'];

    let audioFilePath = null;
    let audioFileName = null;

    if (audioFile) {
      const audioFileName = uuidv4() + path.extname(audioFile.originalname);
      const audioPath = path.join(uploadDir, audioFileName);
      await fs.writeFile(audioPath, audioFile.buffer);
      audioFilePath = audioPath;
      audioFileName = audioFile.originalname;
    }

    const pdfData = {
      fileName,
      originalFileName: file.originalname,
      filePath,
      fileSize: stats.size,
      totalPages,
      documentType,
      pageQuality,
      languages,
      hasTables: false,
      hasFormulas: false,
      hasMultiColumn: false,
      scannedPagesCount: 0,
      digitalPagesCount: totalPages,
      audioFilePath,
      audioFileName,
      audioSynced: false
    };

    const pdf = await PdfDocumentModel.create(pdfData);
    return this.convertToDTO(pdf);
  }

  static async extractAndUploadPdfsFromZip(zipFile) {
    // TODO: Implement ZIP extraction using jszip
    // This would extract PDFs from ZIP and process each one
    // For now, return empty array
    return [];
  }

  static async deletePdfDocument(id) {
    console.log('Starting deletion of PDF document with id:', id);
    
    try {
      const pdf = await PdfDocumentModel.findById(id);
      if (!pdf) {
        console.error('PDF document not found with id:', id);
        throw new Error('PDF document not found with id: ' + id);
      }

      console.log('Found PDF document:', {
        id: pdf.id,
        fileName: pdf.file_name,
        filePath: pdf.file_path,
        audioFilePath: pdf.audio_file_path
      });

      // Delete file from filesystem (don't fail if file doesn't exist)
      if (pdf.file_path) {
        try {
          await fs.unlink(pdf.file_path);
          console.log('✓ Deleted PDF file:', pdf.file_path);
        } catch (fileError) {
          // File might not exist, that's okay - continue with deletion
          if (fileError.code !== 'ENOENT') {
            console.warn('⚠ Error deleting PDF file (continuing anyway):', pdf.file_path, fileError.message);
          } else {
            console.log('PDF file already deleted or does not exist:', pdf.file_path);
          }
        }
      }

      if (pdf.audio_file_path) {
        try {
          await fs.unlink(pdf.audio_file_path);
          console.log('✓ Deleted audio file:', pdf.audio_file_path);
        } catch (fileError) {
          // File might not exist, that's okay - continue with deletion
          if (fileError.code !== 'ENOENT') {
            console.warn('⚠ Error deleting audio file (continuing anyway):', pdf.audio_file_path, fileError.message);
          } else {
            console.log('Audio file already deleted or does not exist:', pdf.audio_file_path);
          }
        }
      }

      // Delete from database (manually handling CASCADE to ensure it works)
      console.log('Attempting database deletion...');
      try {
        await PdfDocumentModel.delete(id);
        console.log('✓ Successfully deleted PDF document from database:', id);
      } catch (dbError) {
        console.error('Database deletion error details:', {
          message: dbError.message,
          code: dbError.code,
          errno: dbError.errno,
          sqlState: dbError.sqlState,
          sqlMessage: dbError.sqlMessage
        });
        
        // Provide more specific error messages
        if (dbError.code === 'ER_ROW_IS_REFERENCED_2') {
          throw new Error('Cannot delete PDF: It is still referenced by other records. Please delete related conversions first.');
        } else if (dbError.code === 'ER_NO_REFERENCED_ROW_2') {
          throw new Error('Referential integrity error. Please try again.');
        } else {
          throw new Error('Database error: ' + (dbError.sqlMessage || dbError.message));
        }
      }
      
    } catch (error) {
      console.error('✗ Error in deletePdfDocument:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
        id: id
      });
      throw error;
    }
  }

  static async getPdfsGroupedByZip() {
    const grouped = {};
    const pdfs = await PdfDocumentModel.findAll();
    
    pdfs.forEach(pdf => {
      const groupId = pdf.zip_file_group_id || 'ungrouped';
      if (!grouped[groupId]) {
        grouped[groupId] = [];
      }
      grouped[groupId].push(this.convertToDTO(pdf));
    });

    return grouped;
  }

  static async downloadPdf(id) {
    const pdf = await PdfDocumentModel.findById(id);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + id);
    }

    const filePath = pdf.file_path;
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    
    if (!exists) {
      throw new Error('PDF file not found on server');
    }

    return {
      filePath,
      originalFileName: pdf.original_file_name
    };
  }

  static async downloadAudio(id) {
    const pdf = await PdfDocumentModel.findById(id);
    if (!pdf || !pdf.audio_file_path) {
      throw new Error('Audio file not found');
    }

    const exists = await fs.access(pdf.audio_file_path).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error('Audio file not found on server');
    }

    return {
      filePath: pdf.audio_file_path,
      fileName: pdf.audio_file_name || 'audio.mp3'
    };
  }

  static convertToDTO(pdf) {
    return {
      id: pdf.id,
      fileName: pdf.file_name,
      originalFileName: pdf.original_file_name,
      fileSize: pdf.file_size,
      totalPages: pdf.total_pages,
      documentType: pdf.document_type,
      languages: pdf.languages || [],
      pageQuality: pdf.page_quality,
      hasTables: pdf.has_tables,
      hasFormulas: pdf.has_formulas,
      hasMultiColumn: pdf.has_multi_column,
      scannedPagesCount: pdf.scanned_pages_count,
      digitalPagesCount: pdf.digital_pages_count,
      zipFileName: pdf.zip_file_name,
      zipFileGroupId: pdf.zip_file_group_id,
      audioFilePath: pdf.audio_file_path,
      audioFileName: pdf.audio_file_name,
      audioSynced: pdf.audio_synced,
      createdAt: pdf.created_at
    };
  }
}

