import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  HiOutlineArrowLeft, 
  HiOutlineDocumentText,
  HiOutlineDownload,
  HiOutlineClock
} from 'react-icons/hi';
import { audioSyncService } from '../services/audioSyncService';
import './AudioScript.css';

const AudioScript = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [syncData, setSyncData] = useState({ sentences: {}, words: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSyncData();
  }, [jobId]);

  const loadSyncData = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      
      // Transform the data into the same format as SyncStudio
      const sentences = {};
      const words = {};
      
      data.forEach(sync => {
        if (sync.elementId) {
          const id = sync.elementId;
          if (id.includes('_w')) {
            // Word
            words[id] = {
              id,
              parentId: sync.parentId || id.split('_w')[0],
              start: sync.startTime || 0,
              end: sync.endTime || 0,
              text: sync.text || '',
              pageNumber: sync.pageNumber || 1
            };
          } else {
            // Sentence
            sentences[id] = {
              id,
              start: sync.startTime || 0,
              end: sync.endTime || 0,
              text: sync.text || '',
              pageNumber: sync.pageNumber || 1,
              status: sync.status || 'SYNCED'
            };
          }
        }
      });
      
      setSyncData({ sentences, words });
    } catch (err) {
      setError('Failed to load audio script: ' + err.message);
      console.error('Error loading sync data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds) => {
    if (seconds === undefined || seconds === null) return '0:00.00';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  };

  const exportScript = () => {
    // Sort sentences by start time
    const sortedSentences = Object.entries(syncData.sentences)
      .filter(([, data]) => data.status !== 'SKIPPED')
      .sort((a, b) => a[1].start - b[1].start);

    let script = 'AUDIO SCRIPT\n';
    script += '='.repeat(50) + '\n\n';
    
    sortedSentences.forEach(([id, data], index) => {
      script += `[${index + 1}] ${data.id}\n`;
      script += `Time: ${formatTime(data.start)} - ${formatTime(data.end)}\n`;
      script += `Text: ${data.text}\n`;
      script += `Page: ${data.pageNumber}\n`;
      script += '\n';
    });

    // Create blob and download
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audio-script-job-${jobId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Sort sentences by start time
  const sortedSentences = Object.entries(syncData.sentences)
    .filter(([, data]) => data.status !== 'SKIPPED')
    .sort((a, b) => a[1].start - b[1].start);

  if (loading) {
    return (
      <div className="audio-script-container">
        <div className="loading">Loading audio script...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="audio-script-container">
        <div className="error">{error}</div>
        <button onClick={() => navigate(`/sync-studio/${jobId}`)} className="btn-back">
          <HiOutlineArrowLeft size={16} style={{ marginRight: '4px' }} />
          Back to Sync Studio
        </button>
      </div>
    );
  }

  return (
    <div className="audio-script-container">
      <div className="audio-script-header">
        <div className="header-left">
          <button 
            onClick={() => navigate(`/sync-studio/${jobId}`)} 
            className="btn-back"
          >
            <HiOutlineArrowLeft size={16} style={{ marginRight: '4px' }} />
            Back to Sync Studio
          </button>
          <h1>
            <HiOutlineDocumentText size={24} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
            Audio Script
          </h1>
        </div>
        <div className="header-right">
          <button onClick={exportScript} className="btn-export">
            <HiOutlineDownload size={16} style={{ marginRight: '4px' }} />
            Export Script
          </button>
        </div>
      </div>

      <div className="script-stats">
        <span>
          <HiOutlineDocumentText size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          {sortedSentences.length} segments
        </span>
        <span>
          <HiOutlineClock size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          {sortedSentences.length > 0 
            ? formatTime(sortedSentences[sortedSentences.length - 1][1].end)
            : '0:00.00'
          } total duration
        </span>
      </div>

      <div className="script-content">
        {sortedSentences.length === 0 ? (
          <div className="empty-state">
            <p>No audio script available.</p>
            <p>Go back to Sync Studio to sync audio segments.</p>
          </div>
        ) : (
          <div className="script-list">
            {sortedSentences.map(([id, data], index) => (
              <div key={id} className="script-item">
                <div className="script-item-header">
                  <span className="script-number">#{index + 1}</span>
                  <span className="script-id">{data.id}</span>
                  <span className="script-time">
                    {formatTime(data.start)} - {formatTime(data.end)}
                  </span>
                  <span className="script-page">Page {data.pageNumber}</span>
                </div>
                <div className="script-text">
                  {data.text || '(No text)'}
                </div>
                {syncData.words && Object.entries(syncData.words)
                  .filter(([, wdata]) => wdata.parentId === data.id)
                  .length > 0 && (
                  <div className="script-words">
                    {Object.entries(syncData.words)
                      .filter(([, wdata]) => wdata.parentId === data.id)
                      .sort((a, b) => a[1].start - b[1].start)
                      .map(([wid, wdata]) => (
                        <span key={wid} className="word-tag">
                          {wdata.text}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioScript;



