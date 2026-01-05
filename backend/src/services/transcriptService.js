import { TranscriptModel } from '../models/Transcript.js';
import { aeneasService } from './aeneasService.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Transcript Service
 * 
 * Manages the transcript-based workflow:
 * 1. Load/create transcript from existing sync data
 * 2. Allow text editing (saves to transcript JSON)
 * 3. Re-run aeneas alignment with edited text
 * 4. Update transcript with new timings
 * 
 * This service ensures transcript JSON is the single source of truth
 * for all EPUB3 generation (XHTML, SMIL, EPUB).
 */
export class TranscriptService {
  /**
   * Initialize transcript from existing audio sync data
   * 
   * This is used when migrating from the old system or when
   * creating a transcript for the first time from existing sync data.
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @param {Array} syncData - Array of audio sync records from database
   * @param {string} audioFilePath - Path to audio file
   * @returns {Promise<Object>} Transcript data
   */
  static async initializeFromSyncData(jobId, pageNumber, syncData, audioFilePath) {
    // Convert sync data to transcript fragments
    const fragments = syncData
      .filter(sync => sync.page_number === pageNumber)
      .sort((a, b) => (a.start_time || 0) - (b.start_time || 0))
      .map(sync => ({
        id: sync.block_id || `fragment_${sync.id}`,
        text: sync.custom_text || sync.text || '',
        startTime: sync.start_time || 0,
        endTime: sync.end_time || 0,
        type: this.inferFragmentType(sync.block_id)
      }));

    const transcriptData = {
      jobId,
      pageNumber,
      audioFilePath,
      fragments,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        aeneasVersion: null, // Will be set after aeneas runs
        language: 'eng',
        source: 'migrated_from_sync_data'
      }
    };

    // Save transcript
    await TranscriptModel.saveTranscript(jobId, pageNumber, transcriptData);

    return transcriptData;
  }

  /**
   * Infer fragment type from block ID
   */
  static inferFragmentType(blockId) {
    if (!blockId) return 'sentence';
    if (blockId.includes('_w')) return 'word';
    if (blockId.includes('_s')) return 'sentence';
    return 'paragraph';
  }

  /**
   * Update text in transcript
   * 
   * This is called when user edits text. It updates the transcript JSON
   * but does NOT regenerate audio or run aeneas yet.
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @param {string} fragmentId - Fragment ID to update
   * @param {string} newText - New text content
   * @returns {Promise<Object>} Updated transcript data
   */
  static async updateFragmentText(jobId, pageNumber, fragmentId, newText) {
    const transcript = await TranscriptModel.loadTranscript(jobId, pageNumber);
    if (!transcript) {
      throw new Error(`Transcript not found for job ${jobId}, page ${pageNumber}`);
    }

    // Find and update fragment
    const fragment = transcript.fragments.find(f => f.id === fragmentId);
    if (!fragment) {
      throw new Error(`Fragment ${fragmentId} not found in transcript`);
    }

    // Update text
    fragment.text = newText.trim();
    transcript.metadata.updatedAt = new Date().toISOString();
    transcript.metadata.textEdited = true;

    // Save updated transcript
    await TranscriptModel.saveTranscript(jobId, pageNumber, transcript);

    return transcript;
  }

  /**
   * Update multiple fragment texts (batch edit)
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @param {Array<{id: string, text: string}>} updates - Array of {id, text} updates
   * @returns {Promise<Object>} Updated transcript data
   */
  static async updateFragmentTexts(jobId, pageNumber, updates) {
    const transcript = await TranscriptModel.loadTranscript(jobId, pageNumber);
    if (!transcript) {
      throw new Error(`Transcript not found for job ${jobId}, page ${pageNumber}`);
    }

    // Create lookup map for faster updates
    const updateMap = new Map(updates.map(u => [u.id, u.text]));

    // Update all matching fragments
    let updatedCount = 0;
    transcript.fragments.forEach(fragment => {
      if (updateMap.has(fragment.id)) {
        fragment.text = updateMap.get(fragment.id).trim();
        updatedCount++;
      }
    });

    if (updatedCount === 0) {
      throw new Error('No fragments were updated. Check fragment IDs.');
    }

    transcript.metadata.updatedAt = new Date().toISOString();
    transcript.metadata.textEdited = true;

    // Save updated transcript
    await TranscriptModel.saveTranscript(jobId, pageNumber, transcript);

    return transcript;
  }

  /**
   * Re-run aeneas alignment with edited transcript text
   * 
   * This is the core function that:
   * 1. Loads transcript JSON
   * 2. Generates plain text file from transcript
   * 3. Runs aeneas alignment (audio + edited text)
   * 4. Updates transcript with new timings
   * 5. Saves updated transcript
   * 
   * CRITICAL: This preserves fragment IDs and text, only updates timings
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @param {Object} options - Aeneas options
   * @returns {Promise<Object>} Updated transcript with new timings
   */
  static async realignTranscript(jobId, pageNumber, options = {}) {
    const {
      language = 'eng',
      granularity = 'sentence'
    } = options;

    // Load transcript
    const transcript = await TranscriptModel.loadTranscript(jobId, pageNumber);
    if (!transcript) {
      throw new Error(`Transcript not found for job ${jobId}, page ${pageNumber}`);
    }

    if (!transcript.audioFilePath) {
      throw new Error(`Audio file path not set in transcript`);
    }

    // Verify audio file exists
    try {
      await fs.access(transcript.audioFilePath);
    } catch (error) {
      throw new Error(`Audio file not found: ${transcript.audioFilePath}`);
    }

    console.log(`[TranscriptService] Re-aligning transcript for job ${jobId}, page ${pageNumber}`);
    console.log(`[TranscriptService] Audio: ${transcript.audioFilePath}`);
    console.log(`[TranscriptService] Fragments: ${transcript.fragments.length}`);

    // Generate plain text file from transcript
    const textContent = TranscriptModel.generateTextForAeneas(transcript);
    const textFilePath = await TranscriptModel.saveTextFile(jobId, pageNumber, textContent);

    // Run aeneas alignment
    // Note: We use aeneasService.executeAlignment directly since we already have
    // the text file prepared and we need to map results back to fragment IDs
    const aeneasOutputPath = path.join(
      TranscriptModel.getTranscriptDir(jobId),
      `aeneas_output_${pageNumber}.json`
    );

    const fragments = await aeneasService.executeAlignment(
      transcript.audioFilePath,
      textFilePath,
      aeneasOutputPath,
      {
        language,
        textType: 'plain',
        outputFormat: 'json'
      }
    );

    console.log(`[TranscriptService] Aeneas returned ${fragments.length} fragments`);

    // Map aeneas fragments back to transcript fragments
    // CRITICAL: Preserve fragment IDs and text, only update timings
    if (fragments.length !== transcript.fragments.length) {
      console.warn(
        `[TranscriptService] Fragment count mismatch: ` +
        `aeneas=${fragments.length}, transcript=${transcript.fragments.length}`
      );
    }

    // Map aeneas results to transcript fragments by index
    // This works because we generated the text file in the same order
    transcript.fragments.forEach((fragment, index) => {
      if (index < fragments.length) {
        const aeneasFragment = fragments[index];
        // Update timings only - preserve ID and text
        fragment.startTime = parseFloat(aeneasFragment.begin);
        fragment.endTime = parseFloat(aeneasFragment.end);
      } else {
        console.warn(
          `[TranscriptService] Fragment ${fragment.id} has no aeneas match, keeping original timings`
        );
      }
    });

    // Update metadata
    transcript.metadata.updatedAt = new Date().toISOString();
    transcript.metadata.lastAlignedAt = new Date().toISOString();
    transcript.metadata.aeneasVersion = '1.7.3'; // Update with actual version if available
    transcript.metadata.alignmentMethod = 'aeneas';

    // Save updated transcript
    await TranscriptModel.saveTranscript(jobId, pageNumber, transcript);

    // Cleanup aeneas output file
    try {
      await fs.unlink(aeneasOutputPath);
    } catch (error) {
      // Ignore cleanup errors
    }

    console.log(`[TranscriptService] Transcript realigned successfully`);

    return transcript;
  }

  /**
   * Get transcript for editing
   * 
   * Returns transcript data formatted for frontend editing UI
   * 
   * @param {number} jobId - Conversion job ID
   * @param {number} pageNumber - Page/chapter number
   * @returns {Promise<Object>} Transcript data for editing
   */
  static async getTranscriptForEditing(jobId, pageNumber) {
    const transcript = await TranscriptModel.loadTranscript(jobId, pageNumber);
    if (!transcript) {
      return null;
    }

    return {
      jobId: transcript.jobId,
      pageNumber: transcript.pageNumber,
      audioFilePath: transcript.audioFilePath,
      fragments: transcript.fragments.map(f => ({
        id: f.id,
        text: f.text,
        startTime: f.startTime,
        endTime: f.endTime,
        duration: f.endTime - f.startTime,
        type: f.type
      })),
      metadata: transcript.metadata,
      canEdit: true,
      canRealign: !!transcript.audioFilePath
    };
  }

  /**
   * Get all transcripts for a job
   * 
   * @param {number} jobId - Conversion job ID
   * @returns {Promise<Object>} Map of pageNumber -> transcript summary
   */
  static async getAllTranscripts(jobId) {
    const transcripts = await TranscriptModel.loadAllTranscripts(jobId);
    
    const summaries = {};
    for (const [pageNumber, transcript] of Object.entries(transcripts)) {
      summaries[pageNumber] = {
        pageNumber: parseInt(pageNumber),
        fragmentCount: transcript.fragments.length,
        hasAudio: !!transcript.audioFilePath,
        lastUpdated: transcript.metadata.updatedAt,
        textEdited: transcript.metadata.textEdited || false
      };
    }

    return summaries;
  }
}






