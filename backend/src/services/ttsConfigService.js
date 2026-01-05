import { TtsConfigurationModel } from '../models/TtsConfiguration.js';
import fs from 'fs';

export class TtsConfigService {
  static maskCredentialsPath(credentialsPath) {
    if (!credentialsPath || credentialsPath.length <= 8) {
      return '****';
    }
    const parts = credentialsPath.split(/[/\\]/);
    if (parts.length > 0) {
      const fileName = parts[parts.length - 1];
      if (fileName.length > 8) {
        return '.../' + fileName.substring(0, 4) + '****' + fileName.substring(fileName.length - 4);
      }
    }
    return credentialsPath.substring(0, 4) + '****' + credentialsPath.substring(credentialsPath.length - 4);
  }

  static async getCurrentConfiguration() {
    const config = await TtsConfigurationModel.findActive();
    if (!config) {
      return null;
    }

    return {
      id: config.id,
      credentialsPath: config.credentials_path ? this.maskCredentialsPath(config.credentials_path) : null,
      languageCode: config.language_code,
      voiceName: config.voice_name,
      ssmlGender: config.ssml_gender,
      audioEncoding: config.audio_encoding,
      speakingRate: config.speaking_rate,
      pitch: config.pitch,
      volumeGainDb: config.volume_gain_db,
      useFreeTts: config.use_free_tts,
      isActive: config.is_active,
      description: config.description,
      createdAt: config.created_at,
      updatedAt: config.updated_at
    };
  }

  static async saveConfiguration(configDTO) {
    // Validate credentials path if provided
    if (configDTO.credentialsPath !== undefined && configDTO.credentialsPath !== null && configDTO.credentialsPath.trim().length > 0) {
      const credentialsPath = configDTO.credentialsPath.trim();
      // Check if it's a masked path (contains ****)
      if (credentialsPath.includes('****')) {
        throw new Error('Invalid credentials path format. Please enter a valid path.');
      }
      // Verify file exists
      if (!fs.existsSync(credentialsPath)) {
        throw new Error(`Credentials file not found at: ${credentialsPath}`);
      }
    }

    let config;
    
    // Check if we're updating an existing config
    if (configDTO.id && configDTO.id > 0) {
      const existing = await TtsConfigurationModel.findById(configDTO.id);
      if (existing) {
        // Update existing configuration
        const updateData = {
          languageCode: configDTO.languageCode !== undefined ? configDTO.languageCode : existing.language_code,
          voiceName: configDTO.voiceName !== undefined ? configDTO.voiceName : existing.voice_name,
          ssmlGender: configDTO.ssmlGender !== undefined ? configDTO.ssmlGender : existing.ssml_gender,
          audioEncoding: configDTO.audioEncoding !== undefined ? configDTO.audioEncoding : existing.audio_encoding,
          speakingRate: configDTO.speakingRate !== undefined ? configDTO.speakingRate : existing.speaking_rate,
          pitch: configDTO.pitch !== undefined ? configDTO.pitch : existing.pitch,
          volumeGainDb: configDTO.volumeGainDb !== undefined ? configDTO.volumeGainDb : existing.volume_gain_db,
          useFreeTts: configDTO.useFreeTts !== undefined ? configDTO.useFreeTts : existing.use_free_tts,
          pageRestrictions: configDTO.pageRestrictions !== undefined ? configDTO.pageRestrictions : existing.page_restrictions,
          exclusionPrompt: configDTO.exclusionPrompt !== undefined ? configDTO.exclusionPrompt : existing.exclusion_prompt,
          isActive: configDTO.isActive !== undefined ? configDTO.isActive : existing.is_active,
          description: configDTO.description !== undefined ? configDTO.description : existing.description
        };

        // Only update credentials path if a new one is provided
        if (configDTO.credentialsPath !== undefined && configDTO.credentialsPath !== null && configDTO.credentialsPath.trim().length > 0) {
          if (!configDTO.credentialsPath.includes('****')) {
            updateData.credentialsPath = configDTO.credentialsPath.trim();
          } else {
            throw new Error('Invalid credentials path format. Please enter a valid path.');
          }
        }

        config = await TtsConfigurationModel.update(configDTO.id, updateData);
      } else {
        // ID provided but not found - create new
        // Deactivate all existing configurations before creating new one
        await TtsConfigurationModel.deactivateAll();
        
        config = await TtsConfigurationModel.create({
          credentialsPath: configDTO.credentialsPath || null,
          languageCode: configDTO.languageCode || 'en-US',
          voiceName: configDTO.voiceName || null,
          ssmlGender: configDTO.ssmlGender || 'NEUTRAL',
          audioEncoding: configDTO.audioEncoding || 'MP3',
          speakingRate: configDTO.speakingRate !== undefined ? configDTO.speakingRate : 1.0,
          pitch: configDTO.pitch !== undefined ? configDTO.pitch : 0.0,
          volumeGainDb: configDTO.volumeGainDb !== undefined ? configDTO.volumeGainDb : 0.0,
          useFreeTts: configDTO.useFreeTts !== undefined ? configDTO.useFreeTts : false,
          pageRestrictions: configDTO.pageRestrictions || null,
          exclusionPrompt: configDTO.exclusionPrompt || null,
          isActive: configDTO.isActive !== undefined ? configDTO.isActive : true,
          description: configDTO.description || ''
        });
      }
    } else {
      // Create new configuration
      // Deactivate all existing configurations before creating new one
      await TtsConfigurationModel.deactivateAll();
      
      config = await TtsConfigurationModel.create({
        credentialsPath: configDTO.credentialsPath || null,
        languageCode: configDTO.languageCode || 'en-US',
        voiceName: configDTO.voiceName || null,
        ssmlGender: configDTO.ssmlGender || 'NEUTRAL',
        audioEncoding: configDTO.audioEncoding || 'MP3',
        speakingRate: configDTO.speakingRate !== undefined ? configDTO.speakingRate : 1.0,
        pitch: configDTO.pitch !== undefined ? configDTO.pitch : 0.0,
        volumeGainDb: configDTO.volumeGainDb !== undefined ? configDTO.volumeGainDb : 0.0,
        useFreeTts: configDTO.useFreeTts !== undefined ? configDTO.useFreeTts : false,
        pageRestrictions: configDTO.pageRestrictions || null,
        exclusionPrompt: configDTO.exclusionPrompt || null,
        isActive: configDTO.isActive !== undefined ? configDTO.isActive : true,
        description: configDTO.description || ''
      });
    }

    let pageRestrictions = null;
    if (config.page_restrictions) {
      try {
        pageRestrictions = typeof config.page_restrictions === 'string' 
          ? JSON.parse(config.page_restrictions) 
          : config.page_restrictions;
      } catch (e) {
        console.warn('[TTS Config] Failed to parse page restrictions:', e.message);
        pageRestrictions = null;
      }
    }

    return {
      id: config.id,
      credentialsPath: config.credentials_path ? this.maskCredentialsPath(config.credentials_path) : null,
      languageCode: config.language_code,
      voiceName: config.voice_name,
      ssmlGender: config.ssml_gender,
      audioEncoding: config.audio_encoding,
      speakingRate: config.speaking_rate,
      pitch: config.pitch,
      volumeGainDb: config.volume_gain_db,
      useFreeTts: config.use_free_tts,
      pageRestrictions: pageRestrictions,
      exclusionPrompt: config.exclusion_prompt || null,
      isActive: config.is_active,
      description: config.description,
      createdAt: config.created_at,
      updatedAt: config.updated_at
    };
  }

  static async getStatus() {
    const config = await TtsConfigurationModel.findActive();
    const client = await this.getTtsClientStatus();
    
    return {
      enabled: !!config,
      configured: !!config,
      hasCredentials: !!(config?.credentials_path),
      useFreeTts: config?.use_free_tts || false,
      languageCode: config?.language_code || null,
      clientStatus: client.status,
      clientMessage: client.message
    };
  }

  static async getTtsClientStatus() {
    try {
      const { TtsService } = await import('./TtsService.js');
      const client = TtsService.getClient();
      
      if (client === 'free-tts') {
        return {
          status: 'free-tts',
          message: 'Using free gTTS (no credentials required)'
        };
      }
      
      if (client) {
        return {
          status: 'google-cloud',
          message: 'Google Cloud Text-to-Speech is available'
        };
      }
      
      return {
        status: 'disabled',
        message: 'TTS is not configured. Please set up credentials or use free TTS.'
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Error checking TTS status: ${error.message}`
      };
    }
  }

  static getAvailableLanguages() {
    return [
      { code: 'en-US', name: 'English (US)' },
      { code: 'en-GB', name: 'English (UK)' },
      { code: 'es-ES', name: 'Spanish (Spain)' },
      { code: 'es-US', name: 'Spanish (US)' },
      { code: 'fr-FR', name: 'French' },
      { code: 'de-DE', name: 'German' },
      { code: 'it-IT', name: 'Italian' },
      { code: 'pt-BR', name: 'Portuguese (Brazil)' },
      { code: 'ja-JP', name: 'Japanese' },
      { code: 'ko-KR', name: 'Korean' },
      { code: 'zh-CN', name: 'Chinese (Simplified)' },
      { code: 'zh-TW', name: 'Chinese (Traditional)' },
      { code: 'ar-XA', name: 'Arabic' },
      { code: 'hi-IN', name: 'Hindi' },
      { code: 'ru-RU', name: 'Russian' }
    ];
  }

  static getAvailableVoices(languageCode = 'en-US') {
    // Common Google Cloud TTS voices
    const voices = {
      'en-US': [
        { name: 'en-US-Standard-A', gender: 'FEMALE', description: 'Standard Female' },
        { name: 'en-US-Standard-B', gender: 'MALE', description: 'Standard Male' },
        { name: 'en-US-Standard-C', gender: 'FEMALE', description: 'Standard Female' },
        { name: 'en-US-Standard-D', gender: 'MALE', description: 'Standard Male' },
        { name: 'en-US-Standard-E', gender: 'FEMALE', description: 'Standard Female' },
        { name: 'en-US-Standard-F', gender: 'FEMALE', description: 'Standard Female' },
        { name: 'en-US-Standard-G', gender: 'FEMALE', description: 'Standard Female' },
        { name: 'en-US-Standard-H', gender: 'FEMALE', description: 'Standard Female' },
        { name: 'en-US-Standard-I', gender: 'MALE', description: 'Standard Male' },
        { name: 'en-US-Standard-J', gender: 'MALE', description: 'Standard Male' },
        { name: 'en-US-Wavenet-A', gender: 'FEMALE', description: 'Wavenet Female (Premium)' },
        { name: 'en-US-Wavenet-B', gender: 'MALE', description: 'Wavenet Male (Premium)' },
        { name: 'en-US-Wavenet-C', gender: 'FEMALE', description: 'Wavenet Female (Premium)' },
        { name: 'en-US-Wavenet-D', gender: 'MALE', description: 'Wavenet Male (Premium)' },
        { name: 'en-US-Wavenet-E', gender: 'FEMALE', description: 'Wavenet Female (Premium)' },
        { name: 'en-US-Wavenet-F', gender: 'FEMALE', description: 'Wavenet Female (Premium)' },
        { name: 'en-US-Wavenet-G', gender: 'FEMALE', description: 'Wavenet Female (Premium)' },
        { name: 'en-US-Wavenet-H', gender: 'FEMALE', description: 'Wavenet Female (Premium)' },
        { name: 'en-US-Wavenet-I', gender: 'MALE', description: 'Wavenet Male (Premium)' },
        { name: 'en-US-Wavenet-J', gender: 'MALE', description: 'Wavenet Male (Premium)' }
      ]
    };
    
    return voices[languageCode] || voices['en-US'];
  }

  static getAvailableAudioEncodings() {
    return [
      { value: 'MP3', label: 'MP3' },
      { value: 'LINEAR16', label: 'LINEAR16 (WAV)' },
      { value: 'OGG_OPUS', label: 'OGG Opus' }
    ];
  }

  /**
   * Get current TTS configuration with real credentials path (for internal use only)
   * This should NOT be exposed to frontend - use getCurrentConfiguration() instead
   * @returns {Promise<Object|null>} Configuration object with real credentials path
   */
  static async getActiveConfiguration() {
    const config = await TtsConfigurationModel.findActive();
    if (!config) {
      return null;
    }

    let pageRestrictions = null;
    if (config.page_restrictions) {
      try {
        pageRestrictions = typeof config.page_restrictions === 'string' 
          ? JSON.parse(config.page_restrictions) 
          : config.page_restrictions;
      } catch (e) {
        console.warn('[TTS Config] Failed to parse page restrictions:', e.message);
        pageRestrictions = null;
      }
    }

    return {
      id: config.id,
      credentialsPath: config.credentials_path, // Real path, not masked
      languageCode: config.language_code,
      voiceName: config.voice_name,
      ssmlGender: config.ssml_gender,
      audioEncoding: config.audio_encoding,
      speakingRate: config.speaking_rate,
      pitch: config.pitch,
      volumeGainDb: config.volume_gain_db,
      useFreeTts: config.use_free_tts,
      pageRestrictions: pageRestrictions,
      exclusionPrompt: config.exclusion_prompt || null,
      isActive: config.is_active,
      description: config.description
    };
  }

  /**
   * Check if a page should be processed based on page restrictions
   * @param {number} pageNumber - The page number to check
   * @param {object} pageRestrictions - The page restrictions configuration
   * @returns {boolean} - True if the page should be processed, false otherwise
   */
  static shouldProcessPage(pageNumber, pageRestrictions) {
    // If no restrictions, process all pages
    if (!pageRestrictions || Object.keys(pageRestrictions).length === 0) {
      return true;
    }

    // Parse page ranges and individual pages
    const parsePageList = (pageListStr) => {
      if (!pageListStr || typeof pageListStr !== 'string') return [];
      
      const pages = [];
      const parts = pageListStr.split(',').map(p => p.trim());
      
      for (const part of parts) {
        if (part.includes('-')) {
          // Range like "1-10"
          const [start, end] = part.split('-').map(n => parseInt(n.trim()));
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = start; i <= end; i++) {
              pages.push(i);
            }
          }
        } else {
          // Single page
          const page = parseInt(part);
          if (!isNaN(page)) {
            pages.push(page);
          }
        }
      }
      
      return pages;
    };

    // Check if page is in included list
    if (pageRestrictions.include) {
      const includedPages = parsePageList(pageRestrictions.include);
      if (includedPages.length > 0) {
        return includedPages.includes(pageNumber);
      }
    }

    // Check if page is in excluded list
    if (pageRestrictions.exclude) {
      const excludedPages = parsePageList(pageRestrictions.exclude);
      if (excludedPages.includes(pageNumber)) {
        return false;
      }
    }

    // If only include is specified and page is not in it, don't process
    if (pageRestrictions.include && !pageRestrictions.exclude) {
      const includedPages = parsePageList(pageRestrictions.include);
      if (includedPages.length > 0) {
        return false; // Not in included list
      }
    }

    // Default: process the page
    return true;
  }

  /**
   * Detect pages that should be excluded based on AI analysis
   * @param {Array} pages - Array of pages with text content
   * @param {string} exclusionPrompt - Description of pages to exclude
   * @param {Object} aiConfig - AI configuration (optional, will fetch if not provided)
   * @returns {Promise<Array<number>>} Array of page numbers to exclude
   */
  static async detectExcludedPages(pages, exclusionPrompt, aiConfig = null) {
    if (!exclusionPrompt || !exclusionPrompt.trim()) {
      return [];
    }

    if (!aiConfig) {
      const { AiConfigService } = await import('./aiConfigService.js');
      aiConfig = await AiConfigService.getActiveConfiguration();
    }

    if (!aiConfig || !aiConfig.apiKey) {
      throw new Error('AI configuration not available. Please configure AI settings first.');
    }

    // Prepare page summaries for AI analysis
    const pagesSummary = pages.map((page, idx) => ({
      pageNumber: page.pageNumber || idx + 1,
      textPreview: page.text 
        ? page.text.substring(0, 500).replace(/\s+/g, ' ').trim()
        : (page.textBlocks 
          ? page.textBlocks.slice(0, 5).map(b => b.text || '').join(' ').substring(0, 500)
          : ''),
      textBlockCount: page.textBlocks?.length || 0
    }));

    const prompt = `Analyze the following document pages and identify which pages match this description:

EXCLUSION CRITERIA: ${exclusionPrompt}

Document Pages:
${JSON.stringify(pagesSummary, null, 2)}

For each page, determine if it matches the exclusion criteria. Consider:
- Page content and text
- Page structure and layout
- Common patterns (e.g., table of contents, index, cover pages, blank pages, etc.)

Return a JSON object in this exact format:
{
  "excludedPages": [1, 3, 5],
  "reasoning": {
    "1": "Table of contents page",
    "3": "Blank page with minimal content",
    "5": "Index page"
  }
}

If no pages match, return:
{
  "excludedPages": [],
  "reasoning": {}
}

Return ONLY the JSON object, no other text.`;

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(aiConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: aiConfig.modelName || 'gemini-pro' });
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const responseText = await response.text();
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI response did not contain valid JSON');
      }
      
      const analysis = JSON.parse(jsonMatch[0]);
      
      if (!Array.isArray(analysis.excludedPages)) {
        throw new Error('AI response format invalid: excludedPages must be an array');
      }
      
      // Ensure page numbers are valid
      const excludedPages = analysis.excludedPages
        .map(p => parseInt(p))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);
      
      return {
        excludedPages,
        reasoning: analysis.reasoning || {}
      };
    } catch (error) {
      console.error('[TTS Config] Error detecting excluded pages:', error.message);
      throw new Error(`Failed to detect excluded pages: ${error.message}`);
    }
  }
}

