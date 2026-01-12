import React, { useState, useEffect } from 'react';
import axios from 'axios';

const ChapterManager = ({ jobId, pdfId, totalPages, onChaptersChange }) => {
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [detectionMethod, setDetectionMethod] = useState('ai');
  const [autoGenSettings, setAutoGenSettings] = useState({
    pagesPerChapter: 10
  });

  useEffect(() => {
    if (jobId) {
      loadExistingConfig();
    }
  }, [jobId]);

  const loadExistingConfig = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/chapters/config/${jobId}`);
      if (response.data.success && response.data.config) {
        setChapters(response.data.config.chapters || []);
      }
    } catch (error) {
      // No existing config is fine
      console.log('No existing chapter configuration found');
    } finally {
      setLoading(false);
    }
  };

  const detectChapters = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.get(`/api/chapters/detect/${jobId}`, {
        params: {
          useAI: detectionMethod === 'ai',
          respectPageNumbers: true
        }
      });
      
      if (response.data.success) {
        setChapters(response.data.chapters);
        onChaptersChange?.(response.data.chapters);
      }
    } catch (error) {
      setError('Failed to detect chapters: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const autoGenerateChapters = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.post('/api/chapters/auto-generate', {
        totalPages,
        pagesPerChapter: autoGenSettings.pagesPerChapter,
        documentId: jobId
      });
      
      if (response.data.success) {
        setChapters(response.data.chapters);
        onChaptersChange?.(response.data.chapters);
      }
    } catch (error) {
      setError('Failed to auto-generate chapters: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveConfiguration = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.post(`/api/chapters/config/${jobId}`, {
        chapters,
        totalPages,
        title: `Chapter Configuration for Job ${jobId}`
      });
      
      if (response.data.success) {
        setEditMode(false);
        onChaptersChange?.(chapters);
        alert('Chapter configuration saved successfully!');
      }
    } catch (error) {
      setError('Failed to save configuration: ' + error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  };

  const addChapter = () => {
    const lastChapter = chapters[chapters.length - 1];
    const startPage = lastChapter ? lastChapter.endPage + 1 : 1;
    const endPage = Math.min(startPage + 9, totalPages);
    
    setChapters([...chapters, {
      title: `Chapter ${chapters.length + 1}`,
      startPage,
      endPage
    }]);
  };

  const updateChapter = (index, field, value) => {
    const updatedChapters = [...chapters];
    updatedChapters[index] = { ...updatedChapters[index], [field]: value };
    setChapters(updatedChapters);
  };

  const removeChapter = (index) => {
    const updatedChapters = chapters.filter((_, i) => i !== index);
    setChapters(updatedChapters);
  };

  const validateChapters = () => {
    const errors = [];
    const coveredPages = new Set();
    
    chapters.forEach((chapter, index) => {
      if (!chapter.title?.trim()) {
        errors.push(`Chapter ${index + 1}: Title is required`);
      }
      
      if (!chapter.startPage || !chapter.endPage) {
        errors.push(`Chapter ${index + 1}: Start and end pages are required`);
      }
      
      if (chapter.startPage > chapter.endPage) {
        errors.push(`Chapter ${index + 1}: Start page cannot be greater than end page`);
      }
      
      if (chapter.startPage < 1 || chapter.endPage > totalPages) {
        errors.push(`Chapter ${index + 1}: Pages must be between 1 and ${totalPages}`);
      }
      
      // Check for overlaps
      for (let p = chapter.startPage; p <= chapter.endPage; p++) {
        if (coveredPages.has(p)) {
          errors.push(`Chapter ${index + 1}: Page ${p} is already assigned to another chapter`);
        }
        coveredPages.add(p);
      }
    });
    
    return errors;
  };

  const validationErrors = validateChapters();

  return (
    <div className="chapter-manager">
      <div className="chapter-manager-header">
        <h3>Chapter Management</h3>
        <div className="chapter-controls">
          <button
            onClick={() => setEditMode(!editMode)}
            className="btn btn-secondary"
          >
            {editMode ? 'Cancel Edit' : 'Edit Chapters'}
          </button>
          
          {editMode && (
            <button
              onClick={saveConfiguration}
              disabled={loading || validationErrors.length > 0}
              className="btn btn-primary"
            >
              Save Configuration
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger">
          {error}
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="alert alert-warning">
          <strong>Validation Errors:</strong>
          <ul>
            {validationErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="detection-methods">
        <h4>Chapter Detection</h4>
        
        <div className="method-group">
          <label>
            <input
              type="radio"
              value="ai"
              checked={detectionMethod === 'ai'}
              onChange={(e) => setDetectionMethod(e.target.value)}
            />
            AI-Powered Detection
          </label>
          <button
            onClick={detectChapters}
            disabled={loading}
            className="btn btn-outline-primary btn-sm"
          >
            Detect Chapters
          </button>
        </div>

        <div className="method-group">
          <label>Auto-Generate by Page Count:</label>
          <div className="auto-gen-controls">
            <input
              type="number"
              value={autoGenSettings.pagesPerChapter}
              onChange={(e) => setAutoGenSettings({
                ...autoGenSettings,
                pagesPerChapter: parseInt(e.target.value) || 10
              })}
              min="1"
              max="50"
              className="form-control"
              style={{ width: '80px', display: 'inline-block' }}
            />
            <span> pages per chapter</span>
            <button
              onClick={autoGenerateChapters}
              disabled={loading}
              className="btn btn-outline-secondary btn-sm ml-2"
            >
              Generate
            </button>
          </div>
        </div>
      </div>

      <div className="chapters-list">
        <h4>Chapters ({chapters.length})</h4>
        
        {chapters.length === 0 ? (
          <div className="no-chapters">
            <p>No chapters configured. Use detection methods above or add manually.</p>
          </div>
        ) : (
          <div className="chapters-table">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Start Page</th>
                  <th>End Page</th>
                  <th>Pages</th>
                  {editMode && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {chapters.map((chapter, index) => (
                  <tr key={index}>
                    <td>
                      {editMode ? (
                        <input
                          type="text"
                          value={chapter.title}
                          onChange={(e) => updateChapter(index, 'title', e.target.value)}
                          className="form-control"
                        />
                      ) : (
                        chapter.title
                      )}
                    </td>
                    <td>
                      {editMode ? (
                        <input
                          type="number"
                          value={chapter.startPage}
                          onChange={(e) => updateChapter(index, 'startPage', parseInt(e.target.value))}
                          min="1"
                          max={totalPages}
                          className="form-control"
                          style={{ width: '80px' }}
                        />
                      ) : (
                        chapter.startPage
                      )}
                    </td>
                    <td>
                      {editMode ? (
                        <input
                          type="number"
                          value={chapter.endPage}
                          onChange={(e) => updateChapter(index, 'endPage', parseInt(e.target.value))}
                          min="1"
                          max={totalPages}
                          className="form-control"
                          style={{ width: '80px' }}
                        />
                      ) : (
                        chapter.endPage
                      )}
                    </td>
                    <td>
                      {chapter.endPage - chapter.startPage + 1}
                    </td>
                    {editMode && (
                      <td>
                        <button
                          onClick={() => removeChapter(index)}
                          className="btn btn-danger btn-sm"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            
            {editMode && (
              <button
                onClick={addChapter}
                className="btn btn-success btn-sm"
              >
                Add Chapter
              </button>
            )}
          </div>
        )}
      </div>

      <div className="chapter-summary">
        <h5>Summary</h5>
        <p>Total Pages: {totalPages}</p>
        <p>Configured Chapters: {chapters.length}</p>
        <p>Covered Pages: {chapters.reduce((sum, ch) => sum + (ch.endPage - ch.startPage + 1), 0)}</p>
        {chapters.length > 0 && (
          <p>Coverage: {((chapters.reduce((sum, ch) => sum + (ch.endPage - ch.startPage + 1), 0) / totalPages) * 100).toFixed(1)}%</p>
        )}
      </div>
    </div>
  );
};

export default ChapterManager;