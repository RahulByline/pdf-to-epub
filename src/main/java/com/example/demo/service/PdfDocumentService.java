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
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

@Service
public class PdfDocumentService {

    @Autowired
    private PdfDocumentRepository pdfDocumentRepository;
    
    @Autowired
    private PdfAnalysisService pdfAnalysisService;
    
    @Value("${file.upload.dir:uploads}")
    private String uploadDir;

    /**
     * Uploads and analyzes a PDF extracted from a ZIP file
     */
    public PdfUploadResponse uploadAndAnalyzePdfFromZip(MultipartFile file, String zipFileName, String zipFileGroupId) throws IOException {
        PdfUploadResponse response = uploadAndAnalyzePdf(file);
        
        // Update the saved document with ZIP information
        PdfDocument document = pdfDocumentRepository.findById(response.getId())
            .orElseThrow(() -> new RuntimeException("PDF document not found"));
        document.setZipFileName(zipFileName);
        document.setZipFileGroupId(zipFileGroupId);
        pdfDocumentRepository.save(document);
        
        // Update response
        response.setZipFileName(zipFileName);
        response.setZipFileGroupId(zipFileGroupId);
        
        return response;
    }

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

    /**
     * Extracts PDF files from a ZIP archive and uploads them
     */
    public List<PdfUploadResponse> extractAndUploadPdfsFromZip(MultipartFile zipFile) throws IOException {
        List<PdfUploadResponse> uploadedPdfs = new ArrayList<>();
        Path tempDir = null;
        
        // Generate a unique group ID for this ZIP upload
        String zipFileGroupId = UUID.randomUUID().toString();
        String zipFileName = zipFile.getOriginalFilename();
        
        try {
            // Create temporary directory for extraction
            tempDir = Files.createTempDirectory("zip_extract_" + UUID.randomUUID().toString());
            
            // Save ZIP file temporarily
            Path tempZipPath = tempDir.resolve(zipFileName != null ? zipFileName : "temp.zip");
            Files.copy(zipFile.getInputStream(), tempZipPath, StandardCopyOption.REPLACE_EXISTING);
            
            // Extract ZIP and find PDF files
            try (ZipFile zip = new ZipFile(tempZipPath.toFile())) {
                Enumeration<? extends ZipEntry> entries = zip.entries();
                
                while (entries.hasMoreElements()) {
                    ZipEntry entry = entries.nextElement();
                    String entryName = entry.getName();
                    
                    // Skip directories and non-PDF files
                    if (entry.isDirectory() || !entryName.toLowerCase().endsWith(".pdf")) {
                        continue;
                    }
                    
                    // Extract PDF file
                    try (InputStream entryStream = zip.getInputStream(entry)) {
                        // Create a temporary PDF file
                        String pdfFileName = new File(entryName).getName();
                        Path extractedPdfPath = tempDir.resolve(pdfFileName);
                        Files.copy(entryStream, extractedPdfPath, StandardCopyOption.REPLACE_EXISTING);
                        
                        // Create a MultipartFile-like wrapper for the extracted PDF
                        MultipartFile pdfMultipartFile = new ExtractedPdfMultipartFile(
                            extractedPdfPath.toFile(),
                            pdfFileName
                        );
                        
                        // Upload and analyze the PDF with ZIP tracking
                        PdfUploadResponse response = uploadAndAnalyzePdfFromZip(
                            pdfMultipartFile, 
                            zipFileName, 
                            zipFileGroupId
                        );
                        uploadedPdfs.add(response);
                    } catch (Exception e) {
                        // Log error but continue with other PDFs
                        System.err.println("Error processing PDF from ZIP: " + entryName + " - " + e.getMessage());
                    }
                }
            }
            
        } finally {
            // Clean up temporary directory
            if (tempDir != null && Files.exists(tempDir)) {
                try {
                    Files.walk(tempDir)
                        .sorted((a, b) -> b.compareTo(a))
                        .forEach(path -> {
                            try {
                                Files.delete(path);
                            } catch (IOException e) {
                                System.err.println("Failed to delete temp file: " + path);
                            }
                        });
                } catch (IOException e) {
                    System.err.println("Failed to clean up temp directory: " + e.getMessage());
                }
            }
        }
        
        return uploadedPdfs;
    }

    /**
     * Helper class to wrap extracted PDF files as MultipartFile
     */
    private static class ExtractedPdfMultipartFile implements MultipartFile {
        private final File file;
        private final String fileName;
        
        public ExtractedPdfMultipartFile(File file, String fileName) {
            this.file = file;
            this.fileName = fileName;
        }
        
        @Override
        public String getName() {
            return "file";
        }
        
        @Override
        public String getOriginalFilename() {
            return fileName;
        }
        
        @Override
        public String getContentType() {
            return "application/pdf";
        }
        
        @Override
        public boolean isEmpty() {
            return file.length() == 0;
        }
        
        @Override
        public long getSize() {
            return file.length();
        }
        
        @Override
        public byte[] getBytes() throws IOException {
            return Files.readAllBytes(file.toPath());
        }
        
        @Override
        public InputStream getInputStream() throws IOException {
            return Files.newInputStream(file.toPath());
        }
        
        @Override
        public void transferTo(File dest) throws IOException, IllegalStateException {
            Files.copy(file.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /**
     * Gets all PDFs grouped by ZIP file
     */
    @Transactional(readOnly = true)
    public java.util.Map<String, List<PdfUploadResponse>> getPdfsGroupedByZip() {
        List<PdfDocument> allPdfs = pdfDocumentRepository.findAll();
        java.util.Map<String, List<PdfUploadResponse>> grouped = new java.util.HashMap<>();
        List<PdfUploadResponse> ungrouped = new ArrayList<>();
        
        for (PdfDocument doc : allPdfs) {
            PdfUploadResponse response = convertToResponse(doc);
            
            if (doc.getZipFileGroupId() != null && !doc.getZipFileGroupId().isEmpty()) {
                // Group by ZIP file group ID
                grouped.computeIfAbsent(doc.getZipFileGroupId(), k -> new ArrayList<>()).add(response);
            } else {
                // Un grouped PDFs (uploaded individually)
                ungrouped.add(response);
            }
        }
        
        // Add ungrouped PDFs as individual groups
        for (PdfUploadResponse pdf : ungrouped) {
            grouped.put("individual_" + pdf.getId(), java.util.Collections.singletonList(pdf));
        }
        
        return grouped;
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
        response.setZipFileName(document.getZipFileName());
        response.setZipFileGroupId(document.getZipFileGroupId());
        response.setCreatedAt(document.getCreatedAt());
        return response;
    }
}

