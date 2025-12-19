import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { HiOutlineDownload, HiOutlineCheck } from 'react-icons/hi';
import { audioSyncService } from '../services/audioSyncService';
import { conversionService } from '../services/conversionService';
import './SyncStudio.css';

/**
 * SyncStudio - Professional Waveform Timeline Audio Sync Interface
 * 
 * Features:
 * - Multi-track waveform visualization (wavesurfer.js)
 * - Sentence and Word level tracksimage.png
 * - Magnetic snap to silence (zero-crossing detection)
 * - Audio scrubbing during drag
 * - Spacebar tap-in/tap-out for marking
 * - Auto-propagation of word timings
 * - Real-time XHTML preview highlighting
 */
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
    if (!viewerRef.current) return;

    // Remove previous highlights
    const highlighted = viewerRef.current.querySelectorAll('.studio-highlight');
    highlighted.forEach(el => el.classList.remove('studio-highlight'));

    // Add new highlight
    if (elementId) {
      const el = viewerRef.current.querySelector(`#${CSS.escape(elementId)}`);
      if (el) {
        el.classList.add('studio-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    wavesurferRef.current.on('audioprocess', (time) => {
      setCurrentTime(time);
      
      // Find and highlight active region
      if (regionsPluginRef.current) {
        const regions = regionsPluginRef.current.getRegions();
        const active = regions.find(r => time >= r.start && time < r.end);
        if (active && active.id !== activeRegionId) {
          setActiveRegionId(active.id);
          highlightElement(active.id);
        }
      }
    });

    wavesurferRef.current.on('play', () => setIsPlaying(true));
    wavesurferRef.current.on('pause', () => setIsPlaying(false));
    wavesurferRef.current.on('finish', () => setIsPlaying(false));

    // Region events
    regionsPluginRef.current.on('region-updated', handleRegionUpdate);
    regionsPluginRef.current.on('region-in', handleRegionDrag);
    regionsPluginRef.current.on('region-clicked', (region, e) => {
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

            console.log(`[TapOut] ✅ Page ${currentSectionIndex + 1} - ${element.id}: ${snappedStart.toFixed(3)}s - ${snappedEnd.toFixed(3)}s (held for ${(holdDuration * 1000).toFixed(0)}ms)`);
            
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
          setSections(sectionsData);
          setXhtmlContent(sectionsData[0]?.xhtml || '');

          // Parse elements from all sections
          const allElements = [];
          sectionsData.forEach((section, idx) => {
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

              // Build a map of ID -> pageNumber from XHTML sections
              const idToPageMap = {};
              sectionsData.forEach((section, idx) => {
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
      alert(`✅ Auto-sync complete!\n\nMethod: ${result.method === 'aeneas' ? 'Aeneas Forced Alignment' : 'Linear Spread'}\nSentences: ${result.sentences?.length || 0}\nWords: ${result.words?.length || 0}\n\nYou can now fine-tune by dragging regions on the waveform.`);

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

      setAutoSyncProgress('Phase 1: Getting transcript from audio...');
      console.log('[MagicSync] Starting hybrid alignment...');

      const result = await audioSyncService.magicSync(parseInt(jobId), {
        language: autoSyncLanguage,
        granularity: granularity
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
      alert(`✨ Magic Sync complete!\n\nMethod: Hybrid Gemini + Aeneas\nSentences: ${result.sentences?.length || 0}\nWords: ${result.words?.length || 0}${skippedMsg}\n\nTOC and unspoken content automatically skipped!`);

    } catch (err) {
      console.error('[MagicSync] Error:', err);
      setError('Magic Sync failed: ' + err.message);
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
      alert(`✅ Linear spread complete!\n\nSentences: ${result.sentences?.length || 0}\nWords: ${result.words?.length || 0}\n\nTip: Enable "Snap to Silence" and drag regions to refine.`);

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
          <button onClick={() => navigate('/conversions')} className="btn-back">
            ← Back
          </button>
          <h1>Sync Studio</h1>
          <span className="job-badge">Job #{jobId}</span>
        </div>
        <div className="header-right">
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
                💾 Save Again
              </button>
            </div>
          ) : (
            <button onClick={handleSave} className="btn-save" disabled={loading}>
              {loading ? 'Saving...' : '💾 Save & Export'}
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
            <h3>📄 Page {currentSectionIndex + 1}</h3>
            <div className="page-nav-buttons">
              <button 
                onClick={() => handleSectionChange(Math.max(0, currentSectionIndex - 1))}
                disabled={currentSectionIndex === 0}
                className="btn-page-nav"
              >
                ◀
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
                ▶
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
                🎵 Upload Audio
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
                  {generating ? '⏳ Generating...' : '🔊 Generate TTS'}
                </button>
              </div>
            </div>

            <div className="playback-controls">
              <button
                onClick={() => wavesurferRef.current?.playPause()}
                disabled={!isReady}
                className="btn-play"
              >
                {isPlaying ? '⏸️ Pause' : '▶️ Play'}
              </button>
              <button
                onClick={() => wavesurferRef.current?.stop()}
                disabled={!isReady}
              >
                ⏹️ Stop
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
                <p>🎧 Upload or generate audio to see waveform</p>
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
              <h3>⚡ Auto-Sync</h3>
              <span className={`aeneas-badge ${aeneasAvailable ? 'available' : 'unavailable'}`}>
                {aeneasAvailable === null ? '...' : aeneasAvailable ? '🎯 Aeneas Ready' : '📐 Linear Spread Mode'}
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
                {autoSyncing ? '⏳ Syncing...' : '🚀 Auto-Sync'}
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
                {autoSyncing ? '⏳ Syncing...' : '✨ Magic Sync'}
              </button>

              <button 
                onClick={handleLinearSpread}
                disabled={!isReady || autoSyncing}
                className="btn-linear-spread"
                title="Spread timings proportionally based on character count"
              >
                📐 Linear Spread
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
                🗑️ Clear
              </button>
            </div>

            {autoSyncProgress && (
              <div className="auto-sync-progress">
                <span className="progress-spinner">⏳</span>
                <span>{autoSyncProgress}</span>
              </div>
            )}

            <p className="auto-sync-hint">
              {aeneasAvailable 
                ? '🎯 Aeneas analyzes audio phonemes | ✨ Magic Sync uses AI to skip TOC/unspoken content'
                : '📐 Linear spread calculates timings based on character count'}
            </p>
          </div>

          {/* Recording Controls (Manual Tap-to-Sync) */}
          <div className="recording-section">
            <div className="section-header">
              <h3>🎤 Manual Tap-to-Sync</h3>
            </div>
            <div className="recording-controls">
              <button 
                onClick={toggleRecording}
                disabled={!isReady}
                className={`btn-record ${isRecording ? 'recording' : ''}`}
              >
                {isRecording ? '⏹️ Stop Recording' : '⏺️ Start Tap-to-Sync'}
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
              🔄 Refresh Word Map
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
              <span>🧲 Snap to Silence</span>
            </label>
            <label className="setting">
              <input 
                type="checkbox" 
                checked={showWordTrack}
                onChange={(e) => setShowWordTrack(e.target.checked)}
              />
              <span>📝 Show Word Track</span>
            </label>
            <label className="setting">
              <input 
                type="checkbox" 
                checked={scrubOnDrag}
                onChange={(e) => setScrubOnDrag(e.target.checked)}
              />
              <span>🔊 Scrub on Drag</span>
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
            <h3>📋 Page {currentSectionIndex + 1} Sync</h3>
            <div className="page-nav-buttons">
              <button 
                onClick={() => handleSectionChange(Math.max(0, currentSectionIndex - 1))}
                disabled={currentSectionIndex === 0}
                className="btn-page-nav"
              >
                ◀
              </button>
              <span className="page-indicator">{currentSectionIndex + 1} / {sections.length}</span>
              <button 
                onClick={() => handleSectionChange(Math.min(sections.length - 1, currentSectionIndex + 1))}
                disabled={currentSectionIndex >= sections.length - 1}
                className="btn-page-nav"
              >
                ▶
              </button>
            </div>
          </div>
          
          {/* Page Stats */}
          <div className="page-stats">
            <span className="stat">
              📝 {Object.entries(syncData.sentences).filter(([id, data]) => data.pageNumber === currentSectionIndex + 1).length} sentences
            </span>
            <span className="stat">
              🔤 {Object.entries(syncData.words).filter(([, data]) => 
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
                <div className="sync-text">{data.text?.substring(0, 50)}{data.text?.length > 50 ? '...' : ''}</div>
                
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
                  <p className="hint">💡 Total: {Object.keys(syncData.sentences).length} sentences synced across all pages</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default SyncStudio;

