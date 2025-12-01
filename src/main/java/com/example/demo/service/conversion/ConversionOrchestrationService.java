package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.DocumentStructure;
import com.example.demo.dto.conversion.PageStructure;
import com.example.demo.dto.conversion.TextBlock;
import com.example.demo.model.ConversionJob;
import com.example.demo.model.PdfDocument;
import com.example.demo.repository.ConversionJobRepository;
import com.example.demo.repository.PdfDocumentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.File;
import java.io.IOException;
import java.time.LocalDateTime;

@Service
public class ConversionOrchestrationService {

    private static final Logger logger = LoggerFactory.getLogger(ConversionOrchestrationService.class);

    @Autowired
    private ConversionJobRepository conversionJobRepository;

    @Autowired
    private PdfDocumentRepository pdfDocumentRepository;

    @Autowired
    private TextExtractionService textExtractionService;

    @Autowired
    private OcrService ocrService;

    @Autowired
    private LayoutAnalysisService layoutAnalysisService;

    @Autowired
    private SemanticStructuringService semanticStructuringService;

    @Autowired
    private AccessibilityService accessibilityService;

    @Autowired
    private ContentCleanupService contentCleanupService;

    @Autowired
    private MathAndTablesService mathAndTablesService;

    @Autowired
    private EpubGenerationService epubGenerationService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AsyncConversionService asyncConversionService;

    @Autowired
    private com.example.demo.service.GeminiAiService geminiAiService;

    @Value("${file.upload.dir:uploads}")
    private String uploadDir;

    @Value("${epub.output.dir:epub_output}")
    private String epubOutputDir;

    public void processConversion(Long jobId) {
        logger.info("Starting conversion process for job ID: {}", jobId);
        // Delegate to async service to ensure proper async execution
        asyncConversionService.startAsyncConversion(jobId);
    }

    @Transactional
    public void executeConversion(Long jobId) throws IOException {
        ConversionJob job = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found: " + jobId));

        try {
            logger.info("Setting job {} to IN_PROGRESS", jobId);
            job.setStatus(ConversionJob.JobStatus.IN_PROGRESS);
            job.setCurrentStep(ConversionJob.ConversionStep.STEP_0_CLASSIFICATION);
            conversionJobRepository.save(job);

            // Get PDF document with languages eagerly loaded
            PdfDocument pdfDocument = pdfDocumentRepository.findByIdWithLanguages(job.getPdfDocumentId())
                .orElseThrow(() -> new RuntimeException("PDF document not found"));

            File pdfFile = new File(pdfDocument.getFilePath());
            if (!pdfFile.exists()) {
                throw new IOException("PDF file not found: " + pdfDocument.getFilePath());
            }

            DocumentStructure structure = null;

            // Step 1: Text Extraction & OCR
            logger.info("Job {}: Starting Step 1 - Text Extraction", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_1_TEXT_EXTRACTION, 10);
            if (pdfDocument.getPageQuality() == PdfDocument.PageQuality.SCANNED ||
                pdfDocument.getPageQuality() == PdfDocument.PageQuality.MIXED) {
                // Use OCR for scanned pages
                logger.info("Job {}: Using OCR for scanned/mixed pages", jobId);
                structure = extractWithOcr(pdfFile, pdfDocument);
            } else {
                // Extract text directly
                logger.info("Job {}: Extracting text directly from digital PDF", jobId);
                structure = textExtractionService.extractTextAndStructure(pdfFile, pdfDocument);
            }
            logger.info("Job {}: Text extraction completed, saving intermediate data", jobId);
            saveIntermediateData(job, structure);

            // Step 2: Layout & Structure Understanding
            logger.info("Job {}: Starting Step 2 - Layout Analysis", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_2_LAYOUT_ANALYSIS, 25);
            structure = layoutAnalysisService.analyzeLayout(structure);
            saveIntermediateData(job, structure);
            logger.info("Job {}: Layout analysis completed", jobId);

            // Step 3: Semantic & Educational Structuring
            logger.info("Job {}: Starting Step 3 - Semantic Structuring", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_3_SEMANTIC_STRUCTURING, 40);
            structure = semanticStructuringService.addSemanticStructure(structure);
            saveIntermediateData(job, structure);
            logger.info("Job {}: Semantic structuring completed", jobId);

            // Step 4: Accessibility & Alt Text
            logger.info("Job {}: Starting Step 4 - Accessibility Enhancement", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_4_ACCESSIBILITY, 50);
            structure = accessibilityService.enhanceAccessibility(structure);
            saveIntermediateData(job, structure);
            logger.info("Job {}: Accessibility enhancement completed", jobId);

            // Step 5: Content Cleanup & Normalization
            logger.info("Job {}: Starting Step 5 - Content Cleanup", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_5_CONTENT_CLEANUP, 60);
            structure = contentCleanupService.cleanupAndNormalize(structure);
            saveIntermediateData(job, structure);
            logger.info("Job {}: Content cleanup completed", jobId);

            // Step 5.5: AI-Powered Content Improvement (if enabled)
            if (geminiAiService.isAiEnabled()) {
                logger.info("Job {}: Starting AI-powered content improvement", jobId);
                updateJobProgress(job, ConversionJob.ConversionStep.STEP_5_CONTENT_CLEANUP, 65);
                structure = geminiAiService.improveDocumentStructure(structure);
                saveIntermediateData(job, structure);
                logger.info("Job {}: AI improvement completed", jobId);
            } else {
                logger.info("Job {}: AI is not enabled, skipping AI improvement", jobId);
            }

            // Step 6: Math, Tables & Special Content
            logger.info("Job {}: Starting Step 6 - Math & Tables Processing", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_6_SPECIAL_CONTENT, 75);
            structure = mathAndTablesService.processMathAndTables(structure);
            saveIntermediateData(job, structure);
            logger.info("Job {}: Math & tables processing completed", jobId);

            // Step 7: EPUB3 Generation
            logger.info("Job {}: Starting Step 7 - EPUB Generation", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_7_EPUB_GENERATION, 85);
            String epubPath = epubGenerationService.generateEpub(
                structure,
                epubOutputDir,
                "converted_" + job.getId(),
                pdfFile  // Pass PDF file for fixed-layout EPUB generation
            );
            job.setEpubFilePath(epubPath);
            logger.info("Job {}: EPUB generated at: {}", jobId, epubPath);

            // Step 8: QA & Confidence Scoring
            logger.info("Job {}: Starting Step 8 - QA Review", jobId);
            updateJobProgress(job, ConversionJob.ConversionStep.STEP_8_QA_REVIEW, 95);
            double confidence = calculateConfidenceScore(structure);
            job.setConfidenceScore(confidence);
            job.setRequiresReview(confidence < 0.7);
            logger.info("Job {}: QA review completed, confidence score: {}", jobId, confidence);

            // Complete job
            job.setStatus(ConversionJob.JobStatus.COMPLETED);
            job.setProgressPercentage(100);
            job.setCompletedAt(LocalDateTime.now());
            conversionJobRepository.save(job);

            logger.info("Conversion job {} completed successfully", jobId);

        } catch (Exception e) {
            logger.error("Conversion job {} failed", jobId, e);
            job.setStatus(ConversionJob.JobStatus.FAILED);
            job.setErrorMessage(e.getMessage());
            conversionJobRepository.save(job);
            throw e; // Re-throw to be caught by async wrapper
        }
    }

    @Transactional
    public void handleConversionError(Long jobId, Exception e) {
        try {
            ConversionJob job = conversionJobRepository.findById(jobId).orElse(null);
            if (job != null) {
                job.setStatus(ConversionJob.JobStatus.FAILED);
                job.setErrorMessage(e.getMessage() != null ? e.getMessage() : "Unknown error occurred");
                conversionJobRepository.save(job);
            }
        } catch (Exception ex) {
            logger.error("Failed to update job error status for job {}", jobId, ex);
        }
    }

    private DocumentStructure extractWithOcr(File pdfFile, PdfDocument pdfDocument) throws IOException {
        DocumentStructure structure = textExtractionService.extractTextAndStructure(pdfFile, pdfDocument);
        
        // Perform OCR on scanned pages
        String primaryLanguage = pdfDocument.getLanguages().isEmpty() ? 
            "eng" : pdfDocument.getLanguages().get(0);
        
        for (int i = 0; i < pdfDocument.getScannedPagesCount(); i++) {
            PageStructure ocrPage = ocrService.performOcr(pdfFile, i, primaryLanguage);
            if (i < structure.getPages().size()) {
                structure.getPages().set(i, ocrPage);
            } else {
                structure.getPages().add(ocrPage);
            }
        }
        
        return structure;
    }

    private void updateJobProgress(ConversionJob job, ConversionJob.ConversionStep step, int progress) {
        job.setCurrentStep(step);
        job.setProgressPercentage(progress);
        conversionJobRepository.save(job);
    }

    private void saveIntermediateData(ConversionJob job, DocumentStructure structure) {
        try {
            String json = objectMapper.writeValueAsString(structure);
            job.setIntermediateData(json);
            conversionJobRepository.save(job);
        } catch (Exception e) {
            logger.error("Failed to save intermediate data", e);
        }
    }

    private double calculateConfidenceScore(DocumentStructure structure) {
        // Calculate overall confidence based on various factors
        double totalConfidence = 0.0;
        int count = 0;

        for (PageStructure page : structure.getPages()) {
            if (page.getOcrConfidence() != null) {
                totalConfidence += page.getOcrConfidence();
                count++;
            }
            
            for (TextBlock block : page.getTextBlocks()) {
                if (block.getConfidence() != null) {
                    totalConfidence += block.getConfidence();
                    count++;
                }
            }
        }

        return count > 0 ? totalConfidence / count : 0.8; // Default to 0.8 if no confidence data
    }
}

