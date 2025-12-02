package com.example.demo.service;

import com.example.demo.dto.conversion.DocumentStructure;
import com.example.demo.dto.conversion.PageStructure;
import com.example.demo.model.AudioSync;
import com.example.demo.model.ConversionJob;
import com.example.demo.model.PdfDocument;
import com.example.demo.repository.AudioSyncRepository;
import com.example.demo.repository.ConversionJobRepository;
import com.example.demo.repository.PdfDocumentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class AudioSyncService {

    @Autowired
    private AudioSyncRepository audioSyncRepository;

    @Autowired
    private PdfDocumentRepository pdfDocumentRepository;

    @Autowired
    private ConversionJobRepository conversionJobRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public List<AudioSync> getAudioSyncsByPdfId(Long pdfDocumentId) {
        return audioSyncRepository.findByPdfDocumentId(pdfDocumentId);
    }

    @Transactional(readOnly = true)
    public List<AudioSync> getAudioSyncsByJobId(Long conversionJobId) {
        return audioSyncRepository.findByConversionJobId(conversionJobId);
    }

    @Transactional(readOnly = true)
    public List<AudioSync> getAudioSyncs(Long pdfDocumentId, Long conversionJobId) {
        return audioSyncRepository.findByPdfDocumentIdAndConversionJobId(pdfDocumentId, conversionJobId);
    }

    @Transactional
    public AudioSync saveAudioSync(AudioSync audioSync) {
        // Validate that PDF and job exist
        PdfDocument pdfDocument = pdfDocumentRepository.findById(audioSync.getPdfDocumentId())
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + audioSync.getPdfDocumentId()));
        
        if (!conversionJobRepository.existsById(audioSync.getConversionJobId())) {
            throw new RuntimeException("Conversion job not found with id: " + audioSync.getConversionJobId());
        }

        // Validate page number
        if (audioSync.getPageNumber() < 1 || audioSync.getPageNumber() > pdfDocument.getTotalPages()) {
            throw new IllegalArgumentException("Page number must be between 1 and " + pdfDocument.getTotalPages());
        }

        // Validate time range
        if (audioSync.getStartTime() < 0 || audioSync.getEndTime() <= audioSync.getStartTime()) {
            throw new IllegalArgumentException("Invalid time range: start time must be >= 0 and end time must be > start time");
        }

        // Set audio file path from PDF document if not set
        if (audioSync.getAudioFilePath() == null || audioSync.getAudioFilePath().isEmpty()) {
            if (pdfDocument.getAudioFilePath() != null) {
                audioSync.setAudioFilePath(pdfDocument.getAudioFilePath());
            } else {
                throw new IllegalArgumentException("No audio file associated with this PDF document");
            }
        }

        return audioSyncRepository.save(audioSync);
    }

    @Transactional
    public AudioSync updateAudioSync(Long id, AudioSync updatedSync) {
        AudioSync existing = audioSyncRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Audio sync not found with id: " + id));

        // Validate PDF document if changed
        if (!existing.getPdfDocumentId().equals(updatedSync.getPdfDocumentId())) {
            PdfDocument pdfDocument = pdfDocumentRepository.findById(updatedSync.getPdfDocumentId())
                .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + updatedSync.getPdfDocumentId()));
            
            if (updatedSync.getPageNumber() < 1 || updatedSync.getPageNumber() > pdfDocument.getTotalPages()) {
                throw new IllegalArgumentException("Page number must be between 1 and " + pdfDocument.getTotalPages());
            }
        }

        // Validate time range
        if (updatedSync.getStartTime() < 0 || updatedSync.getEndTime() <= updatedSync.getStartTime()) {
            throw new IllegalArgumentException("Invalid time range: start time must be >= 0 and end time must be > start time");
        }

        existing.setPageNumber(updatedSync.getPageNumber());
        existing.setBlockId(updatedSync.getBlockId());
        existing.setStartTime(updatedSync.getStartTime());
        existing.setEndTime(updatedSync.getEndTime());
        existing.setNotes(updatedSync.getNotes());

        return audioSyncRepository.save(existing);
    }

    @Transactional
    public void deleteAudioSync(Long id) {
        if (!audioSyncRepository.existsById(id)) {
            throw new RuntimeException("Audio sync not found with id: " + id);
        }
        audioSyncRepository.deleteById(id);
    }

    @Transactional
    public void deleteAudioSyncsByJobId(Long conversionJobId) {
        audioSyncRepository.deleteByConversionJobId(conversionJobId);
    }

    @Transactional(readOnly = true)
    public Optional<AudioSync> getAudioSync(Long id) {
        return audioSyncRepository.findById(id);
    }

    @Transactional(readOnly = true)
    public ConversionJob getConversionJob(Long jobId) {
        return conversionJobRepository.findById(jobId)
            .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));
    }

    @Transactional(readOnly = true)
    public PdfDocument getPdfDocument(Long pdfId) {
        return pdfDocumentRepository.findById(pdfId)
            .orElseThrow(() -> new RuntimeException("PDF document not found with id: " + pdfId));
    }

    @Transactional(readOnly = true, timeout = 30)
    public ResponseEntity<?> getPageStructuresForJob(Long jobId) {
        try {
            ConversionJob job = conversionJobRepository.findById(jobId)
                .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));
            
            if (job.getIntermediateData() == null || job.getIntermediateData().isEmpty()) {
                return ResponseEntity.ok(Map.of("pages", new ArrayList<>(), "message", "No intermediate data available. Please ensure the conversion job has completed."));
            }
            
            // Parse DocumentStructure from intermediate data
            DocumentStructure structure;
            try {
                structure = objectMapper.readValue(job.getIntermediateData(), DocumentStructure.class);
            } catch (Exception e) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to parse intermediate data: " + e.getMessage()));
            }
            
            // Build response with page structures (limit to prevent timeout)
            List<Map<String, Object>> pagesData = new ArrayList<>();
            if (structure.getPages() != null) {
                // Process pages in batches to prevent timeout
                int maxPages = Math.min(structure.getPages().size(), 100); // Limit to 100 pages
                for (int i = 0; i < maxPages; i++) {
                    PageStructure page = structure.getPages().get(i);
                    Map<String, Object> pageData = new HashMap<>();
                    pageData.put("pageNumber", page.getPageNumber());
                    
                    List<Map<String, Object>> blockDataList = new ArrayList<>();
                    if (page.getTextBlocks() != null) {
                        // Limit blocks per page to prevent large responses
                        int maxBlocks = Math.min(page.getTextBlocks().size(), 200);
                        for (int j = 0; j < maxBlocks; j++) {
                            com.example.demo.dto.conversion.TextBlock block = page.getTextBlocks().get(j);
                            Map<String, Object> blockData = new HashMap<>();
                            blockData.put("id", block.getId());
                            // Truncate very long text to prevent response bloat
                            String text = block.getText();
                            if (text != null && text.length() > 1000) {
                                text = text.substring(0, 997) + "...";
                            }
                            blockData.put("text", text);
                            blockData.put("type", block.getType() != null ? block.getType().toString() : "PARAGRAPH");
                            blockData.put("readingOrder", block.getReadingOrder());
                            blockDataList.add(blockData);
                        }
                    }
                    pageData.put("textBlocks", blockDataList);
                    pagesData.add(pageData);
                }
            }
            
            return ResponseEntity.ok(Map.of("pages", pagesData, "totalPages", pagesData.size()));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Unknown error occurred"));
        }
    }
}

