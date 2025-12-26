import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { 
  HiOutlineDownload, 
  HiOutlineCheck, 
  HiOutlinePencil, 
  HiOutlineX,
  HiOutlineSave,
  HiOutlineDocument,
  HiOutlineCog,
  HiOutlineCheckCircle,
  HiOutlineCalculator,
  HiOutlineMicrophone,
  HiOutlineStop,
  HiOutlinePlay,
  HiOutlinePause,
  HiOutlineVolumeUp,
  HiOutlineClipboard,
  HiOutlineDocumentText,
  HiOutlineHashtag,
  HiOutlineArrowUp,
  HiOutlineStar,
  HiOutlineTrash,
  HiOutlineRefresh,
  HiOutlinePaperClip,
  HiOutlineSun,
  HiOutlineClock,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineInformationCircle
} from 'react-icons/hi';
import { HiOutlineSparkles } from 'react-icons/hi2';
import { audioSyncService } from '../services/audioSyncService';
import { conversionService } from '../services/conversionService';
import api from '../services/api';
import './SyncStudio.css';


const SyncStudio = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();

  // Refs
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const regionsPluginRef = useRef(null);
  const viewerRef = useRef(null);
  const isSpaceDownRef = useRef(false);
  const spaceDownTimeRef = useRef(0);
  const lastSyncTimeRef = useRef(0); // Track last sync time to prevent rapid syncing

  // State for content
  const [xhtmlContent, setXhtmlContent] = useState('');
  const [sections, setSections] = useState([]);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // State for audio
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); // Audio playback speed (0.5x to 2.0x)

  // State for sync data
  const [syncData, setSyncData] = useState({
    sentences: {}, // { id: { start, end, text, pageNumber } }
    words: {}      // { id: { parentId, start, end, text } }
  });
  const [activeRegionId, setActiveRegionId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [parsedElements, setParsedElements] = useState([]);
  const [playingSegmentId, setPlayingSegmentId] = useState(null); // Track which segment is playing
  const [showAudioScript, setShowAudioScript] = useState(false); // Track if audio script modal is open
  const [audioScriptData, setAudioScriptData] = useState({ sentences: {}, words: {} }); // Audio script data from backend
  const [loadingAudioScript, setLoadingAudioScript] = useState(false); // Loading state for audio script
  const [editingScriptBlockId, setEditingScriptBlockId] = useState(null); // Track which script block is being edited
  const [editedScriptText, setEditedScriptText] = useState(''); // Edited text for script block
  const [playingScriptSegmentId, setPlayingScriptSegmentId] = useState(null); // Track which script segment is playing
  const [regeneratingScriptBlock, setRegeneratingScriptBlock] = useState(null); // Track which script block is regenerating
  
  // State for diagnostic modal
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recognitionRef = useRef(null);
  
  // Ref to access latest syncData in event handlers
  const syncDataRef = useRef(syncData);
  const playingSegmentIdRef = useRef(null);
  const playingScriptSegmentIdRef = useRef(null);
  const isProgrammaticPlayRef = useRef(false); // Flag to prevent infinite loops during programmatic playback
  const audioScriptDataRef = useRef(audioScriptData);
  const pendingRegionUpdatesRef = useRef(new Map()); // Track regions that need to be recreated after audio reload
  
  // Keep refs in sync with state
  useEffect(() => {
    syncDataRef.current = syncData;
  }, [syncData]);
  
  useEffect(() => {
    playingSegmentIdRef.current = playingSegmentId;
  }, [playingSegmentId]);
  
  useEffect(() => {
    playingScriptSegmentIdRef.current = playingScriptSegmentId;
  }, [playingScriptSegmentId]);
  
  useEffect(() => {
    audioScriptDataRef.current = audioScriptData;
  }, [audioScriptData]);

  // Cleanup speech recognition when modal closes
  useEffect(() => {
    if (!showDiagnostics && recognitionRef.current) {
      stopSpeechRecognition();
      setTranscribedText('');
    }
  }, [showDiagnostics]);

  // State for settings
  const [snapToSilence, setSnapToSilence] = useState(true);
  const [showWordTrack, setShowWordTrack] = useState(true);
  const [scrubOnDrag, setScrubOnDrag] = useState(true);
  const [granularity, setGranularity] = useState('sentence');

  // State for TTS generation
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('standard');
  const [generating, setGenerating] = useState(false);
  const [pdfId, setPdfId] = useState(null);

  // State for Auto-Sync (Kitaboo-style)
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [aeneasAvailable, setAeneasAvailable] = useState(null);
  const [autoSyncLanguage, setAutoSyncLanguage] = useState('eng');
  const [autoSyncProgress, setAutoSyncProgress] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // State for text block editing
  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [regeneratingBlock, setRegeneratingBlock] = useState(null);

  // State for resizable panels
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = localStorage.getItem('sync-studio-left-panel-width');
    return saved ? parseInt(saved, 10) : 350;
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('sync-studio-right-panel-width');
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const resizeContainerRef = useRef(null);

  /**
   * Parse XHTML to extract syncable elements
   */
  const parseXhtmlElements = useCallback((xhtml, sectionId = 0) => {
    if (!xhtml) return [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtml, 'text/html');
      const elements = [];

      // Find all elements with data-read-aloud="true"
      const readAloudElements = doc.querySelectorAll('[data-read-aloud="true"]');

      readAloudElements.forEach((el, idx) => {
        const id = el.getAttribute('id') || `sync-${sectionId}-${idx}`;
        const text = el.textContent?.trim() || '';
        const tagName = el.tagName.toLowerCase();
        const classList = el.className || '';

        // CRITICAL FIX: Filter out unspoken content (TOC, nav, headers, etc.)
        // These patterns match common unspoken structural elements
        const unspokenPatterns = [
          /toc/i,                    // Table of Contents
          /table-of-contents/i,      // Table of Contents (hyphenated)
          /contents/i,               // Contents page
          /chapter-index/i,          // Chapter index
          /chapter-idx/i,            // Chapter index (abbreviated)
          /^nav/i,                   // Navigation elements
          /^header/i,                // Headers
          /^footer/i,                // Footers
          /^sidebar/i,               // Sidebars
          /^menu/i,                  // Menus
          /page-number/i,            // Page numbers
          /page-num/i,               // Page numbers (abbreviated)
          /^skip/i,                  // Skip links
          /^metadata/i               // Metadata
        ];
        
        // Check if this element should be excluded
        const isUnspoken = unspokenPatterns.some(pattern => pattern.test(id) || pattern.test(text));
        
        // Also check for explicit exclusion attributes
        const shouldSync = el.getAttribute('data-should-sync') !== 'false';
        const readAloudAttr = el.getAttribute('data-read-aloud');
        const isExplicitlyExcluded = readAloudAttr === 'false';
        
        // Skip unspoken content entirely (don't create elements for them)
        if (isUnspoken || isExplicitlyExcluded || !shouldSync) {
          console.log(`[SyncStudio] Excluding unspoken content: ${id} (${text.substring(0, 30)}...)`);
          return; // Skip this element
        }

        let type = 'paragraph';
        if (classList.includes('sync-word') || tagName === 'span' && id.includes('_w')) {
          type = 'word';
        } else if (classList.includes('sync-sentence') || id.includes('_s')) {
          type = 'sentence';
        }

        elements.push({
          id,
          text,
          type,
          tagName,
          sectionId,
          sectionIndex: sectionId, // Store section index for page filtering
          pageNumber: sectionId + 1
        });
      });

      return elements;
    } catch (err) {
      console.error('Error parsing XHTML:', err);
      return [];
    }
  }, []);

  /**
   * Calculate proportional word timings from sentence timing
   */
  const calculateWordTimings = useCallback((sentenceId, sentenceStart, sentenceEnd) => {
    if (!xhtmlContent || sentenceEnd <= sentenceStart) return [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtmlContent, 'text/html');
      const sentenceEl = doc.getElementById(sentenceId);

      if (!sentenceEl) return [];

      const wordElements = sentenceEl.querySelectorAll('.sync-word');
      if (wordElements.length === 0) return [];

      const totalChars = Array.from(wordElements).reduce(
        (sum, el) => sum + (el.textContent?.trim().length || 0),
        0
      );

      if (totalChars === 0) return [];

      const totalDuration = sentenceEnd - sentenceStart;
      let runningTime = sentenceStart;
      const words = [];

      wordElements.forEach((el) => {
        const charLen = el.textContent?.trim().length || 1;
        const ratio = charLen / totalChars;
        const wordDuration = totalDuration * ratio;
        const start = runningTime;
        const end = runningTime + wordDuration;

        words.push({
          id: el.getAttribute('id'),
          parentId: sentenceId,
          text: el.textContent?.trim() || '',
          start: parseFloat(start.toFixed(3)),
          end: parseFloat(end.toFixed(3))
        });

        runningTime = end;
      });

      return words;
    } catch (err) {
      console.error('Error calculating word timings:', err);
      return [];
    }
  }, [xhtmlContent]);

  /**
   * Find nearest silence in waveform (zero-crossing detection)
   */
  const findNearestSilence = useCallback((targetTime, windowMs = 100) => {
    if (!wavesurferRef.current || !snapToSilence) return targetTime;

    try {
      const backend = wavesurferRef.current.getDecodedData();
      if (!backend) return targetTime;

      const sampleRate = backend.sampleRate;
      const channelData = backend.getChannelData(0);
      const audioDuration = wavesurferRef.current.getDuration();

      const sampleIndex = Math.floor(targetTime * sampleRate);
      const windowSamples = Math.floor((windowMs / 1000) * sampleRate);
      const startSearch = Math.max(0, sampleIndex - windowSamples);
      const endSearch = Math.min(channelData.length, sampleIndex + windowSamples);

      let quietestIndex = sampleIndex;
      let minAmplitude = Math.abs(channelData[sampleIndex] || 0);

      // Find the point with the lowest amplitude (silence)
      for (let i = startSearch; i < endSearch; i++) {
        const amplitude = Math.abs(channelData[i]);
        if (amplitude < minAmplitude) {
          minAmplitude = amplitude;
          quietestIndex = i;
        }
      }

      const snappedTime = quietestIndex / sampleRate;
      
      // Only snap if we found a significantly quieter point
      if (minAmplitude < 0.1) {
        console.log(`[Snap] ${targetTime.toFixed(3)}s → ${snappedTime.toFixed(3)}s (amplitude: ${minAmplitude.toFixed(4)})`);
        return snappedTime;
      }

      return targetTime;
    } catch (err) {
      console.warn('Error finding silence:', err);
      return targetTime;
    }
  }, [snapToSilence]);

  /**
   * Scrub audio at specific time (play micro-loop)
   */
  const scrubAudio = useCallback((time, duration = 0.1) => {
    if (!wavesurferRef.current || !scrubOnDrag) return;

    try {
      wavesurferRef.current.setTime(time);
      wavesurferRef.current.play();
      setTimeout(() => {
        if (wavesurferRef.current) {
          wavesurferRef.current.pause();
        }
      }, duration * 1000);
    } catch (err) {
      console.warn('Error scrubbing:', err);
    }
  }, [scrubOnDrag]);

  /**
   * Highlight element in XHTML viewer
   */
  const highlightElement = useCallback((elementId) => {
    if (!viewerRef.current) {
      console.warn('[Highlight] viewerRef.current is null');
      return;
    }

    // Remove previous highlights
    const highlighted = viewerRef.current.querySelectorAll('.studio-highlight');
    highlighted.forEach(el => el.classList.remove('studio-highlight'));

    // Add new highlight
    if (elementId) {
      // Try multiple selector strategies
      let el = viewerRef.current.querySelector(`#${CSS.escape(elementId)}`);
      
      // If not found, try without escaping (in case elementId already has special chars)
      if (!el) {
        el = viewerRef.current.querySelector(`#${elementId}`);
      }
      
      // If still not found, try searching by attribute
      if (!el) {
        el = viewerRef.current.querySelector(`[id="${elementId}"]`);
      }
      
      // If still not found, try searching all elements with that ID (case-insensitive)
      if (!el) {
        const allElements = viewerRef.current.querySelectorAll('[id]');
        for (const elem of allElements) {
          if (elem.id === elementId || elem.id.toLowerCase() === elementId.toLowerCase()) {
            el = elem;
            break;
          }
        }
      }
      
      if (el) {
        el.classList.add('studio-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.log(`[Highlight] ✓ Highlighted element: ${elementId}`);
      } else {
        console.warn(`[Highlight] ✗ Element not found: ${elementId}. Available IDs:`, 
          Array.from(viewerRef.current.querySelectorAll('[id]')).slice(0, 10).map(e => e.id)
        );
      }
    }
  }, []);

  /**
   * Create a region on the waveform
   */
  const createRegion = useCallback((id, start, end, type = 'sentence', color = null) => {
    if (!regionsPluginRef.current) return null;

    const regionColor = color || (type === 'sentence' 
      ? 'rgba(74, 123, 84, 0.4)' 
      : 'rgba(255, 212, 59, 0.3)');

    const region = regionsPluginRef.current.addRegion({
      id,
      start,
      end,
      color: regionColor,
      drag: true,
      resize: true,
      content: type === 'sentence' ? id : undefined
    });

    return region;
  }, []);

  /**
   * Update sync data and recreate word regions
   */
  const updateSentenceWithWords = useCallback((sentenceId, start, end, text = '') => {
    // Update sentence
    setSyncData(prev => ({
      ...prev,
      sentences: {
        ...prev.sentences,
        [sentenceId]: { 
          id: sentenceId, // CRITICAL: Ensure id is stored in the data object
          start, 
          end, 
          text, 
          pageNumber: currentSectionIndex + 1 
        }
      }
    }));

    // Auto-propagate word timings
    if (showWordTrack) {
      const words = calculateWordTimings(sentenceId, start, end);
      
      // Remove old word regions for this sentence
      // CRITICAL FIX: Find words by parentId match, not by ID prefix
      if (regionsPluginRef.current) {
        const regions = regionsPluginRef.current.getRegions();
        regions.forEach(r => {
          // Check if this region is a word whose parent matches sentenceId
          if (r.id.includes('_w')) {
            const wordData = syncData.words[r.id];
            if (wordData && wordData.parentId === sentenceId) {
              r.remove();
            }
          }
        });
      }

      // Create new word regions
      const wordData = {};
      words.forEach(word => {
        createRegion(word.id, word.start, word.end, 'word');
        wordData[word.id] = word;
      });

      setSyncData(prev => ({
        ...prev,
        words: {
          ...prev.words,
          ...wordData
        }
      }));
    }
  }, [calculateWordTimings, createRegion, currentSectionIndex, showWordTrack]);

  /**
   * Handle region update (drag/resize)
   */
  const handleRegionUpdate = useCallback((region) => {
    // Skip if we're programmatically playing a segment to prevent infinite loops
    if (isProgrammaticPlayRef.current) {
      return;
    }
    
    const { id } = region;
    let start = region.start;
    let end = region.end;

    // Apply snap to silence
    if (snapToSilence) {
      start = findNearestSilence(start);
      end = findNearestSilence(end);
      region.setOptions({ start, end });
    }

    if (id.includes('_w')) {
      // WORD: Constrain within parent sentence
      // CRITICAL FIX: Find parent by matching parentId in words data
      const wordData = syncData.words[id];
      if (wordData && wordData.parentId) {
        // Find sentence that matches this parentId
        const parent = Object.values(syncData.sentences).find(s => s.id === wordData.parentId);
        
        if (parent) {
          start = Math.max(start, parent.start);
          end = Math.min(end, parent.end);
          region.setOptions({ start, end });
        }
      }

      setSyncData(prev => ({
        ...prev,
        words: {
          ...prev.words,
          [id]: { ...prev.words[id], start, end }
        }
      }));
    } else {
      // SENTENCE: Update and re-propagate words
      updateSentenceWithWords(id, start, end, syncData.sentences[id]?.text || '');
    }

    highlightElement(id);
  }, [findNearestSilence, highlightElement, snapToSilence, syncData.sentences, updateSentenceWithWords]);

  /**
   * Handle region drag (scrubbing)
   */
  const handleRegionDrag = useCallback((region) => {
    // Skip if we're programmatically playing a segment to prevent infinite loops
    if (isProgrammaticPlayRef.current) {
      return;
    }
    
    if (scrubOnDrag) {
      scrubAudio(region.start, 0.08);
    }
    highlightElement(region.id);
    setActiveRegionId(region.id);
  }, [highlightElement, scrubAudio, scrubOnDrag]);

  /**
   * Initialize WaveSurfer
   */
  useEffect(() => {
    if (!waveformRef.current || !audioUrl) {
      // Reset ready state when no audio URL
      setIsReady(false);
      return;
    }

    // Reset ready state when loading new audio
    setIsReady(false);

    // Destroy existing instance
    if (wavesurferRef.current) {
      try {
      wavesurferRef.current.destroy();
      } catch (err) {
        // Ignore errors during cleanup
        console.warn('[SyncStudio] Error destroying WaveSurfer:', err.message);
      }
    }

    // Create regions plugin
    regionsPluginRef.current = RegionsPlugin.create();

    // Create wavesurfer instance
    wavesurferRef.current = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4a5568',
      progressColor: '#4A7B54',
      cursorColor: '#ffd43b',
      cursorWidth: 2,
      height: 180,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      responsive: true,
      normalize: true,
      plugins: [
        regionsPluginRef.current,
        TimelinePlugin.create({
          container: '#timeline',
          primaryLabelInterval: 5,
          secondaryLabelInterval: 1,
          style: {
            fontSize: '11px',
            color: '#888'
          }
        })
      ]
    });

    // Load audio
    wavesurferRef.current.load(audioUrl);
    
    // Apply playback speed
    if (wavesurferRef.current.getMediaElement) {
      const mediaElement = wavesurferRef.current.getMediaElement();
      if (mediaElement) {
        mediaElement.playbackRate = playbackSpeed;
      }
    }

    // Event handlers
    wavesurferRef.current.on('ready', () => {
      try {
        const duration = wavesurferRef.current.getDuration();
        if (duration && duration > 0) {
          setDuration(duration);
      setIsReady(true);
      console.log('[WaveSurfer] Ready');
          
          // Recreate any pending regions after audio reload
          if (pendingRegionUpdatesRef.current.size > 0 && regionsPluginRef.current) {
            pendingRegionUpdatesRef.current.forEach((regionData, segmentId) => {
              try {
                const existingRegion = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
                if (existingRegion) {
                  // Update existing region
                  existingRegion.setOptions({
                    start: regionData.start,
                    end: regionData.end
                  });
                } else {
                  // Create new region
                  createRegion(segmentId, regionData.start, regionData.end, 'sentence');
                }
                console.log(`[Region] Recreated region for segment ${segmentId} after audio reload`);
              } catch (err) {
                console.error(`[Region] Error recreating region for ${segmentId}:`, err);
              }
            });
            // Clear pending updates
            pendingRegionUpdatesRef.current.clear();
          }
        }
      } catch (err) {
        console.error('[WaveSurfer] Error in ready handler:', err);
        setIsReady(false);
      }
    });

    // Handle errors
    wavesurferRef.current.on('error', (error) => {
      console.error('[WaveSurfer] Error:', error);
      setIsReady(false);
    });

    wavesurferRef.current.on('play', () => {
      // Speech recognition is handled in the diagnostic modal
    });

    wavesurferRef.current.on('pause', () => {
      // Stop speech recognition when playback pauses
      if (recognitionRef.current) {
        stopSpeechRecognition();
      }
    });

    wavesurferRef.current.on('audioprocess', (time) => {
      setCurrentTime(time);
      
      // Stop playback if we've reached the end of the playing segment
      const currentPlayingSegmentId = playingSegmentIdRef.current;
      if (currentPlayingSegmentId && wavesurferRef.current && isProgrammaticPlayRef.current) {
        // Check both syncData and audioScriptData
        const segmentData = syncDataRef.current.sentences[currentPlayingSegmentId] || 
                           audioScriptDataRef.current.sentences[currentPlayingSegmentId];
        if (segmentData) {
          // Stop when we reach or exceed the end time
          if (time >= segmentData.end) {
            isProgrammaticPlayRef.current = false;
            wavesurferRef.current.pause();
            // Ensure we're exactly at the end time
            wavesurferRef.current.setTime(segmentData.end);
            setPlayingSegmentId(null);
            setPlayingScriptSegmentId(null);
            playingScriptSegmentIdRef.current = null;
            return; // Exit early to prevent other handlers from running
          }
          // Also prevent playback if we somehow went before the start
          else if (time < segmentData.start) {
            wavesurferRef.current.setTime(segmentData.start);
          }
        }
      }
      
      // Also check script segment playback - ensure we only play within the segment bounds
      const currentPlayingScriptSegmentId = playingScriptSegmentIdRef.current;
      if (currentPlayingScriptSegmentId && wavesurferRef.current && isProgrammaticPlayRef.current) {
        const scriptSegmentData = audioScriptDataRef.current.sentences[currentPlayingScriptSegmentId];
        if (scriptSegmentData && scriptSegmentData.start !== undefined && scriptSegmentData.end !== undefined) {
          // Stop when we reach or exceed the end time
          if (time >= scriptSegmentData.end) {
            console.log('[Script Play] Reached end time, stopping at:', scriptSegmentData.end.toFixed(3), 'current time:', time.toFixed(3));
            isProgrammaticPlayRef.current = false;
            wavesurferRef.current.pause();
            // Ensure we're exactly at the end time
            wavesurferRef.current.setTime(scriptSegmentData.end);
            setPlayingScriptSegmentId(null);
            playingScriptSegmentIdRef.current = null;
            return; // Exit early to prevent other handlers
          }
          // Prevent playback if we somehow went before the start
          else if (time < scriptSegmentData.start) {
            console.log('[Script Play] Time before start, resetting to:', scriptSegmentData.start.toFixed(3), 'current time:', time.toFixed(3));
            wavesurferRef.current.setTime(scriptSegmentData.start);
          }
        }
      }
      
      // Find and highlight active region (only if not programmatically playing a segment)
      if (!isProgrammaticPlayRef.current && regionsPluginRef.current) {
        const regions = regionsPluginRef.current.getRegions();
        const active = regions.find(r => time >= r.start && time < r.end);
        if (active) {
          // Always update highlight even if activeRegionId hasn't changed (in case DOM was re-rendered)
          if (active.id !== activeRegionId) {
          setActiveRegionId(active.id);
          }
          highlightElement(active.id);
        } else if (activeRegionId) {
          // Clear highlight if no active region
          setActiveRegionId(null);
          highlightElement(null);
        }
      }
    });

    wavesurferRef.current.on('play', () => setIsPlaying(true));
    wavesurferRef.current.on('pause', () => {
      setIsPlaying(false);
      // Clear playing segment if paused
      setPlayingSegmentId(null);
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
      isProgrammaticPlayRef.current = false;
    });
    wavesurferRef.current.on('finish', () => {
      setIsPlaying(false);
      setPlayingSegmentId(null);
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
      isProgrammaticPlayRef.current = false;
    });

    // Region events
    regionsPluginRef.current.on('region-updated', handleRegionUpdate);
    regionsPluginRef.current.on('region-in', handleRegionDrag);
    regionsPluginRef.current.on('region-clicked', (region, e) => {
      // Skip if we're programmatically playing a segment to prevent infinite loops
      if (isProgrammaticPlayRef.current) {
        return;
      }
      
      e.stopPropagation();
      setActiveRegionId(region.id);
      highlightElement(region.id);
      wavesurferRef.current.setTime(region.start);
    });

    return () => {
      if (wavesurferRef.current) {
        try {
          // Reset ready state before destroying
          setIsReady(false);
        wavesurferRef.current.destroy();
        } catch (err) {
          // Ignore errors during cleanup
          console.warn('[SyncStudio] Error during WaveSurfer cleanup:', err.message);
        }
      }
    };
  }, [audioUrl, handleRegionUpdate, handleRegionDrag, highlightElement, activeRegionId]);

  /**
   * Update zoom level
   */
  useEffect(() => {
    if (wavesurferRef.current && isReady) {
      try {
        // Check if audio is actually loaded before zooming
        const duration = wavesurferRef.current.getDuration();
        if (duration && duration > 0) {
      wavesurferRef.current.zoom(zoom);
        }
      } catch (err) {
        // Audio not loaded yet, skip zoom
        console.warn('[SyncStudio] Cannot zoom: audio not loaded yet', err.message);
      }
    }
  }, [zoom, isReady]);

  /**
   * Update playback speed
   */
  useEffect(() => {
    if (wavesurferRef.current && isReady) {
      try {
        const mediaElement = wavesurferRef.current.getMediaElement();
        if (mediaElement) {
          mediaElement.playbackRate = playbackSpeed;
        }
      } catch (err) {
        // Audio not loaded yet, skip playback speed update
        console.warn('[SyncStudio] Cannot set playback speed: audio not loaded yet', err.message);
      }
    }
  }, [playbackSpeed, isReady]);

  /**
   * Ensure XHTML content is properly reflowable
   */
  useEffect(() => {
    if (viewerRef.current && xhtmlContent) {
      // Apply reflowable styles to all elements in the viewer
      const allElements = viewerRef.current.querySelectorAll('*');
      allElements.forEach(el => {
        // Ensure text wraps properly
        el.style.wordWrap = 'break-word';
        el.style.overflowWrap = 'break-word';
        el.style.maxWidth = '100%';
        el.style.boxSizing = 'border-box';
        
        // Prevent horizontal overflow
        if (el.tagName === 'TABLE') {
          el.style.tableLayout = 'auto';
          el.style.width = '100%';
        }
        
        // Ensure images scale properly
        if (el.tagName === 'IMG') {
          el.style.maxWidth = '100%';
          el.style.height = 'auto';
        }
      });
    }
  }, [xhtmlContent, leftPanelWidth]);

  /**
   * Spacebar tap-in/tap-out handler
   */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && isRecording && !isSpaceDownRef.current) {
        e.preventDefault();
        isSpaceDownRef.current = true;
        spaceDownTimeRef.current = wavesurferRef.current?.getCurrentTime() || 0;
        console.log('[TapIn] Started at', spaceDownTimeRef.current.toFixed(3));
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space' && isSpaceDownRef.current && isRecording) {
        e.preventDefault();
        isSpaceDownRef.current = false;
        
        const endTime = wavesurferRef.current?.getCurrentTime() || 0;
        const startTime = spaceDownTimeRef.current;
        
        // CRITICAL FIX: Require minimum hold duration (0.15 seconds) to prevent accidental fast syncing
        const holdDuration = endTime - startTime;
        const MIN_HOLD_DURATION = 0.15; // Minimum 150ms hold time
        
        if (holdDuration < MIN_HOLD_DURATION) {
          console.log(`[TapOut] Hold too short (${(holdDuration * 1000).toFixed(0)}ms), ignoring. Minimum: ${(MIN_HOLD_DURATION * 1000).toFixed(0)}ms`);
          return; // Ignore very quick taps
        }

        // CRITICAL FIX: Filter elements to only current page
        const currentPageElements = parsedElements.filter(el => {
          // Validate element has required properties
          if (!el || !el.id) {
            console.warn(`[TapOut] Element missing ID:`, el);
            return false;
          }
          
          // Extract page number from element ID (e.g., "page4_p1_s1" -> 4)
          const pageMatch = el.id.match(/page(\d+)/);
          const elementPageNum = pageMatch ? parseInt(pageMatch[1]) : null;
          
          // If element has page number, match it to current section
          if (elementPageNum !== null) {
            return elementPageNum === (currentSectionIndex + 1);
          }
          
          // Fallback: if element was parsed from current section, include it
          // This handles legacy IDs without page prefix
          return el.sectionIndex === currentSectionIndex;
        }).filter(el => 
          el.type === 'sentence' || el.type === 'paragraph'
        );
        
        console.log(`[TapOut] Current page elements (Page ${currentSectionIndex + 1}): ${currentPageElements.length} found`, 
          currentPageElements.map(el => ({ id: el.id, type: el.type, text: el.text?.substring(0, 30) }))
        );

        // CRITICAL FIX: Debounce - prevent syncing too fast (minimum 0.3 seconds between syncs)
        const timeSinceLastSync = Date.now() - lastSyncTimeRef.current;
        const MIN_SYNC_INTERVAL = 300; // 300ms minimum between syncs
        
        if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
          console.log(`[TapOut] Too fast! Wait ${((MIN_SYNC_INTERVAL - timeSinceLastSync) / 1000).toFixed(2)}s before next sync`);
          return; // Ignore if syncing too fast
        }

        // Debug logging
        console.log(`[TapOut] Debug info:`, {
          endTime,
          startTime,
          holdDuration: (holdDuration * 1000).toFixed(0) + 'ms',
          currentSentenceIndex,
          currentPageElementsLength: currentPageElements.length,
          currentPage: currentSectionIndex + 1,
          availableElements: currentPageElements.map(el => ({ id: el.id, text: el.text?.substring(0, 30) }))
        });

        if (endTime > startTime && currentSentenceIndex < currentPageElements.length) {
          const element = currentPageElements[currentSentenceIndex];

          if (element) {
            // CRITICAL FIX: Validate element has an ID
            if (!element.id) {
              console.error(`[TapOut] ERROR: Element at index ${currentSentenceIndex} has no ID!`, element);
              return; // Skip this element
            }

            // Apply snap to silence
            const snappedStart = findNearestSilence(startTime);
            const snappedEnd = findNearestSilence(endTime);

            console.log(`[TapOut] Syncing element:`, {
              id: element.id,
              text: element.text?.substring(0, 50),
              type: element.type,
              startTime: snappedStart.toFixed(3),
              endTime: snappedEnd.toFixed(3)
            });

            // Create region
            createRegion(element.id, snappedStart, snappedEnd, 'sentence');
            updateSentenceWithWords(element.id, snappedStart, snappedEnd, element.text);

            console.log(`[TapOut] ✓ Page ${currentSectionIndex + 1} - ${element.id}: ${snappedStart.toFixed(3)}s - ${snappedEnd.toFixed(3)}s (held for ${(holdDuration * 1000).toFixed(0)}ms)`);
            
            // Update last sync time
            lastSyncTimeRef.current = Date.now();
            
            setCurrentSentenceIndex(prev => prev + 1);
          } else {
            console.warn(`[TapOut] Element at index ${currentSentenceIndex} is null/undefined`);
          }
        } else if (currentSentenceIndex >= currentPageElements.length) {
          console.log(`[TapOut] All sentences on page ${currentSectionIndex + 1} synced (${currentPageElements.length} total)`);
        } else {
          console.warn(`[TapOut] Invalid sync attempt:`, {
            endTime,
            startTime,
            endTimeGreater: endTime > startTime,
            indexInRange: currentSentenceIndex < currentPageElements.length
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRecording, currentSentenceIndex, parsedElements, createRegion, findNearestSilence, updateSentenceWithWords]);

  /**
   * Load EPUB content and voices
   */
  useEffect(() => {
    const loadContent = async () => {
      try {
        setLoading(true);
        setError('');

        // Load voices
        const voicesData = await audioSyncService.getAvailableVoices();
        setVoices(voicesData);

        // Check if Aeneas is available
        try {
          const aeneasStatus = await audioSyncService.checkAeneas();
          setAeneasAvailable(aeneasStatus.installed);
          console.log('[SyncStudio] Aeneas status:', aeneasStatus);
        } catch (aeneasErr) {
          console.warn('[SyncStudio] Could not check Aeneas:', aeneasErr);
          setAeneasAvailable(false);
        }

        // Load job info
        const jobData = await conversionService.getConversionJob(parseInt(jobId));
        if (jobData?.pdfDocumentId) {
          setPdfId(jobData.pdfDocumentId);
        }
        // Load playback speed from job metadata if available
        if (jobData?.metadata?.playbackSpeed !== undefined && jobData.metadata.playbackSpeed !== null) {
          const savedSpeed = parseFloat(jobData.metadata.playbackSpeed);
          if (!isNaN(savedSpeed) && savedSpeed > 0) {
            setPlaybackSpeed(savedSpeed);
            console.log(`[SyncStudio] Loaded playback speed from job metadata: ${savedSpeed}x`);
          }
        }

        // Load EPUB sections
        const sectionsData = await conversionService.getEpubSections(parseInt(jobId));
        if (sectionsData && sectionsData.length > 0) {
          // Convert relative image paths to absolute URLs for browser preview
          const baseURL = api.defaults.baseURL || 'http://localhost:8081/api';
          const processedSections = sectionsData.map(section => {
            let processedXhtml = section.xhtml || section.content || '';
            
            // Pattern: src="images/filename.ext" or src="../images/filename.ext" -> absolute URL
            const relativeImagePattern1 = /src=["']images\/([^"']+)["']/gi;
            const relativeImagePattern2 = /src=["']\.\.\/images\/([^"']+)["']/gi;
            
            processedXhtml = processedXhtml.replace(relativeImagePattern1, (match, fileName) => {
              const absoluteUrl = `${baseURL}/conversions/${jobId}/images/${fileName}`;
              console.log('[SyncStudio] Converting image path (images/):', match, '->', absoluteUrl);
              return `src="${absoluteUrl}"`;
            });
            
            processedXhtml = processedXhtml.replace(relativeImagePattern2, (match, fileName) => {
              const absoluteUrl = `${baseURL}/conversions/${jobId}/images/${fileName}`;
              console.log('[SyncStudio] Converting image path (../images/):', match, '->', absoluteUrl);
              return `src="${absoluteUrl}"`;
            });
            
            return {
              ...section,
              xhtml: processedXhtml
            };
          });
          
          setSections(processedSections);
          setXhtmlContent(processedSections[0]?.xhtml || '');

          // Parse elements from all sections (use processed sections with absolute URLs)
          const allElements = [];
          processedSections.forEach((section, idx) => {
            const elements = parseXhtmlElements(section.xhtml, idx);
            console.log(`[SyncStudio] Parsed ${elements.length} elements from section ${idx + 1}:`, 
              elements.map(el => ({ id: el.id, type: el.type, text: el.text?.substring(0, 30) }))
            );
            allElements.push(...elements);
          });
          console.log(`[SyncStudio] Total parsed elements: ${allElements.length}`);
          setParsedElements(allElements);

          // Check for existing audio syncs
          try {
            const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
            if (audioData && audioData.length > 0) {
              // Load existing audio
              if (audioData[0]?.audioFilePath) {
                const url = audioSyncService.getAudioUrl(audioData[0].id);
                setAudioUrl(url);
              }

              // Build a map of ID -> pageNumber from XHTML sections (use processed sections)
              const idToPageMap = {};
              processedSections.forEach((section, idx) => {
                const pageNum = idx + 1;
                const xhtml = section.xhtml || section.content || '';
                // Extract all IDs from this section
                const idMatches = xhtml.matchAll(/id=["']([^"']+)["']/g);
                for (const match of idMatches) {
                  idToPageMap[match[1]] = pageNum;
                }
              });
              
              console.log('[Load] Built ID to page map with', Object.keys(idToPageMap).length, 'entries');

              // Load existing sync data
              // CRITICAL FIX: Use original XHTML ID as key (not unique DB key)
              // This ensures consistency with createRegion, handleRegionUpdate, etc.
              const sentences = {};
              const words = {};
              audioData.forEach(sync => {
                const blockId = sync.block_id || sync.blockId;
                if (blockId) {
                  // Use database page_number as it's the authoritative source
                  const pageNumber = sync.page_number || sync.pageNumber || 1;
                  
                  // CRITICAL FIX: Use original XHTML ID as key for consistency
                  // This matches how handleAutoSync and handleLinearSpread store data
                  const key = blockId;
                  
                  // Preserve status from backend (SKIPPED or SYNCED)
                  // Check notes field for "SKIPPED" or "Magic Sync" to determine status
                  const status = sync.notes?.includes('SKIPPED') || sync.status === 'SKIPPED' ? 'SKIPPED' : 'SYNCED';
                  
                  if (blockId.includes('_w')) {
                    const parentId = blockId.replace(/_w\d+$/, '');
                    words[key] = {
                      id: blockId, // Original XHTML ID for SMIL reference
                      parentId: parentId,
                      start: sync.start_time || sync.startTime || 0,
                      end: sync.end_time || sync.endTime || 0,
                      text: sync.custom_text || sync.customText || '',
                      pageNumber: pageNumber,
                      status: status
                    };
                  } else {
                    sentences[key] = {
                      id: blockId, // CRITICAL: Ensure id is stored in the data object
                      start: Number(sync.start_time || sync.startTime || 0),
                      end: Number(sync.end_time || sync.endTime || 0),
                      text: sync.custom_text || sync.customText || '',
                      pageNumber: pageNumber,
                      status: status
                    };
                  }
                }
              });
              
              console.log('[Load] Page distribution:', {
                page1: Object.values(sentences).filter(s => s.pageNumber === 1).length,
                page2: Object.values(sentences).filter(s => s.pageNumber === 2).length,
                page3: Object.values(sentences).filter(s => s.pageNumber === 3).length,
                samplePageNumbers: Object.values(sentences).slice(0, 5).map(s => s.pageNumber)
              });
              
              console.log('[Load] Loaded syncs:', {
                sentences: Object.keys(sentences).length,
                words: Object.keys(words).length,
                page1Sentences: Object.values(sentences).filter(s => s.pageNumber === 1).length,
                page2Sentences: Object.values(sentences).filter(s => s.pageNumber === 2).length
              });
              
              setSyncData({ sentences, words });
            }
          } catch (audioErr) {
            console.warn('No existing audio:', audioErr);
          }
        }
      } catch (err) {
        console.error('Error loading content:', err);
        setError('Failed to load content: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    if (jobId) {
      loadContent();
    }
  }, [jobId, parseXhtmlElements]);

  /**
   * Recreate regions when sync data changes (on load)
   */
  useEffect(() => {
    if (!isReady || !regionsPluginRef.current) return;

    // Clear existing regions
    regionsPluginRef.current.clearRegions();

    // Create sentence regions
    // CRITICAL FIX: Skip SKIPPED blocks (they don't have timestamps and shouldn't create regions)
    Object.entries(syncData.sentences).forEach(([key, data]) => {
      // Skip if status is SKIPPED or if timestamps are invalid
      if (data.status === 'SKIPPED') {
        return; // Don't create region for skipped blocks
      }
      if (data.start >= 0 && data.end > data.start) {
        createRegion(data.id || key, data.start, data.end, 'sentence');
      }
    });

    // Create word regions
    // CRITICAL FIX: Skip SKIPPED blocks
    if (showWordTrack) {
      Object.entries(syncData.words).forEach(([key, data]) => {
        if (data.status === 'SKIPPED') {
          return; // Don't create region for skipped blocks
        }
        if (data.start >= 0 && data.end > data.start) {
          createRegion(data.id || key, data.start, data.end, 'word');
        }
      });
    }
  }, [isReady, syncData, createRegion, showWordTrack]);

  /**
   * Handle audio file upload
   */
  const handleAudioUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setIsReady(false);
    }
  };

  /**
   * Generate TTS audio
   */
  const handleGenerateAudio = async () => {
    if (!pdfId) {
      setError('PDF ID not found');
      return;
    }

    try {
      setGenerating(true);
      setError('');

      // CRITICAL FIX: Filter out unspoken content (TOC, nav, headers, etc.)
      // This prevents TOC from being sent to TTS, which would cause sync drift
      const textBlocks = parsedElements
        .filter(el => {
          // Must be sentence or paragraph type
          if (el.type !== 'sentence' && el.type !== 'paragraph') {
            return false;
          }
          
          // CRITICAL FIX: Additional filtering for unspoken content patterns
          const id = el.id || '';
          const text = el.text || '';
          
          const unspokenPatterns = [
            /toc/i, /table-of-contents/i, /contents/i,
            /chapter-index/i, /chapter-idx/i,
            /^nav/i, /^header/i, /^footer/i, /^sidebar/i, /^menu/i,
            /page-number/i, /page-num/i, /^skip/i, /^metadata/i
          ];
          
          const isUnspoken = unspokenPatterns.some(pattern => pattern.test(id) || pattern.test(text));
          
          if (isUnspoken) {
            console.log(`[handleGenerateAudio] Excluding unspoken content: ${id}`);
            return false;
          }
          
          return true;
        })
        .map(el => ({
          id: el.id,
          pageNumber: el.pageNumber,
          text: el.text
        }));

      if (textBlocks.length === 0) {
        setError('No text blocks found');
        return;
      }

      const segments = await audioSyncService.generateAudio(
        pdfId,
        parseInt(jobId),
        selectedVoice,
        textBlocks
      );

      // Get generated audio URL
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      if (audioData && audioData.length > 0 && audioData[0].audioFilePath) {
        const url = audioSyncService.getAudioUrl(audioData[0].id);
        setAudioUrl(url);
        setIsReady(false);
      }

      alert(`Generated audio with ${segments.length} segments`);
    } catch (err) {
      setError('Failed to generate audio: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Start/stop recording mode
   */
  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      if (wavesurferRef.current) {
        wavesurferRef.current.pause();
      }
    } else {
      setIsRecording(true);
      setCurrentSentenceIndex(0);
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(0);
        wavesurferRef.current.play();
      }
    }
  };

  /**
   * Automated forced alignment (Kitaboo-style)
   * This is the "magic button" that syncs everything instantly
   */
  const handleAutoSync = async () => {
    if (!audioUrl) {
      setError('Please upload or generate audio first');
      return;
    }

    try {
      setAutoSyncing(true);
      setError('');

      // If we have a local audio file (blob URL), upload it first
      if (audioFile || audioUrl.startsWith('blob:')) {
        setAutoSyncProgress('Uploading audio to server...');
        console.log('[AutoSync] Audio is local, uploading first...');
        
        let fileToUpload = audioFile;
        
        // If we only have a blob URL, fetch it and create a File
        if (!fileToUpload && audioUrl.startsWith('blob:')) {
          try {
            const response = await fetch(audioUrl);
            const blob = await response.blob();
            fileToUpload = new File([blob], `audio_${jobId}.mp3`, { type: 'audio/mpeg' });
          } catch (fetchErr) {
            console.error('[AutoSync] Failed to fetch blob:', fetchErr);
            setError('Failed to process audio file. Please upload a file directly.');
            setAutoSyncing(false);
            return;
          }
        }
        
        if (fileToUpload) {
          try {
            const uploadResult = await audioSyncService.uploadAudioFile(parseInt(jobId), fileToUpload);
            console.log('[AutoSync] Audio uploaded:', uploadResult);
          } catch (uploadErr) {
            console.error('[AutoSync] Upload failed:', uploadErr);
            setError('Failed to upload audio: ' + uploadErr.message);
            setAutoSyncing(false);
            return;
          }
        }
      }

      setAutoSyncProgress('Analyzing audio and text...');
      console.log('[AutoSync] Starting automated alignment...');

      const result = await audioSyncService.autoSync(parseInt(jobId), {
        language: autoSyncLanguage,
        granularity: granularity,
        propagateWords: showWordTrack
      });

      console.log('[AutoSync] Result:', result);
      setAutoSyncProgress(`Aligned ${result.sentences?.length || 0} sentences`);

      // Update local sync data
      const newSentences = {};
      const newWords = {};

      console.log('[AutoSync] Processing result sentences:', result.sentences?.length);
      console.log('[AutoSync] Processing result words:', result.words?.length);

      if (result.sentences) {
        result.sentences.forEach(s => {
          // Use the pageNumber directly from backend (it now correctly tracks per-page)
          const pageNum = s.pageNumber || 1;
          // Use original ID to match XHTML - this is critical for SMIL to work!
          const key = s.id;
          
          newSentences[key] = {
            id: s.id,
            start: s.startTime,
            end: s.endTime,
            text: s.text,
            pageNumber: pageNum
          };
          
          console.log(`[AutoSync] Sentence: ${key} -> Page ${pageNum}, ${s.startTime?.toFixed(2)}s-${s.endTime?.toFixed(2)}s`);
        });
      }

      if (result.words) {
        result.words.forEach(w => {
          const pageNum = w.pageNumber || 1;
          // Use original ID to match XHTML - this is critical for SMIL to work!
          const key = w.id;
          
          newWords[key] = {
            id: w.id,
            parentId: w.parentId,
            start: w.startTime,
            end: w.endTime,
            text: w.text,
            pageNumber: pageNum
          };
        });
      }
      
      console.log(`[AutoSync] Mapped: ${Object.keys(newSentences).length} sentences, ${Object.keys(newWords).length} words`);

      setSyncData({ sentences: newSentences, words: newWords });

      // Clear and recreate regions
      if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();

        Object.entries(newSentences).forEach(([id, data]) => {
          // Skip SKIPPED blocks - don't create regions for them
          if (data.status === 'SKIPPED') return;
          if (data.start >= 0 && data.end > data.start) {
            createRegion(id, data.start, data.end, 'sentence');
          }
        });

        if (showWordTrack) {
          Object.entries(newWords).forEach(([id, data]) => {
            if (data.start >= 0 && data.end > data.start) {
              createRegion(id, data.start, data.end, 'word');
            }
          });
        }
      }

      setAutoSyncProgress(null);
      alert(`✓ Auto-sync complete!\n\nMethod: ${result.method === 'aeneas' ? 'Aeneas Forced Alignment' : 'Linear Spread'}\nSentences: ${result.sentences?.length || 0}\nWords: ${result.words?.length || 0}\n\nYou can now fine-tune by dragging regions on the waveform.`);

    } catch (err) {
      console.error('[AutoSync] Error:', err);
      setError('Auto-sync failed: ' + err.message);
      setAutoSyncProgress(null);
    } finally {
      setAutoSyncing(false);
    }
  };

  /**
   * Hybrid Gemini Alignment (Magic Sync)
   * Uses Gemini AI to intelligently match book blocks to audio transcript
   * This solves the TOC blocking and 45s offset issues
   */
  const handleMagicSync = async () => {
    if (!audioUrl) {
      setError('Please upload or generate audio first');
      return;
    }

    try {
      setAutoSyncing(true);
      setError('');

      // If we have a local audio file (blob URL), upload it first
      if (audioFile || audioUrl.startsWith('blob:')) {
        setAutoSyncProgress('Uploading audio to server...');
        console.log('[MagicSync] Audio is local, uploading first...');
        
        let fileToUpload = audioFile;
        
        if (!fileToUpload && audioUrl.startsWith('blob:')) {
          try {
            const response = await fetch(audioUrl);
            const blob = await response.blob();
            fileToUpload = new File([blob], `audio_${jobId}.mp3`, { type: 'audio/mpeg' });
          } catch (fetchErr) {
            console.error('[MagicSync] Failed to fetch blob:', fetchErr);
            setError('Failed to process audio file. Please upload a file directly.');
            setAutoSyncing(false);
            return;
          }
        }
        
        if (fileToUpload) {
          try {
            const uploadResult = await audioSyncService.uploadAudioFile(parseInt(jobId), fileToUpload);
            console.log('[MagicSync] Audio uploaded:', uploadResult);
          } catch (uploadErr) {
            console.error('[MagicSync] Upload failed:', uploadErr);
            setError('Failed to upload audio: ' + uploadErr.message);
            setAutoSyncing(false);
            return;
          }
        }
      }

      // Validate jobId
      const numericJobId = parseInt(jobId);
      if (!jobId || isNaN(numericJobId)) {
        setError('Invalid job ID. Please refresh the page and try again.');
        setAutoSyncing(false);
        return;
      }

      setAutoSyncProgress('Phase 1: Getting transcript from audio...');
      console.log('[MagicSync] Starting hybrid alignment for job:', numericJobId);
      console.log('[MagicSync] Options:', { language: autoSyncLanguage, granularity });

      const result = await audioSyncService.magicSync(numericJobId, {
        language: autoSyncLanguage || 'eng',
        granularity: granularity || 'sentence'
      });

      console.log('[MagicSync] Result:', result);
      setAutoSyncProgress(`Aligned ${result.sentences?.length || 0} sentences (${result.stats?.skipped || 0} skipped)`);

      // Update local sync data
      const newSentences = {};
      const newWords = {};

      if (result.sentences) {
        result.sentences.forEach(s => {
          const pageNum = s.pageNumber || 1;
          const key = s.id;
          
          newSentences[key] = {
            id: s.id,
            start: s.startTime,
            end: s.endTime,
            text: s.text,
            pageNumber: pageNum,
            status: 'SYNCED' // All returned sentences are SYNCED
          };
        });
      }

      if (result.words) {
        result.words.forEach(w => {
          const pageNum = w.pageNumber || 1;
          const key = w.id;
          
          newWords[key] = {
            id: w.id,
            parentId: w.parentId,
            start: w.startTime,
            end: w.endTime,
            text: w.text,
            pageNumber: pageNum,
            status: 'SYNCED' // All returned words are SYNCED
          };
        });
      }
      
      // Add SKIPPED blocks to syncData so they appear in the UI
      // We need to get the text from parsedElements
      if (result.skippedIds && result.skippedIds.length > 0) {
        result.skippedIds.forEach(skippedId => {
          // Find the element in parsedElements to get its text and page number
          const element = parsedElements.find(el => el.id === skippedId);
          if (element) {
            // Extract page number from ID (e.g., page3_p1_s1 -> page 3)
            const pageMatch = skippedId.match(/page(\d+)/);
            const pageNum = pageMatch ? parseInt(pageMatch[1]) : currentSectionIndex + 1;
            
            newSentences[skippedId] = {
              id: skippedId,
              start: undefined,
              end: undefined,
              text: element.text || '',
              pageNumber: pageNum,
              status: 'SKIPPED'
            };
          }
        });
      }

      setSyncData({ sentences: newSentences, words: newWords });

      // Clear and recreate regions
      if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();

        Object.entries(newSentences).forEach(([id, data]) => {
          // Skip SKIPPED blocks - don't create regions for them
          if (data.status === 'SKIPPED') return;
          if (data.start >= 0 && data.end > data.start) {
            createRegion(id, data.start, data.end, 'sentence');
          }
        });

        if (showWordTrack) {
          Object.entries(newWords).forEach(([id, data]) => {
            if (data.start >= 0 && data.end > data.start) {
              createRegion(id, data.start, data.end, 'word');
            }
          });
        }
      }

      setAutoSyncProgress(null);
      const skippedMsg = result.skippedIds?.length > 0 
        ? `\n\nSkipped (not in audio): ${result.skippedIds.length} blocks (TOC, headers, etc.)`
        : '';
      alert(`* Magic Sync complete!\n\nMethod: Hybrid Gemini + Aeneas\nSentences: ${result.sentences?.length || 0}\nWords: ${result.words?.length || 0}${skippedMsg}\n\nTOC and unspoken content automatically skipped!`);

    } catch (err) {
      console.error('[MagicSync] Error:', err);
      console.error('[MagicSync] Error details:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
        jobId: jobId
      });
      
      // Provide more helpful error messages
      let errorMessage = 'Magic Sync failed: ';
      if (err.response?.status === 400) {
        errorMessage += err.response?.data?.message || err.response?.data?.error || 'Bad request. Please check that audio file exists and job is valid.';
      } else if (err.response?.status === 404) {
        errorMessage += 'Job or audio file not found.';
      } else if (err.response?.status === 500) {
        errorMessage += 'Server error. Please check backend logs.';
      } else {
        errorMessage += err.message || 'Unknown error occurred';
      }
      
      setError(errorMessage);
      setAutoSyncProgress(null);
    } finally {
      setAutoSyncing(false);
    }
  };

  /**
   * Linear Spread sync (manual bounds)
   * User marks start and end, system spreads evenly based on character count
   */
  const handleLinearSpread = async () => {
    if (!wavesurferRef.current) {
      setError('Please load audio first');
      return;
    }

    const startTime = 0;
    const endTime = wavesurferRef.current.getDuration();

    if (endTime <= 0) {
      setError('Invalid audio duration');
      return;
    }

    try {
      setAutoSyncing(true);
      setAutoSyncProgress('Calculating proportional timings...');

      const result = await audioSyncService.linearSpread(parseInt(jobId), startTime, endTime, {
        granularity: granularity,
        propagateWords: showWordTrack
      });

      // Update local state (same as autoSync)
      const newSentences = {};
      const newWords = {};

      if (result.sentences) {
        result.sentences.forEach(s => {
          // Extract page number from ID - supports both formats:
          // New: "page1_p1_s1" -> page 1
          // Legacy: "p1_s1" -> page 1 (from paragraph number)
          const newMatch = s.id.match(/^page(\d+)_/);
          const legacyMatch = s.id.match(/^p(\d+)/);
          const pageNum = newMatch ? parseInt(newMatch[1]) : 
                         legacyMatch ? parseInt(legacyMatch[1]) : 1;
          
          newSentences[s.id] = {
            id: s.id,
            start: s.startTime,
            end: s.endTime,
            text: s.text,
            pageNumber: pageNum
          };
        });
      }

      if (result.words) {
        result.words.forEach(w => {
          // Extract page number from ID - supports both formats
          const newMatch = w.id.match(/^page(\d+)_/);
          const legacyMatch = w.id.match(/^p(\d+)/);
          const pageNum = newMatch ? parseInt(newMatch[1]) : 
                         legacyMatch ? parseInt(legacyMatch[1]) : 1;
          
          newWords[w.id] = {
            id: w.id,
            parentId: w.parentId,
            start: w.startTime,
            end: w.endTime,
            text: w.text,
            pageNumber: pageNum
          };
        });
      }

      setSyncData({ sentences: newSentences, words: newWords });

      // Recreate regions
      if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();

        Object.entries(newSentences).forEach(([id, data]) => {
          // Skip SKIPPED blocks - don't create regions for them
          if (data.status === 'SKIPPED') return;
          if (data.start >= 0 && data.end > data.start) {
            createRegion(id, data.start, data.end, 'sentence');
          }
        });

        if (showWordTrack) {
          Object.entries(newWords).forEach(([id, data]) => {
            if (data.start >= 0 && data.end > data.start) {
              createRegion(id, data.start, data.end, 'word');
            }
          });
        }
      }

      setAutoSyncProgress(null);
      alert(`✓ Linear spread complete!\n\nSentences: ${result.sentences?.length || 0}\nWords: ${result.words?.length || 0}\n\nTip: Enable "Snap to Silence" and drag regions to refine.`);

    } catch (err) {
      setError('Linear spread failed: ' + err.message);
      setAutoSyncProgress(null);
    } finally {
      setAutoSyncing(false);
    }
  };

  /**
   * Re-propagate all word timings
   */
  const handleRefreshWordMap = () => {
    Object.entries(syncData.sentences).forEach(([id, data]) => {
      if (data.start >= 0 && data.end > data.start) {
        updateSentenceWithWords(id, data.start, data.end, data.text);
      }
    });
  };

  /**
   * Handle starting text edit for a block
   */
  const handleStartEdit = (blockId, currentText) => {
    setEditingBlockId(blockId);
    setEditedText(currentText || '');
  };

  /**
   * Handle canceling text edit
   */
  const handleCancelEdit = () => {
    setEditingBlockId(null);
    setEditedText('');
  };

  /**
   * Load audio script data from backend
   */
  const loadAudioScript = async () => {
    if (!jobId) return;
    
    try {
      setLoadingAudioScript(true);
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      
      if (!audioData || audioData.length === 0) {
        setAudioScriptData({ sentences: {}, words: {} });
        return;
      }

      // Transform the data into the same format as syncData
      const sentences = {};
      const words = {};
      
      audioData.forEach(sync => {
        const blockId = sync.block_id || sync.blockId || sync.elementId;
        if (!blockId) return;
        
        const pageNumber = sync.page_number || sync.pageNumber || 1;
        const status = sync.notes?.includes('SKIPPED') || sync.status === 'SKIPPED' ? 'SKIPPED' : 'SYNCED';
        
        if (blockId.includes('_w')) {
          // Word
          const parentId = blockId.replace(/_w\d+$/, '');
          words[blockId] = {
            id: blockId,
            parentId: parentId,
            start: Number(sync.start_time || sync.startTime || 0),
            end: Number(sync.end_time || sync.endTime || 0),
            text: sync.custom_text || sync.customText || sync.text || '',
            pageNumber: pageNumber,
            status: status
          };
        } else {
          // Sentence
          sentences[blockId] = {
            id: blockId,
            start: Number(sync.start_time || sync.startTime || 0),
            end: Number(sync.end_time || sync.endTime || 0),
            text: sync.custom_text || sync.customText || sync.text || '',
            pageNumber: pageNumber,
            status: status
          };
        }
      });
      
      setAudioScriptData({ sentences, words });
    } catch (err) {
      console.error('Error loading audio script:', err);
      setAudioScriptData({ sentences: {}, words: {} });
    } finally {
      setLoadingAudioScript(false);
    }
  };

  /**
   * Handle playing/pausing a script segment from modal
   */
  const handlePlayScriptSegment = (segmentId) => {
    if (!wavesurferRef.current || !isReady) {
      console.warn('[Script Play] Audio not ready');
      return;
    }

    const segmentData = audioScriptData.sentences[segmentId];
    if (!segmentData) {
      console.warn('[Script Play] Segment data not found:', segmentId);
      return;
    }
    
    if (segmentData.start === undefined || segmentData.end === undefined) {
      console.warn('[Script Play] Invalid segment times:', segmentData);
      return;
    }

    // Validate segment times
    if (segmentData.start < 0 || segmentData.end <= segmentData.start) {
      console.warn('[Script Play] Invalid time range:', segmentData.start, segmentData.end);
      return;
    }

    // If this segment is already playing, pause it
    if (playingScriptSegmentId === segmentId && isPlaying) {
      isProgrammaticPlayRef.current = false;
      wavesurferRef.current.pause();
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
      return;
    }

    // Stop any currently playing segment (both regular and script segments)
    if (isPlaying) {
      wavesurferRef.current.pause();
      setPlayingSegmentId(null);
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
    }

    // Set flag to prevent region handlers from interfering
    isProgrammaticPlayRef.current = true;
    
    // Set time to segment start
    wavesurferRef.current.setTime(segmentData.start);
    setPlayingScriptSegmentId(segmentId);
    playingScriptSegmentIdRef.current = segmentId;
    
    console.log('[Script Play] Playing segment:', {
      id: segmentId,
      start: segmentData.start.toFixed(3),
      end: segmentData.end.toFixed(3),
      duration: (segmentData.end - segmentData.start).toFixed(3)
    });
    
    // Small delay to ensure setTime completes before play
    setTimeout(() => {
      if (wavesurferRef.current && isProgrammaticPlayRef.current) {
        // Double-check we're still playing this segment using ref
        const currentPlayingId = playingScriptSegmentIdRef.current;
        if (currentPlayingId === segmentId) {
          const currentTime = wavesurferRef.current.getCurrentTime();
          // Verify we're at the start time (or very close) - allow 0.2s tolerance
          if (Math.abs(currentTime - segmentData.start) < 0.2) {
            wavesurferRef.current.play();
            console.log('[Script Play] Started playback at:', currentTime.toFixed(3), 'for segment:', segmentId, 'will stop at:', segmentData.end.toFixed(3));
          } else {
            // Reset to start if we're not at the right position
            console.log('[Script Play] Time mismatch, resetting to start:', segmentData.start.toFixed(3));
            wavesurferRef.current.setTime(segmentData.start);
            wavesurferRef.current.play();
          }
        } else {
          console.log('[Script Play] Segment changed, aborting playback. Current:', currentPlayingId, 'Expected:', segmentId);
        }
      }
    }, 50);
  };

  /**
   * Handle editing a script block
   */
  const handleStartEditScript = (blockId, currentText) => {
    setEditingScriptBlockId(blockId);
    setEditedScriptText(currentText || '');
  };

  /**
   * Handle canceling script edit
   */
  const handleCancelEditScript = () => {
    setEditingScriptBlockId(null);
    setEditedScriptText('');
  };

  /**
   * Handle saving edited script text and regenerating audio
   */
  const handleSaveEditScript = async (blockId) => {
    if (!jobId || !editedScriptText.trim()) {
      setError('Cannot save empty text');
      return;
    }

    if (!pdfId) {
      setError('PDF ID not found. Cannot regenerate audio.');
      return;
    }

    const blockData = audioScriptData.sentences[blockId];
    if (!blockData) {
      setError('Block not found');
      return;
    }

    // Check if text actually changed
    const textChanged = editedScriptText.trim() !== (blockData.text || '').trim();
    if (!textChanged) {
      handleCancelEditScript();
      return;
    }

    try {
      setError('');
      setRegeneratingScriptBlock(blockId);
      
      const savedText = editedScriptText.trim();
      
      // Update text in local state first
      setAudioScriptData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: savedText
          }
        }
      }));

      setEditingScriptBlockId(null);
      setEditedScriptText('');

      // Regenerate audio for this block
      const updatedBlock = {
        id: blockId,
        pageNumber: blockData.pageNumber || 1,
        text: savedText
      };

      const segments = await audioSyncService.generateAudio(
        pdfId,
        parseInt(jobId),
        selectedVoice,
        [updatedBlock]
      );

      // Update sync data with new timings from regenerated audio
      if (segments && segments.length > 0) {
        const newSegment = segments.find(s => s.blockId === blockId) || segments[0];
        
        // Update the sentence in audioScriptData with new timings
        setAudioScriptData(prev => ({
          ...prev,
          sentences: {
            ...prev.sentences,
            [blockId]: {
              ...prev.sentences[blockId],
              start: newSegment.startTime || blockData.start,
              end: newSegment.endTime || blockData.end,
              text: savedText
            }
          }
        }));

        // Also update syncData if it exists
        if (syncData.sentences[blockId]) {
          setSyncData(prev => ({
            ...prev,
            sentences: {
              ...prev.sentences,
              [blockId]: {
                ...prev.sentences[blockId],
                start: newSegment.startTime || blockData.start,
                end: newSegment.endTime || blockData.end,
                text: savedText
              }
            }
          }));

          // Update region on waveform
          if (regionsPluginRef.current && newSegment.startTime !== undefined && newSegment.endTime !== undefined) {
            const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
            if (region) {
              region.setOptions({
                start: newSegment.startTime,
                end: newSegment.endTime
              });
            } else {
              createRegion(blockId, newSegment.startTime, newSegment.endTime, 'sentence');
            }
          }
        }

        // Update audio sync record in database with new text and timings
        try {
          const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
          const existingSync = audioData.find(s => {
            const syncBlockId = s.block_id || s.blockId || s.elementId;
            return syncBlockId === blockId;
          });
          if (existingSync) {
            await audioSyncService.updateAudioSync(existingSync.id, {
              start_time: newSegment.startTime || blockData.start,
              end_time: newSegment.endTime || blockData.end,
              custom_text: savedText,
              notes: `Text edited and audio regenerated. Original: ${blockData.text?.substring(0, 50)}...`
            });
          }
        } catch (updateErr) {
          console.warn('Could not update audio sync record:', updateErr);
        }

        setSuccess(`Audio regenerated for edited block "${savedText.substring(0, 30)}..."`);
        setTimeout(() => setSuccess(''), 3000);
      }

      setRegeneratingScriptBlock(null);
    } catch (err) {
      console.error('Error saving script edit and regenerating audio:', err);
      setError('Failed to regenerate audio: ' + err.message);
      setRegeneratingScriptBlock(null);
      // Revert text change on error
      setAudioScriptData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: blockData.text
          }
        }
      }));
    }
  };

  /**
   * Handle deleting a script block
   */
  const handleDeleteScriptBlock = async (blockId) => {
    if (!window.confirm('Are you sure you want to delete this audio block? This will remove it from the final output.')) {
      return;
    }

    try {
      // Find the sync record for this block
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      const syncRecord = audioData.find(sync => {
        const syncBlockId = sync.block_id || sync.blockId || sync.elementId;
        return syncBlockId === blockId;
      });

      if (!syncRecord) {
        setError('Block not found');
        return;
      }

      // Delete from backend
      await audioSyncService.deleteAudioSync(syncRecord.id);

      // Update local state
      setAudioScriptData(prev => {
        const newSentences = { ...prev.sentences };
        delete newSentences[blockId];

        // Remove associated words
        const newWords = { ...prev.words };
        Object.keys(newWords).forEach(wordId => {
          if (newWords[wordId].parentId === blockId) {
            delete newWords[wordId];
          }
        });

        return {
          sentences: newSentences,
          words: newWords
        };
      });

      // Also update syncData if it exists
      if (syncData.sentences[blockId]) {
        setSyncData(prev => {
          const newSentences = { ...prev.sentences };
          delete newSentences[blockId];

          const newWords = { ...prev.words };
          Object.keys(newWords).forEach(wordId => {
            if (newWords[wordId].parentId === blockId) {
              delete newWords[wordId];
            }
          });

          return {
            sentences: newSentences,
            words: newWords
          };
        });

        // Remove region from waveform
        if (regionsPluginRef.current) {
          const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
          if (region) {
            region.remove();
          }
        }
      }
    } catch (err) {
      setError('Failed to delete: ' + err.message);
      console.error('Error deleting script block:', err);
    }
  };

  /**
   * Handle playing/pausing a specific segment
   */
  const handlePlaySegment = (segmentId) => {
    if (!wavesurferRef.current || !isReady) {
      console.warn(`[Play] Cannot play segment ${segmentId}:`, {
        wavesurferReady: !!wavesurferRef.current,
        audioReady: isReady
      });
      return;
    }

    // Use ref to ensure we get the latest segment data (including after regeneration)
    const segmentData = syncDataRef.current.sentences[segmentId];
    if (!segmentData || segmentData.start === undefined || segmentData.end === undefined) {
      console.warn(`[Play] Segment ${segmentId} data invalid:`, segmentData);
      return;
    }
    
    console.log(`[Play] Playing segment ${segmentId}:`, {
      text: segmentData.text,
      start: segmentData.start,
      end: segmentData.end,
      duration: segmentData.end - segmentData.start,
      audioUrl: audioUrl
    });

    // If this segment is already playing, pause it
    if (playingSegmentId === segmentId && isPlaying) {
      isProgrammaticPlayRef.current = false;
      wavesurferRef.current.pause();
      setPlayingSegmentId(null);
      return;
    }

    // Stop any currently playing segment
    if (isPlaying) {
      wavesurferRef.current.pause();
    }

    // Set flag to prevent region handlers from interfering
    isProgrammaticPlayRef.current = true;
    
    // Set time to segment start
    wavesurferRef.current.setTime(segmentData.start);
    setPlayingSegmentId(segmentId);
    
    // Small delay to ensure setTime completes before play
    setTimeout(() => {
      if (wavesurferRef.current && isProgrammaticPlayRef.current) {
        // Verify we're still at the start (or close to it) before playing
        const currentTime = wavesurferRef.current.getCurrentTime();
        if (Math.abs(currentTime - segmentData.start) < 0.1) {
          wavesurferRef.current.play();
        } else {
          // If time changed, reset it
          wavesurferRef.current.setTime(segmentData.start);
          wavesurferRef.current.play();
        }
      }
    }, 50);
    // Note: The audioprocess event handler will automatically stop playback at segment end
  };

  /**
   * Start speech recognition for transcribing audio playback
   */
  const startSpeechRecognition = (segmentId, expectedText) => {
    // Check if SpeechRecognition is available
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[SpeechRecognition] Not supported in this browser');
      setTranscribedText('Speech recognition not supported in this browser. Please use Chrome or Edge.');
      return null;
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setIsTranscribing(true);
    setTranscribedText('Listening...');

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      setTranscribedText(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event) => {
      console.error('[SpeechRecognition] Error:', event.error);
      if (event.error === 'no-speech') {
        setTranscribedText('No speech detected. Make sure audio is playing and microphone can hear it.');
      } else if (event.error === 'not-allowed') {
        setTranscribedText('Microphone access denied. Please allow microphone access to transcribe audio.');
      } else {
        setTranscribedText(`Recognition error: ${event.error}`);
      }
      setIsTranscribing(false);
    };

    recognition.onend = () => {
      setIsTranscribing(false);
      console.log('[SpeechRecognition] Ended. Final transcript:', finalTranscript);
    };

    recognition.start();
    recognitionRef.current = recognition;

    // Auto-stop after segment duration + buffer
    const segmentData = syncDataRef.current.sentences[segmentId];
    if (segmentData && segmentData.end && segmentData.start) {
      const duration = (segmentData.end - segmentData.start) * 1000 + 2000; // Add 2 second buffer
      setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }
      }, duration);
    }

    return recognition;
  };

  /**
   * Stop speech recognition
   */
  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsTranscribing(false);
  };

  /**
   * Diagnostic function to debug audio playback issues
   */
  const handleDiagnostics = async (segmentId) => {
    try {
      setLoadingDiagnostics(true);
      const segmentData = syncDataRef.current.sentences[segmentId];
      const currentEditedText = editingBlockId === segmentId ? editedText : null;
      
      // Get backend data for comparison
      let backendData = null;
      let allBackendSegments = [];
      try {
        const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
        allBackendSegments = audioData || [];
        backendData = audioData.find(s => s.blockId === segmentId);
        
        // Find segments that overlap with this segment's timings
        const overlappingSegments = audioData.filter(s => {
          if (!s.startTime || !s.endTime || s.blockId === segmentId) return false;
          const sStart = s.startTime || 0;
          const sEnd = s.endTime || 0;
          const segStart = segmentData?.start || 0;
          const segEnd = segmentData?.end || 0;
          // Check if segments overlap
          return (sStart < segEnd && sEnd > segStart);
        });
        
        console.log(`[Diagnostics] Found ${overlappingSegments.length} overlapping segments:`, overlappingSegments);
      } catch (err) {
        console.warn('Could not fetch backend data:', err);
      }

      // Get waveform current time
      const currentWaveformTime = wavesurferRef.current?.getCurrentTime() || 0;
      const waveformDuration = wavesurferRef.current?.getDuration() || 0;

      // Get region data
      let regionData = null;
      if (regionsPluginRef.current) {
        const region = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
        if (region) {
          regionData = {
            start: region.start,
            end: region.end,
            duration: region.end - region.start
          };
        }
      }

      // Check for mismatches
      let mismatches = [];
      let recommendations = [];
      let rootCauseAnalysis = [];
      
      // Find segments that overlap or are close to this segment's timings
      let overlappingSegments = [];
      let segmentsAtSameTime = [];
      if (segmentData && allBackendSegments.length > 0) {
        const segStart = segmentData.start || 0;
        const segEnd = segmentData.end || 0;
        
        allBackendSegments.forEach(s => {
          if (s.blockId === segmentId) return; // Skip self
          const sStart = s.startTime || s.start_time || 0;
          const sEnd = s.endTime || s.end_time || 0;
          
          // Check for exact overlap
          if (sStart < segEnd && sEnd > segStart) {
            overlappingSegments.push({
              blockId: s.blockId || s.block_id,
              text: s.customText || s.custom_text || s.text || 'NO TEXT',
              startTime: sStart,
              endTime: sEnd
            });
          }
          
          // Check for segments at the same start time (within 0.1s)
          if (Math.abs(sStart - segStart) < 0.1) {
            segmentsAtSameTime.push({
              blockId: s.blockId || s.block_id,
              text: s.customText || s.custom_text || s.text || 'NO TEXT',
              startTime: sStart,
              endTime: sEnd
            });
          }
        });
      }
      
      // Root cause analysis
      if (segmentData) {
        const localText = (segmentData.text || '').trim();
        if (localText && localText.length > 0) {
          console.log(`[Diagnostics] Segment ${segmentId} local text: "${localText}"`);
          
          // Check if timings match backend
          if (backendData) {
            const backendText = (backendData.customText || backendData.text || '').trim();
            if (localText !== backendText) {
              rootCauseAnalysis.push({
                issue: 'Text Mismatch',
                description: `Local state has "${localText}" but backend has "${backendText}"`,
                impact: 'Audio playback uses backend timings, so it may play the backend text instead',
                solution: 'Save and regenerate audio to sync local text with backend'
              });
            }
            
            // Check timing mismatches
            const startDiff = Math.abs((segmentData.start || 0) - (backendData.startTime || 0));
            const endDiff = Math.abs((segmentData.end || 0) - (backendData.endTime || 0));
            if (startDiff > 0.1 || endDiff > 0.1) {
              rootCauseAnalysis.push({
                issue: 'Timing Mismatch',
                description: `Local timings (${segmentData.start?.toFixed(3)}s-${segmentData.end?.toFixed(3)}s) don't match backend (${backendData.startTime?.toFixed(3)}s-${backendData.endTime?.toFixed(3)}s)`,
                impact: 'Playback may start/end at wrong times, playing wrong audio',
                solution: 'Reload sync data or regenerate audio'
              });
            }
          }
          
          // Check for overlapping segments
          if (overlappingSegments.length > 0) {
            rootCauseAnalysis.push({
              issue: 'Overlapping Segments',
              description: `Found ${overlappingSegments.length} other segment(s) with overlapping timings`,
              impact: 'Audio may be playing from a different segment at the same time',
              solution: 'Check overlapping segments and ensure timings are unique',
              details: overlappingSegments
            });
          }
          
          // Check for segments at same start time
          if (segmentsAtSameTime.length > 0) {
            rootCauseAnalysis.push({
              issue: 'Multiple Segments at Same Start Time',
              description: `Found ${segmentsAtSameTime.length} other segment(s) starting at the same time`,
              impact: 'Playback may start from the wrong segment',
              solution: 'Ensure each segment has unique start times',
              details: segmentsAtSameTime
            });
          }
        } else {
          mismatches.push('Local state has no text');
          recommendations.push('Text may have been deleted or not set properly');
        }
      }
      
      if (segmentData && backendData) {
        const textMatch = (segmentData.text || '').trim() === (backendData.customText || backendData.text || '').trim();
        const startMatch = Math.abs((segmentData.start || 0) - (backendData.startTime || 0)) < 0.001;
        const endMatch = Math.abs((segmentData.end || 0) - (backendData.endTime || 0)) < 0.001;
        
        if (!textMatch) {
          mismatches.push(`Text mismatch: Local "${segmentData.text}" vs Backend "${backendData.customText || backendData.text}"`);
          recommendations.push('The audio may be playing old text. Try saving and regenerating audio again.');
        }
        if (!startMatch) {
          mismatches.push(`Start time mismatch: Local ${segmentData.start?.toFixed(3)}s vs Backend ${backendData.startTime?.toFixed(3)}s`);
          recommendations.push('Timings may be out of sync. The audio file might need to be regenerated.');
        }
        if (!endMatch) {
          mismatches.push(`End time mismatch: Local ${segmentData.end?.toFixed(3)}s vs Backend ${backendData.endTime?.toFixed(3)}s`);
          recommendations.push('Timings may be out of sync. The audio file might need to be regenerated.');
        }
      } else if (!backendData) {
        mismatches.push('No backend data found for this segment');
        recommendations.push('The segment may not be saved to the database. Try saving the sync data.');
      }

      // Check if edited text is unsaved
      if (currentEditedText && segmentData?.text && currentEditedText.trim() !== segmentData.text.trim()) {
        mismatches.push('Unsaved edited text detected');
        recommendations.push('Click "Save & Regenerate" to apply your edits and generate new audio');
      }

      // Check if audio is ready
      if (!isReady) {
        recommendations.push('Audio file is not ready. Wait for it to load completely.');
      }

      // Check if region exists
      const isSkipped = segmentData?.status === 'SKIPPED';
      if (!regionData && !isSkipped) {
        mismatches.push('Region not found on waveform');
        recommendations.push('The segment may need to be re-synced');
      }

      // Build diagnostic data object
      const diagnosticInfo = {
        segmentId,
        localState: {
          text: segmentData?.text || 'NOT FOUND',
          start: segmentData?.start,
          end: segmentData?.end,
          duration: segmentData?.start !== undefined && segmentData?.end !== undefined 
            ? segmentData.end - segmentData.start : null,
          pageNumber: segmentData?.pageNumber || null
        },
        editState: {
          isEditing: editingBlockId === segmentId,
          editedText: currentEditedText || null,
          textChanged: currentEditedText && segmentData?.text 
            ? currentEditedText.trim() !== segmentData.text.trim() 
            : false
        },
        playbackState: {
          isPlaying: playingSegmentId === segmentId && isPlaying,
          isReady,
          waveformTime: currentWaveformTime,
          waveformDuration
        },
        audioFile: {
          url: audioUrl || null,
          isReady
        },
        backendData: backendData ? {
          text: backendData.customText || backendData.text || null,
          startTime: backendData.startTime,
          endTime: backendData.endTime,
          syncId: backendData.id
        } : null,
        regionData,
        mismatches,
        recommendations: recommendations.length > 0 ? recommendations : ['No issues detected. Audio should play correctly.'],
        rootCauseAnalysis,
        overlappingSegments,
        segmentsAtSameTime
      };

      // Log to console
      console.log('=== AUDIO PLAYBACK DIAGNOSTICS ===', diagnosticInfo);

      setDiagnosticData(diagnosticInfo);
      setShowDiagnostics(true);
    } catch (err) {
      console.error('Error in diagnostics:', err);
      setDiagnosticData({
        error: err.message,
        segmentId
      });
      setShowDiagnostics(true);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  /**
   * Handle deleting a segment
   */
  const handleDeleteSegment = (segmentId) => {
    if (!window.confirm('Are you sure you want to delete this segment? This will remove it from the audio sequence.')) {
      return;
    }

    const segmentData = syncData.sentences[segmentId];
    if (!segmentData) return;

    // Remove the region from the waveform
    if (regionsPluginRef.current) {
      const region = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
      if (region) {
        region.remove();
      }
    }

    // Remove associated words
    const wordsToRemove = Object.keys(syncData.words).filter(
      wordId => syncData.words[wordId].parentId === segmentData.id
    );

    // Remove word regions
    if (regionsPluginRef.current && showWordTrack) {
      wordsToRemove.forEach(wordId => {
        const wordRegion = regionsPluginRef.current.getRegions().find(r => r.id === wordId);
        if (wordRegion) {
          wordRegion.remove();
        }
      });
    }

    // Update syncData - remove sentence and associated words
    setSyncData(prev => {
      const newSentences = { ...prev.sentences };
      delete newSentences[segmentId];

      const newWords = { ...prev.words };
      wordsToRemove.forEach(wordId => {
        delete newWords[wordId];
      });

      return {
        sentences: newSentences,
        words: newWords
      };
    });

    // Clear active region if it was the deleted one
    if (activeRegionId === segmentId) {
      setActiveRegionId(null);
    }

    // Cancel edit if editing this segment
    if (editingBlockId === segmentId) {
      handleCancelEdit();
    }
  };

  /**
   * Handle saving edited text and regenerating audio
   */
  const handleSaveEdit = async (blockId) => {
    if (!pdfId || !editedText.trim()) {
      setError('Cannot save empty text');
      return;
    }

    const blockData = syncData.sentences[blockId];
    if (!blockData) {
      setError('Block not found');
      return;
    }

    // Check if text actually changed
    const textChanged = editedText.trim() !== (blockData.text || '').trim();
    if (!textChanged) {
      handleCancelEdit();
      return;
    }

    try {
      setRegeneratingBlock(blockId);
      setError('');

      // Update text in local state
      setSyncData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: editedText.trim()
          }
        }
      }));

      const savedText = editedText.trim();
      setEditingBlockId(null);
      setEditedText('');

      // Regenerate audio for this block
      const updatedBlock = {
        id: blockId,
        pageNumber: blockData.pageNumber || currentSectionIndex + 1,
        text: savedText
      };

      console.log(`[Regenerate] Starting audio regeneration for block ${blockId} with text: "${savedText}"`);
      
      const segments = await audioSyncService.generateAudio(
        pdfId,
        parseInt(jobId),
        selectedVoice,
        [updatedBlock]
      );

      console.log(`[Regenerate] Received ${segments?.length || 0} segments from backend`);

      // Update sync data with new timings from regenerated audio
      if (segments && segments.length > 0) {
        const newSegment = segments.find(s => s.blockId === blockId) || segments[0];
        
        console.log(`[Regenerate] New segment data:`, {
          blockId: newSegment.blockId,
          startTime: newSegment.startTime,
          endTime: newSegment.endTime,
          text: savedText
        });
        
        // Update the sentence in syncData with new timings
        setSyncData(prev => ({
          ...prev,
          sentences: {
            ...prev.sentences,
            [blockId]: {
              ...prev.sentences[blockId],
              start: newSegment.startTime || 0,
              end: newSegment.endTime || 0,
              text: savedText,
              // Ensure id is preserved
              id: blockId
            }
          }
        }));
        
        console.log(`[Regenerate] Updated syncData for block ${blockId} with new timings: ${newSegment.startTime} - ${newSegment.endTime}`);

        // Update region on waveform
        if (newSegment.startTime !== undefined && newSegment.endTime !== undefined) {
          // Store region update info for recreation after audio reload
          pendingRegionUpdatesRef.current.set(blockId, {
            start: newSegment.startTime,
            end: newSegment.endTime
          });
          
          // Try to update/create region immediately if audio is ready
          if (regionsPluginRef.current && isReady) {
            const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
            if (region) {
              region.setOptions({
                start: newSegment.startTime,
                end: newSegment.endTime
              });
              console.log(`[Region] Updated region for segment ${blockId}`);
            } else {
              createRegion(blockId, newSegment.startTime, newSegment.endTime, 'sentence');
              console.log(`[Region] Created region for segment ${blockId}`);
            }
            // Remove from pending since we've handled it
            pendingRegionUpdatesRef.current.delete(blockId);
          } else {
            console.log(`[Region] Audio not ready, will recreate region for ${blockId} after reload`);
          }
        }

        // Update audio sync record in database with new text and timings
        try {
          const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
          const existingSync = audioData.find(s => s.blockId === blockId);
          if (existingSync) {
            await audioSyncService.updateAudioSync(existingSync.id, {
              startTime: newSegment.startTime || 0,
              endTime: newSegment.endTime || 0,
              customText: savedText,
              notes: `Text edited and audio regenerated. Original: ${blockData.text?.substring(0, 50)}...`
            });
          }
          
          // Reload audio URL to get the updated audio file with regenerated content
          // IMPORTANT: After regenerating audio, we need to fetch the latest audio data
          // because the audio file might have been regenerated
          try {
            // Fetch fresh audio data after regeneration
            const freshAudioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
            console.log(`[Regenerate] Fetched fresh audio data:`, freshAudioData);
            
            if (freshAudioData && freshAudioData.length > 0 && freshAudioData[0]?.audioFilePath) {
              const updatedUrl = audioSyncService.getAudioUrl(freshAudioData[0].id);
              // Add timestamp to force reload and bypass cache
              const urlWithCacheBuster = `${updatedUrl}?t=${Date.now()}&regenerated=${blockId}`;
              
              console.log(`[Regenerate] Reloading audio from URL: ${urlWithCacheBuster}`);
              
              // Reload waveform with updated audio
              if (wavesurferRef.current) {
                // Stop any current playback
                if (isPlaying) {
                  wavesurferRef.current.pause();
                  setPlayingSegmentId(null);
                }
                
                // Store the blockId that was regenerated so we can verify after reload
                const regeneratedBlockIdRef = { current: blockId };
                
                // Reload the audio file
                wavesurferRef.current.load(urlWithCacheBuster);
                
                // Update audio URL state
                setAudioUrl(urlWithCacheBuster);
                
                // Wait for audio to be ready, then verify the segment
                const checkAudioReady = setInterval(() => {
                  if (isReady && wavesurferRef.current) {
                    clearInterval(checkAudioReady);
                    const segmentData = syncDataRef.current.sentences[regeneratedBlockIdRef.current];
                    if (segmentData) {
                      console.log(`[Regenerate] Audio ready. Segment ${regeneratedBlockIdRef.current} timings:`, {
                        start: segmentData.start,
                        end: segmentData.end,
                        text: segmentData.text
                      });
                    }
                  }
                }, 100);
                
                // Clear interval after 10 seconds
                setTimeout(() => clearInterval(checkAudioReady), 10000);
                
                // Note: The 'ready' event handler will recreate regions from pendingRegionUpdatesRef
                // This ensures regions are recreated after audio reload completes
              }
            } else {
              console.warn(`[Regenerate] No audio file path found after regeneration`);
            }
          } catch (reloadErr) {
            console.error(`[Regenerate] Error reloading audio after regeneration:`, reloadErr);
          }
        } catch (updateErr) {
          console.warn('Could not update audio sync record:', updateErr);
        }

        // Reload sync data from backend to ensure we have the latest timings
        // This is important because the backend may have regenerated the entire audio file
        // and updated timings for all segments
        try {
          console.log(`[Regenerate] Reloading sync data from backend...`);
          const refreshedAudioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
          
          if (refreshedAudioData && refreshedAudioData.length > 0) {
            const sentences = {};
            const words = {};
            
            refreshedAudioData.forEach(sync => {
              const blockId = sync.block_id || sync.blockId;
              if (blockId) {
                const pageNumber = sync.page_number || sync.pageNumber || 1;
                const status = sync.notes?.includes('SKIPPED') || sync.status === 'SKIPPED' ? 'SKIPPED' : 'SYNCED';
                
                if (blockId.includes('_w')) {
                  const parentId = blockId.replace(/_w\d+$/, '');
                  words[blockId] = {
                    id: blockId,
                    parentId: parentId,
                    start: sync.start_time || sync.startTime || 0,
                    end: sync.end_time || sync.endTime || 0,
                    text: sync.custom_text || sync.customText || '',
                    pageNumber: pageNumber,
                    status: status
                  };
                } else {
                  sentences[blockId] = {
                    id: blockId,
                    start: Number(sync.start_time || sync.startTime || 0),
                    end: Number(sync.end_time || sync.endTime || 0),
                    text: sync.custom_text || sync.customText || '',
                    pageNumber: pageNumber,
                    status: status
                  };
                }
              }
            });
            
            // Update syncData with refreshed data
            setSyncData({ sentences, words });
            
            // Log the regenerated segment to verify
            const refreshedSegment = sentences[blockId];
            if (refreshedSegment) {
              console.log(`[Regenerate] Refreshed segment data for ${blockId}:`, {
                text: refreshedSegment.text,
                start: refreshedSegment.start,
                end: refreshedSegment.end
              });
            }
            
            // Update regions after reloading sync data (wait a bit for audio to be ready)
            setTimeout(() => {
              if (regionsPluginRef.current && isReady) {
                // Update the region for this specific block
                const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
                if (refreshedSegment && refreshedSegment.start !== undefined && refreshedSegment.end !== undefined) {
                  if (region) {
                    region.setOptions({
                      start: refreshedSegment.start,
                      end: refreshedSegment.end
                    });
                    console.log(`[Regenerate] Updated region with refreshed timings`);
                  } else {
                    createRegion(blockId, refreshedSegment.start, refreshedSegment.end, 'sentence');
                    console.log(`[Regenerate] Created region with refreshed timings`);
                  }
                }
              }
            }, 500);
          }
        } catch (reloadErr) {
          console.error(`[Regenerate] Error reloading sync data:`, reloadErr);
          // Don't fail the whole operation if reload fails
        }

        setSuccess(`Audio regenerated for edited block "${savedText.substring(0, 30)}..."`);
        setTimeout(() => setSuccess(''), 3000);
      }

    } catch (err) {
      console.error('Error saving edit and regenerating audio:', err);
      setError('Failed to regenerate audio: ' + err.message);
      // Revert text change on error
      setSyncData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: blockData.text
          }
        }
      }));
    } finally {
      setRegeneratingBlock(null);
    }
  };

  /**
   * Save sync data to backend
   */
  const handleSave = async () => {
    try {
      setLoading(true);

      if (!audioFile && !audioUrl) {
        setError('Please upload or generate audio first');
        return;
      }

      // Upload audio if needed
      let audioFileName;
      if (audioFile) {
        const uploadResult = await audioSyncService.uploadAudioFile(parseInt(jobId), audioFile);
        audioFileName = uploadResult?.fileName || audioFile.name;
      } else {
        const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
        audioFileName = audioData?.[0]?.audioFilePath?.split('/').pop() || `audio_${jobId}.mp3`;
      }

      // CRITICAL FIX: Prepare sync blocks, filtering out unspoken content
      const syncBlocks = [];
      
      // Helper function to check if content is unspoken
      const isUnspoken = (id, text) => {
        const unspokenPatterns = [
          /toc/i, /table-of-contents/i, /contents/i,
          /chapter-index/i, /chapter-idx/i,
          /^nav/i, /^header/i, /^footer/i, /^sidebar/i, /^menu/i,
          /page-number/i, /page-num/i, /^skip/i, /^metadata/i
        ];
        return unspokenPatterns.some(pattern => pattern.test(id) || pattern.test(text));
      };

      // Add sentences (filter out unspoken content and SKIPPED blocks)
      Object.entries(syncData.sentences).forEach(([id, data]) => {
        // Skip SKIPPED blocks - they shouldn't be saved
        if (data.status === 'SKIPPED') {
          console.log(`[handleSave] Skipping SKIPPED sentence: ${id}`);
          return;
        }
        
        if (isUnspoken(id, data.text || '')) {
          console.log(`[handleSave] Excluding unspoken sentence from save: ${id}`);
          return; // Skip unspoken content
        }
        
        syncBlocks.push({
          id,
          text: data.text,
          type: 'sentence',
          shouldRead: true,
          start: data.start,
          end: data.end,
          pageNumber: data.pageNumber || 1,
          granularity: 'sentence'
        });
      });

      // Add words (filter out unspoken content and SKIPPED blocks)
      Object.entries(syncData.words).forEach(([id, data]) => {
        // Skip SKIPPED blocks - they shouldn't be saved
        if (data.status === 'SKIPPED') {
          console.log(`[handleSave] Skipping SKIPPED word: ${id}`);
          return;
        }
        
        if (isUnspoken(id, data.text || '')) {
          console.log(`[handleSave] Excluding unspoken word from save: ${id}`);
          return; // Skip unspoken content
        }
        
        // CRITICAL FIX: Find parent sentence by matching parentId to sentence.id
        const parentSentence = Object.values(syncData.sentences).find(s => s.id === data.parentId);
        const pageNumber = parentSentence?.pageNumber || data.pageNumber || 1;
        
        syncBlocks.push({
          id,
          text: data.text,
          type: 'word',
          shouldRead: true,
          start: data.start,
          end: data.end,
          pageNumber: pageNumber,
          granularity: 'word'
        });
      });

      // Ensure playback speed is a valid number
      const speedToSave = parseFloat(playbackSpeed) || 1.0;
      console.log(`[SyncStudio] Saving with playback speed: ${speedToSave}x`);

      // Save to backend with playback speed
      await audioSyncService.saveSyncBlocks(
        parseInt(jobId), 
        syncBlocks, 
        audioFileName, 
        granularity,
        speedToSave
      );

      // Regenerate EPUB with playback speed setting
      const regenerateResult = await conversionService.regenerateEpub(parseInt(jobId), { 
        granularity,
        playbackSpeed: speedToSave
      });

      setSaveSuccess(true);
      setError('');
      console.log(`[SyncStudio] EPUB regenerated successfully. ${syncBlocks.length} sync points saved. Playback speed: ${playbackSpeed}x`);
    } catch (err) {
      setError('Failed to save: ' + err.message);
      setSaveSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Download EPUB file
   */
  const handleDownloadEpub = async () => {
    try {
      setDownloading(true);
      setError('');
      setSuccess('');
      await conversionService.downloadEpub(parseInt(jobId));
      setSuccess('EPUB downloaded successfully!');
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to download EPUB: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  /**
   * Format time display
   */
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  /**
   * Change current section
   */
  const handleSectionChange = (index) => {
    setCurrentSectionIndex(index);
    // Reset sentence index when changing pages
    setCurrentSentenceIndex(0);
    if (sections[index]) {
      setXhtmlContent(sections[index].xhtml || '');
    }
  };

  // Resize handlers for left panel
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingLeft) return;
      
      const container = resizeContainerRef.current;
      if (!container) return;
      
      const containerRect = container.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      
      const minWidth = 250;
      const maxWidth = Math.min(800, containerRect.width * 0.6);
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setLeftPanelWidth(newWidth);
        localStorage.setItem('sync-studio-left-panel-width', newWidth.toString());
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
    };

    if (isResizingLeft) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft]);

  // Resize handlers for right panel
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRight) return;
      
      const container = resizeContainerRef.current;
      if (!container) return;
      
      const containerRect = container.getBoundingClientRect();
      const newWidth = containerRect.width - (e.clientX - containerRect.left);
      
      const minWidth = 250;
      const maxWidth = Math.min(800, containerRect.width * 0.6);
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setRightPanelWidth(newWidth);
        localStorage.setItem('sync-studio-right-panel-width', newWidth.toString());
      }
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
    };

    if (isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingRight]);

  const handleLeftResizeStart = (e) => {
    e.preventDefault();
    setIsResizingLeft(true);
  };

  const handleRightResizeStart = (e) => {
    e.preventDefault();
    setIsResizingRight(true);
  };

  if (loading && sections.length === 0) {
    return (
      <div className="sync-studio-loading">
        <div className="spinner"></div>
        <p>Loading Sync Studio...</p>
      </div>
    );
  }

  return (
    <div className="sync-studio">
      {/* Header */}
      <header className="studio-header">
        <div className="header-left">
          <button onClick={() => navigate(`/epub-image-editor/${jobId}`)} className="btn-back">
            ← Back
          </button>
          <h1>Sync Studio</h1>
          <span className="job-badge">Job #{jobId}</span>
        </div>
        <div className="header-right">
          <button 
            onClick={async () => {
              setShowAudioScript(true);
              await loadAudioScript();
            }} 
            className="btn-audio-script"
            title="View complete audio script"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 16px',
              background: '#2a2a2a',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              marginRight: '10px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#333';
              e.target.style.borderColor = '#555';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#2a2a2a';
              e.target.style.borderColor = '#444';
            }}
          >
            <HiOutlineDocumentText size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Audio Script
          </button>
          {saveSuccess ? (
            <div className="save-success-actions">
              <span className="save-success-message">
                <HiOutlineCheck size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                Saved successfully!
              </span>
              <button 
                onClick={handleDownloadEpub} 
                className="btn-download" 
                disabled={downloading}
              >
                <HiOutlineDownload size={18} />
                {downloading ? 'Downloading...' : 'Download EPUB'}
              </button>
              <button 
                onClick={() => setSaveSuccess(false)} 
                className="btn-save-again"
                title="Save again"
              >
                <HiOutlineSave size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Save Again
              </button>
            </div>
          ) : (
          <button onClick={handleSave} className="btn-save" disabled={loading}>
              {loading ? 'Saving...' : (
                <>
                  <HiOutlineSave size={18} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                  Save & Export
                </>
              )}
          </button>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner"><HiOutlineCheck size={18} /> <span>{success}</span></div>}
      {saveSuccess && !error && !success && (
        <div className="success-banner">
          <HiOutlineCheck size={18} />
          <span>Sync data saved successfully! EPUB has been regenerated with your settings. Click "Download EPUB" in the header to get your file.</span>
        </div>
      )}

      <div className="studio-layout" ref={resizeContainerRef}>
        {/* Left Panel: XHTML Viewer */}
        <aside 
          className="viewer-panel"
          style={{ width: `${leftPanelWidth}px`, minWidth: `${leftPanelWidth}px`, maxWidth: `${leftPanelWidth}px` }}
        >
          <div className="panel-header">
            <h3><HiOutlineDocument size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Page {currentSectionIndex + 1}</h3>
            <div className="page-nav-buttons">
              <button 
                onClick={() => handleSectionChange(Math.max(0, currentSectionIndex - 1))}
                disabled={currentSectionIndex === 0}
                className="btn-page-nav"
              >
                <HiOutlineChevronLeft size={14} />
              </button>
              {sections.length > 1 && (
                <select 
                  value={currentSectionIndex} 
                  onChange={(e) => handleSectionChange(parseInt(e.target.value))}
                  className="page-select"
                >
                  {sections.map((s, i) => (
                    <option key={i} value={i}>Page {i + 1}</option>
                  ))}
                </select>
              )}
              <button 
                onClick={() => handleSectionChange(Math.min(sections.length - 1, currentSectionIndex + 1))}
                disabled={currentSectionIndex >= sections.length - 1}
                className="btn-page-nav"
              >
                <HiOutlinePlay size={14} />
              </button>
            </div>
          </div>
          <div 
            ref={viewerRef}
            className="xhtml-viewer"
            dangerouslySetInnerHTML={{ __html: xhtmlContent }}
          />
        </aside>

        {/* Left Resizable Divider */}
        <div 
          className="studio-divider studio-divider-left"
          onMouseDown={handleLeftResizeStart}
          style={{ cursor: 'col-resize' }}
        >
          <div className="studio-divider-handle" />
        </div>

        {/* Main Content */}
        <main className="main-panel">
          {/* Audio Controls */}
          <div className="audio-controls">
            <div className="control-group">
              <label className="upload-btn">
                <HiOutlineVolumeUp size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Upload Audio
                <input type="file" accept="audio/*" onChange={handleAudioUpload} hidden />
              </label>
              
              <div className="tts-controls">
                <select 
                  value={selectedVoice} 
                  onChange={(e) => setSelectedVoice(e.target.value)}
                >
                  {voices.map((v, i) => (
                    <option key={v.id || i} value={v.value || v.id}>
                      {v.label || v.name}
                    </option>
                  ))}
                </select>
                <button 
                  onClick={handleGenerateAudio} 
                  disabled={generating || !pdfId}
                  className="btn-generate"
                >
                  {generating ? (
                    <>
                      <HiOutlineClock size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Generating...
                    </>
                  ) : (
                    <>
                      <HiOutlineVolumeUp size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Generate TTS
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="playback-controls">
              <button 
                onClick={() => {
                  // Clear segment playback when using main controls
                  if (playingSegmentId) {
                    isProgrammaticPlayRef.current = false;
                    setPlayingSegmentId(null);
                  }
                  wavesurferRef.current?.playPause();
                }}
                disabled={!isReady}
                className="btn-play"
              >
                {isPlaying ? (
                  <>
                    <HiOutlinePause size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Pause
                  </>
                ) : (
                  <>
                    <HiOutlinePlay size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Play
                  </>
                )}
              </button>
              <button 
                onClick={() => wavesurferRef.current?.stop()}
                disabled={!isReady}
              >
                <HiOutlineStop size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Stop
              </button>
              <span className="time-display">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="speed-control">
              <span>Speed:</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                className="speed-select"
                title="Audio playback speed (applied to final EPUB)"
              >
                <option value="0.5">0.5x</option>
                <option value="0.75">0.75x</option>
                <option value="1.0">1.0x (Normal)</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="1.75">1.75x</option>
                <option value="2.0">2.0x</option>
              </select>
            </div>

            <div className="zoom-control">
              <span>Zoom:</span>
              <input 
                type="range" 
                min="10" 
                max="200" 
                value={zoom}
                onChange={(e) => setZoom(parseInt(e.target.value))}
              />
              <span>{zoom}x</span>
            </div>
          </div>

          {/* Waveform */}
          <div className="waveform-container">
            <div id="timeline" className="timeline"></div>
            <div ref={waveformRef} className="waveform"></div>
            
            {!audioUrl && (
              <div className="waveform-placeholder">
                <p><HiOutlineVolumeUp size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Upload or generate audio to see waveform</p>
              </div>
            )}
          </div>

          {/* Track Legend */}
          <div className="track-legend">
            <div className="legend-item sentence">
              <span className="legend-color"></span>
              <span>Sentences ({Object.keys(syncData.sentences).length})</span>
            </div>
            <div className="legend-item word">
              <span className="legend-color"></span>
              <span>Words ({Object.keys(syncData.words).length})</span>
            </div>
          </div>

          {/* Auto-Sync Section (Kitaboo-style) */}
          <div className="auto-sync-section">
            <div className="auto-sync-header">
              <h3><HiOutlineCog size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Auto-Sync</h3>
              <span className={`aeneas-badge ${aeneasAvailable ? 'available' : 'unavailable'}`}>
                {aeneasAvailable === null ? '...' : aeneasAvailable ? (
                  <>
                    <HiOutlineCheckCircle size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Aeneas Ready
                  </>
                ) : (
                  <>
                    <HiOutlineCalculator size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Linear Spread Mode
                  </>
                )}
              </span>
            </div>

            <div className="auto-sync-controls">
              <select 
                value={autoSyncLanguage} 
                onChange={(e) => setAutoSyncLanguage(e.target.value)}
                className="language-select"
              >
                <option value="eng">English</option>
                <option value="fra">French</option>
                <option value="deu">German</option>
                <option value="spa">Spanish</option>
                <option value="ita">Italian</option>
                <option value="por">Portuguese</option>
                <option value="hin">Hindi</option>
                <option value="cmn">Chinese (Mandarin)</option>
                <option value="jpn">Japanese</option>
              </select>

              <button 
                onClick={handleAutoSync}
                disabled={!isReady || autoSyncing}
                className="btn-auto-sync"
                title="Standard Aeneas forced alignment"
              >
                {autoSyncing ? (
                  <>
                    <HiOutlineClock size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Syncing...
                  </>
                ) : (
                  <>
                    <HiOutlineArrowUp size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Auto-Sync
                  </>
                )}
              </button>

              <button 
                onClick={handleMagicSync}
                disabled={!isReady || autoSyncing}
                className="btn-magic-sync"
                title="Hybrid Gemini Alignment - Intelligently skips TOC and unspoken content"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: autoSyncing || !isReady ? 'not-allowed' : 'pointer',
                  opacity: autoSyncing || !isReady ? 0.6 : 1,
                  fontWeight: 'bold',
                  marginLeft: '10px'
                }}
              >
                {autoSyncing ? (
                  <>
                    <HiOutlineClock size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Syncing...
                  </>
                ) : (
                  <>
                    <HiOutlineStar size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Magic Sync
                  </>
                )}
              </button>

              <button 
                onClick={handleLinearSpread}
                disabled={!isReady || autoSyncing}
                className="btn-linear-spread"
                title="Spread timings proportionally based on character count"
              >
                <HiOutlineCalculator size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Linear Spread
              </button>

              <button 
                onClick={async () => {
                  if (window.confirm('Clear all sync data for this job? You will need to re-sync.')) {
                    try {
                      await audioSyncService.deleteAudioSyncsByJob(parseInt(jobId));
                      setSyncData({ sentences: {}, words: {} });
                      if (regionsPluginRef.current) {
                        regionsPluginRef.current.clearRegions();
                      }
                      alert('Sync data cleared. Click Auto-Sync to re-generate.');
                    } catch (err) {
                      setError('Failed to clear sync data: ' + err.message);
                    }
                  }
                }}
                disabled={autoSyncing}
                className="btn-clear-sync"
                title="Clear all sync data and start fresh"
              >
                <HiOutlineTrash size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Clear
              </button>
            </div>

            {autoSyncProgress && (
              <div className="auto-sync-progress">
                <span className="progress-spinner"><HiOutlineClock size={16} /></span>
                <span>{autoSyncProgress}</span>
              </div>
            )}

            <p className="auto-sync-hint">
              {aeneasAvailable 
                ? (
                  <>
                    <HiOutlineCheckCircle size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Aeneas analyzes audio phonemes | <HiOutlineSparkles size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Magic Sync uses AI to skip TOC/unspoken content
                  </>
                ) : (
                  <>
                    <HiOutlineCalculator size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Linear spread calculates timings based on character count
                  </>
                )}
            </p>
          </div>

          {/* Recording Controls (Manual Tap-to-Sync) */}
          <div className="recording-section">
            <div className="section-header">
              <h3><HiOutlineMicrophone size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Manual Tap-to-Sync</h3>
            </div>
            <div className="recording-controls">
              <button 
                onClick={toggleRecording}
                disabled={!isReady}
                className={`btn-record ${isRecording ? 'recording' : ''}`}
              >
                {isRecording ? (
                  <>
                    <HiOutlineStop size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Stop Recording
                  </>
                ) : (
                  <>
                    <HiOutlineMicrophone size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Start Tap-to-Sync
                  </>
                )}
              </button>

              {isRecording && (
                <div className="recording-status">
                  <span className="recording-indicator">●</span>
                  <span>Hold SPACEBAR to mark sentences {currentSentenceIndex + 1} / {parsedElements.filter(el => {
                    const pageMatch = el.id?.match(/page(\d+)/);
                    const elementPageNum = pageMatch ? parseInt(pageMatch[1]) : null;
                    return (elementPageNum === (currentSectionIndex + 1)) || (el.sectionIndex === currentSectionIndex);
                  }).filter(el => el.type === 'sentence' || el.type === 'paragraph').length} (Page {currentSectionIndex + 1})</span>
                  <span className="counter">
                    {currentSentenceIndex} / {parsedElements.filter(e => e.type !== 'word').length}
                  </span>
                </div>
              )}
            </div>

            <button 
              onClick={handleRefreshWordMap}
              disabled={Object.keys(syncData.sentences).length === 0}
              className="btn-refresh"
            >
              <HiOutlineRefresh size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Refresh Word Map
            </button>
          </div>

          {/* Settings */}
          <div className="settings-panel">
            <label className="setting">
              <input 
                type="checkbox" 
                checked={snapToSilence}
                onChange={(e) => setSnapToSilence(e.target.checked)}
              />
              <span><HiOutlinePaperClip size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Snap to Silence</span>
            </label>
            <label className="setting">
              <input 
                type="checkbox" 
                checked={showWordTrack}
                onChange={(e) => setShowWordTrack(e.target.checked)}
              />
              <span><HiOutlineDocumentText size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Show Word Track</span>
            </label>
            <label className="setting">
              <input 
                type="checkbox" 
                checked={scrubOnDrag}
                onChange={(e) => setScrubOnDrag(e.target.checked)}
              />
              <span><HiOutlineVolumeUp size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Scrub on Drag</span>
            </label>

            <div className="granularity-selector">
              <span>Export Level:</span>
              <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
                <option value="word">Word</option>
                <option value="sentence">Sentence</option>
                <option value="paragraph">Paragraph</option>
              </select>
            </div>
          </div>
        </main>

        {/* Right Resizable Divider */}
        <div 
          className="studio-divider studio-divider-right"
          onMouseDown={handleRightResizeStart}
          style={{ cursor: 'col-resize' }}
        >
          <div className="studio-divider-handle" />
        </div>

        {/* Right Panel: Sync List */}
        <aside 
          className="sync-panel"
          style={{ width: `${rightPanelWidth}px`, minWidth: `${rightPanelWidth}px`, maxWidth: `${rightPanelWidth}px` }}
        >
          <div className="panel-header">
            <h3><HiOutlineClipboard size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Page {currentSectionIndex + 1} Sync</h3>
            <div className="page-nav-buttons">
              <button 
                onClick={() => handleSectionChange(Math.max(0, currentSectionIndex - 1))}
                disabled={currentSectionIndex === 0}
                className="btn-page-nav"
              >
                <HiOutlineChevronLeft size={14} />
              </button>
              <span className="page-indicator">{currentSectionIndex + 1} / {sections.length}</span>
              <button 
                onClick={() => handleSectionChange(Math.min(sections.length - 1, currentSectionIndex + 1))}
                disabled={currentSectionIndex >= sections.length - 1}
                className="btn-page-nav"
              >
                <HiOutlinePlay size={14} />
              </button>
            </div>
          </div>
          
          {/* Page Stats */}
          <div className="page-stats">
            <span className="stat">
              <HiOutlineDocumentText size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> {Object.entries(syncData.sentences).filter(([id, data]) => data.pageNumber === currentSectionIndex + 1).length} sentences
            </span>
            <span className="stat">
              <HiOutlineHashtag size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> {Object.entries(syncData.words).filter(([, data]) => 
                data.pageNumber === currentSectionIndex + 1
              ).length} words
            </span>
          </div>
          
          <div className="sync-list">
            {Object.entries(syncData.sentences)
              .filter(([id, data]) => data.pageNumber === currentSectionIndex + 1)
              .sort((a, b) => {
                // Sort SKIPPED blocks to the end, then by start time
                if (a[1].status === 'SKIPPED' && b[1].status !== 'SKIPPED') return 1;
                if (a[1].status !== 'SKIPPED' && b[1].status === 'SKIPPED') return -1;
                return (a[1].start || 0) - (b[1].start || 0);
              })
              .map(([id, data]) => {
                const isSkipped = data.status === 'SKIPPED';
                return (
              <div 
                key={id}
                className={`sync-item ${activeRegionId === id ? 'active' : ''} ${isSkipped ? 'skipped' : ''}`}
                onClick={() => {
                  if (isSkipped) return; // Don't allow interaction with skipped blocks
                  setActiveRegionId(id);
                  highlightElement(data.id); // Use original XHTML ID
                  if (wavesurferRef.current && data.start !== undefined) {
                    wavesurferRef.current.setTime(data.start);
                  }
                }}
              >
                <div className="sync-item-header">
                  <span className="sync-id" title={data.id || id}>{data.id || id || 'No ID'}</span>
                  {isSkipped ? (
                    <span className="badge-skipped">Not in Audio</span>
                  ) : (
                    <span className="sync-time">
                      {formatTime(data.start)} - {formatTime(data.end)}
                    </span>
                  )}
                </div>
                {editingBlockId === id ? (
                  <div className="edit-text-container">
                    <textarea
                      value={editedText}
                      onChange={(e) => setEditedText(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        minHeight: '60px',
                        padding: '8px',
                        fontSize: '13px',
                        border: '2px solid #1976d2',
                        borderRadius: '4px',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        marginBottom: '8px'
                      }}
                      autoFocus
                      placeholder="Edit text here..."
                    />
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {!isSkipped && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlaySegment(id);
                            }}
                            disabled={regeneratingBlock !== null || !isReady}
                            style={{
                              padding: '4px 8px',
                              border: '1px solid #4caf50',
                              borderRadius: '4px',
                              backgroundColor: playingSegmentId === id && isPlaying ? '#c8e6c9' : '#e8f5e9',
                              color: '#2e7d32',
                              cursor: regeneratingBlock !== null || !isReady ? 'not-allowed' : 'pointer',
                              fontSize: '11px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              opacity: regeneratingBlock !== null || !isReady ? 0.5 : 1
                            }}
                            title={playingSegmentId === id && isPlaying ? "Pause playback" : "Play this segment"}
                          >
                            {playingSegmentId === id && isPlaying ? (
                              <HiOutlinePause size={14} />
                            ) : (
                              <HiOutlinePlay size={14} />
                            )}
                            {playingSegmentId === id && isPlaying ? 'Pause' : 'Play'}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDiagnostics(id);
                          }}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid #ff9800',
                            borderRadius: '4px',
                            backgroundColor: '#fff3e0',
                            color: '#e65100',
                            cursor: 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Show diagnostic information about this segment"
                        >
                          <HiOutlineInformationCircle size={14} />
                          Diagnostics
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveEdit(id);
                        }}
                        disabled={regeneratingBlock === id}
                        style={{
                          padding: '4px 12px',
                          border: '1px solid #4caf50',
                          borderRadius: '4px',
                          backgroundColor: '#4caf50',
                          color: 'white',
                          cursor: regeneratingBlock === id ? 'not-allowed' : 'pointer',
                          fontSize: '12px',
                          opacity: regeneratingBlock === id ? 0.6 : 1
                        }}
                      >
                        {regeneratingBlock === id ? (
                          <>
                            <HiOutlineClock size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                            Regenerating...
                          </>
                        ) : (
                          <>
                            <HiOutlineSave size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                            Save & Regenerate
                          </>
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEdit();
                        }}
                        disabled={regeneratingBlock === id}
                        style={{
                          padding: '4px 12px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          backgroundColor: '#fff',
                          color: '#666',
                          cursor: regeneratingBlock === id ? 'not-allowed' : 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        <HiOutlineX size={14} style={{ verticalAlign: 'middle' }} /> Cancel
                      </button>
                      </div>
                    </div>
                    {regeneratingBlock === id && (
                      <div style={{ fontSize: '11px', color: '#1976d2', marginTop: '4px', fontStyle: 'italic' }}>
                        <HiOutlineSun size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Regenerating audio with new text...
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="sync-text" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ flex: 1 }}>{data.text || 'No text'}</span>
                    {!isSkipped && (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlaySegment(id);
                          }}
                          disabled={regeneratingBlock !== null || !isReady}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid #4caf50',
                            borderRadius: '4px',
                            backgroundColor: playingSegmentId === id && isPlaying ? '#c8e6c9' : '#e8f5e9',
                            color: '#2e7d32',
                            cursor: regeneratingBlock !== null || !isReady ? 'not-allowed' : 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: regeneratingBlock !== null || !isReady ? 0.5 : 1
                          }}
                          title={playingSegmentId === id && isPlaying ? "Pause playback" : "Play this segment"}
                        >
                          {playingSegmentId === id && isPlaying ? (
                            <>
                              <HiOutlinePause size={12} /> Pause
                            </>
                          ) : (
                            <>
                              <HiOutlinePlay size={12} /> Play
                            </>
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDiagnostics(id);
                          }}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid #ff9800',
                            borderRadius: '4px',
                            backgroundColor: '#fff3e0',
                            color: '#e65100',
                            cursor: 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Show diagnostic information about this segment"
                        >
                          <HiOutlineInformationCircle size={12} /> Diagnostics
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(id, data.text);
                          }}
                          disabled={regeneratingBlock !== null}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid #1976d2',
                            borderRadius: '4px',
                            backgroundColor: '#e3f2fd',
                            color: '#1976d2',
                            cursor: regeneratingBlock !== null ? 'not-allowed' : 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: regeneratingBlock !== null ? 0.5 : 1
                          }}
                          title="Edit text (audio will be regenerated)"
                        >
                          <HiOutlinePencil size={12} /> Edit
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSegment(id);
                          }}
                          disabled={regeneratingBlock !== null}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid #d32f2f',
                            borderRadius: '4px',
                            backgroundColor: '#ffebee',
                            color: '#d32f2f',
                            cursor: regeneratingBlock !== null ? 'not-allowed' : 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: regeneratingBlock !== null ? 0.5 : 1
                          }}
                          title="Delete this segment from the audio sequence"
                        >
                          <HiOutlineTrash size={12} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Word children */}
                {showWordTrack && (
                  <div className="word-children">
                    {Object.entries(syncData.words)
                      .filter(([, wdata]) => {
                        // Match words whose parent ID matches this sentence's original ID
                        const sentenceOriginalId = data.id;
                        return wdata.parentId === sentenceOriginalId && wdata.pageNumber === data.pageNumber;
                      })
                      .sort((a, b) => a[1].start - b[1].start)
                      .map(([wid, wdata]) => (
                        <div 
                          key={wid}
                          className={`word-item ${activeRegionId === wid ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveRegionId(wid);
                            highlightElement(wdata.id);
                            if (wavesurferRef.current) {
                              wavesurferRef.current.setTime(wdata.start);
                            }
                          }}
                        >
                          <span className="word-id">{wdata.id?.split('_w')[1] || '?'}</span>
                          <span className="word-text">{wdata.text}</span>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            );
            })}

            {Object.entries(syncData.sentences).filter(([id, data]) => data.pageNumber === currentSectionIndex + 1).length === 0 && (
              <div className="empty-state">
                <p>No sync points for Page {currentSectionIndex + 1}.</p>
                <p>Use Auto-Sync or Tap-to-Sync to create regions.</p>
                {Object.keys(syncData.sentences).length > 0 && (
                  <p className="hint"><HiOutlineSun size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Total: {Object.keys(syncData.sentences).length} sentences synced across all pages</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Audio Script Modal */}
      {showAudioScript && (
        <div 
          className="audio-script-modal-overlay"
          onClick={() => setShowAudioScript(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div 
            className="audio-script-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1a1a1a',
              borderRadius: '8px',
              width: '90%',
              maxWidth: '900px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #444',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px',
              borderBottom: '2px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{
                margin: 0,
                color: '#fff',
                fontSize: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <HiOutlineDocumentText size={24} />
                Complete Audio Script
              </h2>
              <button
                onClick={() => setShowAudioScript(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#e0e0e0',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => e.target.style.background = '#333'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <HiOutlineX size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {loadingAudioScript ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                  <HiOutlineClock size={32} style={{ marginBottom: '10px', opacity: 0.5 }} />
                  <p>Loading audio script...</p>
                </div>
              ) : (() => {
                // Sort sentences by start time - use audioScriptData from backend
                const sortedSentences = Object.entries(audioScriptData.sentences)
                  .filter(([, data]) => data.status !== 'SKIPPED')
                  .sort((a, b) => a[1].start - b[1].start);

                if (sortedSentences.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                      <p>No audio script available.</p>
                      <p>Sync audio segments to see the script here.</p>
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {sortedSentences.map(([id, data], index) => (
                      <div 
                        key={id}
                        style={{
                          background: '#2a2a2a',
                          border: '1px solid #333',
                          borderRadius: '6px',
                          padding: '15px',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#444';
                          e.currentTarget.style.background = '#2f2f2f';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#333';
                          e.currentTarget.style.background = '#2a2a2a';
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          marginBottom: '10px',
                          flexWrap: 'wrap'
                        }}>
                          <span style={{
                            background: '#1976d2',
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            fontSize: '12px',
                            minWidth: '30px',
                            textAlign: 'center'
                          }}>
                            #{index + 1}
                          </span>
                          <span style={{
                            color: '#4caf50',
                            fontFamily: 'Courier New, monospace',
                            fontSize: '13px',
                            fontWeight: '500'
                          }}>
                            {data.id}
                          </span>
                          <span style={{
                            color: '#ffa726',
                            fontSize: '13px',
                            fontFamily: 'Courier New, monospace'
                          }}>
                            {formatTime(data.start)} - {formatTime(data.end)}
                          </span>
                          <span style={{
                            color: '#9e9e9e',
                            fontSize: '12px',
                            marginLeft: 'auto'
                          }}>
                            Page {data.pageNumber}
                          </span>
                        </div>
                        {editingScriptBlockId === id ? (
                          <div>
                            <textarea
                              value={editedScriptText}
                              onChange={(e) => setEditedScriptText(e.target.value)}
                              style={{
                                width: '100%',
                                minHeight: '60px',
                                padding: '8px',
                                fontSize: '13px',
                                border: '2px solid #1976d2',
                                borderRadius: '4px',
                                fontFamily: 'inherit',
                                resize: 'vertical',
                                marginBottom: '8px',
                                background: '#1a1a1a',
                                color: '#e0e0e0'
                              }}
                              autoFocus
                              placeholder="Edit text here..."
                            />
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <button
                                onClick={() => handleSaveEditScript(id)}
                                disabled={regeneratingScriptBlock === id}
                                style={{
                                  padding: '4px 12px',
                                  border: '1px solid #4caf50',
                                  borderRadius: '4px',
                                  backgroundColor: regeneratingScriptBlock === id ? '#81c784' : '#4caf50',
                                  color: 'white',
                                  cursor: regeneratingScriptBlock === id ? 'not-allowed' : 'pointer',
                                  fontSize: '12px',
                                  opacity: regeneratingScriptBlock === id ? 0.7 : 1
                                }}
                              >
                                {regeneratingScriptBlock === id ? (
                                  <>
                                    <HiOutlineClock size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                    Regenerating...
                                  </>
                                ) : (
                                  <>
                                    <HiOutlineSave size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                    Save & Regenerate
                                  </>
                                )}
                              </button>
                              <button
                                onClick={handleCancelEditScript}
                                disabled={regeneratingScriptBlock === id}
                                style={{
                                  padding: '4px 12px',
                                  border: '1px solid #ccc',
                                  borderRadius: '4px',
                                  backgroundColor: '#fff',
                                  color: '#666',
                                  cursor: regeneratingScriptBlock === id ? 'not-allowed' : 'pointer',
                                  fontSize: '12px',
                                  opacity: regeneratingScriptBlock === id ? 0.5 : 1
                                }}
                              >
                                <HiOutlineX size={14} style={{ verticalAlign: 'middle' }} /> Cancel
                              </button>
                            </div>
                            {regeneratingScriptBlock === id && (
                              <div style={{ fontSize: '11px', color: '#1976d2', marginTop: '4px', fontStyle: 'italic' }}>
                                <HiOutlineSun size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Regenerating audio with new text...
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <div style={{
                              color: '#e0e0e0',
                              fontSize: '15px',
                              lineHeight: '1.6',
                              padding: '10px',
                              background: '#252525',
                              borderRadius: '4px',
                              whiteSpace: 'pre-wrap',
                              wordWrap: 'break-word',
                              flex: 1
                            }}>
                              {data.text || '(No text)'}
                            </div>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <button
                                onClick={() => handlePlayScriptSegment(id)}
                                disabled={!isReady}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid #4caf50',
                                  borderRadius: '4px',
                                  backgroundColor: playingScriptSegmentId === id && isPlaying ? '#c8e6c9' : '#e8f5e9',
                                  color: '#2e7d32',
                                  cursor: !isReady ? 'not-allowed' : 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  opacity: !isReady ? 0.5 : 1
                                }}
                                title={playingScriptSegmentId === id && isPlaying ? "Pause playback" : "Play this segment"}
                              >
                                {playingScriptSegmentId === id && isPlaying ? (
                                  <>
                                    <HiOutlinePause size={12} /> Pause
                                  </>
                                ) : (
                                  <>
                                    <HiOutlinePlay size={12} /> Play
                                  </>
                                )}
                              </button>
                              <button
                                onClick={() => handleStartEditScript(id, data.text)}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid #1976d2',
                                  borderRadius: '4px',
                                  backgroundColor: '#e3f2fd',
                                  color: '#1976d2',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Edit text"
                              >
                                <HiOutlinePencil size={12} /> Edit
                              </button>
                              <button
                                onClick={() => handleDeleteScriptBlock(id)}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid #d32f2f',
                                  borderRadius: '4px',
                                  backgroundColor: '#ffebee',
                                  color: '#d32f2f',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Delete this block"
                              >
                                <HiOutlineTrash size={12} /> Delete
                              </button>
                            </div>
                          </div>
                        )}
                        {audioScriptData.words && Object.entries(audioScriptData.words)
                          .filter(([, wdata]) => wdata.parentId === data.id)
                          .length > 0 && (
                          <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px',
                            marginTop: '10px',
                            paddingTop: '10px',
                            borderTop: '1px dashed #444'
                          }}>
                            {Object.entries(audioScriptData.words)
                              .filter(([, wdata]) => wdata.parentId === data.id)
                              .sort((a, b) => a[1].start - b[1].start)
                              .map(([wid, wdata]) => (
                                <span 
                                  key={wid}
                                  style={{
                                    background: '#333',
                                    color: '#b0b0b0',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    border: '1px solid #444'
                                  }}
                                >
                                  {wdata.text}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '15px 20px',
              borderTop: '2px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#1f1f1f'
            }}>
              <div style={{
                display: 'flex',
                gap: '20px',
                fontSize: '14px',
                color: '#b0b0b0'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <HiOutlineDocumentText size={16} />
                  {Object.entries(audioScriptData.sentences).filter(([, data]) => data.status !== 'SKIPPED').length} segments
                </span>
                {(() => {
                  const sorted = Object.entries(audioScriptData.sentences)
                    .filter(([, data]) => data.status !== 'SKIPPED')
                    .sort((a, b) => a[1].start - b[1].start);
                  const totalDuration = sorted.length > 0 ? sorted[sorted.length - 1][1].end : 0;
                  return (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <HiOutlineClock size={16} />
                      {formatTime(totalDuration)} total duration
                    </span>
                  );
                })()}
              </div>
              <button
                onClick={() => setShowAudioScript(false)}
                style={{
                  padding: '8px 16px',
                  background: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
                onMouseEnter={(e) => e.target.style.background = '#1565c0'}
                onMouseLeave={(e) => e.target.style.background = '#1976d2'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostic Modal */}
      {showDiagnostics && diagnosticData && (
        <div 
          className="diagnostic-modal-overlay"
          onClick={() => setShowDiagnostics(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div 
            className="diagnostic-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1a1a1a',
              borderRadius: '8px',
              width: '90%',
              maxWidth: '1000px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #444',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px',
              borderBottom: '2px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)'
            }}>
              <h2 style={{
                margin: 0,
                color: '#fff',
                fontSize: '22px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <HiOutlineInformationCircle size={28} color="#ff9800" />
                Audio Playback Diagnostics
              </h2>
              <button
                onClick={() => setShowDiagnostics(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#e0e0e0',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => e.target.style.background = '#333'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <HiOutlineX size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {loadingDiagnostics ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                  <HiOutlineClock size={32} style={{ marginBottom: '10px', opacity: 0.5 }} />
                  <p>Loading diagnostics...</p>
                </div>
              ) : diagnosticData.error ? (
                <div style={{ 
                  padding: '20px', 
                  background: '#3d1f1f', 
                  border: '1px solid #d32f2f', 
                  borderRadius: '6px',
                  color: '#ffcdd2'
                }}>
                  <h3 style={{ marginTop: 0, color: '#f44336' }}>Error</h3>
                  <p>{diagnosticData.error}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Segment ID */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ 
                      margin: '0 0 10px 0', 
                      color: '#4caf50',
                      fontSize: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <HiOutlineHashtag size={18} />
                      Segment ID: <span style={{ color: '#fff', fontFamily: 'Courier New, monospace' }}>{diagnosticData.segmentId}</span>
                    </h3>
                  </div>

                  {/* Local State */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#64b5f6', fontSize: '16px' }}>
                      📦 Local State (syncData)
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Text:</span>
                        <div style={{ 
                          color: '#e0e0e0', 
                          marginTop: '4px',
                          padding: '8px',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          border: '1px solid #333',
                          wordBreak: 'break-word'
                        }}>
                          {diagnosticData.localState.text}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Page Number:</span>
                        <div style={{ color: '#e0e0e0', marginTop: '4px' }}>
                          {diagnosticData.localState.pageNumber || 'N/A'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Start Time:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.localState.start !== undefined ? `${diagnosticData.localState.start.toFixed(3)}s` : 'NOT SET'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>End Time:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.localState.end !== undefined ? `${diagnosticData.localState.end.toFixed(3)}s` : 'NOT SET'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Duration:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.localState.duration !== null ? `${diagnosticData.localState.duration.toFixed(3)}s` : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Edit State */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#ba68c8', fontSize: '16px' }}>
                      ✏️ Edit State
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Currently Editing:</span>
                        <div style={{ 
                          color: diagnosticData.editState.isEditing ? '#4caf50' : '#9e9e9e',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.editState.isEditing ? 'YES' : 'NO'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Text Changed:</span>
                        <div style={{ 
                          color: diagnosticData.editState.textChanged ? '#ff9800' : '#9e9e9e',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.editState.textChanged ? 'YES (Unsaved)' : 'NO'}
                        </div>
                      </div>
                      {diagnosticData.editState.editedText && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ color: '#9e9e9e' }}>Edited Text (Unsaved):</span>
                          <div style={{ 
                            color: '#fff3e0', 
                            marginTop: '4px',
                            padding: '8px',
                            background: '#3d2f1f',
                            borderRadius: '4px',
                            border: '1px solid #ff9800',
                            wordBreak: 'break-word'
                          }}>
                            {diagnosticData.editState.editedText}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Playback State */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                      <h3 style={{ margin: 0, color: '#4caf50', fontSize: '16px' }}>
                        ▶️ Playback State
                      </h3>
                      {diagnosticData.localState.start !== undefined && diagnosticData.localState.end !== undefined && (
                        <button
                          onClick={() => {
                            const segmentId = diagnosticData.segmentId;
                            const expectedText = diagnosticData.localState.text;
                            
                            console.log(`[Diagnostics] Testing playback for segment ${segmentId}`);
                            console.log(`[Diagnostics] Expected text: "${expectedText}"`);
                            console.log(`[Diagnostics] Playback timings: ${diagnosticData.localState.start.toFixed(3)}s - ${diagnosticData.localState.end.toFixed(3)}s`);
                            
                            // Clear previous transcription
                            setTranscribedText('');
                            
                            // Start speech recognition before playing
                            const recognition = startSpeechRecognition(segmentId, expectedText);
                            
                            // Play the segment
                            handlePlaySegment(segmentId);
                            
                            // Update diagnostics after a short delay to show playback state
                            setTimeout(() => {
                              handleDiagnostics(segmentId);
                            }, 500);
                            
                            // Stop recognition when playback ends
                            const segmentData = syncDataRef.current.sentences[segmentId];
                            if (segmentData && segmentData.end && segmentData.start) {
                              const duration = (segmentData.end - segmentData.start) * 1000 + 3000; // Add 3 second buffer
                              setTimeout(() => {
                                stopSpeechRecognition();
                              }, duration);
                            }
                          }}
                          disabled={!diagnosticData.playbackState.isReady}
                          style={{
                            padding: '8px 16px',
                            background: diagnosticData.playbackState.isReady ? '#4caf50' : '#666',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: diagnosticData.playbackState.isReady ? 'pointer' : 'not-allowed',
                            fontSize: '14px',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            opacity: diagnosticData.playbackState.isReady ? 1 : 0.5
                          }}
                          title={diagnosticData.playbackState.isReady 
                            ? `Play segment to test if it reads: "${diagnosticData.localState.text}"` 
                            : 'Audio not ready'}
                          onMouseEnter={(e) => {
                            if (diagnosticData.playbackState.isReady) {
                              e.target.style.background = '#45a049';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (diagnosticData.playbackState.isReady) {
                              e.target.style.background = '#4caf50';
                            }
                          }}
                        >
                          {playingSegmentId === diagnosticData.segmentId && isPlaying ? (
                            <>
                              <HiOutlinePause size={16} />
                              Pause Test
                            </>
                          ) : (
                            <>
                              <HiOutlinePlay size={16} />
                              Test Playback
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Is Playing:</span>
                        <div style={{ 
                          color: playingSegmentId === diagnosticData.segmentId && isPlaying ? '#4caf50' : '#9e9e9e',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {playingSegmentId === diagnosticData.segmentId && isPlaying ? 'YES' : 'NO'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Audio Ready:</span>
                        <div style={{ 
                          color: diagnosticData.playbackState.isReady ? '#4caf50' : '#f44336',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.playbackState.isReady ? 'YES' : 'NO'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Waveform Time:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.playbackState.waveformTime.toFixed(3)}s
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Waveform Duration:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.playbackState.waveformDuration.toFixed(3)}s
                        </div>
                      </div>
                    </div>
                    {diagnosticData.localState.text && (
                      <>
                        <div style={{ 
                          marginTop: '15px', 
                          padding: '10px', 
                          background: '#1a1a1a', 
                          borderRadius: '4px',
                          border: '1px solid #4caf50'
                        }}>
                          <div style={{ color: '#9e9e9e', fontSize: '12px', marginBottom: '4px' }}>
                            Expected Text (should hear this):
                          </div>
                          <div style={{ 
                            color: '#4caf50', 
                            fontSize: '14px',
                            fontWeight: '500',
                            fontStyle: 'italic'
                          }}>
                            "{diagnosticData.localState.text}"
                          </div>
                        </div>
                        
                        {/* Speech-to-Text Transcription Container */}
                        <div style={{ 
                          marginTop: '15px', 
                          padding: '12px', 
                          background: '#1a1a1a', 
                          borderRadius: '4px',
                          border: transcribedText ? '1px solid #64b5f6' : '1px solid #666',
                          minHeight: '80px'
                        }}>
                          <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: '8px'
                          }}>
                            <div style={{ color: '#64b5f6', fontSize: '12px', fontWeight: '500' }}>
                              🎤 Transcribed Text (what was actually heard):
                            </div>
                            {isTranscribing && (
                              <div style={{ 
                                color: '#ff9800', 
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}>
                                <span style={{ 
                                  display: 'inline-block',
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: '#ff9800',
                                  animation: 'pulse 1.5s infinite'
                                }}></span>
                                Listening...
                              </div>
                            )}
                          </div>
                          {transcribedText && transcribedText !== 'Listening...' ? (
                            <div style={{ 
                              color: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() 
                                ? '#4caf50' 
                                : '#ff9800', 
                              fontSize: '14px',
                              fontWeight: '500',
                              fontStyle: 'italic',
                              wordBreak: 'break-word',
                              padding: '8px',
                              background: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim()
                                ? 'rgba(76, 175, 80, 0.1)'
                                : 'rgba(255, 152, 0, 0.1)',
                              borderRadius: '4px',
                              border: `1px solid ${transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() ? '#4caf50' : '#ff9800'}`
                            }}>
                              "{transcribedText}"
                            </div>
                          ) : (
                            <div style={{ 
                              color: '#9e9e9e', 
                              fontSize: '12px',
                              fontStyle: 'italic',
                              padding: '8px'
                            }}>
                              {isTranscribing 
                                ? (transcribedText === 'Listening...' 
                                  ? '⚠️ Microphone not detecting audio. Check "Root Cause Analysis" below for the actual issue.' 
                                  : 'Listening to audio...') 
                                : 'Click "Test Playback" to transcribe what you hear (requires microphone access)'}
                            </div>
                          )}
                          
                          {/* Comparison Result */}
                          {transcribedText && diagnosticData.localState.text && (
                            <div style={{ 
                              marginTop: '10px',
                              padding: '8px',
                              background: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim()
                                ? 'rgba(76, 175, 80, 0.15)'
                                : 'rgba(244, 67, 54, 0.15)',
                              borderRadius: '4px',
                              border: `1px solid ${transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() ? '#4caf50' : '#f44336'}`
                            }}>
                              <div style={{ 
                                color: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() ? '#4caf50' : '#f44336',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}>
                                {transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() 
                                  ? '✓ Match: Transcribed text matches expected text!' 
                                  : '✗ Mismatch: Transcribed text does not match expected text'}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Audio File */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#64b5f6', fontSize: '16px' }}>
                      🎵 Audio File
                    </h3>
                    <div style={{ fontSize: '14px' }}>
                      <div style={{ marginBottom: '10px' }}>
                        <span style={{ color: '#9e9e9e' }}>Audio URL:</span>
                        <div style={{ 
                          color: '#e0e0e0', 
                          marginTop: '4px',
                          padding: '8px',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          border: '1px solid #333',
                          fontFamily: 'Courier New, monospace',
                          fontSize: '12px',
                          wordBreak: 'break-all'
                        }}>
                          {diagnosticData.audioFile.url || 'NOT SET'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>File Ready:</span>
                        <div style={{ 
                          color: diagnosticData.audioFile.isReady ? '#4caf50' : '#f44336',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.audioFile.isReady ? 'YES' : 'NO'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Backend Data */}
                  {diagnosticData.backendData && (
                    <div style={{
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#ab47bc', fontSize: '16px' }}>
                        💾 Backend Data (Database)
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Text:</span>
                          <div style={{ 
                            color: '#e0e0e0', 
                            marginTop: '4px',
                            padding: '8px',
                            background: '#1a1a1a',
                            borderRadius: '4px',
                            border: '1px solid #333',
                            wordBreak: 'break-word'
                          }}>
                            {diagnosticData.backendData.text || 'NOT FOUND'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Sync ID:</span>
                          <div style={{ color: '#e0e0e0', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.backendData.syncId || 'NOT FOUND'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Start Time:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.backendData.startTime !== undefined ? `${diagnosticData.backendData.startTime.toFixed(3)}s` : 'NOT SET'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>End Time:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.backendData.endTime !== undefined ? `${diagnosticData.backendData.endTime.toFixed(3)}s` : 'NOT SET'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Region Data */}
                  {diagnosticData.regionData ? (
                    <div style={{
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#26a69a', fontSize: '16px' }}>
                        📍 Region Data (Waveform)
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: '14px' }}>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Start:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.regionData.start.toFixed(3)}s
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>End:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.regionData.end.toFixed(3)}s
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Duration:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.regionData.duration.toFixed(3)}s
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      background: '#3d2f1f',
                      border: '1px solid #ff9800',
                      borderRadius: '6px',
                      padding: '15px',
                      color: '#ffcc80'
                    }}>
                      <h3 style={{ margin: '0 0 10px 0', color: '#ff9800', fontSize: '16px' }}>
                        ⚠️ Region Data
                      </h3>
                      <p style={{ margin: '0 0 15px 0' }}>Region not found on waveform. The segment may need to be re-synced.</p>
                      {diagnosticData.localState.start !== undefined && diagnosticData.localState.end !== undefined && (
                        <button
                          onClick={() => {
                            const segmentId = diagnosticData.segmentId;
                            const start = diagnosticData.localState.start;
                            const end = diagnosticData.localState.end;
                            
                            if (regionsPluginRef.current && isReady) {
                              // Check if region already exists
                              const existingRegion = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
                              if (existingRegion) {
                                existingRegion.setOptions({ start, end });
                                console.log(`[Region] Updated existing region for ${segmentId}`);
                              } else {
                                createRegion(segmentId, start, end, 'sentence');
                                console.log(`[Region] Created region for ${segmentId}`);
                              }
                              // Refresh diagnostics
                              handleDiagnostics(segmentId);
                            } else {
                              alert('Audio is not ready yet. Please wait for the audio to load completely.');
                            }
                          }}
                          style={{
                            padding: '8px 16px',
                            background: '#ff9800',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: isReady ? 'pointer' : 'not-allowed',
                            fontSize: '14px',
                            fontWeight: '500',
                            opacity: isReady ? 1 : 0.5
                          }}
                          disabled={!isReady}
                          onMouseEnter={(e) => {
                            if (isReady) e.target.style.background = '#fb8c00';
                          }}
                          onMouseLeave={(e) => {
                            if (isReady) e.target.style.background = '#ff9800';
                          }}
                        >
                          🔧 Recreate Region Now
                        </button>
                      )}
                    </div>
                  )}

                  {/* Root Cause Analysis */}
                  {diagnosticData.rootCauseAnalysis && diagnosticData.rootCauseAnalysis.length > 0 && (
                    <div style={{
                      background: '#1f1f3d',
                      border: '1px solid #673ab7',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#9c27b0', fontSize: '16px' }}>
                        🔍 Root Cause Analysis
                      </h3>
                      {diagnosticData.rootCauseAnalysis.map((analysis, idx) => (
                        <div key={idx} style={{ 
                          marginBottom: idx < diagnosticData.rootCauseAnalysis.length - 1 ? '15px' : '0',
                          padding: '12px',
                          background: '#2a2a3d',
                          borderRadius: '4px',
                          border: '1px solid #444'
                        }}>
                          <div style={{ 
                            color: '#ff9800', 
                            fontSize: '14px', 
                            fontWeight: '600',
                            marginBottom: '6px'
                          }}>
                            Issue #{idx + 1}: {analysis.issue}
                          </div>
                          <div style={{ color: '#e0e0e0', fontSize: '13px', marginBottom: '6px' }}>
                            <strong>Description:</strong> {analysis.description}
                          </div>
                          <div style={{ color: '#ffcdd2', fontSize: '13px', marginBottom: '6px' }}>
                            <strong>Impact:</strong> {analysis.impact}
                          </div>
                          <div style={{ color: '#c8e6c9', fontSize: '13px', marginBottom: analysis.details ? '8px' : '0' }}>
                            <strong>Solution:</strong> {analysis.solution}
                          </div>
                          {analysis.details && analysis.details.length > 0 && (
                            <div style={{ marginTop: '8px', padding: '8px', background: '#1a1a2a', borderRadius: '4px' }}>
                              <div style={{ color: '#9e9e9e', fontSize: '12px', marginBottom: '4px' }}>Details:</div>
                              {analysis.details.map((detail, detailIdx) => (
                                <div key={detailIdx} style={{ 
                                  color: '#e0e0e0', 
                                  fontSize: '12px',
                                  marginBottom: '4px',
                                  paddingLeft: '12px',
                                  fontFamily: 'Courier New, monospace'
                                }}>
                                  • {detail.blockId}: "{detail.text}" ({detail.startTime?.toFixed(3)}s - {detail.endTime?.toFixed(3)}s)
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Mismatches */}
                  {diagnosticData.mismatches && diagnosticData.mismatches.length > 0 && (
                    <div style={{
                      background: '#3d1f1f',
                      border: '1px solid #d32f2f',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#f44336', fontSize: '16px' }}>
                        ⚠️ Detected Issues
                      </h3>
                      <ul style={{ margin: 0, paddingLeft: '20px', color: '#ffcdd2' }}>
                        {diagnosticData.mismatches.map((mismatch, idx) => (
                          <li key={idx} style={{ marginBottom: '8px' }}>{mismatch}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recommendations */}
                  <div style={{
                    background: '#1f3d1f',
                    border: '1px solid #4caf50',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#4caf50', fontSize: '16px' }}>
                      💡 Recommendations
                    </h3>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#c8e6c9' }}>
                      {diagnosticData.recommendations.map((rec, idx) => (
                        <li key={idx} style={{ marginBottom: '8px' }}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '15px 20px',
              borderTop: '2px solid #333',
              display: 'flex',
              justifyContent: 'flex-end',
              background: '#1f1f1f'
            }}>
              <button
                onClick={() => {
                  stopSpeechRecognition();
                  setShowDiagnostics(false);
                }}
                style={{
                  padding: '8px 16px',
                  background: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
                onMouseEnter={(e) => e.target.style.background = '#1565c0'}
                onMouseLeave={(e) => e.target.style.background = '#1976d2'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncStudio;

