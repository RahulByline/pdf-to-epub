import React, { useEffect, useState } from 'react';
import { conversionService } from '../services/conversionService';
import { pdfService } from '../services/pdfService';
import { HiOutlineViewGrid, HiOutlineViewList, HiOutlineAdjustments, HiOutlineTrash, HiOutlinePhotograph } from 'react-icons/hi';
import { useNavigate } from 'react-router-dom';

const Conversions = () => {
  const [conversions, setConversions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pdfThumbnails, setPdfThumbnails] = useState({});
  const [viewMode, setViewMode] = useState('card'); // 'card' or 'list'
  const [showFormatModal, setShowFormatModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    let intervalId = null;

    const loadData = async () => {
      try {
        let data = [];
        if (statusFilter === 'all') {
          // Load all conversions from different statuses
          const [pending, inProgress, completed, failed, cancelled] = await Promise.all([
            conversionService.getConversionsByStatus('PENDING').catch(() => []),
            conversionService.getConversionsByStatus('IN_PROGRESS').catch(() => []),
            conversionService.getConversionsByStatus('COMPLETED').catch(() => []),
            conversionService.getConversionsByStatus('FAILED').catch(() => []),
            conversionService.getConversionsByStatus('CANCELLED').catch(() => [])
          ]);
          data = [...pending, ...inProgress, ...completed, ...failed, ...cancelled];
          // Sort by creation date, newest first
          data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else {
          data = await conversionService.getConversionsByStatus(statusFilter);
        }

        if (!isMounted) return;

        setConversions(data);
        
        // Build thumbnail map for all unique PDF IDs
        const pdfIds = [...new Set(data.map(job => job.pdfDocumentId))];
        const thumbnailMap = {};
        pdfIds.forEach(pdfId => {
          thumbnailMap[pdfId] = `/api/pdfs/${pdfId}/thumbnail`;
        });
        setPdfThumbnails(thumbnailMap);
        
        if (!isMounted) return;
        setLoading(false);
      } catch (err) {
        if (!isMounted) return;
        setError(err.message || 'Failed to load conversions');
        setLoading(false);
      }
    };

    loadData();

    // Poll more frequently if there are in-progress jobs
    intervalId = setInterval(() => {
      if (isMounted) {
        loadData();
      }
    }, 3000); // Refresh every 3 seconds for better progress updates

    return () => {
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [statusFilter]);

  const loadConversions = async () => {
    try {
      let data = [];
      if (statusFilter === 'all') {
        // Load all conversions from different statuses
        const [pending, inProgress, completed, failed, cancelled] = await Promise.all([
          conversionService.getConversionsByStatus('PENDING').catch(() => []),
          conversionService.getConversionsByStatus('IN_PROGRESS').catch(() => []),
          conversionService.getConversionsByStatus('COMPLETED').catch(() => []),
          conversionService.getConversionsByStatus('FAILED').catch(() => []),
          conversionService.getConversionsByStatus('CANCELLED').catch(() => [])
        ]);
        data = [...pending, ...inProgress, ...completed, ...failed, ...cancelled];
        // Sort by creation date, newest first
        data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      } else {
        data = await conversionService.getConversionsByStatus(statusFilter);
      }
      setConversions(data);
      
      // Build thumbnail map for all unique PDF IDs
      const pdfIds = [...new Set(data.map(job => job.pdfDocumentId))];
      const thumbnailMap = {};
      pdfIds.forEach(pdfId => {
        thumbnailMap[pdfId] = `/api/pdfs/${pdfId}/thumbnail`;
      });
      setPdfThumbnails(thumbnailMap);
    } catch (err) {
      console.error('Error loading conversions:', err);
      setError(err.message || 'Failed to load conversions');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (jobId) => {
    try {
      await conversionService.downloadEpub(jobId);
    } catch (err) {
      setError(err.message || 'Failed to download EPUB');
    }
  };

  const handleStop = async (jobId) => {
    try {
      setError(''); // Clear previous errors
      await conversionService.stopConversion(jobId);
      // Reload will happen automatically via the interval
    } catch (err) {
      console.error('Error stopping conversion:', err);
      setError(err.message || 'Failed to stop conversion');
    }
  };

  const handleRetry = async (jobId) => {
    try {
      setError(''); // Clear previous errors
      await conversionService.retryConversion(jobId);
      // Reload will happen automatically via the interval
    } catch (err) {
      console.error('Error retrying conversion:', err);
      setError(err.message || 'Failed to retry conversion');
    }
  };

  const handleDelete = async (jobId) => {
    // Confirm deletion
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete Job #${jobId}?\n\nThis action cannot be undone and will delete:\n- The conversion job\n- Associated EPUB files\n- Audio sync data`
    );
    
    if (!confirmed) return;

    try {
      setError(''); // Clear previous errors
      await conversionService.deleteConversionJob(jobId);
      // Remove from local state immediately for better UX
      setConversions(prev => prev.filter(job => job.id !== jobId));
    } catch (err) {
      console.error('Error deleting conversion:', err);
      setError(err.message || 'Failed to delete conversion job');
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      PENDING: 'badge-info',
      IN_PROGRESS: 'badge-warning',
      COMPLETED: 'badge-success',
      FAILED: 'badge-danger',
      CANCELLED: 'badge-danger'
    };
    return badges[status] || 'badge-info';
  };

  const handleImageEditorClick = (jobId) => {
    setSelectedJobId(jobId);
    setShowFormatModal(true);
  };

  const handleFormatSelection = (format) => {
    if (!selectedJobId) return;
    
    setShowFormatModal(false);
    
    if (format === 'reflowable') {
      // Navigate to image editor (current behavior)
      navigate(`/epub-image-editor/${selectedJobId}`);
    } else if (format === 'fixed-layout') {
      // Navigate to fixed layout image editor (to be implemented)
      navigate(`/epub-image-editor/${selectedJobId}?layout=fixed`);
    }
    
    setSelectedJobId(null);
  };

  const handleCloseModal = () => {
    setShowFormatModal(false);
    setSelectedJobId(null);
  };

  if (loading && conversions.length === 0) {
    return <div className="loading">Loading...</div>;
  }

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
            Conversion Jobs
          </h1>
          <p style={{ margin: '8px 0 0 0', fontSize: '16px', color: '#757575', fontWeight: '400' }}>
            Manage and monitor your PDF to EPUB conversion jobs
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ fontSize: '14px', fontWeight: '500', color: '#212121' }}>
              Filter by Status:
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: '10px 16px',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                backgroundColor: '#ffffff',
                color: '#212121',
                cursor: 'pointer',
                minWidth: '150px',
                outline: 'none',
                transition: 'border-color 0.2s ease'
              }}
              onFocus={(e) => e.target.style.borderColor = '#90caf9'}
              onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
            >
              <option value="all">All</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '4px',
            padding: '4px',
            backgroundColor: '#f5f5f5',
            borderRadius: '8px',
            border: '1px solid #e0e0e0'
          }}>
            <button
              onClick={() => setViewMode('card')}
              style={{
                padding: '8px 12px',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: viewMode === 'card' ? '#ffffff' : 'transparent',
                color: viewMode === 'card' ? '#1976d2' : '#666',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '14px',
                fontWeight: viewMode === 'card' ? '600' : '400',
                boxShadow: viewMode === 'card' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.2s ease'
              }}
              title="Card View"
            >
              <HiOutlineViewGrid size={18} />
              <span>Card</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                padding: '8px 12px',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: viewMode === 'list' ? '#ffffff' : 'transparent',
                color: viewMode === 'list' ? '#1976d2' : '#666',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '14px',
                fontWeight: viewMode === 'list' ? '600' : '400',
                boxShadow: viewMode === 'list' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.2s ease'
              }}
              title="List View"
            >
              <HiOutlineViewList size={18} />
              <span>List</span>
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {conversions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: '#666', fontSize: '16px' }}>No conversions found</p>
        </div>
      ) : viewMode === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
          {conversions.map(job => (
            <div key={job.id} className="card conversion-card">
              {/* PDF Thumbnail */}
              <div style={{ 
                marginBottom: '16px', 
                borderRadius: '8px', 
                overflow: 'hidden', 
                backgroundColor: '#f5f5f5',
                width: '100%',
                height: '200px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #e0e0e0'
              }}>
                <img 
                  src={`/api/pdfs/${job.pdfDocumentId}/thumbnail`}
                  alt={`PDF ${job.pdfDocumentId} preview`}
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
                  fontSize: '48px',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <span style={{ fontSize: '64px' }}>📄</span>
                  <span style={{ fontSize: '14px', color: '#666' }}>No Preview</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#212121' }}>
                    Job #{job.id}
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#666' }}>
                    PDF ID: {job.pdfDocumentId}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={`badge ${getStatusBadge(job.status)}`}>
                    {job.status.replace(/_/g, ' ')}
                  </span>
                  <button
                    onClick={() => handleDelete(job.id)}
                    style={{
                      padding: '6px 10px',
                      border: 'none',
                      borderRadius: '6px',
                      backgroundColor: 'transparent',
                      color: '#dc3545',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      fontSize: '16px'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.backgroundColor = '#fee';
                      e.target.style.transform = 'scale(1.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.backgroundColor = 'transparent';
                      e.target.style.transform = 'scale(1)';
                    }}
                    title="Delete this job permanently"
                  >
                    <HiOutlineTrash size={18} />
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: '#212121' }}>Progress</span>
                  <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#212121' }}>
                    {job.progressPercentage || 0}%
                  </span>
                </div>
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar-fill"
                    style={{ 
                      width: `${job.progressPercentage || 0}%`,
                      backgroundColor: job.status === 'COMPLETED' ? '#28a745' :
                                     job.status === 'FAILED' ? '#dc3545' :
                                     job.status === 'IN_PROGRESS' ? '#007bff' :
                                     '#6c757d'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Current Step</div>
                <div style={{ fontSize: '14px', fontWeight: '500', color: '#212121' }}>
                  {job.currentStep ? job.currentStep.replace(/STEP_\d+_/, '').replace(/_/g, ' ') : 'N/A'}
                </div>
              </div>

              <div style={{ marginBottom: '20px', paddingTop: '16px', borderTop: '1px solid #e0e0e0' }}>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  Created: {new Date(job.createdAt).toLocaleString()}
                </div>
                {job.completedAt && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    Completed: {new Date(job.completedAt).toLocaleString()}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {job.status === 'COMPLETED' && (
                  <button
                    onClick={() => handleImageEditorClick(job.id)}
                    className="btn btn-primary"
                    style={{ flex: 1, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    <HiOutlinePhotograph size={18} />
                    Image Editor
                  </button>
                )}
                {job.status === 'IN_PROGRESS' && (
                  <button
                    onClick={() => handleStop(job.id)}
                    className="btn btn-danger"
                    style={{ flex: 1 }}
                  >
                    Stop Conversion
                  </button>
                )}
                {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
                  <button
                    onClick={() => handleRetry(job.id)}
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                  >
                    Retry Conversion
                  </button>
                )}
                {job.status === 'PENDING' && (
                  <div style={{ flex: 1, padding: '12px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
                    Waiting to start...
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Preview</th>
                <th>Job ID</th>
                <th>PDF ID</th>
                <th>Status</th>
                <th style={{ width: '200px' }}>Progress</th>
                  <th>Step</th>
                  <th>Created</th>
                  <th style={{ width: '200px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {conversions.map(job => (
                <tr key={job.id}>
                  <td>
                    <div style={{
                      width: '60px',
                      height: '80px',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      backgroundColor: '#f5f5f5',
                      border: '1px solid #e0e0e0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <img 
                        src={`/api/pdfs/${job.pdfDocumentId}/thumbnail`}
                        alt={`PDF ${job.pdfDocumentId} preview`}
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
                        fontSize: '24px'
                      }}>
                        📄
                      </div>
                    </div>
                  </td>
                  <td>{job.id}</td>
                  <td>{job.pdfDocumentId}</td>
                  <td>
                    <span className={`badge ${getStatusBadge(job.status)}`}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ flex: 1, minWidth: '120px' }}>
                        <div className="progress-bar-container">
                          <div 
                            className="progress-bar-fill"
                            style={{ 
                              width: `${job.progressPercentage || 0}%`,
                              backgroundColor: job.status === 'COMPLETED' ? '#28a745' :
                                             job.status === 'FAILED' ? '#dc3545' :
                                             job.status === 'IN_PROGRESS' ? '#007bff' :
                                             '#6c757d'
                            }}
                          />
                        </div>
                      </div>
                      <span style={{ minWidth: '45px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px' }}>
                        {job.progressPercentage || 0}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.85em' }}>
                      {job.currentStep ? job.currentStep.replace(/STEP_\d+_/, '').replace(/_/g, ' ') : 'N/A'}
                    </span>
                  </td>
                  <td>{new Date(job.createdAt).toLocaleString()}</td>
                  <td>
                    {job.status === 'COMPLETED' && (
                      <button
                        onClick={() => handleImageEditorClick(job.id)}
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        title="Edit Images in EPUB"
                      >
                        <HiOutlinePhotograph size={14} />
                        Images
                      </button>
                    )}
                    {job.status === 'IN_PROGRESS' && (
                      <button
                        onClick={() => handleStop(job.id)}
                        className="btn btn-danger"
                        style={{ marginRight: '5px', padding: '6px 12px', fontSize: '14px' }}
                      >
                        Stop
                      </button>
                    )}
                    {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
                      <button
                        onClick={() => handleRetry(job.id)}
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', fontSize: '14px' }}
                      >
                        Retry
                      </button>
                    )}
                    {job.status === 'PENDING' && (
                      <span style={{ color: '#666', fontSize: '14px' }}>Waiting...</span>
                    )}
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="btn btn-danger"
                      style={{ 
                        marginLeft: '8px', 
                        padding: '6px 12px', 
                        fontSize: '14px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                      title="Delete this job permanently"
                    >
                      <HiOutlineTrash size={14} />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Format Selection Modal */}
      {showFormatModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={handleCloseModal}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '32px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 24px 0', fontSize: '24px', fontWeight: '600', color: '#212121' }}>
              Select EPUB Format
            </h2>
            <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: '#666' }}>
              Choose the format for your EPUB conversion:
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              <button
                onClick={() => handleFormatSelection('reflowable')}
                style={{
                  padding: '16px 20px',
                  border: '2px solid #4caf50',
                  borderRadius: '8px',
                  backgroundColor: '#f1f8f4',
                  color: '#212121',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: '500',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#e8f5e9';
                  e.target.style.borderColor = '#4caf50';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#f1f8f4';
                  e.target.style.borderColor = '#4caf50';
                }}
              >
                <span style={{ fontWeight: '600', color: '#4caf50' }}>Reflowable</span>
                <span style={{ fontSize: '13px', color: '#666' }}>
                  Text flows and adapts to screen size. Best for text-heavy content.
                </span>
              </button>

              <button
                onClick={() => handleFormatSelection('fixed-layout')}
                style={{
                  padding: '16px 20px',
                  border: '2px solid #2196f3',
                  borderRadius: '8px',
                  backgroundColor: '#f3f7fb',
                  color: '#212121',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: '500',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#e3f2fd';
                  e.target.style.borderColor = '#2196f3';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#f3f7fb';
                  e.target.style.borderColor = '#2196f3';
                }}
              >
                <span style={{ fontWeight: '600', color: '#2196f3' }}>Fixed Layout</span>
                <span style={{ fontSize: '13px', color: '#666' }}>
                  Preserves exact page layout. Best for image-heavy or design-focused content.
                </span>
              </button>
            </div>

            <button
              onClick={handleCloseModal}
              style={{
                padding: '10px 20px',
                border: '1px solid #e0e0e0',
                borderRadius: '6px',
                backgroundColor: '#fff',
                color: '#666',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                width: '100%',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = '#f5f5f5';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = '#fff';
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Conversions;

