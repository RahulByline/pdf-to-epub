import fs from 'fs/promises';
import path from 'path';
import { PdfAnalysisService } from './pdfAnalysisService.js';
import { TextExtractionService } from './textExtractionService.js';
import { DocumentStructureService } from './documentStructureService.js';
import { SemanticXhtmlGenerator } from './semanticXhtmlGenerator.js';
import { Epub3TextBasedGenerator } from './epub3TextBasedGenerator.js';
import { TtsService } from './TtsService.js';
import { PageFilter } from '../utils/pageFilter.js';

/**
 * Text-Based Conversion Pipeline
 * Complete pipeline for converting PDF to EPUB3 with real text (not images)
 */
export class TextBasedConversionPipeline {
  /**
   * Convert PDF to EPUB3 with text-based approach
   * @param {string} pdfFilePath - Path to PDF file
   * @param {string} outputDir - Output directory
   * @param {string} jobId - Job ID
   * @param {Object} options - Conversion options
   * @returns {Promise<{epubPath: string, metadata: Object}>}
   */
  static async convert(pdfFilePath, outputDir, jobId, options = {}) {
    try {
      console.log(`[Pipeline ${jobId}] Starting text-based PDF to EPUB3 conversion...`);
      
      // Step 1: Analyze PDF
      console.log(`[Pipeline ${jobId}] Step 1: Analyzing PDF...`);
      const analysis = await PdfAnalysisService.analyzePdf(pdfFilePath);
      console.log(`[Pipeline ${jobId}] PDF Analysis: ${analysis.isTextBased ? 'Text-based' : 'Scanned'} (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`);
      
      // Step 2: Extract Text
      console.log(`[Pipeline ${jobId}] Step 2: Extracting text...`);
      const textData = await TextExtractionService.extractText(
        pdfFilePath,
        analysis.isTextBased,
        {
          lang: options.ocrLang || 'eng',
          dpi: options.ocrDpi || 300,
          psm: options.ocrPsm || 6
        }
      );
      console.log(`[Pipeline ${jobId}] Extracted text from ${textData.totalPages} pages`);
      
      // Step 3: Analyze Document Structure
      console.log(`[Pipeline ${jobId}] Step 3: Analyzing document structure...`);
      const structure = await DocumentStructureService.analyzeStructure(
        textData.pages,
        { useAI: options.useAI !== false }
      );
      console.log(`[Pipeline ${jobId}] Structure analysis complete (method: ${structure.method})`);
      
      // Add PDF file path to pages for image extraction
      structure.pages = structure.pages.map(page => ({
        ...page,
        pdfFilePath: pdfFilePath
      }));
      
      // Step 4: Generate TTS Audio (if requested)
      let audioFilePath = null;
      let audioMappings = [];
      
      if (options.generateAudio !== false) {
        console.log(`[Pipeline ${jobId}] Step 4: Generating TTS audio...`);
        
        // Filter out TOC and Index pages before generating audio
        const filteredPages = PageFilter.filterPages(structure.pages);
        const skippedPages = structure.pages.length - filteredPages.length;
        if (skippedPages > 0) {
          console.log(`[Pipeline ${jobId}] Skipping ${skippedPages} page(s) (TOC/Index) for TTS generation`);
        }
        
        const audioResult = await this.generateAudioForText(filteredPages, outputDir, jobId, options);
        audioFilePath = audioResult.audioPath;
        audioMappings = audioResult.mappings;
        console.log(`[Pipeline ${jobId}] Generated audio: ${audioMappings.length} text blocks mapped`);
      }
      
      // Step 5: Generate EPUB3
      console.log(`[Pipeline ${jobId}] Step 5: Generating EPUB3 package...`);
      const epubGenerator = new Epub3TextBasedGenerator(outputDir, jobId);
      
      // Set metadata
      epubGenerator.setMetadata({
        title: structure.structure?.title || textData.metadata?.title || 'Converted Document',
        author: textData.metadata?.author || 'Unknown',
        language: textData.metadata?.language || 'en'
      });
      
      const epubPath = await epubGenerator.generate(
        structure.pages,
        audioFilePath,
        audioMappings
      );
      
      console.log(`[Pipeline ${jobId}] EPUB3 generated successfully: ${epubPath}`);
      
      return {
        epubPath,
        metadata: {
          title: epubGenerator.metadata.title,
          author: epubGenerator.metadata.author,
          pages: textData.totalPages,
          textBased: analysis.isTextBased,
          hasAudio: !!audioFilePath,
          audioMappings: audioMappings.length
        }
      };
    } catch (error) {
      console.error(`[Pipeline ${jobId}] Conversion failed:`, error);
      throw error;
    }
  }
  
  /**
   * Generate TTS audio for all text blocks
   */
  static async generateAudioForText(pages, outputDir, jobId, options = {}) {
    const audioDir = path.join(outputDir, `audio_${jobId}`);
    await fs.mkdir(audioDir, { recursive: true });
    
    const audioChunks = [];
    const mappings = [];
    let totalDuration = 0;
    
    // Extract all text blocks with IDs (pages are already filtered)
    const textBlocks = [];
    for (const page of pages) {
      // Double-check: skip TOC and Index pages
      if (PageFilter.shouldSkipPage(page)) {
        console.log(`[Pipeline] Skipping page ${page.pageNumber || 'unknown'} (TOC/Index)`);
        continue;
      }
      
      if (!page.textBlocks) continue;
      
      for (const block of page.textBlocks) {
        if (!block.text || !block.text.trim()) continue;
        
        // Generate ID if not present
        const blockId = block.id || this.generateBlockId(block, textBlocks.length);
        textBlocks.push({
          id: blockId,
          text: block.text.trim(),
          type: block.type || 'paragraph',
          href: block.href || null
        });
      }
    }
    
    // Generate audio for each block
    for (let i = 0; i < textBlocks.length; i++) {
      const block = textBlocks[i];
      
      try {
        const chunkPath = path.join(audioDir, `${block.id}.mp3`);
        const ttsResult = await TtsService.synthesizePageAudio({
          text: block.text,
          audioOutPath: chunkPath,
          voice: {
            ...(options?.voice || {}),
            speakingRate: 1.3 // 30% faster speech (range: 0.25 to 4.0)
          }
        });
        
        if (ttsResult.audioFilePath && ttsResult.timings) {
          const startTime = totalDuration;
          const duration = ttsResult.timings.length > 0
            ? ttsResult.timings[ttsResult.timings.length - 1].endTimeSec + 0.1
            : 1.0;
          const endTime = startTime + duration;
          
          mappings.push({
            textId: block.id,
            href: block.href,
            start: this.formatSMILTime(startTime),
            end: this.formatSMILTime(endTime)
          });
          
          audioChunks.push({
            path: chunkPath,
            startTime,
            duration
          });
          
          totalDuration = endTime;
        }
      } catch (error) {
        console.warn(`[Pipeline] Error generating audio for block ${block.id}:`, error.message);
      }
    }
    
    // Combine audio chunks
    const combinedAudioPath = await this.combineAudioChunks(audioChunks, audioDir, jobId);
    
    return {
      audioPath: combinedAudioPath,
      mappings
    };
  }
  
  /**
   * Generate block ID
   */
  static generateBlockId(block, index) {
    const type = block.type || 'paragraph';
    const prefix = type === 'heading1' ? 'h1' :
                   type === 'heading2' ? 'h2' :
                   type === 'heading3' ? 'h3' :
                   type === 'title' ? 'title' :
                   'p';
    return `${prefix}_${index + 1}`;
  }
  
  /**
   * Format time to SMIL format
   */
  static formatSMILTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const sInt = Math.floor(s);
    const sDec = Math.round((s - sInt) * 1000);
    return `${h}:${m.toString().padStart(2, '0')}:${sInt.toString().padStart(2, '0')}.${sDec.toString().padStart(3, '0')}`;
  }
  
  /**
   * Combine audio chunks into single file
   */
  static async combineAudioChunks(chunks, outputDir, jobId) {
    const outputPath = path.join(outputDir, `${jobId}_combined.mp3`);
    
    try {
      const fluentFfmpeg = await import('fluent-ffmpeg');
      const ffmpeg = fluentFfmpeg.default;
      const ffmpegStatic = await import('ffmpeg-static');
      
      if (ffmpegStatic.default) {
        ffmpeg.setFfmpegPath(ffmpegStatic.default);
      }
      
      const concatListPath = path.join(outputDir, 'concat_list.txt');
      const concatListContent = chunks.map(chunk => 
        `file '${chunk.path.replace(/'/g, "'\\''")}'`
      ).join('\n');
      await fs.writeFile(concatListPath, concatListContent, 'utf-8');
      
      return new Promise((resolve, reject) => {
        ffmpeg(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(outputPath)
          .on('end', async () => {
            await fs.unlink(concatListPath).catch(() => {});
            for (const chunk of chunks) {
              await fs.unlink(chunk.path).catch(() => {});
            }
            resolve(outputPath);
          })
          .on('error', reject)
          .run();
      });
    } catch (error) {
      console.warn('[Pipeline] FFmpeg combination failed, using fallback:', error.message);
      // Fallback: simple concatenation
      const buffers = await Promise.all(chunks.map(c => fs.readFile(c.path)));
      const combined = Buffer.concat(buffers);
      await fs.writeFile(outputPath, combined);
      return outputPath;
    }
  }
}

