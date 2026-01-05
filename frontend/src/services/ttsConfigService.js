import api from './api';

export const ttsConfigService = {
  getCurrentConfig: () => 
    api.get('/tts/config/current')
      .then(res => res.data?.data || null)
      .catch(err => {
        // If 404, return null (no config exists yet) instead of throwing
        if (err.response?.status === 404) {
          return null;
        }
        throw err;
      }),
  
  saveConfig: (config) => api.post('/tts/config', config).then(res => res.data.data),
  
  getStatus: () => api.get('/tts/status').then(res => res.data.data),
  
  getAvailableLanguages: () => api.get('/tts/languages').then(res => res.data.data),
  
  getAvailableVoices: (languageCode) => 
    api.get(`/tts/voices?languageCode=${languageCode || 'en-US'}`).then(res => res.data.data),
  
  getAvailableAudioEncodings: () => 
    api.get('/tts/audio-encodings').then(res => res.data.data),
  
  testConnection: (credentialsPath, languageCode, voiceName, ssmlGender) => 
    api.post('/tts/test', { credentialsPath, languageCode, voiceName, ssmlGender }).then(res => res.data.data),
  
  detectPages: (pages, exclusionPrompt, jobId) => 
    api.post('/tts/detect-pages', { pages, exclusionPrompt, jobId }).then(res => res.data.data)
};

