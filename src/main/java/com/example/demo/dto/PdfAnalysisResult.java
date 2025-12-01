package com.example.demo.dto;

import com.example.demo.model.PdfDocument;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class PdfAnalysisResult {
    private PdfDocument.DocumentType documentType;
    private List<String> languages;
    private PdfDocument.PageQuality pageQuality;
    private Boolean hasTables;
    private Boolean hasFormulas;
    private Boolean hasMultiColumn;
    private Integer scannedPagesCount;
    private Integer digitalPagesCount;
    private String analysisMetadata;
}

