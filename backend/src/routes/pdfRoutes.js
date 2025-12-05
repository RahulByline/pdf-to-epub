import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PdfService } from '../services/pdfService.js';
import { successResponse, errorResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';
import { getUploadDir, ensureDirectories } from '../config/fileStorage.js';
import fs from 'fs/promises';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800') // 50MB default
  }
});

// Initialize directories
ensureDirectories();

// POST /api/pdfs/upload - Upload PDF (with optional audio file)
router.post('/upload', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'audioFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.file || req.files.file.length === 0) {
      return badRequestResponse(res, 'PDF file is required');
    }

    const file = req.files.file[0];
    const audioFile = req.files.audioFile && req.files.audioFile.length > 0 
      ? req.files.audioFile[0] 
      : null;

    // Check if ZIP file
    const isZip = file.mimetype === 'application/zip' || 
                  file.mimetype === 'application/x-zip-compressed' ||
                  file.originalname.toLowerCase().endsWith('.zip');

    if (isZip) {
      // Handle ZIP file
      const uploadedPdfs = await PdfService.extractAndUploadPdfsFromZip(file);
      return successResponse(res, {
        totalUploaded: uploadedPdfs.length,
        totalFailed: 0,
        successfulUploads: uploadedPdfs,
        errors: []
      }, 201);
    } else {
      // Handle single PDF
      const response = await PdfService.uploadAndAnalyzePdf(file, audioFile);
      return successResponse(res, response, 201);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/pdfs/upload/bulk - Bulk upload PDFs
router.post('/upload/bulk', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return badRequestResponse(res, 'At least one file is required');
    }

    const successfulUploads = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const isZip = file.mimetype === 'application/zip' || 
                      file.mimetype === 'application/x-zip-compressed' ||
                      file.originalname.toLowerCase().endsWith('.zip');

        if (isZip) {
          const zipResults = await PdfService.extractAndUploadPdfsFromZip(file);
          successfulUploads.push(...zipResults);
        } else {
          const response = await PdfService.uploadAndAnalyzePdf(file);
          successfulUploads.push(response);
        }
      } catch (error) {
        errors.push({
          fileName: file.originalname,
          error: error.message
        });
      }
    }

    return successResponse(res, {
      totalUploaded: successfulUploads.length,
      totalFailed: errors.length,
      successfulUploads,
      errors
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs - Get all PDFs
router.get('/', async (req, res) => {
  try {
    const pdfs = await PdfService.getAllPdfs();
    return successResponse(res, pdfs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/grouped - Get PDFs grouped by ZIP
router.get('/grouped', async (req, res) => {
  try {
    const grouped = await PdfService.getPdfsGroupedByZip();
    return successResponse(res, grouped);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id/view - View PDF inline (for display in iframe)
router.get('/:id/view', async (req, res) => {
  try {
    const { filePath, originalFileName } = await PdfService.downloadPdf(parseInt(req.params.id));
    
    // Set headers for inline viewing
    res.setHeader('Content-Disposition', `inline; filename="${originalFileName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Support range requests for better PDF viewing
    const range = req.headers.range;
    const fileBuffer = await fs.readFile(filePath);
    const fileSize = fileBuffer.length;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const chunk = fileBuffer.slice(start, end + 1);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'application/pdf'
      });
      return res.end(chunk);
    } else {
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Accept-Ranges', 'bytes');
      return res.send(fileBuffer);
    }
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id/download - Download PDF (forces download)
router.get('/:id/download', async (req, res) => {
  try {
    const { filePath, originalFileName } = await PdfService.downloadPdf(parseInt(req.params.id));
    
    res.setHeader('Content-Disposition', `attachment; filename="${originalFileName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    const fileBuffer = await fs.readFile(filePath);
    return res.send(fileBuffer);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id/thumbnail - Get PDF thumbnail (first page preview)
router.get('/:id/thumbnail', async (req, res) => {
  try {
    const pdf = await PdfService.getPdfDocument(parseInt(req.params.id));
    
    // For now, return a placeholder image
    // In production, this would generate an actual thumbnail from the first page of the PDF
    // using libraries like pdf-lib, pdf2pic, or similar
    
    // Create a simple SVG placeholder representing a PDF document
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="600" fill="#ffffff" stroke="#e0e0e0" stroke-width="2"/>
  <rect x="20" y="20" width="360" height="80" fill="#e3f2fd"/>
  <rect x="20" y="120" width="360" height="20" fill="#f5f5f5"/>
  <rect x="20" y="160" width="280" height="20" fill="#f5f5f5"/>
  <rect x="20" y="200" width="320" height="20" fill="#f5f5f5"/>
  <rect x="20" y="240" width="240" height="20" fill="#f5f5f5"/>
  <rect x="20" y="280" width="360" height="300" fill="#fafafa" stroke="#e0e0e0" stroke-width="1"/>
  <text x="200" y="60" text-anchor="middle" font-family="Arial" font-size="24" fill="#1976d2">PDF Preview</text>
  <text x="200" y="320" text-anchor="middle" font-family="Arial" font-size="16" fill="#757575">${pdf.originalFileName}</text>
</svg>`;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(svg);
  } catch (error) {
    // Return a simple error placeholder if PDF not found
    const errorSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="600" fill="#f5f5f5" stroke="#e0e0e0" stroke-width="2"/>
  <text x="200" y="300" text-anchor="middle" font-family="Arial" font-size="18" fill="#999">No Preview Available</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(errorSvg);
  }
});

// GET /api/pdfs/:id/audio - Download audio file
router.get('/:id/audio', async (req, res) => {
  try {
    const { filePath, fileName } = await PdfService.downloadAudio(parseInt(req.params.id));
    
    const range = req.headers.range;
    const fileBuffer = await fs.readFile(filePath);
    const fileSize = fileBuffer.length;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const chunk = fileBuffer.slice(start, end + 1);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg'
      });
      return res.end(chunk);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', fileSize);
      return res.send(fileBuffer);
    }
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id - Get PDF by ID (must come after specific routes)
router.get('/:id', async (req, res) => {
  try {
    const pdf = await PdfService.getPdfDocument(parseInt(req.params.id));
    return successResponse(res, pdf);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/pdfs/:id - Delete PDF
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log('DELETE /api/pdfs/:id - Received request to delete PDF with id:', id);
    
    if (isNaN(id)) {
      console.error('Invalid PDF ID provided:', req.params.id);
      return badRequestResponse(res, 'Invalid PDF ID');
    }
    
    await PdfService.deletePdfDocument(id);
    console.log('✓ Successfully processed deletion request for PDF id:', id);
    return res.status(204).send();
  } catch (error) {
    console.error('✗ Error in DELETE /api/pdfs/:id route:', {
      message: error.message,
      stack: error.stack,
      params: req.params
    });
    
    if (error.message && error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    
    // Return detailed error in development, generic in production
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error.message || 'Failed to delete PDF'
      : 'Failed to delete PDF. Please check server logs for details.';
    
    return errorResponse(res, errorMessage, 500);
  }
});

export default router;

