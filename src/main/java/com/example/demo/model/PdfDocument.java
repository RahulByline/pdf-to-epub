package com.example.demo.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "pdf_documents")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PdfDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String fileName;

    @Column(nullable = false)
    private String originalFileName;

    @Column(nullable = false)
    private String filePath;

    @Column(nullable = false)
    private Long fileSize;

    @Column(nullable = false)
    private Integer totalPages;

    @Enumerated(EnumType.STRING)
    @Column(name = "document_type")
    private DocumentType documentType;

    @ElementCollection
    @CollectionTable(name = "pdf_languages", joinColumns = @JoinColumn(name = "pdf_document_id"))
    @Column(name = "language")
    private List<String> languages = new ArrayList<>();

    @Enumerated(EnumType.STRING)
    @Column(name = "page_quality")
    private PageQuality pageQuality;

    @Column(name = "has_tables")
    private Boolean hasTables = false;

    @Column(name = "has_formulas")
    private Boolean hasFormulas = false;

    @Column(name = "has_multi_column")
    private Boolean hasMultiColumn = false;

    @Column(name = "scanned_pages_count")
    private Integer scannedPagesCount = 0;

    @Column(name = "digital_pages_count")
    private Integer digitalPagesCount = 0;

    @Column(name = "analysis_metadata", columnDefinition = "TEXT")
    private String analysisMetadata;

    @Column(name = "zip_file_name")
    private String zipFileName; // Name of the ZIP file this PDF was extracted from

    @Column(name = "zip_file_group_id")
    private String zipFileGroupId; // Unique ID to group PDFs from the same ZIP upload

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public enum DocumentType {
        TEXTBOOK,
        WORKBOOK,
        TEACHER_GUIDE,
        ASSESSMENT,
        REFERENCE_MATERIAL,
        OTHER
    }

    public enum PageQuality {
        SCANNED,
        DIGITAL_NATIVE,
        MIXED
    }
}

