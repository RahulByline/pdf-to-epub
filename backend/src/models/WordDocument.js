import pool from '../config/database.js';

// Note: Using pdf_documents table structure for Word documents
// In production, you may want a separate word_documents table
export class WordDocumentModel {
  static async findAll() {
    const [rows] = await pool.execute(`
      SELECT p.*, 
             GROUP_CONCAT(DISTINCT pl.language) as languages
      FROM pdf_documents p
      LEFT JOIN pdf_languages pl ON p.id = pl.pdf_document_id
      WHERE p.file_path LIKE '%.docx' OR p.file_path LIKE '%.doc'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    
    return rows.map(row => ({
      ...row,
      languages: row.languages ? row.languages.split(',') : []
    }));
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM pdf_documents WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) return null;
    
    const [languages] = await pool.execute(
      'SELECT language FROM pdf_languages WHERE pdf_document_id = ?',
      [id]
    );
    
    return {
      ...rows[0],
      languages: languages.map(l => l.language)
    };
  }

  static async create(wordData) {
    const [result] = await pool.execute(
      `INSERT INTO pdf_documents (
        file_name, original_file_name, file_path, file_size, total_pages,
        document_type, page_quality, has_tables, has_formulas, has_multi_column,
        scanned_pages_count, digital_pages_count, analysis_metadata,
        zip_file_name, zip_file_group_id, audio_file_path, audio_file_name, audio_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        wordData.fileName, wordData.originalFileName, wordData.filePath, wordData.fileSize,
        wordData.totalPages, wordData.documentType || null, wordData.pageQuality || null,
        wordData.hasTables || false, wordData.hasFormulas || false, wordData.hasMultiColumn || false,
        wordData.scannedPagesCount || 0, wordData.digitalPagesCount || 0,
        wordData.analysisMetadata || null, wordData.zipFileName || null,
        wordData.zipFileGroupId || null, wordData.audioFilePath || null,
        wordData.audioFileName || null, wordData.audioSynced || false
      ]
    );

    const id = result.insertId;

    // Insert languages
    if (wordData.languages && wordData.languages.length > 0) {
      const languageValues = wordData.languages.map(lang => [id, lang]);
      await pool.query(
        'INSERT INTO pdf_languages (pdf_document_id, language) VALUES ?',
        [languageValues]
      );
    }

    return await this.findById(id);
  }

  static async update(id, wordData) {
    const updates = [];
    const values = [];

    const fields = {
      file_name: wordData.fileName,
      original_file_name: wordData.originalFileName,
      file_path: wordData.filePath,
      file_size: wordData.fileSize,
      total_pages: wordData.totalPages,
      document_type: wordData.documentType,
      page_quality: wordData.pageQuality,
      has_tables: wordData.hasTables,
      has_formulas: wordData.hasFormulas,
      has_multi_column: wordData.hasMultiColumn,
      scanned_pages_count: wordData.scannedPagesCount,
      digital_pages_count: wordData.digitalPagesCount,
      analysis_metadata: wordData.analysisMetadata,
      zip_file_name: wordData.zipFileName,
      zip_file_group_id: wordData.zipFileGroupId,
      audio_file_path: wordData.audioFilePath,
      audio_file_name: wordData.audioFileName,
      audio_synced: wordData.audioSynced
    };

    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (updates.length > 0) {
      values.push(id);
      await pool.execute(
        `UPDATE pdf_documents SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }

    // Update languages if provided
    if (wordData.languages !== undefined) {
      await pool.execute('DELETE FROM pdf_languages WHERE pdf_document_id = ?', [id]);
      if (wordData.languages.length > 0) {
        const languageValues = wordData.languages.map(lang => [id, lang]);
        await pool.query(
          'INSERT INTO pdf_languages (pdf_document_id, language) VALUES ?',
          [languageValues]
        );
      }
    }

    return await this.findById(id);
  }

  static async delete(id) {
    try {
      console.log('Executing DELETE FROM pdf_documents WHERE id =', id);
      
      // First, manually delete related records
      try {
        await pool.execute('DELETE FROM pdf_languages WHERE pdf_document_id = ?', [id]);
        console.log('Deleted related pdf_languages records');
      } catch (langError) {
        console.warn('Error deleting pdf_languages (may not exist):', langError.message);
      }
      
      try {
        await pool.execute('DELETE FROM audio_syncs WHERE pdf_document_id = ?', [id]);
        console.log('Deleted related audio_syncs records');
      } catch (audioError) {
        console.warn('Error deleting audio_syncs (may not exist):', audioError.message);
      }
      
      try {
        await pool.execute('DELETE FROM conversion_jobs WHERE pdf_document_id = ?', [id]);
        console.log('Deleted related conversion_jobs records');
      } catch (convError) {
        console.warn('Error deleting conversion_jobs (may not exist):', convError.message);
      }
      
      // Now delete the main record
      const [result] = await pool.execute('DELETE FROM pdf_documents WHERE id = ?', [id]);
      
      if (result.affectedRows === 0) {
        throw new Error('Word document not found with id: ' + id);
      }
      
      return result;
    } catch (error) {
      console.error('Database delete error:', error);
      throw error;
    }
  }
}

