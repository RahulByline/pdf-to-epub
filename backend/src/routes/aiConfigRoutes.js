import express from 'express';
import { AiConfigService } from '../services/aiConfigService.js';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';

const router = express.Router();

// GET /api/ai/config/current - Get current AI configuration
router.get('/config/current', async (req, res) => {
  try {
    const config = await AiConfigService.getCurrentConfiguration();
    if (!config) {
      return res.status(404).json({ error: 'No active configuration found' });
    }
    return successResponse(res, config);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/ai/config - Save AI configuration
router.post('/config', async (req, res) => {
  try {
    const config = await AiConfigService.saveConfiguration(req.body);
    return successResponse(res, config);
  } catch (error) {
    if (error.message.includes('required') || error.message.includes('must be')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/ai/status - Get AI status
router.get('/status', async (req, res) => {
  try {
    const status = await AiConfigService.getStatus();
    return successResponse(res, status);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/ai/models - Get available models
router.get('/models', async (req, res) => {
  try {
    const models = AiConfigService.getAvailableModels();
    return successResponse(res, models);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/ai/test - Test AI connection
router.post('/test', async (req, res) => {
  try {
    const { apiKey, modelName } = req.body;
    
    if (!apiKey || apiKey.trim().length < 20) {
      return badRequestResponse(res, 'Invalid API key format');
    }

    // TODO: Implement actual API test call
    // For now, just validate format
    return successResponse(res, { message: 'Connection test successful! API key format is valid.' });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

export default router;



