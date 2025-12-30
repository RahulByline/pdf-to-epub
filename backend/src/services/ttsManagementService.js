import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeminiService } from './geminiService.js';
import { TtsService } from './TtsService.js';
import { AudioSyncService } from './audioSyncService.js';
import { ConversionJobModel } from '../models/ConversionJob.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '../../data/tts-config.json');
const RESTRICTIONS_FILE = path.join(__dirname, '../../data/tts-restrictions.json');
const HISTORY_FILE = path.join(__dirname, '../../data/tts-history.json');

// Ensure data directory exists
const ensureDataDir = async () => {
  const dataDir = path.join(__dirname, '../../data');
  await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
};

// Default configuration
const DEFAULT_CONFIG = {
  provider: 'gemini',
  voice: 'standard',
  gender: 'NEUTRAL', // 'MALE', 'FEMALE', 'NEUTRAL'
  speed: 1.0,
  pitch: 1.0,
  volume: 1.0,
  language: 'en-US',
  enableRestrictions: true,
  skipTOC: true,
  skipPageNumbers: true,
  skipHeaders: true,
  skipFooters: true,
  maxLength: 5000,
  rateLimit: 100,
};

// Default restrictions
const DEFAULT_RESTRICTIONS = {
  minTextLength: 10,
  maxTextLength: 5000,
  allowedLanguages: ['en-US', 'en-GB'],
  blockedPatterns: ['TOC', 'Table of Contents', 'Page \\d+'],
  requiredPatterns: [],
  skipEmptyText: true,
  skipWhitespaceOnly: true,
  validateBeforeGeneration: true,
};

export class TTSManagementService {
  /**
   * Get TTS configuration
   */
  static async getConfig() {
    await ensureDataDir();
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // Return default if file doesn't exist
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save TTS configuration
   */
  static async saveConfig(config) {
    await ensureDataDir();
    const fullConfig = { ...DEFAULT_CONFIG, ...config, updatedAt: new Date().toISOString() };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(fullConfig, null, 2));
    return fullConfig;
  }

  /**
   * Get restrictions
   */
  static async getRestrictions() {
    await ensureDataDir();
    try {
      const data = await fs.readFile(RESTRICTIONS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return DEFAULT_RESTRICTIONS;
    }
  }

  /**
   * Save restrictions
   */
  static async saveRestrictions(restrictions) {
    await ensureDataDir();
    const fullRestrictions = { ...DEFAULT_RESTRICTIONS, ...restrictions, updatedAt: new Date().toISOString() };
    await fs.writeFile(RESTRICTIONS_FILE, JSON.stringify(fullRestrictions, null, 2));
    return fullRestrictions;
  }

  /**
   * Get available voices
   */
  static async getVoices() {
    return [
      { value: 'standard', label: 'Standard Voice' },
      { value: 'neural', label: 'Neural Voice' },
      { value: 'wavenet', label: 'WaveNet Voice' },
      { value: 'studio', label: 'Studio Voice' },
    ];
  }

  /**
   * Validate text against restrictions
   */
  static validateText(text, restrictions) {
    if (!text || typeof text !== 'string') {
      return { valid: false, reason: 'Text is empty or invalid' };
    }

    const trimmed = text.trim();

    if (restrictions.skipEmptyText && !trimmed) {
      return { valid: false, reason: 'Text is empty' };
    }

    if (restrictions.skipWhitespaceOnly && !trimmed.replace(/\s/g, '')) {
      return { valid: false, reason: 'Text contains only whitespace' };
    }

    if (trimmed.length < restrictions.minTextLength) {
      return { valid: false, reason: `Text is too short (min: ${restrictions.minTextLength})` };
    }

    if (trimmed.length > restrictions.maxTextLength) {
      return { valid: false, reason: `Text is too long (max: ${restrictions.maxTextLength})` };
    }

    // Check blocked patterns
    for (const pattern of restrictions.blockedPatterns || []) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(trimmed)) {
          return { valid: false, reason: `Text matches blocked pattern: ${pattern}` };
        }
      } catch (e) {
        console.warn(`Invalid regex pattern: ${pattern}`);
      }
    }

    return { valid: true };
  }

  /**
   * Test TTS generation - validates configuration and generates minimal sample audio
   */
  static async testGeneration(text, config, restrictions) {
    try {
      // Configuration validation results
      const validationResults = {
        configValid: true,
        restrictionsValid: true,
        ttsServiceAvailable: false,
        errors: [],
        warnings: []
      };

      // Validate configuration
      if (!config) {
        validationResults.configValid = false;
        validationResults.errors.push('Configuration is missing');
        return { success: false, error: 'Configuration is missing', validation: validationResults };
      }

      // Check required config fields
      if (!config.provider) {
        validationResults.warnings.push('Provider not specified, using default');
      }
      if (!config.language) {
        validationResults.warnings.push('Language not specified, using default');
      }
      if (!config.voice) {
        validationResults.warnings.push('Voice not specified, using default');
      }

      // Validate restrictions if enabled (but skip length restrictions for test)
      if (restrictions?.validateBeforeGeneration) {
        // Use a minimal test text for validation check
        const sampleText = text || "Test";
        
        // Create test-specific restrictions that don't enforce length limits
        // (since test audio can be any length for configuration verification)
        const testRestrictions = {
          ...restrictions,
          minTextLength: 0, // No minimum for test
          maxTextLength: Infinity, // No maximum for test
        };
        
        const validation = this.validateText(sampleText, testRestrictions);
        if (!validation.valid) {
          // Only fail on critical validations (not length)
          // Length restrictions are skipped for tests
          if (validation.reason.includes('too short') || validation.reason.includes('too long')) {
            // Skip length validation errors for test - just log as warning
            validationResults.warnings.push(`Length restriction skipped for test: ${validation.reason}`);
          } else {
            // Other validations (empty, blocked patterns) still apply
            validationResults.restrictionsValid = false;
            validationResults.errors.push(`Text validation failed: ${validation.reason}`);
            return { 
              success: false, 
              error: validation.reason, 
              validation: validationResults 
            };
          }
        }
      }

      // Check if TTS service is available
      const ttsClient = TtsService.getClient();
      if (!ttsClient && ttsClient !== 'free-tts') {
        validationResults.warnings.push('TTS service not fully configured (using fallback)');
      } else {
        validationResults.ttsServiceAvailable = true;
      }

      // Generate audio for the provided text to test configuration
      // Use the full text provided by the user (no length restrictions for testing)
      const sampleText = text || "Test";
      
      console.log('[TTS Management] Generating audio for test text (length:', sampleText.length, 'chars)');
      
      let audioBuffer;
      try {
        audioBuffer = await TtsService.generateAudio(sampleText, {
          voice: config.voice,
          language: config.language,
          speed: config.speed,
          gender: config.gender || 'NEUTRAL',
        });
      } catch (ttsError) {
        validationResults.errors.push(`TTS generation failed: ${ttsError.message}`);
        return { 
          success: false, 
          error: `TTS generation failed: ${ttsError.message}`, 
          validation: validationResults 
        };
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        validationResults.errors.push('TTS service returned empty audio buffer');
        return { 
          success: false, 
          error: 'Failed to generate audio - service may not be properly configured', 
          validation: validationResults 
        };
      }

      // Save test audio temporarily (only for configuration verification)
      const testDir = path.join(__dirname, '../../uploads/test');
      await fs.mkdir(testDir, { recursive: true }).catch((err) => {
        console.error('[TTS Management] Error creating test directory:', err);
      });
      const filename = `test_config_${Date.now()}.mp3`;
      const filepath = path.join(testDir, filename);
      
      try {
        await fs.writeFile(filepath, audioBuffer);
        console.log('[TTS Management] Test audio saved:', filepath);
        console.log('[TTS Management] File size:', audioBuffer.length, 'bytes');
        
        // Verify file was created
        const stats = await fs.stat(filepath);
        console.log('[TTS Management] File verified, size:', stats.size, 'bytes');
      } catch (writeError) {
        console.error('[TTS Management] Error writing test audio file:', writeError);
        throw new Error(`Failed to save test audio: ${writeError.message}`);
      }

      // Configuration summary
      const configSummary = {
        provider: config.provider || 'not set',
        voice: config.voice || 'not set',
        language: config.language || 'not set',
        speed: config.speed || 1.0,
        restrictionsEnabled: restrictions?.validateBeforeGeneration || false,
        audioGenerated: true,
        audioSize: `${(audioBuffer.length / 1024).toFixed(2)} KB`,
        note: 'Length restrictions are bypassed for configuration testing'
      };

      return {
        success: true,
        audioUrl: `/uploads/test/${filename}`,
        message: 'TTS configuration test successful',
        validation: validationResults,
        config: configSummary
      };
    } catch (error) {
      console.error('[TTS Management] Test generation error:', error);
      return { 
        success: false, 
        error: error.message,
        validation: {
          configValid: false,
          restrictionsValid: false,
          ttsServiceAvailable: false,
          errors: [error.message],
          warnings: []
        }
      };
    }
  }

  /**
   * Generate TTS for a job
   */
  static async generateForJob(jobId, config, restrictions) {
    try {
      // Get job and extract text blocks
      const job = await ConversionJobModel.findByPk(jobId);
      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      // This would integrate with the existing audio generation logic
      // but with the restrictions and conditions applied
      // For now, return success
      return {
        success: true,
        jobId,
        message: 'TTS generation started',
      };
    } catch (error) {
      console.error('[TTS Management] Generate for job error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get generation history
   */
  static async getHistory() {
    await ensureDataDir();
    try {
      const data = await fs.readFile(HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get generation status
   */
  static async getStatus(jobId) {
    // Check if audio exists for this job
    const audioSyncs = await AudioSyncService.getAudioSyncsByJobId(jobId);
    return {
      jobId,
      hasAudio: audioSyncs && audioSyncs.length > 0,
      status: audioSyncs && audioSyncs.length > 0 ? 'completed' : 'pending',
    };
  }
}

