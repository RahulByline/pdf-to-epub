import api from './api';

export const pdfService = {
  getAllPdfs: () => api.get('/pdfs').then(res => {
    console.log('PDF API response:', res.data);
    return res.data.data || [];
  }).catch(error => {
    console.error('Error fetching PDFs:', error);
    // Return empty array instead of throwing
    return [];
  }),
  
  getPdfById: (id) => api.get(`/pdfs/${id}`).then(res => res.data.data),
  
  getPdfsGroupedByZip: () => api.get('/pdfs/grouped').then(res => res.data.data),
  
  uploadPdf: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/pdfs/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(res => res.data.data);
  },
  
  uploadBulkPdfs: (files) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    return api.post('/pdfs/upload/bulk', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(res => res.data.data);
  },
  
  downloadPdf: (id) => {
    return api.get(`/pdfs/${id}/download`, { responseType: 'blob' }).then(res => {
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `document_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  },
  
  deletePdf: async (id) => {
    try {
      const response = await api.delete(`/pdfs/${id}`);
      return response;
    } catch (error) {
      console.error('Error deleting PDF:', error);
      // Extract error message from response
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to delete PDF';
      throw new Error(errorMessage);
    }
  }
};

