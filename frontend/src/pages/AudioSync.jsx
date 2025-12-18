import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { audioSyncService } from '../services/audioSyncService';
import { conversionService } from '../services/conversionService';
import { pdfService } from '../services/pdfService';
import EpubViewer from '../components/EpubViewer';
import { HiOutlinePlay, HiOutlinePause, HiOutlineVolumeUp, HiOutlineArrowLeft, HiOutlineCode, HiOutlineDocumentText, HiOutlineDownload, HiOutlinePencil, HiOutlineCheck, HiOutlineX } from 'react-icons/hi';
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
  const [changesSaved, setChangesSaved] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [playingBlockId, setPlayingBlockId] = useState(null);
  const [blockAudioElements, setBlockAudioElements] = useState({});
  const [clipTimings, setClipTimings] = useState({}); // Store CLIPBEGIN/CLIPEND timings for each block
  
  // New state for user-uploaded audio workflow
  const [uploadedAudio, setUploadedAudio] = useState(null); // Blob URL of uploaded audio
  const [uploadedAudioFile, setUploadedAudioFile] = useState(null); // File object
  const [syncBlocks, setSyncBlocks] = useState([]); // Parsed sync blocks from XHTML
  const [tapToSyncMode, setTapToSyncMode] = useState(false); // Tap-to-sync mode enabled
  const [currentSyncBlockIndex, setCurrentSyncBlockIndex] = useState(0); // Current block being synced
  const [isRecordingSync, setIsRecordingSync] = useState(false); // Currently recording sync timings

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
        // Don't set audioUrl - we'll use TTS instead
        setAudioSegments(audioData);
        
        // Parse XHTML to extract sync blocks and map to TTS segments
        if (epubSections && epubSections.length > 0) {
          const allSyncBlocks = [];
          epubSections.forEach(section => {
            if (section.xhtml) {
              const blocks = parseXhtmlToSyncBlocks(section.xhtml);
              // Map TTS segments to sync blocks by matching block IDs
              blocks.forEach(block => {
                const matchingSegment = audioData.find(s => 
                  s.blockId === block.id || 
                  s.blockId === block.elementId ||
                  s.blockId === `page_${section.id}_block_${block.id}`
                );
                if (matchingSegment) {
                  block.start = matchingSegment.startTime || 0;
                  block.end = matchingSegment.endTime || 0;
                  block.shouldRead = true; // TTS-generated blocks default to enabled
                  block.pageNumber = matchingSegment.pageNumber || 1;
                }
              });
              allSyncBlocks.push(...blocks);
            }
          });
          
          if (allSyncBlocks.length > 0) {
            setSyncBlocks(allSyncBlocks);
          }
        }
        
        // Initialize clipTimings from audio segments
        const timings = {};
        audioData.forEach(segment => {
          if (segment.blockId) {
            timings[segment.blockId] = {
              clipBegin: segment.startTime || 0,
              clipEnd: segment.endTime || 0
            };
          }
        });
        setClipTimings(timings);
        
        const voiceMatch = audioData[0].notes?.match(/voice:\s*(\w+)/);
        if (voiceMatch) {
          setSelectedVoice(voiceMatch[1]);
        }
        // If audio mappings exist, assume changes were saved previously
        setChangesSaved(true);
        setHasUnsavedChanges(false);
      } else {
        setChangesSaved(false);
        setHasUnsavedChanges(false);
        setClipTimings({});
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

  /**
   * Parse XHTML to extract sync blocks (paragraphs and sentences with data-read-aloud="true")
   * @param {string} xhtmlString - XHTML content string
   * @returns {Array} Array of sync block objects
   */
  const parseXhtmlToSyncBlocks = (xhtmlString) => {
    if (!xhtmlString || typeof xhtmlString !== 'string') {
      return [];
    }

    try {
      // Create a DOMParser to parse XHTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtmlString, 'application/xhtml+xml');
      
      // Check for parsing errors
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        console.error('XHTML parsing error:', parserError.textContent);
        return [];
      }

      const syncBlocks = [];
      
      // Find all elements with data-read-aloud="true"
      const readAloudElements = doc.querySelectorAll('[data-read-aloud="true"]');
      
      readAloudElements.forEach((element, index) => {
        const id = element.getAttribute('id') || `sync-block-${index}`;
        const text = element.textContent?.trim() || '';
        const parentParagraph = element.closest('p[id]');
        const paragraphId = parentParagraph?.getAttribute('id') || null;
        
        // Determine type: if inside a <p>, it's likely a sentence; if it IS a <p>, it's a paragraph
        const type = element.tagName.toLowerCase() === 'p' ? 'paragraph' : 'sentence';
        
        syncBlocks.push({
          id: id,
          text: text,
          type: type,
          paragraphId: paragraphId,
          shouldRead: true, // Default to true
          start: 0,
          end: 0,
          elementId: id // For SMIL reference
        });
      });

      // Also find paragraphs with IDs (even if they don't have data-read-aloud)
      const paragraphs = doc.querySelectorAll('p[id]');
      paragraphs.forEach((para, index) => {
        const paraId = para.getAttribute('id');
        const hasReadAloud = para.hasAttribute('data-read-aloud') && para.getAttribute('data-read-aloud') === 'true';
        
        // Only add if it doesn't already have read-aloud children or if it's marked for read-aloud
        const hasReadAloudChildren = Array.from(para.querySelectorAll('[data-read-aloud="true"]')).length > 0;
        
        if (!hasReadAloudChildren && (hasReadAloud || paraId)) {
          // Check if we already have this paragraph
          const exists = syncBlocks.find(block => block.id === paraId);
          if (!exists) {
            syncBlocks.push({
              id: paraId,
              text: para.textContent?.trim() || '',
              type: 'paragraph',
              paragraphId: paraId,
              shouldRead: hasReadAloud,
              start: 0,
              end: 0,
              elementId: paraId
            });
          }
        }
      });

      // Sort by reading order (by position in DOM)
      syncBlocks.sort((a, b) => {
        const aElement = doc.getElementById(a.id);
        const bElement = doc.getElementById(b.id);
        if (!aElement || !bElement) return 0;
        
        const position = aElement.compareDocumentPosition(bElement);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      return syncBlocks;
    } catch (error) {
      console.error('Error parsing XHTML to sync blocks:', error);
      return [];
    }
  };

  /**
   * Handle audio file upload
   */
  const handleAudioUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      setError('Please upload a valid audio file (MP3, WAV, etc.)');
      return;
    }

    // Create blob URL for playback
    const blobUrl = URL.createObjectURL(file);
    setUploadedAudio(blobUrl);
    setUploadedAudioFile(file);
    setError('');

    // If we have EPUB sections, parse the first one to extract sync blocks
    if (epubSections && epubSections.length > 0) {
      const firstSection = epubSections[0];
      if (firstSection.xhtml) {
        const blocks = parseXhtmlToSyncBlocks(firstSection.xhtml);
        setSyncBlocks(blocks);
      }
    }
  };

  /**
   * Toggle read-aloud for a sync block
   */
  const toggleReadAloud = (blockId) => {
    setSyncBlocks(prevBlocks => 
      prevBlocks.map(block => 
        block.id === blockId 
          ? { ...block, shouldRead: !block.shouldRead }
          : block
      )
    );
    setHasUnsavedChanges(true);
  };

  /**
   * Handle tap-to-sync: mark end of current block and start of next
   */
  const handleTapToSync = () => {
    if (!uploadedAudio || !audioRef.current) return;

    const currentTime = audioRef.current.currentTime;
    const blocks = [...syncBlocks];
    
    if (currentSyncBlockIndex < blocks.length) {
      // Set end time for current block
      blocks[currentSyncBlockIndex].end = currentTime;
      
      // Set start time for next block (if exists)
      if (currentSyncBlockIndex + 1 < blocks.length) {
        blocks[currentSyncBlockIndex + 1].start = currentTime;
      }
      
      setSyncBlocks(blocks);
      setCurrentSyncBlockIndex(prev => Math.min(prev + 1, blocks.length - 1));
      setHasUnsavedChanges(true);
    }
  };

  /**
   * Handle keyboard shortcut for tap-to-sync (Spacebar)
   */
  useEffect(() => {
    if (!tapToSyncMode || !isRecordingSync) return;

    const handleKeyPress = (e) => {
      if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        handleTapToSync();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [tapToSyncMode, isRecordingSync, currentSyncBlockIndex, syncBlocks]);

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
      
      // Parse XHTML to extract sync blocks for TTS-generated audio
      if (epubSections && epubSections.length > 0) {
        // Parse all sections to get sync blocks
        const allSyncBlocks = [];
        epubSections.forEach(section => {
          if (section.xhtml) {
            const blocks = parseXhtmlToSyncBlocks(section.xhtml);
            // Map TTS segments to sync blocks by matching block IDs
            blocks.forEach(block => {
              const matchingSegment = segments.find(s => s.blockId === block.id || s.blockId === block.elementId);
              if (matchingSegment) {
                block.start = matchingSegment.startTime || 0;
                block.end = matchingSegment.endTime || 0;
                block.shouldRead = true; // TTS-generated blocks default to enabled
              }
            });
            allSyncBlocks.push(...blocks);
          }
        });
        
        if (allSyncBlocks.length > 0) {
          setSyncBlocks(allSyncBlocks);
        }
      }
      
      // Auto-populate CLIPBEGIN/CLIPEND from generated segments
      const timings = {};
      segments.forEach(segment => {
        if (segment.blockId) {
          timings[segment.blockId] = {
            clipBegin: segment.startTime || 0,
            clipEnd: segment.endTime || 0
          };
        }
      });
      setClipTimings(prev => ({ ...prev, ...timings }));
      
      // Reload audio syncs to get the updated audio file
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      if (audioData && audioData.length > 0) {
        setAudioSegments(audioData);
        // Update timings from reloaded data
        const reloadedTimings = {};
        audioData.forEach(segment => {
          if (segment.blockId) {
            reloadedTimings[segment.blockId] = {
              clipBegin: segment.startTime || 0,
              clipEnd: segment.endTime || 0
            };
          }
        });
        setClipTimings(prev => ({ ...prev, ...reloadedTimings }));
        const updatedTimings = {};
        audioData.forEach(segment => {
          if (segment.blockId) {
            updatedTimings[segment.blockId] = {
              clipBegin: segment.startTime || 0,
              clipEnd: segment.endTime || 0
            };
          }
        });
        setClipTimings(prev => ({ ...prev, ...updatedTimings }));
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

  // Handle clicking on a text block to seek to its CLIPBEGIN time
  const handleBlockSeek = (blockId) => {
    const audio = audioRef.current;
    if (!audio) return;
    
    // Use CLIPBEGIN from clipTimings, or fallback to segment startTime
    const timing = clipTimings[blockId];
    const segment = audioSegments.find(s => s.blockId === blockId);
    const seekTime = timing?.clipBegin ?? segment?.startTime ?? 0;
    
    if (seekTime > 0) {
      audio.currentTime = seekTime;
      setCurrentTime(seekTime);
      if (!isPlaying) {
        audio.play();
        setIsPlaying(true);
      }
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
    // Use CLIPBEGIN from clipTimings, or fallback to segment startTime
    const timing = clipTimings[block.id];
    const segment = audioSegments.find(s => s.blockId === block.id);
    const seekTime = timing?.clipBegin ?? segment?.startTime ?? 0;
    
    if (seekTime > 0 && audioRef.current) {
      audioRef.current.currentTime = seekTime;
      setCurrentTime(seekTime);
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };
  
  const handleTextClickForAudioMapping = async (textId, text, chunk) => {
    // When user clicks text in EPUB viewer, create audio mapping
    try {
      // Check if audio segment already exists
      const existingSegment = audioSegments.find(s => s.blockId === textId);
      
      if (existingSegment) {
        // If audio exists, jump to that time
        if (audioRef.current) {
          audioRef.current.currentTime = existingSegment.startTime;
          setCurrentTime(existingSegment.startTime);
        }
        setError('');
      } else {
        // Create new mapping - use current audio time if playing, otherwise use 0
        const startTime = (audioRef.current && audioRef.current.currentTime > 0) 
          ? audioRef.current.currentTime 
          : 0;
        const estimatedDuration = Math.max(1, text.length * 0.1); // Rough estimate: 0.1s per character
        const endTime = startTime + estimatedDuration;
        
        // Create mapping
        await createAudioMapping(textId, text, startTime, endTime);
        setError('');
      }
    } catch (err) {
      console.error('Error handling text click for audio mapping:', err);
      setError('Failed to create audio mapping: ' + err.message);
    }
  };
  
  const createAudioMapping = async (textId, text, startTime, endTime) => {
    try {
      // Check if mapping already exists
      const existing = audioSegments.find(s => s.blockId === textId);
      if (existing) {
        // Update existing mapping
        await audioSyncService.updateAudioSync(existing.id, {
          startTime: startTime,
          endTime: endTime,
          text: text
        });
      } else {
        // Find the page number from the text chunk
        const chunk = textChunks.find(c => c.id === textId);
        const pageNumber = chunk?.pageNumber || 1;
        
        // Create new mapping
        await audioSyncService.createAudioSync({
          conversionJobId: parseInt(jobId),
          pdfDocumentId: job.pdfDocumentId,
          blockId: textId,
          pageNumber: pageNumber,
          startTime: startTime,
          endTime: endTime,
          audioFilePath: null, // Will be set when audio is generated
          customText: text // Store the text for reference
        });
      }
      
      // Mark as having unsaved changes
      setHasUnsavedChanges(true);
      setChangesSaved(false);
      
      // Reload audio segments
      const segments = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      setAudioSegments(segments);
      
      // Update text chunks
      setTextChunks(prev => prev.map(chunk => 
        chunk.id === textId 
          ? { ...chunk, startTime, endTime }
          : chunk
      ));
    } catch (err) {
      console.error('Error creating/updating audio mapping:', err);
      throw err;
    }
  };
  
  const handleSaveChanges = async () => {
    try {
      setError('');
      setLoading(true);
      
      // If user uploaded audio and has sync blocks, save them first
      if (uploadedAudioFile && syncBlocks.length > 0) {
        console.log('Saving sync blocks with uploaded audio...');
        
        // Upload audio file to server
        const uploadResult = await audioSyncService.uploadAudioFile(parseInt(jobId), uploadedAudioFile);
        const serverAudioFileName = uploadResult?.fileName || uploadedAudioFile.name;
        
        // Save sync blocks (only those with shouldRead === true will be saved)
        await audioSyncService.saveSyncBlocks(
          parseInt(jobId),
          syncBlocks.map(block => ({
            ...block,
            pageNumber: selectedPage // Use current selected page
          })),
          serverAudioFileName
        );
        
        console.log(`Saved ${syncBlocks.filter(b => b.shouldRead).length} active sync blocks`);
      } else if (audioSegments.length > 0 && syncBlocks.length > 0) {
        // For TTS-generated audio, update sync blocks with shouldRead flags
        console.log('Saving TTS sync blocks with read-aloud flags...');
        
        // Get the audio file name from the first segment
        const audioFileName = audioSegments[0]?.audioFilePath?.split('/').pop() || `combined_audio_${jobId}.mp3`;
        
        // Update existing audio syncs to set shouldRead flag
        // Delete syncs for blocks where shouldRead === false
        const activeBlockIds = syncBlocks.filter(b => b.shouldRead).map(b => b.id || b.elementId);
        
        // Update audio syncs based on shouldRead flag
        // Keep all syncs but mark disabled ones in notes (don't delete - user might re-enable)
        for (const segment of audioSegments) {
          const blockId = segment.blockId;
          const matchingBlock = syncBlocks.find(b => 
            b.id === blockId || 
            b.elementId === blockId ||
            blockId?.includes(b.id) ||
            b.id?.includes(blockId)
          );
          
          if (matchingBlock) {
            // Update sync with shouldRead flag in notes and timings
            await audioSyncService.updateAudioSync(segment.id, {
              startTime: matchingBlock.start || segment.startTime || 0,
              endTime: matchingBlock.end || segment.endTime || 0,
              notes: `TTS-generated. Read-aloud: ${matchingBlock.shouldRead ? 'enabled' : 'disabled'}. Type: ${matchingBlock.type || 'block'}`
            });
          }
        }
        
        console.log(`Updated TTS sync blocks: ${activeBlockIds.length} active, ${syncBlocks.length - activeBlockIds.length} disabled`);
      }
      
      // Regenerate EPUB with current audio mappings
      if (audioSegments.length > 0 || (uploadedAudioFile && syncBlocks.length > 0)) {
        console.log('Saving changes: Regenerating EPUB with audio mappings...');
        await conversionService.regenerateEpub(parseInt(jobId));
      }
      
      // Mark changes as saved
      setChangesSaved(true);
      setHasUnsavedChanges(false);
      setError('');
      
      console.log('Changes saved successfully!');
    } catch (err) {
      console.error('Error saving changes:', err);
      setError('Failed to save changes: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadEpub = async () => {
    try {
      setError('');
      setLoading(true);
      
      // Only allow download if changes are saved
      if (!changesSaved && audioSegments.length > 0) {
        setError('Please save changes before downloading. Click "Save Changes" button first.');
        setLoading(false);
        return;
      }
      
      // Download the EPUB (already regenerated with mappings)
      await conversionService.downloadEpub(parseInt(jobId));
    } catch (err) {
      console.error('Error downloading EPUB:', err);
      setError(err.message || 'Failed to download EPUB. Make sure changes are saved.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayBlockAudio = async (blockId, segment) => {
    // Stop any currently playing audio
    Object.values(blockAudioElements).forEach(audio => {
      // Check if audio is an HTMLAudioElement before calling pause
      if (audio && audio instanceof HTMLAudioElement && !audio.paused) {
        audio.pause();
        audio.currentTime = 0;
      }
    });

    // Stop browser TTS if playing
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    // If this block is already playing, stop it
    if (playingBlockId === blockId) {
      const audio = blockAudioElements[blockId];
      // Check if audio is an HTMLAudioElement before calling pause
      if (audio && audio instanceof HTMLAudioElement) {
        audio.pause();
        audio.currentTime = 0;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingBlockId(null);
      return;
    }

    // Get the text for this block
    const block = textChunks.find(c => c.id === blockId);
    if (!block) {
      setError('Block not found');
      return;
    }

    const textToSpeak = block.text || segment.text || '';

    // Use browser's built-in TTS (SpeechSynthesis API) - no audio files needed
    if (!('speechSynthesis' in window)) {
      setError('Your browser does not support text-to-speech. Please use a modern browser like Chrome, Firefox, or Edge.');
      return;
    }

    try {
      setPlayingBlockId(blockId);
      setError('');

      // Load voices - may need to wait for them to load
      let voices = window.speechSynthesis.getVoices();
      
      // If voices aren't loaded yet, wait for them
      if (voices.length === 0) {
        const loadVoices = () => {
          voices = window.speechSynthesis.getVoices();
          if (voices.length > 0) {
            speakWithVoice();
          }
        };
        window.speechSynthesis.onvoiceschanged = loadVoices;
        // Try again after a short delay
        setTimeout(loadVoices, 100);
        return;
      }

      const speakWithVoice = () => {
        // Create speech utterance
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        
        // Set voice properties
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Try to use a preferred voice
        const preferredVoice = voices.find(v => 
          v.name.toLowerCase().includes('english') || 
          v.lang.startsWith('en')
        ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
        
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }

        // Handle speech end
        utterance.onend = () => {
          setPlayingBlockId(null);
        };

        // Handle speech error
        utterance.onerror = (e) => {
          console.error('Speech synthesis error:', e);
          const errorMsg = e.error ? `Error: ${e.error}` : 'Unknown error occurred';
          setError('Failed to play audio: ' + errorMsg);
          setPlayingBlockId(null);
        };

        // Speak the text
        window.speechSynthesis.speak(utterance);

        // Store the utterance for cleanup (so we can cancel it if needed)
        setBlockAudioElements(prev => ({ ...prev, [blockId]: utterance }));
      };

      speakWithVoice();
    } catch (err) {
      console.error('Error with speech synthesis:', err);
      setError('Failed to play audio: ' + err.message);
      setPlayingBlockId(null);
    }
  };

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      // Stop browser TTS
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);
  
  // Stop TTS when component unmounts or playingBlockId changes
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window && playingBlockId) {
        window.speechSynthesis.cancel();
      }
    };
  }, [playingBlockId]);

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
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700' }}>Reconstruct & Audio Mapping</h1>
          <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '14px' }}>
            Job #{jobId} • {pdf?.originalFileName || 'PDF Document'}
            {hasUnsavedChanges && (
              <span style={{ marginLeft: '12px', color: '#ff9800', fontWeight: '600' }}>
                • Unsaved changes
              </span>
            )}
            {changesSaved && (
              <span style={{ marginLeft: '12px', color: '#4caf50', fontWeight: '600' }}>
                • Changes saved
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {job?.status === 'COMPLETED' && (
            <>
              {hasUnsavedChanges && audioSegments.length > 0 && (
                <button
                  onClick={handleSaveChanges}
                  className="btn btn-warning"
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    backgroundColor: '#ff9800', 
                    borderColor: '#ff9800',
                    color: '#fff'
                  }}
                  disabled={loading || audioSegments.length === 0}
                >
                  <HiOutlineCheck size={18} />
                  Save Changes
                  {audioSegments.length > 0 && (
                    <span style={{ 
                      marginLeft: '4px', 
                      fontSize: '11px', 
                      backgroundColor: 'rgba(255,255,255,0.3)',
                      padding: '2px 6px',
                      borderRadius: '10px',
                      fontWeight: '600'
                    }}>
                      {audioSegments.length} mapping{audioSegments.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              )}
              {changesSaved && audioSegments.length > 0 && (
                <button
                  onClick={handleDownloadEpub}
                  className="btn btn-success"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  disabled={loading}
                >
                  <HiOutlineDownload size={18} />
                  Download Final EPUB3
                  <span style={{ 
                    marginLeft: '4px', 
                    fontSize: '11px', 
                    backgroundColor: 'rgba(255,255,255,0.3)',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    fontWeight: '600'
                  }}>
                    Ready
                  </span>
                </button>
              )}
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
          
          {/* Upload Audio Button */}
          <div style={{ position: 'relative' }}>
            <input
              type="file"
              accept="audio/*"
              onChange={handleAudioUpload}
              style={{ display: 'none' }}
              id="audio-upload-input"
            />
            <label
              htmlFor="audio-upload-input"
              className="btn btn-secondary"
              style={{ 
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginLeft: '12px'
              }}
            >
              <HiOutlineVolumeUp size={18} />
              {uploadedAudio ? 'Change Audio' : 'Upload Audio'}
            </label>
          </div>
        </div>
        
        {/* Audio Upload & Sync Controls Section */}
        {uploadedAudio && (
          <div style={{
            marginTop: '20px',
            padding: '20px',
            backgroundColor: '#f5f5f5',
            borderRadius: '8px',
            border: '1px solid #e0e0e0'
          }}>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Audio Sync Mode</h3>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    setTapToSyncMode(!tapToSyncMode);
                    setIsRecordingSync(!tapToSyncMode);
                    if (!tapToSyncMode) {
                      setCurrentSyncBlockIndex(0);
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    border: `2px solid ${tapToSyncMode ? '#4caf50' : '#e0e0e0'}`,
                    borderRadius: '6px',
                    backgroundColor: tapToSyncMode ? '#e8f5e9' : '#ffffff',
                    color: tapToSyncMode ? '#2e7d32' : '#666',
                    cursor: 'pointer',
                    fontWeight: tapToSyncMode ? '600' : '400'
                  }}
                >
                  {tapToSyncMode ? '✓ Tap-to-Sync Active' : 'Enable Tap-to-Sync'}
                </button>
                {tapToSyncMode && (
                  <button
                    onClick={handleTapToSync}
                    style={{
                      padding: '8px 16px',
                      border: '2px solid #1976d2',
                      borderRadius: '6px',
                      backgroundColor: '#e3f2fd',
                      color: '#1976d2',
                      cursor: 'pointer',
                      fontWeight: '600'
                    }}
                  >
                    Mark End (Spacebar)
                  </button>
                )}
              </div>
            </div>
            
            {/* Audio Player with Waveform Visualization */}
            <div style={{ marginBottom: '20px' }}>
              {uploadedAudio ? (
                <audio
                  ref={audioRef}
                  src={uploadedAudio}
                  controls
                  style={{ width: '100%', marginBottom: '12px' }}
                  onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.target.duration)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              ) : audioSegments.length > 0 && (
                <div style={{ 
                  padding: '12px', 
                  backgroundColor: '#e3f2fd', 
                  borderRadius: '6px',
                  marginBottom: '12px',
                  fontSize: '14px'
                }}>
                  <strong>TTS-Generated Audio:</strong> {audioSegments.length} segments generated. 
                  Use the sync blocks below to control which segments are included in the final EPUB.
                </div>
              )}
              
              {/* Simple Waveform Visualization (Progress Bar) - Only for uploaded audio */}
              {uploadedAudio && duration > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{
                    width: '100%',
                    height: '60px',
                    backgroundColor: '#f0f0f0',
                    borderRadius: '4px',
                    position: 'relative',
                    overflow: 'hidden',
                    border: '1px solid #e0e0e0'
                  }}>
                    {/* Progress indicator */}
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: `${(currentTime / duration) * 100}%`,
                      height: '100%',
                      backgroundColor: '#1976d2',
                      opacity: 0.3,
                      transition: 'width 0.1s linear'
                    }} />
                    
                    {/* Sync block markers */}
                    {syncBlocks.map((block, idx) => {
                      if (block.start === 0 && block.end === 0) return null;
                      const startPercent = (block.start / duration) * 100;
                      const endPercent = (block.end / duration) * 100;
                      const width = endPercent - startPercent;
                      
                      return (
                        <div
                          key={block.id}
                          style={{
                            position: 'absolute',
                            left: `${startPercent}%`,
                            width: `${width}%`,
                            height: '100%',
                            backgroundColor: block.shouldRead ? '#4caf50' : '#ccc',
                            opacity: 0.4,
                            borderLeft: '1px solid #333',
                            borderRight: '1px solid #333',
                            cursor: 'pointer'
                          }}
                          title={`${block.text.substring(0, 30)}... (${formatTime(block.start)} - ${formatTime(block.end)})`}
                          onClick={() => {
                            if (audioRef.current) {
                              audioRef.current.currentTime = block.start;
                            }
                          }}
                        />
                      );
                    })}
                    
                    {/* Current time indicator */}
                    <div style={{
                      position: 'absolute',
                      left: `${(currentTime / duration) * 100}%`,
                      top: 0,
                      width: '2px',
                      height: '100%',
                      backgroundColor: '#ff5722',
                      zIndex: 10
                    }} />
                    
                    {/* Time labels */}
                    <div style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: '8px',
                      fontSize: '11px',
                      color: '#666',
                      fontWeight: '500'
                    }}>
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                  </div>
                </div>
              )}
              {tapToSyncMode && isRecordingSync && (
                <div style={{
                  padding: '12px',
                  backgroundColor: '#fff3cd',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#856404',
                  marginTop: '8px'
                }}>
                  <strong>Tap-to-Sync Mode:</strong> Play the audio and press <kbd style={{ padding: '2px 6px', backgroundColor: '#fff', borderRadius: '3px' }}>Spacebar</kbd> or click "Mark End" when each segment finishes. 
                  Current block: {syncBlocks[currentSyncBlockIndex]?.text?.substring(0, 50)}...
                </div>
              )}
            </div>
            
            {/* Sync Blocks List */}
            {syncBlocks.length > 0 && (
              <div>
                <h4 style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '600' }}>
                  Sync Blocks ({syncBlocks.filter(b => b.shouldRead).length} enabled)
                </h4>
                <div style={{
                  maxHeight: '400px',
                  overflowY: 'auto',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  padding: '12px'
                }}>
                  {syncBlocks.map((block, idx) => (
                    <div
                      key={block.id}
                      style={{
                        padding: '12px',
                        marginBottom: '8px',
                        border: `2px solid ${idx === currentSyncBlockIndex && tapToSyncMode ? '#1976d2' : '#e0e0e0'}`,
                        borderRadius: '6px',
                        backgroundColor: idx === currentSyncBlockIndex && tapToSyncMode ? '#e3f2fd' : '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}
                    >
                      {/* Read-Aloud Toggle */}
                      <button
                        onClick={() => toggleReadAloud(block.id)}
                        style={{
                          width: '48px',
                          height: '24px',
                          borderRadius: '12px',
                          border: 'none',
                          backgroundColor: block.shouldRead ? '#4caf50' : '#ccc',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'background-color 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '2px'
                        }}
                        title={block.shouldRead ? 'Disable read-aloud' : 'Enable read-aloud'}
                      >
                        <span
                          style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            backgroundColor: '#fff',
                            transform: block.shouldRead ? 'translateX(24px)' : 'translateX(0)',
                            transition: 'transform 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {block.shouldRead && <HiOutlineVolumeUp size={12} color="#4caf50" />}
                        </span>
                      </button>
                      
                      {/* Block Info */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                          {block.type} • ID: {block.id}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: block.shouldRead ? '500' : '400', color: block.shouldRead ? '#212121' : '#999' }}>
                          {block.text || '(empty)'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                          {block.start > 0 || block.end > 0 ? (
                            <>
                              {formatTime(block.start)} → {formatTime(block.end)}
                              {audioSegments.find(s => s.blockId === block.id || s.blockId === block.elementId) && (
                                <span style={{ marginLeft: '8px', color: '#1976d2', fontSize: '10px' }}>(TTS)</span>
                              )}
                            </>
                          ) : (
                            <span style={{ color: '#999', fontStyle: 'italic' }}>Not synced yet</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="audio-sync-content">
        {/* Left Side - EPUB Viewer */}
        <div className="pdf-viewer-panel epub-viewer-panel">
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>EPUB Preview</strong>
              {job && job.status === 'COMPLETED' && (
                <span style={{ fontSize: '13px', fontWeight: '400', color: '#666', marginLeft: '12px' }}>
                  • Click text to map audio
                </span>
              )}
            </div>
            {audioSegments.length > 0 && (
              <div style={{ fontSize: '12px', color: '#1976d2', fontWeight: '500' }}>
                {audioSegments.length} text{audioSegments.length !== 1 ? 's' : ''} mapped
              </div>
            )}
          </div>
          <div className="epub-viewer-wrapper">
            {job && job.status === 'COMPLETED' ? (
              <EpubViewer 
                jobId={jobId}
                onTextSelect={(textId, text, element) => {
                  // Handle text selection for audio mapping
                  const matchingChunk = textChunks.find(chunk => chunk.id === textId);
                  if (matchingChunk) {
                    setSelectedBlocks([textId]);
                    setSelectedChunk(matchingChunk);
                    // Show audio mapping interface
                    handleTextClickForAudioMapping(textId, text, matchingChunk);
                  } else {
                    // Create new chunk if not found
                    const newChunk = {
                      id: textId,
                      text: text,
                      pageNumber: 1,
                      startTime: null,
                      endTime: null
                    };
                    setTextChunks(prev => [...prev, newChunk]);
                    setSelectedBlocks([textId]);
                    setSelectedChunk(newChunk);
                    handleTextClickForAudioMapping(textId, text, newChunk);
                  }
                }}
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
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📚</div>
                <div style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>EPUB not available</div>
                <div style={{ fontSize: '14px', color: '#999' }}>
                  {job?.status === 'IN_PROGRESS' 
                    ? 'Conversion in progress...' 
                    : 'Please wait for conversion to complete'}
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
                      // Use CLIPBEGIN/CLIPEND from clipTimings, or fallback to segment times
                      const timing = clipTimings[block.id];
                      const clipBegin = timing?.clipBegin ?? segment?.startTime ?? 0;
                      const clipEnd = timing?.clipEnd ?? segment?.endTime ?? 0;
                      const isActive = clipBegin > 0 && currentTime >= clipBegin && currentTime <= clipEnd;

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
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              {segment && (
                                <span style={{ fontSize: '12px', color: '#666' }}>
                                  {formatTime(clipBegin)} - {formatTime(clipEnd)}
                                </span>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePlayBlockAudio(block.id, segment || {});
                                }}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid #1976d2',
                                  borderRadius: '4px',
                                  backgroundColor: playingBlockId === block.id ? '#1976d2' : '#ffffff',
                                  color: playingBlockId === block.id ? 'white' : '#1976d2',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '11px',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                  if (playingBlockId !== block.id) {
                                    e.currentTarget.style.backgroundColor = '#e3f2fd';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (playingBlockId !== block.id) {
                                    e.currentTarget.style.backgroundColor = '#ffffff';
                                  }
                                }}
                              >
                                {playingBlockId === block.id ? (
                                  <>
                                    <HiOutlinePause size={14} />
                                    Pause
                                  </>
                                ) : (
                                  <>
                                    <HiOutlinePlay size={14} />
                                    Play
                                  </>
                                )}
                              </button>
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
                          {/* CLIPBEGIN/CLIPEND timing inputs - Auto-populated from audio segments */}
                          <div style={{ marginTop: '12px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <label style={{ fontSize: '12px', fontWeight: '500', color: '#666', minWidth: '100px' }}>
                                CLIPBEGIN (S):
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={clipTimings[block.id]?.clipBegin?.toFixed(2) || segment?.startTime?.toFixed(2) || '0.00'}
                                onChange={(e) => {
                                  const value = parseFloat(e.target.value) || 0;
                                  setClipTimings(prev => ({
                                    ...prev,
                                    [block.id]: {
                                      ...prev[block.id],
                                      clipBegin: value
                                    }
                                  }));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  width: '80px',
                                  padding: '4px 8px',
                                  border: '1px solid #ddd',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontFamily: 'monospace'
                                }}
                                placeholder="0.00"
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <label style={{ fontSize: '12px', fontWeight: '500', color: '#666', minWidth: '90px' }}>
                                CLIPEND (S):
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={clipTimings[block.id]?.clipEnd?.toFixed(2) || segment?.endTime?.toFixed(2) || '0.00'}
                                onChange={(e) => {
                                  const value = parseFloat(e.target.value) || 0;
                                  setClipTimings(prev => ({
                                    ...prev,
                                    [block.id]: {
                                      ...prev[block.id],
                                      clipEnd: value
                                    }
                                  }));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  width: '80px',
                                  padding: '4px 8px',
                                  border: '1px solid #ddd',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontFamily: 'monospace'
                                }}
                                placeholder="0.00"
                              />
                            </div>
                            {segment && (
                              <span style={{ fontSize: '11px', color: '#4caf50', fontStyle: 'italic' }}>
                                ✓ Auto-detected
                              </span>
                            )}
                          </div>
                          
                          {/* Display coordinates and size information */}
                          {(block.x !== undefined || block.normalizedX !== undefined) && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: '#666', fontFamily: 'monospace', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                              <span>
                                <strong>Position:</strong> x: {block.normalizedX !== undefined ? block.normalizedX.toFixed(2) : (block.x || 0).toFixed(2)}, 
                                y: {block.normalizedY !== undefined ? block.normalizedY.toFixed(2) : (block.y || 0).toFixed(2)}
                              </span>
                              <span>
                                <strong>Size:</strong> w: {block.normalizedWidth !== undefined ? block.normalizedWidth.toFixed(2) : (block.width || 0).toFixed(2)}, 
                                h: {block.normalizedHeight !== undefined ? block.normalizedHeight.toFixed(2) : (block.height || 0).toFixed(2)}
                              </span>
                              {block.x !== undefined && block.normalizedX === undefined && (
                                <span style={{ color: '#999' }}>
                                  <strong>Absolute:</strong> ({block.x.toFixed(1)}pt, {block.y.toFixed(1)}pt) 
                                  {block.width && block.height && ` [${block.width.toFixed(1)}×${block.height.toFixed(1)}]`}
                                </span>
                              )}
                            </div>
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

      {/* Bottom audio player removed - using individual block TTS instead */}
    </div>
  );
};

export default AudioSync;
