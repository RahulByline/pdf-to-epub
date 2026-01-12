import express from 'express';
import { ChapterConfigService } from '../services/chapterConfigService.js';
import { ChapterDetectionService } from '../services/chapterDetectionService.js';
import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';

const router = express.Router();

/**
 * GET /api/chapters/detect/:jobId
 * Auto-detect chapters for a conversion job
 */
router.get('/detect/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { useAI = true, respectPageNumbers = true } = req.query;
    
    // Get job and PDF information
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Conversion job not found' });
    }
    
    const pdf = await PdfDocumentModel.findById(job.pdfDocumentId);
    if (!pdf) {
      return res.status(404).json({ error: 'PDF document not found' });
    }
    
    // For now, return a mock response since we'd need the actual extracted pages
    // In a real implementation, you'd load the extracted page data
    const mockPages = Array.from({ length: pdf.totalPages || 10 }, (_, i) => ({
      pageNumber: i + 1,
      textBlocks: [
        {
          text: i === 0 ? 'Introduction' : i === 5 ? 'Chapter 1: Getting Started' : `Page ${i + 1} content`,
          type: i === 0 || i === 5 ? 'heading1' : 'paragraph',
          fontSize: i === 0 || i === 5 ? 18 : 12,
          x: 50,
          y: 100
        }
      ]
    }));
    
    const chapters = await ChapterDetectionService.detectChapters(mockPages, {
      useAI: useAI === 'true',
      respectPageNumbers: respectPageNumbers === 'true'
    });
    
    res.json({
      success: true,
      jobId,
      chapters: chapters.map(chapter => ({
        title: chapter.title,
        startPage: chapter.startPage,
        endPage: chapter.endPage,
        pageCount: chapter.pages.length,
        confidence: chapter.confidence,
        reason: chapter.reason
      }))
    });
  } catch (error) {
    console.error('Chapter detection error:', error);
    res.status(500).json({ error: 'Failed to detect chapters' });
  }
});

/**
 * POST /api/chapters/config/:documentId
 * Save manual chapter configuration
 */
router.post('/config/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { chapters, title } = req.body;
    
    if (!chapters || !Array.isArray(chapters)) {
      return res.status(400).json({ error: 'Chapters array is required' });
    }
    
    // Validate configuration
    const totalPages = req.body.totalPages || 100; // Should be provided
    const validation = ChapterConfigService.validateConfiguration(chapters, totalPages);
    
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid chapter configuration',
        errors: validation.errors,
        warnings: validation.warnings
      });
    }
    
    // Save configuration
    const config = {
      title: title || 'Manual Configuration',
      chapters: chapters.map((chapter, index) => ({
        title: chapter.title || `Chapter ${index + 1}`,
        startPage: chapter.startPage,
        endPage: chapter.endPage,
        pageRange: chapter.pageRange,
        pages: chapter.pages,
        order: index + 1
      }))
    };
    
    await ChapterConfigService.saveChapterConfig(documentId, config.chapters);
    
    res.json({
      success: true,
      documentId,
      message: 'Chapter configuration saved successfully',
      validation
    });
  } catch (error) {
    console.error('Save chapter config error:', error);
    res.status(500).json({ error: 'Failed to save chapter configuration' });
  }
});

/**
 * GET /api/chapters/config/:documentId
 * Get chapter configuration for a document
 */
router.get('/config/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    
    const config = await ChapterConfigService.loadChapterConfig(documentId);
    
    if (!config) {
      return res.status(404).json({ error: 'Chapter configuration not found' });
    }
    
    res.json({
      success: true,
      documentId,
      config
    });
  } catch (error) {
    console.error('Load chapter config error:', error);
    res.status(500).json({ error: 'Failed to load chapter configuration' });
  }
});

/**
 * DELETE /api/chapters/config/:documentId
 * Delete chapter configuration
 */
router.delete('/config/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    
    const success = await ChapterConfigService.deleteConfiguration(documentId);
    
    if (!success) {
      return res.status(404).json({ error: 'Chapter configuration not found' });
    }
    
    res.json({
      success: true,
      message: 'Chapter configuration deleted successfully'
    });
  } catch (error) {
    console.error('Delete chapter config error:', error);
    res.status(500).json({ error: 'Failed to delete chapter configuration' });
  }
});

/**
 * GET /api/chapters/configs
 * List all chapter configurations
 */
router.get('/configs', async (req, res) => {
  try {
    const configs = await ChapterConfigService.getAllConfigurations();
    
    res.json({
      success: true,
      configs
    });
  } catch (error) {
    console.error('List chapter configs error:', error);
    res.status(500).json({ error: 'Failed to list chapter configurations' });
  }
});

/**
 * POST /api/chapters/auto-generate
 * Auto-generate chapter configuration based on page count
 */
router.post('/auto-generate', async (req, res) => {
  try {
    const { totalPages, pagesPerChapter = 10, documentId } = req.body;
    
    if (!totalPages || totalPages < 1) {
      return res.status(400).json({ error: 'Valid totalPages is required' });
    }
    
    const config = ChapterConfigService.autoGenerateConfig(totalPages, pagesPerChapter);
    
    // Optionally save the configuration
    if (documentId) {
      await ChapterConfigService.saveChapterConfig(documentId, config);
    }
    
    res.json({
      success: true,
      totalPages,
      pagesPerChapter,
      chapters: config,
      message: documentId ? 'Configuration generated and saved' : 'Configuration generated'
    });
  } catch (error) {
    console.error('Auto-generate chapters error:', error);
    res.status(500).json({ error: 'Failed to auto-generate chapters' });
  }
});

/**
 * POST /api/chapters/validate
 * Validate chapter configuration
 */
router.post('/validate', async (req, res) => {
  try {
    const { chapters, totalPages } = req.body;
    
    if (!chapters || !Array.isArray(chapters)) {
      return res.status(400).json({ error: 'Chapters array is required' });
    }
    
    if (!totalPages || totalPages < 1) {
      return res.status(400).json({ error: 'Valid totalPages is required' });
    }
    
    const validation = ChapterConfigService.validateConfiguration(chapters, totalPages);
    
    res.json({
      success: true,
      validation
    });
  } catch (error) {
    console.error('Validate chapters error:', error);
    res.status(500).json({ error: 'Failed to validate chapter configuration' });
  }
});
export default router;