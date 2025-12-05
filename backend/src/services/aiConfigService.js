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
      description: config.description
    };
  }

  static async saveConfiguration(configDTO) {
    // Deactivate all existing configurations
    await AiConfigurationModel.deactivateAll();

    // Validate API key if provided
    if (configDTO.apiKey) {
      if (configDTO.apiKey.trim().length < 20) {
        throw new Error('API key must be at least 20 characters');
      }
    }

    let config;
    if (configDTO.id && configDTO.id > 0) {
      const existing = await AiConfigurationModel.findById(configDTO.id);
      if (existing) {
        // Update existing - preserve API key if not provided
        const updateData = {
          modelName: configDTO.modelName || existing.model_name,
          isActive: configDTO.isActive !== undefined ? configDTO.isActive : true,
          description: configDTO.description
        };

        if (configDTO.apiKey && configDTO.apiKey.trim().length >= 20) {
          updateData.apiKey = configDTO.apiKey.trim();
        } else {
          updateData.apiKey = existing.api_key;
        }

        config = await AiConfigurationModel.update(configDTO.id, updateData);
      } else {
        // Create new
        config = await AiConfigurationModel.create({
          apiKey: configDTO.apiKey?.trim() || '',
          modelName: configDTO.modelName || 'gemini-pro',
          isActive: configDTO.isActive !== undefined ? configDTO.isActive : true,
          description: configDTO.description
        });
      }
    } else {
      // Create new
      if (!configDTO.apiKey || configDTO.apiKey.trim().length < 20) {
        throw new Error('API key is required and must be at least 20 characters');
      }

      config = await AiConfigurationModel.create({
        apiKey: configDTO.apiKey.trim(),
        modelName: configDTO.modelName || 'gemini-pro',
        isActive: configDTO.isActive !== undefined ? configDTO.isActive : true,
        description: configDTO.description
      });
    }

    return {
      id: config.id,
      apiKey: this.maskApiKey(config.api_key),
      modelName: config.model_name,
      isActive: config.is_active,
      description: config.description
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
      'gemini-pro',
      'gemini-pro-vision',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];
  }
}

