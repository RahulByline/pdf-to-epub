import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { ConversionService } from '../services/conversionService.js';
import { EpubService } from '../services/epubService.js';
import { successResponse, errorResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';
import { getHtmlIntermediateDir } from '../config/fileStorage.js';

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

router.get('/check', async (req, res) =>
{
  try{
    const a = 1;
    const b = 2;
    const c = 3;
    const z = a * b + c;
    return successResponse(res, z);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
})

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
      console.log(`[Regenerate] Job ${jobId} status is '${job.status}', not 'COMPLETED'`);
      return badRequestResponse(res, `Can only regenerate EPUB for completed conversions. Current status: ${job.status}`);
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

    // Check job status first - provide appropriate error messages
    if (job.status === 'IN_PROGRESS' || job.status === 'PENDING') {
      return badRequestResponse(res, `Conversion is still in progress (Status: ${job.status}, Step: ${job.currentStep || 'N/A'}, Progress: ${job.progressPercentage || 0}%). Please wait for the conversion to complete before accessing EPUB sections.`);
    }
    
    if (job.status === 'FAILED' || job.status === 'CANCELLED') {
      const errorMsg = job.errorMessage ? ` Error: ${job.errorMessage}` : '';
      return badRequestResponse(res, `Conversion ${job.status.toLowerCase()}.${errorMsg} Please check the conversion status or start a new conversion.`);
    }

    // Let EpubService handle file finding logic (it checks multiple possible locations)
    // This is more robust than checking a single path
    const { EpubService } = await import('../services/epubService.js');
    const { getHtmlIntermediateDir } = await import('../config/fileStorage.js');
    
    try {
      const sections = await EpubService.getEpubSections(jobId);
      return successResponse(res, sections);
    } catch (epubError) {
      // If EPUB file not found, check if we can regenerate it
      console.error(`[EPUB Sections] Error for job ${jobId}:`, epubError.message);
      
      // Check if intermediate HTML files exist (for regeneration suggestion)
      let canRegenerate = false;
      try {
        const htmlIntermediateDir = getHtmlIntermediateDir();
        const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
        await fs.access(jobHtmlDir);
        const files = await fs.readdir(jobHtmlDir);
        canRegenerate = files.some(f => f.endsWith('.html') || f.endsWith('.xhtml'));
      } catch {
        // Intermediate files don't exist
      }
      
      let errorMessage = `EPUB file not available. Status: ${job.status || 'UNKNOWN'}. ${epubError.message}`;
      if (canRegenerate && job.status === 'COMPLETED') {
        errorMessage += ' The EPUB file appears to be missing, but intermediate files exist. You can try regenerating the EPUB using the regenerate endpoint.';
      } else if (job.status === 'COMPLETED') {
        errorMessage += ' The conversion shows as completed, but the EPUB file is missing. You may need to re-run the conversion.';
      } else {
        errorMessage += ' Please ensure the conversion is complete.';
      }
      
      return badRequestResponse(res, errorMessage);
    }
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

// GET /api/conversions/:jobId/xhtml/:pageNumber - Get XHTML file for a specific page
router.get('/:jobId/xhtml/:pageNumber', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    const xhtmlFilePath = path.join(jobHtmlDir, `page_${pageNumber}.xhtml`);
    
    try {
      await fs.access(xhtmlFilePath);
      const xhtmlContent = await fs.readFile(xhtmlFilePath, 'utf8');
      res.setHeader('Content-Type', 'application/xhtml+xml');
      return res.send(xhtmlContent);
    } catch (fileError) {
      return notFoundResponse(res, `XHTML file for page ${pageNumber} not found`);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/images - Get list of extracted images for a job
router.get('/:jobId/images', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobImagesDir = path.join(htmlIntermediateDir, `job_${jobId}_images`);
    
    try {
      await fs.access(jobImagesDir);
      const files = await fs.readdir(jobImagesDir);
      const imageFiles = files
        .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
        .map(f => ({
          fileName: f,
          url: `/api/conversions/${jobId}/images/${f}`
        }));
      
      return successResponse(res, imageFiles);
    } catch (dirError) {
      return successResponse(res, []); // Return empty array if directory doesn't exist
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// OPTIONS /api/conversions/:jobId/images/:fileName - Handle CORS preflight
router.options('/:jobId/images/:fileName', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.status(204).send();
});

// GET /api/conversions/:jobId/images/:fileName - Get a specific image file
router.get('/:jobId/images/:fileName', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const fileName = req.params.fileName;
    
    // Security: prevent directory traversal
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return badRequestResponse(res, 'Invalid file name');
    }
    
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobImagesDir = path.join(htmlIntermediateDir, `job_${jobId}_images`);
    const imagePath = path.join(jobImagesDir, fileName);
    
    try {
      await fs.access(imagePath);
      const imageBuffer = await fs.readFile(imagePath);
      
      // Determine content type
      const ext = path.extname(fileName).toLowerCase();
      let contentType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.webp') contentType = 'image/webp';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for images
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return res.send(imageBuffer);
    } catch (fileError) {
      return notFoundResponse(res, `Image file ${fileName} not found`);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/pages - Get list of all XHTML pages for a job
router.get('/:jobId/pages', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    
    try {
      await fs.access(jobHtmlDir);
      const files = await fs.readdir(jobHtmlDir);
      const xhtmlFiles = files
        .filter(f => f.endsWith('.xhtml'))
        .map(f => {
          const match = f.match(/page_(\d+)\.xhtml/);
          return {
            pageNumber: match ? parseInt(match[1]) : null,
            fileName: f,
            url: `/api/conversions/${jobId}/xhtml/${match ? match[1] : ''}`
          };
        })
        .filter(f => f.pageNumber !== null)
        .sort((a, b) => a.pageNumber - b.pageNumber);
      
      return successResponse(res, xhtmlFiles);
    } catch (dirError) {
      return successResponse(res, []); // Return empty array if directory doesn't exist
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// PUT /api/conversions/:jobId/xhtml/:pageNumber - Save modified XHTML for a page
router.put('/:jobId/xhtml/:pageNumber', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    let { xhtml } = req.body;
    
    if (!xhtml || typeof xhtml !== 'string') {
      return badRequestResponse(res, 'XHTML content is required');
    }
    
    // Check if XHTML has proper document structure
    const hasDoctype = xhtml.trim().startsWith('<!DOCTYPE');
    const hasHtmlTag = xhtml.includes('<html');
    const hasHeadTag = xhtml.includes('<head>');
    const hasBodyTag = xhtml.includes('<body>');
    
    // If missing proper structure, wrap content in proper XHTML document
    if (!hasDoctype || !hasHtmlTag || !hasHeadTag || !hasBodyTag) {
      console.log(`[Save XHTML] Page ${pageNumber} missing document structure, wrapping content...`);
      
      // Extract all CSS from <style> tags (including unclosed ones)
      let cssContent = '';
      let bodyContent = xhtml;
      
      // Extract CSS from properly closed style tags
      const closedStyleMatches = xhtml.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (closedStyleMatches) {
        const extractedCss = closedStyleMatches.map(style => {
          const contentMatch = style.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          return contentMatch ? contentMatch[1] : '';
        }).filter(css => css.trim()).join('\n');
        if (extractedCss) {
          cssContent += extractedCss + '\n';
        }
        // Remove closed style tags from body content
        bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      }
      
      // Extract CSS from unclosed style tags (style tag without closing tag)
      // Look for <style> followed by content but no </style> before next tag or end
      const unclosedStyleMatch = bodyContent.match(/<style[^>]*>([\s\S]*?)(?=<[^/]|$)/i);
      if (unclosedStyleMatch) {
        const unclosedCss = unclosedStyleMatch[1].trim();
        if (unclosedCss) {
          cssContent += unclosedCss + '\n';
        }
        // Remove unclosed style tag from body content
        bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?(?=<[^/]|$)/i, '');
      }
      
      // Remove any wrapper divs that might be present
      bodyContent = bodyContent.replace(/<div[^>]*class=["']xhtml-content-wrapper["'][^>]*>/gi, '');
      bodyContent = bodyContent.replace(/<\/div>\s*$/, '').trim();
      
      // Clean up any remaining style tags that might be in the body
      bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?(?=<[^/]|$)/gi, '');
      
      // Trim CSS content
      cssContent = cssContent.trim();
      
      // Build proper XHTML structure
      xhtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Page ${pageNumber}</title>
${cssContent ? `<style type="text/css">\n${cssContent}\n</style>` : ''}
</head>
<body>
${bodyContent}
</body>
</html>`;
      
      console.log(`[Save XHTML] Wrapped page ${pageNumber} content in proper XHTML structure`);
    }
    
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    
    // Ensure directory exists
    await fs.mkdir(jobHtmlDir, { recursive: true });
    
    const xhtmlFilePath = path.join(jobHtmlDir, `page_${pageNumber}.xhtml`);
    await fs.writeFile(xhtmlFilePath, xhtml, 'utf8');
    
    return successResponse(res, { message: 'XHTML saved successfully', pageNumber });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

export default router;

