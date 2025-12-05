import pool from '../config/database.js';

export class AudioSyncModel {
  static async findAll() {
    const [rows] = await pool.execute(
      'SELECT * FROM audio_syncs ORDER BY created_at DESC'
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM audio_syncs WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  static async findByPdfId(pdfId) {
    const [rows] = await pool.execute(
      'SELECT * FROM audio_syncs WHERE pdf_document_id = ? ORDER BY page_number, start_time',
      [pdfId]
    );
    return rows;
  }

  static async findByJobId(jobId) {
    const [rows] = await pool.execute(
      'SELECT * FROM audio_syncs WHERE conversion_job_id = ? ORDER BY page_number, start_time',
      [jobId]
    );
    return rows;
  }

  static async findByPdfAndJob(pdfId, jobId) {
    const [rows] = await pool.execute(
      'SELECT * FROM audio_syncs WHERE pdf_document_id = ? AND conversion_job_id = ? ORDER BY page_number, start_time',
      [pdfId, jobId]
    );
    return rows;
  }

  static async create(syncData) {
    const [result] = await pool.execute(
      `INSERT INTO audio_syncs (
        pdf_document_id, conversion_job_id, page_number, block_id,
        start_time, end_time, audio_file_path, notes, custom_text, is_custom_segment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        syncData.pdfDocumentId,
        syncData.conversionJobId,
        syncData.pageNumber,
        syncData.blockId || null,
        syncData.startTime,
        syncData.endTime,
        syncData.audioFilePath,
        syncData.notes || null,
        syncData.customText || null,
        syncData.isCustomSegment || false
      ]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, syncData) {
    const updates = [];
    const values = [];

    const fields = {
      pdf_document_id: syncData.pdfDocumentId,
      conversion_job_id: syncData.conversionJobId,
      page_number: syncData.pageNumber,
      block_id: syncData.blockId,
      start_time: syncData.startTime,
      end_time: syncData.endTime,
      audio_file_path: syncData.audioFilePath,
      notes: syncData.notes,
      custom_text: syncData.customText,
      is_custom_segment: syncData.isCustomSegment
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
        `UPDATE audio_syncs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }

    return await this.findById(id);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM audio_syncs WHERE id = ?', [id]);
  }

  static async deleteByJobId(jobId) {
    await pool.execute('DELETE FROM audio_syncs WHERE conversion_job_id = ?', [jobId]);
  }
}

