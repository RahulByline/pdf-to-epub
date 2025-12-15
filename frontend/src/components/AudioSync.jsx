import React, { useState, useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import './AudioSync.css';

const AudioSync = ({ 
  audioUrl, 
  mappings, 
  structure = [],
  onMappingAdd, 
  onMappingUpdate, 
  onMappingDelete,
  selectedTextId,
  onTextSelect 
}) => {
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [editingMapping, setEditingMapping] = useState(null);
  const [tempStart, setTempStart] = useState('');
  const [tempEnd, setTempEnd] = useState('');

  // Initialize WaveSurfer
  useEffect(() => {
    if (waveformRef.current && audioUrl) {
      wavesurferRef.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#4CAF50',
        progressColor: '#2196F3',
        cursorColor: '#f44336',
        barWidth: 2,
        barRadius: 3,
        responsive: true,
        height: 100,
        normalize: true
      });

      wavesurferRef.current.load(audioUrl);

      wavesurferRef.current.on('ready', () => {
        setDuration(wavesurferRef.current.getDuration());
      });

      wavesurferRef.current.on('play', () => {
        setIsPlaying(true);
      });

      wavesurferRef.current.on('pause', () => {
        setIsPlaying(false);
      });

      wavesurferRef.current.on('timeupdate', (time) => {
        setCurrentTime(time);
      });

      wavesurferRef.current.on('seek', (time) => {
        setCurrentTime(time);
      });

      return () => {
        if (wavesurferRef.current) {
          try {
            wavesurferRef.current.destroy();
          } catch (error) {
            // Ignore cleanup errors
            console.debug('WaveSurfer cleanup error (safe to ignore):', error.message);
          }
        }
      };
    }
  }, [audioUrl]);

  // Format time as HH:MM:SS
  const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return '0:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Parse time string (HH:MM:SS.mmm or HH:MM:SS or MM:SS or SS) to seconds
  const parseTime = (timeStr) => {
    if (!timeStr) return 0;
    
    // Handle SMIL format with milliseconds (HH:MM:SS.mmm)
    if (timeStr.includes('.')) {
      const [timePart, milliPart] = timeStr.split('.');
      const parts = timePart.split(':').map(Number);
      const milliseconds = parseFloat(`0.${milliPart || '0'}`);
      
      if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2] + milliseconds;
      } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1] + milliseconds;
      } else {
        return (parts[0] || 0) + milliseconds;
      }
    }
    
    // Handle regular format (HH:MM:SS or MM:SS or SS)
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else {
      return parts[0] || 0;
    }
  };

  // Format seconds to SMIL time format (HH:MM:SS.mmm)
  const formatSMILTime = (seconds) => {
    if (!seconds && seconds !== 0) return '0:00:00.000';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60);
    const sInt = Math.floor(s);
    const sDec = Math.round((s - sInt) * 1000);
    return `${h}:${m.toString().padStart(2, '0')}:${sInt.toString().padStart(2, '0')}.${sDec.toString().padStart(3, '0')}`;
  };

  const handlePlayPause = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  const handleSetStart = () => {
    if (wavesurferRef.current) {
      const time = formatSMILTime(currentTime);
      setTempStart(time);
      
      // If editing existing mapping, auto-save if both times are set
      if (editingMapping && editingMapping._index !== undefined) {
        const endTime = tempEnd || editingMapping.end;
        if (endTime && time) {
          handleUpdateMapping(editingMapping._index, time, endTime);
        }
      }
    }
  };

  const handleSetEnd = () => {
    if (wavesurferRef.current) {
      const time = formatSMILTime(currentTime);
      setTempEnd(time);
      
      // If editing existing mapping, auto-save if both times are set
      if (editingMapping && editingMapping._index !== undefined) {
        const startTime = tempStart || editingMapping.start;
        if (startTime && time) {
          handleUpdateMapping(editingMapping._index, startTime, time);
        }
      }
    }
  };

  const handleSaveMapping = () => {
    if (selectedTextId && tempStart && tempEnd) {
      if (editingMapping && editingMapping._index !== undefined) {
        // Update existing mapping
        handleUpdateMapping(editingMapping._index, tempStart, tempEnd);
        handleCancelEdit();
      } else if (onMappingAdd) {
        // Add new mapping
        onMappingAdd({
          textId: selectedTextId,
          start: tempStart,
          end: tempEnd
        });
        setTempStart('');
        setTempEnd('');
        setEditingMapping(null);
      }
    }
  };

  const handleUpdateMapping = (index, start, end) => {
    if (onMappingUpdate && index !== null && index !== undefined) {
      onMappingUpdate(index, start, end);
    }
  };

  const handleDeleteMapping = (index) => {
    if (onMappingDelete && index !== null && index !== undefined) {
      if (window.confirm('Are you sure you want to delete this audio mapping?')) {
        onMappingDelete(index);
        // Clear editing if the deleted mapping was being edited
        if (editingMapping && mappings[index] && editingMapping.textId === mappings[index].textId) {
          setEditingMapping(null);
          setTempStart('');
          setTempEnd('');
        }
      }
    }
  };

  const handleEditMapping = (mapping, index) => {
    setEditingMapping({ ...mapping, _index: index });
    setTempStart(mapping.start);
    setTempEnd(mapping.end);
    onTextSelect && onTextSelect(mapping.textId);
    
    // Seek to start time
    if (wavesurferRef.current && duration > 0) {
      const startSeconds = parseTime(mapping.start);
      wavesurferRef.current.seekTo(startSeconds / duration);
    }
  };

  const handleCancelEdit = () => {
    setEditingMapping(null);
    setTempStart('');
    setTempEnd('');
  };

  const handleSaveEdit = () => {
    if (editingMapping && editingMapping._index !== undefined && tempStart && tempEnd) {
      handleUpdateMapping(editingMapping._index, tempStart, tempEnd);
      handleCancelEdit();
    }
  };

  return (
    <div className="audio-sync-container">
      <div className="audio-sync-header">
        <h2>Audio Synchronization</h2>
      </div>

      {/* Text Structure List - Always visible */}
      <div className="text-structure-section">
        <h3>Extracted Text Structure</h3>
        <div className="text-structure-list">
          {structure && structure.length > 0 ? (
            structure.map((item, index) => {
              const isMapped = mappings && mappings.some(m => m.textId === item.id);
              const isSelected = selectedTextId === item.id;
              
              return (
                <div
                  key={index}
                  className={`text-structure-item ${isSelected ? 'selected' : ''} ${isMapped ? 'mapped' : ''}`}
                  onClick={() => onTextSelect && onTextSelect(item.id)}
                >
                  <div className="text-item-header">
                    <span className="text-item-id">{item.id}</span>
                    <span className="text-item-type">{item.type}</span>
                    {isMapped && <span className="mapped-badge">✓ Mapped</span>}
                  </div>
                  <div className="text-item-content">
                    {item.text && item.text.length > 100 
                      ? `${item.text.substring(0, 100)}...` 
                      : item.text}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="no-text-message">No text structure available.</div>
          )}
        </div>
      </div>

      {audioUrl ? (
        <>
          <div className="audio-player-section">
            <div ref={waveformRef} className="waveform-container"></div>
            
            <div className="audio-controls">
              <button onClick={handlePlayPause} className="audio-control-btn">
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
              <span className="audio-time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {(selectedTextId || editingMapping) && (
              <div className="mapping-controls">
                <div className="selected-text-indicator">
                  {editingMapping ? (
                    <>Editing: <strong>{editingMapping.textId}</strong></>
                  ) : (
                    <>Selected: <strong>{selectedTextId}</strong></>
                  )}
                </div>
                <div className="time-controls">
                  <button onClick={handleSetStart} className="time-btn">
                    Set Start
                  </button>
                  <button onClick={handleSetEnd} className="time-btn">
                    Set End
                  </button>
                  {tempStart && tempEnd && (
                    <button onClick={handleSaveMapping} className="save-btn">
                      {editingMapping ? 'Update Mapping' : 'Save Mapping'}
                    </button>
                  )}
                  {editingMapping && (
                    <button onClick={handleCancelEdit} className="cancel-btn">
                      Cancel
                    </button>
                  )}
                </div>
                {(tempStart || tempEnd) && (
                  <div className="temp-times">
                    {tempStart && <span>Start: {tempStart}</span>}
                    {tempEnd && <span>End: {tempEnd}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mappings-section">
            <h3>Text-Audio Mappings</h3>
            <div className="mappings-table">
              <div className="mappings-header">
                <div>Text ID</div>
                <div>Start Time</div>
                <div>End Time</div>
                <div>Duration</div>
                <div>Actions</div>
              </div>
              {mappings && mappings.length > 0 ? (
                mappings.map((mapping, index) => {
                  const isEditing = editingMapping && editingMapping._index === index;
                  return (
                    <div 
                      key={index} 
                      className={`mapping-row ${isEditing ? 'editing' : ''}`}
                    >
                      <div className="mapping-text-id">{mapping.textId}</div>
                      <div className="mapping-time">
                        {isEditing ? (
                          <input
                            type="text"
                            value={tempStart}
                            onChange={(e) => setTempStart(e.target.value)}
                            className="time-input"
                            placeholder="0:00:00.000"
                          />
                        ) : (
                          mapping.start
                        )}
                      </div>
                      <div className="mapping-time">
                        {isEditing ? (
                          <input
                            type="text"
                            value={tempEnd}
                            onChange={(e) => setTempEnd(e.target.value)}
                            className="time-input"
                            placeholder="0:00:00.000"
                          />
                        ) : (
                          mapping.end
                        )}
                      </div>
                      <div className="mapping-duration">
                        {formatTime(parseTime(mapping.end) - parseTime(mapping.start))}
                      </div>
                      <div className="mapping-actions">
                        {isEditing ? (
                          <>
                            <button
                              onClick={handleSaveEdit}
                              className="save-btn-small"
                              disabled={!tempStart || !tempEnd}
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="cancel-btn-small"
                            >
                              ✕ Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEditMapping(mapping, index)}
                              className="edit-btn"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteMapping(index)}
                              className="delete-btn"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="mappings-empty">
                  No mappings yet. Select text on the left and set start/end times.
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="audio-upload-prompt">
          <p>Generate TTS audio to map with text above</p>
        </div>
      )}
    </div>
  );
};

export default AudioSync;

