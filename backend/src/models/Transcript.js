import pool from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Transcript Model
 * 
 * Manages transcript JSON files that serve as the single source of truth
 * for EPUB3 generation. Transcripts store:
 * - Fragment IDs (stable across regenerations)
 * - Edited text (user-modified content)
 * - Audio timings (from aeneas alignment)
 * 
 * Architecture:
 * - Each chapter/page has a transcript JSON file
 * - Transcript files are stored in: backend/transcripts/{jobId}/
 * - Format: chapter_{pageNumber}.json
 * - Plain text version: chapter_{pageNumber}.txt (for aeneas input)
 */
export class TranscriptModel {
  /**
   * Get transcript directory for a job
   */
  static getTranscriptDir(jobId) {
    const transcriptsDir = path.join(__dirname, '../../transcripts');
    return path.join(transcriptsDir, `job_${jobId}`);
  }

  /**
   * Get transcript file path for a chapter/page
   */
  static getTranscriptPath(jobId, pageNumber) {
    const transcriptDir = this.getTranscriptDir(jobId);
    return path.join(transcriptDir, `chapter_${pageNumber}.json`);
  }

  /**
   * Get plain text file path for aeneas input
   */
  static getTextFilePath(jobId, pageNumber) {
    const transcriptDir = this.getTranscriptDir(jobId);
    return path.join(transcriptDir, `chapter_${pageNumber}.txt`);
  }

  /**
   * Ensure transcript directory exists
   */
  static async ensureTranscriptDir(jobId) {
    const transcriptDir = this.getTranscriptDir(jobId);
    await fs.mkdir(transcriptDir, { recursive: true });
    return transcriptDir;
  }

  /**
   * Load transcript JSON for a chapter
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @returns {Promise<Object|null>} Transcript data or null if not found
   */
  static async loadTranscript(jobId, pageNumber) {
    try {
      const transcriptPath = this.getTranscriptPath(jobId, pageNumber);
      const content = await fs.readFile(transcriptPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // Transcript doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Save transcript JSON for a chapter
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @param {Object} transcriptData - Transcript data following schema
   * @returns {Promise<string>} Path to saved transcript file
   */
  static async saveTranscript(jobId, pageNumber, transcriptData) {
    await this.ensureTranscriptDir(jobId);
    const transcriptPath = this.getTranscriptPath(jobId, pageNumber);
    
    // Validate transcript schema
    this.validateTranscriptSchema(transcriptData);
    
    // Write JSON file with pretty formatting
    await fs.writeFile(
      transcriptPath,
      JSON.stringify(transcriptData, null, 2),
      'utf8'
    );
    
    console.log(`[Transcript] Saved transcript for job ${jobId}, page ${pageNumber}`);
    return transcriptPath;
  }

  /**
   * Save plain text file for aeneas input
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @param {string} text - Plain text content (one segment per line)
   * @returns {Promise<string>} Path to saved text file
   */
  static async saveTextFile(jobId, pageNumber, text) {
    await this.ensureTranscriptDir(jobId);
    const textPath = this.getTextFilePath(jobId, pageNumber);
    
    // Write text file without BOM (aeneas requirement)
    await fs.writeFile(textPath, text, 'utf8');
    
    console.log(`[Transcript] Saved text file for job ${jobId}, page ${pageNumber}`);
    return textPath;
  }

  /**
   * Generate plain text from transcript for aeneas
   * 
   * @param {Object} transcriptData - Transcript JSON data
   * @returns {string} Plain text (one segment per line)
   */
  static generateTextForAeneas(transcriptData) {
    if (!transcriptData || !transcriptData.fragments) {
      throw new Error('Invalid transcript data: missing fragments array');
    }

    // Extract text from fragments, one per line
    // Normalize whitespace to match aeneas expectations
    return transcriptData.fragments
      .map(fragment => {
        const text = fragment.text || '';
        // Normalize: replace all whitespace with single space, trim
        return text.replace(/\s+/g, ' ').trim();
      })
      .filter(text => text.length > 0) // Remove empty lines
      .join('\n');
  }

  /**
   * Validate transcript JSON schema
   * 
   * Schema:
   * {
   *   jobId: number,
   *   pageNumber: number,
   *   audioFilePath: string,
   *   fragments: [
   *     {
   *       id: string,        // Stable fragment ID (e.g., "page1_p1_s1")
   *       text: string,       // Edited text content
   *       startTime: number,  // Audio start time in seconds (from aeneas)
   *       endTime: number,    // Audio end time in seconds (from aeneas)
   *       type: string       // "sentence" | "word" | "paragraph"
   *     }
   *   ],
   *   metadata: {
   *     createdAt: string,
   *     updatedAt: string,
   *     aeneasVersion: string,
   *     language: string
   *   }
   * }
   */
  static validateTranscriptSchema(transcriptData) {
    if (!transcriptData || typeof transcriptData !== 'object') {
      throw new Error('Transcript data must be an object');
    }

    if (!Array.isArray(transcriptData.fragments)) {
      throw new Error('Transcript must have a fragments array');
    }

    // Validate each fragment
    transcriptData.fragments.forEach((fragment, index) => {
      if (!fragment.id || typeof fragment.id !== 'string') {
        throw new Error(`Fragment ${index}: missing or invalid id`);
      }
      if (typeof fragment.text !== 'string') {
        throw new Error(`Fragment ${index}: text must be a string`);
      }
      if (typeof fragment.startTime !== 'number' || fragment.startTime < 0) {
        throw new Error(`Fragment ${index}: startTime must be a non-negative number`);
      }
      if (typeof fragment.endTime !== 'number' || fragment.endTime <= fragment.startTime) {
        throw new Error(`Fragment ${index}: endTime must be greater than startTime`);
      }
      if (!['sentence', 'word', 'paragraph'].includes(fragment.type)) {
        throw new Error(`Fragment ${index}: type must be "sentence", "word", or "paragraph"`);
      }
    });

    return true;
  }

  /**
   * Load all transcripts for a job
   * 
   * @param {number} jobId - Conversion job ID
   * @returns {Promise<Object>} Map of pageNumber -> transcript data
   */
  static async loadAllTranscripts(jobId) {
    const transcriptDir = this.getTranscriptDir(jobId);
    const transcripts = {};

    try {
      const files = await fs.readdir(transcriptDir);
      const jsonFiles = files.filter(f => f.startsWith('chapter_') && f.endsWith('.json'));

      for (const file of jsonFiles) {
        const match = file.match(/chapter_(\d+)\.json/);
        if (match) {
          const pageNumber = parseInt(match[1]);
          const transcriptPath = path.join(transcriptDir, file);
          const content = await fs.readFile(transcriptPath, 'utf8');
          transcripts[pageNumber] = JSON.parse(content);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Directory doesn't exist yet, return empty object
    }

    return transcripts;
  }

  /**
   * Delete transcript for a chapter
   */
  static async deleteTranscript(jobId, pageNumber) {
    try {
      const transcriptPath = this.getTranscriptPath(jobId, pageNumber);
      await fs.unlink(transcriptPath);
      const textPath = this.getTextFilePath(jobId, pageNumber);
      await fs.unlink(textPath).catch(() => {}); // Ignore if text file doesn't exist
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Delete all transcripts for a job
   */
  static async deleteAllTranscripts(jobId) {
    try {
      const transcriptDir = this.getTranscriptDir(jobId);
      await fs.rm(transcriptDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}


