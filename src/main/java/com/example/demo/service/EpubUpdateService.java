package com.example.demo.service;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Service to update XHTML content in existing EPUB files
 */
@Service
public class EpubUpdateService {

    private static final Logger logger = LoggerFactory.getLogger(EpubUpdateService.class);

    /**
     * Updates XHTML content in an EPUB file
     * 
     * @param epubFilePath Path to the EPUB file
     * @param pageUpdates Map of page file names to updated XHTML content
     * @return true if update was successful
     */
    public boolean updateEpubContent(String epubFilePath, Map<String, String> pageUpdates) {
        if (epubFilePath == null || epubFilePath.isEmpty()) {
            logger.error("EPUB file path is null or empty");
            return false;
        }

        File epubFile = new File(epubFilePath);
        if (!epubFile.exists()) {
            logger.error("EPUB file does not exist: {}", epubFilePath);
            return false;
        }

        if (pageUpdates == null || pageUpdates.isEmpty()) {
            logger.warn("No page updates provided");
            return true; // No updates needed
        }

        // Create temporary directory for files
        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory("epub_update_" + UUID.randomUUID().toString());
            
            // Open EPUB as ZIP
            try (ZipFile zipFile = new ZipFile(epubFile)) {
                // Update each XHTML file
                for (Map.Entry<String, String> entry : pageUpdates.entrySet()) {
                    String fileName = entry.getKey();
                    String updatedContent = entry.getValue();
                    
                    // Ensure fileName is in OEBPS directory
                    String fullPath = fileName.startsWith("OEBPS/") ? fileName : "OEBPS/" + fileName;
                    
                    FileHeader header = zipFile.getFileHeader(fullPath);
                    if (header == null) {
                        logger.warn("XHTML file not found in EPUB: {}", fullPath);
                        continue;
                    }
                    
                    // Write content to temporary file
                    Path tempFile = tempDir.resolve(UUID.randomUUID().toString() + ".xhtml");
                    Files.write(tempFile, updatedContent.getBytes(StandardCharsets.UTF_8));
                    
                    // Remove old file and add updated file
                    zipFile.removeFile(header);
                    
                    // Set zip parameters
                    net.lingala.zip4j.model.ZipParameters zipParams = new net.lingala.zip4j.model.ZipParameters();
                    zipParams.setFileNameInZip(fullPath);
                    
                    // Add file to ZIP
                    zipFile.addFile(tempFile.toFile(), zipParams);
                    
                    // Clean up temp file
                    Files.deleteIfExists(tempFile);
                    
                    logger.info("Updated XHTML file in EPUB: {}", fullPath);
                }
            }
            
            logger.info("Successfully updated {} XHTML files in EPUB: {}", 
                       pageUpdates.size(), epubFilePath);
            return true;
            
        } catch (Exception e) {
            logger.error("Error updating EPUB content: {}", e.getMessage(), e);
            return false;
        } finally {
            // Clean up temporary directory
            if (tempDir != null) {
                try {
                    Files.walk(tempDir)
                        .sorted((a, b) -> -a.compareTo(b))
                        .forEach(path -> {
                            try {
                                Files.deleteIfExists(path);
                            } catch (Exception e) {
                                logger.warn("Failed to delete temp file: {}", path, e);
                            }
                        });
                } catch (Exception e) {
                    logger.warn("Failed to clean up temp directory: {}", tempDir, e);
                }
            }
        }
    }

    /**
     * Updates a specific text block in an XHTML file
     * 
     * @param epubFilePath Path to the EPUB file
     * @param pageFileName XHTML file name (e.g., "page_1.xhtml")
     * @param blockId ID of the block to update
     * @param newHtml New HTML content for the block
     * @param newTagName New tag name (e.g., "h1", "p", "div")
     * @param newBlockType New block type (e.g., "HEADING", "PARAGRAPH")
     * @return Updated XHTML content, or null if update failed
     */
    public String updateTextBlock(String epubFilePath, String pageFileName, 
                                   String blockId, String newHtml, 
                                   String newTagName, String newBlockType) {
        if (epubFilePath == null || pageFileName == null || blockId == null) {
            logger.error("Invalid parameters for updateTextBlock");
            return null;
        }

        try (ZipFile zipFile = new ZipFile(new File(epubFilePath))) {
            String fullPath = pageFileName.startsWith("OEBPS/") ? pageFileName : "OEBPS/" + pageFileName;
            
            FileHeader header = zipFile.getFileHeader(fullPath);
            if (header == null) {
                logger.error("XHTML file not found: {}", fullPath);
                return null;
            }

            // Extract and parse XHTML
            String xhtmlContent;
            try (InputStream is = zipFile.getInputStream(header)) {
                xhtmlContent = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            }

            // Parse XHTML with JSoup
            Document doc = Jsoup.parse(xhtmlContent, "UTF-8");
            doc.outputSettings().syntax(org.jsoup.nodes.Document.OutputSettings.Syntax.xml);
            doc.outputSettings().escapeMode(org.jsoup.nodes.Entities.EscapeMode.xhtml);

            // Find element by ID or data-block-id
            Element targetElement = doc.getElementById(blockId);
            if (targetElement == null) {
                // Try data-block-id attribute
                targetElement = doc.selectFirst("[data-block-id=" + blockId + "]");
            }
            
            if (targetElement == null) {
                logger.warn("Block with ID {} not found in {}", blockId, pageFileName);
                return null;
            }

            // Update the element
            if (newTagName != null && !newTagName.isEmpty()) {
                // Change tag name if different
                if (!targetElement.tagName().equalsIgnoreCase(newTagName)) {
                    Element newElement = new Element(newTagName);
                    newElement.attributes().addAll(targetElement.attributes());
                    newElement.html(targetElement.html());
                    targetElement.replaceWith(newElement);
                    targetElement = newElement;
                }
            }

            // Update content
            if (newHtml != null) {
                targetElement.html(newHtml);
            }

            // Update data-block-type if provided
            if (newBlockType != null && !newBlockType.isEmpty()) {
                targetElement.attr("data-block-type", newBlockType);
            }

            // Get updated XHTML
            String updatedXhtml = doc.html();
            
            // Ensure proper XHTML structure
            updatedXhtml = ensureXhtmlStructure(updatedXhtml);

            return updatedXhtml;

        } catch (Exception e) {
            logger.error("Error updating text block: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * Updates multiple text blocks in a page
     * 
     * @param epubFilePath Path to the EPUB file
     * @param pageFileName XHTML file name
     * @param blockUpdates List of block updates (each with blockId, html, tagName, blockType)
     * @return Updated XHTML content, or null if update failed
     */
    public String updateTextBlocks(String epubFilePath, String pageFileName, 
                                    List<Map<String, Object>> blockUpdates) {
        if (epubFilePath == null || pageFileName == null || blockUpdates == null || blockUpdates.isEmpty()) {
            logger.error("Invalid parameters for updateTextBlocks");
            return null;
        }

        try (ZipFile zipFile = new ZipFile(new File(epubFilePath))) {
            String fullPath = pageFileName.startsWith("OEBPS/") ? pageFileName : "OEBPS/" + pageFileName;
            
            FileHeader header = zipFile.getFileHeader(fullPath);
            if (header == null) {
                logger.error("XHTML file not found: {}", fullPath);
                return null;
            }

            // Extract and parse XHTML
            String xhtmlContent;
            try (InputStream is = zipFile.getInputStream(header)) {
                xhtmlContent = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            }

            // Parse XHTML with JSoup
            Document doc = Jsoup.parse(xhtmlContent, "UTF-8");
            doc.outputSettings().syntax(org.jsoup.nodes.Document.OutputSettings.Syntax.xml);
            doc.outputSettings().escapeMode(org.jsoup.nodes.Entities.EscapeMode.xhtml);

            // Update each block
            for (Map<String, Object> update : blockUpdates) {
                String blockId = (String) update.get("blockId");
                String newHtml = (String) update.get("html");
                String newTagName = (String) update.get("tagName");
                String newBlockType = (String) update.get("blockType");

                if (blockId == null) {
                    continue;
                }

                // Find element by ID or data-block-id
                Element targetElement = doc.getElementById(blockId);
                if (targetElement == null) {
                    targetElement = doc.selectFirst("[data-block-id=" + blockId + "]");
                }
                
                if (targetElement == null) {
                    logger.warn("Block with ID {} not found in {}", blockId, pageFileName);
                    continue;
                }

                // Update tag name if different
                if (newTagName != null && !newTagName.isEmpty() && 
                    !targetElement.tagName().equalsIgnoreCase(newTagName)) {
                    Element newElement = new Element(newTagName);
                    newElement.attributes().addAll(targetElement.attributes());
                    newElement.html(targetElement.html());
                    targetElement.replaceWith(newElement);
                    targetElement = newElement;
                }

                // Update content
                if (newHtml != null) {
                    targetElement.html(newHtml);
                }

                // Update data-block-type
                if (newBlockType != null && !newBlockType.isEmpty()) {
                    targetElement.attr("data-block-type", newBlockType);
                }
            }

            // Get updated XHTML
            String updatedXhtml = doc.html();
            
            // Ensure proper XHTML structure
            updatedXhtml = ensureXhtmlStructure(updatedXhtml);

            return updatedXhtml;

        } catch (Exception e) {
            logger.error("Error updating text blocks: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * Ensures XHTML has proper structure (DOCTYPE, namespace, etc.)
     */
    private String ensureXhtmlStructure(String xhtml) {
        // Check if it already has DOCTYPE
        if (xhtml.contains("<!DOCTYPE")) {
            return xhtml;
        }

        // Add DOCTYPE and proper structure if missing
        if (!xhtml.contains("<?xml")) {
            xhtml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + xhtml;
        }

        // Ensure html tag has namespace
        if (xhtml.contains("<html") && !xhtml.contains("xmlns=")) {
            xhtml = xhtml.replaceFirst("<html", "<html xmlns=\"http://www.w3.org/1999/xhtml\"");
        }

        return xhtml;
    }

    /**
     * Saves updated XHTML content back to EPUB file
     * 
     * @param epubFilePath Path to the EPUB file
     * @param pageFileName XHTML file name
     * @param updatedXhtml Updated XHTML content
     * @return true if save was successful
     */
    public boolean saveXhtmlToEpub(String epubFilePath, String pageFileName, String updatedXhtml) {
        if (epubFilePath == null || pageFileName == null || updatedXhtml == null) {
            logger.error("Invalid parameters for saveXhtmlToEpub");
            return false;
        }

        // Create temporary file
        Path tempFile = null;
        try {
            tempFile = Files.createTempFile("epub_xhtml_", ".xhtml");
            Files.write(tempFile, updatedXhtml.getBytes(StandardCharsets.UTF_8));
            
            try (ZipFile zipFile = new ZipFile(new File(epubFilePath))) {
                String fullPath = pageFileName.startsWith("OEBPS/") ? pageFileName : "OEBPS/" + pageFileName;
                
                FileHeader header = zipFile.getFileHeader(fullPath);
                if (header == null) {
                    logger.error("XHTML file not found: {}", fullPath);
                    return false;
                }

                // Remove old file
                zipFile.removeFile(header);

                // Set zip parameters
                net.lingala.zip4j.model.ZipParameters zipParams = new net.lingala.zip4j.model.ZipParameters();
                zipParams.setFileNameInZip(fullPath);

                // Add updated file
                zipFile.addFile(tempFile.toFile(), zipParams);

                logger.info("Successfully saved updated XHTML to EPUB: {}", fullPath);
                return true;
            }

        } catch (Exception e) {
            logger.error("Error saving XHTML to EPUB: {}", e.getMessage(), e);
            return false;
        } finally {
            // Clean up temporary file
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (Exception e) {
                    logger.warn("Failed to delete temp file: {}", tempFile, e);
                }
            }
        }
    }
}

