import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { audioSyncService } from '../services/audioSyncService';
import { conversionService } from '../services/conversionService';
import { pdfService } from '../services/pdfService';
import { HiOutlinePlay, HiOutlinePause, HiOutlineVolumeUp, HiOutlineArrowLeft, HiOutlineCode, HiOutlineDocumentText, HiOutlineDownload } from 'react-icons/hi';
import './AudioSync.css';

const AudioSync = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const audioRef = useRef(null);
  
  const [job, setJob] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [epubSections, setEpubSections] = useState([]);
  const [epubTextContent, setEpubTextContent] = useState([]);
  const [selectedSection, setSelectedSection] = useState(null);
  const [viewMode, setViewMode] = useState('text'); // 'text' or 'xhtml'
  const [textChunks, setTextChunks] = useState([]);
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

      // Load EPUB sections and text content
      try {
        const [sections, textContent] = await Promise.all([
          conversionService.getEpubSections(parseInt(jobId)),
          conversionService.getEpubTextContent(parseInt(jobId))
        ]);
        setEpubSections(sections);
        setEpubTextContent(textContent);
        if (sections.length > 0) {
          setSelectedSection(sections[0]);
        }
      } catch (err) {
        console.error('Error loading EPUB content:', err);
        setError('Failed to load EPUB content. EPUB file may not be available yet.');
      }

      // Load text chunks for audio syncing (from EPUB)
      try {
        const chunks = await audioSyncService.extractTextFromEpub(parseInt(jobId));
        // Store chunks for audio generation
        setTextChunks(chunks);
      } catch (err) {
        console.warn('Could not extract text from EPUB, will use PDF text:', err);
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
    if (!pdf || !selectedSection) {
      setError('Please select an EPUB section first');
      return;
    }

    try {
      setGenerating(true);
      setError('');
      
      // Generate audio for all EPUB sections
      const segments = await audioSyncService.generateAudio(
        pdf.id,
        parseInt(jobId),
        selectedVoice
      );
      
      setAudioSegments(segments);
    } catch (err) {
      console.error('Error generating audio:', err);
      setError(err.message || 'Failed to generate audio');
    } finally {
      setGenerating(false);
    }
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

  const handleSectionClick = (section) => {
    setSelectedSection(section);
    setSelectedChunk(null);
  };

  const handleChunkClick = (chunk) => {
    setSelectedChunk(chunk);
    const segment = audioSegments.find(s => s.blockId === `chunk_${chunk.id}`);
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

  const currentSectionText = epubTextContent.find(t => t.sectionId === selectedSection?.id);

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
            <button
              onClick={handleDownloadEpub}
              className="btn btn-success"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <HiOutlineDownload size={18} />
              Download EPUB
            </button>
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
            disabled={generating || !pdf || !selectedSection}
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

        {/* Right Side - EPUB Content */}
        <div className="content-viewer-panel">
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#212121' }}>Section:</label>
              <select
                value={selectedSection?.id || ''}
                onChange={(e) => {
                  const section = epubSections.find(s => s.id === parseInt(e.target.value));
                  if (section) handleSectionClick(section);
                }}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: '#ffffff',
                  color: '#212121',
                  cursor: 'pointer',
                  minWidth: '200px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease'
                }}
                onFocus={(e) => e.target.style.borderColor = '#90caf9'}
                onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
              >
                {epubSections.length === 0 ? (
                  <option value="">No sections available</option>
                ) : (
                  epubSections.map(section => (
                    <option key={section.id} value={section.id}>
                      {section.title}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setViewMode('text')}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: viewMode === 'text' ? '#1976d2' : '#f5f5f5',
                  color: viewMode === 'text' ? '#ffffff' : '#666',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  fontWeight: viewMode === 'text' ? '600' : '400',
                  transition: 'all 0.2s ease'
                }}
              >
                <HiOutlineDocumentText size={16} />
                Text
              </button>
              <button
                onClick={() => setViewMode('xhtml')}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: viewMode === 'xhtml' ? '#1976d2' : '#f5f5f5',
                  color: viewMode === 'xhtml' ? '#ffffff' : '#666',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  fontWeight: viewMode === 'xhtml' ? '600' : '400',
                  transition: 'all 0.2s ease'
                }}
              >
                <HiOutlineCode size={16} />
                XHTML
              </button>
            </div>
          </div>
          <div className="content-viewer">
            {selectedSection ? (
              viewMode === 'xhtml' ? (
                <pre style={{
                  margin: 0,
                  padding: '24px',
                  backgroundColor: '#f5f5f5',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  overflow: 'auto',
                  height: '100%',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word'
                }}>
                  {currentSectionText?.xhtml || selectedSection.xhtml}
                </pre>
              ) : (
                <div style={{
                  padding: '24px',
                  fontSize: '15px',
                  lineHeight: '1.8',
                  color: '#212121',
                  overflow: 'auto',
                  height: '100%'
                }}>
                  {(() => {
                    // Filter text chunks for the selected section
                    const sectionChunks = (textChunks || []).filter(chunk => chunk.sectionId === selectedSection.id);
                    
                    if (sectionChunks.length === 0 && currentSectionText) {
                      // Fallback: show text from epubTextContent
                      return (
                        <div>
                          <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#1976d2' }}>
                            {currentSectionText.title}
                          </h2>
                          <div style={{ whiteSpace: 'pre-wrap' }}>
                            {currentSectionText.text.split('\n').filter(p => p.trim()).map((paragraph, idx) => (
                              <div
                                key={idx}
                                style={{
                                  marginBottom: '16px',
                                  padding: '12px',
                                  backgroundColor: '#fafafa',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  transition: 'background-color 0.2s'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fafafa'}
                                onClick={() => {
                                  const chunk = { id: idx + 1, text: paragraph, sectionId: selectedSection.id };
                                  handleChunkClick(chunk);
                                }}
                              >
                                {paragraph}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    
                    if (sectionChunks.length > 0) {
                      return (
                        <div>
                          <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#1976d2' }}>
                            {sectionChunks[0]?.sectionTitle || selectedSection.title}
                          </h2>
                          <div>
                            {sectionChunks.map((chunk, idx) => {
                              const segment = audioSegments.find(s => s.blockId === `chunk_${chunk.id}`);
                              const isSelected = selectedChunk?.id === chunk.id;
                              const isActive = segment && currentTime >= segment.startTime && currentTime <= segment.endTime;

                              return (
                                <div
                                  key={chunk.id}
                                  onClick={() => handleChunkClick(chunk)}
                                  style={{
                                    marginBottom: '16px',
                                    padding: '16px',
                                    border: `2px solid ${isSelected ? '#1976d2' : isActive ? '#4caf50' : '#e0e0e0'}`,
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    backgroundColor: isSelected ? '#e3f2fd' : isActive ? '#e8f5e9' : '#fafafa',
                                    transition: 'all 0.2s ease'
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSelected && !isActive) {
                                      e.currentTarget.style.backgroundColor = '#f0f0f0';
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isSelected && !isActive) {
                                      e.currentTarget.style.backgroundColor = '#fafafa';
                                    }
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '12px', color: '#666', fontWeight: '600' }}>
                                      Chunk {idx + 1}
                                    </span>
                                    {segment && (
                                      <span style={{ fontSize: '12px', color: '#666' }}>
                                        {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                                      </span>
                                    )}
                                  </div>
                                  <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
                                    {chunk.text}
                                  </p>
                                  {!segment && (
                                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#999', fontStyle: 'italic' }}>
                                      Click to sync audio for this chunk
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    
                    return (
                      <div style={{ color: '#999', textAlign: 'center', padding: '40px' }}>
                        No text content available for this section
                      </div>
                    );
                  })()}
                </div>
              )
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                Select an EPUB section to view its content
              </div>
            )}
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
