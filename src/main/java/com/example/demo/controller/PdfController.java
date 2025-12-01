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

@RestController
@RequestMapping("/api/pdfs")
public class PdfController {

    @Autowired
    private PdfDocumentService pdfDocumentService;

    @PostMapping("/upload")
    public ResponseEntity<PdfUploadResponse> uploadPdf(@RequestParam("file") MultipartFile file) {
        try {
            PdfUploadResponse response = pdfDocumentService.uploadAndAnalyzePdf(file);
            return ResponseEntity.status(HttpStatus.CREATED).body(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/upload/bulk")
    public ResponseEntity<BulkUploadResponse> uploadBulkPdfs(@RequestParam("files") MultipartFile[] files) {
        BulkUploadResponse bulkResponse = new BulkUploadResponse();
        List<PdfUploadResponse> successfulUploads = new ArrayList<>();
        List<BulkUploadResponse.UploadError> errors = new ArrayList<>();
        
        for (MultipartFile file : files) {
            try {
                PdfUploadResponse response = pdfDocumentService.uploadAndAnalyzePdf(file);
                successfulUploads.add(response);
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

    @GetMapping
    public ResponseEntity<List<PdfUploadResponse>> getAllPdfs() {
        try {
            List<PdfUploadResponse> pdfs = pdfDocumentService.getAllPdfs();
            return ResponseEntity.ok(pdfs);
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
}

