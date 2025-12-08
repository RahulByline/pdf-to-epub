import api from './api';

export const audioSyncService = {
  getAudioSyncsByPdf: (pdfId) => 
    api.get(`/audio-sync/pdf/${pdfId}`).then(res => res.data.data),
  
  getAudioSyncsByJob: (jobId) => 
    api.get(`/audio-sync/job/${jobId}`).then(res => res.data.data),
  
  getAudioSyncs: (pdfId, jobId) => 
    api.get(`/audio-sync/pdf/${pdfId}/job/${jobId}`).then(res => res.data.data),
  
  createAudioSync: (syncData) => 
    api.post('/audio-sync', syncData).then(res => res.data.data),
  
  updateAudioSync: (id, syncData) => 
    api.put(`/audio-sync/${id}`, syncData).then(res => res.data.data),
  
  deleteAudioSync: (id) => api.delete(`/audio-sync/${id}`),
  
  deleteAudioSyncsByJob: (jobId) => api.delete(`/audio-sync/job/${jobId}`),
  
  extractTextFromPdf: (pdfId) =>
    api.get(`/audio-sync/pdf/${pdfId}/extract-text`).then(res => res.data.data),
  
  extractTextFromEpub: (jobId) =>
    api.get(`/audio-sync/job/${jobId}/extract-text`).then(res => res.data.data),
  
  generateAudio: (pdfId, jobId, voice, textBlocks) =>
    api.post('/audio-sync/generate', { pdfId, jobId, voice, textBlocks }).then(res => res.data.data),
  
  getAvailableVoices: () =>
    api.get('/audio-sync/voices').then(res => res.data.data),
  
  getAudioUrl: (syncId) =>
    `${api.defaults.baseURL}/audio-sync/${syncId}/audio`
};

