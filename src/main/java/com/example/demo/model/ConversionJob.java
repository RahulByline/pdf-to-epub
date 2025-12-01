package com.example.demo.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "conversion_jobs")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConversionJob {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "pdf_document_id", nullable = false)
    private Long pdfDocumentId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private JobStatus status = JobStatus.PENDING;

    @Enumerated(EnumType.STRING)
    @Column(name = "current_step")
    private ConversionStep currentStep;

    @Column(name = "progress_percentage")
    private Integer progressPercentage = 0;

    @Column(name = "epub_file_path")
    private String epubFilePath;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "intermediate_data", columnDefinition = "LONGTEXT")
    private String intermediateData; // JSON for storing intermediate results

    @Column(name = "confidence_score")
    private Double confidenceScore;

    @Column(name = "requires_review")
    private Boolean requiresReview = false;

    @Column(name = "reviewed_by")
    private String reviewedBy;

    @Column(name = "reviewed_at")
    private LocalDateTime reviewedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    public enum JobStatus {
        PENDING,
        IN_PROGRESS,
        COMPLETED,
        FAILED,
        REVIEW_REQUIRED,
        CANCELLED
    }

    public enum ConversionStep {
        STEP_0_CLASSIFICATION,
        STEP_1_TEXT_EXTRACTION,
        STEP_2_LAYOUT_ANALYSIS,
        STEP_3_SEMANTIC_STRUCTURING,
        STEP_4_ACCESSIBILITY,
        STEP_5_CONTENT_CLEANUP,
        STEP_6_SPECIAL_CONTENT,
        STEP_7_EPUB_GENERATION,
        STEP_8_QA_REVIEW
    }
}

