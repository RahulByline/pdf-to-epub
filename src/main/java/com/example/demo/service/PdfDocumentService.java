package com.example.demo.service;

import com.example.demo.dto.PdfAnalysisResult;
import com.example.demo.dto.PdfUploadResponse;
import com.example.demo.model.PdfDocument;
import com.example.demo.repository.PdfDocumentRepository;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.UUID;

@Service
public class PdfDocumentService {

    @Autowired
    private PdfDocumentRepository pdfDocumentRepository;
    
    @Autowired
    private PdfAnalysisService pdfAnalysisService;
    
    @Value("${file.upload.dir:uploads}")
    private String uploadDir;

    public PdfUploadResponse uploadAndAnalyzePdf(MultipartFile file) throws IOException {
        // Validate file
        if (file.isEmpty()) {
            throw new IllegalArgumentException("File is empty");
        }
        
        if (!file.getContentType().equals("application/pdf")) {
            throw new IllegalArgumentException("File must be a PDF");
        }
        
        // Generate unique filename
        String originalFileName = file.getOriginalFilename();
        String fileExtension = originalFileName != null && originalFileName.contains(".") 
            ? originalFileName.substring(originalFileName.lastIndexOf(".")) 
            : ".pdf";
        String uniqueFileName = UUID.randomUUID().toString() + fileExtension;
        
        // Save file
        Path uploadPath = Paths.get(uploadDir);
        Path filePath = uploadPath.resolve(uniqueFileName);
        Files.copy(file.getInputStream(), filePath, StandardCopyOption.REPLACE_EXISTING);
        
        // Analyze PDF
        File savedFile = filePath.toFile();
        PdfAnalysisResult analysisResult = pdfAnalysisService.analyzePdf(savedFile);
        
        // Get page count
        int totalPages = 0;
        try (PDDocument document = Loader.loadPDF(savedFile)) {
            totalPages = document.getNumberOfPages();
        }
        
        // Save to database
        PdfDocument pdfDocument = new PdfDocument();
        pdfDocument.setFileName(uniqueFileName);
        pdfDocument.setOriginalFileName(originalFileName);
        pdfDocument.setFilePath(filePath.toString());
        pdfDocument.setFileSize(file.getSize());
        pdfDocument.setTotalPages(totalPages);
        pdfDocument.setDocumentType(analysisResult.getDocumentType());
        pdfDocument.setLanguages(analysisResult.getLanguages());
        pdfDocument.setPageQuality(analysisResult.getPageQuality());
        pdfDocument.setHasTables(analysisResult.getHasTables());
        pdfDocument.setHasFormulas(analysisResult.getHasFormulas());
        pdfDocument.setHasMultiColumn(analysisResult.getHasMultiColumn());
        pdfDocument.setScannedPagesCount(analysisResult.getScannedPagesCount());
        pdfDocument.setDigitalPagesCount(analysisResult.getDigitalPagesCount());
        pdfDocument.setAnalysisMetadata(analysisResult.getAnalysisMetadata());
        
        PdfDocument saved = pdfDocumentRepository.save(pdfDocument);
        
        return convertToResponse(saved);
    }

    @Transactional(readOnly = true)
    public List<PdfUploadResponse> getAllPdfs() {
        return pdfDocumentRepository.findAll().stream()
            .map(this::convertToResponse)
            .toList();
    }

    @Transactional(readOnly = true)
    public PdfUploadResponse getPdfDocument(Long id) {
        PdfDocument document = pdfDocumentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + id));
        return convertToResponse(document);
    }

    @Transactional(readOnly = true)
    public org.springframework.http.ResponseEntity<org.springframework.core.io.Resource> downloadPdf(Long id) {
        PdfDocument document = pdfDocumentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + id));
        
        try {
            Path filePath = Paths.get(document.getFilePath());
            org.springframework.core.io.Resource resource = new org.springframework.core.io.UrlResource(filePath.toUri());
            
            if (resource.exists() && resource.isReadable()) {
                return org.springframework.http.ResponseEntity.ok()
                    .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, 
                        "attachment; filename=\"" + document.getOriginalFileName() + "\"")
                    .header(org.springframework.http.HttpHeaders.CONTENT_TYPE, "application/pdf")
                    .body(resource);
            } else {
                throw new RuntimeException("File not found or not readable");
            }
        } catch (Exception e) {
            throw new RuntimeException("Error downloading file: " + e.getMessage());
        }
    }

    @Transactional(readOnly = true)
    public org.springframework.http.ResponseEntity<PdfAnalysisResult> analyzePdfById(Long id) {
        PdfDocument document = pdfDocumentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + id));
        
        try {
            File file = new File(document.getFilePath());
            PdfAnalysisResult result = pdfAnalysisService.analyzePdf(file);
            return org.springframework.http.ResponseEntity.ok(result);
        } catch (Exception e) {
            throw new RuntimeException("Error analyzing PDF: " + e.getMessage());
        }
    }

    private PdfUploadResponse convertToResponse(PdfDocument document) {
        PdfUploadResponse response = new PdfUploadResponse();
        response.setId(document.getId());
        response.setFileName(document.getFileName());
        response.setOriginalFileName(document.getOriginalFileName());
        response.setFileSize(document.getFileSize());
        response.setTotalPages(document.getTotalPages());
        response.setDocumentType(document.getDocumentType());
        response.setLanguages(document.getLanguages());
        response.setPageQuality(document.getPageQuality());
        response.setHasTables(document.getHasTables());
        response.setHasFormulas(document.getHasFormulas());
        response.setHasMultiColumn(document.getHasMultiColumn());
        response.setScannedPagesCount(document.getScannedPagesCount());
        response.setDigitalPagesCount(document.getDigitalPagesCount());
        response.setCreatedAt(document.getCreatedAt());
        return response;
    }
}

