package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import com.example.demo.model.PdfDocument;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Service
public class TextExtractionService {

    private static final Logger logger = LoggerFactory.getLogger(TextExtractionService.class);

    public DocumentStructure extractTextAndStructure(File pdfFile, PdfDocument pdfDocument) throws IOException {
        logger.info("Starting text extraction for PDF: {}", pdfFile.getName());
        DocumentStructure structure = new DocumentStructure();
        List<PageStructure> pages = new ArrayList<>();

        try (PDDocument document = Loader.loadPDF(pdfFile)) {
            int totalPages = document.getNumberOfPages();
            logger.info("PDF has {} pages, starting extraction...", totalPages);
            
            // Extract metadata
            logger.debug("Extracting metadata...");
            structure.setMetadata(extractMetadata(document, pdfDocument));
            
            // Process each page
            for (int i = 0; i < totalPages; i++) {
                logger.info("Processing page {}/{}", i + 1, totalPages);
                PageStructure pageStructure = extractPageStructure(document, i, pdfDocument);
                pages.add(pageStructure);
                logger.debug("Completed page {}/{}", i + 1, totalPages);
            }
            
            structure.setPages(pages);
            logger.info("Text extraction completed successfully for {} pages", totalPages);
        } catch (Exception e) {
            logger.error("Error during text extraction: {}", e.getMessage(), e);
            throw e;
        }

        return structure;
    }

    private PageStructure extractPageStructure(PDDocument document, int pageIndex, PdfDocument pdfDocument) throws IOException {
        PageStructure pageStructure = new PageStructure();
        pageStructure.setPageNumber(pageIndex + 1);
        
        PDPage page = document.getPage(pageIndex);
        PDRectangle mediaBox = page.getMediaBox();
        
        // Determine if page is scanned
        boolean isScanned = pdfDocument.getPageQuality() == PdfDocument.PageQuality.SCANNED ||
                           (pdfDocument.getPageQuality() == PdfDocument.PageQuality.MIXED && 
                            pageIndex < pdfDocument.getScannedPagesCount());
        pageStructure.setIsScanned(isScanned);
        
        List<TextBlock> textBlocks = new ArrayList<>();
        
        if (isScanned) {
            // For scanned pages, we'll need OCR (handled separately)
            // For now, mark as scanned
            pageStructure.setOcrConfidence(0.0);
        } else {
            // Extract text blocks with positioning
            textBlocks = extractTextBlocksWithPositioning(document, pageIndex, mediaBox);
        }
        
        pageStructure.setTextBlocks(textBlocks);
        
        // Determine reading order
        ReadingOrder readingOrder = determineReadingOrder(textBlocks);
        pageStructure.setReadingOrder(readingOrder);
        
        return pageStructure;
    }

    private List<TextBlock> extractTextBlocksWithPositioning(PDDocument document, int pageIndex, PDRectangle mediaBox) throws IOException {
        List<TextBlock> blocks = new ArrayList<>();
        
        PDFTextStripper stripper = new PDFTextStripper();
        stripper.setStartPage(pageIndex + 1);
        stripper.setEndPage(pageIndex + 1);
        
        // Extract text with positioning
        stripper.setSortByPosition(true);
        String text = stripper.getText(document);
        
        // Parse text into blocks (simplified - in production, use more sophisticated parsing)
        String[] lines = text.split("\n");
        int blockOrder = 0;
        
        for (String line : lines) {
            if (line.trim().isEmpty()) continue;
            
            TextBlock block = new TextBlock();
            block.setId("block_" + pageIndex + "_" + blockOrder++);
            block.setText(line.trim());
            block.setType(determineBlockType(line));
            block.setLevel(determineHeadingLevel(line));
            block.setReadingOrder(blockOrder);
            block.setConfidence(1.0); // Digital text has high confidence
            
            // Set bounding box with page number
            BoundingBox bbox = new BoundingBox();
            bbox.setPageNumber(pageIndex + 1);
            block.setBoundingBox(bbox);
            
            blocks.add(block);
        }
        
        return blocks;
    }

    private TextBlock.BlockType determineBlockType(String text) {
        String trimmed = text.trim();
        
        // Check for headings (common patterns)
        if (trimmed.matches("^Chapter \\d+.*") || 
            trimmed.matches("^\\d+\\.\\s+[A-Z].*") ||
            (trimmed.length() < 100 && trimmed.equals(trimmed.toUpperCase()))) {
            return TextBlock.BlockType.HEADING;
        }
        
        // Check for list items
        if (trimmed.matches("^[•\\-\\*]\\s+.*") || 
            trimmed.matches("^\\d+[.)]\\s+.*") ||
            trimmed.matches("^[a-z][.)]\\s+.*")) {
            return TextBlock.BlockType.LIST_ITEM;
        }
        
        return TextBlock.BlockType.PARAGRAPH;
    }

    private Integer determineHeadingLevel(String text) {
        if (text.matches("^Chapter \\d+.*")) return 1;
        if (text.matches("^\\d+\\.\\s+.*")) return 2;
        if (text.matches("^\\d+\\.\\d+\\s+.*")) return 3;
        return null;
    }

    private ReadingOrder determineReadingOrder(List<TextBlock> blocks) {
        ReadingOrder order = new ReadingOrder();
        
        // Simple reading order: top to bottom
        for (TextBlock block : blocks) {
            order.getBlockIds().add(block.getId());
        }
        
        // Check for multi-column (simplified detection)
        // In production, use more sophisticated layout analysis
        order.setIsMultiColumn(false);
        order.setColumnCount(1);
        
        return order;
    }

    private DocumentMetadata extractMetadata(PDDocument document, PdfDocument pdfDocument) {
        DocumentMetadata metadata = new DocumentMetadata();
        
        // Extract from PDF document info
        if (document.getDocumentInformation() != null) {
            metadata.setTitle(document.getDocumentInformation().getTitle());
            if (document.getDocumentInformation().getAuthor() != null) {
                metadata.getAuthors().add(document.getDocumentInformation().getAuthor());
            }
            metadata.setSubject(document.getDocumentInformation().getSubject());
            metadata.setPublisher(document.getDocumentInformation().getProducer());
        }
        
        // Use detected languages
        metadata.setLanguages(pdfDocument.getLanguages());
        if (!pdfDocument.getLanguages().isEmpty()) {
            metadata.setLanguage(pdfDocument.getLanguages().get(0));
        }
        
        return metadata;
    }
}

