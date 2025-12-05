import pool from '../config/database.js';

export class PdfDocumentModel {
  static async findAll() {
    const [rows] = await pool.execute(`
      SELECT p.*, 
             GROUP_CONCAT(DISTINCT pl.language) as languages
      FROM pdf_documents p
      LEFT JOIN pdf_languages pl ON p.id = pl.pdf_document_id
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

  static async create(pdfData) {
    const [result] = await pool.execute(
      `INSERT INTO pdf_documents (
        file_name, original_file_name, file_path, file_size, total_pages,
        document_type, page_quality, has_tables, has_formulas, has_multi_column,
        scanned_pages_count, digital_pages_count, analysis_metadata,
        zip_file_name, zip_file_group_id, audio_file_path, audio_file_name, audio_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pdfData.fileName, pdfData.originalFileName, pdfData.filePath, pdfData.fileSize,
        pdfData.totalPages, pdfData.documentType || null, pdfData.pageQuality || null,
        pdfData.hasTables || false, pdfData.hasFormulas || false, pdfData.hasMultiColumn || false,
        pdfData.scannedPagesCount || 0, pdfData.digitalPagesCount || 0,
        pdfData.analysisMetadata || null, pdfData.zipFileName || null,
        pdfData.zipFileGroupId || null, pdfData.audioFilePath || null,
        pdfData.audioFileName || null, pdfData.audioSynced || false
      ]
    );

    const id = result.insertId;

    // Insert languages
    if (pdfData.languages && pdfData.languages.length > 0) {
      const languageValues = pdfData.languages.map(lang => [id, lang]);
      await pool.query(
        'INSERT INTO pdf_languages (pdf_document_id, language) VALUES ?',
        [languageValues]
      );
    }

    return await this.findById(id);
  }

  static async update(id, pdfData) {
    const updates = [];
    const values = [];

    const fields = {
      file_name: pdfData.fileName,
      original_file_name: pdfData.originalFileName,
      file_path: pdfData.filePath,
      file_size: pdfData.fileSize,
      total_pages: pdfData.totalPages,
      document_type: pdfData.documentType,
      page_quality: pdfData.pageQuality,
      has_tables: pdfData.hasTables,
      has_formulas: pdfData.hasFormulas,
      has_multi_column: pdfData.hasMultiColumn,
      scanned_pages_count: pdfData.scannedPagesCount,
      digital_pages_count: pdfData.digitalPagesCount,
      analysis_metadata: pdfData.analysisMetadata,
      zip_file_name: pdfData.zipFileName,
      zip_file_group_id: pdfData.zipFileGroupId,
      audio_file_path: pdfData.audioFilePath,
      audio_file_name: pdfData.audioFileName,
      audio_synced: pdfData.audioSynced
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
    if (pdfData.languages !== undefined) {
      await pool.execute('DELETE FROM pdf_languages WHERE pdf_document_id = ?', [id]);
      if (pdfData.languages.length > 0) {
        const languageValues = pdfData.languages.map(lang => [id, lang]);
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
      
      // First, manually delete related records to avoid foreign key constraint issues
      // (Some MySQL versions may not properly handle CASCADE)
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
        // Delete conversion jobs that reference this PDF
        await pool.execute('DELETE FROM conversion_jobs WHERE pdf_document_id = ?', [id]);
        console.log('Deleted related conversion_jobs records');
      } catch (convError) {
        console.warn('Error deleting conversion_jobs (may not exist):', convError.message);
      }
      
      // Now delete the main record
      const [result] = await pool.execute('DELETE FROM pdf_documents WHERE id = ?', [id]);
      
      console.log('Delete result:', {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
        warningCount: result.warningCount
      });
      
      if (result.affectedRows === 0) {
        throw new Error('PDF document not found with id: ' + id);
      }
      
      return result;
    } catch (error) {
      console.error('Database delete error:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        stack: error.stack
      });
      throw error;
    }
  }

  static async findByZipGroup(zipFileGroupId) {
    const [rows] = await pool.execute(
      'SELECT * FROM pdf_documents WHERE zip_file_group_id = ? ORDER BY created_at',
      [zipFileGroupId]
    );
    return rows;
  }

  static async getGroupedByZip() {
    const [rows] = await pool.execute(`
      SELECT zip_file_group_id, 
             GROUP_CONCAT(id) as ids
      FROM pdf_documents
      WHERE zip_file_group_id IS NOT NULL
      GROUP BY zip_file_group_id
    `);
    return rows;
  }
}

