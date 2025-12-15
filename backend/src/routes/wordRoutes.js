import express from 'express';
import multer from 'multer';
import path from 'path';
import { WordService } from '../services/wordService.js';
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

// POST /api/words/upload - Upload Word document (with optional audio file)
router.post('/upload', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'audioFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.file || req.files.file.length === 0) {
      return badRequestResponse(res, 'Word file is required');
    }

    const file = req.files.file[0];
    const audioFile = req.files.audioFile && req.files.audioFile.length > 0 
      ? req.files.audioFile[0] 
      : null;

    // Validate file type
    const isDocx = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                   file.originalname.toLowerCase().endsWith('.docx');
    const isDoc = file.mimetype === 'application/msword' ||
                  file.originalname.toLowerCase().endsWith('.doc');

    if (!isDocx && !isDoc) {
      return badRequestResponse(res, 'Only .docx and .doc files are supported');
    }

    // Handle single Word document
    const response = await WordService.uploadAndAnalyzeWord(file, audioFile);
    return successResponse(res, response, 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/words - Get all Word documents
router.get('/', async (req, res) => {
  try {
    const words = await WordService.getAllWords();
    return successResponse(res, words);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/words/:id - Get Word document by ID
router.get('/:id', async (req, res) => {
  try {
    const word = await WordService.getWordDocument(parseInt(req.params.id));
    return successResponse(res, word);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/words/:id/download - Download Word document
router.get('/:id/download', async (req, res) => {
  try {
    const { filePath, originalFileName } = await WordService.downloadWord(parseInt(req.params.id));
    
    res.setHeader('Content-Disposition', `attachment; filename="${originalFileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    
    const fileBuffer = await fs.readFile(filePath);
    return res.send(fileBuffer);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/words/:id - Delete Word document
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log('DELETE /api/words/:id - Received request to delete Word document with id:', id);
    
    if (isNaN(id)) {
      console.error('Invalid Word document ID provided:', req.params.id);
      return badRequestResponse(res, 'Invalid Word document ID');
    }
    
    await WordService.deleteWordDocument(id);
    console.log('✓ Successfully processed deletion request for Word document id:', id);
    return res.status(204).send();
  } catch (error) {
    console.error('✗ Error in DELETE /api/words/:id route:', {
      message: error.message,
      stack: error.stack,
      params: req.params
    });
    
    if (error.message && error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error.message || 'Failed to delete Word document'
      : 'Failed to delete Word document. Please check server logs for details.';
    
    return errorResponse(res, errorMessage, 500);
  }
});

export default router;

