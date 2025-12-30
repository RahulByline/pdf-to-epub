import fs from 'fs/promises';
import path from 'path';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let gTTS = null;
try {
  gTTS = require('gtts');
} catch (e) {
  console.warn('[TTS] gtts package not available. Install with: npm install gtts');
}

export class TtsService {
  static _client = null;
  static _useFreeTts = false;

  static getClient() {
    if (!this._client) {
      // Google Cloud TTS requires service account credentials (not API key like Gemini)
      // Check for standard GCP credential environment variable
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                               process.env.GCP_SERVICE_ACCOUNT_PATH ||
                               process.env.GCP_CREDENTIALS_PATH;
      
      // Check if TTS is explicitly disabled
      const ttsEnabled = (process.env.TTS_ENABLED || 'true').toLowerCase() === 'true';
      if (!ttsEnabled) {
        console.log('[TTS] TTS is disabled via TTS_ENABLED=false. TTS features will be skipped.');
        return null;
      }
      
      if (!credentialsPath) {
        // No credentials provided - use free gTTS as fallback
        console.log('[TTS] No Google Cloud credentials found. Using free gTTS (no word-level timing).');
        console.log('[TTS] Note: For better quality and word-level timing, set GOOGLE_APPLICATION_CREDENTIALS.');
        this._useFreeTts = true;
        return 'free-tts'; // Return a marker instead of null
      }
      
      let clientOptions = {};
      
      try {
        // Verify file exists
        const fs = require('fs');
        if (!fs.existsSync(credentialsPath)) {
          console.warn(`[TTS] Credentials file not found at: ${credentialsPath}`);
          console.log('[TTS] TTS features will be disabled. You can upload human audio files instead.');
          return null;
        }
        
        clientOptions.keyFilename = credentialsPath;
        console.log(`[TTS] Using GCP credentials from: ${credentialsPath}`);
      } catch (error) {
        console.warn(`[TTS] Could not verify credentials file: ${error.message}`);
        console.log('[TTS] TTS features will be disabled. You can upload human audio files instead.');
        return null;
      }
      
      try {
        this._client = new TextToSpeechClient(clientOptions);
        console.log('[TTS] Text-to-Speech client initialized successfully');
      } catch (error) {
        console.error('[TTS] Failed to initialize Text-to-Speech client:', error.message);
        console.log('[TTS] TTS features will be disabled. You can upload human audio files instead.');
        return null;
      }
    }
    return this._client;
  }

  /**
   * Estimate word timings based on audio duration and word count
   */
  static estimateWordTimings(text, audioDurationSec) {
    const words = text.split(/\s+/).filter(w => w.trim().length > 0);
    if (words.length === 0) return [];
    
    // Simple heuristic: distribute time evenly across words
    // Add small pauses between words (0.1s per word)
    const pauseTime = words.length * 0.1;
    const speechTime = Math.max(0.1, audioDurationSec - pauseTime);
    const timePerWord = speechTime / words.length;
    
    const timings = [];
    let currentTime = 0;
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^\w]/g, ''); // Remove punctuation for matching
      const startTime = currentTime;
      const endTime = currentTime + timePerWord;
      
      timings.push({
        word: word,
        startTimeSec: parseFloat(startTime.toFixed(3)),
        endTimeSec: parseFloat(endTime.toFixed(3))
      });
      
      currentTime = endTime + 0.1; // Add pause between words
    }
    
    return timings;
  }

  /**
   * Synthesize page audio with word-level timepoints.
   * @param {object} params
   * @param {string} params.text - Plain text to synthesize.
   * @param {string} params.audioOutPath - Path to write the mp3 file.
   * @param {object} [params.voice] - Optional voice config { languageCode, name, ssmlGender }.
   * @returns {Promise<{ audioFilePath: string, timings: Array<{ word: string, startTimeSec: number, endTimeSec: number }>, audioBuffer: Buffer }>}
   */
  static async synthesizePageAudio({ text, audioOutPath, voice = {} }) {
    if (!text || !text.trim()) {
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }

    const client = this.getClient();
    
    // Use free gTTS if no Google Cloud credentials
    if (this._useFreeTts || client === 'free-tts') {
      return await this.synthesizeWithFreeTts({ text, audioOutPath, voice });
    }
    
    if (!client) {
      console.warn('[TTS] Text-to-Speech client not available, skipping audio synthesis');
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }

    const input = { text };
    const voiceConfig = {
      languageCode: voice.languageCode || 'en-US',
      name: voice.name || undefined,
      ssmlGender: voice.ssmlGender || 'NEUTRAL'
    };
    const audioConfig = {
      audioEncoding: 'MP3',
      enableTimePointing: ['WORD']
    };

    try {
      const [response] = await client.synthesizeSpeech({
        input,
        voice: voiceConfig,
        audioConfig
      });

      const audioBuffer = response.audioContent
        ? Buffer.from(response.audioContent, 'base64')
        : Buffer.alloc(0);

      // Write to disk if requested
      if (audioOutPath && audioBuffer.length > 0) {
        await fs.mkdir(path.dirname(audioOutPath), { recursive: true }).catch(() => {});
        await fs.writeFile(audioOutPath, audioBuffer);
      }

      const timings = (response.timepoints || []).map(tp => ({
        word: tp.markName || '',
        startTimeSec: parseFloat((tp.timeSeconds || tp.time || 0).toFixed(3)),
        endTimeSec: parseFloat((tp.timeSeconds || tp.time || 0).toFixed(3)) // will be adjusted by mapper
      }));

      return {
        audioFilePath: audioOutPath || '',
        timings,
        audioBuffer
      };
    } catch (error) {
      console.error('[TTS] Error synthesizing speech:', error.message);
      if (error.code === 7) {
        console.error('[TTS] Permission denied - check service account has Cloud Text-to-Speech API enabled');
      } else if (error.code === 16) {
        console.error('[TTS] Unauthenticated - check credentials are valid');
      }
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }
  }

  /**
   * Synthesize audio using free gTTS (no credentials required)
   * Note: This doesn't provide word-level timing, so we estimate it
   */
  static async synthesizeWithFreeTts({ text, audioOutPath, voice = {} }) {
    try {
      const languageCode = voice.languageCode || 'en';
      const lang = languageCode.split('-')[0]; // Convert 'en-US' to 'en'
      
      console.log(`[TTS] Using free gTTS (language: ${lang})`);
      
      // Ensure output directory exists
      if (audioOutPath) {
        await fs.mkdir(path.dirname(audioOutPath), { recursive: true }).catch(() => {});
      }
      
      // Use gTTS to generate audio
      return new Promise((resolve, reject) => {
        const gtts = new gTTS(text, lang);
        
        // gTTS saves directly to file, so we need to read it back
        const tempPath = audioOutPath || path.join(process.cwd(), 'temp_tts.mp3');
        
        gtts.save(tempPath, async (err) => {
          if (err) {
            console.error('[TTS] gTTS error:', err);
            reject(err);
            return;
          }
          
          try {
            // Read the generated audio file
            const audioBuffer = await fs.readFile(tempPath);
            
            // Get audio duration using a simple estimation or audio library
            // For now, estimate based on text length (average speaking rate: ~150 words/min)
            const words = text.split(/\s+/).filter(w => w.trim().length > 0);
            const estimatedDurationSec = (words.length / 150) * 60; // words per minute to seconds
            
            // Estimate word timings
            const timings = this.estimateWordTimings(text, estimatedDurationSec);
            
            console.log(`[TTS] Generated audio with gTTS: ${(audioBuffer.length / 1024).toFixed(2)} KB, estimated duration: ${estimatedDurationSec.toFixed(2)}s`);
            
            resolve({
              audioFilePath: audioOutPath || tempPath,
              timings,
              audioBuffer
            });
          } catch (readError) {
            console.error('[TTS] Error reading generated audio:', readError);
            reject(readError);
          }
        });
      });
    } catch (error) {
      console.error('[TTS] Error with free gTTS:', error.message);
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }
  }

  /**
   * Generate audio from text (simplified API for TTS Management)
   * @param {string} text - Text to convert to speech
   * @param {object} options - Options { voice, language, speed }
   * @returns {Promise<Buffer>} Audio buffer
   */
  static async generateAudio(text, options = {}) {
    if (!text || !text.trim()) {
      return null;
    }

    // Create a temporary file path
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
    const tempAudioPath = path.join(tempDir, `tts_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);

    // Map options to voice config
    const voiceConfig = {
      languageCode: options.language || 'en-US',
      name: options.voice || undefined,
      ssmlGender: options.gender || 'NEUTRAL'
    };

    try {
      const result = await this.synthesizePageAudio({
        text,
        audioOutPath: tempAudioPath,
        voice: voiceConfig
      });

      // Clean up temp file after reading
      if (tempAudioPath && await fs.access(tempAudioPath).then(() => true).catch(() => false)) {
        // Don't delete immediately - let it be cleaned up later or keep for testing
        // await fs.unlink(tempAudioPath).catch(() => {});
      }

      return result.audioBuffer || null;
    } catch (error) {
      console.error('[TTS] Error in generateAudio:', error.message);
      return null;
    }
  }
}

