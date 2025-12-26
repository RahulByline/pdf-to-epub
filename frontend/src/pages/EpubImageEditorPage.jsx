import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { conversionService } from '../services/conversionService';
import EpubImageEditor from '../components/EpubImageEditor';
import TextFormattingToolbar from '../components/TextFormattingToolbar';
import { HiOutlineVolumeUp } from 'react-icons/hi';

const EpubImageEditorPage = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [pages, setPages] = useState([]);
  const [selectedPage, setSelectedPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (jobId) {
      loadPages();
    }
  }, [jobId]);

  const loadPages = async () => {
    try {
      setLoading(true);
      const pagesList = await conversionService.getJobPages(parseInt(jobId));
      setPages(pagesList || []);
      
      // Set first page as default
      if (pagesList && pagesList.length > 0) {
        setSelectedPage(pagesList[0].pageNumber);
      }
    } catch (err) {
      console.error('Error loading pages:', err);
      setError(err.response?.data?.message || err.message || 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  };

  const [regenerating, setRegenerating] = useState(false);
  const [editorState, setEditorState] = useState(null);

  const handleSave = (xhtml) => {
    console.log('XHTML saved:', xhtml);
    // You can add additional logic here, like showing a success message
  };
  
  const handleEditorStateChange = useCallback((state) => {
    setEditorState(state);
  }, []);

  const handleSyncStudio = async () => {
    try {
      setRegenerating(true);
      // Regenerate EPUB with updated XHTML
      await conversionService.regenerateEpub(parseInt(jobId), {});
      // Navigate to Sync Studio after regeneration
      navigate(`/sync-studio/${jobId}`);
    } catch (err) {
      console.error('Error regenerating EPUB:', err);
      alert(err.response?.data?.message || err.message || 'Failed to regenerate EPUB');
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2em', textAlign: 'center' }}>
        <p>Loading pages...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2em' }}>
        <div style={{ color: 'red', marginBottom: '1em' }}>{error}</div>
        <button onClick={() => navigate('/conversions')}>Back to Conversions</button>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div style={{ padding: '2em', textAlign: 'center' }}>
        <p>No pages found for this conversion job.</p>
        <button onClick={() => navigate('/conversions')}>Back to Conversions</button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1em', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>EPUB Image Editor - Job {jobId}</h1>
          <div style={{ display: 'flex', gap: '1em', alignItems: 'center' }}>
            <label>
              Select Page:
              <select
                value={selectedPage || ''}
                onChange={(e) => setSelectedPage(parseInt(e.target.value))}
                style={{ marginLeft: '0.5em', padding: '0.5em' }}
              >
                {pages.map((page) => (
                  <option key={page.pageNumber} value={page.pageNumber}>
                    Page {page.pageNumber}
                  </option>
                ))}
              </select>
            </label>
            {editorState && (
              <>
                {editorState.modified && (
                  <span style={{ color: '#ff9800', fontWeight: 'bold', fontSize: '0.9em' }}>Modified</span>
                )}
                <button
                  onClick={editorState.handleReset}
                  disabled={!editorState.modified}
                  style={{
                    padding: '0.5em 1.5em',
                    backgroundColor: '#f5f5f5',
                    color: '#666',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: !editorState.modified ? 'not-allowed' : 'pointer',
                    opacity: !editorState.modified ? 0.5 : 1
                  }}
                >
                  Reset
                </button>
                <button
                  onClick={editorState.handleSave}
                  disabled={editorState.saving || !editorState.modified}
                  style={{
                    padding: '0.5em 1.5em',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (editorState.saving || !editorState.modified) ? 'not-allowed' : 'pointer',
                    opacity: (editorState.saving || !editorState.modified) ? 0.6 : 1,
                    minWidth: '120px'
                  }}
                >
                  {editorState.saving ? 'Saving...' : 'Save XHTML'}
                </button>
              </>
            )}
            <button
              onClick={handleSyncStudio}
              disabled={regenerating}
              style={{
                padding: '0.5em 1em',
                backgroundColor: '#9C27B0',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: regenerating ? 'not-allowed' : 'pointer',
                opacity: regenerating ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5em'
              }}
            >
              <HiOutlineVolumeUp size={18} />
              {regenerating ? 'Regenerating...' : 'Sync Studio'}
            </button>
            <button onClick={() => navigate('/conversions')}>Back to Conversions</button>
          </div>
        </div>
      </div>
      
      {editorState && (
        <TextFormattingToolbar editMode={true} />
      )}
      
      {selectedPage && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <EpubImageEditor
            jobId={parseInt(jobId)}
            pageNumber={selectedPage}
            onSave={handleSave}
            onStateChange={handleEditorStateChange}
          />
        </div>
      )}
    </div>
  );
};

export default EpubImageEditorPage;

