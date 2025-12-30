import api from './api';

export const ttsManagementService = {
  // Get TTS configuration
  getConfig: () =>
    api.get('/tts-management/config').then(res => res.data.data),

  // Save TTS configuration
  saveConfig: (config) =>
    api.post('/tts-management/config', config).then(res => res.data.data),

  // Get restrictions
  getRestrictions: () =>
    api.get('/tts-management/restrictions').then(res => res.data.data),

  // Save restrictions
  saveRestrictions: (restrictions) =>
    api.post('/tts-management/restrictions', restrictions).then(res => res.data.data),

  // Get available voices
  getVoices: () =>
    api.get('/tts-management/voices').then(res => res.data.data),

  // Test TTS generation
  testGeneration: (text, config, restrictions) =>
    api.post('/tts-management/test', { text, config, restrictions }).then(res => res.data.data),

  // Generate TTS for a job
  generateForJob: (jobId, config, restrictions) =>
    api.post('/tts-management/generate', { jobId, config, restrictions }).then(res => res.data.data),

  // Get generation history
  getHistory: () =>
    api.get('/tts-management/history').then(res => res.data.data),

  // Get generation status
  getStatus: (jobId) =>
    api.get(`/tts-management/status/${jobId}`).then(res => res.data.data),
};

