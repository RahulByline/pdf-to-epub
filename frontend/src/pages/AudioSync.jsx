import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { audioSyncService } from '../services/audioSyncService';
import { conversionService } from '../services/conversionService';
import { pdfService } from '../services/pdfService';
import { HiOutlinePlay, HiOutlinePause, HiOutlineVolumeUp, HiOutlineArrowLeft, HiOutlineCode, HiOutlineDocumentText, HiOutlineDownload, HiOutlinePencil, HiOutlineCheck, HiOutlineX, HiOutlineAdjustments } from 'react-icons/hi';
import './AudioSync.css';

const AudioSync = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const audioRef = useRef(null);
  
  const [job, setJob] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [epubSections, setEpubSections] = useState([]);
  const [epubTextContent, setEpubTextContent] = useState([]);
  const [selectedPage, setSelectedPage] = useState(1);
  const [viewMode, setViewMode] = useState('text'); // 'text' or 'xhtml'
  const [textChunks, setTextChunks] = useState([]);
  const [selectedBlocks, setSelectedBlocks] = useState([]); // Array of selected block IDs
  const [editingBlockId, setEditingBlockId] = useState(null); // ID of block being edited
  const [editedText, setEditedText] = useState(''); // Temporary text while editing
  const [audioSegments, setAudioSegments] = useState([]);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('standard');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selectedChunk, setSelectedChunk] = useState(null);

  useEffect(() => {
    loadData();
    loadVoices();
  }, [jobId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioSegments]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [jobData, audioData] = await Promise.all([
        conversionService.getConversionJob(parseInt(jobId)),
        audioSyncService.getAudioSyncsByJob(parseInt(jobId)).catch(() => [])
      ]);

      setJob(jobData);
      
      if (jobData.status !== 'COMPLETED') {
        setError('Conversion must be completed before audio syncing. Please wait for the conversion to finish.');
        return;
      }

      if (jobData.pdfDocumentId) {
        const pdfData = await pdfService.getPdfById(jobData.pdfDocumentId);
        setPdf(pdfData);
      }

      // Load EPUB sections and text content (optional - not required for text blocks)
      try {
        const [sections, textContent] = await Promise.all([
          conversionService.getEpubSections(parseInt(jobId)),
          conversionService.getEpubTextContent(parseInt(jobId))
        ]);
        setEpubSections(sections);
        setEpubTextContent(textContent);
      } catch (err) {
        // EPUB content is optional - we're using PDF text blocks instead
        console.warn('EPUB content not available (this is OK if using PDF text blocks):', err.message);
      }

      // Load text blocks from PDF (actual extracted text with coordinates)
      try {
        const textBlocksData = await conversionService.getTextBlocks(parseInt(jobId));
        // Convert text blocks to chunks format for display
        const chunks = [];
        textBlocksData.pages.forEach(page => {
          page.textBlocks.forEach((block, idx) => {
            chunks.push({
              id: block.id || `page_${page.pageNumber}_block_${idx}`,
              pageNumber: page.pageNumber,
              text: block.text,
              x: block.x,
              y: block.y,
              width: block.width,
              height: block.height,
              fontSize: block.fontSize,
              fontName: block.fontName
            });
          });
        });
        setTextChunks(chunks);
      } catch (err) {
        console.warn('Could not extract text blocks from PDF:', err);
        // Fallback to EPUB text extraction
        try {
          const chunks = await audioSyncService.extractTextFromEpub(parseInt(jobId));
          setTextChunks(chunks);
        } catch (epubErr) {
          console.warn('Could not extract text from EPUB either:', epubErr);
        }
      }

      if (audioData && audioData.length > 0) {
        setAudioSegments(audioData);
        const voiceMatch = audioData[0].notes?.match(/voice:\s*(\w+)/);
        if (voiceMatch) {
          setSelectedVoice(voiceMatch[1]);
        }
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message || 'Failed to load audio sync data');
    } finally {
      setLoading(false);
    }
  };

  const loadVoices = async () => {
    try {
      const voicesData = await audioSyncService.getAvailableVoices();
      setVoices(voicesData);
    } catch (err) {
      console.error('Error loading voices:', err);
    }
  };

  const handleGenerateAudio = async () => {
    if (!pdf) {
      setError('PDF not available');
      return;
    }

    // If blocks are selected, generate audio only for selected blocks
    const blocksToGenerate = selectedBlocks.length > 0 
      ? textChunks.filter(chunk => selectedBlocks.includes(chunk.id))
      : textChunks.filter(chunk => chunk.pageNumber === selectedPage);

    if (blocksToGenerate.length === 0) {
      setError('Please select at least one text block to generate audio for');
      return;
    }

    try {
      setGenerating(true);
      setError('');
      
      // Generate audio for selected blocks - pass the actual text blocks
      const segments = await audioSyncService.generateAudio(
        pdf.id,
        parseInt(jobId),
        selectedVoice,
        blocksToGenerate // Pass the actual text blocks
      );
      
      setAudioSegments(segments);
      setSelectedBlocks([]); // Clear selection after generation
      
      // Reload audio syncs to get the updated audio file
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      if (audioData && audioData.length > 0) {
        setAudioSegments(audioData);
        // Force audio player to reload
        if (audioRef.current) {
          audioRef.current.load();
        }
      }
    } catch (err) {
      console.error('Error generating audio:', err);
      setError(err.message || 'Failed to generate audio');
    } finally {
      setGenerating(false);
    }
  };

  const handleBlockSelect = (blockId, event) => {
    // Don't select if clicking on edit button or if editing
    if (editingBlockId === blockId || event.target.closest('.edit-button')) {
      return;
    }
    
    if (event.ctrlKey || event.metaKey) {
      // Multi-select with Ctrl/Cmd
      setSelectedBlocks(prev => 
        prev.includes(blockId) 
          ? prev.filter(id => id !== blockId)
          : [...prev, blockId]
      );
    } else {
      // Single select
      setSelectedBlocks([blockId]);
    }
  };

  const handleStartEdit = (block) => {
    setEditingBlockId(block.id);
    setEditedText(block.text || '');
  };

  const handleSaveEdit = (blockId) => {
    setTextChunks(prev => prev.map(chunk => 
      chunk.id === blockId 
        ? { ...chunk, text: editedText }
        : chunk
    ));
    setEditingBlockId(null);
    setEditedText('');
  };

  const handleCancelEdit = () => {
    setEditingBlockId(null);
    setEditedText('');
  };

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const newTime = percent * duration;
    
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleBlockClick = (block) => {
    const segment = audioSegments.find(s => s.blockId === block.id);
    if (segment && audioRef.current) {
      audioRef.current.currentTime = segment.startTime;
      setCurrentTime(segment.startTime);
    }
  };

  const handleDownloadEpub = async () => {
    try {
      await conversionService.downloadEpub(parseInt(jobId));
    } catch (err) {
      setError(err.message || 'Failed to download EPUB');
    }
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return <div className="loading">Loading audio sync interface...</div>;
  }

  return (
    <div className="audio-sync-container">
      <div className="audio-sync-header">
        <button
          onClick={() => navigate('/conversions')}
          className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <HiOutlineArrowLeft size={20} />
          Back to Conversions
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700' }}>Audio Synchronization</h1>
          <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '14px' }}>
            Job #{jobId} • {pdf?.originalFileName || 'PDF Document'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {job?.status === 'COMPLETED' && (
            <>
              <Link
                to={`/media-overlay-sync/${jobId}/1`}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', backgroundColor: '#9c27b0' }}
              >
                <HiOutlineAdjustments size={18} />
                Media Overlay Sync
              </Link>
              <button
                onClick={handleDownloadEpub}
                className="btn btn-success"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <HiOutlineDownload size={18} />
                Download EPUB
              </button>
            </>
          )}
          <label style={{ fontSize: '14px', fontWeight: '500' }}>Voice:</label>
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            disabled={generating}
            style={{
              padding: '8px 12px',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              fontSize: '14px',
              minWidth: '150px'
            }}
          >
            {voices.map(voice => (
              <option key={voice.id} value={voice.id}>
                {voice.name} {voice.type === 'child' ? '👶' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={handleGenerateAudio}
            disabled={generating || !pdf || selectedBlocks.length === 0}
            className="btn btn-primary"
          >
            {generating ? 'Generating...' : 'Generate Audio'}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="audio-sync-content">
        {/* Left Side - PDF Viewer */}
        <div className="pdf-viewer-panel">
          <div className="panel-header">
            PDF Document
            {pdf && (
              <span style={{ fontSize: '13px', fontWeight: '400', color: '#666', marginLeft: '12px' }}>
                {pdf.originalFileName}
              </span>
            )}
          </div>
          <div className="pdf-viewer">
            {pdf ? (
              <iframe
                src={`/api/pdfs/${pdf.id}/view#toolbar=1&navpanes=1&scrollbar=1&page=1`}
                title="PDF Viewer"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  backgroundColor: '#525252'
                }}
                type="application/pdf"
              />
            ) : (
              <div style={{ 
                padding: '40px', 
                textAlign: 'center', 
                color: '#666',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
                <div style={{ fontSize: '16px', fontWeight: '500' }}>PDF not available</div>
                <div style={{ fontSize: '14px', color: '#999', marginTop: '8px' }}>
                  Please wait while the PDF is being loaded
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side - PDF Text Blocks */}
        <div className="content-viewer-panel">
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#212121' }}>Page:</label>
              <select
                value={selectedPage}
                onChange={(e) => {
                  setSelectedPage(parseInt(e.target.value));
                  setSelectedBlocks([]);
                }}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: '#ffffff',
                  color: '#212121',
                  cursor: 'pointer',
                  minWidth: '100px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease'
                }}
                onFocus={(e) => e.target.style.borderColor = '#90caf9'}
                onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
              >
                {Array.from({ length: Math.max(...(textChunks.map(c => c.pageNumber) || [1])) }, (_, i) => i + 1).map(pageNum => (
                  <option key={pageNum} value={pageNum}>
                    Page {pageNum}
                  </option>
                ))}
              </select>
              {selectedBlocks.length > 0 && (
                <span style={{ fontSize: '13px', color: '#1976d2', fontWeight: '500' }}>
                  {selectedBlocks.length} block{selectedBlocks.length !== 1 ? 's' : ''} selected
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={() => {
                  const pageBlocks = textChunks.filter(c => c.pageNumber === selectedPage).map(c => c.id);
                  setSelectedBlocks(pageBlocks);
                }}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  backgroundColor: '#ffffff',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '12px',
                  transition: 'all 0.2s ease'
                }}
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedBlocks([])}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  backgroundColor: '#ffffff',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '12px',
                  transition: 'all 0.2s ease'
                }}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="content-viewer">
            {(() => {
              const pageBlocks = (textChunks || []).filter(chunk => chunk.pageNumber === selectedPage);
              
              if (pageBlocks.length === 0) {
                return (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
                    No text blocks found for page {selectedPage}
                  </div>
                );
              }
              
              return (
                <div style={{
                  padding: '24px',
                  fontSize: '15px',
                  lineHeight: '1.8',
                  color: '#212121',
                  overflow: 'auto',
                  height: '100%'
                }}>
                  <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#e3f2fd', borderRadius: '8px', fontSize: '14px' }}>
                    <strong>Instructions:</strong> Click on text blocks to select them (hold Ctrl/Cmd for multi-select), then click "Generate Audio" to create audio for selected blocks.
                  </div>
                  
                  <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#1976d2', fontSize: '20px' }}>
                    Page {selectedPage} - {pageBlocks.length} text block{pageBlocks.length !== 1 ? 's' : ''}
                  </h2>
                  
                  <div>
                    {pageBlocks.map((block, idx) => {
                      const isSelected = selectedBlocks.includes(block.id);
                      const isEditing = editingBlockId === block.id;
                      const segment = audioSegments.find(s => s.blockId === block.id);
                      const isActive = segment && currentTime >= segment.startTime && currentTime <= segment.endTime;

                      return (
                        <div
                          key={block.id}
                          onClick={(e) => !isEditing && handleBlockSelect(block.id, e)}
                          style={{
                            marginBottom: '12px',
                            padding: '14px',
                            border: `2px solid ${isEditing ? '#ff9800' : isSelected ? '#1976d2' : isActive ? '#4caf50' : '#e0e0e0'}`,
                            borderRadius: '8px',
                            cursor: isEditing ? 'text' : 'pointer',
                            backgroundColor: isEditing ? '#fff3e0' : isSelected ? '#e3f2fd' : isActive ? '#e8f5e9' : '#fafafa',
                            transition: 'all 0.2s ease',
                            position: 'relative'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected && !isActive && !isEditing) {
                              e.currentTarget.style.backgroundColor = '#f0f0f0';
                              e.currentTarget.style.borderColor = '#bdbdbd';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected && !isActive && !isEditing) {
                              e.currentTarget.style.backgroundColor = '#fafafa';
                              e.currentTarget.style.borderColor = '#e0e0e0';
                            }
                          }}
                        >
                          {isSelected && !isEditing && (
                            <div style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              backgroundColor: '#1976d2',
                              color: 'white',
                              borderRadius: '50%',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: 'bold'
                            }}>
                              ✓
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                            <span style={{ fontSize: '12px', color: '#666', fontWeight: '600' }}>
                              Block {idx + 1}
                            </span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              {segment && (
                                <span style={{ fontSize: '12px', color: '#666' }}>
                                  {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                                </span>
                              )}
                              {!isEditing ? (
                                <button
                                  className="edit-button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartEdit(block);
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    border: '1px solid #e0e0e0',
                                    borderRadius: '4px',
                                    backgroundColor: '#ffffff',
                                    color: '#666',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '11px',
                                    transition: 'all 0.2s ease'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#f5f5f5';
                                    e.currentTarget.style.borderColor = '#bdbdbd';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = '#ffffff';
                                    e.currentTarget.style.borderColor = '#e0e0e0';
                                  }}
                                >
                                  <HiOutlinePencil size={14} />
                                  Edit
                                </button>
                              ) : (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveEdit(block.id);
                                    }}
                                    style={{
                                      padding: '4px 8px',
                                      border: '1px solid #4caf50',
                                      borderRadius: '4px',
                                      backgroundColor: '#4caf50',
                                      color: 'white',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '11px'
                                    }}
                                  >
                                    <HiOutlineCheck size={14} />
                                    Save
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEdit();
                                    }}
                                    style={{
                                      padding: '4px 8px',
                                      border: '1px solid #f44336',
                                      borderRadius: '4px',
                                      backgroundColor: '#f44336',
                                      color: 'white',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '11px'
                                    }}
                                  >
                                    <HiOutlineX size={14} />
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          {isEditing ? (
                            <textarea
                              value={editedText}
                              onChange={(e) => setEditedText(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: '100%',
                                minHeight: '80px',
                                padding: '8px',
                                fontSize: '14px',
                                lineHeight: '1.6',
                                border: '1px solid #ff9800',
                                borderRadius: '4px',
                                fontFamily: 'inherit',
                                resize: 'vertical',
                                marginTop: '8px'
                              }}
                              autoFocus
                            />
                          ) : (
                            <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', paddingRight: isSelected ? '32px' : '0' }}>
                              {block.text || '(Empty block)'}
                            </p>
                          )}
                          {!segment && !isEditing && (
                            <div style={{ marginTop: '8px', fontSize: '12px', color: '#999', fontStyle: 'italic' }}>
                              {isSelected ? 'Selected - will generate audio' : 'Click to select for audio generation'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Bottom - Audio Player */}
      {audioSegments.length > 0 && (
        <div className="audio-player-panel">
          <div className="audio-player">
            <button
              onClick={handlePlayPause}
              className="btn btn-primary"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0
              }}
            >
              {isPlaying ? <HiOutlinePause size={24} /> : <HiOutlinePlay size={24} />}
            </button>

            <div style={{ flex: 1, marginLeft: '16px' }}>
              <div
                className="progress-bar-container"
                onClick={handleSeek}
                style={{ cursor: 'pointer', marginBottom: '8px', position: 'relative' }}
              >
                <div
                  className="progress-bar-fill"
                  style={{
                    width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
                    backgroundColor: '#1976d2'
                  }}
                />
                {audioSegments.map(segment => {
                  if (!duration) return null;
                  const startPercent = (segment.startTime / duration) * 100;
                  const widthPercent = ((segment.endTime - segment.startTime) / duration) * 100;
                  return (
                    <div
                      key={segment.id}
                      style={{
                        position: 'absolute',
                        left: `${startPercent}%`,
                        width: `${widthPercent}%`,
                        height: '100%',
                        backgroundColor: 'rgba(76, 175, 80, 0.3)',
                        border: '1px solid rgba(76, 175, 80, 0.5)',
                        pointerEvents: 'none',
                        top: 0
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666' }}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: '16px' }}>
              <HiOutlineVolumeUp size={20} style={{ color: '#666' }} />
              <input
                type="range"
                min="0"
                max="100"
                defaultValue="100"
                onChange={(e) => {
                  if (audioRef.current) {
                    audioRef.current.volume = e.target.value / 100;
                  }
                }}
                style={{ width: '100px' }}
              />
            </div>

            <audio
              ref={audioRef}
              src={`/api/audio-sync/job/${jobId}/combined-audio`}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioSync;
