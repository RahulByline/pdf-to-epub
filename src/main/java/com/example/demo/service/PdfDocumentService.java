package com.example.demo.service;

import com.example.demo.dto.PdfAnalysisResult;
import com.example.demo.dto.PdfUploadResponse;
import com.example.demo.model.PdfDocument;
import com.example.demo.repository.PdfDocumentRepository;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
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

    @Autowired
    private com.example.demo.repository.ConversionJobRepository conversionJobRepository;

    @Autowired
    private com.example.demo.service.AudioSyncService audioSyncService;
    
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
        return uploadAndAnalyzePdf(file, null);
    }

    public PdfUploadResponse uploadAndAnalyzePdf(MultipartFile file, MultipartFile audioFile) throws IOException {
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
        
        // Handle audio file if provided
        if (audioFile != null && !audioFile.isEmpty()) {
            try {
                String audioOriginalFileName = audioFile.getOriginalFilename();
                System.out.println("Processing audio file: " + audioOriginalFileName + ", size: " + audioFile.getSize());
                String audioFileExtension = audioOriginalFileName != null && audioOriginalFileName.contains(".") 
                    ? audioOriginalFileName.substring(audioOriginalFileName.lastIndexOf(".")) 
                    : ".mp3";
                String uniqueAudioFileName = UUID.randomUUID().toString() + audioFileExtension;
                Path audioFilePath = uploadPath.resolve("audio_" + uniqueAudioFileName);
                Files.copy(audioFile.getInputStream(), audioFilePath, StandardCopyOption.REPLACE_EXISTING);
                
                pdfDocument.setAudioFilePath(audioFilePath.toString());
                pdfDocument.setAudioFileName(audioOriginalFileName);
                pdfDocument.setAudioSynced(false);
                System.out.println("Audio file saved successfully: " + audioFilePath.toString());
            } catch (Exception e) {
                System.err.println("Error processing audio file: " + e.getMessage());
                e.printStackTrace();
                // Continue without audio if there's an error
            }
        } else {
            System.out.println("No audio file provided or audio file is empty");
        }
        
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

    @Transactional(readOnly = true)
    public org.springframework.http.ResponseEntity<org.springframework.core.io.Resource> downloadAudio(Long id, 
            org.springframework.http.HttpHeaders headers) {
        PdfDocument document = pdfDocumentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + id));
        
        if (document.getAudioFilePath() == null || document.getAudioFilePath().isEmpty()) {
            throw new RuntimeException("No audio file associated with this PDF document");
        }
        
        try {
            Path audioPath = Paths.get(document.getAudioFilePath());
            File audioFile = audioPath.toFile();
            
            // Check if file exists and is readable
            if (!audioFile.exists() || !audioFile.canRead()) {
                throw new RuntimeException("Audio file not found or not readable: " + audioPath);
            }
            
            // Check if file is empty
            long fileSize = audioFile.length();
            if (fileSize == 0) {
                throw new RuntimeException("Audio file is empty: " + audioPath);
            }
            
            org.springframework.core.io.Resource resource = new FileSystemResource(audioFile);
            
            // Determine content type based on file extension
            String contentType = "audio/mpeg"; // Default to MP3
            String fileName = document.getAudioFileName();
            if (fileName != null) {
                String extension = fileName.substring(fileName.lastIndexOf(".") + 1).toLowerCase();
                switch (extension) {
                    case "mp3":
                        contentType = "audio/mpeg";
                        break;
                    case "wav":
                        contentType = "audio/wav";
                        break;
                    case "ogg":
                        contentType = "audio/ogg";
                        break;
                    case "m4a":
                        contentType = "audio/mp4";
                        break;
                }
            }
            
            // Build response with proper headers for Range request support
            org.springframework.http.ResponseEntity.BodyBuilder builder = org.springframework.http.ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, 
                    "inline; filename=\"" + (document.getAudioFileName() != null ? document.getAudioFileName() : "audio") + "\"")
                .header(org.springframework.http.HttpHeaders.CONTENT_TYPE, contentType)
                .header(org.springframework.http.HttpHeaders.ACCEPT_RANGES, "bytes")
                .contentLength(fileSize);
            
            return builder.body(resource);
        } catch (Exception e) {
            throw new RuntimeException("Error downloading audio file: " + e.getMessage());
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

    @Transactional
    public void deletePdfDocument(Long id) throws IOException {
        PdfDocument document = pdfDocumentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + id));
        
        // Delete PDF file
        if (document.getFilePath() != null) {
            try {
                Path pdfPath = Paths.get(document.getFilePath());
                if (Files.exists(pdfPath)) {
                    Files.delete(pdfPath);
                    System.out.println("Deleted PDF file: " + pdfPath);
                }
            } catch (IOException e) {
                System.err.println("Error deleting PDF file: " + e.getMessage());
                // Continue with deletion even if file deletion fails
            }
        }
        
        // Delete audio file
        if (document.getAudioFilePath() != null) {
            try {
                Path audioPath = Paths.get(document.getAudioFilePath());
                if (Files.exists(audioPath)) {
                    Files.delete(audioPath);
                    System.out.println("Deleted audio file: " + audioPath);
                }
            } catch (IOException e) {
                System.err.println("Error deleting audio file: " + e.getMessage());
                // Continue with deletion even if file deletion fails
            }
        }
        
        // Delete associated conversion jobs and their EPUB files
        List<com.example.demo.model.ConversionJob> jobs = conversionJobRepository.findByPdfDocumentId(id);
        for (com.example.demo.model.ConversionJob job : jobs) {
            // Delete EPUB file if it exists
            if (job.getEpubFilePath() != null) {
                try {
                    java.io.File epubFile = new java.io.File(job.getEpubFilePath());
                    if (epubFile.exists()) {
                        epubFile.delete();
                        System.out.println("Deleted EPUB file: " + job.getEpubFilePath());
                    }
                } catch (Exception e) {
                    System.err.println("Error deleting EPUB file: " + e.getMessage());
                }
            }
            
            // Delete associated audio syncs
            try {
                audioSyncService.deleteAudioSyncsByJobId(job.getId());
            } catch (Exception e) {
                System.err.println("Error deleting audio syncs: " + e.getMessage());
            }
            
            // Delete the job
            conversionJobRepository.delete(job);
            System.out.println("Deleted conversion job: " + job.getId());
        }
        
        // Delete from database
        pdfDocumentRepository.delete(document);
        System.out.println("Deleted PDF document from database: " + id);
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
        response.setAudioFilePath(document.getAudioFilePath());
        response.setAudioFileName(document.getAudioFileName());
        response.setAudioSynced(document.getAudioSynced());
        response.setCreatedAt(document.getCreatedAt());
        return response;
    }
}

