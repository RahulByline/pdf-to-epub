package com.example.demo.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "audio_syncs")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AudioSync {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "pdf_document_id", nullable = false)
    private Long pdfDocumentId;

    @Column(name = "conversion_job_id", nullable = false)
    private Long conversionJobId;

    @Column(name = "page_number", nullable = false)
    private Integer pageNumber; // PDF page number (1-based)

    @Column(name = "block_id")
    private String blockId; // Optional: specific text block ID for block-level sync

    @Column(name = "start_time", nullable = false)
    private Double startTime; // Start time in seconds

    @Column(name = "end_time", nullable = false)
    private Double endTime; // End time in seconds

    @Column(name = "audio_file_path", nullable = false)
    private String audioFilePath; // Path to the audio file

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes; // Optional notes for this sync point

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}

