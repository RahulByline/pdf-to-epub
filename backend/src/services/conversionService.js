import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import { getEpubOutputDir, getHtmlIntermediateDir } from '../config/fileStorage.js';
import { PdfExtractionService } from './pdfExtractionService.js';
import { GeminiService } from './geminiService.js';
import { JobConcurrencyService } from './jobConcurrencyService.js';
// TtsService and mapTimingsToBlocks removed - using player's built-in TTS instead of generating audio files

export class ConversionService {
  static async startConversion(pdfDocumentId) {
    const pdf = await PdfDocumentModel.findById(pdfDocumentId);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + pdfDocumentId);
    }

    const job = await ConversionJobModel.create({
      pdfDocumentId,
      status: 'PENDING',
      currentStep: 'STEP_0_CLASSIFICATION',
      progressPercentage: 0
    });

    this.processConversion(job.id).catch(error => {
      console.error('Conversion error:', error);
      ConversionJobModel.update(job.id, {
        status: 'FAILED',
        errorMessage: error.message
      });
    });

    return this.convertToDTO(job);
  }

  static async processConversion(jobId) {
    await JobConcurrencyService.acquire(jobId);
    
    try {
      const job = await ConversionJobModel.findById(jobId);
      if (!job) {
        throw new Error('Conversion job not found');
      }

      const pdf = await PdfDocumentModel.findById(job.pdf_document_id);
      if (!pdf || !pdf.file_path) {
        throw new Error('PDF document not found or file path missing');
      }

      let pdfFilePath = pdf.file_path;
      try {
        await fs.access(pdfFilePath);
      } catch (accessError) {
        const { getUploadDir } = await import('../config/fileStorage.js');
        const uploadDir = getUploadDir();
        const fileName = path.basename(pdfFilePath);
        const resolvedPath = path.join(uploadDir, fileName);
        try {
          await fs.access(resolvedPath);
          pdfFilePath = resolvedPath;
          console.log(`[Job ${jobId}] Resolved PDF path: ${pdfFilePath}`);
        } catch (resolvedError) {
          throw new Error(`PDF file not found at ${pdf.file_path} or ${resolvedPath}`);
        }
      }

      const steps = [
        { step: 'STEP_0_CLASSIFICATION', progress: 5 },
        { step: 'STEP_1_TEXT_EXTRACTION', progress: 15 },
        { step: 'STEP_2_LAYOUT_ANALYSIS', progress: 30 },
        { step: 'STEP_3_SEMANTIC_STRUCTURING', progress: 45 },
        { step: 'STEP_4_ACCESSIBILITY', progress: 60 },
        { step: 'STEP_5_CONTENT_CLEANUP', progress: 75 },
        { step: 'STEP_6_SPECIAL_CONTENT', progress: 85 },
        { step: 'STEP_7_EPUB_GENERATION', progress: 95 },
        { step: 'STEP_8_QA_REVIEW', progress: 100 }
      ];

      await ConversionJobModel.update(jobId, {
        status: 'IN_PROGRESS',
        currentStep: steps[0].step,
        progressPercentage: steps[0].progress
      });

      await ConversionJobModel.update(jobId, {
        currentStep: steps[1].step,
        progressPercentage: steps[1].progress
      });

      console.log(`[Job ${jobId}] Extracting text from PDF: ${pdfFilePath}`);

      let textData = null;
      const useGeminiExtraction = (process.env.GEMINI_TEXT_EXTRACTION || '').toLowerCase() === 'true';
      if (useGeminiExtraction) {
        try {
          textData = await GeminiService.extractTextFromPdf(pdfFilePath);
          if (textData) {
            console.log(`[Job ${jobId}] Extracted text via Gemini (${textData.totalPages} pages)`);
          }
        } catch (aiError) {
          console.warn(`[Job ${jobId}] Gemini extraction failed, trying next method: ${aiError.message}`);
          textData = null;
        }
      }

      if (!textData) {
        const useOcrExtraction = (process.env.USE_OCR_EXTRACTION || '').toLowerCase() === 'true';
        if (useOcrExtraction) {
          try {
            const { OcrService } = await import('./ocrService.js');
            const ocrLang = process.env.OCR_LANGUAGE || 'eng';
            textData = await OcrService.extractTextFromPdf(pdfFilePath, {
              lang: ocrLang,
              psm: parseInt(process.env.OCR_PSM || '6'),
              dpi: parseInt(process.env.OCR_DPI || '300')
            });
            if (textData) {
              console.log(`[Job ${jobId}] Extracted text via Tesseract OCR (${textData.totalPages} pages, avg confidence: ${textData.metadata.averageConfidence?.toFixed(1)}%)`);
            }
          } catch (ocrError) {
            console.warn(`[Job ${jobId}] OCR extraction failed, falling back to pdfjs-dist: ${ocrError.message}`);
            textData = null;
          }
        }
      }

      if (!textData) {
        textData = await PdfExtractionService.extractText(pdfFilePath);
        console.log(`[Job ${jobId}] Extracted text via pdfjs-dist (${textData.totalPages} pages)`);
      }

      await ConversionJobModel.update(jobId, {
        currentStep: steps[2].step,
        progressPercentage: steps[2].progress
      });

      let structuredContent;
      try {
        structuredContent = await GeminiService.structureContent(textData.pages);
        console.log(`[Job ${jobId}] Content structured using Gemini`);
      } catch (error) {
        if (error.message?.includes('QUOTA_EXHAUSTED')) {
          console.warn(`[Job ${jobId}] Gemini quota exhausted (daily limit reached). Continuing without AI structuring.`);
        } else {
          console.warn(`[Job ${jobId}] Gemini structuring failed, using default structure:`, error.message);
        }
        structuredContent = { pages: textData.pages, structured: null };
      }

      for (const page of textData.pages) {
        if (!page || !page.text || page.text.trim().length === 0) continue;
        const hasBlocks = Array.isArray(page.textBlocks) && page.textBlocks.length > 0;
        if (hasBlocks) continue;
        
        const blockTimeout = 65000;
        const blockTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Text block creation timeout after 65s')), blockTimeout)
        );
        
        try {
          const pageWidth = page.width || textData.metadata?.width || 612;
          const pageHeight = page.height || textData.metadata?.height || 792;
          const blocksPromise = GeminiService.createTextBlocksFromText(
            page.text,
            page.pageNumber,
            pageWidth,
            pageHeight
          );
          
          const blocks = await Promise.race([blocksPromise, blockTimeoutPromise]);
          page.textBlocks = blocks;
          console.log(`[Job ${jobId}] Created ${blocks.length} AI text blocks for page ${page.pageNumber}`);
        } catch (blockErr) {
          if (blockErr.message.includes('timeout')) {
            console.warn(`[Page ${page.pageNumber}] Text block creation timed out, using simple blocks`);
            const pageWidth = page.width || textData.metadata?.width || 612;
            const pageHeight = page.height || textData.metadata?.height || 792;
            page.textBlocks = GeminiService.createSimpleTextBlocks(
              page.text,
              page.pageNumber,
              pageWidth,
              pageHeight
            );
            console.log(`[Job ${jobId}] Created ${page.textBlocks.length} simple text blocks for page ${page.pageNumber} (timeout fallback)`);
          } else {
            console.warn(`[Job ${jobId}] Could not create AI text blocks for page ${page.pageNumber}: ${blockErr.message}`);
          }
        }
      }

      await ConversionJobModel.update(jobId, {
        currentStep: steps[4].step,
        progressPercentage: steps[4].progress
      });

      await ConversionJobModel.update(jobId, {
        currentStep: steps[5].step,
        progressPercentage: steps[5].progress
      });

      const htmlIntermediateDir = getHtmlIntermediateDir();
      const jobImagesDir = path.join(htmlIntermediateDir, `job_${jobId}`);
      await fs.mkdir(jobImagesDir, { recursive: true }).catch(() => {});

      console.log(`[Job ${jobId}] Rendering PDF pages as images (fixed-layout)...`);
      const pageImagesData = await PdfExtractionService.renderPagesAsImages(pdfFilePath, jobImagesDir);
      console.log(`[Job ${jobId}] Rendered ${pageImagesData.images.length} page images`);

      const useVisionExtraction = (process.env.GEMINI_VISION_EXTRACTION || 'true').toLowerCase() === 'true';
      if (useVisionExtraction && pageImagesData.images.length > 0) {
        await ConversionJobModel.update(jobId, {
          currentStep: 'STEP_6_VISION_EXTRACTION',
          progressPercentage: 70
        });

        console.log(`[Job ${jobId}] Extracting text from rendered images using AI Vision API (${pageImagesData.images.length} pages)...`);
        const visionExtractedPages = [];
        const totalPages = pageImagesData.images.length;
        
        for (let i = 0; i < pageImagesData.images.length; i++) {
          const image = pageImagesData.images[i];
          const pageNumber = i + 1;
          
          const progress = 70 + Math.floor((i / totalPages) * 15);
          await ConversionJobModel.update(jobId, {
            currentStep: 'STEP_6_VISION_EXTRACTION',
            progressPercentage: progress
          }).catch(() => {});
          
          console.log(`[Job ${jobId}] Processing page ${pageNumber}/${totalPages}...`);
          
          try {
            const extractionTimeout = 65000;
            const extractionPromise = GeminiService.extractTextFromImage(image.path, pageNumber);
            const extractionTimeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Extraction timeout after 65s')), extractionTimeout)
            );
            
            const extractedText = await Promise.race([extractionPromise, extractionTimeoutPromise]);
            
            if (extractedText) {
              const correctionTimeout = 30000;
              const correctionPromise = GeminiService.correctExtractedText(extractedText, pageNumber);
              const correctionTimeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Correction timeout after 30s')), correctionTimeout)
              );
              
              let correctedText;
              try {
                correctedText = await Promise.race([correctionPromise, correctionTimeoutPromise]);
              } catch (correctionError) {
                console.warn(`[Job ${jobId}] Page ${pageNumber}: Text correction failed, using extracted text:`, correctionError.message);
                correctedText = extractedText;
              }
              
              console.log(`[Job ${jobId}] Creating structured text blocks for page ${pageNumber} using AI...`);
              let textBlocks = [];
              try {
                const pageWidth = image.width || 612;
                const pageHeight = image.height || 792;
                textBlocks = await GeminiService.createTextBlocksFromText(
                  correctedText,
                  pageNumber,
                  pageWidth,
                  pageHeight
                );
                console.log(`[Job ${jobId}] ✓ Page ${pageNumber}: AI created ${textBlocks.length} text blocks`);
              } catch (blockError) {
                console.warn(`[Job ${jobId}] Page ${pageNumber}: Failed to create text blocks with AI:`, blockError.message);
              }
              
              visionExtractedPages.push({
                pageNumber,
                text: correctedText,
                textBlocks: textBlocks,
                charCount: correctedText.length,
                width: image.width || 612,
                height: image.height || 792
              });
              
              console.log(`[Job ${jobId}] ✓ Page ${pageNumber}/${totalPages}: Extracted and corrected ${correctedText.length} characters, created ${textBlocks.length} text blocks`);
            } else {
              console.warn(`[Job ${jobId}] Page ${pageNumber}: Vision extraction returned no text, using original`);
              const originalPage = textData.pages.find(p => p.pageNumber === pageNumber);
              if (originalPage) {
                visionExtractedPages.push(originalPage);
              }
            }
          } catch (error) {
            console.warn(`[Job ${jobId}] Page ${pageNumber}: Vision extraction failed (${error.message}), using original text`);
            const originalPage = textData.pages.find(p => p.pageNumber === pageNumber);
            if (originalPage) {
              visionExtractedPages.push(originalPage);
            }
          }
        }

        if (visionExtractedPages.length > 0) {
          textData.pages = visionExtractedPages;
          textData.totalPages = visionExtractedPages.length;
          console.log(`[Job ${jobId}] Extracted text from ${visionExtractedPages.length} pages using AI Vision API`);
        }
      }

      await ConversionJobModel.update(jobId, {
        currentStep: steps[6].step,
        progressPercentage: steps[6].progress
      });

      const epubOutputDir = getEpubOutputDir();
      const jobDir = path.join(epubOutputDir, `job_${jobId}`);
      await fs.mkdir(jobDir, { recursive: true }).catch(() => {});
      
      // Create assets directories
      const assetsDir = path.join(jobDir, 'assets');
      const imagesDir = path.join(assetsDir, 'images');
      const audioDir = path.join(assetsDir, 'audio');
      await fs.mkdir(imagesDir, { recursive: true }).catch(() => {});
      await fs.mkdir(audioDir, { recursive: true }).catch(() => {});
      
      // Save textData to JSON file for API access
      const textDataPath = path.join(jobDir, `text_data_${jobId}.json`);
      try {
        await fs.writeFile(textDataPath, JSON.stringify(textData, null, 2), 'utf8');
        console.log(`[Job ${jobId}] Saved text data to ${textDataPath}`);
      } catch (saveError) {
        console.warn(`[Job ${jobId}] Could not save text data:`, saveError.message);
      }

      const epubFileName = `converted_${jobId}.epub`;
      const epubFilePath = path.join(epubOutputDir, epubFileName);

      await fs.mkdir(epubOutputDir, { recursive: true }).catch(() => {});

      console.log(`[Job ${jobId}] Generating EPUB file (fixed-layout, one page per file)...`);
      const epubBuffer = await this.generateFixedLayoutEpub(
        jobId,
        textData,
        structuredContent,
        pageImagesData,
        pdf.original_file_name || `Document ${jobId}`,
        pdfFilePath
      );

      try {
        const { EpubValidator } = await import('../utils/epubValidator.js');
        const validation = await EpubValidator.validate(epubBuffer);
        if (!validation.valid) {
          console.warn(`[Job ${jobId}] ⚠️ EPUB validation errors:`, validation.errors);
        }
        if (validation.warnings.length > 0) {
          console.warn(`[Job ${jobId}] ⚠️ EPUB validation warnings:`, validation.warnings);
        }
        if (validation.valid) {
          console.log(`[Job ${jobId}] ✓ EPUB validation passed: ${validation.stats.totalFiles} files, ${validation.stats.xhtmlFiles} pages, ${validation.stats.imageFiles} images`);
        }
      } catch (validationError) {
        console.warn(`[Job ${jobId}] Could not validate EPUB:`, validationError.message);
      }

      await fs.writeFile(epubFilePath, epubBuffer);
      console.log(`[Job ${jobId}] EPUB file generated: ${epubFilePath} (${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

      await ConversionJobModel.update(jobId, {
        status: 'COMPLETED',
        currentStep: steps[8].step,
        progressPercentage: steps[8].progress,
        epubFilePath,
        completedAt: new Date()
      });

      try {
        await fs.rm(jobImagesDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(`[Job ${jobId}] Could not cleanup temp images directory:`, cleanupError.message);
      }

    } catch (error) {
      console.error(`[Job ${jobId}] Conversion error:`, error);
      await ConversionJobModel.update(jobId, {
        status: 'FAILED',
        errorMessage: error.message
      });
      throw error;
    } finally {
      JobConcurrencyService.release(jobId);
    }
  }

  /**
   * Generate stable block ID based on content and position
   */
  static generateStableBlockId(text, x, y, pageNumber) {
    const content = `${pageNumber}_${text}_${x.toFixed(2)}_${y.toFixed(2)}`;
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return `block_${hash.substring(0, 12)}`;
  }

  /**
   * Migrate sync data to use stable block IDs
   */
  static migrateSyncsToStableIds(textBlocks, syncData) {
    // Create mapping from old IDs to stable IDs
    const idMapping = {};
    textBlocks.forEach(block => {
      const bbox = block.boundingBox || {};
      const stableId = this.generateStableBlockId(
        block.text || '',
        bbox.x || 0,
        bbox.y || 0,
        block.pageNumber || 0
      );
      idMapping[block.id] = stableId;
      block.id = stableId; // Update block ID
    });

    // Update sync data with new IDs
    return syncData.map(sync => ({
      ...sync,
      id: idMapping[sync.id] || sync.id
    }));
  }

  static async regenerateEpub(jobId) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found');
    }

    if (job.status !== 'COMPLETED') {
      throw new Error('Can only regenerate EPUB for completed conversions');
    }

    const pdf = await PdfDocumentModel.findById(job.pdf_document_id);
    if (!pdf || !pdf.file_path) {
      throw new Error('PDF document not found or file path missing');
    }

    // Load existing text data and page images
    const epubOutputDir = getEpubOutputDir();
    const jobDir = path.join(epubOutputDir, `job_${jobId}`);
    const textDataPath = path.join(jobDir, `text_data_${jobId}.json`);
    
    let textData, pageImagesData;
    try {
      const textDataContent = await fs.readFile(textDataPath, 'utf8');
      textData = JSON.parse(textDataContent);
    } catch (error) {
      throw new Error('Text data not found. Cannot regenerate EPUB without original text data.');
    }

    // Migrate block IDs to stable IDs and update sync files
    for (const page of textData.pages || []) {
      if (page.textBlocks) {
        page.textBlocks.forEach(block => {
          const bbox = block.boundingBox || {};
          if (!block.id || !block.id.startsWith('block_')) {
            block.id = this.generateStableBlockId(
              block.text || '',
              bbox.x || 0,
              bbox.y || 0,
              page.pageNumber || 0
            );
          }
        });
      }

      // Migrate sync files for this page
      const editorialSyncDir = path.join(jobDir, 'editorial_syncs');
      const syncFilePath = path.join(editorialSyncDir, `manual_page_syncs_${page.pageNumber}.json`);
      try {
        const syncContent = await fs.readFile(syncFilePath, 'utf8');
        const syncData = JSON.parse(syncContent);
        const migratedSyncs = this.migrateSyncsToStableIds(page.textBlocks || [], syncData);
        await fs.writeFile(syncFilePath, JSON.stringify(migratedSyncs, null, 2), 'utf8');
      } catch (error) {
        // No sync file for this page - that's OK
      }
    }

    // Load page images from assets directory
    const imagesDir = path.join(jobDir, 'assets', 'images');
    const imageFiles = await fs.readdir(imagesDir).catch(() => []);
    const pageImages = imageFiles
      .filter(f => f.startsWith('page_') && f.endsWith('_render.png'))
      .map(fileName => {
        const pageNum = parseInt(fileName.match(/page_(\d+)_render\.png/)?.[1] || '0');
        return {
          pageNumber: pageNum,
          path: path.join(imagesDir, fileName),
          fileName: fileName,
          width: 0,
          height: 0
        };
      })
      .sort((a, b) => a.pageNumber - b.pageNumber);

    pageImagesData = {
      images: pageImages,
      renderedWidth: 0,
      renderedHeight: 0,
      maxWidth: textData.metadata?.width || 612,
      maxHeight: textData.metadata?.height || 792
    };

    // Get structured content (if available)
    let structuredContent = null;
    try {
      structuredContent = await GeminiService.structureContent(textData.pages);
    } catch (error) {
      console.warn(`[Job ${jobId}] Could not regenerate structured content, using original`);
      structuredContent = { pages: textData.pages, structured: null };
    }

    // Regenerate EPUB with updated sync files
    const epubFileName = `converted_${jobId}.epub`;
    const epubFilePath = path.join(epubOutputDir, epubFileName);
    
    await ConversionJobModel.update(jobId, {
      status: 'IN_PROGRESS',
      currentStep: 'STEP_7_EPUB_GENERATION',
      progressPercentage: 95
    });

    const epubBuffer = await this.generateFixedLayoutEpub(
      jobId,
      textData,
      structuredContent,
      pageImagesData,
      pdf.original_file_name || `Document ${jobId}`,
      pdf.file_path
    );

    await fs.writeFile(epubFilePath, epubBuffer);
    console.log(`[Job ${jobId}] EPUB regenerated: ${epubFilePath} (${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    await ConversionJobModel.update(jobId, {
      status: 'COMPLETED',
      currentStep: 'STEP_8_QA_REVIEW',
      progressPercentage: 100,
      epubFilePath,
      completedAt: new Date()
    });

    return {
      jobId,
      epubFilePath,
      message: 'EPUB regenerated successfully with updated sync files'
    };
  }

  static async generateFixedLayoutEpub(jobId, textData, structuredContent, pageImagesData, documentTitle, pdfFilePath = null) {
    const { AudioSyncModel } = await import('../models/AudioSync.js');
    const audioSyncs = await AudioSyncModel.findByJobId(jobId).catch(() => []);
    let hasAudio = audioSyncs && audioSyncs.length > 0;
    
    const epubOutputDir = getEpubOutputDir();
    const jobDir = path.join(epubOutputDir, `job_${jobId}`);
    const imagesDir = path.join(jobDir, 'assets', 'images');
    // Ensure images directory exists
    await fs.mkdir(imagesDir, { recursive: true }).catch(() => {});
    const zip = new JSZip();
    
    const mimetypeContent = 'application/epub+zip';
    zip.file('mimetype', mimetypeContent, { 
      compression: 'STORE'
    });
    
    const mimetypeFile = zip.files['mimetype'];
    if (mimetypeFile) {
      if (!mimetypeFile.options) {
        mimetypeFile.options = {};
      }
      mimetypeFile.options.compression = 'STORE';
      mimetypeFile.options.compressionOptions = null;
    }
    
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    zip.file('META-INF/container.xml', containerXml);
    
    const docTitle = this.escapeHtml(
      structuredContent?.structured?.title || 
      textData.metadata?.title || 
      documentTitle || 
      `Converted Document ${jobId}`
    );
    
    // Normalize and sort page images by pageNumber to keep alignment with PDF order
    const pageImages = (pageImagesData.images || [])
      .filter(img => img && (img.pageNumber || img.pdfPageNumber))
      .map(img => ({
        ...img,
        pageNumber: img.pageNumber || img.pdfPageNumber || 0,
        pdfPageNumber: img.pdfPageNumber || img.pageNumber || img.pageNumber || 0,
        renderFailed: !!img.renderFailed
      }))
      .sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
    const renderedWidth = pageImagesData.renderedWidth || 0;
    const renderedHeight = pageImagesData.renderedHeight || 0;
    const pageWidthPoints = pageImagesData.maxWidth || 612.0;
    const pageHeightPoints = pageImagesData.maxHeight || 792.0;
    
    let actualPdfPageCount = pageImages.length;
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await fs.readFile(pdfFilePath);
      const pdfParseResult = await pdfParse(pdfData);
      actualPdfPageCount = pdfParseResult.numpages;
      console.log(`[Job ${jobId}] Actual PDF has ${actualPdfPageCount} pages (from PDF file)`);
    } catch (err) {
      console.warn(`[Job ${jobId}] Could not get PDF page count, using rendered images count: ${pageImages.length}`);
    }
    
    const totalPages = Math.max(actualPdfPageCount, pageImages.length, textData.pages?.length || 0);
    console.log(`[Job ${jobId}] EPUB generation: ${totalPages} total pages (PDF: ${actualPdfPageCount}, images: ${pageImages.length}, text: ${textData.pages?.length || 0})`);
    
    const manifestItems = [];
    const spineItems = [];
    const tocItems = [];
    const smilFileNames = [];

    console.log(`[Job ${jobId}] Page images after normalization: ${pageImages.length}`);
    pageImages.slice(0, 5).forEach(img => {
      console.log(`[Job ${jobId}] pageImage pageNumber=${img.pageNumber}, pdfPageNumber=${img.pdfPageNumber}, renderFailed=${img.renderFailed}, file=${img.fileName}`);
    });
    // Track mapping from source block IDs to actual XHTML IDs per page (for SMIL/audio and TTS alignment)
    let pageIdMappings = {};
    
    // STEP 1: Add images to EPUB FIRST and track which ones succeeded
    // This ensures we know which pages have valid images before generating XHTML
    const successfullyAddedImages = new Map(); // Map<pageNumber, epubPath>
    for (const img of pageImages) {
      try {
        // Verify image file exists before trying to add it
        await fs.access(img.path);
        const imageData = await fs.readFile(img.path);
        const imageFileName = img.fileName.replace(/^image\//, '');
        const imagePath = `image/${imageFileName}`;
        zip.file(`OEBPS/${imagePath}`, imageData);
        
        // Copy image to assets directory for API access
        const assetsImageFileName = `page_${img.pageNumber}_render.png`;
        const assetsImagePath = path.join(imagesDir, assetsImageFileName);
        try {
          await fs.copyFile(img.path, assetsImagePath);
        } catch (copyError) {
          console.warn(`[Job ${jobId}] Could not copy image to assets:`, copyError.message);
        }
        
        const imageId = `page-img-${img.pageNumber}`;
        const imageMimeType = img.fileName.toLowerCase().endsWith('.jpg') || img.fileName.toLowerCase().endsWith('.jpeg') 
          ? 'image/jpeg' 
          : 'image/png';
        manifestItems.push(`<item id="${imageId}" href="${imagePath}" media-type="${imageMimeType}"/>`);
        
        img.epubPath = imagePath;
        successfullyAddedImages.set(img.pageNumber, imagePath);
        console.log(`[Job ${jobId}] Successfully added image for page ${img.pageNumber}: ${imagePath}`);
      } catch (imgError) {
        console.warn(`[Job ${jobId}] Could not add page image ${img.fileName} (page ${img.pageNumber}):`, imgError.message);
        // Don't set epubPath - this page will be skipped
      }
    }
    
    // STEP 2: Generate XHTML pages ONLY for pages with successfully added images
    for (let i = 0; i < pageImages.length; i++) {
      const pageImage = pageImages[i];
      const epubPageNum = pageImage.pageNumber;
      const pdfPageNum = pageImage.pdfPageNumber || pageImage.pageNumber;
      
      // CRITICAL: Only generate page if image was successfully added
      if (!successfullyAddedImages.has(epubPageNum)) {
        console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Image not found or failed to add, skipping page generation`);
        continue; // Skip this page if image is missing
      }
      
      let page = null;
      
      // PRIMARY: Match by exact page number (most reliable)
      page = textData.pages.find(p => p.pageNumber === epubPageNum);
      
      if (!page) {
        page = textData.pages.find(p => p.pageNumber === pdfPageNum);
      }
      
      // SECONDARY: Match by array index ONLY if page numbers match exactly
      // This prevents text bleeding from wrong pages
      if (!page && i < textData.pages.length) {
        const pageByIndex = textData.pages[i];
        // STRICT: Only use if page numbers match exactly (no tolerance)
        if (pageByIndex && pageByIndex.pageNumber === epubPageNum) {
          console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): Using text from array index ${i} (exact match: textData.pageNumber=${pageByIndex.pageNumber})`);
          page = pageByIndex;
        } else if (pageByIndex) {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Array index ${i} has pageNumber=${pageByIndex.pageNumber} (mismatch, skipping to prevent text bleeding)`);
        }
      }
      
      // TERTIARY: Try index-based fallback ONLY if pageNumber matches exactly
      if (!page && epubPageNum > 0 && textData.pages[epubPageNum - 1]) {
        const pageByIndex = textData.pages[epubPageNum - 1];
        // STRICT: Only use if page numbers match exactly
        if (pageByIndex.pageNumber === epubPageNum) {
          console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): Using text from index ${epubPageNum - 1} (exact match: textData.pageNumber=${pageByIndex.pageNumber})`);
          page = pageByIndex;
        } else {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Index ${epubPageNum - 1} has pageNumber=${pageByIndex.pageNumber} (mismatch, skipping to prevent text bleeding)`);
        }
      }
      
      // LAST RESORT: Create empty page if no exact match found
      if (!page) {
        console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): No exact matching text data found, creating EMPTY page (no text will be displayed)`);
        page = {
          pageNumber: epubPageNum,
          text: '', // Empty text - no fallback text
          textBlocks: [], // Empty textBlocks
          charCount: 0,
          width: pageWidthPoints,
          height: pageHeightPoints
        };
      } else {
        // VALIDATION: If matched page has different pageNumber, reject it to prevent text bleeding
        if (page.pageNumber !== epubPageNum && page.pageNumber !== pdfPageNum) {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum}: Matched page has pageNumber=${page.pageNumber} (mismatch detected, using empty page to prevent text bleeding)`);
          page = {
            pageNumber: epubPageNum,
            text: '',
            textBlocks: [],
            charCount: 0,
            width: pageWidthPoints,
            height: pageHeightPoints
          };
        }
      }
      
      const hasText = page.text && page.text.trim().length > 0;
      const hasTextBlocks = page.textBlocks && page.textBlocks.length > 0;
      const textPreview = page.text ? page.text.substring(0, 100).replace(/\n/g, ' ') : '';
      const pageMatchStatus = page.pageNumber === epubPageNum ? 'EXACT_MATCH' : 
                              page.pageNumber === pdfPageNum ? 'PDF_PAGE_MATCH' : 
                              hasTextBlocks || hasText ? 'MISMATCH_WARNING' : 'EMPTY_PAGE';
      console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF ${pdfPageNum}): Match=${pageMatchStatus}, textData.pageNumber=${page.pageNumber}, textBlocks=${page.textBlocks?.length || 0}, textLength=${page.text?.length || 0}, preview="${textPreview.substring(0, 50)}..."`);
      
      // CRITICAL WARNING if page numbers don't match but text exists
      if (page.pageNumber !== epubPageNum && page.pageNumber !== pdfPageNum && (hasTextBlocks || hasText)) {
        console.error(`[Job ${jobId}] ⚠️ PAGE MISMATCH DETECTED: EPUB Page ${epubPageNum} matched with textData.pageNumber=${page.pageNumber} - This may cause text bleeding!`);
      }
      
      const actualPageNum = epubPageNum;
      page.pageNumber = actualPageNum;
      
      if (page.textBlocks && Array.isArray(page.textBlocks)) {
        page.textBlocks.forEach(block => {
          block.pageNumber = actualPageNum;
          if (block.boundingBox) {
            block.boundingBox.pageNumber = actualPageNum;
          }
        });
      }
      
      const fileName = `page_${actualPageNum}.xhtml`;
      
      const actualPageWidthPoints = page.width || pageWidthPoints;
      const actualPageHeightPoints = page.height || pageHeightPoints;
      
      const dpi = 300;
      const scale = dpi / 72;
      const actualRenderedWidth = Math.ceil(actualPageWidthPoints * scale);
      const actualRenderedHeight = Math.ceil(actualPageHeightPoints * scale);
      
      const pageCss = this.generateFixedLayoutCSS(
        actualPageWidthPoints,
        actualPageHeightPoints,
        actualRenderedWidth,
        actualRenderedHeight,
        hasAudio
      );
      
      // Generate XHTML and get ID mapping for SMIL sync
      // Use HTML-based pages with page image background for pixel-perfect layout
      const { html: rawPageXhtml, idMapping } = this.generateHtmlBasedPageXHTML(
        page,
        pageImage,
        actualPageNum,
        actualPageWidthPoints,
        actualPageHeightPoints,
        actualRenderedWidth,
        actualRenderedHeight,
        hasAudio
      );
      // Guard against accidental concatenation (trim anything after closing </html>)
      const pageXhtml = rawPageXhtml && rawPageXhtml.includes('</html>')
        ? rawPageXhtml.slice(0, rawPageXhtml.indexOf('</html>') + 7)
        : rawPageXhtml;
      
      // Store ID mapping for this page (for SMIL generation)
      if (!pageIdMappings) {
        pageIdMappings = {};
      }
      pageIdMappings[actualPageNum] = idMapping;
      
      zip.file(`OEBPS/${fileName}`, pageXhtml);
      
      // --- Syncs and audio (editorial override > TTS) ---
      let syncs = [];
      let audioFileName = null;
      let pageAudioFileExists = false; // Track if THIS page's audio file exists
      const orderedBlocks = (page.textBlocks || []).slice().sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
      
      // Check both locations for editorial syncs: job-specific and global
      const jobSyncDir = path.join(epubOutputDir, `job_${jobId}`, 'editorial_syncs');
      const jobSyncFilePath = path.join(jobSyncDir, `manual_page_syncs_${actualPageNum}.json`);
      const globalSyncFilePath = path.join(getHtmlIntermediateDir(), 'editorial_syncs', `manual_page_syncs_${actualPageNum}.json`);

      try {
        let syncData = null;
        // Try job-specific location first, then global
        try {
          syncData = await fs.readFile(jobSyncFilePath, 'utf8');
        } catch {
          syncData = await fs.readFile(globalSyncFilePath, 'utf8');
        }
        syncs = JSON.parse(syncData);
        audioFileName = `audio/page_${actualPageNum}_human.mp3`;
        console.log(`[Job ${jobId}] Loaded editorial syncs for page ${actualPageNum}.`);
        
        // Copy human audio file to EPUB if it exists
        const humanAudioPath = path.join(audioDir, `page_${actualPageNum}_human.mp3`);
        try {
          const audioData = await fs.readFile(humanAudioPath);
          zip.file(`OEBPS/${audioFileName}`, audioData);
          
          // Manifest entry for audio
          manifestItems.push(`<item id="audio-page-${actualPageNum}" href="${audioFileName}" media-type="audio/mpeg"/>`);
          hasAudio = true;
          pageAudioFileExists = true;
          console.log(`[Job ${jobId}] Added human audio file for page ${actualPageNum} to EPUB.`);
        } catch (audioError) {
          console.warn(`[Job ${jobId}] Human audio file not found at ${humanAudioPath}. Skipping SMIL generation to prevent auto-play without audio.`);
          // Clear syncs and audioFileName if audio doesn't exist - don't create SMIL without audio
          syncs = [];
          audioFileName = null;
          pageAudioFileExists = false;
        }
      } catch (e) {
        // No editorial syncs found - TTS will be available via reader's built-in TTS
        // We don't generate SMIL files for TTS to prevent auto-play in readers like Thorium
        // The text content is accessible for TTS without needing media overlays
        console.log(`[Job ${jobId}] No editorial syncs found. TTS will be available via reader's built-in TTS (no SMIL/auto-play).`);
        console.log(`[Job ${jobId}] To add pre-recorded audio with sync: Upload human audio files via Media Overlay Sync Editor.`);
        syncs = []; // Clear syncs so no SMIL is generated
      }

      // Generate SMIL ONLY for human-recorded audio (editorial syncs) AND only if audio file exists
      // Do NOT generate SMIL for TTS - it causes auto-play in readers like Thorium
      // Do NOT generate SMIL if audio file is missing - it causes auto-play without sound
      // TTS works fine without SMIL files using the reader's built-in TTS
      let hasSmil = false;
      const smilItemId = `smil-page${actualPageNum}`;
      // Only generate SMIL if we have syncs AND it's human audio (not TTS) AND audio file exists
      // We can tell it's human audio if audioFileName contains "_human"
      // We check pageAudioFileExists to ensure THIS page's audio file was actually added to the EPUB
      if (syncs.length > 0 && audioFileName && audioFileName.includes('_human') && pageAudioFileExists) {
        hasSmil = true;
        const smilFileName = `page_${actualPageNum}.smil`;
        const smilContent = this.generateSMILContent(
          actualPageNum,
          syncs,
          audioFileName,
          textData,
          pageIdMappings[actualPageNum],
          fileName // Pass XHTML filename for textref
        );
        zip.file(`OEBPS/${smilFileName}`, smilContent);
        smilFileNames.push(smilFileName);
        // SMIL manifest item - ID is what XHTML will reference
        manifestItems.push(`<item id="${smilItemId}" href="${smilFileName}" media-type="application/smil+xml"/>`);
      }

      const itemId = `page${actualPageNum}`;
      const pageProps = [];
      // Fixed-layout EPUB requires rendition:layout-fixed
      pageProps.push('rendition:layout-fixed');
      if (hasAudio) pageProps.push('rendition:page-spread-center');
      if (hasSmil) pageProps.push('media-overlay');
      const propsAttr = pageProps.length ? ` properties="${pageProps.join(' ')}"` : '';
      // CRITICAL: media-overlay must point to SMIL item ID, not filename
      const mediaOverlayAttr = hasSmil ? ` media-overlay="${smilItemId}"` : '';
      manifestItems.push(`<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml"${propsAttr}${mediaOverlayAttr}/>`);
      // Spine itemref should also have media-overlay
      const spineMediaOverlay = hasSmil ? ` media-overlay="${smilItemId}"` : '';
      spineItems.push(`<itemref idref="${itemId}"${spineMediaOverlay}/>`);
      tocItems.push(`<li><a href="${fileName}">Page ${actualPageNum}</a></li>`);
    }
    
    // Images are now added BEFORE page generation (see STEP 1 above)
    // No need to add them again here
    
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Navigation</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <nav epub:type="toc" id="toc" hidden="true">
    <ol></ol>
  </nav>
</body>
</html>`;
    zip.file('OEBPS/nav.xhtml', navXhtml);
    
    let audioFileName = null;
    // smilFileNames already declared above (line 619)
    if (audioSyncs && audioSyncs.length > 0) {
      const firstSync = audioSyncs[0];
      const audioFilePath = firstSync.audioFilePath || firstSync.audio_file_path;
      
      if (audioFilePath) {
        try {
          await fs.access(audioFilePath);
          const audioData = await fs.readFile(audioFilePath);
          const audioExt = path.extname(audioFilePath) || '.mp3';
          audioFileName = `audio/audio_${jobId}${audioExt}`;
          zip.file(`OEBPS/${audioFileName}`, audioData);
          
          let audioMimeType = 'audio/mpeg';
          if (audioExt === '.wav') audioMimeType = 'audio/wav';
          else if (audioExt === '.ogg') audioMimeType = 'audio/ogg';
          else if (audioExt === '.m4a') audioMimeType = 'audio/mp4';
          
          manifestItems.push(`<item id="audio" href="${audioFileName}" media-type="${audioMimeType}"/>`);
          
          const syncsByPage = {};
          for (const sync of audioSyncs) {
            const pageNum = sync.pageNumber || sync.page_number;
            if (!syncsByPage[pageNum]) {
              syncsByPage[pageNum] = [];
            }
            syncsByPage[pageNum].push(sync);
          }
          
          for (const pageNum in syncsByPage) {
            const pageSyncs = syncsByPage[pageNum];
            const smilFileName = `page_${pageNum}.smil`;
            // Get ID mapping for this page
            const pageIdMapping = pageIdMappings?.[parseInt(pageNum)] || {};
            const pageXhtmlFileName = `page_${pageNum}.xhtml`;
            const smilContent = this.generateSMILContent(parseInt(pageNum), pageSyncs, audioFileName, textData, pageIdMapping, pageXhtmlFileName);
            zip.file(`OEBPS/${smilFileName}`, smilContent);
            smilFileNames.push(smilFileName);
            // Use page${pageNum} format to match spine itemref idref
            manifestItems.push(`<item id="smil-page${pageNum}" href="${smilFileName}" media-type="application/smil+xml"/>`);
          }
          
          console.log(`[Job ${jobId}] Added audio file and ${smilFileNames.length} SMIL files`);
        } catch (audioError) {
          console.warn(`[Job ${jobId}] Could not add audio file:`, audioError.message);
          console.warn(`[Job ${jobId}] Audio file path was: ${audioFilePath}`);
        }
      } else {
        console.warn(`[Job ${jobId}] Audio syncs exist but no audioFilePath found. First sync:`, JSON.stringify(firstSync, null, 2));
      }
    } else {
      console.log(`[Job ${jobId}] No audio syncs found - EPUB will be generated without audio`);
    }
    
    const sharedCss = this.generateFixedLayoutCSS(
      pageWidthPoints,
      pageHeightPoints,
      renderedWidth,
      renderedHeight
    );
    zip.file('OEBPS/css/fixed-layout.css', sharedCss);
    if (!manifestItems.some(item => item.includes('css/fixed-layout.css'))) {
      manifestItems.push(`<item id="css-shared" href="css/fixed-layout.css" media-type="text/css"/>`);
    }
    
    const contentOpf = this.generateFixedLayoutContentOpf(
      jobId,
      docTitle,
      manifestItems,
      spineItems,
      pageWidthPoints,
      pageHeightPoints,
      renderedWidth,
      renderedHeight,
      smilFileNames,
      hasAudio
    );
    zip.file('OEBPS/content.opf', contentOpf);
    
    if (manifestItems.length === 0) {
      throw new Error('EPUB manifest is empty - no content items found');
    }
    if (spineItems.length === 0) {
      throw new Error('EPUB spine is empty - no pages to display');
    }
    
    console.log(`[Job ${jobId}] EPUB structure: ${manifestItems.length} manifest items, ${spineItems.length} spine items, ${pageImages.length} images`);
    
    const epubBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      streamFiles: false,
      createFolders: false
    });
    
    console.log(`[Job ${jobId}] EPUB buffer generated: ${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    return epubBuffer;
  }
  
  /**
   * ✅ FIXED: TTS Read-Aloud Now Works
   * - Removed hidden="true" attribute
   * - Changed CSS to normal document flow
   * - Using allTextForTTS for clean text
   * - Position: relative (not absolute/fixed)
   * - No clipping (overflow: visible)
   */
  static generateFixedLayoutPageXHTML(page, pageImage, pageNumber, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, pageCss = null, hasAudio = false) {
    // Track ID mappings: blockId -> actual XHTML element ID
    const idMapping = {};
    let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>`;
    
    // Use simple viewport for reflowable content
    html += `
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Page ${pageNumber}</title>`;
    
    // 4-Layer Image Text Highlighting System CSS
    const simpleCss = `/*<![CDATA[*/
    body { font-family: Arial, sans-serif; margin: 20px; }
    .page-image { max-width: 100%; height: auto; margin-bottom: 20px; display: block; }
    .text-content { margin-top: 20px; }
    .text-content p, .text-content h1, .text-content h2, .text-content h3 { margin: 10px 0; }
    
    /* 4-LAYER IMAGE TEXT HIGHLIGHTING SYSTEM */
    
    /* LAYER 1: IMAGE LAYER (z-index: 1) - PDF page image */
    .image-container { 
      position: relative; 
      display: inline-block; 
      max-width: 100%; 
      width: 100%;
      line-height: 0;
    }
    .image-container img {
      display: block;
      width: 100%;
      height: auto;
      position: relative;
      z-index: 1;
    }
    
    /* LAYER 2: HIGHLIGHT LAYER (z-index: 2) - Transparent rectangles over image text */
    .highlight-overlays { 
      position: absolute; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      pointer-events: auto; /* Allow click interaction */
      z-index: 2;
      overflow: hidden;
    }
    .text-highlight-overlay { 
      position: absolute; 
      background-color: transparent; 
      border: 2px solid transparent;
      transition: all 0.3s ease;
      pointer-events: auto; /* Allow click to highlight */
      cursor: pointer;
      z-index: 2;
      box-sizing: border-box;
      opacity: 1;
      /* Smooth animations */
      will-change: background-color, border-color, box-shadow;
    }
    
    /* User click highlight (yellow) */
    .text-highlight-overlay.user-highlight {
      background-color: rgba(255, 255, 0, 0.4) !important;
      border-color: rgba(255, 200, 0, 0.8) !important;
      box-shadow: 0 0 8px rgba(255, 255, 0, 0.6) !important;
    }
    
    /* Multiple highlight colors */
    .text-highlight-overlay.highlight-yellow {
      background-color: rgba(255, 255, 0, 0.4) !important;
      border-color: rgba(255, 200, 0, 0.8) !important;
    }
    .text-highlight-overlay.highlight-green {
      background-color: rgba(0, 255, 0, 0.4) !important;
      border-color: rgba(0, 200, 0, 0.8) !important;
    }
    .text-highlight-overlay.highlight-pink {
      background-color: rgba(255, 192, 203, 0.4) !important;
      border-color: rgba(255, 150, 150, 0.8) !important;
    }
    .text-highlight-overlay.highlight-blue {
      background-color: rgba(173, 216, 230, 0.4) !important;
      border-color: rgba(100, 150, 255, 0.8) !important;
    }
    
    /* Active highlighting (when audio is playing) - EPUB 3 standard classes */
    .text-highlight-overlay.-epub-media-overlay-active,
    .text-highlight-overlay.epub-media-overlay-active,
    .text-highlight-overlay[class*="epub-media-overlay-active"] {
      background-color: rgba(255, 255, 0, 0.6) !important;
      border-color: rgba(255, 200, 0, 1) !important;
      box-shadow: 0 0 12px rgba(255, 255, 0, 0.8), 0 0 20px rgba(255, 255, 0, 0.4) !important;
      opacity: 1 !important;
      /* Pulse animation for read-aloud */
      animation: highlightPulse 1.5s ease-in-out infinite;
    }
    
    /* Playing state with stronger pulse */
    .text-highlight-overlay.-epub-media-overlay-playing,
    .text-highlight-overlay.epub-media-overlay-playing,
    .text-highlight-overlay[class*="epub-media-overlay-playing"] {
      background-color: rgba(255, 255, 0, 0.7) !important;
      border-color: rgba(255, 150, 0, 1) !important;
      box-shadow: 0 0 15px rgba(255, 255, 0, 1), 0 0 30px rgba(255, 255, 0, 0.6) !important;
      animation: highlightPulse 1s ease-in-out infinite;
    }
    
    /* Pulse animation for read-aloud */
    @keyframes highlightPulse {
      0%, 100% { 
        box-shadow: 0 0 12px rgba(255, 255, 0, 0.8), 0 0 20px rgba(255, 255, 0, 0.4);
      }
      50% { 
        box-shadow: 0 0 18px rgba(255, 255, 0, 1), 0 0 30px rgba(255, 255, 0, 0.7);
      }
    }
    
    /* LAYER 3: SELECTION LAYER (z-index: 3) - Invisible but selectable text */
    .selection-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none; /* Don't block clicks, but allow text selection */
      z-index: 3;
      overflow: hidden;
    }
    .selectable-text {
      position: absolute;
      color: transparent;
      opacity: 0.001; /* Nearly invisible but still selectable */
      user-select: text;
      -webkit-user-select: text;
      pointer-events: auto;
      z-index: 3;
      font-size: inherit;
      line-height: inherit;
      white-space: nowrap;
    }
    
    /* Visible text overlay - shows actual text on image at PDF coordinates */
    .visible-text-overlay {
      color: #000 !important;
      opacity: 1 !important;
      background: transparent !important;
      text-shadow: 0 0 2px rgba(255, 255, 255, 0.8), 0 0 2px rgba(255, 255, 255, 0.8); /* White outline for readability */
      -webkit-text-stroke: 0.3px rgba(255, 255, 255, 0.5); /* Subtle white stroke */
    }
    
    /* LAYER 4: TTS LAYER (z-index: 4) - Hidden text for screen readers */
    .tts-layer {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      z-index: 4;
    }
    
    /* Glow effect for active highlights */
    .text-highlight-overlay.active-glow {
      filter: drop-shadow(0 0 8px rgba(255, 255, 0, 0.8));
    }
/*]]>*/`;
    
    html += `
  <style type="text/css">${simpleCss}</style>
</head>
<body class="fixed-layout-page" id="page${pageNumber}">
  <div class="page-container">`;
    
    // Pre-collect text for flow layer (we'll populate this as we process blocks)
    const allTextForTTS = [];
    
    // First, collect text from textBlocks if available
    let textBlocks = (page.textBlocks || []).filter(block => {
      const blockPageNum = block.pageNumber || block.boundingBox?.pageNumber;
      const belongsToPage = !blockPageNum || blockPageNum === pageNumber;
      return belongsToPage;
    });
    
    // CRITICAL: Only create fallback text blocks if page.text is non-empty
    // This prevents generating text for blank/empty pages
    const hasPageText = page.text && page.text.trim().length > 0;
    
    if (textBlocks.length === 0 && hasPageText) {
      let cleanText = page.text;
      cleanText = cleanText.replace(/^(Page\s+)?\d+\s*$/gm, '');
      cleanText = cleanText.replace(/^Page\s+\d+[:\-]?\s*/gmi, '');
      cleanText = cleanText.trim();
      
      // Only create blocks if cleaned text is not empty
      if (cleanText.length > 0) {
        textBlocks = GeminiService.createSimpleTextBlocks(
          cleanText || page.text,
          pageNumber,
          pageWidthPoints,
          pageHeightPoints
        );
      }
    }
    
    // Emergency fallback ONLY if page.text exists and is non-empty
    if (textBlocks.length === 0 && hasPageText) {
      const trimmedText = page.text.trim();
      if (trimmedText.length > 0 && !trimmedText.match(/^Page\s+\d+[:\-]?\s*$/i)) {
        textBlocks = [{
          id: `emergency_block_${pageNumber}`,
          text: trimmedText,
          type: 'paragraph',
          level: null,
          isSimple: true,
          boundingBox: null,
          fontSize: 22,
          fontName: 'Arial',
          isBold: false,
          isItalic: false,
          readingOrder: 0,
          pageNumber: pageNumber
        }];
      }
    }
    
    // Final validation: If no textBlocks and no page.text, ensure we don't generate text
    if (textBlocks.length === 0 && !hasPageText) {
      console.log(`[Job ${pageNumber}] Page ${pageNumber}: No text blocks and no page.text - generating empty page (no text content)`);
    }
    
    // Collect all text for TTS flow layer
    for (const block of textBlocks) {
      if (block.text && block.text.trim().length > 0) {
        allTextForTTS.push(block.text.trim());
      }
    }
    
    // Generate flow text FIRST (before fixed layout)
    let ttsFlowText = '';
    
    // Strategy 1: Use collected text from blocks
    if (allTextForTTS.length > 0) {
      ttsFlowText = allTextForTTS
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
      console.log(`[Page ${pageNumber}] TTS: Using ${allTextForTTS.length} text blocks (${ttsFlowText.length} chars)`);
    }
    
    // Strategy 2: Use page.text if available
    if (!ttsFlowText && page.text && page.text.trim().length > 0) {
      ttsFlowText = page.text
        .replace(/\s+/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
      console.log(`[Page ${pageNumber}] TTS: Using page.text (${ttsFlowText.length} chars)`);
    }
    
    // Add image with highlight overlays if available
    if (pageImage) {
      const imagePath = pageImage.epubPath || `image/${pageImage.fileName.replace(/^image\//, '')}`;
      
      // Calculate scale factor for positioning (from PDF points to rendered pixels)
      // Note: These are calculated but not used directly since we use percentage-based positioning
      // They're kept for potential future use or debugging
      
      // 4-LAYER IMAGE TEXT HIGHLIGHTING SYSTEM
      html += `
    <div class="image-container" style="position: relative; display: inline-block; width: 100%; max-width: 100%;">`;
      
      // LAYER 1: IMAGE LAYER (z-index: 1)
      html += `
      <img src="${this.escapeHtml(imagePath)}" alt="Page ${pageNumber}" class="page-image" style="display: block; width: 100%; height: auto; position: relative; z-index: 1;" />`;
      
      // LAYER 2: HIGHLIGHT LAYER (z-index: 2) - Transparent rectangles over image text
      html += `
      <div class="highlight-overlays" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; z-index: 2; overflow: hidden;">`;
      
      // LAYER 3: SELECTION LAYER (z-index: 3) - Invisible but selectable text
      html += `
      <div class="selection-layer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3; overflow: hidden;">`;
      
      // LAYER 4: TTS LAYER (z-index: 4) - Hidden text for screen readers
      html += `
      <div class="tts-layer" aria-hidden="true">`;
      
      // Generate all layers for each text block with bounding box
      if (textBlocks.length > 0) {
        for (let i = 0; i < textBlocks.length; i++) {
          const block = textBlocks[i];
          if (block.boundingBox && block.text && block.text.trim().length > 0) {
            const blockId = block.id || block.blockId || `ocr_block_${pageNumber}_${i}`;
            const bbox = block.boundingBox;
            const escapedText = this.escapeHtml(block.text.trim());
            
            // Convert PDF coordinates to percentage-based positioning
            const leftPercent = ((bbox.x / pageWidthPoints) * 100).toFixed(4);
            const topFromTop = pageHeightPoints - (bbox.y + bbox.height);
            const topPercent = Math.max(0, Math.min(100, ((topFromTop / pageHeightPoints) * 100))).toFixed(4);
            const widthPercent = Math.max(0, Math.min(100, ((bbox.width / pageWidthPoints) * 100))).toFixed(4);
            const heightPercent = Math.max(0, Math.min(100, ((bbox.height / pageHeightPoints) * 100))).toFixed(4);
            
            // LAYER 2: Highlight overlay rectangle
            html += `
        <div id="${blockId}-highlight" 
             class="text-highlight-overlay" 
             role="text"
             aria-label="${escapedText.substring(0, 50)}"
             data-block-id="${blockId}"
             data-text="${this.escapeHtml(block.text.trim())}"
             style="left: ${leftPercent}%; 
                    top: ${topPercent}%; 
                    width: ${widthPercent}%; 
                    height: ${heightPercent}%;"></div>`;
            
            // LAYER 3: Selectable text (invisible but selectable) - positioned exactly over highlight
            html += `
        <span class="selectable-text" 
              id="${blockId}-selectable"
              style="position: absolute;
                     left: ${leftPercent}%; 
                     top: ${topPercent}%; 
                     width: ${widthPercent}%; 
                     height: ${heightPercent}%;
                     display: flex;
                     align-items: center;
                     padding: 2px;">${escapedText}</span>`;
            
            // LAYER 4: TTS text (hidden for screen readers)
            html += `
        <span class="tts-text" aria-label="${escapedText.substring(0, 100)}">${escapedText}</span>`;
            
            // Map highlight element for SMIL
            idMapping[blockId] = `${blockId}-highlight`;
          }
        }
      }
      
      // Close all layers (tts-layer, selection-layer, highlight-overlays, image-container)
      html += `
      </div>
      </div>
      </div>
    </div>`;
    }
    
    // Start text-content div - ensure it's accessible for TTS
    // Use epub:type="bodymatter" to mark as main content for TTS
    html += `
    <div class="text-content" epub:type="bodymatter" role="main" aria-label="Page ${pageNumber} content">`;
    
    // Generate paragraphs from textBlocks for ideal structure
    // Use individual blocks as separate paragraphs (like the ideal structure)
    let paraIndex = 0;
    
    if (textBlocks.length > 0) {
      // Use textBlocks directly - each block becomes a paragraph
      for (let i = 0; i < textBlocks.length; i++) {
        const block = textBlocks[i];
        if (block.text && block.text.trim().length > 0) {
          const blockId = block.id || block.blockId || `ocr_block_${pageNumber}_${i}`;
          const escapedText = this.escapeHtml(block.text.trim());
          html += `
     <p id="${blockId}" lang="en" xml:lang="en">${escapedText}</p>`;
          
          // Map block ID for SMIL sync
          // If block has bounding box, mapping already points to highlight overlay
          // Otherwise, map to paragraph element
          if (!idMapping[blockId]) {
            idMapping[blockId] = blockId;
          }
          paraIndex++;
        }
      }
    }
    
    // Fallback: if no blocks, use collected text
    if (paraIndex === 0 && ttsFlowText && ttsFlowText.trim().length > 0) {
      const escapedText = this.escapeHtml(ttsFlowText.trim());
      // Split into sentences for better paragraph structure
      const sentences = escapedText.split(/([.!?]\s+(?=[A-Z]))/).filter(s => s.trim().length > 0);
      let currentPara = '';
      
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length < 3 && /^[.!?\s]+$/.test(trimmed)) {
          continue;
        }
        
        if ((currentPara + sentence).length > 500 && currentPara.length > 0) {
          const cleanPara = currentPara.trim().replace(/\s+/g, ' ');
          if (cleanPara.length > 10) {
            const blockId = `ocr_block_${pageNumber}_${paraIndex}`;
            html += `
     <p id="${blockId}" lang="en" xml:lang="en">${cleanPara}</p>`;
            paraIndex++;
          }
          currentPara = sentence;
        } else {
          currentPara += sentence;
        }
      }
      
      if (currentPara.trim().length > 0) {
        const cleanPara = currentPara.trim().replace(/\s+/g, ' ');
        if (cleanPara.length > 10) {
          const blockId = `ocr_block_${pageNumber}_${paraIndex}`;
          html += `
     <p id="${blockId}" lang="en" xml:lang="en">${cleanPara}</p>`;
            paraIndex++;
        }
      }
      
      // Final fallback: single paragraph
      if (paraIndex === 0) {
        const blockId = `ocr_block_${pageNumber}_0`;
        html += `
     <p id="${blockId}" lang="en" xml:lang="en">${escapedText}</p>`;
        paraIndex = 1;
      }
    }
    
    // Last resort fallback
    if (paraIndex === 0) {
      const fallbackText = page.text && page.text.trim().length > 0 
        ? page.text.trim().replace(/\s+/g, ' ')
        : `Page ${pageNumber}`;
      const escapedFallback = this.escapeHtml(fallbackText);
      const blockId = `ocr_block_${pageNumber}_0`;
      html += `
     <p id="${blockId}" lang="en" xml:lang="en">${escapedFallback}</p>`;
      paraIndex = 1;
    }
    
    console.log(`[Page ${pageNumber}] TTS: Added ${paraIndex} paragraphs in ideal structure`);
    
    // Close text-content and page-container divs
    html += `
    </div>
  </div>`;
    
    // Add JavaScript for image text highlighting interaction
    const pageIdStr = `page${pageNumber}`;
    const highlightScript = `
  <script type="text/javascript">
  /*<![CDATA[*/
  (function() {
    'use strict';
    
    // Image Text Highlighting System
    const HighlightManager = {
      currentColor: 'yellow',
      pageId: '${pageIdStr}',
      colors: {
        yellow: 'highlight-yellow',
        green: 'highlight-green',
        pink: 'highlight-pink',
        blue: 'highlight-blue'
      },
      
      init: function() {
        // Load saved highlights from localStorage
        this.loadHighlights();
        
        // Attach click handlers to all highlight overlays
        const overlays = document.querySelectorAll('.text-highlight-overlay');
        overlays.forEach(overlay => {
          overlay.addEventListener('click', this.handleHighlightClick.bind(this));
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboard.bind(this));
      },
      
      handleHighlightClick: function(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const overlay = event.currentTarget;
        const blockId = overlay.getAttribute('data-block-id');
        
        // Toggle highlight
        if (overlay.classList.contains('user-highlight')) {
          // Remove highlight
          Object.values(this.colors).forEach(colorClass => {
            overlay.classList.remove(colorClass);
          });
          overlay.classList.remove('user-highlight');
          this.removeHighlight(blockId);
        } else {
          // Add highlight
          overlay.classList.add('user-highlight', this.colors[this.currentColor]);
          this.saveHighlight(blockId, this.currentColor);
        }
      },
      
      handleKeyboard: function(event) {
        // Ctrl+H to cycle highlight colors
        if (event.ctrlKey && event.key === 'h') {
          event.preventDefault();
          const colors = Object.keys(this.colors);
          const currentIndex = colors.indexOf(this.currentColor);
          this.currentColor = colors[(currentIndex + 1) % colors.length];
        }
      },
      
      saveHighlight: function(blockId, color) {
        try {
          const key = 'highlights_' + this.pageId;
          let highlights = JSON.parse(localStorage.getItem(key) || '{}');
          highlights[blockId] = { color: color, timestamp: Date.now() };
          localStorage.setItem(key, JSON.stringify(highlights));
        } catch (e) {
          console.warn('Could not save highlight:', e);
        }
      },
      
      removeHighlight: function(blockId) {
        try {
          const key = 'highlights_' + this.pageId;
          let highlights = JSON.parse(localStorage.getItem(key) || '{}');
          delete highlights[blockId];
          localStorage.setItem(key, JSON.stringify(highlights));
        } catch (e) {
          console.warn('Could not remove highlight:', e);
        }
      },
      
      loadHighlights: function() {
        try {
          const key = 'highlights_' + this.pageId;
          const highlights = JSON.parse(localStorage.getItem(key) || '{}');
          
          Object.keys(highlights).forEach(blockId => {
            const highlight = highlights[blockId];
            const overlay = document.getElementById(blockId + '-highlight');
            if (overlay && highlight.color) {
              overlay.classList.add('user-highlight', this.colors[highlight.color]);
            }
          });
        } catch (e) {
          console.warn('Could not load highlights:', e);
        }
      }
    };
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        HighlightManager.init();
      });
    } else {
      HighlightManager.init();
    }
  })();
  /*]]>*/
  </script>`;
    
    html += highlightScript;
    html += `
</body>
</html>`;
    
    // Return both the generated XHTML string and the ID mapping for SMIL/TTS alignment
    return { html, idMapping };
  }

  /**
   * Generate HTML-based page that recreates PDF layout exactly using HTML/CSS
   * Instead of rendering as image, creates exact HTML replica with positioned text and images
   */
  static generateHtmlBasedPageXHTML(page, pageImage, pageNumber, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, hasAudio = false) {
    const idMapping = {};

    const safeRenderedWidth = renderedWidth && renderedWidth > 0
      ? renderedWidth
      : Math.ceil((pageWidthPoints || 612) * (300 / 72));
    const safeRenderedHeight = renderedHeight && renderedHeight > 0
      ? renderedHeight
      : Math.ceil((pageHeightPoints || 792) * (300 / 72));

    const imagePath = pageImage
      ? (pageImage.epubPath || `image/${pageImage.fileName.replace(/^image\//, '')}`)
      : '';

    // Default to invisible overlays (text present for TTS/search, hidden visually)
    const overlayVisible = (process.env.TEXT_OVERLAY_VISIBLE || 'false').toLowerCase() === 'true';
    const overlayClass = overlayVisible ? '' : 'overlay-hidden';

    let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${safeRenderedWidth}px, height=${safeRenderedHeight}px, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Page ${pageNumber}</title>`;

    // CSS for exact PDF layout recreation (fixed layout, pixel perfect)
    const htmlCss = `/*<![CDATA[*/
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    html, body {
      margin: 0;
      padding: 0;
      width: ${safeRenderedWidth}px;
      height: ${safeRenderedHeight}px;
      overflow: hidden;
      background-color: white;
      font-family: Arial, sans-serif;
    }
    
    .page-container {
      position: relative;
      width: ${safeRenderedWidth}px;
      height: ${safeRenderedHeight}px;
      background-color: white;
      overflow: hidden;
    }
    
    .page-bg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      z-index: 1;
      pointer-events: none;
    }

    .text-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 2;
      pointer-events: none;
    }

    /* Text blocks with exact positioning */
    .text-block {
      position: absolute;
      margin: 0;
      padding: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
      user-select: text;
      -webkit-user-select: text;
      pointer-events: auto;
      overflow: visible;
    }

    /* Optional: hide overlays while keeping them for TTS/search */
    .overlay-hidden .text-block {
      color: transparent !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    
    /* TTS flow text (hidden but accessible) */
    .tts-flow-text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
    
    /* Text content div for TTS accessibility */
    .text-content {
      margin-top: 20px;
    }
    
    .text-content p,
    .text-content h1,
    .text-content h2,
    .text-content h3,
    .text-content h4,
    .text-content h5,
    .text-content h6 {
      margin: 10px 0;
      color: #000;
      visibility: visible;
      opacity: 1;
      display: block;
    }
    
    /* Media overlay highlighting */
    .text-block.-epub-media-overlay-active,
    .text-block.epub-media-overlay-active {
      background-color: rgba(255, 255, 0, 0.4) !important;
      outline: 2px solid rgba(255, 200, 0, 0.8) !important;
    }
    
    .text-block.-epub-media-overlay-playing,
    .text-block.epub-media-overlay-playing {
      background-color: rgba(255, 255, 0, 0.6) !important;
      outline: 3px solid rgba(255, 150, 0, 1) !important;
    }
/*]]>*/`;

    html += `
  <style type="text/css">${htmlCss}</style>
</head>
<body class="html-based-page ${overlayClass}" id="page${pageNumber}">
  <div class="page-container">`;
    // Layer 1: full-page background image
    if (imagePath) {
      html += `
    <img src="${this.escapeHtml(imagePath)}" alt="Page ${pageNumber}" class="page-bg" aria-hidden="true" />`;
    }

    // Layer 2: text overlays
    html += `
    <div class="text-layer">`;

    // Get text blocks for this page
    let textBlocks = (page.textBlocks || []).filter(block => {
      const blockPageNum = block.pageNumber || block.boundingBox?.pageNumber;
      return !blockPageNum || blockPageNum === pageNumber;
    });

    // If no text blocks, create from page text
    if (textBlocks.length === 0 && page.text && page.text.trim().length > 0) {
      textBlocks = GeminiService.createSimpleTextBlocks(
        page.text,
        pageNumber,
        pageWidthPoints,
        pageHeightPoints
      );
    }

    // Collect all text for TTS
    const allTextForTTS = [];

    // Scaling factors: PDF points -> rendered image pixels
    const scaleX = pageWidthPoints > 0 ? (safeRenderedWidth / pageWidthPoints) : 1;
    const scaleY = pageHeightPoints > 0 ? (safeRenderedHeight / pageHeightPoints) : 1;
    const avgScale = (scaleX + scaleY) / 2;

    // Generate positioned text blocks
    for (let i = 0; i < textBlocks.length; i++) {
      const block = textBlocks[i];
      if (!block.text || block.text.trim().length === 0) continue;

      const blockId = block.id || `block_${pageNumber}_${i}`;
      const escapedText = this.escapeHtml(block.text.trim());
      allTextForTTS.push(block.text.trim());

      let style = '';
      let tag = 'p';
      let attributes = '';
      let epubType = 'paragraph';

      // Determine HTML tag
      if (block.type === 'heading' && block.level) {
        const hLevel = Math.max(1, Math.min(6, block.level));
        tag = `h${hLevel}`;
        epubType = 'title';
        attributes = ` epub:type="${epubType}" aria-level="${hLevel}"`;
      } else if (block.type === 'list-item') {
        epubType = 'list-item';
        attributes = ` epub:type="${epubType}"`;
      } else {
        epubType = 'paragraph';
        attributes = ` epub:type="${epubType}"`;
      }

      // Position and styling
      if (block.boundingBox) {
        const bbox = block.boundingBox;
        
        // Validate bounding box coordinates
        if (bbox.x === undefined || bbox.y === undefined || bbox.width === undefined || bbox.height === undefined) {
          console.warn(`[Page ${pageNumber} Block ${blockId}] Invalid boundingBox, missing coordinates`);
        }
        
        // Convert PDF coordinates (points, bottom-up) to rendered pixels (top-down)
        // PDF coordinates: (0,0) is bottom-left, Y increases upward
        // Screen coordinates: (0,0) is top-left, Y increases downward
        const leftPx = (bbox.x || 0) * scaleX;
        const widthPx = Math.max(1, (bbox.width || 0) * scaleX); // Ensure minimum width
        const heightPx = Math.max(1, (bbox.height || 0) * scaleY); // Ensure minimum height
        // Convert Y from PDF bottom-up to screen top-down
        const topPx = Math.max(0, (pageHeightPoints - ((bbox.y || 0) + (bbox.height || 0))) * scaleY);

        // Font styling
        const fontSizePt = block.fontSize || (bbox.height ? bbox.height * 0.9 : 12);
        const fontSizePx = fontSizePt * avgScale;
        
        let fontFamily = 'Arial, sans-serif';
        if (block.fontName) {
          // Map common PDF font names to web-safe fonts
          const fontName = block.fontName.toLowerCase();
          if (fontName.includes('times') || fontName.includes('roman')) {
            fontFamily = 'Times, "Times New Roman", serif';
          } else if (fontName.includes('courier') || fontName.includes('mono')) {
            fontFamily = 'Courier, "Courier New", monospace';
          } else if (fontName.includes('helvetica') || fontName.includes('arial')) {
            fontFamily = 'Arial, Helvetica, sans-serif';
          }
        }

        let fontWeight = 'normal';
        if (block.isBold) {
          fontWeight = 'bold';
        }

        let fontStyle = 'normal';
        if (block.isItalic) {
          fontStyle = 'italic';
        }

        // Text color (from PDF extraction)
        const textColor = block.textColor || '#000000';
        
        // Text alignment
        const textAlign = block.textAlign || 'left';

        // Build style string with absolute positioning (CRITICAL for highlighting/TTS sync)
        // All coordinates must be in pixels and properly converted from PDF points
        style = `position: absolute; 
                 left: ${leftPx.toFixed(2)}px; 
                 top: ${topPx.toFixed(2)}px; 
                 width: ${widthPx.toFixed(2)}px; 
                 height: ${heightPx.toFixed(2)}px; 
                 font-size: ${fontSizePx.toFixed(2)}px; 
                 font-family: ${fontFamily}; 
                 font-weight: ${fontWeight}; 
                 font-style: ${fontStyle}; 
                 color: ${textColor}; 
                 text-align: ${textAlign}; 
                 line-height: ${(fontSizePx * 1.05).toFixed(2)}px;`;
        
        // Validate that positioning values are valid numbers
        if (isNaN(leftPx) || isNaN(topPx) || isNaN(widthPx) || isNaN(heightPx)) {
          console.error(`[Page ${pageNumber} Block ${blockId}] Invalid positioning values - left:${leftPx}, top:${topPx}, width:${widthPx}, height:${heightPx}`);
        }

        // Map for SMIL
        idMapping[blockId] = blockId;
      } else {
        // No bounding box - use flow layout
        // WARNING: Blocks without boundingBox cannot be highlighted accurately
        console.warn(`[Page ${pageNumber} Block ${blockId}] No boundingBox - using relative positioning (highlighting may not work)`);
        style = `position: relative; 
                 margin: 10px 0; 
                 font-size: 16px; 
                 color: #000000;`;
      }

      // Generate HTML element
      html += `
    <${tag} id="${blockId}" class="text-block" role="text"${attributes} style="${style}">${escapedText}</${tag}>`;
    }

    // Close text layer
    html += `
    </div>`;

    // Generate text-content div with paragraphs for TTS (like reference file)
    // This is essential for player's built-in TTS to work properly
    html += `
    <div class="text-content" epub:type="bodymatter" role="main" aria-label="Page ${pageNumber} content">`;
    
    // Generate paragraphs from textBlocks - each block becomes a paragraph with matching ID
    if (textBlocks.length > 0) {
      for (let i = 0; i < textBlocks.length; i++) {
        const block = textBlocks[i];
        if (block.text && block.text.trim().length > 0) {
          const blockId = block.id || `block_${pageNumber}_${i}`;
          const escapedText = this.escapeHtml(block.text.trim());
          html += `
     <p id="${blockId}" lang="en" xml:lang="en">${escapedText}</p>`;
        }
      }
    } else if (allTextForTTS.length > 0) {
      // Fallback: use collected text
      const ttsText = allTextForTTS.join(' ').replace(/\s+/g, ' ').trim();
      const escapedText = this.escapeHtml(ttsText);
      html += `
     <p id="block_${pageNumber}_0" lang="en" xml:lang="en">${escapedText}</p>`;
    }
    
    html += `
    </div>`;

    html += `
  </div>
</body>
</html>`;

    return { html, idMapping };
  }
  
  static convertTextBlockToHTML(block, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight) {
    if (!block.text || block.text.trim().length === 0) {
      return '';
    }
    
    const text = this.escapeHtml(block.text.trim());
    const blockId = block.id || `block_${block.pageNumber || 0}_0`;
    
    if (!block.boundingBox || block.isSimple) {
      const maxBlockLength = 500;
      if (text.length > maxBlockLength && !block.type || block.type === 'paragraph') {
        const sentences = text.split(/([.!?]\s+)/).filter(s => s.trim().length > 0);
        let currentPara = '';
        let paraHtml = '';
        let paraIndex = 0;
        
        for (const sentence of sentences) {
          if ((currentPara + sentence).length > maxBlockLength && currentPara.length > 0) {
            paraHtml += `<p id="${this.escapeHtml(blockId)}-para-${paraIndex}" class="flow-block" role="text">${currentPara.trim()}</p>\n      `;
            currentPara = sentence;
            paraIndex++;
          } else {
            currentPara += sentence;
          }
        }
        if (currentPara.trim().length > 0) {
          paraHtml += `<p id="${this.escapeHtml(blockId)}-para-${paraIndex}" class="flow-block" role="text">${currentPara.trim()}</p>`;
        }
        return paraHtml || `<p id="${this.escapeHtml(blockId)}" class="flow-block" role="text">${text}</p>`;
      }
      
      if (block.type === 'heading' && block.level) {
        const hLevel = Math.max(1, Math.min(6, block.level));
        return `<h${hLevel} id="${this.escapeHtml(blockId)}" class="flow-block" role="heading" aria-level="${hLevel}">${text}</h${hLevel}>`;
      }
      return `<p id="${this.escapeHtml(blockId)}" class="flow-block" role="text">${text}</p>`;
    }
    
    let positionStyle = '';
    if (block.boundingBox && pageWidthPoints > 0 && pageHeightPoints > 0) {
      const bbox = block.boundingBox;
      const pdfX = bbox.x || 0;
      const pdfY = bbox.y || 0;
      const pdfWidth = bbox.width || 0;
      const pdfHeight = bbox.height || 0;
      
      const htmlTopFromBottom = pageHeightPoints - pdfY - pdfHeight;
      const htmlTopFromTop = pdfY;
      
      let htmlTop;
      if (htmlTopFromBottom >= 0 && htmlTopFromBottom <= pageHeightPoints) {
        htmlTop = htmlTopFromBottom;
      } else if (htmlTopFromTop >= 0 && htmlTopFromTop <= pageHeightPoints) {
        htmlTop = htmlTopFromTop;
      } else {
        htmlTop = Math.max(0, Math.min(pageHeightPoints, htmlTopFromBottom));
      }
      
      let leftPercent = (pdfX / pageWidthPoints) * 100.0;
      let topPercent = (htmlTop / pageHeightPoints) * 100.0;
      let widthPercent = (pdfWidth / pageWidthPoints) * 100.0;
      let heightPercent = (pdfHeight / pageHeightPoints) * 100.0;
      
      leftPercent = Math.max(0, Math.min(100, leftPercent));
      topPercent = Math.max(0, Math.min(100, topPercent));
      widthPercent = Math.max(0, Math.min(100 - leftPercent, widthPercent));
      heightPercent = Math.max(0, Math.min(100 - topPercent, heightPercent));
      
      let fontSizeStyle = '';
      if (block.fontSize && block.fontSize > 0) {
        const fontSizePercent = (block.fontSize / pageHeightPoints) * 100.0;
        fontSizeStyle = ` font-size: ${fontSizePercent.toFixed(2)}%;`;
      }
      
      positionStyle = ` style="position: absolute; left: ${leftPercent.toFixed(4)}%; top: ${topPercent.toFixed(4)}%; width: ${widthPercent.toFixed(4)}%; height: ${heightPercent.toFixed(4)}%;${fontSizeStyle}"`;
    }
    
    const type = block.type || 'paragraph';
    const level = block.level || 2;
    
    const epubType = type === 'heading' ? ' epub:type="title"' : '';
    const roleAttr = ' role="text"';
    
    if (type === 'heading') {
      const hLevel = Math.max(1, Math.min(6, level));
      return `<h${hLevel} id="${this.escapeHtml(blockId)}"${epubType}${roleAttr} aria-level="${hLevel}"${positionStyle}>${text}</h${hLevel}>`;
    } else if (type === 'list-item') {
      return `<p id="${this.escapeHtml(blockId)}" class="list-item"${epubType}${roleAttr}${positionStyle}>${text}</p>`;
    } else {
      return `<p id="${this.escapeHtml(blockId)}"${epubType}${roleAttr}${positionStyle}>${text}</p>`;
    }
  }
  
  /**
   * ✅ FIXED CSS: TTS can now read text
   * - No screen-reader-only CSS (clip, 1px)
   * - Normal document flow for TTS text
   * - Visible and accessible to TTS
   */
  static generateFixedLayoutCSS(pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, hasAudio = false) {
    const width = renderedWidth > 0 ? `${renderedWidth}px` : '100vw';
    const height = renderedHeight > 0 ? `${renderedHeight}px` : '100vh';
    
    // For no-audio EPUBs, hide the fixed-layout container so TTS can focus on flow text
    const fixedContainerDisplay = hasAudio ? 'block' : 'none';
    
    return `/* Fixed Layout EPUB Styles - TTS Read-Aloud Now Works */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100vh;
  font-size: 16px;
  line-height: 1.6;
  /* CRITICAL: Normal flow for TTS - NO fixed, NO overflow hidden */
  position: static !important;
  overflow: visible !important;
}

.fixed-layout-container {
  display: ${fixedContainerDisplay}; /* Hidden for no-audio EPUBs to allow TTS to focus on flow text */
  position: fixed;
  top: 0;
  left: 0;
  width: ${width};
  height: ${height};
  max-width: ${width};
  max-height: ${height};
  margin: 0;
  padding: 0;
  overflow: hidden;
  z-index: 1; /* Lower than flow text (z-index: 999999) */
  background-color: white;
  box-sizing: border-box;
  /* CRITICAL: Do NOT block flow text - allow it to be accessible */
  pointer-events: none; /* Allow clicks/text selection to pass through */
  /* Ensure it doesn't prevent flow text from being read */
  isolation: isolate; /* Create new stacking context */
}

.fixed-layout-container img,
.fixed-layout-container .text-content {
  pointer-events: auto; /* But allow interaction with image/text overlay */
}

.page-image {
  width: ${width};
  height: ${height};
  max-width: ${width};
  max-height: ${height};
  object-fit: contain;
  object-position: top left;
  display: block;
  margin: 0;
  padding: 0;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  box-sizing: border-box;
}

.text-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
}

.text-content p,
.text-content h1,
.text-content h2,
.text-content h3,
.text-content h4,
.text-content h5,
.text-content h6 {
  color: #000;
  background: transparent;
  margin: 0;
  padding: 0;
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
  font-size: inherit;
  line-height: 1.2;
  transition: background-color 0.1s ease;
  visibility: visible;
  opacity: 1;
  display: block;
}

.text-content .flow-block {
  position: relative;
  display: block;
  margin: 1.5em auto;
  padding: 0.8em 1.2em;
  font-size: 22px;
  line-height: 1.8;
  color: #000 !important;
  background: rgba(255, 255, 255, 0.98);
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
  z-index: 10;
  width: 88%;
  max-width: 88%;
  margin-left: auto;
  margin-right: auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  word-wrap: break-word;
  overflow-wrap: break-word;
  visibility: visible;
  opacity: 1;
}

.text-content section {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 2% 0;
  justify-content: flex-start;
}

.flow-block {
  position: relative;
  display: block;
  margin: 0.5em 0;
  padding: 0.3em 0.5em;
  font-size: 22px;
  line-height: 1.6;
  color: #000 !important;
  background: rgba(255, 255, 255, 0.9);
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
  z-index: 10;
  visibility: visible;
  opacity: 1;
}

.text-content p.epub-media-overlay-active,
.text-content h1.epub-media-overlay-active,
.text-content h2.epub-media-overlay-active,
.text-content h3.epub-media-overlay-active,
.text-content h4.epub-media-overlay-active,
.text-content h5.epub-media-overlay-active,
.text-content h6.epub-media-overlay-active {
  background-color: rgba(255, 255, 0, 0.6) !important;
  color: #000;
  transition: background-color 0.1s ease;
}

.text-content p::selection,
.text-content h1::selection,
.text-content h2::selection,
.text-content h3::selection {
  background: rgba(255, 255, 0, 0.5);
  color: #000;
}

/* ✅✅✅ CRITICAL FIX: TTS text in NORMAL DOCUMENT FLOW */
/* NO screen-reader-only CSS (clip, 1px, hidden) */
/* TTS needs normal flow, visible text */
/* Paragraphs directly in body for maximum TTS compatibility */
body > p {
  margin: 1em 0 !important;
  padding: 1em !important;
  color: #000 !important;
  font-size: 1em !important; /* Use relative units for TTS compatibility */
  line-height: 1.6 !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  
  /* Normal flow - no absolute positioning */
  position: relative !important;
  left: auto !important;
  top: auto !important;
  width: auto !important;
  height: auto !important;
  
  /* Ensure TTS can read it */
  font-weight: normal !important;
  font-style: normal !important;
  /* Ensure text is not hidden from assistive technologies */
  -epub-speak: normal !important;
  speak: normal !important;
  /* Make text selectable for TTS */
  user-select: text !important;
  -webkit-user-select: text !important;
  pointer-events: auto !important;
}`;
  }
  
  static generateFixedLayoutContentOpf(jobId, docTitle, manifestItems, spineItems, pageWidthPoints, pageHeightPoints, renderedWidth, renderedHeight, smilFileNames = [], hasAudio = false) {
    // Generate UUID for identifier
    const uuid = `urn:uuid:${jobId}-${Date.now()}`;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:rendition="http://www.idpf.org/2013/rendition" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${this.escapeHtml(docTitle)}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="book-id">${uuid}</dc:identifier>
    <dc:publisher>PDF to EPUB Converter</dc:publisher>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">none</meta>
    <meta property="rendition:viewport">width=${pageWidthPoints},height=${pageHeightPoints}</meta>
    ${smilFileNames.length > 0 ? '<meta property="media:active-class">-epub-media-overlay-active</meta>' : ''}
    ${smilFileNames.length > 0 ? '<meta property="media:playback-active-class">-epub-media-overlay-playing</meta>' : ''}
    
    <!-- Accessibility metadata for read-aloud support -->
    <meta property="schema:accessibilityFeature">textToSpeech</meta>
    <meta property="schema:accessibilityFeature">readingOrder</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilitySummary">This EPUB contains accessible text content suitable for text-to-speech and read-aloud functionality.</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="nav">
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  }

  static async generateEpubFromContent(jobId, textData, structuredContent, images, documentTitle) {
    const zip = new JSZip();
    
    const mimetypeContent = 'application/epub+zip';
    zip.file('mimetype', mimetypeContent, { 
      compression: 'STORE'
    });
    
    const mimetypeFile = zip.files['mimetype'];
    if (mimetypeFile) {
      if (!mimetypeFile.options) {
        mimetypeFile.options = {};
      }
      mimetypeFile.options.compression = 'STORE';
      mimetypeFile.options.compressionOptions = null;
    }
    
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    zip.file('META-INF/container.xml', containerXml);
    
    const chapters = structuredContent?.structured?.chapters || null;
    const docTitle = this.escapeHtml(
      structuredContent?.structured?.title || 
      textData.metadata?.title || 
      documentTitle || 
      `Converted Document ${jobId}`
    );
    
    const manifestItems = [];
    const spineItems = [];
    const tocItems = [];
    
    if (chapters && chapters.length > 0) {
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const chapterId = `chapter-${i + 1}`;
        const fileName = `${chapterId}.xhtml`;
        
        const chapterPages = textData.pages.filter(p => 
          p.pageNumber >= chapter.startPage && p.pageNumber <= chapter.endPage
        );
        
        const chapterImages = images.filter(img => 
          img.pageNumber >= chapter.startPage && img.pageNumber <= chapter.endPage
        );
        
        const chapterText = chapterPages.map(p => {
          const pageImages = chapterImages.filter(img => img.pageNumber === p.pageNumber);
          let imageHtml = '';
          if (pageImages.length > 0) {
            imageHtml = pageImages.map(img => 
              `<img src="images/${img.fileName}" alt="Image from page ${p.pageNumber}" style="max-width: 100%; height: auto;"/>`
            ).join('\n  ');
          }
          
          const escapedText = this.escapeHtml(p.text);
          const paragraphs = escapedText.split(/\n\s*\n/).filter(l => l.trim());
          const paraHtml = paragraphs.map(para => `<p>${para.replace(/\n/g, ' ')}</p>`).join('\n  ');
          
          return `${imageHtml ? imageHtml + '\n  ' : ''}${paraHtml}`;
        }).join('\n  ');
        
        const chapterTitle = this.escapeHtml(chapter.title);
        const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${chapterTitle}</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <h1>${chapterTitle}</h1>
  ${chapterText}
</body>
</html>`;
        
        zip.file(`OEBPS/${fileName}`, chapterXhtml);
        manifestItems.push(`<item id="${chapterId}" href="${fileName}" media-type="application/xhtml+xml"/>`);
        spineItems.push(`<itemref idref="${chapterId}"/>`);
        tocItems.push(`<li><a href="${fileName}">${this.escapeHtml(chapter.title)}</a></li>`);
      }
    } else {
      const pagesPerChapter = 5;
      let chapterNum = 1;
      
      for (let i = 0; i < textData.pages.length; i += pagesPerChapter) {
        const pageGroup = textData.pages.slice(i, i + pagesPerChapter);
        const chapterId = `chapter-${chapterNum}`;
        const fileName = `${chapterId}.xhtml`;
        const chapterTitle = `Chapter ${chapterNum}`;
        
        const chapterText = pageGroup.map(page => {
          const pageImages = images.filter(img => img.pageNumber === page.pageNumber);
          let imageHtml = '';
          if (pageImages.length > 0) {
            imageHtml = pageImages.map(img => 
              `<img src="images/${img.fileName}" alt="Image from page ${page.pageNumber}" style="max-width: 100%; height: auto;"/>`
            ).join('\n    ');
          }
          
          let cleanText = page.text || '';
          cleanText = cleanText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
          const escapedText = this.escapeHtml(cleanText);
          const paragraphs = escapedText.split(/\n\s*\n/).filter(l => l.trim());
          const paraHtml = paragraphs.map(para => `<p>${para.replace(/\n/g, ' ')}</p>`).join('\n    ');
          
          return `<h2>Page ${page.pageNumber}</h2>\n    ${imageHtml ? imageHtml + '\n    ' : ''}${paraHtml}`;
        }).join('\n  ');
        
        const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${chapterTitle}</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <h1>${chapterTitle}</h1>
  ${chapterText}
</body>
</html>`;
        
        zip.file(`OEBPS/${fileName}`, chapterXhtml);
        manifestItems.push(`<item id="${chapterId}" href="${fileName}" media-type="application/xhtml+xml"/>`);
        spineItems.push(`<itemref idref="${chapterId}"/>`);
        tocItems.push(`<li><a href="${fileName}">${chapterTitle}</a></li>`);
        
        chapterNum++;
      }
    }
    
    if (images.length > 0) {
      zip.file('OEBPS/images/.gitkeep', '');
      
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        try {
          if (await fs.access(img.path).then(() => true).catch(() => false)) {
            const imageData = await fs.readFile(img.path);
            zip.file(`OEBPS/images/${img.fileName}`, imageData);
            
            const mediaType = img.format === 'jpg' ? 'image/jpeg' : 
                             img.format === 'png' ? 'image/png' : 
                             `image/${img.format}`;
            manifestItems.push(`<item id="img-${i}" href="images/${img.fileName}" media-type="${mediaType}"/>`);
          }
        } catch (imgError) {
          console.warn(`[Job ${jobId}] Could not add image ${img.fileName}:`, imgError.message);
        }
      }
    }
    
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">conversion-job-${jobId}</dc:identifier>
    <dc:title>${docTitle}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>PDF to EPUB Converter</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
    zip.file('OEBPS/content.opf', contentOpf);
    
    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      streamFiles: false
    });
  }

  static async getConversionJob(jobId) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }
    return this.convertToDTO(job);
  }

  static async getAllConversions() {
    const jobs = await ConversionJobModel.findAll();
    return jobs.map(job => this.convertToDTO(job));
  }

  static async getConversionsByPdf(pdfDocumentId) {
    const jobs = await ConversionJobModel.findByPdfDocumentId(pdfDocumentId);
    return jobs.map(job => this.convertToDTO(job));
  }

  static async getConversionsByStatus(status) {
    const jobs = await ConversionJobModel.findByStatus(status);
    return jobs.map(job => this.convertToDTO(job));
  }

  static async getReviewRequired() {
    const jobs = await ConversionJobModel.findByRequiresReview();
    return jobs.map(job => this.convertToDTO(job));
  }

  static async updateJobStatus(jobId, updates) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }
    
    const updatedJob = await ConversionJobModel.update(jobId, updates);
    return this.convertToDTO(updatedJob);
  }

  static async deleteConversionJob(jobId) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }

    if (job.epub_file_path) {
      try {
        await fs.unlink(job.epub_file_path);
      } catch (error) {
        console.error('Error deleting EPUB file:', error);
      }
    }

    await ConversionJobModel.delete(jobId);
  }

  /**
   * Map AudioSync blockId to actual XHTML element ID
   * @param {Object} sync - AudioSync object with textBlockId/text_block_id/blockId
   * @param {number} pageNumber - Page number
   * @param {Array} textBlocks - Array of text blocks for this page
   * @param {Object} idMapping - Mapping of block IDs to XHTML IDs (from XHTML generation)
   * @returns {string} - The actual XHTML element ID
   */
  static mapSyncIdToXhtmlId(sync, pageNumber, textBlocks, idMapping = {}) {
    // Get the sync's block ID (handle different field names)
    // mapTimingsToBlocks returns { blockId, clipBegin, clipEnd, audioFileName }
    // Editorial syncs return { id, clipBegin, clipEnd, audioFileName }
    const syncBlockId = sync.id || sync.blockId || sync.textBlockId || sync.text_block_id;
    
    if (!syncBlockId) {
      console.warn(`[SMIL] No block ID found in sync:`, sync);
      return null;
    }
    
    // First, check if we have a direct mapping from XHTML generation
    if (idMapping[syncBlockId]) {
      return idMapping[syncBlockId];
    }
    
    // Try to find matching block in textBlocks
    if (syncBlockId && textBlocks && textBlocks.length > 0) {
      const matchingBlock = textBlocks.find(b => {
        const blockId = b.id || b.blockId;
        return blockId === syncBlockId || 
               String(blockId) === String(syncBlockId) ||
               (blockId && String(blockId).includes(String(syncBlockId))) ||
               (syncBlockId && String(syncBlockId).includes(String(blockId)));
      });
      
      if (matchingBlock) {
        // Check if this block ID is in the mapping
        const blockId = matchingBlock.id || matchingBlock.blockId;
        if (idMapping[blockId]) {
          return idMapping[blockId];
        }
        // Fallback: use the block's ID directly (if it matches XHTML pattern)
        if (blockId) {
          return blockId;
        }
      }
    }
    
    // If syncBlockId looks like a valid ID, use it directly
    // (XHTML generation uses block.id directly, so it should match)
    if (syncBlockId && (syncBlockId.startsWith('block_') || syncBlockId.match(/^[a-zA-Z0-9_-]+$/))) {
      return syncBlockId;
    }
    
    // Fallback: try TTS flow text IDs (sequential)
    // This is a last resort - ideally we should track which block maps to which paraIndex
    const syncIndex = sync.index || 0;
    return `tts-flow-${pageNumber}-${syncIndex}`;
  }

  static generateSMILContent(pageNumber, syncs, audioFileName, textData, idMapping = {}, xhtmlFileName = null) {
    // Get the page data to access textBlocks
    const page = textData?.pages?.find(p => p.pageNumber === pageNumber);
    const textBlocks = page?.textBlocks || [];
    
    // Use provided XHTML filename or default
    const xhtmlFile = xhtmlFileName || `page_${pageNumber}.xhtml`;
    
    const sortedSyncs = [...syncs].sort((a, b) => {
      const startA = a.clipBegin ?? a.startTime ?? a.start_time ?? 0;
      const startB = b.clipBegin ?? b.startTime ?? b.start_time ?? 0;
      return startA - startB;
    });
    
    let bodyContent = '';
    let totalDuration = 0;
    let paraIndex = 0; // Track paragraph index for TTS flow text fallback
    
    // Fix audio file path - ensure it's relative to SMIL file location
    // SMIL files are in OEBPS/, audio files should be in OEBPS/audio/
    let audioPath = audioFileName;
    if (!audioPath.startsWith('../') && !audioPath.startsWith('/')) {
      // If audio is in OEBPS/audio/, SMIL in OEBPS/ needs audio/ (same directory level)
      if (audioPath.includes('audio/')) {
        audioPath = audioPath.replace(/^.*?audio\//, 'audio/');
      } else {
        audioPath = `audio/${audioPath}`;
      }
    }
    
    for (let i = 0; i < sortedSyncs.length; i++) {
      const sync = sortedSyncs[i];
      const startTime = sync.clipBegin ?? sync.startTime ?? sync.start_time ?? 0;
      const endTime = sync.clipEnd ?? sync.endTime ?? sync.end_time ?? (startTime + 5);
      
      // FIXED: Map sync blockId to actual XHTML ID
      let blockId = this.mapSyncIdToXhtmlId(sync, pageNumber, textBlocks, idMapping);
      
      // If mapping failed, try sequential TTS flow text IDs
      if (!blockId) {
        console.warn(`[SMIL Page ${pageNumber}] Could not map sync ID ${sync.id || sync.blockId}, using fallback`);
        blockId = `tts-flow-${pageNumber}-${paraIndex}`;
        paraIndex++;
      }
      
      // Escape the blockId for use in URL fragment
      const escapedBlockId = this.escapeHtml(blockId);
      const escapedAudioPath = this.escapeHtml(audioPath);
      
      // Debug logging for first few syncs
      if (i < 3) {
        console.log(`[SMIL Page ${pageNumber}] Sync ${i}: blockId=${blockId}, clipBegin=${startTime}, clipEnd=${endTime}, audioPath=${audioPath}`);
      }
      
      bodyContent += `    <par id="par-${escapedBlockId}">
      <text src="${this.escapeHtml(xhtmlFile)}#${escapedBlockId}"/>
      <audio src="${escapedAudioPath}" clipBegin="${startTime}s" clipEnd="${endTime}s"/>
    </par>\n`;
      
      totalDuration = Math.max(totalDuration, endTime);
    }
    
    // EPUB 3 SMIL structure with <seq> wrapper
    return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <head>
    <meta name="dtb:uid" content="conversion-job-${pageNumber}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalElapsedTime" content="${totalDuration.toFixed(3)}"/>
  </head>
  <body>
    <seq id="seq-page${pageNumber}" epub:textref="${this.escapeHtml(xhtmlFile)}">
${bodyContent}
    </seq>
  </body>
</smil>`;
  }

  static escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static convertToDTO(job) {
    return {
      id: job.id,
      pdfDocumentId: job.pdf_document_id,
      status: job.status,
      currentStep: job.current_step,
      progressPercentage: job.progress_percentage,
      epubFilePath: job.epub_file_path,
      errorMessage: job.error_message,
      confidenceScore: job.confidence_score,
      requiresReview: job.requires_review,
      reviewedBy: job.reviewed_by,
      reviewedAt: job.reviewed_at,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at
    };
  }
}