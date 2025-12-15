import { WordDocumentModel } from '../models/WordDocument.js';
import fs from 'fs/promises';
import path from 'path';
import { getUploadDir, ensureDirectories } from '../config/fileStorage.js';
import { v4 as uuidv4 } from 'uuid';

export class WordService {
  static async getAllWords() {
    const words = await WordDocumentModel.findAll();
    return words.map(word => this.convertToDTO(word));
  }

  static async getWordDocument(id) {
    const word = await WordDocumentModel.findById(id);
    if (!word) {
      throw new Error('Word document not found with id: ' + id);
    }
    return this.convertToDTO(word);
  }

  static async uploadAndAnalyzeWord(file, audioFile = null) {
    await ensureDirectories();
    
    const uploadDir = getUploadDir();
    const fileName = uuidv4() + path.extname(file.originalname);
    const filePath = path.join(uploadDir, fileName);

    // Save file
    await fs.writeFile(filePath, file.buffer);

    // Get file stats
    const stats = await fs.stat(filePath);
    
    // Extract page count from DOCX (will be determined during conversion)
    const totalPages = 0; // Will be set during HTML extraction
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

    const wordData = {
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

    const word = await WordDocumentModel.create(wordData);
    return this.convertToDTO(word);
  }

  static async extractAndUploadWordsFromZip(zipFile) {
    // TODO: Implement ZIP extraction using jszip
    // This would extract DOCX files from ZIP and process each one
    // For now, return empty array
    return [];
  }

  static async deleteWordDocument(id) {
    console.log('Starting deletion of Word document with id:', id);
    
    try {
      const word = await WordDocumentModel.findById(id);
      if (!word) {
        console.error('Word document not found with id:', id);
        throw new Error('Word document not found with id: ' + id);
      }

      console.log('Found Word document:', {
        id: word.id,
        fileName: word.file_name,
        filePath: word.file_path,
        audioFilePath: word.audio_file_path
      });

      // Delete file from filesystem (don't fail if file doesn't exist)
      if (word.file_path) {
        try {
          await fs.unlink(word.file_path);
          console.log('✓ Deleted Word file:', word.file_path);
        } catch (fileError) {
          // File might not exist, that's okay - continue with deletion
          if (fileError.code !== 'ENOENT') {
            console.warn('⚠ Error deleting Word file (continuing anyway):', word.file_path, fileError.message);
          } else {
            console.log('Word file already deleted or does not exist:', word.file_path);
          }
        }
      }

      if (word.audio_file_path) {
        try {
          await fs.unlink(word.audio_file_path);
          console.log('✓ Deleted audio file:', word.audio_file_path);
        } catch (fileError) {
          // File might not exist, that's okay - continue with deletion
          if (fileError.code !== 'ENOENT') {
            console.warn('⚠ Error deleting audio file (continuing anyway):', word.audio_file_path, fileError.message);
          } else {
            console.log('Audio file already deleted or does not exist:', word.audio_file_path);
          }
        }
      }

      // Delete from database
      console.log('Attempting database deletion...');
      try {
        await WordDocumentModel.delete(id);
        console.log('✓ Successfully deleted Word document from database:', id);
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
          throw new Error('Cannot delete Word document: It is still referenced by other records. Please delete related conversions first.');
        } else if (dbError.code === 'ER_NO_REFERENCED_ROW_2') {
          throw new Error('Referential integrity error. Please try again.');
        } else {
          throw new Error('Database error: ' + (dbError.sqlMessage || dbError.message));
        }
      }
      
    } catch (error) {
      console.error('✗ Error in deleteWordDocument:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
        id: id
      });
      throw error;
    }
  }

  static async getWordsGroupedByZip() {
    const grouped = {};
    const words = await WordDocumentModel.findAll();
    
    words.forEach(word => {
      const groupId = word.zip_file_group_id || 'ungrouped';
      if (!grouped[groupId]) {
        grouped[groupId] = [];
      }
      grouped[groupId].push(this.convertToDTO(word));
    });

    return grouped;
  }

  static async downloadWord(id) {
    const word = await WordDocumentModel.findById(id);
    if (!word) {
      throw new Error('Word document not found with id: ' + id);
    }

    const filePath = word.file_path;
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    
    if (!exists) {
      throw new Error('Word file not found on server');
    }

    return {
      filePath,
      originalFileName: word.original_file_name
    };
  }

  static async downloadAudio(id) {
    const word = await WordDocumentModel.findById(id);
    if (!word || !word.audio_file_path) {
      throw new Error('Audio file not found');
    }

    const exists = await fs.access(word.audio_file_path).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error('Audio file not found on server');
    }

    return {
      filePath: word.audio_file_path,
      fileName: word.audio_file_name || 'audio.mp3'
    };
  }

  static convertToDTO(word) {
    return {
      id: word.id,
      fileName: word.file_name,
      originalFileName: word.original_file_name,
      fileSize: word.file_size,
      totalPages: word.total_pages,
      documentType: word.document_type,
      languages: word.languages || [],
      pageQuality: word.page_quality,
      hasTables: word.has_tables,
      hasFormulas: word.has_formulas,
      hasMultiColumn: word.has_multi_column,
      scannedPagesCount: word.scanned_pages_count,
      digitalPagesCount: word.digital_pages_count,
      zipFileName: word.zip_file_name,
      zipFileGroupId: word.zip_file_group_id,
      audioFilePath: word.audio_file_path,
      audioFileName: word.audio_file_name,
      audioSynced: word.audio_synced,
      createdAt: word.created_at
    };
  }
}

