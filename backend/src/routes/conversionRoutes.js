import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { ConversionService } from '../services/conversionService.js';
import { EpubService } from '../services/epubService.js';
import { successResponse, errorResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';

const router = express.Router();

// GET /api/conversions - Get all conversions
router.get('/', async (req, res) => {
  try {
    const jobs = await ConversionService.getAllConversions();
    
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    return successResponse(res, jobs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/start/:pdfDocumentId - Start conversion
router.post('/start/:pdfDocumentId', async (req, res) => {
  try {
    const job = await ConversionService.startConversion(parseInt(req.params.pdfDocumentId));
    return successResponse(res, job, 201);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/start/bulk - Start bulk conversion
router.post('/start/bulk', async (req, res) => {
  try {
    const { pdfIds } = req.body;
    if (!pdfIds || !Array.isArray(pdfIds)) {
      return badRequestResponse(res, 'pdfIds array is required');
    }

    const jobs = [];
    const errors = [];

    for (const pdfId of pdfIds) {
      try {
        const job = await ConversionService.startConversion(pdfId);
        jobs.push(job);
      } catch (error) {
        errors.push({
          pdfId,
          error: error.message
        });
      }
    }

    return successResponse(res, {
      totalStarted: jobs.length,
      totalFailed: errors.length,
      jobs,
      errors
    }, 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/pdf/:pdfDocumentId - Get conversions by PDF
router.get('/pdf/:pdfDocumentId', async (req, res) => {
  try {
    const jobs = await ConversionService.getConversionsByPdf(parseInt(req.params.pdfDocumentId));
    return successResponse(res, jobs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/status/:status - Get conversions by status
router.get('/status/:status', async (req, res) => {
  try {
    const status = req.params.status.toUpperCase();
    const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED', 'CANCELLED'];
    
    if (!validStatuses.includes(status)) {
      return badRequestResponse(res, 'Invalid status');
    }

    const jobs = await ConversionService.getConversionsByStatus(status);
    
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    return successResponse(res, jobs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/review-required - Get jobs requiring review
router.get('/review-required', async (req, res) => {
  try {
    const jobs = await ConversionService.getReviewRequired();
    return successResponse(res, jobs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// PUT /api/conversions/:jobId/review - Mark as reviewed
router.put('/:jobId/review', async (req, res) => {
  try {
    const { reviewedBy } = req.query;
    const job = await ConversionService.updateJobStatus(parseInt(req.params.jobId), {
      requiresReview: false,
      reviewedBy: reviewedBy || 'System',
      reviewedAt: new Date()
    });
    return successResponse(res, job);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/:jobId/stop - Stop conversion
router.post('/:jobId/stop', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    if (job.status !== 'IN_PROGRESS' && job.status !== 'PENDING') {
      return badRequestResponse(res, 'Can only stop IN_PROGRESS or PENDING jobs');
    }

    const updatedJob = await ConversionService.updateJobStatus(parseInt(req.params.jobId), {
      status: 'CANCELLED'
    });
    
    return successResponse(res, updatedJob);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/:jobId/retry - Retry conversion
router.post('/:jobId/retry', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    // Allow retrying FAILED, CANCELLED, or stuck IN_PROGRESS jobs
    // IN_PROGRESS jobs might be stuck if server restarted during conversion
    if (job.status !== 'FAILED' && job.status !== 'CANCELLED' && job.status !== 'IN_PROGRESS') {
      return badRequestResponse(res, 'Can only retry FAILED, CANCELLED, or IN_PROGRESS jobs');
    }

    // If job is IN_PROGRESS, check if it's been stuck for more than 5 minutes
    if (job.status === 'IN_PROGRESS') {
      const updatedAt = new Date(job.updated_at || job.updatedAt);
      const now = new Date();
      const minutesSinceUpdate = (now - updatedAt) / (1000 * 60);
      
      if (minutesSinceUpdate < 5) {
        return badRequestResponse(res, `Job is still in progress (updated ${Math.round(minutesSinceUpdate)} minutes ago). Wait a bit longer or check if conversion is still running.`);
      }
      
      console.log(`[Job ${req.params.jobId}] Retrying stuck IN_PROGRESS job (stuck for ${Math.round(minutesSinceUpdate)} minutes)`);
    }

    const updatedJob = await ConversionService.updateJobStatus(parseInt(req.params.jobId), {
      status: 'PENDING',
      currentStep: 'STEP_0_CLASSIFICATION',
      progressPercentage: 0,
      errorMessage: job.status === 'IN_PROGRESS' ? 'Job was interrupted by server restart' : null
    });

    // Restart conversion
    ConversionService.processConversion(parseInt(req.params.jobId)).catch(error => {
      console.error('Retry conversion error:', error);
    });

    return successResponse(res, updatedJob);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/download - Download EPUB (must come before /:jobId route)
router.get('/:jobId/download', async (req, res) => {
  try {
    console.log('Download request for jobId:', req.params.jobId);
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    if (!job.epubFilePath) {
      console.warn('EPUB file path not available for job:', req.params.jobId);
      return notFoundResponse(res, 'EPUB file not available. Conversion may not be completed yet.');
    }

    console.log('EPUB file path:', job.epubFilePath);
    
    try {
      const exists = await fs.access(job.epubFilePath).then(() => true).catch(() => false);
      if (!exists) {
        console.error('EPUB file does not exist on server:', job.epubFilePath);
        return notFoundResponse(res, 'EPUB file not found on server.');
      }

      const fileName = path.basename(job.epubFilePath);
      const fileBuffer = await fs.readFile(job.epubFilePath);

      console.log('Sending EPUB file:', fileName, 'Size:', fileBuffer.length);
      
      // Set headers for binary file download
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Length', fileBuffer.length.toString());
      res.setHeader('Cache-Control', 'no-cache');
      
      // Use end() instead of send() for binary data to avoid any JSON wrapping
      return res.end(fileBuffer, 'binary');
    } catch (error) {
      console.error('Error reading EPUB file:', error);
      return errorResponse(res, 'Error downloading EPUB: ' + error.message, 500);
    }
  } catch (error) {
    console.error('Error in download route:', error);
    if (error.message && error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message || 'Failed to download EPUB', 500);
  }
});

// POST /api/conversions/:jobId/regenerate - Regenerate EPUB with updated syncs
router.post('/:jobId/regenerate', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const { granularity } = req.body || {}; // Optional: 'word', 'sentence', 'paragraph'
    
    const job = await ConversionService.getConversionJob(jobId);
    
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }
    
    if (job.status !== 'COMPLETED') {
      return badRequestResponse(res, 'Can only regenerate EPUB for completed conversions');
    }
    
    const { playbackSpeed } = req.body || {};
    
    console.log(`[API] Regenerating EPUB for job ${jobId}${granularity ? ` with ${granularity}-level audio` : ''}${playbackSpeed ? ` at ${playbackSpeed}x speed` : ''}`);
    
    // Regenerate EPUB with updated sync files and granularity option
    const result = await ConversionService.regenerateEpub(jobId, { granularity, playbackSpeed });
    return successResponse(res, result);
  } catch (error) {
    console.error('Error regenerating EPUB:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId - Get conversion job (must come after more specific routes)
router.get('/:jobId', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    // Set cache-control headers
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    return successResponse(res, job);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-sections - Get EPUB sections
router.get('/:jobId/epub-sections', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const job = await ConversionService.getConversionJob(jobId);
    
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }

    // Check if EPUB file exists (even if status isn't COMPLETED, the file might exist)
    const { getEpubOutputDir } = await import('../config/fileStorage.js');
    const epubOutputDir = getEpubOutputDir();
    const epubFileName = `converted_${jobId}.epub`;
    const epubFilePath = job.epubFilePath || path.join(epubOutputDir, epubFileName);
    
    // Check if file actually exists
    let epubExists = false;
    try {
      await fs.access(epubFilePath);
      epubExists = true;
    } catch (err) {
      // File doesn't exist at the specified path
      epubExists = false;
    }
    
    if (!epubExists) {
      return badRequestResponse(res, `EPUB file not available. Status: ${job.status || 'UNKNOWN'}. Please ensure the conversion is complete.`);
    }

    const { EpubService } = await import('../services/epubService.js');
    const sections = await EpubService.getEpubSections(jobId);
    return successResponse(res, sections);
  } catch (error) {
    console.error('Error getting EPUB sections:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-text - Get EPUB text content
router.get('/:jobId/epub-text', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const textContent = await EpubService.getEpubTextContent(parseInt(req.params.jobId));
    return successResponse(res, textContent);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-section/:sectionId/xhtml - Get section XHTML
router.get('/:jobId/epub-section/:sectionId/xhtml', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const jobId = parseInt(req.params.jobId);
    const sectionId = req.params.sectionId; // Keep as string, don't parse as int
    
    console.log(`[EPUB Route] Requesting section XHTML for job ${jobId}, sectionId: ${sectionId}`);
    
    const xhtml = await EpubService.getSectionXhtml(jobId, sectionId);
    res.setHeader('Content-Type', 'application/xhtml+xml');
    return res.send(xhtml);
  } catch (error) {
    console.error('[EPUB Route] Error getting section XHTML:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-css - Get EPUB CSS
router.get('/:jobId/epub-css', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const css = await EpubService.getEpubCss(parseInt(req.params.jobId));
    res.setHeader('Content-Type', 'text/css');
    return res.send(css);
  } catch (error) {
    console.error('[EPUB Route] Error getting CSS:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-image/:imageName - Get EPUB image
router.get('/:jobId/epub-image/:imageName', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const imageName = decodeURIComponent(req.params.imageName);
    const imageBuffer = await EpubService.getEpubImage(parseInt(req.params.jobId), imageName);
    
    // Determine content type from file extension
    const ext = path.extname(imageName).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' :
                        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                        ext === '.gif' ? 'image/gif' :
                        ext === '.svg' ? 'image/svg+xml' :
                        'image/png';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    return res.send(imageBuffer);
  } catch (error) {
    console.error('[EPUB Route] Error getting image:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/text-blocks - Get PDF text blocks for audio sync
router.get('/:jobId/text-blocks', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    if (!job.pdfDocumentId) {
      return badRequestResponse(res, 'PDF document not found for this job');
    }

    const { PdfDocumentModel } = await import('../models/PdfDocument.js');
    const pdf = await PdfDocumentModel.findById(job.pdfDocumentId || job.pdf_document_id);
    
    if (!pdf) {
      return notFoundResponse(res, 'PDF document not found');
    }

    // Get file path - handle both camelCase and snake_case
    const pdfFilePath = pdf.file_path || pdf.filePath;
    if (!pdfFilePath) {
      return notFoundResponse(res, 'PDF file path not found in database');
    }

    // Re-extract text blocks from PDF (or get from intermediate_data if stored)
    const { PdfExtractionService } = await import('../services/pdfExtractionService.js');
    const { getUploadDir } = await import('../config/fileStorage.js');
    
    // Resolve PDF file path (same logic as conversionService)
    let resolvedPdfPath = pdfFilePath;
    try {
      await fs.access(resolvedPdfPath);
    } catch (accessError) {
      // Try resolving relative to uploads directory
      const uploadDir = getUploadDir();
      const fileName = path.basename(pdfFilePath);
      const resolvedPath = path.join(uploadDir, fileName);
      try {
        await fs.access(resolvedPath);
        resolvedPdfPath = resolvedPath;
        console.log(`[Text Blocks] Resolved PDF path: ${resolvedPdfPath}`);
      } catch (resolvedError) {
        console.error(`[Text Blocks] PDF file not found at ${pdfFilePath} or ${resolvedPath}`);
        return errorResponse(res, `PDF file not found at ${pdfFilePath} or ${resolvedPath}`, 404);
      }
    }
    
    const textData = await PdfExtractionService.extractText(resolvedPdfPath);
    
    // Format text blocks for frontend with proper coordinate extraction
    // CRITICAL: Convert PDF coordinates (bottom-left origin) to image/HTML coordinates (top-left origin)
    const textBlocks = [];
    textData.pages.forEach((page, pageIndex) => {
      const pageHeight = page.height || 792; // Default page height in points
      (page.textBlocks || []).forEach((block, blockIndex) => {
        // Extract coordinates from boundingBox (primary) or direct properties (fallback)
        const bbox = block.boundingBox || {};
        const x = bbox.x || block.x || 0;
        const yBottom = bbox.y || block.y || 0; // PDF Y from bottom
        const width = bbox.width || block.width || 0;
        const height = bbox.height || block.height || 0;
        
        // Convert Y from bottom-left (PDF) to top-left (HTML/image)
        // Formula: yTop = pageHeight - (yBottom + height)
        const yTop = pageHeight - (yBottom + height);
        
        textBlocks.push({
          id: block.id || `page_${page.pageNumber}_block_${blockIndex}`,
          pageNumber: page.pageNumber,
          text: block.text || '',
          x: x,
          y: yTop, // Converted to top-left origin
          width: width,
          height: height,
          fontSize: block.fontSize || 12,
          fontName: block.fontName || 'Arial',
          // Include full boundingBox for reference (with original PDF coordinates)
          boundingBox: bbox,
          // Include normalized coordinates (0-1 range) for overlay positioning (top-left origin)
          normalizedX: page.width ? x / page.width : 0,
          normalizedY: page.height ? yTop / page.height : 0,
          normalizedWidth: page.width ? width / page.width : 0,
          normalizedHeight: page.height ? height / page.height : 0
        });
      });
    });
    
    return successResponse(res, {
      pages: textData.pages.map(p => ({
        pageNumber: p.pageNumber,
        text: p.text,
        width: p.width || 612, // Default page width in points
        height: p.height || 792, // Default page height in points
        textBlocks: (p.textBlocks || []).map((block, idx) => {
          // Extract coordinates from boundingBox (primary) or direct properties (fallback)
          const bbox = block.boundingBox || {};
          const x = bbox.x || block.x || 0;
          const yBottom = bbox.y || block.y || 0; // PDF Y from bottom
          const width = bbox.width || block.width || 0;
          const height = bbox.height || block.height || 0;
          const pageWidth = p.width || 612;
          const pageHeight = p.height || 792;
          
          // Convert Y from bottom-left (PDF) to top-left (HTML/image)
          // Formula: yTop = pageHeight - (yBottom + height)
          const yTop = pageHeight - (yBottom + height);
          
          return {
            id: block.id || `page_${p.pageNumber}_block_${idx}`,
            pageNumber: p.pageNumber,
            text: block.text || '',
            x: x,
            y: yTop, // Converted to top-left origin
            width: width,
            height: height,
            fontSize: block.fontSize || 12,
            fontName: block.fontName || 'Arial',
            // Include full boundingBox for reference (with original PDF coordinates)
            boundingBox: bbox,
            // Include normalized coordinates (0-1 range) for overlay positioning (top-left origin)
            normalizedX: pageWidth ? x / pageWidth : 0,
            normalizedY: pageHeight ? yTop / pageHeight : 0,
            normalizedWidth: pageWidth ? width / pageWidth : 0,
            normalizedHeight: pageHeight ? height / pageHeight : 0
          };
        })
      }))
    });
  } catch (error) {
    console.error('Error getting text blocks:', error);
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/conversions/:jobId - Delete conversion job
router.delete('/:jobId', async (req, res) => {
  try {
    await ConversionService.deleteConversionJob(parseInt(req.params.jobId));
    return res.status(204).send();
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

export default router;

