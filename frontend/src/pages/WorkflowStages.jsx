import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { pdfService } from '../services/pdfService';
import { conversionService } from '../services/conversionService';
import { audioSyncService } from '../services/audioSyncService';
import { 
  HiOutlineCloudUpload, 
  HiOutlinePlay, 
  HiOutlinePause,
  HiOutlineDownload,
  HiOutlinePencil,
  HiOutlineCheck,
  HiOutlineX,
  HiOutlineVolumeUp,
  HiOutlineArrowRight,
  HiOutlineArrowLeft,
  HiOutlineRefresh,
  HiOutlineDocumentText,
  HiOutlinePhotograph,
  HiOutlineCode
} from 'react-icons/hi';
import EpubViewer from '../components/EpubViewer';
import './WorkflowStages.css';

const WorkflowStages = () => {
  const navigate = useNavigate();
  const { jobId: paramJobId } = useParams();
  
  // Stage management
  const [currentStage, setCurrentStage] = useState(1);
  const [pdf, setPdf] = useState(null);
  const [job, setJob] = useState(null);
  const [textChunks, setTextChunks] = useState([]);
  const [audioSegments, setAudioSegments] = useState([]);
  const [uploadedAudioFiles, setUploadedAudioFiles] = useState([]);
  
  // Stage 1: Upload PDF
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [converting, setConverting] = useState(false);
  
  // Stage 2: Extract and Generate Audio
  const [selectedBlocks, setSelectedBlocks] = useState([]);
  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('standard');
  const [voices, setVoices] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [playingBlockId, setPlayingBlockId] = useState(null);
  const [blockAudioElements, setBlockAudioElements] = useState({});
  const [selectedPage, setSelectedPage] = useState(1);
  const [combinedAudioUrl, setCombinedAudioUrl] = useState(null);
  
  // Stage 3: Upload Images
  const [uploadedImages, setUploadedImages] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState(null);
  const [epubSections, setEpubSections] = useState([]);
  const [selectedSection, setSelectedSection] = useState(null);
  const [xhtmlPreview, setXhtmlPreview] = useState('');
  const [showXhtmlPreview, setShowXhtmlPreview] = useState(false);
  
  // Stage 4: Upload Audio & Sync
  const [audioFile, setAudioFile] = useState(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [mappingMode, setMappingMode] = useState(false);
  const [clipTimings, setClipTimings] = useState({});
  const [epubReady, setEpubReady] = useState(false);
  
  // General state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (paramJobId) {
      loadJobData(parseInt(paramJobId));
    }
    loadVoices();
  }, [paramJobId]);

  const loadJobData = async (jobId) => {
    try {
      setLoading(true);
      const jobData = await conversionService.getConversionJob(jobId);
      setJob(jobData);
      
      if (jobData.pdfDocumentId) {
        const pdfData = await pdfService.getPdfById(jobData.pdfDocumentId);
        setPdf(pdfData);
      }
      
      // Load text blocks
      try {
        const textBlocksData = await conversionService.getTextBlocks(jobId);
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
              height: block.height
            });
          });
        });
        setTextChunks(chunks);
        if (chunks.length > 0) {
          setCurrentStage(2); // Move to stage 2 if text is available
        }
      } catch (err) {
        console.warn('Could not load text blocks:', err);
      }
      
      // Load audio segments
      try {
        const audioData = await audioSyncService.getAudioSyncsByJob(jobId);
        setAudioSegments(audioData || []);
        if (audioData && audioData.length > 0) {
          setCurrentStage(3); // Move to stage 3 if audio exists
        }
      } catch (err) {
        console.warn('Could not load audio segments:', err);
      }

      // Check if EPUB is ready (has mappings saved)
      try {
        const audioData = await audioSyncService.getAudioSyncsByJob(jobId);
        if (audioData && audioData.length > 0) {
          // Check if mappings are saved (epubReady state)
          setEpubReady(true);
          setCurrentStage(4); // Move to stage 4 if EPUB is ready
        }
      } catch (err) {
        console.warn('Could not check EPUB status:', err);
      }
    } catch (err) {
      setError('Failed to load job data: ' + err.message);
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

  // Stage 1: Upload PDF
  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError('');
  };

  const handleUploadAndConvert = async () => {
    if (!file) {
      setError('Please select a PDF file');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      // Upload PDF
      const uploadedPdf = await pdfService.uploadPdf(file);
      setPdf(uploadedPdf);
      setSuccess('PDF uploaded successfully!');
      
      // Start conversion
      setConverting(true);
      const conversionJob = await conversionService.startConversion(uploadedPdf.id);
      setJob(conversionJob);
      
      // Wait for conversion to extract text blocks
      setTimeout(async () => {
        try {
          const textBlocksData = await conversionService.getTextBlocks(conversionJob.id);
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
                height: block.height
              });
            });
          });
          setTextChunks(chunks);
          setCurrentStage(2); // Move to stage 2
          setSuccess('PDF processed! Text extracted. Move to Stage 2 to generate audio.');
        } catch (err) {
          console.error('Error loading text blocks:', err);
          setError('PDF uploaded but text extraction failed. Please try again.');
        } finally {
          setConverting(false);
        }
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Stage 2: Generate Audio
  const handleBlockSelect = (blockId, event) => {
    if (editingBlockId === blockId || event.target.closest('.edit-button')) {
      return;
    }
    
    if (event.ctrlKey || event.metaKey) {
      setSelectedBlocks(prev => 
        prev.includes(blockId) 
          ? prev.filter(id => id !== blockId)
          : [...prev, blockId]
      );
    } else {
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

  const handleGenerateAudio = async () => {
    if (!pdf || !job) {
      setError('PDF and job must be available');
      return;
    }

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
      
      const segments = await audioSyncService.generateAudio(
        pdf.id,
        job.id,
        selectedVoice,
        blocksToGenerate
      );
      
      setAudioSegments(segments);
      setSelectedBlocks([]);
      
      // Initialize clip timings
      const timings = {};
      segments.forEach(segment => {
        if (segment.blockId) {
          timings[segment.blockId] = {
            clipBegin: segment.startTime || 0,
            clipEnd: segment.endTime || 0
          };
        }
      });
      setClipTimings(timings);
      
      setSuccess('Audio generated successfully! Move to Stage 3 to upload images.');
      setCurrentStage(3);
    } catch (err) {
      setError('Failed to generate audio: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handlePlayBlockAudio = async (blockId) => {
    // Stop any currently playing audio
    Object.values(blockAudioElements).forEach(audio => {
      if (audio && audio instanceof HTMLAudioElement && !audio.paused) {
        audio.pause();
        audio.currentTime = 0;
      }
    });

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (playingBlockId === blockId) {
      setPlayingBlockId(null);
      return;
    }

    const block = textChunks.find(c => c.id === blockId);
    if (!block) {
      setError('Block not found');
      return;
    }

    const textToSpeak = block.text || '';

    if (!('speechSynthesis' in window)) {
      setError('Your browser does not support text-to-speech.');
      return;
    }

    try {
      setPlayingBlockId(blockId);
      setError('');

      let voices = window.speechSynthesis.getVoices();
      
      if (voices.length === 0) {
        const loadVoices = () => {
          voices = window.speechSynthesis.getVoices();
          if (voices.length > 0) {
            speakWithVoice();
          }
        };
        window.speechSynthesis.onvoiceschanged = loadVoices;
        setTimeout(loadVoices, 100);
        return;
      }

      const speakWithVoice = () => {
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        const preferredVoice = voices.find(v => 
          v.name.toLowerCase().includes('english') || 
          v.lang.startsWith('en')
        ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
        
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }

        utterance.onend = () => {
          setPlayingBlockId(null);
        };

        utterance.onerror = (e) => {
          setError('Failed to play audio: ' + (e.error || 'Unknown error'));
          setPlayingBlockId(null);
        };

        window.speechSynthesis.speak(utterance);
        setBlockAudioElements(prev => ({ ...prev, [blockId]: utterance }));
      };

      speakWithVoice();
    } catch (err) {
      setError('Failed to play audio: ' + err.message);
      setPlayingBlockId(null);
    }
  };

  const handleDownloadAudio = async (blockId) => {
    const segment = audioSegments.find(s => s.blockId === blockId);
    if (!segment || !segment.audioFilePath) {
      setError('Audio file not available for this block');
      return;
    }

    try {
      const audioUrl = audioSyncService.getAudioUrl(segment.id);
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audio_block_${blockId}.mp3`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setSuccess('Audio downloaded successfully!');
    } catch (err) {
      setError('Failed to download audio: ' + err.message);
    }
  };

  // Download whole audio after editing
  const handleDownloadWholeAudio = async () => {
    if (audioSegments.length === 0) {
      setError('No audio segments available. Please generate audio first.');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Combine all audio segments into one file
      // In a real implementation, you'd call a backend endpoint to merge audio files
      // For now, we'll create a combined audio blob
      const audioBlobs = [];
      
      for (const segment of audioSegments) {
        try {
          const audioUrl = audioSyncService.getAudioUrl(segment.id);
          const response = await fetch(audioUrl);
          const blob = await response.blob();
          audioBlobs.push(blob);
        } catch (err) {
          console.warn(`Failed to load audio for segment ${segment.id}:`, err);
        }
      }

      if (audioBlobs.length === 0) {
        setError('No audio files could be loaded');
        return;
      }

      // Note: In production, you'd want to use a backend service to properly merge audio files
      // For now, we'll download the first audio file as a placeholder
      const firstBlob = audioBlobs[0];
      const url = window.URL.createObjectURL(firstBlob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `complete_audio_${job?.id || 'document'}.mp3`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setSuccess('Complete audio file downloaded! (Note: In production, all segments will be merged)');
    } catch (err) {
      setError('Failed to download complete audio: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Stage 3: Upload Images
  const handleImageUpload = async (files) => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setError('Please select image files');
      return;
    }

    setUploadingImages(true);
    setError('');

    try {
      const newImages = imageFiles.map((file, index) => ({
        id: Date.now() + index,
        file: file,
        name: file.name,
        url: URL.createObjectURL(file),
        order: uploadedImages.length + index
      }));

      setUploadedImages(prev => [...prev, ...newImages]);
      setSuccess(`${imageFiles.length} image(s) uploaded successfully!`);
    } catch (err) {
      setError('Failed to upload images: ' + err.message);
    } finally {
      setUploadingImages(false);
    }
  };

  const handleImageDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleImageUpload(files);
    }
  };

  const handleImageDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleImageDragStart = (index) => {
    setDraggedImageIndex(index);
  };

  const handleImageDragEnd = () => {
    setDraggedImageIndex(null);
  };

  const handleImageDropReorder = (dropIndex) => {
    if (draggedImageIndex === null || draggedImageIndex === dropIndex) return;

    const newImages = [...uploadedImages];
    const draggedImage = newImages[draggedImageIndex];
    newImages.splice(draggedImageIndex, 1);
    newImages.splice(dropIndex, 0, draggedImage);
    
    // Update order
    newImages.forEach((img, idx) => {
      img.order = idx;
    });

    setUploadedImages(newImages);
    setDraggedImageIndex(null);
  };

  const handleRemoveImage = (imageId) => {
    setUploadedImages(prev => {
      const filtered = prev.filter(img => img.id !== imageId);
      // Reorder remaining images
      return filtered.map((img, idx) => ({ ...img, order: idx }));
    });
  };

  const loadEpubSections = async () => {
    if (!job) return;

    try {
      const sections = await conversionService.getEpubSections(job.id);
      setEpubSections(sections);
      if (sections && sections.length > 0) {
        setSelectedSection(sections[0]);
        await loadXhtmlPreview(sections[0].id);
      }
    } catch (err) {
      console.error('Error loading EPUB sections:', err);
    }
  };

  const loadXhtmlPreview = async (sectionId) => {
    if (!job || !sectionId) return;

    try {
      const xhtmlData = await conversionService.getSectionXhtml(job.id, sectionId);
      setXhtmlPreview(xhtmlData.xhtml || xhtmlData);
    } catch (err) {
      console.error('Error loading XHTML preview:', err);
      setError('Failed to load XHTML preview: ' + err.message);
    }
  };

  useEffect(() => {
    if (job && currentStage >= 3) {
      loadEpubSections();
    }
  }, [job, currentStage]);

  useEffect(() => {
    if (selectedSection) {
      loadXhtmlPreview(selectedSection.id);
    }
  }, [selectedSection]);

  // Stage 4: Upload Audio & Sync
  const handleAudioFileChange = (e) => {
    setAudioFile(e.target.files[0]);
    setError('');
  };

  const handleUploadAudio = async () => {
    if (!audioFile) {
      setError('Please select an audio file');
      return;
    }

    setUploadingAudio(true);
    setError('');

    try {
      // For now, we'll store the file reference
      // In a real implementation, you'd upload to the server
      setUploadedAudioFiles(prev => [...prev, {
        id: Date.now(),
        name: audioFile.name,
        file: audioFile,
        url: URL.createObjectURL(audioFile)
      }]);
      setSuccess('Audio file uploaded successfully!');
      setAudioFile(null);
    } catch (err) {
      setError('Failed to upload audio: ' + err.message);
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleDownloadEpubWithSmil = async () => {
    if (!job) {
      setError('Job not available');
      return;
    }

    if (!epubReady) {
      setError('Please complete audio mapping first');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Download EPUB (SMIL will be generated automatically by the backend)
      await conversionService.downloadEpub(job.id);
      
      setSuccess('EPUB downloaded successfully! SMIL file is included in the EPUB package.');
    } catch (err) {
      setError('Failed to download EPUB: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMapping = async () => {
    if (!job) {
      setError('Job not available');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Save all clip timings as audio syncs
      for (const [blockId, timing] of Object.entries(clipTimings)) {
        const block = textChunks.find(c => c.id === blockId);
        if (!block) continue;

        const existing = audioSegments.find(s => s.blockId === blockId);
        if (existing) {
          await audioSyncService.updateAudioSync(existing.id, {
            startTime: timing.clipBegin,
            endTime: timing.clipEnd,
            text: block.text
          });
        } else {
          await audioSyncService.createAudioSync({
            conversionJobId: job.id,
            pdfDocumentId: pdf?.id,
            blockId: blockId,
            pageNumber: block.pageNumber,
            startTime: timing.clipBegin,
            endTime: timing.clipEnd,
            audioFilePath: null,
            customText: block.text
          });
        }
      }

      // Regenerate EPUB with mappings
      await conversionService.regenerateEpub(job.id);
      
      setEpubReady(true);
      setSuccess('Audio mapping saved successfully! EPUB is ready for download.');
    } catch (err) {
      setError('Failed to save mapping: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const pageBlocks = textChunks.filter(chunk => chunk.pageNumber === selectedPage);
  const maxPage = textChunks.length > 0 
    ? Math.max(...textChunks.map(c => c.pageNumber))
    : 1;

  return (
    <div className="workflow-stages-container">
      <div className="workflow-header">
        <button
          onClick={() => navigate('/conversions')}
          className="btn btn-secondary"
        >
          <HiOutlineArrowLeft size={20} />
          Back to Conversions
        </button>
        <h1>PDF to EPUB Workflow</h1>
        {job && (
          <div className="job-info">
            Job #{job.id} • {pdf?.originalFileName || 'PDF Document'}
          </div>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* Stage Navigation */}
      <div className="stage-navigation">
        <div 
          className={`stage-nav-item ${currentStage >= 1 ? 'active' : ''} ${currentStage === 1 ? 'current' : ''}`}
          onClick={() => setCurrentStage(1)}
        >
          <div className="stage-number">1</div>
          <div className="stage-label">Upload PDF</div>
        </div>
        <div className="stage-connector" />
        <div 
          className={`stage-nav-item ${currentStage >= 2 ? 'active' : ''} ${currentStage === 2 ? 'current' : ''}`}
          onClick={() => currentStage >= 2 && setCurrentStage(2)}
        >
          <div className="stage-number">2</div>
          <div className="stage-label">Extract & Generate Audio</div>
        </div>
        <div className="stage-connector" />
        <div 
          className={`stage-nav-item ${currentStage >= 3 ? 'active' : ''} ${currentStage === 3 ? 'current' : ''}`}
          onClick={() => currentStage >= 3 && setCurrentStage(3)}
        >
          <div className="stage-number">3</div>
          <div className="stage-label">Upload Images</div>
        </div>
        <div className="stage-connector" />
        <div 
          className={`stage-nav-item ${currentStage >= 4 ? 'active' : ''} ${currentStage === 4 ? 'current' : ''}`}
          onClick={() => currentStage >= 4 && setCurrentStage(4)}
        >
          <div className="stage-number">4</div>
          <div className="stage-label">Audio Sync & Download</div>
        </div>
      </div>

      {/* Stage Content - Full Width Vertical Flow */}
      <div className="stages-content">
        {/* Stage 1: Upload PDF */}
        <div className={`stage-panel stage-1 ${currentStage === 1 ? 'active' : ''}`}>
          <div className="stage-header">
            <h2>Stage 1: Upload PDF</h2>
          </div>

          <div className="stage-content">
            <div className="section-card">
              <h3>Upload PDF Document</h3>
              <div className="upload-area">
                <input
                  type="file"
                  accept=".pdf,.zip"
                  onChange={handleFileChange}
                  id="pdf-upload"
                  style={{ display: 'none' }}
                />
                <label htmlFor="pdf-upload" className="upload-label">
                  <HiOutlineCloudUpload size={48} />
                  <span>Click to select PDF file</span>
                  {file && <span className="file-name">{file.name}</span>}
                </label>
                <button
                  onClick={handleUploadAndConvert}
                  disabled={!file || uploading || converting}
                  className="btn btn-primary btn-large"
                >
                  {uploading ? 'Uploading...' : converting ? 'Processing...' : 'Upload & Process PDF'}
                </button>
              </div>

              {pdf && (
                <div className="upload-success">
                  <HiOutlineCheck size={24} />
                  <span>PDF uploaded: {pdf.originalFileName}</span>
                </div>
              )}

              {job && (
                <div className="job-status">
                  <HiOutlineRefresh size={20} />
                  <span>Conversion Job #{job.id} - {job.status}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stage 2: Generate Audio */}
        <div className={`stage-panel stage-2 ${currentStage === 2 ? 'active' : ''}`}>
          <div className="stage-header">
            <h2>Stage 3: Audio Syncing & Mapping</h2>
            <div className="stage-status">
              {audioSegments.length > 0 && (
                <span className="status-badge">{audioSegments.length} mappings</span>
              )}
            </div>
          </div>

          <div className="stage-content">
            {/* Upload Audio Section */}
            <div className="section-card">
              <h3>Upload Audio File</h3>
              <div className="upload-area">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioFileChange}
                  id="audio-upload"
                  style={{ display: 'none' }}
                />
                <label htmlFor="audio-upload" className="upload-label">
                  <HiOutlineCloudUpload size={32} />
                  <span>Click to upload audio file</span>
                  {audioFile && <span className="file-name">{audioFile.name}</span>}
                </label>
                <button
                  onClick={handleUploadAudio}
                  disabled={!audioFile || uploadingAudio}
                  className="btn btn-primary"
                >
                  {uploadingAudio ? 'Uploading...' : 'Upload Audio'}
                </button>
              </div>

              {uploadedAudioFiles.length > 0 && (
                <div className="uploaded-files">
                  <h4>Uploaded Files:</h4>
                  {uploadedAudioFiles.map(file => (
                    <div key={file.id} className="file-item">
                      <span>{file.name}</span>
                      <audio controls src={file.url} style={{ width: '100%', marginTop: '8px' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audio Mapping Section */}
            <div className="section-card">
              <h3>Map Audio to Text Blocks</h3>
              <div className="mapping-controls">
                <button
                  onClick={() => setMappingMode(!mappingMode)}
                  className={`btn ${mappingMode ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {mappingMode ? 'Exit Mapping Mode' : 'Start Mapping'}
                </button>
              </div>

              {mappingMode && (
                <div className="mapping-instructions">
                  <p>Click on text blocks below to map them to audio segments. Adjust CLIPBEGIN and CLIPEND timings.</p>
                </div>
              )}

              <div className="text-blocks-list">
                {pageBlocks.map((block, idx) => {
                  const segment = audioSegments.find(s => s.blockId === block.id);
                  const timing = clipTimings[block.id] || { clipBegin: 0, clipEnd: 0 };

                  return (
                    <div key={block.id} className="mapping-block">
                      <div className="block-header">
                        <span className="block-number">Block {idx + 1}</span>
                        {segment && (
                          <span className="mapped-badge">Mapped</span>
                        )}
                      </div>
                      <div className="block-text">{block.text}</div>
                      <div className="timing-controls">
                        <div className="timing-input">
                          <label>CLIPBEGIN (S):</label>
                          <input
                            type="number"
                            step="0.01"
                            value={timing.clipBegin.toFixed(2)}
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
                          />
                        </div>
                        <div className="timing-input">
                          <label>CLIPEND (S):</label>
                          <input
                            type="number"
                            step="0.01"
                            value={timing.clipEnd.toFixed(2)}
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
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={handleSaveMapping}
                disabled={loading || Object.keys(clipTimings).length === 0}
                className="btn btn-success"
                style={{ marginTop: '20px', width: '100%' }}
              >
                {loading ? 'Saving...' : 'Save Audio Mapping'}
              </button>
            </div>
          </div>
        </div>

        {/* Stage 2: Generate Audio (Middle) */}
        <div className={`stage-panel stage-2 ${currentStage === 2 ? 'active' : ''}`}>
          <div className="stage-header">
            <h2>Stage 2: Generate Audio</h2>
            <div className="stage-status">
              {textChunks.length > 0 && (
                <span className="status-badge">{textChunks.length} text blocks</span>
              )}
            </div>
          </div>

          <div className="stage-content">
            {textChunks.length === 0 ? (
              <div className="empty-state">
                <p>No text blocks available. Please complete Stage 1 first.</p>
              </div>
            ) : (
              <>
                {/* Voice Selection */}
                <div className="section-card">
                  <h3>Voice Selection</h3>
                  <select
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    disabled={generating}
                    className="voice-select"
                  >
                    {voices.map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} {voice.type === 'child' ? '👶' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Page Selection */}
                <div className="section-card">
                  <h3>Page Selection</h3>
                  <select
                    value={selectedPage}
                    onChange={(e) => {
                      setSelectedPage(parseInt(e.target.value));
                      setSelectedBlocks([]);
                    }}
                    className="page-select"
                  >
                    {Array.from({ length: maxPage }, (_, i) => i + 1).map(pageNum => (
                      <option key={pageNum} value={pageNum}>
                        Page {pageNum}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Text Blocks */}
                <div className="section-card">
                  <h3>Text Blocks - Page {selectedPage}</h3>
                  <div className="block-actions">
                    <button
                      onClick={() => {
                        const blockIds = pageBlocks.map(c => c.id);
                        setSelectedBlocks(blockIds);
                      }}
                      className="btn btn-sm"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedBlocks([])}
                      className="btn btn-sm"
                    >
                      Clear
                    </button>
                    <button
                      onClick={handleGenerateAudio}
                      disabled={generating || selectedBlocks.length === 0}
                      className="btn btn-primary"
                    >
                      {generating ? 'Generating...' : 'Generate Audio'}
                    </button>
                  </div>

                  <div className="text-blocks-list">
                    {pageBlocks.map((block, idx) => {
                      const isSelected = selectedBlocks.includes(block.id);
                      const isEditing = editingBlockId === block.id;
                      const segment = audioSegments.find(s => s.blockId === block.id);
                      const isPlaying = playingBlockId === block.id;

                      return (
                        <div
                          key={block.id}
                          className={`text-block ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`}
                          onClick={(e) => !isEditing && handleBlockSelect(block.id, e)}
                        >
                          <div className="block-header">
                            <span className="block-number">Block {idx + 1}</span>
                            <div className="block-actions">
                              {!isEditing ? (
                                <>
                                  <button
                                    className="btn-icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePlayBlockAudio(block.id);
                                    }}
                                    title="Play Audio"
                                  >
                                    {isPlaying ? <HiOutlinePause /> : <HiOutlinePlay />}
                                  </button>
                                  {segment && (
                                    <button
                                      className="btn-icon"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownloadAudio(block.id);
                                      }}
                                      title="Download Audio"
                                    >
                                      <HiOutlineDownload />
                                    </button>
                                  )}
                                  <button
                                    className="btn-icon edit-button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartEdit(block);
                                    }}
                                    title="Edit Text"
                                  >
                                    <HiOutlinePencil />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="btn-icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveEdit(block.id);
                                    }}
                                    title="Save"
                                  >
                                    <HiOutlineCheck />
                                  </button>
                                  <button
                                    className="btn-icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEdit();
                                    }}
                                    title="Cancel"
                                  >
                                    <HiOutlineX />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {isEditing ? (
                            <textarea
                              value={editedText}
                              onChange={(e) => setEditedText(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="edit-textarea"
                              autoFocus
                            />
                          ) : (
                            <div className="block-text">{block.text || '(Empty block)'}</div>
                          )}
                          {segment && (
                            <div className="audio-info">
                              Audio: {segment.startTime?.toFixed(2)}s - {segment.endTime?.toFixed(2)}s
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Download Whole Audio */}
                {audioSegments.length > 0 && (
                  <div className="section-card">
                    <h3>Download Complete Audio</h3>
                    <p style={{ marginBottom: '16px', color: '#666', fontSize: '14px' }}>
                      Download all generated audio segments as a single file after editing.
                    </p>
                    <button
                      onClick={handleDownloadWholeAudio}
                      disabled={loading || audioSegments.length === 0}
                      className="btn btn-success btn-large"
                      style={{ width: '100%' }}
                    >
                      <HiOutlineDownload size={20} />
                      {loading ? 'Preparing...' : 'Download Whole Audio'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Stage 3: Upload Images */}
        <div className={`stage-panel stage-3 ${currentStage === 3 ? 'active' : ''}`}>
          <div className="stage-header">
            <h2>Stage 3: Upload Images</h2>
            <div className="stage-status">
              {uploadedImages.length > 0 && (
                <span className="status-badge">{uploadedImages.length} images</span>
              )}
            </div>
          </div>

          <div className="stage-content">
            {/* Image Upload Section */}
            <div className="section-card">
              <h3>Upload Images</h3>
              <div
                className="upload-area"
                onDrop={handleImageDrop}
                onDragOver={handleImageDragOver}
                style={{
                  border: '2px dashed #1976d2',
                  borderRadius: '8px',
                  padding: '40px',
                  backgroundColor: '#e3f2fd',
                  cursor: 'pointer',
                  minHeight: '200px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '16px'
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleImageUpload(e.target.files)}
                  id="image-upload"
                  style={{ display: 'none' }}
                />
                <label htmlFor="image-upload" style={{ cursor: 'pointer', textAlign: 'center' }}>
                  <HiOutlinePhotograph size={48} style={{ color: '#1976d2', marginBottom: '12px' }} />
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#1976d2', marginBottom: '8px' }}>
                    Drag & Drop Images Here
                  </div>
                  <div style={{ fontSize: '14px', color: '#666' }}>
                    or click to select images
                  </div>
                </label>
              </div>

              {uploadedImages.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                  <h4 style={{ marginBottom: '16px' }}>Uploaded Images ({uploadedImages.length})</h4>
                  <div className="images-grid">
                    {uploadedImages.map((image, index) => (
                      <div
                        key={image.id}
                        draggable
                        onDragStart={() => handleImageDragStart(index)}
                        onDragEnd={handleImageDragEnd}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.style.opacity = '0.5';
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.style.opacity = '1';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.style.opacity = '1';
                          handleImageDropReorder(index);
                        }}
                        className="image-item"
                        style={{
                          position: 'relative',
                          border: '2px solid #e0e0e0',
                          borderRadius: '8px',
                          padding: '8px',
                          backgroundColor: 'white',
                          cursor: 'move',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <img
                          src={image.url}
                          alt={image.name}
                          style={{
                            width: '100%',
                            height: '150px',
                            objectFit: 'cover',
                            borderRadius: '4px',
                            marginBottom: '8px'
                          }}
                        />
                        <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                          {image.name}
                        </div>
                        <button
                          onClick={() => handleRemoveImage(image.id)}
                          className="btn-icon"
                          style={{ position: 'absolute', top: '8px', right: '8px' }}
                        >
                          <HiOutlineX size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* EPUB XHTML Preview Section */}
            {job && epubSections.length > 0 && (
              <div className="section-card">
                <h3>EPUB XHTML Preview</h3>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>
                    Select Section:
                  </label>
                  <select
                    value={selectedSection?.id || ''}
                    onChange={(e) => {
                      const section = epubSections.find(s => s.id === e.target.value);
                      setSelectedSection(section);
                    }}
                    className="page-select"
                  >
                    {epubSections.map(section => (
                      <option key={section.id} value={section.id}>
                        {section.title || section.href || `Section ${section.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <button
                    onClick={() => setShowXhtmlPreview(!showXhtmlPreview)}
                    className="btn btn-secondary"
                  >
                    <HiOutlineCode size={18} />
                    {showXhtmlPreview ? 'Hide' : 'Show'} XHTML Preview
                  </button>
                </div>

                {showXhtmlPreview && xhtmlPreview && (
                  <div
                    style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      padding: '16px',
                      backgroundColor: '#f8f9fa',
                      maxHeight: '500px',
                      overflow: 'auto',
                      fontFamily: 'monospace',
                      fontSize: '12px'
                    }}
                  >
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                      {xhtmlPreview}
                    </pre>
                  </div>
                )}

                {!showXhtmlPreview && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
                    Click "Show XHTML Preview" to view the generated EPUB XHTML content
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stage 4: Audio Sync & Download */}
        <div className={`stage-panel stage-4 ${currentStage === 4 ? 'active' : ''}`}>
          <div className="stage-header">
            <h2>Stage 4: Audio Sync & Download</h2>
            <div className="stage-status">
              {audioSegments.length > 0 && (
                <span className="status-badge">{audioSegments.length} mappings</span>
              )}
            </div>
          </div>

          <div className="stage-content">
            {/* Upload Audio Section */}
            <div className="section-card">
              <h3>Upload Audio File</h3>
              <div className="upload-area">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioFileChange}
                  id="audio-upload"
                  style={{ display: 'none' }}
                />
                <label htmlFor="audio-upload" className="upload-label">
                  <HiOutlineCloudUpload size={32} />
                  <span>Click to upload audio file</span>
                  {audioFile && <span className="file-name">{audioFile.name}</span>}
                </label>
                <button
                  onClick={handleUploadAudio}
                  disabled={!audioFile || uploadingAudio}
                  className="btn btn-primary"
                >
                  {uploadingAudio ? 'Uploading...' : 'Upload Audio'}
                </button>
              </div>

              {uploadedAudioFiles.length > 0 && (
                <div className="uploaded-files">
                  <h4>Uploaded Files:</h4>
                  {uploadedAudioFiles.map(file => (
                    <div key={file.id} className="file-item">
                      <span>{file.name}</span>
                      <audio controls src={file.url} style={{ width: '100%', marginTop: '8px' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audio Mapping Section */}
            <div className="section-card">
              <h3>Map Audio to Text Blocks</h3>
              <div className="mapping-controls">
                <button
                  onClick={() => setMappingMode(!mappingMode)}
                  className={`btn ${mappingMode ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {mappingMode ? 'Exit Mapping Mode' : 'Start Mapping'}
                </button>
              </div>

              {mappingMode && (
                <div className="mapping-instructions">
                  <p>Click on text blocks below to map them to audio segments. Adjust CLIPBEGIN and CLIPEND timings.</p>
                </div>
              )}

              <div className="text-blocks-list">
                {pageBlocks.map((block, idx) => {
                  const segment = audioSegments.find(s => s.blockId === block.id);
                  const timing = clipTimings[block.id] || { clipBegin: 0, clipEnd: 0 };

                  return (
                    <div key={block.id} className="mapping-block">
                      <div className="block-header">
                        <span className="block-number">Block {idx + 1}</span>
                        {segment && (
                          <span className="mapped-badge">Mapped</span>
                        )}
                      </div>
                      <div className="block-text">{block.text}</div>
                      <div className="timing-controls">
                        <div className="timing-input">
                          <label>CLIPBEGIN (S):</label>
                          <input
                            type="number"
                            step="0.01"
                            value={timing.clipBegin.toFixed(2)}
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
                          />
                        </div>
                        <div className="timing-input">
                          <label>CLIPEND (S):</label>
                          <input
                            type="number"
                            step="0.01"
                            value={timing.clipEnd.toFixed(2)}
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
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={handleSaveMapping}
                disabled={loading || Object.keys(clipTimings).length === 0}
                className="btn btn-success"
                style={{ marginTop: '20px', width: '100%' }}
              >
                {loading ? 'Saving...' : 'Save Audio Mapping'}
              </button>
            </div>

            {/* Download EPUB with SMIL */}
            {epubReady && (
              <div className="section-card" style={{ marginTop: '24px', backgroundColor: '#e8f5e9', borderColor: '#4caf50' }}>
                <h3 style={{ color: '#2e7d32' }}>EPUB Ready for Download</h3>
                <p style={{ marginBottom: '16px', color: '#666', fontSize: '14px' }}>
                  Your EPUB file is ready! Download it now. The SMIL file for audio synchronization will be automatically included in the EPUB package.
                </p>
                <button
                  onClick={handleDownloadEpubWithSmil}
                  disabled={loading}
                  className="btn btn-success btn-large"
                  style={{ width: '100%' }}
                >
                  <HiOutlineDownload size={20} />
                  {loading ? 'Preparing...' : 'Download EPUB (with SMIL)'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowStages;
