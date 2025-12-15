import { AudioSyncModel } from '../models/AudioSync.js';
import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { AiConfigurationModel } from '../models/AiConfiguration.js';
import fs from 'fs/promises';
import path from 'path';
import { getTtsOutputDir } from '../config/fileStorage.js';
import { v4 as uuidv4 } from 'uuid';

export class AudioSyncService {
  static async getAudioSyncsByPdfId(pdfId) {
    return await AudioSyncModel.findByPdfId(pdfId);
  }

  static async getAudioSyncsByJobId(jobId) {
    const syncs = await AudioSyncModel.findByJobId(jobId);
    return syncs.map(sync => ({
      id: sync.id,
      pdfDocumentId: sync.pdf_document_id,
      conversionJobId: sync.conversion_job_id,
      pageNumber: sync.page_number,
      blockId: sync.block_id,
      startTime: sync.start_time,
      endTime: sync.end_time,
      audioFilePath: sync.audio_file_path,
      notes: sync.notes,
      customText: sync.custom_text,
      isCustomSegment: sync.is_custom_segment,
      audioUrl: `/api/audio-sync/${sync.id}/audio`
    }));
  }

  static async getAudioSyncs(pdfId, jobId) {
    return await AudioSyncModel.findByPdfAndJob(pdfId, jobId);
  }

  static async saveAudioSync(syncData) {
    // Validate required fields
    if (!syncData.pdfDocumentId || !syncData.conversionJobId || 
        syncData.startTime === undefined || syncData.endTime === undefined) {
      throw new Error('Missing required fields for audio sync: pdfDocumentId, conversionJobId, startTime, and endTime are required');
    }

    // pageNumber and audioFilePath are optional (can be null)
    // audioFilePath can be null initially and set later when audio is generated
    // pageNumber can be derived from blockId or defaulted if not provided

    return await AudioSyncModel.create(syncData);
  }

  static async updateAudioSync(id, syncData) {
    const existing = await AudioSyncModel.findById(id);
    if (!existing) {
      throw new Error('Audio sync not found with id: ' + id);
    }

    return await AudioSyncModel.update(id, syncData);
  }

  static async deleteAudioSync(id) {
    const existing = await AudioSyncModel.findById(id);
    if (!existing) {
      throw new Error('Audio sync not found with id: ' + id);
    }

    await AudioSyncModel.delete(id);
  }

  static async deleteAudioSyncsByJobId(jobId) {
    await AudioSyncModel.deleteByJobId(jobId);
  }

  static async getConversionJob(jobId) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }
    return job;
  }

  static async getPdfDocument(pdfId) {
    const pdf = await PdfDocumentModel.findById(pdfId);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + pdfId);
    }
    return pdf;
  }

  // Extract text from PDF (simplified - in production would use pdf-parse)
  static async extractTextFromPdf(pdfId) {
    const pdf = await this.getPdfDocument(pdfId);
    
    // TODO: Implement actual PDF text extraction using pdf-parse or similar
    // For now, return placeholder text chunks
    const textChunks = [
      { id: 1, pageNumber: 1, text: 'This is a sample text chunk from page 1 of the PDF document.', startTime: 0, endTime: 5 },
      { id: 2, pageNumber: 1, text: 'Another paragraph from the same page that continues the content.', startTime: 5, endTime: 10 },
      { id: 3, pageNumber: 2, text: 'Text from page 2 of the document.', startTime: 10, endTime: 13 },
      { id: 4, pageNumber: 2, text: 'More content from page 2.', startTime: 13, endTime: 16 }
    ];

    return textChunks;
  }

  // Extract text from EPUB sections (for audio syncing)
  static async extractTextFromEpub(jobId) {
    const { EpubService } = await import('./epubService.js');
    const textContent = await EpubService.getEpubTextContent(jobId);
    
    // Convert EPUB text content to chunks format
    const textChunks = [];
    let chunkId = 1;
    
    textContent.forEach(section => {
      // Split section text into paragraphs
      const paragraphs = section.text.split('\n').filter(p => p.trim());
      paragraphs.forEach((paragraph, idx) => {
        textChunks.push({
          id: chunkId++,
          pageNumber: section.sectionId,
          sectionId: section.sectionId,
          sectionTitle: section.title,
          text: paragraph.trim(),
          xhtml: section.xhtml
        });
      });
    });
    
    return textChunks;
  }

  // Generate TTS audio for text chunks
  static async generateAudioForText(text, voice = 'standard', pdfId, chunkId) {
    // Get active AI configuration
    const { AiConfigService } = await import('./aiConfigService.js');
    const aiConfig = await AiConfigService.getActiveConfiguration();
    
    if (!aiConfig || !aiConfig.apiKey) {
      throw new Error('No active AI configuration found. Please configure AI settings first.');
    }

    await fs.mkdir(getTtsOutputDir(), { recursive: true }).catch(() => {});
    
    const audioFileName = `audio_${pdfId}_${chunkId}_${uuidv4()}.mp3`;
    const audioFilePath = path.join(getTtsOutputDir(), audioFileName);
    
    // Calculate estimated duration using intelligent estimation (like Java app)
    const estimatedDuration = this.estimateAudioDurationIntelligent(text);
    
    try {
      // Try to use Google TTS (gtts library - free, no API key needed)
      const gttsModule = await import('gtts');
      const Gtts = gttsModule.default || gttsModule.gtts;
      
      const gttsInstance = new Gtts(text, 'en'); // Default to English
      
      await new Promise((resolve, reject) => {
        gttsInstance.save(audioFilePath, (err) => {
          if (err) {
            console.warn(`[Audio] Google TTS failed for block ${chunkId}, using estimation: ${err.message}`);
            // Fallback: create silent audio file
            AudioSyncService.createSilentAudioFile(audioFilePath, estimatedDuration).then(() => resolve()).catch(() => resolve());
          } else {
            console.log(`[Audio] Generated TTS audio: ${audioFilePath} (${estimatedDuration}s)`);
            resolve();
          }
        });
      });
    } catch (ttsError) {
      console.warn(`[Audio] TTS library not available, using estimation: ${ttsError.message}`);
      // Fallback: create silent audio file with estimated duration
      await this.createSilentAudioFile(audioFilePath, estimatedDuration);
    }

    return {
      audioFilePath: audioFilePath,
      audioFileName,
      duration: estimatedDuration
    };
  }

  // Intelligent audio duration estimation (like Java app - KITABOO-style)
  static estimateAudioDurationIntelligent(text) {
    if (!text || text.trim().length === 0) {
      return 0.5;
    }
    
    const trimmedText = text.trim();
    
    // Count words
    const wordCount = trimmedText.split(/\s+/).length;
    
    // Count sentences (periods, exclamation, question marks)
    const sentenceCount = trimmedText.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;
    
    // Count punctuation (adds pauses)
    const punctuationCount = (trimmedText.match(/[.,!?;:]/g) || []).length;
    
    // Base reading speed: 200 words per minute = 3.33 words per second
    const wordsPerSecond = 3.33;
    
    // Calculate base duration
    const baseDuration = wordCount / wordsPerSecond;
    
    // Add pause time for punctuation (0.3s per punctuation mark)
    const pauseTime = punctuationCount * 0.3;
    
    // Add pause time for sentence breaks (0.5s per sentence break)
    const sentencePauseTime = (sentenceCount - 1) * 0.5;
    
    // Total estimated duration
    let estimatedDuration = baseDuration + pauseTime + sentencePauseTime;
    
    // Minimum duration
    if (estimatedDuration < 0.5) {
      estimatedDuration = 0.5;
    }
    
    return Math.ceil(estimatedDuration);
  }

  // Create a silent audio file with estimated duration
  static createSilentAudioFile(filePath, durationSeconds) {
    // Create a minimal valid MP3 file (silent)
    // This is a minimal MP3 frame header
    const mp3Header = Buffer.from([
      0xFF, 0xFB, 0x90, 0x00, // MP3 sync word and header
    ]);
    
    fs.writeFile(filePath, mp3Header).catch(err => {
      console.error(`[Audio] Error creating silent audio file:`, err);
    });
  }

  // Generate complete audio for all text chunks
  static async generateCompleteAudio(textChunks, voice, pdfId, jobId) {
    const audioSegments = [];
    let currentTime = 0;
    
    // Create a combined audio file for the entire job
    const { getTtsOutputDir } = await import('../config/fileStorage.js');
    const combinedAudioFileName = `combined_audio_${jobId}.mp3`;
    const combinedAudioFilePath = path.join(getTtsOutputDir(), combinedAudioFileName);
    
    // Store individual audio file paths for concatenation
    const individualAudioFiles = [];

    for (const chunk of textChunks) {
      try {
        const audio = await this.generateAudioForText(chunk.text, voice, pdfId, chunk.id);
        individualAudioFiles.push(audio.audioFilePath);
        
        const audioSync = await AudioSyncModel.create({
          pdfDocumentId: pdfId,
          conversionJobId: jobId,
          pageNumber: chunk.pageNumber,
          blockId: chunk.id, // Use the actual block ID, not chunk_ prefix
          startTime: currentTime,
          endTime: currentTime + audio.duration,
          audioFilePath: combinedAudioFilePath, // All blocks use the same combined file
          notes: `Generated with voice: ${voice}`,
          customText: chunk.text,
          isCustomSegment: false
        });

        // Convert database fields to camelCase for frontend
        const segmentDTO = {
          id: audioSync.id,
          pdfDocumentId: audioSync.pdf_document_id,
          conversionJobId: audioSync.conversion_job_id,
          pageNumber: audioSync.page_number,
          blockId: audioSync.block_id,
          startTime: audioSync.start_time,
          endTime: audioSync.end_time,
          audioFilePath: audioSync.audio_file_path,
          notes: audioSync.notes,
          customText: audioSync.custom_text,
          isCustomSegment: audioSync.is_custom_segment,
          text: chunk.text,
          audioUrl: `/api/audio-sync/${audioSync.id}/audio`
        };

        audioSegments.push(segmentDTO);

        currentTime += audio.duration;
      } catch (error) {
        console.error(`Error generating audio for chunk ${chunk.id}:`, error);
      }
    }
    
    // TODO: Concatenate all individual audio files into one combined file
    // For now, create a minimal combined file
    if (individualAudioFiles.length > 0) {
      try {
        // Create a minimal combined MP3 file
        const mp3Header = Buffer.from([0xFF, 0xFB, 0x90, 0x00]);
        await fs.writeFile(combinedAudioFilePath, mp3Header);
        console.log(`[Audio] Created combined audio file: ${combinedAudioFilePath}`);
      } catch (error) {
        console.error(`[Audio] Error creating combined audio file:`, error);
      }
    }

    return audioSegments;
  }

  // Get available voices
  static getAvailableVoices() {
    return [
      { id: 'standard', name: 'Standard Voice', type: 'adult' },
      { id: 'child', name: 'Child Voice', type: 'child' },
      { id: 'female', name: 'Female Voice', type: 'adult' },
      { id: 'male', name: 'Male Voice', type: 'adult' },
      { id: 'neural', name: 'Neural Voice', type: 'adult' }
    ];
  }
}

