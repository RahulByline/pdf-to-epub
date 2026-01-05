import pool from '../config/database.js';

export class TtsConfigurationModel {
  static async findAll() {
    const [rows] = await pool.execute(
      'SELECT id, language_code, voice_name, ssml_gender, audio_encoding, speaking_rate, pitch, volume_gain_db, use_free_tts, page_restrictions, is_active, description, created_at, updated_at FROM tts_configurations ORDER BY created_at DESC'
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM tts_configurations WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  static async findActive() {
    const [rows] = await pool.execute(
      'SELECT * FROM tts_configurations WHERE is_active = TRUE LIMIT 1'
    );
    return rows[0] || null;
  }

  static async create(configData) {
    const pageRestrictionsJson = configData.pageRestrictions 
      ? (typeof configData.pageRestrictions === 'string' 
          ? configData.pageRestrictions 
          : JSON.stringify(configData.pageRestrictions))
      : null;
    
    const [result] = await pool.execute(
      'INSERT INTO tts_configurations (credentials_path, language_code, voice_name, ssml_gender, audio_encoding, speaking_rate, pitch, volume_gain_db, use_free_tts, page_restrictions, exclusion_prompt, is_active, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        configData.credentialsPath || null,
        configData.languageCode || 'en-US',
        configData.voiceName || null,
        configData.ssmlGender || 'NEUTRAL',
        configData.audioEncoding || 'MP3',
        configData.speakingRate !== undefined ? configData.speakingRate : 1.0,
        configData.pitch !== undefined ? configData.pitch : 0.0,
        configData.volumeGainDb !== undefined ? configData.volumeGainDb : 0.0,
        configData.useFreeTts !== undefined ? configData.useFreeTts : false,
        pageRestrictionsJson,
        configData.exclusionPrompt || null,
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
      credentials_path: configData.credentialsPath,
      language_code: configData.languageCode,
      voice_name: configData.voiceName,
      ssml_gender: configData.ssmlGender,
      audio_encoding: configData.audioEncoding,
      speaking_rate: configData.speakingRate,
      pitch: configData.pitch,
      volume_gain_db: configData.volumeGainDb,
      use_free_tts: configData.useFreeTts,
      page_restrictions: configData.pageRestrictions !== undefined
        ? (typeof configData.pageRestrictions === 'string'
            ? configData.pageRestrictions
            : JSON.stringify(configData.pageRestrictions))
        : undefined,
      exclusion_prompt: configData.exclusionPrompt,
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
        `UPDATE tts_configurations SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }

    return await this.findById(id);
  }

  static async deactivateAll() {
    await pool.execute('UPDATE tts_configurations SET is_active = FALSE');
  }

  static async delete(id) {
    await pool.execute('DELETE FROM tts_configurations WHERE id = ?', [id]);
  }
}

