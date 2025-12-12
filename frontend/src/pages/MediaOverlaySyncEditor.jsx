import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HiOutlinePlay, HiOutlinePause, HiOutlineArrowLeft, HiOutlineDownload, HiOutlineCloudUpload, HiOutlineRefresh } from 'react-icons/hi';
import { conversionService } from '../services/conversionService';
import './MediaOverlaySyncEditor.css';

const MediaOverlaySyncEditor = () => {
  const { jobId, pageNumber } = useParams();
  const navigate = useNavigate();
  const audioRef = useRef(null);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);

  const [pageData, setPageData] = useState({
    pageNumber: parseInt(pageNumber) || 1,
    imagePath: null,
    audioPath: null,
    textBlocks: []
  });

  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [hoveredBlockId, setHoveredBlockId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [audioFileInput, setAudioFileInput] = useState(null);
  const [generatingTts, setGeneratingTts] = useState(false);
  const [regeneratingEpub, setRegeneratingEpub] = useState(false);
  const [waveformData, setWaveformData] = useState(null);
  const [syncValidation, setSyncValidation] = useState({ warnings: [], errors: [] });

  // Load total pages count on mount
  useEffect(() => {
    loadTotalPages();
  }, [jobId]);

  // Load page data on mount
  useEffect(() => {
    loadPageData();
  }, [jobId, pageNumber]);

  const loadTotalPages = async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/pages/count`);
      if (response.ok) {
        const data = await response.json();
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.warn('Could not load total pages count:', err);
      // Keep default value
    }
  };

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
  }, [pageData.audioPath]);

  const loadPageData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/jobs/${jobId}/page/${pageNumber}/data`);
      
      if (response.status === 404) {
        throw new Error(`Page ${pageNumber} not found. Please check if the conversion completed successfully.`);
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to load page data: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Validate data structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid page data received from server');
      }
      
      setPageData(data);
      
      // Update image dimensions if provided
      if (data.imageDimensions) {
        setImageDimensions({
          width: data.imageDimensions.width || 0,
          height: data.imageDimensions.height || 0
        });
      }
    } catch (err) {
      console.error('Error loading page data:', err);
      setError(err.message || 'Failed to load page data');
      // Set empty data to prevent crashes
      setPageData({
        pageNumber: parseInt(pageNumber) || 1,
        imagePath: null,
        audioPath: null,
        textBlocks: []
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const img = imageRef.current;
    if (img && img.complete) {
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    } else if (img) {
      img.onload = () => {
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      };
    }
  }, [pageData.imagePath]);

  useEffect(() => {
    // Redraw when image loads or dimensions change
    const img = imageRef.current;
    if (img && img.complete && imageDimensions.width > 0) {
      drawBoundingBoxes();
    }
  }, [selectedBlockId, hoveredBlockId, imageDimensions, pageData.textBlocks]);

  useEffect(() => {
    // Redraw on window resize
    const handleResize = () => {
      if (imageDimensions.width > 0) {
        drawBoundingBoxes();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [imageDimensions]);

  const drawBoundingBoxes = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || imageDimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    const container = img.parentElement;
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    
    // Set canvas size to match displayed image
    canvas.width = imgRect.width;
    canvas.height = imgRect.height;
    
    // Position canvas to overlay the image
    canvas.style.width = imgRect.width + 'px';
    canvas.style.height = imgRect.height + 'px';
    canvas.style.left = (imgRect.left - containerRect.left) + 'px';
    canvas.style.top = (imgRect.top - containerRect.top) + 'px';

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw bounding boxes
    pageData.textBlocks.forEach(block => {
      const isSelected = block.id === selectedBlockId;
      const isHovered = block.id === hoveredBlockId;
      
      if (!isSelected && !isHovered) return;

      // Coordinates are now normalized (0-1) from backend
      // Convert normalized coordinates to canvas pixels
      const x = block.x * canvas.width;
      const y = block.y * canvas.height;
      const w = block.w * canvas.width;
      const h = block.h * canvas.height;

      // Draw bounding box
      ctx.strokeStyle = isSelected ? '#1976d2' : '#4caf50';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.fillStyle = isSelected ? 'rgba(25, 118, 210, 0.2)' : 'rgba(76, 175, 80, 0.15)';
      
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    });
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

  const handleSetTime = (type) => {
    if (!selectedBlockId) {
      alert('Please select a text block first');
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      alert('Audio not loaded');
      return;
    }

    const time = parseFloat(audio.currentTime.toFixed(3));
    
    setPageData(prev => ({
      ...prev,
      textBlocks: prev.textBlocks.map(block => {
        if (block.id === selectedBlockId) {
          return {
            ...block,
            [type === 'begin' ? 'clipBegin' : 'clipEnd']: time
          };
        }
        return block;
      })
    }));
  };

  const handleTimeInputChange = (blockId, field, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;

    setPageData(prev => ({
      ...prev,
      textBlocks: prev.textBlocks.map(block => {
        if (block.id === blockId) {
          return {
            ...block,
            [field]: numValue
          };
        }
        return block;
      })
    }));
  };

  // Validate sync data
  const validateSyncs = (blocks, audioDuration) => {
    const warnings = [];
    const errors = [];
    
    // Filter blocks with sync data
    const syncedBlocks = blocks
      .filter(block => block.clipBegin !== null && block.clipEnd !== null)
      .sort((a, b) => a.clipBegin - b.clipBegin);

    if (syncedBlocks.length === 0) {
      return { warnings: [], errors: [] };
    }

    // Check each block
    syncedBlocks.forEach((block, index) => {
      // Check clipEnd doesn't exceed audio duration
      if (audioDuration > 0 && block.clipEnd > audioDuration) {
        errors.push({
          blockId: block.id,
          type: 'duration_exceeded',
          message: `Block "${block.text.substring(0, 30)}..." clipEnd (${block.clipEnd.toFixed(2)}s) exceeds audio duration (${audioDuration.toFixed(2)}s)`
        });
      }

      // Check clipBegin < clipEnd
      if (block.clipEnd <= block.clipBegin) {
        errors.push({
          blockId: block.id,
          type: 'invalid_range',
          message: `Block "${block.text.substring(0, 30)}..." clipBegin (${block.clipBegin.toFixed(2)}s) must be less than clipEnd (${block.clipEnd.toFixed(2)}s)`
        });
      }

      // Check for overlaps with next block
      if (index < syncedBlocks.length - 1) {
        const nextBlock = syncedBlocks[index + 1];
        if (block.clipEnd > nextBlock.clipBegin) {
          warnings.push({
            blockId: block.id,
            nextBlockId: nextBlock.id,
            type: 'overlap',
            message: `Block "${block.text.substring(0, 30)}..." overlaps with next block. End: ${block.clipEnd.toFixed(2)}s, Next start: ${nextBlock.clipBegin.toFixed(2)}s`
          });
        }
      }

      // Check for gaps with next block (if not last block)
      if (index < syncedBlocks.length - 1) {
        const nextBlock = syncedBlocks[index + 1];
        const gap = nextBlock.clipBegin - block.clipEnd;
        if (gap > 0.5) { // Warn if gap is more than 0.5 seconds
          warnings.push({
            blockId: block.id,
            nextBlockId: nextBlock.id,
            type: 'gap',
            message: `Gap of ${gap.toFixed(2)}s between block "${block.text.substring(0, 30)}..." and next block`
          });
        }
      }
    });

    // Check if first block starts at 0
    if (syncedBlocks.length > 0 && syncedBlocks[0].clipBegin > 0.1) {
      warnings.push({
        blockId: syncedBlocks[0].id,
        type: 'start_delay',
        message: `First block starts at ${syncedBlocks[0].clipBegin.toFixed(2)}s. Consider starting at 0s.`
      });
    }

    // Check if last block ends before audio ends
    if (syncedBlocks.length > 0 && audioDuration > 0) {
      const lastBlock = syncedBlocks[syncedBlocks.length - 1];
      const remaining = audioDuration - lastBlock.clipEnd;
      if (remaining > 0.5) {
        warnings.push({
          blockId: lastBlock.id,
          type: 'end_early',
          message: `Last block ends at ${lastBlock.clipEnd.toFixed(2)}s, but audio continues for ${remaining.toFixed(2)}s more`
        });
      }
    }

    return { warnings, errors };
  };

  // Update validation when sync data or audio duration changes
  useEffect(() => {
    if (pageData.textBlocks && duration > 0) {
      const validation = validateSyncs(pageData.textBlocks, duration);
      setSyncValidation(validation);
    } else {
      setSyncValidation({ warnings: [], errors: [] });
    }
  }, [pageData.textBlocks, duration]);

  const handleExportSync = async () => {
    try {
      setSaving(true);
      
      // Validate we have blocks
      if (!pageData.textBlocks || pageData.textBlocks.length === 0) {
        alert('No text blocks available to sync. Please ensure the page has been processed.');
        return;
      }
      
      // Prepare sync data
      const syncData = pageData.textBlocks
        .filter(block => block.clipBegin !== null && block.clipEnd !== null)
        .map(block => ({
          id: block.id,
          clipBegin: block.clipBegin,
          clipEnd: block.clipEnd,
          audioFileName: pageData.audioPath 
            ? pageData.audioPath.split('/').pop() 
            : `page_${pageData.pageNumber}_human.mp3`
        }));

      if (syncData.length === 0) {
        alert('No sync data to save. Please set clipBegin and clipEnd for at least one block.');
        return;
      }

      // Validate sync data
      const validation = validateSyncs(pageData.textBlocks, duration);
      
      if (validation.errors.length > 0) {
        const errorMessages = validation.errors.map(e => e.message).join('\n');
        alert(`Cannot save sync data due to errors:\n\n${errorMessages}\n\nPlease fix these errors before saving.`);
        return;
      }

      // Warn about warnings but allow save
      if (validation.warnings.length > 0) {
        const warningMessages = validation.warnings.map(w => w.message).join('\n');
        const proceed = confirm(`Warning: ${validation.warnings.length} issue(s) detected:\n\n${warningMessages}\n\nDo you want to save anyway?`);
        if (!proceed) {
          return;
        }
      }

      // Save to server
      const response = await fetch(`/api/jobs/${jobId}/page/${pageNumber}/syncs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(syncData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save syncs: ${response.statusText}`);
      }

      const result = await response.json();
      alert(`Successfully saved ${syncData.length} sync entries for page ${pageNumber}`);
      
      // Optionally also download locally
      const jsonStr = JSON.stringify(syncData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manual_page_syncs_${pageData.pageNumber}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('Error saving syncs:', err);
      alert(`Failed to save syncs: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateTts = async () => {
    try {
      setGeneratingTts(true);
      setError(null);
      
      if (!pageData.textBlocks || pageData.textBlocks.length === 0) {
        alert('No text blocks available for TTS generation. Please ensure the page has been processed.');
        return;
      }

      const response = await fetch(`/api/jobs/${jobId}/page/${pageNumber}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Handle TTS not available error
        if (response.status === 503 && errorData.requiresCredentials) {
          alert(`TTS service is not available.\n\n${errorData.message}\n\nYou can upload human-narrated audio files instead using the "Upload Audio" button.`);
          return;
        }
        
        throw new Error(errorData.error || `Failed to generate TTS: ${response.statusText}`);
      }

      const result = await response.json();
      alert(`TTS audio generated successfully! ${result.syncs?.length || 0} sync entries created.`);
      
      // Reload page data to get new audio and syncs
      await loadPageData();
      
    } catch (err) {
      console.error('Error generating TTS:', err);
      setError(err.message || 'Failed to generate TTS');
      alert(`Failed to generate TTS: ${err.message}`);
    } finally {
      setGeneratingTts(false);
    }
  };

  const handleDownloadEpub = async () => {
    try {
      await conversionService.downloadEpub(parseInt(jobId));
    } catch (err) {
      console.error('Error downloading EPUB:', err);
      alert(`Failed to download EPUB: ${err.message}`);
    }
  };

  const handleRegenerateEpub = async () => {
    if (!confirm('This will regenerate the EPUB file with updated sync data. Continue?')) {
      return;
    }

    try {
      setRegeneratingEpub(true);
      setError(null);

      const response = await fetch(`/api/conversions/${jobId}/regenerate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to regenerate EPUB: ${response.statusText}`);
      }

      const result = await response.json();
      alert(`EPUB regenerated successfully! The updated file includes your latest sync changes.`);
      
      // Optionally trigger download
      if (confirm('Would you like to download the regenerated EPUB file now?')) {
        handleDownloadEpub();
      }
      
    } catch (err) {
      console.error('Error regenerating EPUB:', err);
      setError(err.message || 'Failed to regenerate EPUB');
      alert(`Failed to regenerate EPUB: ${err.message}`);
    } finally {
      setRegeneratingEpub(false);
    }
  };

  // Load waveform data when audio loads
  useEffect(() => {
    const loadWaveform = async () => {
      if (!pageData.audioPath) {
        setWaveformData(null);
        return;
      }

      try {
        // Use Web Audio API to generate waveform
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const response = await fetch(pageData.audioPath);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Extract waveform data
        const rawData = audioBuffer.getChannelData(0);
        const samples = 200; // Number of waveform points
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];
        
        for (let i = 0; i < samples; i++) {
          const blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockStart + j]);
          }
          filteredData.push(sum / blockSize);
        }
        
        // Normalize
        const max = Math.max(...filteredData);
        const normalized = filteredData.map(n => n / max);
        
        setWaveformData({
          points: normalized,
          duration: audioBuffer.duration
        });
      } catch (err) {
        console.warn('Could not generate waveform:', err);
        setWaveformData(null);
      }
    };

    if (pageData.audioPath) {
      loadWaveform();
    }
  }, [pageData.audioPath]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAudioUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('audio/') && 
        !file.name.toLowerCase().endsWith('.mp3') &&
        !file.name.toLowerCase().endsWith('.wav') &&
        !file.name.toLowerCase().endsWith('.m4a')) {
      alert('Please select an audio file (MP3, WAV, or M4A)');
      return;
    }

    // Validate file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      alert('Audio file size must be less than 50MB');
      return;
    }

    try {
      setUploadingAudio(true);
      
      const formData = new FormData();
      formData.append('audioFile', file);

      const response = await fetch(`/api/jobs/${jobId}/page/${pageNumber}/audio`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to upload audio: ${response.statusText}`);
      }

      const result = await response.json();
      alert(`Audio uploaded successfully!`);
      
      // Reload page data to get the new audio path
      await loadPageData();
      
      // Reset file input
      if (audioFileInput) {
        audioFileInput.value = '';
      }
    } catch (err) {
      console.error('Error uploading audio:', err);
      alert(`Failed to upload audio: ${err.message}`);
    } finally {
      setUploadingAudio(false);
    }
  };

  const selectedBlock = pageData.textBlocks.find(b => b.id === selectedBlockId);

  if (loading) {
    return (
      <div className="media-overlay-sync-editor">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', marginBottom: '12px' }}>Loading page data...</div>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #1976d2',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '20px auto'
          }}></div>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="media-overlay-sync-editor">
        <div style={{ padding: '40px', textAlign: 'center', color: '#d32f2f' }}>
          <div style={{ fontSize: '18px', marginBottom: '12px' }}>Error</div>
          <div>{error}</div>
          <button
            onClick={() => navigate('/conversions')}
            className="btn btn-secondary"
            style={{ marginTop: '20px' }}
          >
            <HiOutlineArrowLeft size={20} />
            Back to Conversions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="media-overlay-sync-editor">
      <div className="editor-header">
        <button
          onClick={() => navigate('/conversions')}
          className="btn btn-secondary"
        >
          <HiOutlineArrowLeft size={20} />
          Back
        </button>
        <h1>EPUB Media Overlay Sync Editor</h1>
        <div className="header-actions">
          {/* Sync validation summary */}
          {(syncValidation.errors.length > 0 || syncValidation.warnings.length > 0) && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              padding: '8px 12px',
              borderRadius: '6px',
              backgroundColor: syncValidation.errors.length > 0 ? '#ffebee' : '#fff3e0',
              color: syncValidation.errors.length > 0 ? '#d32f2f' : '#f57c00',
              fontSize: '13px',
              fontWeight: '500'
            }}>
              {syncValidation.errors.length > 0 && (
                <span>⚠ {syncValidation.errors.length} error(s)</span>
              )}
              {syncValidation.warnings.length > 0 && (
                <span>⚠ {syncValidation.warnings.length} warning(s)</span>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="page-info">Page</span>
            <select
              value={pageNumber}
              onChange={(e) => {
                const newPage = parseInt(e.target.value);
                navigate(`/media-overlay-sync/${jobId}/${newPage}`);
              }}
              style={{
                padding: '8px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: '#ffffff',
                color: '#212121',
                cursor: 'pointer',
                minWidth: '80px'
              }}
            >
              {Array.from({ length: Math.max(totalPages, parseInt(pageNumber), 1) }, (_, i) => i + 1).map(pageNum => (
                <option key={pageNum} value={pageNum}>
                  {pageNum}
                </option>
              ))}
            </select>
            {totalPages > 0 && <span className="page-info">of {totalPages}</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={handleGenerateTts}
              className="btn btn-primary"
              disabled={generatingTts || loading}
              style={{ backgroundColor: '#ff9800' }}
            >
              {generatingTts ? 'Generating TTS...' : 'Generate TTS'}
            </button>
            <label className="btn btn-secondary" style={{ cursor: uploadingAudio ? 'not-allowed' : 'pointer', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', opacity: uploadingAudio ? 0.6 : 1 }}>
              <HiOutlineCloudUpload size={18} />
              {uploadingAudio ? 'Uploading...' : 'Upload Audio'}
              <input
                ref={(input) => setAudioFileInput(input)}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a"
                onChange={handleAudioUpload}
                style={{ display: 'none' }}
                disabled={uploadingAudio}
              />
            </label>
            <button
              onClick={handleExportSync}
              className="btn btn-primary"
              disabled={saving || loading}
            >
              <HiOutlineDownload size={18} />
              {saving ? 'Saving...' : 'Save Sync JSON'}
            </button>
            <button
              onClick={handleRegenerateEpub}
              className="btn btn-success"
              disabled={regeneratingEpub || loading}
              style={{ backgroundColor: '#4caf50', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <HiOutlineRefresh size={18} />
              {regeneratingEpub ? 'Regenerating...' : 'Regenerate EPUB'}
            </button>
            <button
              onClick={handleDownloadEpub}
              className="btn btn-primary"
              disabled={loading}
              style={{ backgroundColor: '#2196f3', display: 'flex', alignItems: 'center', gap: '8px' }}
              title="Download the EPUB file"
            >
              <HiOutlineDownload size={18} />
              Download EPUB
            </button>
          </div>
        </div>
      </div>

      <div className="editor-content">
        {/* Left Column - Image View and Audio Controls */}
        <div className="left-column">
          <div className="image-viewer-panel">
            <div className="panel-header">Page Image</div>
            <div className="image-container">
              {pageData.imagePath ? (
                <>
                  <img
                    ref={imageRef}
                    src={pageData.imagePath}
                    alt={`Page ${pageData.pageNumber}`}
                    className="page-image"
                    onLoad={() => {
                      if (imageRef.current) {
                        setImageDimensions({
                          width: imageRef.current.naturalWidth,
                          height: imageRef.current.naturalHeight
                        });
                      }
                    }}
                    onError={(e) => {
                      console.error('Failed to load page image:', pageData.imagePath);
                      e.target.style.display = 'none';
                      const errorDiv = e.target.nextElementSibling;
                      if (errorDiv && errorDiv.classList.contains('image-error')) {
                        errorDiv.style.display = 'block';
                      }
                    }}
                  />
                  <div className="image-error" style={{ display: 'none', padding: '40px', textAlign: 'center', color: '#d32f2f' }}>
                    <div style={{ fontSize: '16px', marginBottom: '8px' }}>⚠️ Image not found</div>
                    <div style={{ fontSize: '14px', color: '#666' }}>
                      The page image may not have been generated yet. Please check if the conversion completed successfully.
                    </div>
                  </div>
                  <canvas
                    ref={canvasRef}
                    className="bounding-box-canvas"
                  />
                </>
              ) : (
                <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                  <div style={{ fontSize: '16px', marginBottom: '8px' }}>📄 Page image not available</div>
                  <div style={{ fontSize: '14px', color: '#999' }}>
                    The page image may not have been generated yet.
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="audio-controls-panel">
            <div className="panel-header">Audio Controls</div>
            <div className="audio-player-container">
              {pageData.audioPath ? (
                <>
                  <audio
                    ref={audioRef}
                    src={pageData.audioPath}
                    style={{ display: 'none' }}
                  />

                  <button
                    onClick={handlePlayPause}
                    className="play-pause-btn"
                  >
                    {isPlaying ? <HiOutlinePause size={24} /> : <HiOutlinePlay size={24} />}
                  </button>

                  <div className="audio-progress-container">
                    <div
                      className="audio-progress-bar"
                      onClick={handleSeek}
                    >
                      <div
                        className="audio-progress-fill"
                        style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
                      />
                    </div>
                    {/* Waveform visualization */}
                    {waveformData && waveformData.points && (
                      <div
                        className="waveform-container"
                        onClick={(e) => {
                          if (!duration) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX - rect.left;
                          const percent = x / rect.width;
                          const newTime = percent * duration;
                          if (audioRef.current) {
                            audioRef.current.currentTime = newTime;
                            setCurrentTime(newTime);
                          }
                        }}
                        style={{
                          height: '60px',
                          marginTop: '8px',
                          marginBottom: '8px',
                          position: 'relative',
                          cursor: 'pointer',
                          backgroundColor: '#f5f5f5',
                          borderRadius: '4px',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title="Click to seek"
                      >
                        <svg
                          width="100%"
                          height="100%"
                          style={{ display: 'block' }}
                        >
                          {/* Waveform lines */}
                          {waveformData.points.map((point, index) => {
                            const x = (index / waveformData.points.length) * 100;
                            const height = point * 80; // Scale to 80% of container height
                            const isActive = duration > 0 && (currentTime / duration) * 100 >= x;
                            return (
                              <line
                                key={index}
                                x1={`${x}%`}
                                y1={`${50 - height / 2}%`}
                                x2={`${x}%`}
                                y2={`${50 + height / 2}%`}
                                stroke={isActive ? '#1976d2' : '#666'}
                                strokeWidth="1.5"
                              />
                            );
                          })}
                          {/* Sync points overlay */}
                          {pageData.textBlocks
                            .filter(block => block.clipBegin !== null && block.clipEnd !== null && duration > 0)
                            .map(block => {
                              const beginX = (block.clipBegin / duration) * 100;
                              const endX = (block.clipEnd / duration) * 100;
                              const isActive = currentTime >= block.clipBegin && currentTime <= block.clipEnd;
                              return (
                                <rect
                                  key={block.id}
                                  x={`${beginX}%`}
                                  y="0%"
                                  width={`${endX - beginX}%`}
                                  height="100%"
                                  fill={isActive ? 'rgba(25, 118, 210, 0.25)' : 'rgba(76, 175, 80, 0.15)'}
                                  stroke={isActive ? '#1976d2' : '#4caf50'}
                                  strokeWidth="1"
                                  opacity="0.7"
                                />
                              );
                            })}
                          {/* Current time indicator */}
                          {duration > 0 && (
                            <line
                              x1={`${(currentTime / duration) * 100}%`}
                              y1="0%"
                              x2={`${(currentTime / duration) * 100}%`}
                              y2="100%"
                              stroke="#1976d2"
                              strokeWidth="2"
                              opacity="0.8"
                            />
                          )}
                        </svg>
                      </div>
                    )}
                    <div className="audio-time-display">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  <div className="time-setter-buttons">
                    <button
                      onClick={() => handleSetTime('begin')}
                      disabled={!selectedBlockId}
                      className="btn btn-small"
                    >
                      Set Current Time as Begin
                    </button>
                    <button
                      onClick={() => handleSetTime('end')}
                      disabled={!selectedBlockId}
                      className="btn btn-small"
                    >
                      Set Current Time as End
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
                  <div style={{ marginBottom: '12px' }}>No audio file available for this page</div>
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    Audio will be available after TTS generation or manual upload
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Text Block List and Timing Controls */}
        <div className="right-column">
          <div className="text-blocks-panel">
            <div className="panel-header">Text Blocks & Timing</div>
            <div className="text-blocks-list">
              {pageData.textBlocks && pageData.textBlocks.length > 0 ? (
                pageData.textBlocks.map((block, index) => (
                <div
                  key={block.id}
                  className={`text-block-item ${selectedBlockId === block.id ? 'selected' : ''}`}
                  onMouseEnter={() => setHoveredBlockId(block.id)}
                  onMouseLeave={() => setHoveredBlockId(null)}
                  onClick={() => setSelectedBlockId(block.id)}
                  style={{
                    borderLeftWidth: syncValidation.errors.some(e => e.blockId === block.id) ? '4px' : '2px',
                    borderLeftColor: syncValidation.errors.some(e => e.blockId === block.id) 
                      ? '#d32f2f' 
                      : syncValidation.warnings.some(w => w.blockId === block.id)
                      ? '#ff9800'
                      : undefined
                  }}
                >
                  <div className="block-header">
                    <span className="block-number">Block {index + 1}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {syncValidation.errors.some(e => e.blockId === block.id) && (
                        <span style={{ fontSize: '12px', color: '#d32f2f', fontWeight: '600' }}>⚠ Error</span>
                      )}
                      {syncValidation.warnings.some(w => w.blockId === block.id) && !syncValidation.errors.some(e => e.blockId === block.id) && (
                        <span style={{ fontSize: '12px', color: '#f57c00', fontWeight: '600' }}>⚠ Warning</span>
                      )}
                      {block.clipBegin !== null && block.clipEnd !== null && 
                       !syncValidation.errors.some(e => e.blockId === block.id) && 
                       !syncValidation.warnings.some(w => w.blockId === block.id) && (
                        <span style={{ fontSize: '12px', color: '#4caf50', fontWeight: '600' }}>✓ Valid</span>
                      )}
                      {selectedBlockId === block.id && (
                        <span className="selected-indicator">✓ Selected</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="block-text">{block.text}</div>
                  
                  <div className="block-timing-controls">
                    <div className="timing-input-group">
                      <label>clipBegin (s):</label>
                      <input
                        type="number"
                        step="0.001"
                        value={block.clipBegin ?? ''}
                        onChange={(e) => handleTimeInputChange(block.id, 'clipBegin', e.target.value)}
                        className={`timing-input ${
                          syncValidation.errors.some(e => e.blockId === block.id && e.type === 'invalid_range') ? 'input-error' : ''
                        }`}
                        style={{
                          borderColor: syncValidation.errors.some(e => e.blockId === block.id && e.type === 'invalid_range') ? '#d32f2f' : undefined
                        }}
                      />
                    </div>
                    <div className="timing-input-group">
                      <label>clipEnd (s):</label>
                      <input
                        type="number"
                        step="0.001"
                        value={block.clipEnd ?? ''}
                        onChange={(e) => handleTimeInputChange(block.id, 'clipEnd', e.target.value)}
                        className={`timing-input ${
                          syncValidation.errors.some(e => e.blockId === block.id && (e.type === 'duration_exceeded' || e.type === 'invalid_range')) ? 'input-error' : ''
                        }`}
                        style={{
                          borderColor: syncValidation.errors.some(e => e.blockId === block.id && (e.type === 'duration_exceeded' || e.type === 'invalid_range')) ? '#d32f2f' : undefined
                        }}
                      />
                      {duration > 0 && block.clipEnd !== null && block.clipEnd > duration && (
                        <span style={{ fontSize: '11px', color: '#d32f2f', marginTop: '4px', display: 'block' }}>
                          ⚠ Exceeds audio duration ({duration.toFixed(2)}s)
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Validation indicators */}
                  {syncValidation.errors.filter(e => e.blockId === block.id).length > 0 && (
                    <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#ffebee', borderRadius: '4px', fontSize: '12px' }}>
                      {syncValidation.errors
                        .filter(e => e.blockId === block.id)
                        .map((error, idx) => (
                          <div key={idx} style={{ color: '#d32f2f', marginBottom: '4px' }}>
                            ⚠ {error.message}
                          </div>
                        ))}
                    </div>
                  )}
                  
                  {syncValidation.warnings.filter(w => w.blockId === block.id).length > 0 && (
                    <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff3e0', borderRadius: '4px', fontSize: '12px' }}>
                      {syncValidation.warnings
                        .filter(w => w.blockId === block.id)
                        .map((warning, idx) => (
                          <div key={idx} style={{ color: '#f57c00', marginBottom: '4px' }}>
                            ⚠ {warning.message}
                          </div>
                        ))}
                    </div>
                  )}

                  {selectedBlockId === block.id && (
                    <div className="block-info">
                      <div className="info-row">
                        <span>Position:</span>
                        <span>x: {block.x?.toFixed(2) || 0}, y: {block.y?.toFixed(2) || 0}</span>
                      </div>
                      <div className="info-row">
                        <span>Size:</span>
                        <span>w: {block.w?.toFixed(2) || 0}, h: {block.h?.toFixed(2) || 0}</span>
                      </div>
                      {block.clipBegin !== null && block.clipEnd !== null && (
                        <>
                          <div className="info-row">
                            <span>Duration:</span>
                            <span>{(block.clipEnd - block.clipBegin).toFixed(3)}s</span>
                          </div>
                          {duration > 0 && (
                            <div className="info-row">
                              <span>Audio Coverage:</span>
                              <span>{((block.clipEnd - block.clipBegin) / duration * 100).toFixed(1)}%</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
              ) : (
                <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                  <div style={{ fontSize: '16px', marginBottom: '8px' }}>📝 No text blocks found</div>
                  <div style={{ fontSize: '14px', color: '#999' }}>
                    {error 
                      ? 'Unable to load text blocks. Please check if the conversion completed successfully.'
                      : 'This page may not have any extractable text blocks, or the text extraction may not have completed yet.'
                    }
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MediaOverlaySyncEditor;

