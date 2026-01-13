import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pdfService } from '../services/pdfService';
import { HiOutlineDocument, HiOutlineCloudUpload, HiOutlineTrash, HiOutlinePlay } from 'react-icons/hi';

const PdfList = () => {
  const navigate = useNavigate();
  const [pdfs, setPdfs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('list');

  useEffect(() => {
    loadPdfs();
  }, []);

  const loadPdfs = async () => {
    try {
      const data = await pdfService.getAllPdfs();
      // Ensure we have an array
      setPdfs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading PDFs:', err);
      setError(err.response?.data?.message || err.message || 'Failed to load PDFs');
      setPdfs([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this PDF?')) {
      return;
    }

    try {
      setError(''); // Clear previous errors
      await pdfService.deletePdf(id);
      await loadPdfs();
      // Optionally show success message
    } catch (err) {
      console.error('Delete error:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to delete PDF. Please check server logs.';
      setError(errorMessage);
      // Auto-hide error after 5 seconds
      setTimeout(() => setError(''), 5000);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const getDocumentTypeBadge = (type) => {
    const types = {
      'TEXTBOOK': { color: '#1976d2', bg: '#e3f2fd' },
      'WORKBOOK': { color: '#388e3c', bg: '#e8f5e9' },
      'TEACHER_GUIDE': { color: '#f57c00', bg: '#fff3e0' },
      'ASSESSMENT': { color: '#c2185b', bg: '#fce4ec' },
      'REFERENCE_MATERIAL': { color: '#7b1fa2', bg: '#f3e5f5' },
      'OTHER': { color: '#616161', bg: '#f5f5f5' }
    };
    return types[type] || types['OTHER'];
  };

  return (
    <div className="container">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '32px',
        paddingBottom: '20px',
        borderBottom: '2px solid #e0e0e0'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '36px', fontWeight: '700', color: '#212121', letterSpacing: '-0.5px' }}>
            PDF Documents
          </h1>
          <p style={{ margin: '8px 0 0 0', fontSize: '16px', color: '#757575', fontWeight: '400' }}>
            Manage your PDF documents and start conversions
          </p>
        </div>
        <Link to="/pdfs/upload" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HiOutlineCloudUpload size={20} />
          Upload PDF
        </Link>
      </div>

      {error && <div className="error">{error}</div>}

      {pdfs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
          <HiOutlineDocument size={64} style={{ color: '#bdbdbd', marginBottom: '16px' }} />
          <h3 style={{ color: '#666', marginBottom: '8px' }}>No PDFs Found</h3>
          <p style={{ color: '#999', marginBottom: '24px' }}>Upload your first PDF document to get started</p>
          <Link to="/pdfs/upload" className="btn btn-primary">
            <HiOutlineCloudUpload size={18} style={{ marginRight: '8px' }} />
            Upload PDF
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table" style={{ margin: 0 }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5' }}>
                <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: '600', fontSize: '14px', color: '#212121', borderBottom: '2px solid #e0e0e0' }}>
                  Preview
                </th>
                <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: '600', fontSize: '14px', color: '#212121', borderBottom: '2px solid #e0e0e0' }}>
                  Name
                </th>
                <th style={{ padding: '16px 24px', textAlign: 'center', fontWeight: '600', fontSize: '14px', color: '#212121', borderBottom: '2px solid #e0e0e0' }}>
                  Pages
                </th>
                <th style={{ padding: '16px 24px', textAlign: 'center', fontWeight: '600', fontSize: '14px', color: '#212121', borderBottom: '2px solid #e0e0e0' }}>
                  Type
                </th>
                <th style={{ padding: '16px 24px', textAlign: 'center', fontWeight: '600', fontSize: '14px', color: '#212121', borderBottom: '2px solid #e0e0e0' }}>
                  Size
                </th>
                <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: '600', fontSize: '14px', color: '#212121', borderBottom: '2px solid #e0e0e0' }}>
                  Created
                </th>
                <th style={{ padding: '16px 24px', textAlign: 'center', fontWeight: '600', fontSize: '14px', color: '#212121', borderBottom: '2px solid #e0e0e0' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pdfs.map((pdf, index) => {
                // Skip if pdf object is invalid
                if (!pdf || !pdf.id) return null;

                const typeBadge = getDocumentTypeBadge(pdf.documentType);
                return (
                  <tr 
                    key={pdf.id}
                    style={{
                      borderBottom: index < pdfs.length - 1 ? '1px solid #e0e0e0' : 'none',
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fafafa'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
                  >
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{
                        width: '80px',
                        height: '100px',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        backgroundColor: '#f5f5f5',
                        border: '1px solid #e0e0e0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <img
                          src={`/api/pdfs/${pdf.id}/thumbnail`}
                          alt={`${pdf.originalFileName || 'PDF'} preview`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain'
                          }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            if (e.target.nextSibling) {
                              e.target.nextSibling.style.display = 'flex';
                            }
                          }}
                        />
                        <div style={{ 
                          display: 'none', 
                          width: '100%', 
                          height: '100%', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          backgroundColor: '#e3f2fd',
                          color: '#1976d2',
                          fontSize: '32px'
                        }}>
                          📄
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '15px', color: '#212121', marginBottom: '4px' }}>
                          {pdf.originalFileName || 'Unnamed PDF'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#757575' }}>
                          ID: {pdf.id}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                      <span style={{ 
                        display: 'inline-block',
                        padding: '6px 12px',
                        borderRadius: '12px',
                        backgroundColor: '#e3f2fd',
                        color: '#1976d2',
                        fontWeight: '600',
                        fontSize: '14px'
                      }}>
                        {pdf.totalPages || 0}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '6px 12px',
                        borderRadius: '12px',
                        backgroundColor: typeBadge.bg,
                        color: typeBadge.color,
                        fontWeight: '500',
                        fontSize: '13px',
                        border: `1px solid ${typeBadge.color}20`
                      }}>
                        {pdf.documentType || 'OTHER'}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'center', fontWeight: '500', color: '#212121' }}>
                      {formatFileSize(pdf.fileSize)}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#666', fontSize: '14px' }}>
                      {new Date(pdf.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => navigate(`/chapter-plan/${pdf.id}`)}
                          className="btn btn-success"
                          style={{
                            padding: '8px 16px',
                            fontSize: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            borderRadius: '6px'
                          }}
                          title="Plan chapters and convert"
                        >
                          <HiOutlinePlay size={16} />
                          Convert
                        </button>
                        <button
                          onClick={() => handleDelete(pdf.id)}
                          className="btn btn-danger"
                          style={{
                            padding: '8px 16px',
                            fontSize: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            borderRadius: '6px'
                          }}
                          title="Delete PDF"
                        >
                          <HiOutlineTrash size={16} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PdfList;

