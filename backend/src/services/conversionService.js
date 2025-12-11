import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { getEpubOutputDir, getHtmlIntermediateDir } from '../config/fileStorage.js';
import { PdfExtractionService } from './pdfExtractionService.js';
import { GeminiService } from './geminiService.js';
import { JobConcurrencyService } from './jobConcurrencyService.js';

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

  static async generateFixedLayoutEpub(jobId, textData, structuredContent, pageImagesData, documentTitle, pdfFilePath = null) {
    const { AudioSyncModel } = await import('../models/AudioSync.js');
    const audioSyncs = await AudioSyncModel.findByJobId(jobId).catch(() => []);
    const hasAudio = audioSyncs && audioSyncs.length > 0;
    
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
    
    const pageImages = pageImagesData.images || [];
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
    // Track mapping from source block IDs to actual XHTML IDs per page (for SMIL/audio and TTS alignment)
    let pageIdMappings = {};
    
    for (let i = 0; i < pageImages.length; i++) {
      const pageImage = pageImages[i];
      const epubPageNum = pageImage.pageNumber;
      const pdfPageNum = pageImage.pdfPageNumber || pageImage.pageNumber;
      
      let page = null;
      page = textData.pages.find(p => p.pageNumber === epubPageNum);
      
      if (!page) {
        page = textData.pages.find(p => p.pageNumber === pdfPageNum);
      }
      
      if (!page && textData.pages[epubPageNum - 1]) {
        const pageByIndex = textData.pages[epubPageNum - 1];
        if (Math.abs((pageByIndex.pageNumber || 0) - epubPageNum) <= 2) {
          console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): Using text from index ${epubPageNum - 1} (textData.pageNumber=${pageByIndex.pageNumber})`);
          page = pageByIndex;
        }
      }
      
      if (!page && textData.pages[pdfPageNum - 1]) {
        const pageByIndex = textData.pages[pdfPageNum - 1];
        if (Math.abs((pageByIndex.pageNumber || 0) - pdfPageNum) <= 2) {
          console.log(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): Using text from PDF index ${pdfPageNum - 1} (textData.pageNumber=${pageByIndex.pageNumber})`);
          page = pageByIndex;
        }
      }
      
      if (!page) {
        const anyPageWithText = textData.pages.find(p => p.text && p.text.trim().length > 0);
        if (anyPageWithText) {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): No matching text data, using text from page ${anyPageWithText.pageNumber} for read-aloud`);
          page = {
            pageNumber: epubPageNum,
            text: anyPageWithText.text,
            textBlocks: anyPageWithText.textBlocks || [],
            charCount: anyPageWithText.charCount || 0,
            width: pageWidthPoints,
            height: pageHeightPoints
          };
        } else {
          console.warn(`[Job ${jobId}] EPUB Page ${epubPageNum} (PDF Page ${pdfPageNum}): No text data found, creating page with placeholder text for read-aloud`);
          page = {
            pageNumber: epubPageNum,
            text: `Page ${epubPageNum}`,
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
      console.log(`[Job ${jobId}] Generating EPUB page ${epubPageNum} (PDF page ${pdfPageNum}, textData.pageNumber=${page.pageNumber}): text length=${page.text?.length || 0}, textBlocks=${page.textBlocks?.length || 0}, preview="${textPreview}..."`);
      
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
      const { html: rawPageXhtml, idMapping } = this.generateFixedLayoutPageXHTML(
        page,
        pageImage,
        actualPageNum,
        actualPageWidthPoints,
        actualPageHeightPoints,
        actualRenderedWidth,
        actualRenderedHeight,
        pageCss,
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
      
      const itemId = `page${actualPageNum}`;
      const hasSmil = audioSyncs && audioSyncs.some(s => (s.pageNumber || s.page_number) === actualPageNum);
      const smilFileName = `page_${actualPageNum}.smil`;
      // Add properties for fixed-layout pages with audio
      const pageProperties = hasAudio ? ` properties="rendition:page-spread-center"` : '';
      manifestItems.push(`<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml"${pageProperties}/>`);
      // Add media-overlay to spine items when SMIL exists
      const spineMediaOverlay = hasSmil ? ` media-overlay="smil-${itemId}"` : '';
      spineItems.push(`<itemref idref="${itemId}"${spineMediaOverlay}/>`);
      tocItems.push(`<li><a href="${fileName}">Page ${actualPageNum}</a></li>`);
    }
    
    for (const img of pageImages) {
      try {
        const imageData = await fs.readFile(img.path);
        const imageFileName = img.fileName.replace(/^image\//, '');
        const imagePath = `image/${imageFileName}`;
        zip.file(`OEBPS/${imagePath}`, imageData);
        
        const imageId = `page-img-${img.pageNumber}`;
        const imageMimeType = img.fileName.toLowerCase().endsWith('.jpg') || img.fileName.toLowerCase().endsWith('.jpeg') 
          ? 'image/jpeg' 
          : 'image/png';
        manifestItems.push(`<item id="${imageId}" href="${imagePath}" media-type="${imageMimeType}"/>`);
        
        img.epubPath = imagePath;
      } catch (imgError) {
        console.warn(`[Job ${jobId}] Could not add page image ${img.fileName}:`, imgError.message);
      }
    }
    
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
    const smilFileNames = [];
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
            const smilContent = this.generateSMILContent(parseInt(pageNum), pageSyncs, audioFileName, textData, pageIdMapping);
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
    
    if (textBlocks.length === 0 && page.text && page.text.trim().length > 0) {
      let cleanText = page.text;
      cleanText = cleanText.replace(/^(Page\s+)?\d+\s*$/gm, '');
      cleanText = cleanText.replace(/^Page\s+\d+[:\-]?\s*/gmi, '');
      cleanText = cleanText.trim();
      
      textBlocks = GeminiService.createSimpleTextBlocks(
        cleanText || page.text,
        pageNumber,
        pageWidthPoints,
        pageHeightPoints
      );
    }
    
    if (textBlocks.length === 0 && page.text && page.text.trim().length > 0) {
      textBlocks = [{
        id: `emergency_block_${pageNumber}`,
        text: page.text.trim(),
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
    
    // Start text-content div
    html += `
    <div class="text-content">`;
    
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
     <p id="${blockId}">${escapedText}</p>`;
          
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
     <p id="${blockId}">${cleanPara}</p>`;
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
     <p id="${blockId}">${cleanPara}</p>`;
          paraIndex++;
        }
      }
      
      // Final fallback: single paragraph
      if (paraIndex === 0) {
        const blockId = `ocr_block_${pageNumber}_0`;
        html += `
     <p id="${blockId}">${escapedText}</p>`;
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
     <p id="${blockId}">${escapedFallback}</p>`;
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
    <meta property="rendition:layout">${hasAudio ? 'pre-paginated' : 'reflowable'}</meta>
    <meta property="rendition:orientation">${hasAudio ? 'auto' : 'portrait'}</meta>
    <meta property="rendition:spread">none</meta>
    ${hasAudio ? `<meta property="rendition:viewport">width=device-width, height=device-height</meta>` : ''}
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
    <itemref idref="nav" linear="no"/>
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
    const syncBlockId = sync.textBlockId || sync.text_block_id || sync.blockId;
    
    // First, check if we have a direct mapping from XHTML generation
    if (idMapping[syncBlockId]) {
      return idMapping[syncBlockId];
    }
    
    // Try to find matching block in textBlocks
    if (syncBlockId && textBlocks && textBlocks.length > 0) {
      const matchingBlock = textBlocks.find(b => 
        b.id === syncBlockId || 
        b.blockId === syncBlockId ||
        (b.id && String(b.id).includes(String(syncBlockId))) ||
        (b.blockId && String(b.blockId).includes(String(syncBlockId)))
      );
      
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
    
    // Fallback: try TTS flow text IDs (sequential)
    // This is a last resort - ideally we should track which block maps to which paraIndex
    const syncIndex = sync.index || 0;
    return `tts-flow-${pageNumber}-${syncIndex}`;
  }

  static generateSMILContent(pageNumber, syncs, audioFileName, textData, idMapping = {}) {
    // Get the page data to access textBlocks
    const page = textData?.pages?.find(p => p.pageNumber === pageNumber);
    const textBlocks = page?.textBlocks || [];
    
    const sortedSyncs = [...syncs].sort((a, b) => {
      const startA = a.startTime || a.start_time || 0;
      const startB = b.startTime || b.start_time || 0;
      return startA - startB;
    });
    
    let bodyContent = '';
    let totalDuration = 0;
    let paraIndex = 0; // Track paragraph index for TTS flow text fallback
    
    // Fix audio file path - ensure it's relative to SMIL file location
    // SMIL files are in OEBPS/, audio files should be in OEBPS/audio/
    let audioPath = audioFileName;
    if (!audioPath.startsWith('../') && !audioPath.startsWith('/')) {
      // If audio is in OEBPS/audio/, SMIL in OEBPS/ needs ../audio/ or just audio/
      if (audioPath.includes('audio/')) {
        audioPath = audioPath.replace(/^.*?audio\//, 'audio/');
      } else {
        audioPath = `audio/${audioPath}`;
      }
    }
    
    for (let i = 0; i < sortedSyncs.length; i++) {
      const sync = sortedSyncs[i];
      const startTime = sync.startTime || sync.start_time || 0;
      const endTime = sync.endTime || sync.end_time || (startTime + 5);
      
      // FIXED: Map sync blockId to actual XHTML ID
      let blockId = this.mapSyncIdToXhtmlId(sync, pageNumber, textBlocks, idMapping);
      
      // If mapping failed, try sequential TTS flow text IDs
      if (!blockId || blockId.startsWith('tts-flow-') && paraIndex < 10) {
        blockId = `tts-flow-${pageNumber}-${paraIndex}`;
        paraIndex++;
      }
      
      // Escape the blockId for use in URL fragment
      const escapedBlockId = this.escapeHtml(blockId);
      const escapedAudioPath = this.escapeHtml(audioPath);
      
      bodyContent += `    <par id="par-${escapedBlockId}">
      <text src="page_${pageNumber}.xhtml#${escapedBlockId}"/>
      <audio src="${escapedAudioPath}" clipBegin="${startTime}s" clipEnd="${endTime}s"/>
    </par>\n`;
      
      totalDuration = Math.max(totalDuration, endTime);
    }
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <head>
    <meta name="dtb:uid" content="conversion-job-${pageNumber}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalElapsedTime" content="${totalDuration}"/>
  </head>
  <body>
${bodyContent}
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