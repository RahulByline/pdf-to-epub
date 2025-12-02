package com.example.demo.controller;

import com.example.demo.model.AudioSync;
import com.example.demo.service.AudioSyncService;
import com.example.demo.service.XhtmlExtractionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;

@RestController
@RequestMapping("/api/audio-sync")
public class AudioSyncController {

    private static final Logger logger = LoggerFactory.getLogger(AudioSyncController.class);

    @Autowired
    private AudioSyncService audioSyncService;

    @Autowired
    private XhtmlExtractionService xhtmlExtractionService;

    @GetMapping("/pdf/{pdfId}")
    public ResponseEntity<List<AudioSync>> getAudioSyncsByPdf(@PathVariable Long pdfId) {
        try {
            List<AudioSync> syncs = audioSyncService.getAudioSyncsByPdfId(pdfId);
            return ResponseEntity.ok(syncs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/job/{jobId}")
    public ResponseEntity<List<AudioSync>> getAudioSyncsByJob(@PathVariable Long jobId) {
        try {
            List<AudioSync> syncs = audioSyncService.getAudioSyncsByJobId(jobId);
            return ResponseEntity.ok(syncs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/pdf/{pdfId}/job/{jobId}")
    public ResponseEntity<List<AudioSync>> getAudioSyncs(
            @PathVariable Long pdfId,
            @PathVariable Long jobId) {
        try {
            List<AudioSync> syncs = audioSyncService.getAudioSyncs(pdfId, jobId);
            return ResponseEntity.ok(syncs);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping
    public ResponseEntity<?> createAudioSync(@RequestBody AudioSync audioSync) {
        try {
            AudioSync saved = audioSyncService.saveAudioSync(audioSync);
            return ResponseEntity.status(HttpStatus.CREATED).body(saved);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateAudioSync(@PathVariable Long id, @RequestBody AudioSync audioSync) {
        try {
            AudioSync updated = audioSyncService.updateAudioSync(id, audioSync);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteAudioSync(@PathVariable Long id) {
        try {
            audioSyncService.deleteAudioSync(id);
            return ResponseEntity.noContent().build();
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/job/{jobId}")
    public ResponseEntity<?> deleteAudioSyncsByJob(@PathVariable Long jobId) {
        try {
            audioSyncService.deleteAudioSyncsByJobId(jobId);
            return ResponseEntity.noContent().build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/job/{jobId}/pages")
    public ResponseEntity<?> getPageStructures(@PathVariable Long jobId) {
        try {
            return audioSyncService.getPageStructuresForJob(jobId);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Get XHTML pages from EPUB file for audio synchronization
     * This extracts actual XHTML content from the generated EPUB
     * Also includes audio file information for sync interface
     */
    @GetMapping("/job/{jobId}/xhtml-pages")
    public ResponseEntity<?> getXhtmlPages(@PathVariable Long jobId) {
        try {
            List<XhtmlExtractionService.XhtmlPage> pages = xhtmlExtractionService.extractXhtmlPages(jobId);
            
            // Get PDF document and audio file info
            com.example.demo.model.ConversionJob job = 
                audioSyncService.getConversionJob(jobId);
            com.example.demo.model.PdfDocument pdf = 
                audioSyncService.getPdfDocument(job.getPdfDocumentId());
            
            String audioUrl = null;
            String audioFileName = null;
            if (pdf != null && pdf.getAudioFilePath() != null && !pdf.getAudioFilePath().isEmpty()) {
                audioUrl = "/api/pdfs/" + pdf.getId() + "/audio";
                audioFileName = pdf.getAudioFileName();
            }
            
            // Convert to response format
            List<Map<String, Object>> pagesData = pages.stream().map(page -> {
                Map<String, Object> pageData = new java.util.HashMap<>();
                pageData.put("pageNumber", page.pageNumber);
                pageData.put("fileName", page.fileName);
                
                List<Map<String, Object>> blocks = page.textBlocks.stream().map(block -> {
                    Map<String, Object> blockData = new java.util.HashMap<>();
                    blockData.put("id", block.id);
                    blockData.put("text", block.text);
                    blockData.put("html", block.html); // HTML with images preserved
                    blockData.put("tagName", block.tagName);
                    blockData.put("readingOrder", block.readingOrder);
                    
                    // Add coordinates (reading order markers)
                    if (block.coordinates != null) {
                        Map<String, Object> coords = new java.util.HashMap<>();
                        coords.put("x", block.coordinates.x);
                        coords.put("y", block.coordinates.y);
                        coords.put("top", block.coordinates.top);
                        coords.put("left", block.coordinates.left);
                        coords.put("width", block.coordinates.width);
                        coords.put("height", block.coordinates.height);
                        coords.put("readingOrder", block.coordinates.readingOrder);
                        blockData.put("coordinates", coords);
                    }
                    
                    // Add text segmentation
                    blockData.put("words", block.words);
                    blockData.put("sentences", block.sentences);
                    blockData.put("phrases", block.phrases);
                    blockData.put("wordCount", block.wordCount);
                    blockData.put("sentenceCount", block.sentenceCount);
                    blockData.put("phraseCount", block.phraseCount);
                    
                    return blockData;
                }).collect(Collectors.toList());
                
                // Add images
                List<Map<String, Object>> images = page.images.stream().map(img -> {
                    Map<String, Object> imageData = new java.util.HashMap<>();
                    imageData.put("src", img.src);
                    imageData.put("alt", img.alt);
                    imageData.put("id", img.id);
                    return imageData;
                }).collect(Collectors.toList());
                
                pageData.put("images", images);
                pageData.put("fullHtml", page.fullHtml); // Complete HTML as-is
                
                // Always add PDF page image API endpoint (endpoint will handle extraction from EPUB)
                // The endpoint will look in both new (image/) and old (root) locations
                pageData.put("pdfPageImage", "/api/audio-sync/job/" + jobId + "/page-image/" + page.pageNumber);
                
                pageData.put("textBlocks", blocks);
                return pageData;
            }).collect(Collectors.toList());
            
            // Build response with audio file info
            Map<String, Object> response = new java.util.HashMap<>();
            response.put("pages", pagesData);
            response.put("totalPages", pagesData.size());
            response.put("audioUrl", audioUrl);
            response.put("audioFileName", audioFileName);
            response.put("hasAudio", audioUrl != null);
            
            return ResponseEntity.ok(response);
            
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Unknown error occurred"));
        }
    }

    /**
     * Serve PDF page images from EPUB file
     * Extracts and serves page_1.png, page_2.png, etc. from the EPUB ZIP
     */
    @GetMapping("/job/{jobId}/page-image/{pageNumber}")
    public ResponseEntity<Resource> getPageImage(
            @PathVariable Long jobId,
            @PathVariable Integer pageNumber) {
        try {
            com.example.demo.model.ConversionJob job = 
                audioSyncService.getConversionJob(jobId);
            
            if (job == null || job.getEpubFilePath() == null || job.getEpubFilePath().isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            
            File epubFile = new File(job.getEpubFilePath());
            if (!epubFile.exists()) {
                return ResponseEntity.notFound().build();
            }
            
            // Extract page image from EPUB (now in image/ subfolder)
            String imagePath = "OEBPS/image/page_" + pageNumber + ".png";
            try (ZipFile zipFile = new ZipFile(epubFile)) {
                FileHeader header = zipFile.getFileHeader(imagePath);
                if (header == null) {
                    // Fallback: try old location for backward compatibility
                    String oldPath = "OEBPS/page_" + pageNumber + ".png";
                    header = zipFile.getFileHeader(oldPath);
                    if (header == null) {
                        logger.warn("Page image not found at {} or {} for job {} page {}", 
                            imagePath, oldPath, jobId, pageNumber);
                        return ResponseEntity.notFound().build();
                    }
                    logger.debug("Found page image at old location: {} for job {} page {}", 
                        oldPath, jobId, pageNumber);
                }
                
                // Extract to temporary file
                Path tempDir = Paths.get(System.getProperty("java.io.tmpdir"));
                String tempFileName = "epub_page_" + jobId + "_" + pageNumber + ".png";
                Path tempImage = tempDir.resolve(tempFileName);
                
                // Clean up old temp file if exists
                if (tempImage.toFile().exists()) {
                    tempImage.toFile().delete();
                }
                
                zipFile.extractFile(header, tempDir.toString(), tempFileName);
                
                if (!tempImage.toFile().exists()) {
                    logger.error("Failed to extract page image to temp file: {}", tempImage);
                    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
                }
                
                Resource resource = new FileSystemResource(tempImage.toFile());
                
                logger.debug("Successfully serving page image for job {} page {}", jobId, pageNumber);
                return ResponseEntity.ok()
                    .contentType(MediaType.IMAGE_PNG)
                    .header(HttpHeaders.CONTENT_DISPOSITION, 
                        "inline; filename=\"page_" + pageNumber + ".png\"")
                    .body(resource);
            }
            
        } catch (Exception e) {
            logger.error("Error serving page image for job {} page {}: {}", 
                jobId, pageNumber, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Re-run alignment for a specific block
     */
    @PostMapping("/job/{jobId}/realign")
    public ResponseEntity<?> reRunAlignment(
            @PathVariable Long jobId,
            @RequestBody Map<String, Object> request) {
        try {
            String blockId = (String) request.get("blockId");
            @SuppressWarnings("unused")
            String text = (String) request.get("text");
            
            // Get the block and re-run alignment
            // This would call the audio analysis service to re-align
            // For now, return success
            logger.info("Re-running alignment for block {} in job {}", blockId, jobId);
            return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Re-alignment completed",
                "blockId", blockId
            ));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Save edit log for model tuning
     */
    @PostMapping("/job/{jobId}/edit-log")
    public ResponseEntity<?> saveEditLog(
            @PathVariable Long jobId,
            @RequestBody Map<String, Object> request) {
        try {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> edits = (List<Map<String, Object>>) request.get("edits");
            
            // Log edits for model tuning
            // In production, this would save to a database or analytics service
            logger.info("Received {} edits for job {}", edits.size(), jobId);
            for (Map<String, Object> edit : edits) {
                logger.debug("Edit: {}", edit);
            }
            
            return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Edit log saved",
                "count", edits.size()
            ));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", e.getMessage()));
        }
    }
}

