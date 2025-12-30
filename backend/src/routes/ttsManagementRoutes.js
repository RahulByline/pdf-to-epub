import express from 'express';
import { successResponse, errorResponse } from '../utils/responseHandler.js';
import { TTSManagementService } from '../services/ttsManagementService.js';

const router = express.Router();

// GET /api/tts-management/config - Get TTS configuration
router.get('/config', async (req, res) => {
  try {
    const config = await TTSManagementService.getConfig();
    return successResponse(res, config);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/tts-management/config - Save TTS configuration
router.post('/config', async (req, res) => {
  try {
    const config = await TTSManagementService.saveConfig(req.body);
    return successResponse(res, config);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts-management/restrictions - Get restrictions
router.get('/restrictions', async (req, res) => {
  try {
    const restrictions = await TTSManagementService.getRestrictions();
    return successResponse(res, restrictions);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/tts-management/restrictions - Save restrictions
router.post('/restrictions', async (req, res) => {
  try {
    const restrictions = await TTSManagementService.saveRestrictions(req.body);
    return successResponse(res, restrictions);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts-management/voices - Get available voices
router.get('/voices', async (req, res) => {
  try {
    const voices = await TTSManagementService.getVoices();
    return successResponse(res, voices);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/tts-management/test - Test TTS generation
router.post('/test', async (req, res) => {
  try {
    const { text, config, restrictions } = req.body;
    const result = await TTSManagementService.testGeneration(text, config, restrictions);
    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/tts-management/generate - Generate TTS for a job
router.post('/generate', async (req, res) => {
  try {
    const { jobId, config, restrictions } = req.body;
    const result = await TTSManagementService.generateForJob(jobId, config, restrictions);
    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts-management/history - Get generation history
router.get('/history', async (req, res) => {
  try {
    const history = await TTSManagementService.getHistory();
    return successResponse(res, history);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts-management/status/:jobId - Get generation status
router.get('/status/:jobId', async (req, res) => {
  try {
    const status = await TTSManagementService.getStatus(parseInt(req.params.jobId));
    return successResponse(res, status);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

export default router;

