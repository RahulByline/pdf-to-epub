/**
 * Transcript API Routes
 * 
 * Provides REST API for transcript management:
 * - GET /api/transcripts/job/:jobId - Get all transcripts for a job
 * - GET /api/transcripts/job/:jobId/page/:pageNumber - Get transcript for a page
 * - PUT /api/transcripts/job/:jobId/page/:pageNumber/fragment/:fragmentId - Update fragment text
 * - POST /api/transcripts/job/:jobId/page/:pageNumber/realign - Re-run aeneas alignment
 * - POST /api/transcripts/job/:jobId/build-epub - Build EPUB from transcripts
 */

import express from 'express';
import { TranscriptService } from '../services/transcriptService.js';
import { TranscriptModel } from '../models/Transcript.js';
import { EpubBuilderFromTranscript } from '../services/epubBuilderFromTranscript.js';
import { AudioSyncService } from '../services/audioSyncService.js';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';
import { getEpubOutputDir } from '../config/fileStorage.js';
import path from 'path';

const router = express.Router();

/**
 * GET /api/transcripts/job/:jobId
 * Get all transcripts for a job (summary)
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const summaries = await TranscriptService.getAllTranscripts(jobId);
    return successResponse(res, summaries);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/transcripts/job/:jobId/page/:pageNumber
 * Get transcript for editing
 */
router.get('/job/:jobId/page/:pageNumber', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);

    const transcript = await TranscriptService.getTranscriptForEditing(jobId, pageNumber);
    
    if (!transcript) {
      return errorResponse(res, `Transcript not found for job ${jobId}, page ${pageNumber}`, 404);
    }

    return successResponse(res, transcript);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * PUT /api/transcripts/job/:jobId/page/:pageNumber/fragment/:fragmentId
 * Update text for a single fragment
 */
router.put('/job/:jobId/page/:pageNumber/fragment/:fragmentId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    const fragmentId = req.params.fragmentId;
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return badRequestResponse(res, 'Text is required and must be a string');
    }

    const updatedTranscript = await TranscriptService.updateFragmentText(
      jobId,
      pageNumber,
      fragmentId,
      text
    );

    return successResponse(res, {
      message: 'Fragment text updated successfully',
      transcript: updatedTranscript
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * PUT /api/transcripts/job/:jobId/page/:pageNumber/fragments
 * Batch update multiple fragment texts
 */
router.put('/job/:jobId/page/:pageNumber/fragments', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return badRequestResponse(res, 'Updates must be a non-empty array');
    }

    // Validate updates format
    for (const update of updates) {
      if (!update.id || typeof update.id !== 'string') {
        return badRequestResponse(res, 'Each update must have an id (string)');
      }
      if (typeof update.text !== 'string') {
        return badRequestResponse(res, 'Each update must have text (string)');
      }
    }

    const updatedTranscript = await TranscriptService.updateFragmentTexts(
      jobId,
      pageNumber,
      updates
    );

    return successResponse(res, {
      message: `${updates.length} fragment(s) updated successfully`,
      transcript: updatedTranscript
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/transcripts/job/:jobId/page/:pageNumber/realign
 * Re-run aeneas alignment with edited transcript text
 */
router.post('/job/:jobId/page/:pageNumber/realign', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    const { language = 'eng', granularity = 'sentence' } = req.body;

    console.log(`[TranscriptAPI] Realigning transcript for job ${jobId}, page ${pageNumber}`);

    const updatedTranscript = await TranscriptService.realignTranscript(jobId, pageNumber, {
      language,
      granularity
    });

    return successResponse(res, {
      message: 'Transcript realigned successfully',
      transcript: updatedTranscript
    });
  } catch (error) {
    console.error('[TranscriptAPI] Realignment error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/transcripts/job/:jobId/initialize
 * Initialize transcript from existing audio sync data
 * 
 * This is used when migrating from the old system or creating
 * a transcript for the first time from existing sync data.
 */
router.post('/job/:jobId/initialize', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const { pageNumber, audioFilePath } = req.body;

    if (!pageNumber) {
      return badRequestResponse(res, 'pageNumber is required');
    }

    // Get existing sync data
    const syncData = await AudioSyncService.getAudioSyncsByJobId(jobId);

    // Initialize transcript from sync data
    const transcript = await TranscriptService.initializeFromSyncData(
      jobId,
      pageNumber,
      syncData,
      audioFilePath
    );

    return successResponse(res, {
      message: 'Transcript initialized successfully',
      transcript
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/transcripts/job/:jobId/build-epub
 * Build EPUB3 package from transcripts
 */
router.post('/job/:jobId/build-epub', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const { title = 'Untitled', author = 'Unknown', language = 'en', audioFileName = null } = req.body;

    console.log(`[TranscriptAPI] Building EPUB from transcripts for job ${jobId}`);

    const outputDir = getEpubOutputDir();
    const builder = new EpubBuilderFromTranscript(jobId, outputDir);

    const epubPath = await builder.build({
      title,
      author,
      language,
      audioFileName
    });

    return successResponse(res, {
      message: 'EPUB built successfully from transcripts',
      epubPath: path.basename(epubPath),
      fullPath: epubPath
    });
  } catch (error) {
    console.error('[TranscriptAPI] EPUB build error:', error);
    return errorResponse(res, error.message, 500);
  }
});

export default router;

