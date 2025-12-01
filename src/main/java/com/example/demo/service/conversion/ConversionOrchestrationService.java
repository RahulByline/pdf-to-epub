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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

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
    
    @PersistenceContext
    private EntityManager entityManager;

    @Value("${file.upload.dir:uploads}")
    private String uploadDir;

    @Value("${epub.output.dir:epub_output}")
    private String epubOutputDir;

    public void processConversion(Long jobId) {
        logger.info("Starting conversion process for job ID: {}", jobId);
        // Delegate to async service to ensure proper async execution
        asyncConversionService.startAsyncConversion(jobId);
    }

    /**
     * Executes the conversion process. This method is NOT transactional to avoid timeout issues
     * during long-running conversions. All database operations use separate transactions.
     */
    public void executeConversion(Long jobId) throws IOException {
        // Initialize job status in separate transaction
        initializeJobStatus(jobId);
        
        // Small delay to ensure status is visible before starting conversion
        try {
            Thread.sleep(100); // 100ms delay
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        try {
            // Get PDF document with languages eagerly loaded
            PdfDocument pdfDocument = pdfDocumentRepository.findByIdWithLanguages(
                conversionJobRepository.findById(jobId)
                    .orElseThrow(() -> new RuntimeException("Conversion job not found: " + jobId))
                    .getPdfDocumentId()
            ).orElseThrow(() -> new RuntimeException("PDF document not found"));

            File pdfFile = new File(pdfDocument.getFilePath());
            if (!pdfFile.exists()) {
                throw new IOException("PDF file not found: " + pdfDocument.getFilePath());
            }

            DocumentStructure structure = null;

            // Step 1: Text Extraction & OCR
            logger.info("Job {}: Starting Step 1 - Text Extraction", jobId);
            try {
                updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_1_TEXT_EXTRACTION, 10);
            } catch (Exception progressError) {
                logger.warn("Failed to update progress for job {} at step 1: {}", jobId, progressError.getMessage());
            }
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            
            try {
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
                
                if (structure == null) {
                    throw new RuntimeException("Text extraction returned null structure");
                }
                
                logger.info("Job {}: Text extraction completed, saving intermediate data", jobId);
                saveIntermediateData(jobId, structure);
            } catch (Exception e) {
                logger.error("Job {}: Text extraction failed: {}", jobId, e.getMessage(), e);
                throw new RuntimeException("Text extraction failed: " + e.getMessage(), e);
            }

            // Step 2: Layout & Structure Understanding
            logger.info("Job {}: Starting Step 2 - Layout Analysis", jobId);
            updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_2_LAYOUT_ANALYSIS, 25);
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            structure = layoutAnalysisService.analyzeLayout(structure);
            if (structure == null) {
                throw new RuntimeException("Layout analysis returned null structure");
            }
            saveIntermediateData(jobId, structure);
            logger.info("Job {}: Layout analysis completed", jobId);

            // Step 3: Semantic & Educational Structuring
            logger.info("Job {}: Starting Step 3 - Semantic Structuring", jobId);
            updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_3_SEMANTIC_STRUCTURING, 40);
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            structure = semanticStructuringService.addSemanticStructure(structure);
            saveIntermediateData(jobId, structure);
            logger.info("Job {}: Semantic structuring completed", jobId);

            // Step 4: Accessibility & Alt Text
            logger.info("Job {}: Starting Step 4 - Accessibility Enhancement", jobId);
            updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_4_ACCESSIBILITY, 50);
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            structure = accessibilityService.enhanceAccessibility(structure);
            saveIntermediateData(jobId, structure);
            logger.info("Job {}: Accessibility enhancement completed", jobId);

            // Step 5: Content Cleanup & Normalization
            logger.info("Job {}: Starting Step 5 - Content Cleanup", jobId);
            updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_5_CONTENT_CLEANUP, 60);
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            structure = contentCleanupService.cleanupAndNormalize(structure);
            saveIntermediateData(jobId, structure);
            logger.info("Job {}: Content cleanup completed", jobId);

            // Step 5.5: AI-Powered Content Improvement (if enabled)
            if (geminiAiService.isAiEnabled()) {
                logger.info("Job {}: Starting AI-powered content improvement", jobId);
                updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_5_CONTENT_CLEANUP, 65);
                structure = geminiAiService.improveDocumentStructure(structure);
                saveIntermediateData(jobId, structure);
                logger.info("Job {}: AI improvement completed", jobId);
            } else {
                logger.info("Job {}: AI is not enabled, skipping AI improvement", jobId);
            }

            // Step 6: Math, Tables & Special Content
            logger.info("Job {}: Starting Step 6 - Math & Tables Processing", jobId);
            updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_6_SPECIAL_CONTENT, 75);
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            structure = mathAndTablesService.processMathAndTables(structure);
            saveIntermediateData(jobId, structure);
            logger.info("Job {}: Math & tables processing completed", jobId);

            // Step 6.5: Final AI Enhancement (if enabled) - optimize for EPUB3 readability
            if (geminiAiService.isAiEnabled()) {
                logger.info("Job {}: Final AI optimization for EPUB3 readability", jobId);
                updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_6_SPECIAL_CONTENT, 80);
                structure = geminiAiService.finalizeForEpub3(structure);
                saveIntermediateData(job, structure);
                logger.info("Job {}: Final AI optimization completed", jobId);
            }

            // Step 7: EPUB3 Generation
            logger.info("Job {}: Starting Step 7 - EPUB Generation", jobId);
            updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_7_EPUB_GENERATION, 85);
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            String epubPath = epubGenerationService.generateEpub(
                structure,
                epubOutputDir,
                "converted_" + jobId,
                pdfFile  // Pass PDF file for fixed-layout EPUB generation
            );
            // Update EPUB path in separate transaction
            updateJobEpubPath(jobId, epubPath);
            logger.info("Job {}: EPUB3 generated at: {} (AI-enhanced for optimal readability)", jobId, epubPath);

            // Step 8: QA & Confidence Scoring
            logger.info("Job {}: Starting Step 8 - QA Review", jobId);
            updateJobProgress(jobId, ConversionJob.ConversionStep.STEP_8_QA_REVIEW, 95);
            double confidence = calculateConfidenceScore(structure);
            logger.info("Job {}: QA review completed, confidence score: {}", jobId, confidence);

            // Complete job - use separate transaction to ensure visibility
            completeJob(jobId, confidence);

            logger.info("Conversion job {} completed successfully", jobId);

        } catch (Throwable e) {
            // Catch both Exception and Error types
            logger.error("Conversion job {} failed ({}): {}", jobId, e.getClass().getSimpleName(), 
                        e.getMessage(), e);
            // Update failure status in separate transaction to ensure visibility
            failJob(jobId, e);
            // Re-throw as RuntimeException to be caught by async wrapper
            throw new RuntimeException("Conversion failed", e);
        }
    }

    @Transactional
    public void handleConversionError(Long jobId, Throwable e) {
        try {
            ConversionJob job = conversionJobRepository.findById(jobId).orElse(null);
            if (job != null) {
                job.setStatus(ConversionJob.JobStatus.FAILED);
                String errorMsg = e.getMessage() != null ? e.getMessage() : 
                                 e.getClass().getSimpleName() + " occurred";
                // Truncate very long error messages
                if (errorMsg.length() > 500) {
                    errorMsg = errorMsg.substring(0, 497) + "...";
                }
                job.setErrorMessage(errorMsg);
                conversionJobRepository.save(job);
            }
        } catch (Exception ex) {
            logger.error("Failed to update job error status for job {}", jobId, ex);
        }
    }

    private DocumentStructure extractWithOcr(File pdfFile, PdfDocument pdfDocument) throws IOException {
        DocumentStructure structure = textExtractionService.extractTextAndStructure(pdfFile, pdfDocument);
        
        // Perform OCR on scanned pages with error handling to prevent conversion failure
        String primaryLanguage = pdfDocument.getLanguages().isEmpty() ? 
            "eng" : pdfDocument.getLanguages().get(0);
        
        int consecutiveFailures = 0;
        int maxConsecutiveFailures = 3; // Skip OCR if 3 pages fail in a row
        
        for (int i = 0; i < pdfDocument.getScannedPagesCount(); i++) {
            try {
                PageStructure ocrPage = ocrService.performOcr(pdfFile, i, primaryLanguage);
                
                // Check if OCR actually succeeded (has text or reasonable confidence)
                if (ocrPage.getOcrConfidence() > 0.0 || 
                    (ocrPage.getTextBlocks() != null && !ocrPage.getTextBlocks().isEmpty())) {
                    consecutiveFailures = 0; // Reset counter on success
                    if (i < structure.getPages().size()) {
                        structure.getPages().set(i, ocrPage);
                    } else {
                        structure.getPages().add(ocrPage);
                    }
                } else {
                    consecutiveFailures++;
                    logger.warn("OCR returned empty result for page {}. Consecutive failures: {}", 
                               i, consecutiveFailures);
                    
                    // If too many failures, skip remaining OCR
                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        logger.warn("Skipping OCR for remaining pages due to {} consecutive failures. " +
                                   "Will use image-based fixed-layout EPUB instead.", consecutiveFailures);
                        break;
                    }
                }
            } catch (Throwable e) {
                consecutiveFailures++;
                logger.error("OCR failed for page {} ({}). Consecutive failures: {}. Error: {}", 
                           i, e.getClass().getSimpleName(), consecutiveFailures, e.getMessage());
                
                // If too many failures, skip remaining OCR
                if (consecutiveFailures >= maxConsecutiveFailures) {
                    logger.warn("Skipping OCR for remaining pages due to {} consecutive failures. " +
                               "Will use image-based fixed-layout EPUB instead.", consecutiveFailures);
                    break;
                }
                
                // Keep the original page structure (from text extraction) for failed OCR pages
                // This allows the conversion to continue with image-based fixed-layout
            }
        }
        
        return structure;
    }

    /**
     * Updates job progress in a separate transaction to ensure immediate visibility
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void updateJobProgress(Long jobId, ConversionJob.ConversionStep step, int progress) {
        try {
            // Detach any existing entity to ensure fresh load
            entityManager.clear();
            
            // Reload job in new transaction to get latest state
            ConversionJob currentJob = conversionJobRepository.findById(jobId)
                .orElseThrow(() -> new RuntimeException("Job not found: " + jobId));
            
            // Ensure status is IN_PROGRESS (don't let it revert to PENDING or jump to COMPLETED)
            if (currentJob.getStatus() != ConversionJob.JobStatus.IN_PROGRESS && 
                currentJob.getStatus() != ConversionJob.JobStatus.COMPLETED &&
                currentJob.getStatus() != ConversionJob.JobStatus.FAILED) {
                currentJob.setStatus(ConversionJob.JobStatus.IN_PROGRESS);
                logger.debug("Job {} status changed to IN_PROGRESS during progress update", jobId);
            }
            
            currentJob.setCurrentStep(step);
            currentJob.setProgressPercentage(progress);
            
            // Save and flush immediately (saveAndFlush already flushes)
            conversionJobRepository.saveAndFlush(currentJob);
            
            logger.info("Job {} progress updated: status={}, step={}, progress={}%", 
                       jobId, currentJob.getStatus(), step, progress);
        } catch (Exception e) {
            // Log error but don't throw - we don't want progress update failures to stop conversion
            logger.error("Failed to update job progress for job {} at step {} ({}%): {}", 
                        jobId, step, progress, e.getMessage(), e);
            // Don't re-throw - allow conversion to continue even if progress update fails
        }
    }

    /**
     * Updates EPUB file path in a separate transaction
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void updateJobEpubPath(Long jobId, String epubPath) {
        ConversionJob currentJob = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Job not found: " + jobId));
        currentJob.setEpubFilePath(epubPath);
        conversionJobRepository.saveAndFlush(currentJob);
    }

    /**
     * Cancels a job in a separate transaction to ensure immediate visibility
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void cancelJob(Long jobId) {
        try {
            entityManager.clear();
            ConversionJob currentJob = conversionJobRepository.findById(jobId)
                .orElseThrow(() -> new RuntimeException("Job not found: " + jobId));
            
            if (currentJob.getStatus() == ConversionJob.JobStatus.IN_PROGRESS || 
                currentJob.getStatus() == ConversionJob.JobStatus.PENDING) {
                currentJob.setStatus(ConversionJob.JobStatus.CANCELLED);
                currentJob.setErrorMessage("Cancelled by user");
                conversionJobRepository.saveAndFlush(currentJob);
                logger.info("Job {} marked as CANCELLED", jobId);
            }
        } catch (Exception ex) {
            logger.error("Failed to cancel job {}: {}", jobId, ex.getMessage(), ex);
        }
    }

    /**
     * Checks if a job has been cancelled
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public boolean isJobCancelled(Long jobId) {
        try {
            ConversionJob job = conversionJobRepository.findById(jobId).orElse(null);
            return job != null && job.getStatus() == ConversionJob.JobStatus.CANCELLED;
        } catch (Exception e) {
            logger.warn("Error checking cancellation status for job {}: {}", jobId, e.getMessage());
            return false;
        }
    }

    /**
     * Marks job as failed in a separate transaction to ensure immediate visibility
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void failJob(Long jobId, Throwable e) {
        try {
            entityManager.clear(); // Clear any cached entities
            
            ConversionJob currentJob = conversionJobRepository.findById(jobId)
                .orElseThrow(() -> new RuntimeException("Job not found: " + jobId));
            
            currentJob.setStatus(ConversionJob.JobStatus.FAILED);
            String errorMsg = e.getMessage() != null ? e.getMessage() : 
                            e.getClass().getSimpleName() + " occurred";
            if (errorMsg.length() > 500) {
                errorMsg = errorMsg.substring(0, 497) + "...";
            }
            currentJob.setErrorMessage(errorMsg);
            
            conversionJobRepository.saveAndFlush(currentJob); // saveAndFlush already flushes
            
            logger.error("Job {} marked as FAILED: {}", jobId, errorMsg);
        } catch (Exception ex) {
            logger.error("Failed to update job {} failure status: {}", jobId, ex.getMessage(), ex);
        }
    }

    /**
     * Completes the job in a separate transaction to ensure immediate visibility
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void completeJob(Long jobId, double confidence) {
        ConversionJob currentJob = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Job not found: " + jobId));
        currentJob.setStatus(ConversionJob.JobStatus.COMPLETED);
        currentJob.setProgressPercentage(100);
        currentJob.setCompletedAt(LocalDateTime.now());
        currentJob.setConfidenceScore(confidence);
        currentJob.setRequiresReview(confidence < 0.7);
        conversionJobRepository.saveAndFlush(currentJob);
        logger.info("Job {} marked as COMPLETED with confidence: {}", jobId, confidence);
    }

    /**
     * Initializes job status to IN_PROGRESS in a separate transaction
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void initializeJobStatus(Long jobId) {
        ConversionJob job = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found: " + jobId));
        logger.info("Setting job {} to IN_PROGRESS", jobId);
        job.setStatus(ConversionJob.JobStatus.IN_PROGRESS);
        job.setCurrentStep(ConversionJob.ConversionStep.STEP_0_CLASSIFICATION);
        conversionJobRepository.saveAndFlush(job); // saveAndFlush already flushes, no need for extra flush
        logger.info("Job {} status set to IN_PROGRESS and flushed", jobId);
    }

    /**
     * Saves intermediate data in a separate transaction to avoid timeout issues
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveIntermediateData(Long jobId, DocumentStructure structure) {
        try {
            entityManager.clear(); // Clear any cached entities to ensure fresh load
            ConversionJob job = conversionJobRepository.findById(jobId)
                .orElseThrow(() -> new RuntimeException("Job not found: " + jobId));
            String json = objectMapper.writeValueAsString(structure);
            job.setIntermediateData(json);
            conversionJobRepository.saveAndFlush(job); // saveAndFlush already flushes
        } catch (Exception e) {
            logger.error("Failed to save intermediate data for job {}", jobId, e);
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

