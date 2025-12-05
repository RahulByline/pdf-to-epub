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
        !syncData.pageNumber || syncData.startTime === undefined || 
        syncData.endTime === undefined || !syncData.audioFilePath) {
      throw new Error('Missing required fields for audio sync');
    }

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
    const aiConfig = await AiConfigurationModel.findActive();
    
    if (!aiConfig) {
      throw new Error('No active AI configuration found. Please configure AI settings first.');
    }

    // TODO: Implement actual TTS using AI configuration (Google Cloud TTS, AWS Polly, etc.)
    // For now, create a placeholder audio file
    
    await fs.mkdir(getTtsOutputDir(), { recursive: true }).catch(() => {});
    
    const audioFileName = `audio_${pdfId}_${chunkId}_${uuidv4()}.mp3`;
    const audioFilePath = path.join(getTtsOutputDir(), audioFileName);
    
    // Create placeholder audio file (in production, generate actual TTS audio)
    const placeholderContent = `Placeholder audio for: ${text.substring(0, 50)}...\nVoice: ${voice}`;
    await fs.writeFile(audioFilePath.replace('.mp3', '.txt'), placeholderContent);

    return {
      audioFilePath: audioFilePath.replace('.txt', '.mp3'),
      audioFileName,
      duration: Math.ceil(text.length / 10) // Estimate duration based on text length
    };
  }

  // Generate complete audio for all text chunks
  static async generateCompleteAudio(textChunks, voice, pdfId, jobId) {
    const audioSegments = [];
    let currentTime = 0;

    for (const chunk of textChunks) {
      try {
        const audio = await this.generateAudioForText(chunk.text, voice, pdfId, chunk.id);
        
        const audioSync = await AudioSyncModel.create({
          pdfDocumentId: pdfId,
          conversionJobId: jobId,
          pageNumber: chunk.pageNumber,
          blockId: `chunk_${chunk.id}`,
          startTime: currentTime,
          endTime: currentTime + audio.duration,
          audioFilePath: audio.audioFilePath,
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

