import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pdfService } from '../services/pdfService';

const PdfUpload = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a PDF file');
      return;
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB');
      return;
    }

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a valid PDF file');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const response = await pdfService.uploadPdf(file);
      console.log('Upload successful:', response);
      setSuccess('PDF uploaded successfully!');
      setTimeout(() => {
        navigate('/pdfs');
      }, 1500);
    } catch (err) {
      console.error('Upload error:', err);
      const errorMessage = err.response?.data?.error ||
                          err.response?.data?.message ||
                          err.message ||
                          'Upload failed. Please check your connection and try again.';
      setError(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="container">
      <h1>Upload PDF</h1>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>PDF File *</label>
            <input
              type="file"
              accept=".pdf,.zip"
              onChange={handleFileChange}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload PDF'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PdfUpload;


