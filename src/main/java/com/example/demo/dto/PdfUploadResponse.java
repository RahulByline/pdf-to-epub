package com.example.demo.dto;

import com.example.demo.model.PdfDocument;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class PdfUploadResponse {
    private Long id;
    private String fileName;
    private String originalFileName;
    private Long fileSize;
    private Integer totalPages;
    private PdfDocument.DocumentType documentType;
    private List<String> languages;
    private PdfDocument.PageQuality pageQuality;
    private Boolean hasTables;
    private Boolean hasFormulas;
    private Boolean hasMultiColumn;
    private Integer scannedPagesCount;
    private Integer digitalPagesCount;
    private String zipFileName; // Name of the ZIP file this PDF was extracted from
    private String zipFileGroupId; // Unique ID to group PDFs from the same ZIP upload
    private String audioFilePath; // Path to the associated audio file
    private String audioFileName; // Original name of the audio file
    private Boolean audioSynced; // Whether audio has been synchronized
    private LocalDateTime createdAt;
}

