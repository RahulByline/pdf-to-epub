import api from './api';

export const conversionService = {
  startConversion: (pdfDocumentId) => 
    api.post(`/conversions/start/${pdfDocumentId}`).then(res => res.data.data),
  
  startBulkConversion: (pdfIds) => 
    api.post('/conversions/start/bulk', { pdfIds }).then(res => res.data.data),
  
  getConversionJob: (jobId) => 
    api.get(`/conversions/${jobId}`).then(res => res.data.data),
  
  getConversionsByPdf: (pdfDocumentId) => 
    api.get(`/conversions/pdf/${pdfDocumentId}`).then(res => res.data.data),
  
  getConversionsByStatus: (status) => 
    api.get(`/conversions/status/${status}`).then(res => res.data.data),
  
  getReviewRequired: () => 
    api.get('/conversions/review-required').then(res => res.data.data),
  
  markAsReviewed: (jobId, reviewedBy) => 
    api.put(`/conversions/${jobId}/review`, null, { params: { reviewedBy } }).then(res => res.data.data),
  
  stopConversion: (jobId) => 
    api.post(`/conversions/${jobId}/stop`).then(res => res.data.data),
  
  retryConversion: (jobId) => 
    api.post(`/conversions/${jobId}/retry`).then(res => res.data.data),
  
  downloadEpub: (jobId) => {
    return api.get(`/conversions/${jobId}/download`, { responseType: 'blob' }).then(res => {
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `converted_${jobId}.epub`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  },
  
  deleteConversionJob: (jobId) => api.delete(`/conversions/${jobId}`),
  
  getEpubSections: (jobId) =>
    api.get(`/conversions/${jobId}/epub-sections`).then(res => res.data.data),
  
  getEpubTextContent: (jobId) =>
    api.get(`/conversions/${jobId}/epub-text`).then(res => res.data.data),
  
  getSectionXhtml: (jobId, sectionId) =>
    api.get(`/conversions/${jobId}/epub-section/${sectionId}/xhtml`).then(res => res.data),
  
  getTextBlocks: (jobId) =>
    api.get(`/conversions/${jobId}/text-blocks`).then(res => res.data.data),

  regenerateEpub: (jobId) =>
    api.post(`/conversions/${jobId}/regenerate`).then(res => res.data.data)
};

