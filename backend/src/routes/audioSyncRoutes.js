import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { AudioSyncService } from '../services/audioSyncService.js';
import { AudioSyncModel } from '../models/AudioSync.js';
import { ConversionJobModel } from '../models/ConversionJob.js';
import { successResponse, errorResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';
import { getUploadDir } from '../config/fileStorage.js';
import { aeneasService } from '../services/aeneasService.js';
import { EpubService } from '../services/epubService.js';
import { GeminiService } from '../services/geminiService.js';

// Configure multer for audio file uploads
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadDir = getUploadDir();
      const audioDir = path.join(uploadDir, 'audio');
      await fs.mkdir(audioDir, { recursive: true }).catch(() => {});
      cb(null, audioDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}_${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

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

// POST /api/audio-sync/upload-audio - Upload audio file for sync
router.post('/upload-audio', audioUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return badRequestResponse(res, 'No audio file provided');
    }

    const { jobId } = req.body;
    if (!jobId) {
      return badRequestResponse(res, 'Job ID is required');
    }

    const fileName = req.file.filename;
    const filePath = req.file.path;

    return successResponse(res, {
      fileName: fileName,
      filePath: filePath,
      size: req.file.size,
      originalName: req.file.originalname
    }, 201);
  } catch (error) {
    console.error('Error uploading audio:', error);
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/audio-sync/save-sync-blocks - Save sync blocks with read-aloud flags
router.post('/save-sync-blocks', async (req, res) => {
  try {
    const { jobId, syncBlocks, audioFileName, granularity = 'sentence', playbackSpeed = 1.0 } = req.body;
    
    if (!jobId || !syncBlocks || !Array.isArray(syncBlocks)) {
      return badRequestResponse(res, 'Job ID and sync blocks array are required');
    }

    console.log(`[AudioSync] Saving ${syncBlocks.length} sync blocks for job ${jobId} (granularity: ${granularity})`);

    // CRITICAL FIX: Filter to only blocks where shouldRead === true
    // Blocks with shouldRead=false are unspoken content (TOC, headers, etc.)
    // and should NOT be synced to prevent sync drift
    const activeBlocks = syncBlocks.filter(block => block.shouldRead === true);
    
    if (activeBlocks.length < syncBlocks.length) {
      const excludedCount = syncBlocks.length - activeBlocks.length;
      console.log(`[AudioSync] Excluding ${excludedCount} unspoken blocks (shouldRead=false) from sync`);
    }
    
    // Get job to get PDF ID
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }

    // CRITICAL FIX: Also save excluded blocks with shouldRead: false marker
    // This allows the auto-sync to identify and skip them
    const excludedBlocks = syncBlocks.filter(block => block.shouldRead === false);
    for (const block of excludedBlocks) {
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      const existing = existingSyncs.find(s => 
        s.block_id === block.id && 
        (s.page_number || 1) === (block.pageNumber || 1)
      );
      
      if (existing) {
        // Update existing sync to mark as excluded
        await AudioSyncModel.update(existing.id, {
          ...existing,
          notes: `shouldRead: false - Unspoken content (TOC, header, etc.) excluded from sync`,
          start_time: 0,
          end_time: 0
        });
      } else {
        // Create marker sync for excluded block
        await AudioSyncModel.create({
          pdfDocumentId: job.pdf_document_id,
          conversionJobId: jobId,
          blockId: block.id,
          pageNumber: block.pageNumber || 1,
          startTime: 0,
          endTime: 0,
          audioFilePath: null,
          notes: `shouldRead: false - Unspoken content (TOC, header, etc.) excluded from sync`,
          customText: block.text || '',
          isCustomSegment: false
        });
      }
    }
    
    // Save each active block as an audio sync
    const savedSegments = [];
    for (const block of activeBlocks) {
      // Find existing audio sync for this block
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      const existing = existingSyncs.find(s => 
        s.block_id === block.id && 
        (s.page_number || 1) === (block.pageNumber || 1)
      );

      // Ensure pageNumber is always a number
      let pageNumber = 1;
      if (block.pageNumber) {
        if (typeof block.pageNumber === 'number') {
          pageNumber = block.pageNumber;
        } else {
          // Extract number from string like "page-1", "page_2"
          const match = String(block.pageNumber).match(/(\d+)/);
          pageNumber = match ? parseInt(match[1], 10) : 1;
        }
      }

      // Determine block type from ID pattern
      let blockType = block.type || granularity;
      if (block.id) {
        if (block.id.includes('_w')) blockType = 'word';
        else if (block.id.includes('_s') && !block.id.includes('_w')) blockType = 'sentence';
        else if (!block.id.includes('_s') && !block.id.includes('_w')) blockType = 'paragraph';
      }
      
      const syncData = {
        pdfDocumentId: job.pdf_document_id,
        conversionJobId: jobId,
        blockId: block.id,
        pageNumber: pageNumber,
        startTime: block.start || 0,
        endTime: block.end || 0,
        audioFilePath: audioFileName ? `audio/${audioFileName}` : null,
        notes: `Audio sync. Type: ${blockType}. Granularity: ${block.granularity || granularity}`,
        customText: block.text || '',
        isCustomSegment: true
      };

      if (existing) {
        const updated = await AudioSyncModel.update(existing.id, syncData);
        savedSegments.push({ ...syncData, id: existing.id, type: blockType });
      } else {
        const newSync = await AudioSyncModel.create(syncData);
        savedSegments.push({ ...syncData, id: newSync.id, type: blockType });
      }
    }

    // Delete syncs for blocks that are no longer active
    const activeBlockIds = activeBlocks.map(b => b.id);
    const allSyncs = await AudioSyncModel.findByJobId(jobId);
    
    for (const sync of allSyncs) {
      if (sync.block_id && !activeBlockIds.includes(sync.block_id)) {
        await AudioSyncModel.delete(sync.id);
      }
    }

    // Store playback speed in conversion job metadata (always save, even if 1.0)
    if (playbackSpeed !== undefined && playbackSpeed !== null) {
      const { ConversionJobModel } = await import('../models/ConversionJob.js');
      const job = await ConversionJobModel.findById(jobId);
      if (job) {
        const metadata = job.metadata || {};
        metadata.playbackSpeed = parseFloat(playbackSpeed);
        await ConversionJobModel.update(jobId, { metadata });
        console.log(`[AudioSync] Stored playback speed ${playbackSpeed}x for job ${jobId}`);
      }
    }

    console.log(`[AudioSync] Saved ${savedSegments.length} segments (${activeBlocks.length} active)`);
    return successResponse(res, { savedSegments, totalActive: activeBlocks.length, granularity, playbackSpeed }, 201);
  } catch (error) {
    console.error('Error saving sync blocks:', error);
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

// GET /api/audio-sync/check-aeneas - Check if Aeneas is installed
router.get('/check-aeneas', async (req, res) => {
  try {
    const isInstalled = await aeneasService.checkAeneasInstalled();
    return successResponse(res, { 
      installed: isInstalled,
      message: isInstalled 
        ? 'Aeneas is available for forced alignment' 
        : 'Aeneas not found. Using fallback linear spread algorithm.'
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/audio-sync/auto-sync - Automated forced alignment (Kitaboo-style)
router.post('/auto-sync', async (req, res) => {
  try {
    const { jobId, audioPath, language = 'eng', granularity = 'sentence', propagateWords = true } = req.body;
    
    console.log(`[AutoSync] Request body:`, req.body);
    
    if (!jobId) {
      console.log('[AutoSync] Error: Job ID is required');
      return badRequestResponse(res, 'Job ID is required');
    }

    console.log(`[AutoSync] Starting automated alignment for job ${jobId}`);
    console.log(`[AutoSync] Language: ${language}, Granularity: ${granularity}`);

    // Get job info
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      console.log(`[AutoSync] Error: Job ${jobId} not found`);
      return notFoundResponse(res, 'Conversion job not found');
    }
    console.log(`[AutoSync] Found job:`, job.id);

    // Get XHTML content from EPUB
    let sections;
    try {
      sections = await EpubService.getEpubSections(jobId);
      console.log(`[AutoSync] Got ${sections?.length || 0} sections`);
    } catch (epubErr) {
      console.log(`[AutoSync] Error getting EPUB sections:`, epubErr.message);
      return badRequestResponse(res, `Failed to get EPUB sections: ${epubErr.message}`);
    }
    
    if (!sections || sections.length === 0) {
      console.log('[AutoSync] Error: No EPUB sections found');
      return badRequestResponse(res, 'No EPUB sections found for this job');
    }

    // Combine all XHTML for alignment
    const combinedXhtml = sections.map(s => s.xhtml || s.content || '').join('\n');
    console.log(`[AutoSync] Combined XHTML length: ${combinedXhtml.length} chars`);

    // Resolve audio path
    let resolvedAudioPath = audioPath;
    if (!resolvedAudioPath) {
      // Try to find existing audio for this job
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      console.log(`[AutoSync] Found ${existingSyncs.length} existing syncs`);
      
      if (existingSyncs.length > 0 && existingSyncs[0].audio_file_path) {
        resolvedAudioPath = existingSyncs[0].audio_file_path;
        console.log(`[AutoSync] Found audio path from sync: ${resolvedAudioPath}`);

        // Handle relative paths
        if (!path.isAbsolute(resolvedAudioPath)) {
          // Normalize path: remove all leading 'audio/' segments, then add one
          let normalizedPath = resolvedAudioPath.replace(/^(audio[\\/])+/i, ''); // Remove all leading 'audio/' or 'audio\'
          normalizedPath = path.join('audio', normalizedPath); // Add single 'audio/' prefix
          resolvedAudioPath = path.join(getUploadDir(), normalizedPath);
          console.log(`[AutoSync] Resolved to absolute: ${resolvedAudioPath}`);
        }
      }
    }

    // If still no audio, try TTS output directory and uploaded audio folder
    if (!resolvedAudioPath) {
      const { getTtsOutputDir } = await import('../config/fileStorage.js');
      const ttsDir = getTtsOutputDir();
      const audioDir = path.join(getUploadDir(), 'audio');
      
      // List all files in audio directory to find any recent uploads for this job
      let uploadedAudioFiles = [];
      try {
        const files = await fs.readdir(audioDir);
        uploadedAudioFiles = files
          .filter(f => f.endsWith('.mp3') || f.endsWith('.wav'))
          .map(f => path.join(audioDir, f));
        console.log(`[AutoSync] Found ${uploadedAudioFiles.length} audio files in upload dir`);
      } catch (e) {
        console.log('[AutoSync] Could not read audio directory');
      }
      
      const possiblePaths = [
        path.join(ttsDir, `combined_audio_${jobId}.mp3`),
        path.join(audioDir, `combined_audio_${jobId}.mp3`),
        path.join(getUploadDir(), 'tts_audio', `combined_audio_${jobId}.mp3`),
        path.join(audioDir, `audio_${jobId}.mp3`),
        // Also check recently uploaded files (sorted by name, most recent first)
        ...uploadedAudioFiles.slice(-5).reverse()
      ];
      
      console.log('[AutoSync] Checking audio locations...');
      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          resolvedAudioPath = p;
          console.log(`[AutoSync] Found audio at: ${p}`);
          break;
        } catch (e) {
          // Not found, try next
        }
      }
    }

    if (!resolvedAudioPath) {
      console.log('[AutoSync] Error: No audio file found');
      return badRequestResponse(res, 'No audio file specified or found for this job. Please generate TTS audio or upload an audio file first.');
    }

    // Verify audio file exists
    try {
      await fs.access(resolvedAudioPath);
      console.log(`[AutoSync] Audio file verified: ${resolvedAudioPath}`);
    } catch (err) {
      console.log(`[AutoSync] Error: Audio file not found at ${resolvedAudioPath}`);
      return badRequestResponse(res, `Audio file not found: ${resolvedAudioPath}`);
    }

    console.log(`[AutoSync] Audio path: ${resolvedAudioPath}`);

    // Check if Aeneas is available
    const aeneasAvailable = await aeneasService.checkAeneasInstalled();
    
    // Get audio duration using ffprobe
    let audioDuration = 300; // Default 5 min
    try {
      const { execSync } = await import('child_process');
      const ffprobeOutput = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${resolvedAudioPath}"`,
        { encoding: 'utf8' }
      );
      audioDuration = parseFloat(ffprobeOutput.trim()) || 300;
      console.log(`[AutoSync] Audio duration: ${audioDuration}s`);
    } catch (e) {
      console.log('[AutoSync] Could not get audio duration, using default 300s');
    }

    // Process using Aeneas (full file) or Linear Spread (page by page)
    let allSentences = [];
    let allWords = [];
    
    if (aeneasAvailable) {
      // AENEAS MODE: Process full audio with combined XHTML
      console.log('[AutoSync] Using Aeneas forced alignment...');
      
      // Combine all XHTML with page markers preserved in IDs
      const combinedXhtml = sections.map((s, idx) => {
        const pageXhtml = s.xhtml || s.content || '';
        return pageXhtml;
      }).join('\n');
      
      try {
        // CRITICAL FIX: Get list of excluded IDs from existing syncs where shouldRead=false
        // This prevents syncing unspoken content (TOC, headers, etc.)
        const existingSyncs = await AudioSyncModel.findByJobId(jobId);
        const excludedIds = existingSyncs
          .filter(s => s.notes && s.notes.includes('shouldRead: false'))
          .map(s => s.block_id)
          .filter(Boolean);
        
        if (excludedIds.length > 0) {
          console.log(`[AutoSync] Excluding ${excludedIds.length} unspoken elements from sync:`, excludedIds.slice(0, 5));
        }
        
        const aeneasResult = await aeneasService.autoSync(resolvedAudioPath, combinedXhtml, {
          language,
          granularity,
          propagateWords,
          jobId,
          excludeIds: excludedIds // Pass excluded IDs to prevent sync drift
        });
        
        console.log(`[AutoSync] Aeneas returned ${aeneasResult.sentences.length} sentences, ${aeneasResult.words.length} words`);
        
        // Map results back to pages using the page number in IDs (page1_p1_s1)
        aeneasResult.sentences.forEach(s => {
          const newMatch = s.id.match(/^page(\d+)_/);
          const legacyMatch = s.id.match(/^p(\d+)/);
          s.pageNumber = newMatch ? parseInt(newMatch[1]) : 
                        legacyMatch ? parseInt(legacyMatch[1]) : 1;
          allSentences.push(s);
        });
        
        aeneasResult.words.forEach(w => {
          const newMatch = w.id.match(/^page(\d+)_/);
          const legacyMatch = w.id.match(/^p(\d+)/);
          w.pageNumber = newMatch ? parseInt(newMatch[1]) : 
                        legacyMatch ? parseInt(legacyMatch[1]) : 1;
          allWords.push(w);
        });
        
      } catch (aeneasError) {
        console.error('[AutoSync] Aeneas failed, falling back to Linear Spread:', aeneasError.message);
        // Fall through to Linear Spread below
        allSentences = [];
        allWords = [];
      }
    }
    
    // LINEAR SPREAD MODE: Process page by page (fallback or if Aeneas not available)
    if (allSentences.length === 0) {
      console.log('[AutoSync] Using Linear Spread (page by page)...');
      
      const pageCharCounts = sections.map(s => (s.xhtml || s.content || '').length);
      const totalChars = pageCharCounts.reduce((sum, c) => sum + c, 0);
      
      let currentTime = 0;
      
      for (let pageIdx = 0; pageIdx < sections.length; pageIdx++) {
        const section = sections[pageIdx];
        const pageNumber = pageIdx + 1;
        const pageXhtml = section.xhtml || section.content || '';
        
        // Calculate this page's duration share
        const pageCharRatio = totalChars > 0 ? pageCharCounts[pageIdx] / totalChars : 0;
        const pageDuration = audioDuration * pageCharRatio;
        const pageStartTime = currentTime;
        const pageEndTime = currentTime + pageDuration;
        
        console.log(`[AutoSync] Page ${pageNumber}: ${pageStartTime.toFixed(2)}s - ${pageEndTime.toFixed(2)}s (${pageDuration.toFixed(2)}s)`);
        
        // CRITICAL FIX: Get excluded IDs for this page to prevent syncing unspoken content
        const existingSyncs = await AudioSyncModel.findByJobId(jobId);
        const excludedIds = existingSyncs
          .filter(s => {
            // Check if this sync belongs to this page and is marked as excluded
            const syncPageNum = s.page_number || 1;
            return syncPageNum === pageNumber && 
                   s.notes && 
                   s.notes.includes('shouldRead: false');
          })
          .map(s => s.block_id)
          .filter(Boolean);
        
        if (excludedIds.length > 0) {
          console.log(`[AutoSync] Page ${pageNumber}: Excluding ${excludedIds.length} unspoken elements`);
        }
        
        const pageResult = aeneasService.linearSpreadSync(pageXhtml, pageStartTime, pageEndTime, {
          granularity,
          propagateWords,
          excludeIds: excludedIds // Pass excluded IDs to prevent sync drift
        });
        
        // Add page number to each result
        pageResult.sentences.forEach(s => {
          s.pageNumber = pageNumber;
          allSentences.push(s);
        });
        
        pageResult.words.forEach(w => {
          w.pageNumber = pageNumber;
          allWords.push(w);
        });
        
        currentTime = pageEndTime;
      }
    }
    
    console.log(`[AutoSync] Total: ${allSentences.length} sentences, ${allWords.length} words`);
    
    const syncResult = {
      sentences: allSentences,
      words: allWords,
      stats: {
        totalSentences: allSentences.length,
        totalWords: allWords.length,
        totalDuration: audioDuration
      }
    };

    // Save results to database
    const savedSegments = [];
    const allResults = [...syncResult.sentences, ...syncResult.words];

    for (const item of allResults) {
      const pageNumber = item.pageNumber || 1;

      const syncData = {
        pdfDocumentId: job.pdf_document_id,
        conversionJobId: jobId,
        blockId: item.id,
        pageNumber: pageNumber,
        startTime: item.startTime,
        endTime: item.endTime,
        audioFilePath: resolvedAudioPath.includes('uploads') 
          ? path.relative(getUploadDir(), resolvedAudioPath)
          : resolvedAudioPath,
        notes: `Auto-sync (${aeneasAvailable ? 'Aeneas' : 'Linear Spread'}). Type: ${item.type}`,
        customText: item.text || '',
        isCustomSegment: true
      };

      // Check for existing sync - MUST match BOTH block_id AND page_number
      // Legacy format: same block_id (e.g., p1_s1) can exist on multiple pages
      // New format: block_ids are globally unique (e.g., page1_p1_s1)
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      const existing = existingSyncs.find(s => 
        s.block_id === item.id && s.page_number === pageNumber
      );

      if (existing) {
        await AudioSyncModel.update(existing.id, syncData);
        savedSegments.push({ ...syncData, id: existing.id });
      } else {
        const newSync = await AudioSyncModel.create(syncData);
        savedSegments.push({ ...syncData, id: newSync.id });
      }
    }

    console.log(`[AutoSync] Saved ${savedSegments.length} segments`);

    return successResponse(res, {
      method: aeneasAvailable ? 'aeneas' : 'linear_spread',
      sentences: syncResult.sentences.map(s => ({
        ...s,
        pageNumber: s.pageNumber
      })),
      words: syncResult.words.map(w => ({
        ...w,
        pageNumber: w.pageNumber
      })),
      stats: syncResult.stats,
      savedCount: savedSegments.length,
      pageCount: sections.length
    }, 201);

  } catch (error) {
    console.error('[AutoSync] Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/audio-sync/magic-align - Hybrid Gemini Alignment (Semantic + Aeneas)
router.post('/magic-align', async (req, res) => {
  try {
    const { jobId, audioPath, language = 'eng', granularity = 'sentence' } = req.body;
    
    if (!jobId) {
      return badRequestResponse(res, 'Job ID is required');
    }

    console.log(`[MagicAlign] Starting Magic Sync (Gemini-only timestamps) for job ${jobId}`);
    console.log(`[MagicAlign] Language: ${language}, Granularity: ${granularity}`);

    // Get job info
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }

    // Get XHTML content from EPUB
    let sections;
    try {
      sections = await EpubService.getEpubSections(jobId);
      console.log(`[MagicAlign] Got ${sections?.length || 0} sections`);
    } catch (epubErr) {
      return badRequestResponse(res, `Failed to get EPUB sections: ${epubErr.message}`);
    }
    
    if (!sections || sections.length === 0) {
      return badRequestResponse(res, 'No EPUB sections found for this job');
    }

    // Resolve audio path (same improved logic as auto-sync)
    let resolvedAudioPath = audioPath;
    
    // First, try to get audio path from request body
    if (resolvedAudioPath && !path.isAbsolute(resolvedAudioPath)) {
      resolvedAudioPath = path.join(getUploadDir(), resolvedAudioPath);
    }
    
    // If not provided, check existing syncs in database
    if (!resolvedAudioPath) {
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      if (existingSyncs.length > 0 && existingSyncs[0].audio_file_path) {
        resolvedAudioPath = existingSyncs[0].audio_file_path;
        if (!path.isAbsolute(resolvedAudioPath)) {
          // Normalize path: remove all leading 'audio/' segments, then add one
          let normalizedPath = resolvedAudioPath.replace(/^(audio[\\/])+/i, ''); // Remove all leading 'audio/' or 'audio\'
          normalizedPath = path.join('audio', normalizedPath); // Add single 'audio/' prefix
          resolvedAudioPath = path.join(getUploadDir(), normalizedPath);
        }
        console.log(`[MagicAlign] Found audio path from existing syncs: ${resolvedAudioPath}`);
      }
    }

    // If still no audio, try TTS output directory and uploaded audio folder
    if (!resolvedAudioPath) {
      const { getTtsOutputDir } = await import('../config/fileStorage.js');
      const ttsDir = getTtsOutputDir();
      const audioDir = path.join(getUploadDir(), 'audio');
      
      // List all files in audio directory to find any recent uploads for this job
      let uploadedAudioFiles = [];
      try {
        const files = await fs.readdir(audioDir);
        uploadedAudioFiles = files
          .filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a'))
          .map(f => ({
            path: path.join(audioDir, f),
            name: f,
            time: parseInt(f.split('_')[0]) || 0 // Extract timestamp from filename
          }))
          .sort((a, b) => b.time - a.time); // Most recent first
        console.log(`[MagicAlign] Found ${uploadedAudioFiles.length} audio files in upload dir`);
      } catch (e) {
        console.log('[MagicAlign] Could not read audio directory:', e.message);
      }
      
      const possiblePaths = [
        path.join(ttsDir, `combined_audio_${jobId}.mp3`),
        path.join(audioDir, `combined_audio_${jobId}.mp3`),
        path.join(getUploadDir(), 'tts_audio', `combined_audio_${jobId}.mp3`),
        path.join(audioDir, `audio_${jobId}.mp3`),
        // Also check recently uploaded files (most recent first)
        ...uploadedAudioFiles.slice(0, 5).map(f => f.path)
      ];
      
      console.log(`[MagicAlign] Checking ${possiblePaths.length} possible audio file locations...`);
      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          const stats = await fs.stat(p);
          if (stats.size > 0) {
            resolvedAudioPath = p;
            console.log(`[MagicAlign] Found audio file: ${resolvedAudioPath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
            break;
          }
        } catch (e) {
          // Not found, try next
        }
      }
    }

    if (!resolvedAudioPath) {
      console.error(`[MagicAlign] No audio file found for job ${jobId}`);
      console.error(`[MagicAlign] Checked paths: TTS dir, uploads/audio, uploads/tts_audio`);
      return badRequestResponse(res, 'No audio file found. Please generate TTS audio or upload an audio file first.');
    }

    // Verify audio file exists and is not empty
    try {
      const stats = await fs.stat(resolvedAudioPath);
      if (stats.size === 0) {
        return badRequestResponse(res, `Audio file is empty: ${resolvedAudioPath}`);
      }
      console.log(`[MagicAlign] Audio file verified: ${resolvedAudioPath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    } catch (err) {
      console.error(`[MagicAlign] Audio file not accessible: ${resolvedAudioPath} - ${err.message}`);
      return badRequestResponse(res, `Audio file not found or not accessible: ${resolvedAudioPath}`);
    }

    // STEP 1: Get audio duration (for Gemini to estimate timestamps)
    console.log('[MagicAlign] Phase 1: Getting audio duration...');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    let audioDuration = 0;
    try {
      // Use ffprobe to get audio duration
      const { stdout } = await execAsync(
        `ffprobe -i "${resolvedAudioPath}" -show_entries format=duration -v quiet -of csv="p=0"`
      );
      audioDuration = parseFloat(stdout.trim()) || 0;
      console.log(`[MagicAlign] Audio duration: ${audioDuration.toFixed(2)}s`);
    } catch (error) {
      console.warn(`[MagicAlign] Could not get audio duration from ffprobe: ${error.message}`);
      // Fallback: estimate based on file size (rough approximation)
      const stats = await fs.stat(resolvedAudioPath);
      // Rough estimate: 1MB ≈ 1 minute for MP3
      audioDuration = (stats.size / (1024 * 1024)) * 60;
      console.log(`[MagicAlign] Estimated audio duration: ${audioDuration.toFixed(2)}s`);
    }

    // STEP 2: Process XHTML pages one by one with Gemini
    console.log('[MagicAlign] Phase 2: Processing XHTML pages with Gemini (one by one)...');
    
    const allSyncedBlocks = [];
    const allSkippedBlocks = [];
    
    for (let pageIndex = 0; pageIndex < sections.length; pageIndex++) {
      const section = sections[pageIndex];
      const pageXhtml = section.xhtml || section.content || '';
      const pageNumber = section.pageNumber || (pageIndex + 1);
      
      if (!pageXhtml || pageXhtml.trim().length === 0) {
        console.log(`[MagicAlign] Skipping empty page ${pageNumber}`);
        continue;
      }
      
      console.log(`[MagicAlign] Processing page ${pageNumber} (${pageIndex + 1}/${sections.length})...`);
      
      // Extract book blocks from this page for reference (but send full XHTML to Gemini)
      const { extractTextFragments } = aeneasService;
      const { idMap } = extractTextFragments(pageXhtml, granularity, {
        excludeIds: [],
        excludePatterns: [],
        disableDefaultExclusions: true // Include headers, duplicates, TOC, etc. for better coverage
      });
      
      // Log what we found for debugging
      if (idMap.length > 0) {
        console.log(`[MagicAlign] Page ${pageNumber}: Found ${idMap.length} total elements`);
        const sampleIds = idMap.slice(0, 5).map(m => m.id);
        console.log(`[MagicAlign] Sample IDs: ${sampleIds.join(', ')}`);
      } else {
        console.log(`[MagicAlign] Page ${pageNumber}: No elements found in XHTML (check if XHTML has IDs)`);
      }
      
      const bookBlocks = idMap.map(m => ({ id: m.id, text: m.text }));
      
      if (bookBlocks.length === 0) {
        console.log(`[MagicAlign] No syncable blocks found on page ${pageNumber}`);
        console.log(`[MagicAlign] This might mean the XHTML doesn't have the hierarchical structure yet. Consider regenerating the EPUB.`);
        continue;
      }
      
      console.log(`[MagicAlign] Page ${pageNumber}: ${bookBlocks.length} blocks found in XHTML`);
      
      // Call Gemini with this page's FULL XHTML and FULL audio file
      let alignmentMap;
      try {
        alignmentMap = await GeminiService.reconcileAlignmentFromXhtml(
          pageXhtml,           // Full XHTML content
          audioDuration,        // Total audio duration
          resolvedAudioPath,    // Full audio file path
          granularity          // Granularity level
        );
      } catch (geminiError) {
        console.error(`[MagicAlign] Error processing page ${pageNumber} with Gemini:`, geminiError);
        // If Gemini fails for a page, skip it and continue with other pages
        // Mark all blocks as skipped for this page
        alignmentMap = bookBlocks.map(block => ({
          id: block.id,
          status: 'SKIPPED'
        }));
        console.warn(`[MagicAlign] Page ${pageNumber} failed, marking ${alignmentMap.length} blocks as SKIPPED`);
      }
      
      // Process results
      const synced = alignmentMap.filter(a => a.status === 'SYNCED');
      const skipped = alignmentMap.filter(a => a.status === 'SKIPPED');
      
      allSyncedBlocks.push(...synced);
      allSkippedBlocks.push(...skipped);
      
      console.log(`[MagicAlign] Page ${pageNumber}: ${synced.length} synced, ${skipped.length} skipped`);
    }
    
    console.log(`[MagicAlign] Total: ${allSyncedBlocks.length} synced, ${allSkippedBlocks.length} skipped across ${sections.length} pages`);
    
    // STEP 3: Process results (Phase 3: Final)
    console.log('[MagicAlign] Phase 3: Processing Gemini results...');
    const syncedBlocks = allSyncedBlocks;
    const skippedBlocks = allSkippedBlocks;

    console.log(`[MagicAlign] Gemini marked ${syncedBlocks.length} as SYNCED, ${skippedBlocks.length} as SKIPPED`);

    // Build final results from synced blocks
    const finalResults = {
      sentences: [],
      words: [],
      stats: {
        total: syncedBlocks.length + skippedBlocks.length,
        synced: syncedBlocks.length,
        skipped: skippedBlocks.length
      }
    };

    let geminiTimestampCount = 0;
    let missingTimestampCount = 0;
    
    for (const aligned of syncedBlocks) {
      // Find the original block from all sections
      let block = null;
      for (const section of sections) {
        const { idMap } = aeneasService.extractTextFragments(section.xhtml || section.content || '', granularity, {
          excludeIds: [],
          excludePatterns: []
        });
        block = idMap.find(b => b.id === aligned.id);
        if (block) break;
      }
      
      if (!block) {
        console.warn(`[MagicAlign] Block not found for ID: ${aligned.id}`);
        continue;
      }
      
      // Track "If You Were a Horse" specifically
      const isHorseBlock = block.text.toLowerCase().includes('if you were a horse');
      
      // Use ONLY Gemini's timestamps (semantic understanding handles duplicates better)
      if (aligned.start !== undefined && aligned.end !== undefined) {
        const startTime = Number(aligned.start);
        const endTime = Number(aligned.end);
        
        geminiTimestampCount++;
        
        if (isHorseBlock) {
          console.log(`[MagicAlign] 🐴 "If You Were a Horse" - Using Gemini timestamps:`);
          console.log(`  Block ID: ${aligned.id}`);
          console.log(`  Block text: "${block.text.substring(0, 60)}..."`);
          console.log(`  Gemini timestamps: ${startTime}s - ${endTime}s`);
        }
        
        // Add to results with Gemini timestamps
        finalResults.sentences.push({
          id: aligned.id,
          text: block.text,
          type: 'sentence',
          startTime,
          endTime,
          pageNumber: parseInt(aligned.id.match(/page(\d+)/)?.[1]) || 1
        });
      } else {
        // Gemini didn't provide timestamps - skip this block
        missingTimestampCount++;
        console.warn(`[MagicAlign] No Gemini timestamps for block ${aligned.id}: "${block.text.substring(0, 50)}..."`);
        
        if (isHorseBlock) {
          console.warn(`[MagicAlign] ⚠️ "If You Were a Horse" missing timestamps from Gemini!`);
        }
      }
    }
    
    console.log(`[MagicAlign] Timestamp statistics:`);
    console.log(`  Total synced blocks: ${syncedBlocks.length}`);
    console.log(`  Blocks with Gemini timestamps: ${geminiTimestampCount} (${((geminiTimestampCount / syncedBlocks.length) * 100).toFixed(1)}%)`);
    console.log(`  Blocks missing timestamps: ${missingTimestampCount} (${((missingTimestampCount / syncedBlocks.length) * 100).toFixed(1)}%)`);

    // Save to database
    const savedSegments = [];
    for (const item of [...finalResults.sentences, ...finalResults.words]) {
      // Validate required fields
      if (!item.id || item.startTime === undefined || item.endTime === undefined) {
        console.warn(`[MagicAlign] Skipping item with missing data:`, {
          id: item.id,
          hasStartTime: item.startTime !== undefined,
          hasEndTime: item.endTime !== undefined
        });
        continue;
      }

      const pageNum = item.pageNumber || parseInt(item.id.match(/page(\d+)/)?.[1]) || 1;
      
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      const existing = existingSyncs.find(s => 
        s.block_id === item.id && 
        (s.page_number || 1) === pageNum
      );

      // CRITICAL: AudioSyncModel expects camelCase, not snake_case
      // Ensure all values are defined (use null instead of undefined for optional fields)
      const syncData = {
        pdfDocumentId: job.pdf_document_id || job.pdf_id || null,
        conversionJobId: jobId,
        blockId: item.id || null,
        pageNumber: pageNum,
        startTime: Number(item.startTime) || 0,
        endTime: Number(item.endTime) || 0,
        audioFilePath: resolvedAudioPath || null,
        notes: `Magic Sync (Hybrid Gemini + Aeneas). Type: ${item.type || 'sentence'}`
      };

      if (existing) {
        await AudioSyncModel.update(existing.id, syncData);
        savedSegments.push({ ...syncData, id: existing.id });
      } else {
        const newSync = await AudioSyncModel.create(syncData);
        savedSegments.push(newSync);
      }
    }

    console.log(`[MagicAlign] Saved ${savedSegments.length} segments`);

    return successResponse(res, {
      method: 'gemini_only',
      sentences: finalResults.sentences,
      words: finalResults.words,
      stats: finalResults.stats,
      savedCount: savedSegments.length,
      skippedIds: skippedBlocks.map(b => b.id)
    }, 201);

  } catch (error) {
    console.error('[MagicAlign] Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/audio-sync/batch-auto-sync - Batch process multiple pages
router.post('/batch-auto-sync', async (req, res) => {
  try {
    const { jobId, audioPath, language = 'eng', granularity = 'sentence' } = req.body;
    
    if (!jobId) {
      return badRequestResponse(res, 'Job ID is required');
    }

    console.log(`[BatchAutoSync] Starting batch alignment for job ${jobId}`);

    // Get job info
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }

    // Get all EPUB sections
    const sections = await EpubService.getEpubSections(jobId);
    if (!sections || sections.length === 0) {
      return badRequestResponse(res, 'No EPUB sections found');
    }

    // Build pages array
    const pages = sections.map((section, idx) => ({
      pageNumber: idx + 1,
      xhtmlContent: section.xhtml || section.content || ''
    }));

    // Resolve audio path
    let resolvedAudioPath = audioPath;
    if (!resolvedAudioPath) {
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      if (existingSyncs.length > 0 && existingSyncs[0].audio_file_path) {
        resolvedAudioPath = existingSyncs[0].audio_file_path;
        if (!path.isAbsolute(resolvedAudioPath)) {
          // Normalize path: remove all leading 'audio/' segments, then add one
          let normalizedPath = resolvedAudioPath.replace(/^(audio[\\/])+/i, ''); // Remove all leading 'audio/' or 'audio\'
          normalizedPath = path.join('audio', normalizedPath); // Add single 'audio/' prefix
          resolvedAudioPath = path.join(getUploadDir(), normalizedPath);
        }
      }
    }

    if (!resolvedAudioPath) {
      return badRequestResponse(res, 'No audio file found');
    }

    // Check Aeneas availability
    const aeneasAvailable = await aeneasService.checkAeneasInstalled();

    let batchResult;
    if (aeneasAvailable) {
      console.log('[BatchAutoSync] Using Aeneas batch processing');
      batchResult = await aeneasService.batchAutoSync(resolvedAudioPath, pages, {
        language,
        granularity,
        propagateWords: true,
        jobId
      });
    } else {
      console.log('[BatchAutoSync] Aeneas not available, processing pages sequentially');
      
      // Fallback: Process each page with linear spread
      const pageResults = {};
      let totalDuration = 0;
      
      // Estimate duration per page
      const existingSyncs = await AudioSyncModel.findByJobId(jobId);
      const maxEndTime = existingSyncs.reduce((max, s) => Math.max(max, s.end_time || 0), 0);
      const durationPerPage = (maxEndTime || 300) / pages.length;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const startTime = i * durationPerPage;
        const endTime = (i + 1) * durationPerPage;
        
        const pageSync = aeneasService.linearSpreadSync(
          page.xhtmlContent,
          startTime,
          endTime,
          { granularity, propagateWords: true }
        );

        pageResults[page.pageNumber] = {
          sentences: pageSync.sentences,
          words: pageSync.words
        };
        totalDuration = endTime;
      }

      batchResult = {
        pages: pageResults,
        stats: { totalPages: pages.length, totalDuration }
      };
    }

    // Save all results
    let savedCount = 0;
    for (const [pageNum, pageData] of Object.entries(batchResult.pages)) {
      const allItems = [...(pageData.sentences || []), ...(pageData.words || [])];
      
      for (const item of allItems) {
        const syncData = {
          pdfDocumentId: job.pdf_document_id,
          conversionJobId: jobId,
          blockId: item.id,
          pageNumber: parseInt(pageNum),
          startTime: item.startTime,
          endTime: item.endTime,
          audioFilePath: resolvedAudioPath.includes('uploads')
            ? path.relative(getUploadDir(), resolvedAudioPath)
            : resolvedAudioPath,
          notes: `Batch auto-sync. Page: ${pageNum}. Type: ${item.type}`,
          customText: item.text || '',
          isCustomSegment: true
        };

        const existingSyncs = await AudioSyncModel.findByJobId(jobId);
        const existing = existingSyncs.find(s => s.block_id === item.id);

        if (existing) {
          await AudioSyncModel.update(existing.id, syncData);
        } else {
          await AudioSyncModel.create(syncData);
        }
        savedCount++;
      }
    }

    console.log(`[BatchAutoSync] Processed ${pages.length} pages, saved ${savedCount} segments`);

    return successResponse(res, {
      method: aeneasAvailable ? 'aeneas_batch' : 'linear_spread_batch',
      pages: batchResult.pages,
      stats: {
        ...batchResult.stats,
        savedCount
      }
    }, 201);

  } catch (error) {
    console.error('[BatchAutoSync] Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/audio-sync/linear-spread - Manual linear spread sync
router.post('/linear-spread', async (req, res) => {
  try {
    const { jobId, startTime, endTime, granularity = 'sentence', propagateWords = true } = req.body;
    
    if (!jobId || startTime === undefined || endTime === undefined) {
      return badRequestResponse(res, 'Job ID, start time, and end time are required');
    }

    console.log(`[LinearSpread] Spreading sync for job ${jobId}: ${startTime}s - ${endTime}s`);

    // Get XHTML content
    const sections = await EpubService.getEpubSections(jobId);
    if (!sections || sections.length === 0) {
      return badRequestResponse(res, 'No EPUB sections found');
    }

    const combinedXhtml = sections.map(s => s.xhtml || s.content || '').join('\n');

    // Perform linear spread
    const syncResult = aeneasService.linearSpreadSync(combinedXhtml, startTime, endTime, {
      granularity,
      propagateWords
    });

    return successResponse(res, {
      method: 'linear_spread',
      sentences: syncResult.sentences,
      words: syncResult.words,
      stats: syncResult.stats
    });

  } catch (error) {
    console.error('[LinearSpread] Error:', error);
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

    // Resolve audio path - it could be relative to uploads dir or absolute
    let filePath = sync.audio_file_path;

    if (!path.isAbsolute(filePath)) {
      // Normalize path: remove all leading 'audio/' segments, then add one
      let normalizedPath = filePath.replace(/^(audio[\\/])+/i, ''); // Remove all leading 'audio/' or 'audio\'
      normalizedPath = path.join('audio', normalizedPath); // Add single 'audio/' prefix
      filePath = path.join(getUploadDir(), normalizedPath);
    }
    
    console.log(`[AudioSync] Serving audio file: ${filePath}`);

    try {
      await fs.access(filePath);
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.sendFile(filePath);
    } catch (fileError) {
      console.error(`[AudioSync] Audio file not found: ${filePath}`);
      return notFoundResponse(res, 'Audio file not found on server');
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

export default router;

