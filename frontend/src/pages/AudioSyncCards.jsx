import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HiOutlineVolumeUp, HiOutlineVolumeOff } from 'react-icons/hi';
import { audioSyncService } from '../services/audioSyncService';
import { conversionService } from '../services/conversionService';
import './AudioSyncCards.css';

/**
 * AudioSyncCards - A card-based interface for granular audio synchronization
 * 
 * Features:
 * - Parses XHTML directly using DOMParser
 * - Creates Sync Cards for elements with data-read-aloud="true"
 * - Toggle switches for shouldRead property
 * - Upload Audio functionality
 * - Tap-to-Sync with Mark button
 * - Saves mapping (ID + StartTime + EndTime) to backend
 */
const AudioSyncCards = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  
  // State for EPUB content
  const [epubTextContent, setEpubTextContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // State for sync cards
  // ISSUE #5 FIX: allSyncCards is the Single Source of Truth
  const [allSyncCards, setAllSyncCards] = useState([]); // Store all cards before filtering
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  
  // ISSUE #5 FIX: Memoized filtered cards - no separate state needed
  const syncCards = useMemo(() => {
    return filterCardsByGranularity(allSyncCards, granularity);
  }, [allSyncCards, granularity]);
  
  // ISSUE #3 FIX: Animation frame ref for high-precision timing
  const animationFrameRef = useRef(null);
  
  // ISSUE #2 FIX: Track keyboard listener state
  const keyboardListenerRef = useRef(null);
  
  // ISSUE #6 FIX: Undo stack for Tap-to-Sync
  const undoStackRef = useRef([]);
  
  // State for granularity toggle
  const [granularity, setGranularity] = useState('sentence'); // 'word', 'sentence', 'paragraph'
  
  // State for real-time preview
  const [activeBlockId, setActiveBlockId] = useState(null);
  const [isLooping, setIsLooping] = useState(false);
  const [loopCard, setLoopCard] = useState(null);
  
  // State for audio
  const [uploadedAudioFile, setUploadedAudioFile] = useState(null);
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isTapToSyncMode, setIsTapToSyncMode] = useState(false);
  
  // State for TTS audio generation
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('standard');
  const [generating, setGenerating] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState(null);
  const [pdfId, setPdfId] = useState(null);
  const [job, setJob] = useState(null);
  
  // Refs
  const audioRef = useRef(null);
  
  /**
   * Parse XHTML content and extract sync cards
   */
  const parseXhtmlToSyncCards = (xhtmlString) => {
    if (!xhtmlString || typeof xhtmlString !== 'string') {
      return [];
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtmlString, 'application/xhtml+xml');
      
      // Check for parsing errors
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        console.error('XHTML parsing error:', parserError.textContent);
        return [];
      }

      const cards = [];
      
      // Find all elements with data-read-aloud="true"
      const readAloudElements = doc.querySelectorAll('[data-read-aloud="true"]');
      
      readAloudElements.forEach((element, index) => {
        const id = element.getAttribute('id') || `sync-card-${index}`;
        const text = element.textContent?.trim() || '';
        const tagName = element.tagName.toLowerCase();
        
        // Determine type based on tag
        let type = 'sentence';
        if (tagName === 'p') {
          type = 'paragraph';
        } else if (tagName === 'span' && element.classList.contains('sync-word')) {
          type = 'word';
        } else if (tagName === 'span' && element.classList.contains('sync-sentence')) {
          type = 'sentence';
        }
        
        // ISSUE #1 FIX: Ensure uniqueId is always set immediately
        const uniqueId = `card_${index}_${id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        cards.push({
          id: id,
          text: text,
          type: type,
          shouldRead: true, // Default to enabled
          startTime: 0,
          endTime: 0,
          elementId: id, // For SMIL reference
          uniqueId: uniqueId // ISSUE #1 FIX: Always set uniqueId
        });
      });

      // Sort by document order
      cards.sort((a, b) => {
        const aElement = doc.getElementById(a.id);
        const bElement = doc.getElementById(b.id);
        if (!aElement || !bElement) return 0;
        
        const position = aElement.compareDocumentPosition(bElement);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      return cards;
    } catch (err) {
      console.error('Error parsing XHTML:', err);
      return [];
    }
  };

  /**
   * Smart Propagator: Calculate word-level timings from parent sentence/paragraph
   * Uses character length ratio for proportional time distribution
   */
  const calculateWordTimings = (parentCard, xhtmlContent) => {
    if (!parentCard || !xhtmlContent || parentCard.endTime <= parentCard.startTime) {
      return [];
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtmlContent, 'text/html');
      const parentEl = doc.getElementById(parentCard.originalId || parentCard.id);
      
      if (!parentEl) return [];

      // Find all .sync-word spans inside the parent
      const wordElements = parentEl.querySelectorAll('.sync-word');
      if (wordElements.length === 0) return [];

      // Calculate total character weight
      const totalChars = Array.from(wordElements).reduce(
        (sum, el) => sum + (el.innerText?.trim().length || 0), 
        0
      );
      
      if (totalChars === 0) return [];

      const totalDuration = parentCard.endTime - parentCard.startTime;
      let runningTime = parentCard.startTime;

      return Array.from(wordElements).map((el) => {
        const charLen = el.innerText?.trim().length || 1;
        const ratio = charLen / totalChars;
        const wordDuration = totalDuration * ratio;
        const start = runningTime;
        const end = runningTime + wordDuration;
        
        runningTime = end; // Sequential timing

        return {
          id: el.getAttribute('id'),
          originalId: el.getAttribute('id'),
          text: el.innerText?.trim() || '',
          type: 'word',
          shouldRead: true,
          startTime: parseFloat(start.toFixed(3)),
          endTime: parseFloat(end.toFixed(3)),
          elementId: el.getAttribute('id'),
          pageNumber: parentCard.pageNumber || 1,
          sectionId: parentCard.sectionId,
          sectionTitle: parentCard.sectionTitle,
          parentId: parentCard.originalId || parentCard.id,
          uniqueId: `${parentCard.sectionId || 'section'}_${el.getAttribute('id')}`
        };
      });
    } catch (err) {
      console.error('Error calculating word timings:', err);
      return [];
    }
  };

  /**
   * Calculate sentence-level timings from parent paragraph
   */
  const calculateSentenceTimings = (parentCard, xhtmlContent) => {
    if (!parentCard || !xhtmlContent || parentCard.endTime <= parentCard.startTime) {
      return [];
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtmlContent, 'text/html');
      const parentEl = doc.getElementById(parentCard.originalId || parentCard.id);
      
      if (!parentEl) return [];

      // Find all .sync-sentence spans inside the parent
      const sentenceElements = parentEl.querySelectorAll('.sync-sentence');
      if (sentenceElements.length === 0) return [];

      const totalChars = Array.from(sentenceElements).reduce(
        (sum, el) => sum + (el.innerText?.trim().length || 0), 
        0
      );
      
      if (totalChars === 0) return [];

      const totalDuration = parentCard.endTime - parentCard.startTime;
      let runningTime = parentCard.startTime;

      return Array.from(sentenceElements).map((el) => {
        const charLen = el.innerText?.trim().length || 1;
        const ratio = charLen / totalChars;
        const duration = totalDuration * ratio;
        const start = runningTime;
        const end = runningTime + duration;
        
        runningTime = end;

        return {
          id: el.getAttribute('id'),
          originalId: el.getAttribute('id'),
          text: el.innerText?.trim() || '',
          type: 'sentence',
          shouldRead: true,
          startTime: parseFloat(start.toFixed(3)),
          endTime: parseFloat(end.toFixed(3)),
          elementId: el.getAttribute('id'),
          pageNumber: parentCard.pageNumber || 1,
          sectionId: parentCard.sectionId,
          sectionTitle: parentCard.sectionTitle,
          parentId: parentCard.originalId || parentCard.id,
          uniqueId: `${parentCard.sectionId || 'section'}_${el.getAttribute('id')}`
        };
      });
    } catch (err) {
      console.error('Error calculating sentence timings:', err);
      return [];
    }
  };

  /**
   * Filter cards based on current granularity level
   */
  const filterCardsByGranularity = (cards, level) => {
    if (!cards || cards.length === 0) return [];

    return cards.filter(card => {
      const id = card.originalId || card.id || '';
      
      switch (level) {
        case 'word':
          // Words: IDs containing '_w' (e.g., p1_s1_w1)
          return id.includes('_w');
        case 'sentence':
          // Sentences: IDs containing '_s' but not '_w' (e.g., p1_s1)
          return id.includes('_s') && !id.includes('_w');
        case 'paragraph':
          // Paragraphs: IDs without '_s' or '_w' (e.g., p1, p2)
          return !id.includes('_s') && !id.includes('_w');
        default:
          return true;
      }
    });
  };

  /**
   * Propagate timings from higher level to lower level
   * (e.g., sentence -> word)
   */
  const propagateTimings = () => {
    if (!epubTextContent) return;

    const propagatedCards = [];

    if (granularity === 'word') {
      // Propagate from sentences to words
      const sentenceCards = filterCardsByGranularity(allSyncCards, 'sentence');
      sentenceCards.forEach(sentenceCard => {
        if (sentenceCard.startTime >= 0 && sentenceCard.endTime > sentenceCard.startTime) {
          const wordCards = calculateWordTimings(sentenceCard, epubTextContent);
          propagatedCards.push(...wordCards);
        }
      });
    } else if (granularity === 'sentence') {
      // Propagate from paragraphs to sentences
      const paragraphCards = filterCardsByGranularity(allSyncCards, 'paragraph');
      paragraphCards.forEach(paragraphCard => {
        if (paragraphCard.startTime >= 0 && paragraphCard.endTime > paragraphCard.startTime) {
          const sentenceCards = calculateSentenceTimings(paragraphCard, epubTextContent);
          propagatedCards.push(...sentenceCards);
        }
      });
    }

    if (propagatedCards.length > 0) {
      // Merge propagated cards with existing cards (update timings for existing IDs)
      setAllSyncCards(prevCards => {
        const cardMap = new Map(prevCards.map(c => [c.originalId || c.id, c]));
        propagatedCards.forEach(newCard => {
          const existingCard = cardMap.get(newCard.originalId || newCard.id);
          if (existingCard) {
            // Update existing card with propagated timings
            cardMap.set(newCard.originalId || newCard.id, {
              ...existingCard,
              startTime: newCard.startTime,
              endTime: newCard.endTime
            });
          } else {
            // Add new card
            cardMap.set(newCard.originalId || newCard.id, newCard);
          }
        });
        return Array.from(cardMap.values());
      });

      console.log(`Propagated ${propagatedCards.length} ${granularity} timings`);
    }
  };

  // ISSUE #5 FIX: Removed - syncCards is now memoized, no effect needed

  /**
   * Load available voices
   */
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const voicesData = await audioSyncService.getAvailableVoices();
        setVoices(voicesData);
      } catch (err) {
        console.error('Error loading voices:', err);
      }
    };
    loadVoices();
  }, []);

  /**
   * Load job and PDF information
   */
  useEffect(() => {
    const loadJobInfo = async () => {
      try {
        const jobData = await conversionService.getConversionJob(parseInt(jobId));
        setJob(jobData);
        if (jobData && jobData.pdfDocumentId) {
          setPdfId(jobData.pdfDocumentId);
        }
      } catch (err) {
        console.error('Error loading job info:', err);
      }
    };
    if (jobId) {
      loadJobInfo();
    }
  }, [jobId]);

  /**
   * Load EPUB text content
   */
  useEffect(() => {
    const loadEpubContent = async () => {
      try {
        setLoading(true);
        setError('');
        
        // Get EPUB sections (each section has XHTML)
        const sections = await conversionService.getEpubSections(parseInt(jobId));
        
        if (sections && sections.length > 0) {
          // Combine all XHTML from all sections
          const allXhtml = sections
            .map(section => section.xhtml || '')
            .filter(xhtml => xhtml && xhtml.trim())
            .join('\n');
          
          setEpubTextContent(allXhtml);
          
          // Parse and create sync cards from all sections
          const allCards = [];
          sections.forEach((section, sectionIndex) => {
            if (section.xhtml) {
              const sectionCards = parseXhtmlToSyncCards(section.xhtml);
              // Add section context to cards and ensure unique IDs
              sectionCards.forEach((card, cardIndex) => {
                const sectionId = section.id || sectionIndex;
                // Extract numeric page number from section.id (e.g., "page-1" -> 1, "page_2" -> 2)
                // Or use sectionIndex + 1 as fallback
                let pageNumber = sectionIndex + 1; // Default: 1-based index
                if (section.id) {
                  // Try to extract number from section ID like "page-1", "page_2", "page1"
                  const pageMatch = String(section.id).match(/page[_-]?(\d+)/i);
                  if (pageMatch) {
                    pageNumber = parseInt(pageMatch[1], 10);
                  } else if (!isNaN(parseInt(section.id))) {
                    // section.id is already a number
                    pageNumber = parseInt(section.id, 10);
                  }
                }
                card.sectionId = sectionId;
                card.pageNumber = pageNumber; // Store numeric page number
                card.sectionTitle = section.title || `Section ${sectionIndex + 1}`;
                // ISSUE #1 FIX: Ensure uniqueId is always set (fallback if not set in parseXhtmlToSyncCards)
                if (!card.uniqueId) {
                  card.uniqueId = `${sectionId}_${card.id}_${cardIndex}_${Date.now()}`;
                }
                card.originalId = card.id; // Keep original ID for SMIL reference
              });
              allCards.push(...sectionCards);
            }
          });
          
          // Store all cards before filtering
          setAllSyncCards(allCards);
          
          // Apply initial granularity filter
          const filteredCards = filterCardsByGranularity(allCards, granularity);
          setSyncCards(filteredCards.length > 0 ? filteredCards : allCards);
          
          // Check if there's existing generated audio
          try {
            const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
            if (audioData && audioData.length > 0) {
              // Map audio segments to sync cards
              allCards.forEach(card => {
                const matchingSegment = audioData.find(s => 
                  s.blockId === card.id || 
                  s.blockId === card.elementId ||
                  s.blockId?.includes(card.id) ||
                  card.id?.includes(s.blockId)
                );
                if (matchingSegment) {
                  card.startTime = matchingSegment.startTime || 0;
                  card.endTime = matchingSegment.endTime || 0;
                  card.shouldRead = true;
                }
              });
              setSyncCards([...allCards]);
              
              // Get the audio file URL
              if (audioData[0]?.audioFilePath) {
                const audioUrl = audioSyncService.getAudioUrl(audioData[0].id);
                setGeneratedAudioUrl(audioUrl);
              }
            }
          } catch (audioErr) {
            console.warn('No existing audio found:', audioErr);
          }
          
          console.log(`Loaded ${allCards.length} sync cards from ${sections.length} EPUB sections`);
        } else {
          setError('No EPUB content found. Please ensure the conversion is complete.');
        }
      } catch (err) {
        console.error('Error loading EPUB content:', err);
        setError('Failed to load EPUB content: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    if (jobId) {
      loadEpubContent();
    }
  }, [jobId]);

  /**
   * Automatically sync audio with sync cards based on text length
   * ISSUE #4 FIX: Check if audio duration is reasonable before auto-syncing
   */
  const autoSyncAudio = useCallback((audioDuration) => {
    if (!audioDuration || audioDuration <= 0 || syncCards.length === 0) {
      return;
    }

    // Filter only enabled cards
    const enabledCards = syncCards.filter(card => card.shouldRead && card.text.trim());
    
    if (enabledCards.length === 0) {
      return;
    }

    // ISSUE #4 FIX: Calculate expected reading time (150 words per minute = 2.5 words per second)
    const totalWords = enabledCards.reduce((sum, card) => {
      const words = card.text.trim().split(/\s+/).length;
      return sum + words;
    }, 0);
    const expectedReadingTime = totalWords / 2.5; // seconds
    
    // ISSUE #4 FIX: Check if audio duration is within reasonable threshold (50% to 200% of expected)
    const minExpected = expectedReadingTime * 0.5;
    const maxExpected = expectedReadingTime * 2.0;
    
    if (audioDuration < minExpected || audioDuration > maxExpected) {
      console.warn(`[AutoSync] Audio duration (${audioDuration.toFixed(1)}s) seems unreasonable for ${totalWords} words (expected ~${expectedReadingTime.toFixed(1)}s). Skipping auto-sync.`);
      setError(`Audio duration (${(audioDuration / 60).toFixed(1)} min) seems too ${audioDuration > maxExpected ? 'long' : 'short'} for the content. Please sync manually or check the audio file.`);
      return;
    }

    // Calculate total text length (character count) for proportional distribution
    const totalTextLength = enabledCards.reduce((sum, card) => sum + card.text.length, 0);
    
    if (totalTextLength === 0) {
      return;
    }

    // Reserve 5% at the end for safety
    const usableDuration = audioDuration * 0.95;
    let currentTime = 0;

    // Update sync cards with calculated timings
    // ISSUE #5 FIX: Update allSyncCards directly (single source of truth)
    setAllSyncCards(prevCards => {
      return prevCards.map(card => {
        if (!card.shouldRead || !card.text.trim()) {
          return card;
        }

        // Calculate duration for this card based on text length proportion
        const textProportion = card.text.length / totalTextLength;
        const cardDuration = usableDuration * textProportion;
        
        // Minimum duration of 0.5 seconds per card
        const minDuration = 0.5;
        const actualDuration = Math.max(cardDuration, minDuration);

        const startTime = currentTime;
        const endTime = currentTime + actualDuration;

        currentTime = endTime;

        return {
          ...card,
          startTime: startTime,
          endTime: endTime
        };
      });
    });
    
    console.log(`Auto-synced ${enabledCards.length} cards with audio duration ${audioDuration.toFixed(2)}s (expected ~${expectedReadingTime.toFixed(1)}s)`);
  }, [syncCards]);

  /**
   * Handle audio file upload
   */
  const handleAudioUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('audio/')) {
      setUploadedAudioFile(file);
      const url = URL.createObjectURL(file);
      setUploadedAudioUrl(url);
      setGeneratedAudioUrl(null); // Clear generated audio if user uploads
      console.log('Audio file uploaded:', file.name);
      
      // Wait for audio metadata to load, then auto-sync
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        const audioDuration = audio.duration;
        if (audioDuration > 0) {
          // Auto-sync after a short delay to ensure cards are loaded
          setTimeout(() => {
            autoSyncAudio(audioDuration);
          }, 500);
        }
      });
    } else {
      setError('Please select a valid audio file');
    }
  };

  /**
   * Generate audio for all sync cards
   * ISSUE #7 FIX: Added comprehensive error handling
   */
  const handleGenerateAudio = async () => {
    if (!pdfId) {
      setError('PDF ID not found. Please wait for job to load.');
      return;
    }

    if (syncCards.length === 0) {
      setError('No sync cards found. Please ensure EPUB content is loaded.');
      return;
    }

    try {
      setGenerating(true);
      setError('');

      // Prepare text blocks from sync cards
      const textBlocks = syncCards
        .filter(card => card.shouldRead && card.text.trim())
        .map(card => ({
          id: card.id,
          pageNumber: card.pageNumber || 1, // Use numeric page number
          text: card.text,
          sectionId: card.sectionId,
          sectionTitle: card.sectionTitle
        }));

      if (textBlocks.length === 0) {
        setError('No enabled sync cards with text found. Please enable at least one card.');
        setGenerating(false);
        return;
      }

      console.log(`Generating audio for ${textBlocks.length} sync cards...`);

      // ISSUE #7 FIX: Wrap in try-catch with timeout handling
      let segments;
      try {
        segments = await Promise.race([
          audioSyncService.generateAudio(
            pdfId,
            parseInt(jobId),
            selectedVoice,
            textBlocks
          ),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Audio generation timed out after 5 minutes')), 300000)
          )
        ]);
      } catch (apiError) {
        // Handle specific API errors
        if (apiError.message.includes('timeout')) {
          throw new Error('Audio generation timed out. Please try again with fewer cards or check your network connection.');
        } else if (apiError.response?.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a few minutes and try again.');
        } else if (apiError.response?.status >= 500) {
          throw new Error('Server error. Please try again later.');
        } else {
          throw apiError;
        }
      }

      console.log(`Generated ${segments.length} audio segments`);

      // Map generated segments to sync cards
      // ISSUE #5 FIX: Update allSyncCards directly
      setAllSyncCards(prevCards => {
        return prevCards.map(card => {
          const matchingSegment = segments.find(s => 
            s.blockId === card.id || 
            s.blockId === card.elementId ||
            s.blockId?.includes(card.id) ||
            card.id?.includes(s.blockId)
          );
          if (matchingSegment) {
            return {
              ...card,
              startTime: matchingSegment.startTime || 0,
              endTime: matchingSegment.endTime || 0,
              shouldRead: true
            };
          }
          return card;
        });
      });

      // Get the generated audio file URL
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      if (audioData && audioData.length > 0 && audioData[0].audioFilePath) {
        const audioUrl = audioSyncService.getAudioUrl(audioData[0].id);
        setGeneratedAudioUrl(audioUrl);
        setUploadedAudioUrl(audioUrl); // Use generated audio for playback
        console.log('Generated audio file available:', audioUrl);
      }

      alert(`Successfully generated audio for ${segments.length} segments!`);
    } catch (err) {
      console.error('Error generating audio:', err);
      setError('Failed to generate audio: ' + (err.message || 'Unknown error. Please check your network connection and try again.'));
      // ISSUE #7 FIX: Ensure generating state is reset even on error
      setGenerating(false);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Download generated audio file
   */
  const handleDownloadAudio = async () => {
    try {
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      if (audioData && audioData.length > 0 && audioData[0].audioFilePath) {
        const audioUrl = audioSyncService.getAudioUrl(audioData[0].id);
        const link = document.createElement('a');
        link.href = audioUrl;
        link.download = `generated_audio_${jobId}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        setError('No generated audio file found. Please generate audio first.');
      }
    } catch (err) {
      console.error('Error downloading audio:', err);
      setError('Failed to download audio: ' + err.message);
    }
  };

  /**
   * Toggle shouldRead for a sync card
   * ISSUE #5 FIX: Update allSyncCards directly
   */
  const toggleShouldRead = useCallback((cardId) => {
    setAllSyncCards(prevCards =>
      prevCards.map(card =>
        (card.id === cardId || card.uniqueId === cardId || card.originalId === cardId)
          ? { ...card, shouldRead: !card.shouldRead }
          : card
      )
    );
  }, []);

  /**
   * Handle Mark button click (Tap-to-Sync)
   * ISSUE #6 FIX: Added undo support
   * ISSUE #5 FIX: Update allSyncCards directly
   * ISSUE #3 FIX: Account for reaction time offset (200ms)
   */
  const handleMark = useCallback(() => {
    if (!isTapToSyncMode || currentCardIndex >= syncCards.length || !audioRef.current) {
      return;
    }

    const currentCard = syncCards[currentCardIndex];
    const nextCardIndex = currentCardIndex + 1;
    
    // ISSUE #3 FIX: Account for reaction time offset
    // When user clicks "Mark", there's a ~200ms delay between hearing the word
    // and clicking. Subtract this offset to get more accurate timing.
    const REACTION_TIME_OFFSET = 0.2; // 200ms
    const adjustedTime = Math.max(0, currentTime - REACTION_TIME_OFFSET);

    // Set endTime for current card
    setAllSyncCards(prevCards => {
      // ISSUE #6 FIX: Save state to undo stack before making changes
      undoStackRef.current.push({
        cardIndex: currentCardIndex,
        cards: JSON.parse(JSON.stringify(prevCards))
      });
      // Keep only last 10 undo states
      if (undoStackRef.current.length > 10) {
        undoStackRef.current.shift();
      }

      return prevCards.map((card) => {
        const cardUniqueId = card.uniqueId || card.id;
        const currentCardUniqueId = currentCard.uniqueId || currentCard.id;
        
        if (cardUniqueId === currentCardUniqueId) {
          return { ...card, endTime: adjustedTime };
        }
        // Set startTime for next card
        if (nextCardIndex < syncCards.length) {
          const nextCard = syncCards[nextCardIndex];
          const nextCardUniqueId = nextCard.uniqueId || nextCard.id;
          if (cardUniqueId === nextCardUniqueId) {
            return { ...card, startTime: adjustedTime };
          }
        }
        return card;
      });
    });

    // Move to next card
    if (nextCardIndex < syncCards.length) {
      setCurrentCardIndex(nextCardIndex);
    } else {
      // Finished all cards
      setIsTapToSyncMode(false);
      console.log('Tap-to-Sync completed for all cards');
    }
  }, [isTapToSyncMode, currentCardIndex, syncCards, currentTime]);

  /**
   * ISSUE #6 FIX: Undo last mark action
   */
  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) {
      setError('Nothing to undo');
      return;
    }

    const undoState = undoStackRef.current.pop();
    setAllSyncCards(undoState.cards);
    setCurrentCardIndex(undoState.cardIndex);
    console.log('Undone last mark action');
  }, []);

  /**
   * Start Tap-to-Sync mode
   * ISSUE #2 FIX: Add keyboard event listener
   * ISSUE #5 FIX: Update allSyncCards directly
   */
  const handleStartTapToSync = useCallback(() => {
    if (!uploadedAudioUrl && !generatedAudioUrl) {
      setError('Please upload an audio file or generate audio first');
      return;
    }

    // Reset all timings
    setAllSyncCards(prevCards =>
      prevCards.map(card => ({ ...card, startTime: 0, endTime: 0 }))
    );

    // ISSUE #6 FIX: Clear undo stack when starting new session
    undoStackRef.current = [];

    setCurrentCardIndex(0);
    setIsTapToSyncMode(true);
    
    // ISSUE #2 FIX: Add keyboard event listener for Space key
    const handleKeyPress = (e) => {
      if (e.code === 'Space' && isTapToSyncMode) {
        e.preventDefault();
        handleMark();
      }
    };

    keyboardListenerRef.current = handleKeyPress;
    window.addEventListener('keydown', handleKeyPress);
    
    // Start playing audio
    if (audioRef.current) {
      audioRef.current.play();
    }
  }, [uploadedAudioUrl, generatedAudioUrl, isTapToSyncMode, handleMark]);

  /**
   * Stop Tap-to-Sync mode
   * ISSUE #2 FIX: Remove keyboard event listener
   */
  const handleStopTapToSync = useCallback(() => {
    setIsTapToSyncMode(false);
    
    // ISSUE #2 FIX: Clean up keyboard listener
    if (keyboardListenerRef.current) {
      window.removeEventListener('keydown', keyboardListenerRef.current);
      keyboardListenerRef.current = null;
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  /**
   * ISSUE #2 FIX: Cleanup effect for keyboard listener
   */
  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (keyboardListenerRef.current) {
        window.removeEventListener('keydown', keyboardListenerRef.current);
        keyboardListenerRef.current = null;
      }
      // ISSUE #3 FIX: Cleanup animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  /**
   * Real-time preview: Handle audio time update for active card highlighting
   * ISSUE #3 FIX: Use requestAnimationFrame for word-level precision
   */
  const handleTimeUpdate = useCallback((e) => {
    const time = e.target.currentTime;
    setCurrentTime(time);

    // ISSUE #3 FIX: For word-level granularity, use high-precision timing
    if (granularity === 'word' && audioRef.current) {
      // Cancel previous frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Use requestAnimationFrame for smoother updates (60fps)
      animationFrameRef.current = requestAnimationFrame(() => {
        const preciseTime = audioRef.current?.currentTime || time;
        updateActiveCard(preciseTime);
      });
    } else {
      // For sentence/paragraph level, timeupdate event is sufficient
      updateActiveCard(time);
    }

    // Loop mode: repeat the looped card
    if (isLooping && loopCard) {
      if (time >= loopCard.endTime - 0.05) {
        e.target.currentTime = loopCard.startTime;
      }
    }
  }, [granularity, isLooping, loopCard]);

  /**
   * ISSUE #3 FIX: Helper function for updating active card
   */
  const updateActiveCard = useCallback((time) => {
    // Find the card whose time range contains the current audio time
    const activeCard = syncCards.find(card => 
      card.shouldRead && 
      time >= card.startTime && 
      time < card.endTime
    );

    if (activeCard && (activeCard.uniqueId || activeCard.id) !== activeBlockId) {
      setActiveBlockId(activeCard.uniqueId || activeCard.id);
      
      // Auto-scroll the card list to keep the active card in view
      const cardElement = document.getElementById(`card-${activeCard.uniqueId || activeCard.id}`);
      if (cardElement) {
        cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (!activeCard && activeBlockId) {
      // Clear active block if no card matches
      setActiveBlockId(null);
    }
  }, [syncCards, activeBlockId]);

  /**
   * Start looping a specific card for precision syncing
   */
  const startLoopCard = (card) => {
    if (!audioRef.current || card.startTime >= card.endTime) return;
    
    setLoopCard(card);
    setIsLooping(true);
    audioRef.current.currentTime = card.startTime;
    audioRef.current.play();
  };

  /**
   * Stop looping
   */
  const stopLoop = () => {
    setIsLooping(false);
    setLoopCard(null);
  };

  /**
   * Handle granularity change
   */
  const handleGranularityChange = (level) => {
    setGranularity(level);
    setActiveBlockId(null);
    setCurrentCardIndex(0);
  };

  /**
   * Save sync mappings to backend with auto-propagation
   */
  const handleSave = async () => {
    try {
      setLoading(true);
      setError('');

      if (!uploadedAudioFile && !generatedAudioUrl) {
        setError('Please upload an audio file or generate audio first');
        return;
      }

      // Filter only cards with shouldRead === true and valid timings
      const activeCards = syncCards.filter(card => 
        card.shouldRead && card.endTime > card.startTime
      );

      if (activeCards.length === 0) {
        setError('Please enable at least one sync card with valid timings');
        return;
      }

      let serverAudioFileName;
      
      // If user uploaded audio, upload it to server
      if (uploadedAudioFile) {
        const uploadResult = await audioSyncService.uploadAudioFile(parseInt(jobId), uploadedAudioFile);
        serverAudioFileName = uploadResult?.fileName || uploadedAudioFile.name;
      } else {
        // Use generated audio file name
        const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
        if (audioData && audioData.length > 0 && audioData[0].audioFilePath) {
          serverAudioFileName = audioData[0].audioFilePath.split('/').pop() || `combined_audio_${jobId}.mp3`;
        } else {
          setError('Generated audio file not found');
          return;
        }
      }

      // Start with the manually synced cards
      let allSyncsToSave = [...activeCards];

      // AUTO-PROPAGATION: Generate child-level timings automatically
      if (granularity === 'paragraph' && epubTextContent) {
        // Propagate paragraph -> sentence -> word
        console.log('Auto-propagating from paragraph level...');
        activeCards.forEach(paragraphCard => {
          // First: paragraph -> sentences
          const sentenceCards = calculateSentenceTimings(paragraphCard, epubTextContent);
          allSyncsToSave.push(...sentenceCards);
          
          // Then: sentences -> words
          sentenceCards.forEach(sentenceCard => {
            const wordCards = calculateWordTimings(sentenceCard, epubTextContent);
            allSyncsToSave.push(...wordCards);
          });
        });
      } else if (granularity === 'sentence' && epubTextContent) {
        // Propagate sentence -> word
        console.log('Auto-propagating from sentence level...');
        activeCards.forEach(sentenceCard => {
          const wordCards = calculateWordTimings(sentenceCard, epubTextContent);
          allSyncsToSave.push(...wordCards);
        });
      }

      // Remove duplicates by ID
      const uniqueSyncs = Array.from(
        new Map(allSyncsToSave.map(s => [s.originalId || s.id, s])).values()
      );

      console.log(`Preparing to save: ${activeCards.length} manual + ${uniqueSyncs.length - activeCards.length} auto-propagated = ${uniqueSyncs.length} total`);

      // Prepare sync blocks data
      const syncBlocks = uniqueSyncs.map(card => ({
        id: card.originalId || card.id, // Use original ID for SMIL reference
        text: card.text,
        type: card.type || granularity,
        shouldRead: card.shouldRead,
        start: card.startTime,
        end: card.endTime,
        elementId: card.elementId || card.originalId || card.id,
        pageNumber: card.pageNumber || 1, // Use numeric page number
        granularity: card.type || granularity // Track which level this sync belongs to
      }));

      // Save sync blocks to backend with granularity info
      await audioSyncService.saveSyncBlocks(
        parseInt(jobId),
        syncBlocks,
        serverAudioFileName,
        granularity // Pass current granularity preference
      );

      // Update allSyncCards with the propagated timings
      setAllSyncCards(prevCards => {
        const cardMap = new Map(prevCards.map(c => [c.originalId || c.id, c]));
        uniqueSyncs.forEach(newCard => {
          cardMap.set(newCard.originalId || newCard.id, newCard);
        });
        return Array.from(cardMap.values());
      });

      // Regenerate EPUB with audio mappings
      await conversionService.regenerateEpub(parseInt(jobId), { granularity });

      console.log(`Saved ${uniqueSyncs.length} sync cards to backend (${activeCards.length} manual, ${uniqueSyncs.length - activeCards.length} auto-generated)`);
      setError(''); // Clear any previous errors
      alert(`Sync mappings saved successfully!\n${activeCards.length} ${granularity}s + ${uniqueSyncs.length - activeCards.length} auto-calculated child timings`);
    } catch (err) {
      console.error('Error saving sync mappings:', err);
      setError('Failed to save sync mappings: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Format time in MM:SS format
   */
  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading && syncCards.length === 0) {
    return (
      <div className="audio-sync-cards-container">
        <div className="loading">Loading EPUB content...</div>
      </div>
    );
  }

  return (
    <div className="audio-sync-cards-container">
      <div className="header-section">
        <button onClick={() => navigate('/conversions')} className="back-button">
          ← Back to Conversions
        </button>
        <h1>Audio Sync Cards - Job #{jobId}</h1>
      </div>

      {error && (
        <div className="error-message">{error}</div>
      )}

      {/* Granularity Toggle Section */}
      <div className="granularity-section">
        <div className="granularity-label">Sync Level:</div>
        <div className="granularity-controls">
          <button
            onClick={() => handleGranularityChange('paragraph')}
            className={`granularity-btn ${granularity === 'paragraph' ? 'active' : ''}`}
            title="Sync at paragraph level (fastest)"
          >
            📝 Paragraphs
          </button>
          <button
            onClick={() => handleGranularityChange('sentence')}
            className={`granularity-btn ${granularity === 'sentence' ? 'active' : ''}`}
            title="Sync at sentence level (recommended)"
          >
            📄 Sentences
          </button>
          <button
            onClick={() => handleGranularityChange('word')}
            className={`granularity-btn ${granularity === 'word' ? 'active' : ''}`}
            title="Sync at word level (most precise)"
          >
            🔤 Words
          </button>
        </div>
        <button
          onClick={propagateTimings}
          className="btn btn-propagate"
          title="Auto-calculate timings for current level from parent level"
          disabled={!epubTextContent || granularity === 'paragraph'}
        >
          ⚡ Auto-Calculate from Parent
        </button>
        <div className="granularity-info">
          {granularity === 'paragraph' && '🔵 Quick sync: Mark paragraphs, child timings auto-calculated on save'}
          {granularity === 'sentence' && '🟢 Recommended: Mark sentences, word timings auto-calculated on save'}
          {granularity === 'word' && '🟡 Precise: Mark individual words for exact highlighting'}
        </div>
      </div>

      {/* Audio Options Section */}
      <div className="audio-options-section">
        <div className="upload-section">
          <label htmlFor="audio-upload" className="upload-button">
            <HiOutlineVolumeUp size={20} />
            Upload Audio
          </label>
          <input
            type="file"
            id="audio-upload"
            accept="audio/*"
            onChange={handleAudioUpload}
            style={{ display: 'none' }}
          />
          {uploadedAudioFile && (
            <span className="audio-file-name">{uploadedAudioFile.name}</span>
          )}
        </div>

        <div className="generate-audio-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label htmlFor="voice-select" style={{ fontSize: '14px', fontWeight: '500' }}>
              Voice:
            </label>
            <select
              id="voice-select"
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: '6px',
                fontSize: '14px',
                minWidth: '150px'
              }}
            >
              {voices.map((voice, idx) => {
                const voiceKey = voice.id || voice.value || `voice-${idx}`;
                const voiceValue = voice.value || voice.id || voiceKey;
                const voiceLabel = voice.label || voice.name || voice.value || voiceKey;
                return (
                  <option key={voiceKey} value={voiceValue}>
                    {voiceLabel}
                  </option>
                );
              })}
            </select>
            <button
              onClick={handleGenerateAudio}
              className="btn btn-generate"
              disabled={generating || !pdfId || syncCards.length === 0}
            >
              {generating ? 'Generating...' : 'Generate Audio for All Pages'}
            </button>
            {generatedAudioUrl && (
              <button
                onClick={handleDownloadAudio}
                className="btn btn-download"
              >
                Download MP3
              </button>
            )}
          </div>
          {generating && (
            <div style={{ marginTop: '12px', fontSize: '13px', color: '#666' }}>
              Generating audio for {syncCards.filter(c => c.shouldRead).length} enabled cards...
            </div>
          )}
        </div>
      </div>

      {/* Audio Player Section */}
      {(uploadedAudioUrl || generatedAudioUrl) && (
        <div className="audio-player-section">
          <audio
            ref={audioRef}
            src={uploadedAudioUrl || generatedAudioUrl}
            controls
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={(e) => {
              const audioDuration = e.target.duration;
              setDuration(audioDuration);
              // ISSUE #4 FIX: Auto-sync if audio was just uploaded and cards don't have timings
              // But only if duration is reasonable (checked inside autoSyncAudio)
              if (uploadedAudioFile && syncCards.length > 0) {
                const hasTimings = syncCards.some(card => card.startTime > 0 || card.endTime > 0);
                if (!hasTimings) {
                  autoSyncAudio(audioDuration);
                }
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            style={{ width: '100%', marginBottom: '12px' }}
          />
          
          {/* Loop Mode Controls */}
          {isLooping && loopCard && (
            <div className="loop-mode-indicator">
              <span className="loop-icon">🔁</span>
              <span>Looping: "{loopCard.text?.substring(0, 30)}..."</span>
              <button onClick={stopLoop} className="btn btn-small">Stop Loop</button>
            </div>
          )}
          
          {/* Auto-sync info */}
          {uploadedAudioFile && syncCards.some(card => card.startTime > 0 || card.endTime > 0) && (
            <div style={{
              padding: '8px 12px',
              backgroundColor: '#d4edda',
              border: '1px solid #c3e6cb',
              borderRadius: '6px',
              fontSize: '13px',
              color: '#155724',
              marginBottom: '12px'
            }}>
              ✓ Audio automatically synced with sync cards. You can edit timings using Tap-to-Sync or manually.
            </div>
          )}

          {/* Tap-to-Sync Controls */}
          <div className="tap-to-sync-controls">
            {!isTapToSyncMode ? (
              <button
                onClick={handleStartTapToSync}
                className="btn btn-primary"
                disabled={!uploadedAudioUrl && !generatedAudioUrl}
              >
                Start Tap-to-Sync
              </button>
            ) : (
              <>
                <button
                  onClick={handleMark}
                  className="btn btn-mark"
                  disabled={currentCardIndex >= syncCards.length}
                  title="Mark current time (or press Spacebar)"
                >
                  Mark ({formatTime(currentTime)})
                </button>
                {/* ISSUE #6 FIX: Add Undo button */}
                <button
                  onClick={handleUndo}
                  className="btn btn-secondary"
                  disabled={undoStackRef.current.length === 0}
                  title="Undo last mark"
                >
                  ↶ Undo
                </button>
                <button
                  onClick={handleStopTapToSync}
                  className="btn btn-secondary"
                >
                  Stop Sync
                </button>
                <div className="tap-to-sync-info">
                  Current card: {currentCardIndex + 1} of {syncCards.length}
                  {syncCards[currentCardIndex] && (
                    <span> - "{syncCards[currentCardIndex].text.substring(0, 50)}..."</span>
                  )}
                  <span style={{ fontSize: '12px', color: '#666', marginLeft: '8px' }}>
                    (Press Spacebar to mark)
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sync Cards Grid */}
      <div className="sync-cards-section">
        <h2>
          Sync Cards - {granularity.charAt(0).toUpperCase() + granularity.slice(1)}s ({syncCards.filter(c => c.shouldRead).length} enabled / {syncCards.length} total)
        </h2>
        <div className="sync-cards-grid">
          {syncCards.map((card, index) => {
            const cardKey = card.uniqueId || `${card.sectionId || index}_${card.id || index}`;
            const isActive = activeBlockId === cardKey || activeBlockId === card.id || activeBlockId === card.uniqueId;
            const isTapActive = index === currentCardIndex && isTapToSyncMode;
            
            return (
              <div
                key={cardKey}
                id={`card-${cardKey}`}
                className={`sync-card ${isTapActive ? 'tap-active' : ''} ${isActive ? 'preview-active' : ''} ${!card.shouldRead ? 'disabled' : ''}`}
              >
                {/* Toggle Switch */}
                <div className="card-header">
                  <button
                    onClick={() => toggleShouldRead(card.id)}
                    className={`toggle-button ${card.shouldRead ? 'enabled' : 'disabled'}`}
                    title={card.shouldRead ? 'Disable read-aloud' : 'Enable read-aloud'}
                  >
                    {card.shouldRead ? (
                      <HiOutlineVolumeUp size={20} />
                    ) : (
                      <HiOutlineVolumeOff size={20} />
                    )}
                  </button>
                  <span className={`card-type type-${card.type || granularity}`}>{card.type || granularity}</span>
                  <span className="card-id" title={card.id}>ID: {card.id?.length > 12 ? card.id.slice(0, 12) + '...' : card.id}</span>
                </div>

                {/* Card Content */}
                <div className={`card-content ${isActive ? 'highlight' : ''}`}>
                  <p className="card-text">{card.text || '(empty)'}</p>
                </div>

                {/* Timing Display */}
                <div className="card-timing">
                  {card.startTime >= 0 && card.endTime > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="timing-display">
                        {formatTime(card.startTime)} → {formatTime(card.endTime)}
                        <span className="duration-badge">
                          ({(card.endTime - card.startTime).toFixed(1)}s)
                        </span>
                      </span>
                      {/* Editable timing inputs */}
                      <div style={{ display: 'flex', gap: '8px', fontSize: '11px', alignItems: 'center' }}>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={card.startTime.toFixed(1)}
                          onChange={(e) => {
                            const newStartTime = parseFloat(e.target.value) || 0;
                            // ISSUE #5 FIX: Only update allSyncCards (single source of truth)
                            setAllSyncCards(prevCards =>
                              prevCards.map(c =>
                                (c.id === card.id || c.uniqueId === card.uniqueId) ? { ...c, startTime: newStartTime } : c
                              )
                            );
                          }}
                          style={{
                            width: '60px',
                            padding: '2px 4px',
                            fontSize: '11px',
                            border: '1px solid #e0e0e0',
                            borderRadius: '4px'
                          }}
                          placeholder="Start"
                        />
                        <span style={{ color: '#999' }}>→</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={card.endTime.toFixed(1)}
                          onChange={(e) => {
                            const newEndTime = parseFloat(e.target.value) || 0;
                            // ISSUE #5 FIX: Only update allSyncCards (single source of truth)
                            setAllSyncCards(prevCards =>
                              prevCards.map(c =>
                                (c.id === card.id || c.uniqueId === card.uniqueId) ? { ...c, endTime: newEndTime } : c
                              )
                            );
                          }}
                          style={{
                            width: '60px',
                            padding: '2px 4px',
                            fontSize: '11px',
                            border: '1px solid #e0e0e0',
                            borderRadius: '4px'
                          }}
                          placeholder="End"
                        />
                        {/* Loop button */}
                        <button
                          onClick={() => startLoopCard(card)}
                          className="btn-loop"
                          title="Loop this segment for fine-tuning"
                          disabled={card.startTime >= card.endTime}
                        >
                          🔁
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="not-synced">Not synced yet</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save and Regenerate Buttons */}
      <div className="save-section">
        <button
          onClick={handleSave}
          className="btn btn-save"
          disabled={loading || (!uploadedAudioFile && !generatedAudioUrl) || syncCards.filter(c => c.shouldRead).length === 0}
        >
          {loading ? 'Saving...' : 'Save Sync Mappings'}
        </button>
        <button
          onClick={async () => {
            try {
              setLoading(true);
              setError('');
              await conversionService.regenerateEpub(parseInt(jobId));
              alert('EPUB regenerated successfully!');
            } catch (err) {
              setError('Failed to regenerate EPUB: ' + err.message);
            } finally {
              setLoading(false);
            }
          }}
          className="btn btn-secondary"
          disabled={loading}
          style={{ marginLeft: '12px' }}
        >
          Regenerate EPUB
        </button>
      </div>
    </div>
  );
};

export default AudioSyncCards;

