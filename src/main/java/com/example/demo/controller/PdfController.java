package com.example.demo.controller;

import com.example.demo.dto.BulkUploadResponse;
import com.example.demo.dto.PdfUploadResponse;
import com.example.demo.service.PdfDocumentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/pdfs")
public class PdfController {

    @Autowired
    private PdfDocumentService pdfDocumentService;

    @PostMapping("/upload")
    public ResponseEntity<?> uploadPdf(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "audioFile", required = false) MultipartFile audioFile) {
        try {
            // Check if file is a ZIP file
            if (file.getContentType() != null && 
                (file.getContentType().equals("application/zip") || 
                 file.getContentType().equals("application/x-zip-compressed") ||
                 file.getOriginalFilename() != null && file.getOriginalFilename().toLowerCase().endsWith(".zip"))) {
                // Extract and process ZIP file - return bulk response
                List<PdfUploadResponse> uploadedPdfs = pdfDocumentService.extractAndUploadPdfsFromZip(file);
                BulkUploadResponse bulkResponse = new BulkUploadResponse();
                bulkResponse.setTotalUploaded(uploadedPdfs.size());
                bulkResponse.setTotalFailed(0);
                bulkResponse.setSuccessfulUploads(uploadedPdfs);
                bulkResponse.setErrors(new ArrayList<>());
                return ResponseEntity.status(HttpStatus.CREATED).body(bulkResponse);
            } else {
                // Process as regular PDF
                PdfUploadResponse response = pdfDocumentService.uploadAndAnalyzePdf(file, audioFile);
                return ResponseEntity.status(HttpStatus.CREATED).body(response);
            }
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Invalid request"));
        } catch (Exception e) {
            e.printStackTrace(); // Log the error for debugging
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Internal server error"));
        }
    }

    @PostMapping("/upload/bulk")
    public ResponseEntity<BulkUploadResponse> uploadBulkPdfs(@RequestParam("files") MultipartFile[] files) {
        BulkUploadResponse bulkResponse = new BulkUploadResponse();
        List<PdfUploadResponse> successfulUploads = new ArrayList<>();
        List<BulkUploadResponse.UploadError> errors = new ArrayList<>();
        
        for (MultipartFile file : files) {
            try {
                // Check if file is a ZIP file
                if (file.getContentType() != null && 
                    (file.getContentType().equals("application/zip") || 
                     file.getContentType().equals("application/x-zip-compressed") ||
                     file.getOriginalFilename() != null && file.getOriginalFilename().toLowerCase().endsWith(".zip"))) {
                    // Extract and process ZIP file
                    List<PdfUploadResponse> zipResults = pdfDocumentService.extractAndUploadPdfsFromZip(file);
                    successfulUploads.addAll(zipResults);
                } else {
                    // Process as regular PDF
                    PdfUploadResponse response = pdfDocumentService.uploadAndAnalyzePdf(file);
                    successfulUploads.add(response);
                }
            } catch (Exception e) {
                errors.add(new BulkUploadResponse.UploadError(
                    file.getOriginalFilename(),
                    e.getMessage() != null ? e.getMessage() : "Unknown error occurred"
                ));
            }
        }
        
        bulkResponse.setTotalUploaded(successfulUploads.size());
        bulkResponse.setTotalFailed(errors.size());
        bulkResponse.setSuccessfulUploads(successfulUploads);
        bulkResponse.setErrors(errors);
        
        return ResponseEntity.status(HttpStatus.OK).body(bulkResponse);
    }

    @PostMapping("/upload/zip")
    public ResponseEntity<BulkUploadResponse> uploadZipFile(@RequestParam("file") MultipartFile zipFile) {
        BulkUploadResponse bulkResponse = new BulkUploadResponse();
        List<PdfUploadResponse> successfulUploads = new ArrayList<>();
        List<BulkUploadResponse.UploadError> errors = new ArrayList<>();
        
        try {
            // Validate ZIP file
            if (zipFile.isEmpty()) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(bulkResponse);
            }
            
            if (zipFile.getContentType() != null && 
                !zipFile.getContentType().equals("application/zip") && 
                !zipFile.getContentType().equals("application/x-zip-compressed") &&
                (zipFile.getOriginalFilename() == null || !zipFile.getOriginalFilename().toLowerCase().endsWith(".zip"))) {
                errors.add(new BulkUploadResponse.UploadError(
                    zipFile.getOriginalFilename(),
                    "File must be a ZIP archive"
                ));
                bulkResponse.setTotalUploaded(0);
                bulkResponse.setTotalFailed(1);
                bulkResponse.setErrors(errors);
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(bulkResponse);
            }
            
            // Extract and process ZIP file
            successfulUploads = pdfDocumentService.extractAndUploadPdfsFromZip(zipFile);
            
            bulkResponse.setTotalUploaded(successfulUploads.size());
            bulkResponse.setTotalFailed(errors.size());
            bulkResponse.setSuccessfulUploads(successfulUploads);
            bulkResponse.setErrors(errors);
            
            return ResponseEntity.status(HttpStatus.OK).body(bulkResponse);
        } catch (Exception e) {
            errors.add(new BulkUploadResponse.UploadError(
                zipFile.getOriginalFilename(),
                e.getMessage() != null ? e.getMessage() : "Unknown error occurred"
            ));
            bulkResponse.setTotalUploaded(0);
            bulkResponse.setTotalFailed(1);
            bulkResponse.setErrors(errors);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(bulkResponse);
        }
    }

    @GetMapping
    public ResponseEntity<List<PdfUploadResponse>> getAllPdfs() {
        try {
            List<PdfUploadResponse> pdfs = pdfDocumentService.getAllPdfs();
            return ResponseEntity.ok(pdfs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/grouped")
    public ResponseEntity<java.util.Map<String, List<PdfUploadResponse>>> getPdfsGroupedByZip() {
        try {
            java.util.Map<String, List<PdfUploadResponse>> grouped = pdfDocumentService.getPdfsGroupedByZip();
            return ResponseEntity.ok(grouped);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<PdfUploadResponse> getPdfDocument(@PathVariable Long id) {
        try {
            PdfUploadResponse response = pdfDocumentService.getPdfDocument(id);
            return ResponseEntity.ok(response);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<?> downloadPdf(@PathVariable Long id) {
        try {
            return pdfDocumentService.downloadPdf(id);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
    }

    @PostMapping("/{id}/analyze")
    public ResponseEntity<?> analyzePdf(@PathVariable Long id) {
        try {
            return pdfDocumentService.analyzePdfById(id);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
    }

    @GetMapping("/{id}/audio")
    public ResponseEntity<?> getAudioFile(@PathVariable Long id) {
        try {
            return pdfDocumentService.downloadAudio(id);
        } catch (RuntimeException e) {
            // Return JSON error response, not audio content type
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Audio file not found"));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Error retrieving audio file"));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deletePdfDocument(@PathVariable Long id) {
        try {
            pdfDocumentService.deletePdfDocument(id);
            return ResponseEntity.noContent().build();
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "PDF document not found"));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Error deleting PDF document"));
        }
    }
}

