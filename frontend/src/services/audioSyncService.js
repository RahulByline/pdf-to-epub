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
    `${api.defaults.baseURL}/audio-sync/${syncId}/audio`,
  
  saveSyncBlocks: (jobId, syncBlocks, audioFileName, granularity = 'sentence') =>
    api.post('/audio-sync/save-sync-blocks', { jobId, syncBlocks, audioFileName, granularity }).then(res => res.data.data),
  
  uploadAudioFile: (jobId, audioFile) => {
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('jobId', jobId);
    return api.post('/audio-sync/upload-audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(res => res.data.data);
  },

  // Check if Aeneas forced aligner is available
  checkAeneas: () =>
    api.get('/audio-sync/check-aeneas').then(res => res.data.data),

  // Automated forced alignment (Kitaboo-style)
  autoSync: (jobId, options = {}) =>
    api.post('/audio-sync/auto-sync', { 
      jobId, 
      language: options.language || 'eng',
      granularity: options.granularity || 'sentence',
      propagateWords: options.propagateWords !== false,
      audioPath: options.audioPath
    }).then(res => res.data.data),

  // Batch auto-sync for multiple pages
  batchAutoSync: (jobId, options = {}) =>
    api.post('/audio-sync/batch-auto-sync', {
      jobId,
      language: options.language || 'eng',
      granularity: options.granularity || 'sentence',
      audioPath: options.audioPath
    }).then(res => res.data.data),

  // Linear spread sync (fallback when Aeneas not available)
  linearSpread: (jobId, startTime, endTime, options = {}) =>
    api.post('/audio-sync/linear-spread', {
      jobId,
      startTime,
      endTime,
      granularity: options.granularity || 'sentence',
      propagateWords: options.propagateWords !== false
    }).then(res => res.data.data)
};

