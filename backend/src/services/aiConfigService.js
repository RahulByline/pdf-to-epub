import { AiConfigurationModel } from '../models/AiConfiguration.js';

export class AiConfigService {
  static maskApiKey(apiKey) {
    if (!apiKey || apiKey.length <= 8) {
      return '****';
    }
    return apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4);
  }

  static async getCurrentConfiguration() {
    const config = await AiConfigurationModel.findActive();
    if (!config) {
      return null;
    }

    return {
      id: config.id,
      apiKey: this.maskApiKey(config.api_key),
      modelName: config.model_name,
      isActive: config.is_active,
      description: config.description,
      createdAt: config.created_at,
      updatedAt: config.updated_at
    };
  }

  static async saveConfiguration(configDTO) {
    // Validate API key format if provided
    if (configDTO.apiKey !== undefined && configDTO.apiKey !== null && configDTO.apiKey.trim().length > 0) {
      if (configDTO.apiKey.trim().length < 20) {
        throw new Error('API key must be at least 20 characters');
      }
      // Check if it's a masked key (contains ****)
      if (configDTO.apiKey.includes('****')) {
        throw new Error('Invalid API key format. Please enter a valid API key.');
      }
    }

    let config;
    
    // Check if we're updating an existing config
    if (configDTO.id && configDTO.id > 0) {
      const existing = await AiConfigurationModel.findById(configDTO.id);
      if (existing) {
        // Update existing configuration
        const updateData = {
          modelName: configDTO.modelName !== undefined ? configDTO.modelName : existing.model_name,
          isActive: configDTO.isActive !== undefined ? configDTO.isActive : existing.is_active,
          description: configDTO.description !== undefined ? configDTO.description : existing.description
        };

        // Only update API key if a new one is provided
        if (configDTO.apiKey !== undefined && configDTO.apiKey !== null && configDTO.apiKey.trim().length > 0) {
          if (configDTO.apiKey.trim().length >= 20 && !configDTO.apiKey.includes('****')) {
            updateData.apiKey = configDTO.apiKey.trim();
          } else {
            throw new Error('API key must be at least 20 characters and cannot be masked');
          }
        }
        // If API key not provided, keep existing one (don't include in updateData)

        config = await AiConfigurationModel.update(configDTO.id, updateData);
      } else {
        // ID provided but not found - create new
        if (!configDTO.apiKey || configDTO.apiKey.trim().length < 20) {
          throw new Error('API key is required and must be at least 20 characters for new configurations');
        }
        
        // Deactivate all existing configurations before creating new one
        await AiConfigurationModel.deactivateAll();
        
        config = await AiConfigurationModel.create({
          apiKey: configDTO.apiKey.trim(),
          modelName: configDTO.modelName || 'gemini-pro',
          isActive: configDTO.isActive !== undefined ? configDTO.isActive : true,
          description: configDTO.description || ''
        });
      }
    } else {
      // Create new configuration
      if (!configDTO.apiKey || configDTO.apiKey.trim().length < 20) {
        throw new Error('API key is required and must be at least 20 characters');
      }
      
      // Deactivate all existing configurations before creating new one
      await AiConfigurationModel.deactivateAll();
      
      config = await AiConfigurationModel.create({
        apiKey: configDTO.apiKey.trim(),
        modelName: configDTO.modelName || 'gemini-pro',
        isActive: configDTO.isActive !== undefined ? configDTO.isActive : true,
        description: configDTO.description || ''
      });
    }

    return {
      id: config.id,
      apiKey: this.maskApiKey(config.api_key),
      modelName: config.model_name,
      isActive: config.is_active,
      description: config.description,
      createdAt: config.created_at,
      updatedAt: config.updated_at
    };
  }

  static async getStatus() {
    const config = await AiConfigurationModel.findActive();
    return {
      enabled: !!config,
      configured: !!config,
      model: config?.model_name || null
    };
  }

  static getAvailableModels() {
    return [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-pro',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-pro',
      'gemini-pro-vision'
    ];
  }

  /**
   * Get current AI configuration with real API key (for internal use only)
   * This should NOT be exposed to frontend - use getCurrentConfiguration() instead
   * @returns {Promise<Object|null>} Configuration object with real API key
   */
  static async getActiveConfiguration() {
    const config = await AiConfigurationModel.findActive();
    if (!config) {
      return null;
    }

    return {
      id: config.id,
      apiKey: config.api_key, // Real API key, not masked
      modelName: config.model_name,
      isActive: config.is_active,
      description: config.description
    };
  }
}




