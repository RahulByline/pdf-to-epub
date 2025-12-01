package com.example.demo.controller;

import com.example.demo.dto.conversion.DocumentStructure;
import com.example.demo.model.ConversionJob;
import com.example.demo.model.PdfDocument;
import com.example.demo.repository.ConversionJobRepository;
import com.example.demo.repository.PdfDocumentRepository;
import com.example.demo.service.conversion.ConversionOrchestrationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/conversions")
public class ConversionController {

    private static final Logger logger = LoggerFactory.getLogger(ConversionController.class);

    @Autowired
    private ConversionJobRepository conversionJobRepository;

    @Autowired
    private PdfDocumentRepository pdfDocumentRepository;

    @Autowired
    private ConversionOrchestrationService orchestrationService;

    @Autowired
    private ObjectMapper objectMapper;

    @PostMapping("/start/{pdfDocumentId}")
    public ResponseEntity<ConversionJobResponse> startConversion(@PathVariable Long pdfDocumentId) {
        logger.info("=== CONVERSION START REQUEST RECEIVED for PDF ID: {} ===", pdfDocumentId);
        
        // Verify PDF document exists
        PdfDocument pdfDocument = pdfDocumentRepository.findById(pdfDocumentId)
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + pdfDocumentId));

        // Create conversion job
        ConversionJob job = new ConversionJob();
        job.setPdfDocumentId(pdfDocumentId);
        job.setStatus(ConversionJob.JobStatus.PENDING);
        job.setCurrentStep(ConversionJob.ConversionStep.STEP_0_CLASSIFICATION);
        job.setProgressPercentage(0);
        job = conversionJobRepository.save(job);
        
        logger.info("Created conversion job with ID: {}", job.getId());

        // Start async conversion
        logger.info("Calling orchestrationService.processConversion for job ID: {}", job.getId());
        orchestrationService.processConversion(job.getId());
        logger.info("processConversion called, returning response");

        return ResponseEntity.status(HttpStatus.CREATED)
            .body(convertToResponse(job));
    }

    @PostMapping("/start/bulk")
    public ResponseEntity<BulkConversionResponse> startBulkConversion(@RequestBody BulkConversionRequest request) {
        logger.info("=== BULK CONVERSION START REQUEST for {} PDFs ===", request.getPdfIds().size());
        
        BulkConversionResponse bulkResponse = new BulkConversionResponse();
        List<ConversionJobResponse> successfulJobs = new ArrayList<>();
        List<BulkConversionResponse.ConversionError> errors = new ArrayList<>();
        
        for (Long pdfDocumentId : request.getPdfIds()) {
            try {
                // Verify PDF document exists
                PdfDocument pdfDocument = pdfDocumentRepository.findById(pdfDocumentId)
                    .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + pdfDocumentId));

                // Create conversion job
                ConversionJob job = new ConversionJob();
                job.setPdfDocumentId(pdfDocumentId);
                job.setStatus(ConversionJob.JobStatus.PENDING);
                job.setCurrentStep(ConversionJob.ConversionStep.STEP_0_CLASSIFICATION);
                job.setProgressPercentage(0);
                job = conversionJobRepository.save(job);

                // Start async conversion
                orchestrationService.processConversion(job.getId());
                
                successfulJobs.add(convertToResponse(job));
            } catch (Exception e) {
                errors.add(new BulkConversionResponse.ConversionError(
                    pdfDocumentId,
                    e.getMessage() != null ? e.getMessage() : "Unknown error occurred"
                ));
            }
        }
        
        bulkResponse.setTotalStarted(successfulJobs.size());
        bulkResponse.setTotalFailed(errors.size());
        bulkResponse.setJobs(successfulJobs);
        bulkResponse.setErrors(errors);
        
        return ResponseEntity.status(HttpStatus.CREATED).body(bulkResponse);
    }

    @PostMapping("/retry/{jobId}")
    public ResponseEntity<ConversionJobResponse> retryConversion(@PathVariable Long jobId) {
        logger.info("=== RETRY CONVERSION REQUEST for Job ID: {} ===", jobId);
        
        ConversionJob job = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));

        // Reset job status
        job.setStatus(ConversionJob.JobStatus.PENDING);
        job.setCurrentStep(ConversionJob.ConversionStep.STEP_0_CLASSIFICATION);
        job.setProgressPercentage(0);
        job.setErrorMessage(null);
        job = conversionJobRepository.save(job);
        
        logger.info("Reset job {} to PENDING, calling processConversion", jobId);
        orchestrationService.processConversion(jobId);
        logger.info("processConversion called for retry");

        return ResponseEntity.ok(convertToResponse(job));
    }

    @GetMapping("/{jobId}")
    public ResponseEntity<ConversionJobResponse> getConversionJob(@PathVariable Long jobId) {
        ConversionJob job = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));

        return ResponseEntity.ok(convertToResponse(job));
    }

    @GetMapping("/pdf/{pdfDocumentId}")
    public ResponseEntity<List<ConversionJobResponse>> getConversionsByPdf(@PathVariable Long pdfDocumentId) {
        List<ConversionJob> jobs = conversionJobRepository.findByPdfDocumentId(pdfDocumentId);
        List<ConversionJobResponse> responses = jobs.stream()
            .map(this::convertToResponse)
            .collect(Collectors.toList());

        return ResponseEntity.ok(responses);
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<ConversionJobResponse>> getConversionsByStatus(
            @PathVariable String status) {
        try {
            ConversionJob.JobStatus jobStatus = ConversionJob.JobStatus.valueOf(status.toUpperCase());
            List<ConversionJob> jobs = conversionJobRepository.findByStatus(jobStatus);
            List<ConversionJobResponse> responses = jobs.stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());

            return ResponseEntity.ok(responses);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @GetMapping("/review-required")
    public ResponseEntity<List<ConversionJobResponse>> getReviewRequired() {
        List<ConversionJob> jobs = conversionJobRepository.findByRequiresReviewTrue();
        List<ConversionJobResponse> responses = jobs.stream()
            .map(this::convertToResponse)
            .collect(Collectors.toList());

        return ResponseEntity.ok(responses);
    }

    @GetMapping("/{jobId}/intermediate-data")
    public ResponseEntity<DocumentStructure> getIntermediateData(@PathVariable Long jobId) {
        ConversionJob job = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));

        if (job.getIntermediateData() == null || job.getIntermediateData().isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        try {
            DocumentStructure structure = objectMapper.readValue(
                job.getIntermediateData(),
                DocumentStructure.class
            );
            return ResponseEntity.ok(structure);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PutMapping("/{jobId}/review")
    public ResponseEntity<ConversionJobResponse> markAsReviewed(
            @PathVariable Long jobId,
            @RequestParam String reviewedBy) {
        ConversionJob job = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));

        job.setRequiresReview(false);
        job.setReviewedBy(reviewedBy);
        job.setReviewedAt(java.time.LocalDateTime.now());
        job = conversionJobRepository.save(job);

        return ResponseEntity.ok(convertToResponse(job));
    }

    @GetMapping("/{jobId}/download")
    public ResponseEntity<?> downloadEpub(@PathVariable Long jobId) {
        ConversionJob job = conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));

        if (job.getEpubFilePath() == null || job.getEpubFilePath().isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body("EPUB file not available. Conversion may not be completed yet.");
        }

        try {
            java.nio.file.Path filePath = java.nio.file.Paths.get(job.getEpubFilePath());
            org.springframework.core.io.Resource resource = new org.springframework.core.io.UrlResource(filePath.toUri());
            
            if (resource.exists() && resource.isReadable()) {
                PdfDocument pdfDoc = pdfDocumentRepository.findById(job.getPdfDocumentId()).orElse(null);
                String filename = pdfDoc != null ? 
                    pdfDoc.getOriginalFileName().replace(".pdf", ".epub") : 
                    "converted.epub";
                
                return ResponseEntity.ok()
                    .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, 
                        "attachment; filename=\"" + filename + "\"")
                    .header(org.springframework.http.HttpHeaders.CONTENT_TYPE, "application/epub+zip")
                    .body(resource);
            } else {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body("EPUB file not found on server.");
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("Error downloading EPUB: " + e.getMessage());
        }
    }

    private ConversionJobResponse convertToResponse(ConversionJob job) {
        ConversionJobResponse response = new ConversionJobResponse();
        response.setId(job.getId());
        response.setPdfDocumentId(job.getPdfDocumentId());
        response.setStatus(job.getStatus());
        response.setCurrentStep(job.getCurrentStep());
        response.setProgressPercentage(job.getProgressPercentage());
        response.setEpubFilePath(job.getEpubFilePath());
        response.setErrorMessage(job.getErrorMessage());
        response.setConfidenceScore(job.getConfidenceScore());
        response.setRequiresReview(job.getRequiresReview());
        response.setReviewedBy(job.getReviewedBy());
        response.setReviewedAt(job.getReviewedAt());
        response.setCreatedAt(job.getCreatedAt());
        response.setUpdatedAt(job.getUpdatedAt());
        response.setCompletedAt(job.getCompletedAt());
        return response;
    }

    // DTO for bulk conversion request
    public static class BulkConversionRequest {
        private List<Long> pdfIds;
        
        public List<Long> getPdfIds() {
            return pdfIds;
        }
        
        public void setPdfIds(List<Long> pdfIds) {
            this.pdfIds = pdfIds;
        }
    }

    // DTO for bulk conversion response
    public static class BulkConversionResponse {
        private int totalStarted;
        private int totalFailed;
        private List<ConversionJobResponse> jobs;
        private List<ConversionError> errors;
        
        public int getTotalStarted() {
            return totalStarted;
        }
        
        public void setTotalStarted(int totalStarted) {
            this.totalStarted = totalStarted;
        }
        
        public int getTotalFailed() {
            return totalFailed;
        }
        
        public void setTotalFailed(int totalFailed) {
            this.totalFailed = totalFailed;
        }
        
        public List<ConversionJobResponse> getJobs() {
            return jobs;
        }
        
        public void setJobs(List<ConversionJobResponse> jobs) {
            this.jobs = jobs;
        }
        
        public List<ConversionError> getErrors() {
            return errors;
        }
        
        public void setErrors(List<ConversionError> errors) {
            this.errors = errors;
        }
        
        public static class ConversionError {
            private Long pdfId;
            private String message;
            
            public ConversionError(Long pdfId, String message) {
                this.pdfId = pdfId;
                this.message = message;
            }
            
            public Long getPdfId() {
                return pdfId;
            }
            
            public void setPdfId(Long pdfId) {
                this.pdfId = pdfId;
            }
            
            public String getMessage() {
                return message;
            }
            
            public void setMessage(String message) {
                this.message = message;
            }
        }
    }

    // DTO for response
    public static class ConversionJobResponse {
        private Long id;
        private Long pdfDocumentId;
        private ConversionJob.JobStatus status;
        private ConversionJob.ConversionStep currentStep;
        private Integer progressPercentage;
        private String epubFilePath;
        private String errorMessage;
        private Double confidenceScore;
        private Boolean requiresReview;
        private String reviewedBy;
        private java.time.LocalDateTime reviewedAt;
        private java.time.LocalDateTime createdAt;
        private java.time.LocalDateTime updatedAt;
        private java.time.LocalDateTime completedAt;

        // Getters and setters
        public Long getId() { return id; }
        public void setId(Long id) { this.id = id; }
        public Long getPdfDocumentId() { return pdfDocumentId; }
        public void setPdfDocumentId(Long pdfDocumentId) { this.pdfDocumentId = pdfDocumentId; }
        public ConversionJob.JobStatus getStatus() { return status; }
        public void setStatus(ConversionJob.JobStatus status) { this.status = status; }
        public ConversionJob.ConversionStep getCurrentStep() { return currentStep; }
        public void setCurrentStep(ConversionJob.ConversionStep currentStep) { this.currentStep = currentStep; }
        public Integer getProgressPercentage() { return progressPercentage; }
        public void setProgressPercentage(Integer progressPercentage) { this.progressPercentage = progressPercentage; }
        public String getEpubFilePath() { return epubFilePath; }
        public void setEpubFilePath(String epubFilePath) { this.epubFilePath = epubFilePath; }
        public String getErrorMessage() { return errorMessage; }
        public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
        public Double getConfidenceScore() { return confidenceScore; }
        public void setConfidenceScore(Double confidenceScore) { this.confidenceScore = confidenceScore; }
        public Boolean getRequiresReview() { return requiresReview; }
        public void setRequiresReview(Boolean requiresReview) { this.requiresReview = requiresReview; }
        public String getReviewedBy() { return reviewedBy; }
        public void setReviewedBy(String reviewedBy) { this.reviewedBy = reviewedBy; }
        public java.time.LocalDateTime getReviewedAt() { return reviewedAt; }
        public void setReviewedAt(java.time.LocalDateTime reviewedAt) { this.reviewedAt = reviewedAt; }
        public java.time.LocalDateTime getCreatedAt() { return createdAt; }
        public void setCreatedAt(java.time.LocalDateTime createdAt) { this.createdAt = createdAt; }
        public java.time.LocalDateTime getUpdatedAt() { return updatedAt; }
        public void setUpdatedAt(java.time.LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
        public java.time.LocalDateTime getCompletedAt() { return completedAt; }
        public void setCompletedAt(java.time.LocalDateTime completedAt) { this.completedAt = completedAt; }
    }
}

