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
      return badRequestResponse(res, 'Invalid API key format. API key must be at least 20 characters.');
    }

    // Check if it's a masked key
    if (apiKey.includes('****')) {
      return badRequestResponse(res, 'Invalid API key format. Please enter a valid API key.');
    }

    // Try to make an actual API call to test the connection
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey.trim());
      const testModelName = modelName || 'gemini-pro';
      const model = genAI.getGenerativeModel({ model: testModelName });
      
      // Make a simple test call and measure response time
      const startTime = Date.now();
      const result = await model.generateContent('Test');
      const response = await result.response;
      const responseTime = Date.now() - startTime;
      
      // Get response text to verify it's working
      const responseText = await response.text();
      
      // Mask API key for response
      const maskedApiKey = apiKey.length > 8 
        ? apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4)
        : '****';
      
      return successResponse(res, { 
        message: 'Connection test successful!',
        details: {
          status: 'connected',
          model: testModelName,
          apiKey: maskedApiKey,
          responseTime: `${responseTime}ms`,
          responseReceived: responseText ? 'Yes' : 'No',
          timestamp: new Date().toISOString()
        },
        summary: `Successfully connected to ${testModelName} model. API key is valid and working. Response time: ${responseTime}ms.`
      });
    } catch (apiError) {
      // If API call fails, return error with details
      const errorMessage = apiError.message || 'Unknown error';
      let userFriendlyMessage = 'Connection test failed. ';
      
      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('401')) {
        userFriendlyMessage += 'Invalid API key. Please check your API key.';
      } else if (errorMessage.includes('MODEL_NOT_FOUND') || errorMessage.includes('404')) {
        userFriendlyMessage += `Model "${modelName || 'gemini-pro'}" not found. Please check the model name.`;
      } else if (errorMessage.includes('QUOTA') || errorMessage.includes('429')) {
        userFriendlyMessage += 'API quota exceeded. Please check your API usage limits.';
      } else {
        userFriendlyMessage += errorMessage;
      }
      
      return badRequestResponse(res, userFriendlyMessage);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

export default router;




