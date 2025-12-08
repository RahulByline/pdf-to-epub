import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { AudioSyncService } from '../services/audioSyncService.js';
import { AudioSyncModel } from '../models/AudioSync.js';
import { successResponse, errorResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';

const router = express.Router();

// GET /api/audio-sync/pdf/:pdfId - Get audio syncs by PDF
router.get('/pdf/:pdfId', async (req, res) => {
  try {
    const syncs = await AudioSyncService.getAudioSyncsByPdfId(parseInt(req.params.pdfId));
    return successResponse(res, syncs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/audio-sync/job/:jobId - Get audio syncs by job
router.get('/job/:jobId', async (req, res) => {
  try {
    const syncs = await AudioSyncService.getAudioSyncsByJobId(parseInt(req.params.jobId));
    return successResponse(res, syncs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/audio-sync/job/:jobId/combined-audio - Get combined audio file for job
router.get('/job/:jobId/combined-audio', async (req, res) => {
  try {
    const syncs = await AudioSyncService.getAudioSyncsByJobId(parseInt(req.params.jobId));
    if (!syncs || syncs.length === 0) {
      return notFoundResponse(res, 'No audio syncs found for this job');
    }
    
    // TODO: Combine all audio segments into one file
    // For now, return the first audio file
    const firstSync = await AudioSyncModel.findById(syncs[0].id);
    if (firstSync && firstSync.audio_file_path) {
      try {
        await fs.access(firstSync.audio_file_path);
        const filePath = path.resolve(firstSync.audio_file_path);
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.sendFile(filePath);
      } catch (fileError) {
        return notFoundResponse(res, 'Audio file not found on server');
      }
    }
    
    return notFoundResponse(res, 'No audio file available');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/audio-sync/pdf/:pdfId/job/:jobId - Get audio syncs by PDF and job
router.get('/pdf/:pdfId/job/:jobId', async (req, res) => {
  try {
    const syncs = await AudioSyncService.getAudioSyncs(
      parseInt(req.params.pdfId),
      parseInt(req.params.jobId)
    );
    return successResponse(res, syncs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/audio-sync - Create audio sync
router.post('/', async (req, res) => {
  try {
    const sync = await AudioSyncService.saveAudioSync(req.body);
    return successResponse(res, sync, 201);
  } catch (error) {
    if (error.message.includes('Missing required')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// PUT /api/audio-sync/:id - Update audio sync
router.put('/:id', async (req, res) => {
  try {
    const sync = await AudioSyncService.updateAudioSync(parseInt(req.params.id), req.body);
    return successResponse(res, sync);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/audio-sync/:id - Delete audio sync
router.delete('/:id', async (req, res) => {
  try {
    await AudioSyncService.deleteAudioSync(parseInt(req.params.id));
    return res.status(204).send();
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/audio-sync/job/:jobId - Delete audio syncs by job
router.delete('/job/:jobId', async (req, res) => {
  try {
    await AudioSyncService.deleteAudioSyncsByJobId(parseInt(req.params.jobId));
    return res.status(204).send();
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/audio-sync/pdf/:pdfId/extract-text - Extract text from PDF
router.get('/pdf/:pdfId/extract-text', async (req, res) => {
  try {
    const textChunks = await AudioSyncService.extractTextFromPdf(parseInt(req.params.pdfId));
    return successResponse(res, textChunks);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/audio-sync/job/:jobId/extract-text - Extract text from EPUB (for completed conversions)
router.get('/job/:jobId/extract-text', async (req, res) => {
  try {
    const textChunks = await AudioSyncService.extractTextFromEpub(parseInt(req.params.jobId));
    return successResponse(res, textChunks);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/audio-sync/generate - Generate audio for text chunks
router.post('/generate', async (req, res) => {
  try {
    const { pdfId, jobId, voice = 'standard', textBlocks } = req.body;
    
    if (!pdfId || !jobId) {
      return badRequestResponse(res, 'PDF ID and Job ID are required');
    }

    // Use provided text blocks if available, otherwise extract from EPUB/PDF
    let textChunks;
    if (textBlocks && Array.isArray(textBlocks) && textBlocks.length > 0) {
      // Use the text blocks provided by the frontend (user-selected/edited blocks)
      textChunks = textBlocks.map((block, idx) => ({
        id: block.id || `block_${idx}`,
        pageNumber: block.pageNumber || 1,
        text: block.text || '',
        sectionId: block.sectionId,
        sectionTitle: block.sectionTitle
      }));
      console.log(`[Audio Generate] Using ${textChunks.length} provided text blocks`);
    } else {
      // Fallback: Extract text from EPUB if available, otherwise from PDF
      try {
        textChunks = await AudioSyncService.extractTextFromEpub(jobId);
      } catch (error) {
        console.warn('Failed to extract from EPUB, falling back to PDF:', error.message);
        textChunks = await AudioSyncService.extractTextFromPdf(pdfId);
      }
    }
    
    if (!textChunks || textChunks.length === 0) {
      return badRequestResponse(res, 'No text chunks available to generate audio from');
    }
    
    const audioSegments = await AudioSyncService.generateCompleteAudio(textChunks, voice, pdfId, jobId);
    
    return successResponse(res, audioSegments, 201);
  } catch (error) {
    console.error('Error generating audio:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/audio-sync/voices - Get available voices
router.get('/voices', async (req, res) => {
  try {
    const voices = AudioSyncService.getAvailableVoices();
    return successResponse(res, voices);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/audio-sync/:id/audio - Stream audio file
router.get('/:id/audio', async (req, res) => {
  try {
    const sync = await AudioSyncModel.findById(parseInt(req.params.id));
    if (!sync || !sync.audio_file_path) {
      return notFoundResponse(res, 'Audio sync not found');
    }

    try {
      await fs.access(sync.audio_file_path);
      // Stream the actual audio file
      const filePath = path.resolve(sync.audio_file_path);
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.sendFile(filePath);
    } catch (fileError) {
      // Return placeholder or error
      return notFoundResponse(res, 'Audio file not found on server');
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

export default router;

