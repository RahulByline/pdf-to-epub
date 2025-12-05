import pool from '../config/database.js';

export class AiConfigurationModel {
  static async findAll() {
    const [rows] = await pool.execute(
      'SELECT id, model_name, is_active, description, created_at, updated_at FROM ai_configurations ORDER BY created_at DESC'
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM ai_configurations WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  static async findActive() {
    const [rows] = await pool.execute(
      'SELECT * FROM ai_configurations WHERE is_active = TRUE LIMIT 1'
    );
    return rows[0] || null;
  }

  static async create(configData) {
    const [result] = await pool.execute(
      'INSERT INTO ai_configurations (api_key, model_name, is_active, description) VALUES (?, ?, ?, ?)',
      [
        configData.apiKey,
        configData.modelName || 'gemini-pro',
        configData.isActive !== undefined ? configData.isActive : true,
        configData.description || null
      ]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, configData) {
    const updates = [];
    const values = [];

    const fields = {
      api_key: configData.apiKey,
      model_name: configData.modelName,
      is_active: configData.isActive,
      description: configData.description
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
        `UPDATE ai_configurations SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }

    return await this.findById(id);
  }

  static async deactivateAll() {
    await pool.execute('UPDATE ai_configurations SET is_active = FALSE');
  }

  static async delete(id) {
    await pool.execute('DELETE FROM ai_configurations WHERE id = ?', [id]);
  }
}

