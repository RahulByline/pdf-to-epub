import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { getEpubOutputDir, getHtmlIntermediateDir } from '../config/fileStorage.js';
import { TtsService } from '../services/TtsService.js';
import { mapTimingsToBlocks } from '../helpers/mapTimingsToBlocks.js';

/**
 * Generate stable block ID based on content and position
 */
function generateStableBlockId(text, x, y, pageNumber) {
  const content = `${pageNumber}_${text}_${x.toFixed(2)}_${y.toFixed(2)}`;
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `block_${hash.substring(0, 12)}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for audio file uploads
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max for audio files
  },
  fileFilter: (req, file, cb) => {
    // Accept only audio files
    if (file.mimetype.startsWith('audio/') || 
        file.originalname.toLowerCase().endsWith('.mp3') ||
        file.originalname.toLowerCase().endsWith('.wav') ||
        file.originalname.toLowerCase().endsWith('.m4a')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed (MP3, WAV, M4A)'));
    }
  }
});

/**
 * Sanitize filename to prevent path traversal
 */
function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '');
}

/**
 * Get job output base directory
 */
function getJobOutputBase() {
  return getEpubOutputDir();
}

/**
 * GET /api/jobs/:jobId/pages/count
 * Get total number of pages for a job
 */
router.get('/:jobId/pages/count', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);

    if (isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid jobId' });
    }

    const jobOutputBase = getJobOutputBase();
    const jobDir = path.join(jobOutputBase, `job_${jobId}`);
    
    // Check if job directory exists
    try {
      await fs.access(jobDir);
    } catch {
      return res.status(404).json({ error: `Job ${jobId} not found` });
    }

    // Load text data JSON to get totalPages
    const textDataPath = path.join(jobDir, `text_data_${jobId}.json`);
    let totalPages = 0;
    
    try {
      const textDataContent = await fs.readFile(textDataPath, 'utf8');
      const textData = JSON.parse(textDataContent);
      totalPages = textData.totalPages || textData.pages?.length || 0;
    } catch (error) {
      // Try alternative location: html_intermediate
      const htmlIntermediateDir = getHtmlIntermediateDir();
      const altTextDataPath = path.join(htmlIntermediateDir, `job_${jobId}`, `text_data_${jobId}.json`);
      try {
        const textDataContent = await fs.readFile(altTextDataPath, 'utf8');
        const textData = JSON.parse(textDataContent);
        totalPages = textData.totalPages || textData.pages?.length || 0;
      } catch (altError) {
        // If text data not found, try counting image files
        const imagesDir = path.join(jobDir, 'assets', 'images');
        try {
          const files = await fs.readdir(imagesDir);
          const pageImages = files.filter(f => f.startsWith('page_') && f.endsWith('_render.png'));
          totalPages = pageImages.length;
        } catch {
          // Return 0 if we can't determine
          return res.json({ jobId, totalPages: 0 });
        }
      }
    }

    res.json({ jobId, totalPages });

  } catch (error) {
    console.error(`Error getting page count:`, error);
    res.status(500).json({ error: error.message || 'Failed to get page count' });
  }
});

/**
 * GET /api/jobs/:jobId/page/:pageNumber/data
 * Retrieve editable text block data for a specific page
 */
router.get('/:jobId/page/:pageNumber/data', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);

    if (isNaN(jobId) || isNaN(pageNumber)) {
      return res.status(400).json({ error: 'Invalid jobId or pageNumber' });
    }

    const jobOutputBase = getJobOutputBase();
    const jobDir = path.join(jobOutputBase, `job_${jobId}`);
    
    // Check if job directory exists
    try {
      await fs.access(jobDir);
    } catch {
      return res.status(404).json({ error: `Job ${jobId} not found` });
    }

    // 1. Load text data JSON
    const textDataPath = path.join(jobDir, `text_data_${jobId}.json`);
    let textData = null;
    
    try {
      const textDataContent = await fs.readFile(textDataPath, 'utf8');
      textData = JSON.parse(textDataContent);
    } catch (error) {
      // Try alternative location: html_intermediate
      const htmlIntermediateDir = getHtmlIntermediateDir();
      const altTextDataPath = path.join(htmlIntermediateDir, `job_${jobId}`, `text_data_${jobId}.json`);
      try {
        const textDataContent = await fs.readFile(altTextDataPath, 'utf8');
        textData = JSON.parse(textDataContent);
      } catch (altError) {
        console.warn(`[Job ${jobId}] Text data not found at ${textDataPath} or ${altTextDataPath}`);
        // Return empty data structure - UI can still work with manual entry
        return res.json({
          pageNumber,
          imagePath: `/api/jobs/${jobId}/assets/images/page_${pageNumber}_render.png`,
          audioPath: null,
          textBlocks: []
        });
      }
    }

    // 2. Validate page number
    const totalPages = textData.totalPages || textData.pages?.length || 0;
    if (pageNumber < 1 || (totalPages > 0 && pageNumber > totalPages)) {
      return res.status(400).json({ 
        error: `Invalid page number: ${pageNumber}. Valid range: 1-${totalPages || 'unknown'}` 
      });
    }

    // 3. Filter blocks for current page
    const page = textData.pages?.find(p => p.pageNumber === pageNumber);
    
    // Get page dimensions for coordinate normalization
    const pageWidthPoints = page?.width || textData.metadata?.width || 612;
    const pageHeightPoints = page?.height || textData.metadata?.height || 792;
    
    // Get rendered image dimensions (300 DPI)
    const dpi = 300;
    const scale = dpi / 72;
    const renderedWidth = Math.ceil(pageWidthPoints * scale);
    const renderedHeight = Math.ceil(pageHeightPoints * scale);

    // 4. Handle case where page not found in text data
    if (!page) {
      // Page not found in text data, but might exist as image
      return res.json({
        pageNumber,
        imagePath: `/api/jobs/${jobId}/assets/images/page_${pageNumber}_render.png`,
        audioPath: null,
        textBlocks: [],
        imageDimensions: {
          width: renderedWidth,
          height: renderedHeight,
          pageWidthPoints,
          pageHeightPoints
        }
      });
    }

    let textBlocks = (page.textBlocks || []).map(block => {
      const bbox = block.boundingBox || {};
      
      // Normalize coordinates to 0-1 range based on rendered image dimensions
      let x = bbox.x || 0;
      let y = bbox.y || 0;
      let w = bbox.width || 0;
      let h = bbox.height || 0;
      
      // If coordinates are in PDF points, convert to normalized (0-1) based on rendered dimensions
      if (x > 1 || y > 1 || w > 1 || h > 1) {
        x = x / renderedWidth;
        y = y / renderedHeight;
        w = w / renderedWidth;
        h = h / renderedHeight;
      }
      
      // Generate stable ID if not present or not stable
      const blockText = block.text || '';
      let blockId = block.id;
      if (!blockId || !blockId.startsWith('block_') || blockId.length < 20) {
        blockId = generateStableBlockId(blockText, bbox.x || 0, bbox.y || 0, pageNumber);
      }
      
      return {
        id: blockId,
        text: blockText,
        x: x,
        y: y,
        w: w,
        h: h,
        clipBegin: null,
        clipEnd: null,
        fontSize: block.fontSize || 12,
        fontName: block.fontName || 'Arial',
        textColor: block.textColor || '#000000',
        textAlign: block.textAlign || 'left'
      };
    });

    // 3. Load editorial sync data if exists
    const editorialSyncDir = path.join(jobDir, 'editorial_syncs');
    const editorialSyncPath = path.join(editorialSyncDir, `manual_page_syncs_${pageNumber}.json`);
    
    try {
      const syncContent = await fs.readFile(editorialSyncPath, 'utf8');
      const syncData = JSON.parse(syncContent);
      
      // Merge clipBegin/clipEnd into matching blocks
      syncData.forEach(sync => {
        const block = textBlocks.find(b => b.id === sync.id);
        if (block) {
          block.clipBegin = sync.clipBegin;
          block.clipEnd = sync.clipEnd;
        }
      });
    } catch (error) {
      // No editorial sync file - that's OK
    }

    // 4. Determine audio file path
    let audioPath = null;
    const audioDir = path.join(jobDir, 'assets', 'audio');
    
    // Check for human audio first
    const humanAudioPath = path.join(audioDir, `page_${pageNumber}_human.mp3`);
    try {
      await fs.access(humanAudioPath);
      audioPath = `/api/jobs/${jobId}/assets/audio/page_${pageNumber}_human.mp3`;
    } catch {
      // Check for TTS audio
      const ttsAudioPath = path.join(audioDir, `page_${pageNumber}_tts.mp3`);
      try {
        await fs.access(ttsAudioPath);
        audioPath = `/api/jobs/${jobId}/assets/audio/page_${pageNumber}_tts.mp3`;
      } catch {
        // No audio available
        audioPath = null;
      }
    }

    // 5. Return response with image dimensions for coordinate conversion
    res.json({
      pageNumber,
      imagePath: `/api/jobs/${jobId}/assets/images/page_${pageNumber}_render.png`,
      audioPath,
      textBlocks,
      imageDimensions: {
        width: renderedWidth,
        height: renderedHeight,
        pageWidthPoints,
        pageHeightPoints
      }
    });

  } catch (error) {
    console.error(`Error fetching page data:`, error);
    res.status(500).json({ error: error.message || 'Failed to fetch page data' });
  }
});

/**
 * GET /api/jobs/:jobId/assets/:assetType/:fileName
 * Serve static job files (images/audio) with path traversal protection
 */
router.get('/:jobId/assets/:assetType/:fileName', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const assetType = req.params.assetType; // 'images' or 'audio'
    const fileName = sanitizeFileName(req.params.fileName);

    if (isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid jobId' });
    }

    if (assetType !== 'images' && assetType !== 'audio') {
      return res.status(400).json({ error: 'Invalid asset type. Must be "images" or "audio"' });
    }

    const jobOutputBase = getJobOutputBase();
    const filePath = path.join(jobOutputBase, `job_${jobId}`, 'assets', assetType, fileName);

    // Security: Ensure file is within job directory (prevent path traversal)
    const resolvedPath = path.resolve(filePath);
    const jobDir = path.resolve(jobOutputBase, `job_${jobId}`);
    
    if (!resolvedPath.startsWith(jobDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      // Try alternative location: html_intermediate for images
      if (assetType === 'images') {
        const htmlIntermediateDir = getHtmlIntermediateDir();
        const altImagePath = path.join(htmlIntermediateDir, `job_${jobId}`, fileName);
        try {
          await fs.access(altImagePath);
          return res.sendFile(path.resolve(altImagePath));
        } catch {
          return res.status(404).json({ error: 'File not found' });
        }
      }
      return res.status(404).json({ error: 'File not found' });
    }

    // Determine content type
    let contentType = 'application/octet-stream';
    if (fileName.endsWith('.png')) {
      contentType = 'image/png';
    } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (fileName.endsWith('.mp3')) {
      contentType = 'audio/mpeg';
    } else if (fileName.endsWith('.wav')) {
      contentType = 'audio/wav';
    }

    res.setHeader('Content-Type', contentType);
    res.sendFile(path.resolve(filePath));

  } catch (error) {
    console.error(`Error serving asset:`, error);
    res.status(500).json({ error: error.message || 'Failed to serve asset' });
  }
});

/**
 * Validate sync data
 */
function validateSyncData(syncs, audioDuration) {
  const errors = [];
  const warnings = [];
  
  if (!syncs || syncs.length === 0) {
    return { errors: [], warnings: [] };
  }

  // Sort by clipBegin
  const sortedSyncs = [...syncs].sort((a, b) => a.clipBegin - b.clipBegin);

  sortedSyncs.forEach((sync, index) => {
    // Validate required fields
    if (!sync.id || typeof sync.clipBegin !== 'number' || typeof sync.clipEnd !== 'number') {
      errors.push({
        syncId: sync.id,
        type: 'missing_fields',
        message: 'Each sync must have: id, clipBegin (number), clipEnd (number)'
      });
      return;
    }

    // Check clipBegin < clipEnd
    if (sync.clipEnd <= sync.clipBegin) {
      errors.push({
        syncId: sync.id,
        type: 'invalid_range',
        message: `clipBegin (${sync.clipBegin}) must be less than clipEnd (${sync.clipEnd})`
      });
    }

    // Check clipEnd doesn't exceed audio duration
    if (audioDuration > 0 && sync.clipEnd > audioDuration) {
      errors.push({
        syncId: sync.id,
        type: 'duration_exceeded',
        message: `clipEnd (${sync.clipEnd}) exceeds audio duration (${audioDuration})`
      });
    }

    // Check for overlaps with next block
    if (index < sortedSyncs.length - 1) {
      const nextSync = sortedSyncs[index + 1];
      if (sync.clipEnd > nextSync.clipBegin) {
        warnings.push({
          syncId: sync.id,
          nextSyncId: nextSync.id,
          type: 'overlap',
          message: `Overlap detected: sync ends at ${sync.clipEnd} but next sync starts at ${nextSync.clipBegin}`
        });
      }
    }

    // Check for large gaps
    if (index < sortedSyncs.length - 1) {
      const nextSync = sortedSyncs[index + 1];
      const gap = nextSync.clipBegin - sync.clipEnd;
      if (gap > 0.5) {
        warnings.push({
          syncId: sync.id,
          nextSyncId: nextSync.id,
          type: 'gap',
          message: `Gap of ${gap.toFixed(2)}s detected between syncs`
        });
      }
    }
  });

  return { errors, warnings };
}

/**
 * POST /api/jobs/:jobId/page/:pageNumber/syncs
 * Save editorial sync data
 */
router.post('/:jobId/page/:pageNumber/syncs', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    const syncs = req.body;

    if (isNaN(jobId) || isNaN(pageNumber)) {
      return res.status(400).json({ error: 'Invalid jobId or pageNumber' });
    }

    if (!Array.isArray(syncs)) {
      return res.status(400).json({ error: 'Request body must be an array of sync objects' });
    }

    // Get audio duration for validation
    let audioDuration = 0;
    const jobOutputBase = getJobOutputBase();
    const jobDir = path.join(jobOutputBase, `job_${jobId}`);
    const audioDir = path.join(jobDir, 'assets', 'audio');
    
    // Try to get audio duration
    const humanAudioPath = path.join(audioDir, `page_${pageNumber}_human.mp3`);
    const ttsAudioPath = path.join(audioDir, `page_${pageNumber}_tts.mp3`);
    
    try {
      // Use a simple approach - we can't easily get duration server-side without audio library
      // For now, we'll validate structure and let frontend handle duration validation
      audioDuration = 0; // Will be validated on frontend
    } catch (error) {
      // Audio file not found - duration validation will be skipped
    }

    // Validate sync objects structure
    for (const sync of syncs) {
      if (!sync.id || typeof sync.clipBegin !== 'number' || typeof sync.clipEnd !== 'number') {
        return res.status(400).json({ 
          error: 'Each sync object must have: id, clipBegin (number), clipEnd (number), audioFileName (string)' 
        });
      }
    }

    // Run validation (structure only, duration validation happens on frontend)
    const validation = validateSyncData(syncs, audioDuration);
    
    // Return errors if any critical ones found
    if (validation.errors.length > 0) {
      return res.status(400).json({
        error: 'Sync validation failed',
        validation: validation
      });
    }

    // jobOutputBase and jobDir already declared above (line 468)
    const editorialSyncDir = path.join(jobDir, 'editorial_syncs');
    
    // Ensure directory exists
    await fs.mkdir(editorialSyncDir, { recursive: true });

    // Save sync data
    const syncFilePath = path.join(editorialSyncDir, `manual_page_syncs_${pageNumber}.json`);
    await fs.writeFile(syncFilePath, JSON.stringify(syncs, null, 2), 'utf8');

    console.log(`[Job ${jobId}] Saved editorial syncs for page ${pageNumber}: ${syncs.length} blocks`);

    res.json({ 
      success: true, 
      message: `Saved ${syncs.length} sync entries for page ${pageNumber}`,
      savedPath: syncFilePath,
      validation: validation // Include validation results
    });

  } catch (error) {
    console.error(`Error saving syncs:`, error);
    res.status(500).json({ error: error.message || 'Failed to save sync data' });
  }
});

/**
 * POST /api/jobs/:jobId/page/:pageNumber/tts
 * Generate TTS audio and syncs for a page
 */
router.post('/:jobId/page/:pageNumber/tts', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);

    if (isNaN(jobId) || isNaN(pageNumber)) {
      return res.status(400).json({ error: 'Invalid jobId or pageNumber' });
    }

    // Check if TTS is available (including free gTTS)
    const ttsClient = TtsService.getClient();
    if (!ttsClient && ttsClient !== 'free-tts') {
      return res.status(503).json({ 
        error: 'TTS service not available',
        message: 'TTS not configured. Using free gTTS (no credentials required) or upload human-narrated audio files.',
        requiresCredentials: false
      });
    }

    // Check page restrictions
    try {
      const { TtsConfigService } = await import('../services/ttsConfigService.js');
      const ttsConfig = await TtsConfigService.getActiveConfiguration();
      if (ttsConfig && ttsConfig.pageRestrictions) {
        const shouldProcess = TtsConfigService.shouldProcessPage(pageNumber, ttsConfig.pageRestrictions);
        if (!shouldProcess) {
          return res.status(403).json({ 
            error: 'Page restricted',
            message: `Page ${pageNumber} is excluded from TTS generation based on current TTS configuration.`,
            pageNumber: pageNumber
          });
        }
      }
    } catch (restrictionError) {
      console.warn('[TTS] Error checking page restrictions:', restrictionError.message);
      // Continue if restriction check fails (don't block TTS generation)
    }

    // Load page data
    const jobOutputBase = getJobOutputBase();
    const jobDir = path.join(jobOutputBase, `job_${jobId}`);
    const htmlIntermediateDir = getHtmlIntermediateDir();
    
    // Try to load XHTML directly to extract sentences
    // Try multiple possible paths for XHTML files
    let xhtmlPath = null;
    let xhtmlContent = null;
    let sentences = [];
    let orderedBlocks = [];
    
    // Try different possible XHTML paths
    const possiblePaths = [
      path.join(htmlIntermediateDir, `job_${jobId}_html`, `page_${pageNumber}.xhtml`),
      path.join(htmlIntermediateDir, `job_${jobId}`, `page_${pageNumber}.xhtml`),
      path.join(jobDir, 'OEBPS', `page_${pageNumber}.xhtml`),
      path.join(jobDir, 'html_intermediate', `job_${jobId}_html`, `page_${pageNumber}.xhtml`)
    ];
    
    for (const testPath of possiblePaths) {
      try {
        await fs.access(testPath);
        xhtmlPath = testPath;
        break;
      } catch (e) {
        // Path doesn't exist, try next
        continue;
      }
    }
    
    if (xhtmlPath) {
      try {
        // Try to parse XHTML to extract sentences
        xhtmlContent = await fs.readFile(xhtmlPath, 'utf8');
      const { JSDOM } = await import('jsdom');
      const dom = new JSDOM(xhtmlContent, { contentType: 'text/xml' });
      const doc = dom.window.document;
      
      // Extract all sentence elements (sync-sentence class or elements with _s in ID but not _w)
      const sentenceElements = doc.querySelectorAll('.sync-sentence, [id*="_s"]:not([id*="_w"])');
      
      if (sentenceElements.length > 0) {
        console.log(`[TTS] Found ${sentenceElements.length} sentence elements in XHTML`);
        
        // Extract text from each sentence (combining all words within)
        sentences = Array.from(sentenceElements).map((sentenceEl, index) => {
          const sentenceId = sentenceEl.id || `sentence_${index}`;
          // Get all text content from the sentence (including nested sync-word elements)
          const sentenceText = sentenceEl.textContent || sentenceEl.innerText || '';
          return {
            id: sentenceId,
            text: sentenceText.trim(),
            readingOrder: index
          };
        });
        
        orderedBlocks = sentences;
      }
      } catch (xhtmlError) {
        console.log(`[TTS] Could not parse XHTML, falling back to text data: ${xhtmlError.message}`);
      }
    }
    
    // Fallback to text data if XHTML parsing failed or no sentences found
    if (sentences.length === 0) {
      const textDataPath = path.join(jobDir, `text_data_${jobId}.json`);
      
      let textData = null;
      try {
        const textDataContent = await fs.readFile(textDataPath, 'utf8');
        textData = JSON.parse(textDataContent);
      } catch (error) {
        // Try alternative location
        const altTextDataPath = path.join(htmlIntermediateDir, `job_${jobId}`, `text_data_${jobId}.json`);
        const textDataContent = await fs.readFile(altTextDataPath, 'utf8');
        textData = JSON.parse(textDataContent);
      }

      const page = textData.pages?.find(p => p.pageNumber === pageNumber);
      if (!page || !page.textBlocks || page.textBlocks.length === 0) {
        return res.status(404).json({ error: `No text blocks found for page ${pageNumber}` });
      }

      // Sort blocks by readingOrder
      orderedBlocks = [...page.textBlocks].sort((a, b) => 
        (a.readingOrder || 0) - (b.readingOrder || 0)
      );
    }

    if (orderedBlocks.length === 0) {
      return res.status(400).json({ error: 'No text content to synthesize' });
    }

    // Combine text from sentences/blocks (entire sentences, not individual words)
    // Join with spaces to maintain natural flow
    const pageText = orderedBlocks.map(b => b.text || '').join(' ').trim();
    if (!pageText) {
      return res.status(400).json({ error: 'No text content to synthesize' });
    }

    // Generate TTS audio for the entire page text as one continuous speech
    // This ensures natural sentence flow instead of word-by-word generation
    const audioDir = path.join(jobDir, 'assets', 'audio');
    await fs.mkdir(audioDir, { recursive: true });
    const audioFileName = `page_${pageNumber}_tts.mp3`;
    const audioOutPath = path.join(audioDir, audioFileName);

    console.log(`[TTS] Generating audio for page ${pageNumber} with ${orderedBlocks.length} sentences/blocks`);
    const ttsResult = await TtsService.synthesizePageAudio({ 
      text: pageText, 
      audioOutPath 
    });

    if (!ttsResult.timings || ttsResult.timings.length === 0) {
      return res.status(500).json({ error: 'TTS generation failed or returned no timings' });
    }

    // Map timings to sentence-level blocks instead of word-level
    // Calculate sentence-level timings by grouping words within each sentence
    const syncs = [];
    let wordIndex = 0;
    let cumulativeTime = 0;
    
    for (let i = 0; i < orderedBlocks.length; i++) {
      const block = orderedBlocks[i];
      const blockText = (block.text || '').trim();
      if (!blockText) continue;
      
      // Count words in this sentence/block
      const blockWords = blockText.match(/\S+/g) || [];
      const wordCount = blockWords.length;
      
      if (wordCount === 0) continue;
      
      // Find the timing range for words in this sentence
      const startWordIdx = wordIndex;
      const endWordIdx = Math.min(wordIndex + wordCount - 1, ttsResult.timings.length - 1);
      
      if (startWordIdx >= ttsResult.timings.length) break;
      
      const firstWordTiming = ttsResult.timings[startWordIdx];
      const lastWordTiming = ttsResult.timings[endWordIdx];
      
      // Calculate sentence duration
      const sentenceStart = firstWordTiming.startTimeSec || 0;
      const sentenceEnd = (lastWordTiming.endTimeSec || lastWordTiming.startTimeSec || 0) + 0.1; // Add small tail
      
      // Create sync entry for the entire sentence (using sentence ID, not word IDs)
      syncs.push({
        blockId: block.id || block.blockId || `sentence_${i}`,
        clipBegin: Number(sentenceStart.toFixed(3)),
        clipEnd: Number(sentenceEnd.toFixed(3)),
        audioFileName: audioFileName
      });
      
      wordIndex = endWordIdx + 1;
      cumulativeTime = sentenceEnd;
      
      if (wordIndex >= ttsResult.timings.length) break;
    }

    // Save syncs to editorial_syncs directory
    const editorialSyncDir = path.join(jobDir, 'editorial_syncs');
    await fs.mkdir(editorialSyncDir, { recursive: true });
    const syncFilePath = path.join(editorialSyncDir, `manual_page_syncs_${pageNumber}.json`);
    await fs.writeFile(syncFilePath, JSON.stringify(syncs, null, 2), 'utf8');

    res.json({
      success: true,
      audioPath: `/api/jobs/${jobId}/assets/audio/${audioFileName}`,
      syncs,
      message: `Generated TTS audio and ${syncs.length} sync entries for page ${pageNumber}`
    });

  } catch (error) {
    console.error(`Error generating TTS:`, error);
    res.status(500).json({ error: error.message || 'Failed to generate TTS' });
  }
});

/**
 * POST /api/jobs/:jobId/page/:pageNumber/audio
 * Upload human-narrated audio file for a page
 */
router.post('/:jobId/page/:pageNumber/audio', audioUpload.single('audioFile'), async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);

    if (isNaN(jobId) || isNaN(pageNumber)) {
      return res.status(400).json({ error: 'Invalid jobId or pageNumber' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const jobOutputBase = getJobOutputBase();
    const jobDir = path.join(jobOutputBase, `job_${jobId}`);
    const audioDir = path.join(jobDir, 'assets', 'audio');
    
    // Ensure directory exists
    await fs.mkdir(audioDir, { recursive: true });

    // Save audio file as page_X_human.mp3
    const audioFileName = `page_${pageNumber}_human.mp3`;
    const audioFilePath = path.join(audioDir, audioFileName);

    // Write file to disk
    await fs.writeFile(audioFilePath, req.file.buffer);

    console.log(`[Job ${jobId}] Uploaded human audio for page ${pageNumber}: ${audioFileName} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    res.json({
      success: true,
      message: `Audio file uploaded successfully for page ${pageNumber}`,
      audioPath: `/api/jobs/${jobId}/assets/audio/${audioFileName}`,
      fileName: audioFileName,
      fileSize: req.file.size
    });

  } catch (error) {
    console.error(`Error uploading audio:`, error);
    res.status(500).json({ error: error.message || 'Failed to upload audio file' });
  }
});

export default router;

