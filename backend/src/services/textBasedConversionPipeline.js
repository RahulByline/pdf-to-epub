import { PdfAnalysisService } from './pdfAnalysisService.js';
import { TextExtractionService } from './textExtractionService.js';
import { DocumentStructureService } from './documentStructureService.js';
import { SemanticXhtmlGenerator } from './semanticXhtmlGenerator.js';
import { Epub3TextBasedGenerator } from './epub3TextBasedGenerator.js';
import { TtsService } from './TtsService.js';

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
      
      // Step 3.5: Detect pages to exclude using AI (if exclusion prompt is configured) and automatic TOC detection
      let detectedExcludedPages = [];

      // First, automatically detect table of contents pages
      const tocPages = this.detectTableOfContentsPages(structure.pages);
      if (tocPages.length > 0) {
        console.log(`[Pipeline ${jobId}] Automatically detected ${tocPages.length} table of contents page(s): ${tocPages.join(', ')}`);
        detectedExcludedPages.push(...tocPages);
      }

      try {
        const { TtsConfigService } = await import('./ttsConfigService.js');
        const ttsConfig = await TtsConfigService.getActiveConfiguration();
        if (ttsConfig && ttsConfig.exclusionPrompt && ttsConfig.exclusionPrompt.trim()) {
          console.log(`[Pipeline ${jobId}] Detecting additional pages to exclude based on AI prompt...`);
          const detectionResult = await TtsConfigService.detectExcludedPages(
            structure.pages,
            ttsConfig.exclusionPrompt,
            await import('./aiConfigService.js').then(m => m.AiConfigService.getActiveConfiguration())
          );
          const aiExcludedPages = detectionResult.excludedPages || [];
          detectedExcludedPages.push(...aiExcludedPages);
          
          if (detectedExcludedPages.length > 0) {
            console.log(`[Pipeline ${jobId}] AI detected ${detectedExcludedPages.length} page(s) to exclude: ${detectedExcludedPages.join(', ')}`);
            
            // Update page restrictions to include detected pages
            const currentExclude = ttsConfig.pageRestrictions?.exclude || '';
            const detectedExcludeList = detectedExcludedPages.join(', ');
            const updatedExclude = currentExclude 
              ? `${currentExclude}, ${detectedExcludeList}`
              : detectedExcludeList;
            
            // Update TTS config with detected pages (merge with existing exclusions)
            if (ttsConfig.id) {
              const updatedRestrictions = {
                ...(ttsConfig.pageRestrictions || {}),
                exclude: updatedExclude
              };
              
              // Note: We don't save this automatically - user should review
              // But we'll use it for this conversion
              ttsConfig.pageRestrictions = updatedRestrictions;
              console.log(`[Pipeline ${jobId}] Updated exclusion list: ${updatedExclude}`);
            }
          } else {
            console.log(`[Pipeline ${jobId}] No pages detected for exclusion`);
          }
        }
      } catch (detectionError) {
        console.warn(`[Pipeline ${jobId}] Page detection failed, continuing without exclusions:`, detectionError.message);
        // Continue without exclusions if detection fails
      }
      
      // Step 4: Generate TTS Audio (if requested)
      let audioFilePath = null;
      let audioMappings = [];
      
      if (options.generateAudio !== false) {
        console.log(`[Pipeline ${jobId}] Step 4: Generating TTS audio...`);
        
        // Filter out excluded pages before generating audio
        // Get TTS config once before filtering
        const { TtsConfigService: TtsConfigServiceCheck } = await import('./ttsConfigService.js');
        const ttsConfigCheck = await TtsConfigServiceCheck.getActiveConfiguration();
        
        const pagesForTTS = structure.pages.filter(page => {
          const pageNumber = page.pageNumber || 0;
          if (detectedExcludedPages.includes(pageNumber)) {
            console.log(`[Pipeline ${jobId}] Skipping TTS for page ${pageNumber} (detected as excluded)`);
            return false;
          }
          
          // Also check manual page restrictions
          if (ttsConfigCheck && ttsConfigCheck.pageRestrictions) {
            return TtsConfigServiceCheck.shouldProcessPage(pageNumber, ttsConfigCheck.pageRestrictions);
          }
          
          return true;
        });
        
        const audioResult = await this.generateAudioForText(pagesForTTS, outputDir, jobId);
        audioFilePath = audioResult.audioPath;
        audioMappings = audioResult.mappings;
        console.log(`[Pipeline ${jobId}] Generated audio: ${audioMappings.length} text blocks mapped (${structure.pages.length - pagesForTTS.length} pages excluded)`);
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
      
      // Pass chapter detection options to the generator
      const chapterOptions = {
        documentId: jobId,
        useAI: options.useAI !== false,
        respectPageNumbers: options.respectPageNumbers !== false,
        minChapterLength: options.minChapterLength || 1,
        maxChapters: options.maxChapters || 50
      };
      
      const epubPath = await epubGenerator.generate(
        structure.pages,
        audioFilePath,
        audioMappings,
        chapterOptions
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
  static async generateAudioForText(pages, outputDir, jobId) {
    const audioDir = path.join(outputDir, `audio_${jobId}`);
    await fs.mkdir(audioDir, { recursive: true });
    
    const audioChunks = [];
    const mappings = [];
    let totalDuration = 0;
    
    // Extract all text blocks with IDs
    const textBlocks = [];
    for (const page of pages) {
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
          voice: options?.voice || {}
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

  /**
   * Automatically detect table of contents pages based on common patterns
   * @param {Array} pages - Array of page objects with text content
   * @returns {Array<number>} Array of page numbers that appear to be table of contents
   */
  static detectTableOfContentsPages(pages) {
    const tocPages = [];
    const tocPatterns = [
      // Common TOC indicators (case insensitive)
      /table\s+of\s+contents/i,
      /contents\s+page/i,
      /chapter\s+\d+/i,
      /section\s+\d+/i,
      // Look for numbered lists like "1. Introduction", "2. Chapter 1", etc.
      // Multiple chapter references in a page
      /(chapter|section)\s+\d+.*(\n.*){2,}(chapter|section)\s+\d+/is,
      // Page numbers and titles pattern
      /\d+\s+[\w\s]+\.{3,}\d+$/m,
      // Typical TOC structure with dots and page numbers
      /[\w\s]+\.{3,}\d+/,
      // Multiple entries with consistent formatting
      /\d+\.\s+[\w\s]+(\n\d+\.\s+[\w\s]+){2,}/
    ];

    for (const page of pages) {
      const pageNumber = page.pageNumber || 0;
      let pageText = '';

      // Extract text from the page
      if (page.text) {
        pageText = page.text;
      } else if (page.textBlocks && Array.isArray(page.textBlocks)) {
        pageText = page.textBlocks.map(block => block.text || '').join(' ');
      }

      if (!pageText || pageText.trim().length < 50) {
        continue; // Skip pages with too little text
      }

      // Normalize text for pattern matching
      const normalizedText = pageText.toLowerCase().replace(/\s+/g, ' ');

      // Check if page matches TOC patterns
      let isTocPage = false;
      let matchCount = 0;

      for (const pattern of tocPatterns) {
        if (pattern.test(normalizedText)) {
          matchCount++;
        }
      }

      // If multiple patterns match, or specific strong patterns match, consider it TOC
      if (matchCount >= 2 ||
          /table\s+of\s+contents/i.test(normalizedText) ||
          /(chapter|section)\s+\d+.*(\n.*){3,}(chapter|section)\s+\d+/is.test(pageText)) {
        isTocPage = true;
      }

      // Additional heuristic: Check for high density of numbered entries
      const numberedLines = (pageText.match(/^\s*\d+\.?\s+/gm) || []).length;
      const totalLines = pageText.split('\n').length;

      if (totalLines > 5 && numberedLines / totalLines > 0.3) {
        isTocPage = true;
      }

      if (isTocPage) {
        tocPages.push(pageNumber);
        console.log(`[TOC Detection] Detected page ${pageNumber} as table of contents`);
      }
    }

    return tocPages;
  }
}

import fs from 'fs/promises';
import path from 'path';

