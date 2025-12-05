import pool from '../config/database.js';

export class ConversionJobModel {
  static async findAll() {
    const [rows] = await pool.execute(
      'SELECT * FROM conversion_jobs ORDER BY created_at DESC'
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM conversion_jobs WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  static async findByPdfDocumentId(pdfDocumentId) {
    const [rows] = await pool.execute(
      'SELECT * FROM conversion_jobs WHERE pdf_document_id = ? ORDER BY created_at DESC',
      [pdfDocumentId]
    );
    return rows;
  }

  static async findByStatus(status) {
    const [rows] = await pool.execute(
      'SELECT * FROM conversion_jobs WHERE status = ? ORDER BY created_at DESC',
      [status]
    );
    return rows;
  }

  static async findByRequiresReview() {
    const [rows] = await pool.execute(
      'SELECT * FROM conversion_jobs WHERE requires_review = TRUE ORDER BY created_at DESC'
    );
    return rows;
  }

  static async create(jobData) {
    const [result] = await pool.execute(
      `INSERT INTO conversion_jobs (
        pdf_document_id, status, current_step, progress_percentage,
        epub_file_path, error_message, intermediate_data, confidence_score,
        requires_review, reviewed_by, reviewed_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobData.pdfDocumentId,
        jobData.status || 'PENDING',
        jobData.currentStep || null,
        jobData.progressPercentage || 0,
        jobData.epubFilePath || null,
        jobData.errorMessage || null,
        jobData.intermediateData || null,
        jobData.confidenceScore || null,
        jobData.requiresReview || false,
        jobData.reviewedBy || null,
        jobData.reviewedAt || null,
        jobData.completedAt || null
      ]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, jobData) {
    const updates = [];
    const values = [];

    const fields = {
      pdf_document_id: jobData.pdfDocumentId,
      status: jobData.status,
      current_step: jobData.currentStep,
      progress_percentage: jobData.progressPercentage,
      epub_file_path: jobData.epubFilePath,
      error_message: jobData.errorMessage,
      intermediate_data: jobData.intermediateData,
      confidence_score: jobData.confidenceScore,
      requires_review: jobData.requiresReview,
      reviewed_by: jobData.reviewedBy,
      reviewed_at: jobData.reviewedAt,
      completed_at: jobData.completedAt
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
        `UPDATE conversion_jobs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }

    return await this.findById(id);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM conversion_jobs WHERE id = ?', [id]);
  }
}

