import api from './api';

export const aiConfigService = {
  getCurrentConfig: () => api.get('/ai/config/current').then(res => res.data.data),
  
  saveConfig: (config) => api.post('/ai/config', config).then(res => res.data.data),
  
  getStatus: () => api.get('/ai/status').then(res => res.data.data),
  
  getAvailableModels: () => api.get('/ai/models').then(res => res.data.data),
  
  testConnection: (apiKey, modelName) => 
    api.post('/ai/test', { apiKey, modelName }).then(res => res.data.data)
};






