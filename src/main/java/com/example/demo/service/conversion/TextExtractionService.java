package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import com.example.demo.model.PdfDocument;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.example.demo.service.GeminiTextCorrectionService;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Service
public class TextExtractionService {

    private static final Logger logger = LoggerFactory.getLogger(TextExtractionService.class);
    
    @Autowired(required = false)
    private GeminiTextCorrectionService geminiTextCorrectionService;

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
        
        try {
            // Use custom stripper to extract text with positions
            PositionAwareTextStripper stripper = new PositionAwareTextStripper();
            stripper.setStartPage(pageIndex + 1);
            stripper.setEndPage(pageIndex + 1);
            stripper.setSortByPosition(true);
            stripper.setSuppressDuplicateOverlappingText(false);
            
            // Extract text and positions
            String plainText = stripper.getText(document);
            List<TextPositionInfo> textPositions = stripper.getTextPositions();
            
            logger.debug("Extracted {} text positions and {} characters of plain text from page {}", 
                        textPositions.size(), plainText.length(), pageIndex + 1);
            
            if (textPositions.isEmpty()) {
                logger.warn("No text positions found for page {}, falling back to plain text extraction", pageIndex + 1);
                return extractTextBlocksFromPlainText(plainText, pageIndex, mediaBox);
            }
            
            // Group text positions into blocks based on proximity and formatting
            List<TextPositionGroup> groups = groupTextPositions(textPositions, mediaBox);
            
            // Verify we didn't lose text - compare with plain text
            StringBuilder extractedText = new StringBuilder();
            for (TextPositionGroup group : groups) {
                extractedText.append(group.text.toString()).append(" ");
            }
            
            if (extractedText.length() < plainText.length() * 0.5) {
                logger.warn("Grouping lost significant text ({} vs {} chars), using fallback", 
                           extractedText.length(), plainText.length());
                return extractTextBlocksFromPlainText(plainText, pageIndex, mediaBox);
            }
            
            // Convert groups to TextBlocks
            int blockOrder = 0;
            for (TextPositionGroup group : groups) {
                String blockText = group.text.toString().trim();
                if (blockText.isEmpty()) continue;
                
                // Use Gemini AI to correct text extracted from PDF
                // Apply to all text blocks for better quality, not just obvious errors
                String correctedText = blockText;
                if (geminiTextCorrectionService != null) {
                    try {
                        String context = "PDF page " + (pageIndex + 1) + " text block extraction";
                        correctedText = geminiTextCorrectionService.correctOcrText(blockText, context);
                        if (correctedText == null || correctedText.isEmpty()) {
                            correctedText = blockText; // Fallback to original
                        } else if (!correctedText.equals(blockText)) {
                            logger.info("🤖 AI corrected text block: '{}' -> '{}'", 
                                       blockText.length() > 50 ? blockText.substring(0, 50) + "..." : blockText,
                                       correctedText.length() > 50 ? correctedText.substring(0, 50) + "..." : correctedText);
                        }
                    } catch (Exception e) {
                        logger.warn("Error correcting text with Gemini, using original: {}", e.getMessage());
                        correctedText = blockText;
                    }
                }
                
                TextBlock block = new TextBlock();
                block.setId("block_" + pageIndex + "_" + blockOrder++);
                block.setText(correctedText);
                block.setType(determineBlockType(blockText));
                block.setLevel(determineHeadingLevel(blockText));
                block.setReadingOrder(blockOrder);
                block.setConfidence(1.0);
                
                // Set font information
                if (!group.positions.isEmpty()) {
                    TextPositionInfo firstPos = group.positions.get(0);
                    block.setFontName(firstPos.fontName);
                    block.setFontSize(firstPos.fontSize);
                    block.setIsBold(firstPos.isBold);
                    block.setIsItalic(firstPos.isItalic);
                }
                
                // Set bounding box with actual coordinates
                BoundingBox bbox = new BoundingBox();
                bbox.setPageNumber(pageIndex + 1);
                bbox.setX(group.minX);
                bbox.setY(group.minY);
                double width = Math.max(0.0, group.maxX - group.minX);
                double height = Math.max(0.0, group.maxY - group.minY);
                bbox.setWidth(width);
                bbox.setHeight(height);
                block.setBoundingBox(bbox);
                
                blocks.add(block);
            }
            
            logger.info("Extracted {} text blocks from page {} with coordinates", blocks.size(), pageIndex + 1);
            return blocks;
            
        } catch (Exception e) {
            logger.error("Error extracting text with positions from page {}: {}", pageIndex + 1, e.getMessage(), e);
            // Fallback to simple text extraction
            return extractTextBlocksFromPlainText(document, pageIndex, mediaBox);
        }
    }
    
    /**
     * Fallback method: Extract text blocks from plain text (without coordinates)
     */
    private List<TextBlock> extractTextBlocksFromPlainText(String plainText, int pageIndex, PDRectangle mediaBox) {
        return extractTextBlocksFromPlainText(null, pageIndex, mediaBox, plainText);
    }
    
    /**
     * Fallback method: Extract text blocks from plain text using PDFTextStripper
     */
    private List<TextBlock> extractTextBlocksFromPlainText(PDDocument document, int pageIndex, PDRectangle mediaBox) throws IOException {
        PDFTextStripper stripper = new PDFTextStripper();
        stripper.setStartPage(pageIndex + 1);
        stripper.setEndPage(pageIndex + 1);
        stripper.setSortByPosition(true);
        String plainText = stripper.getText(document);
        return extractTextBlocksFromPlainText(document, pageIndex, mediaBox, plainText);
    }
    
    /**
     * Extract text blocks from plain text string
     */
    private List<TextBlock> extractTextBlocksFromPlainText(PDDocument document, int pageIndex, PDRectangle mediaBox, String plainText) {
        List<TextBlock> blocks = new ArrayList<>();
        
        if (plainText == null || plainText.trim().isEmpty()) {
            logger.warn("No text found for page {}", pageIndex + 1);
            return blocks;
        }
        
        // Split into paragraphs (double newlines) or lines
        String[] paragraphs = plainText.split("\\n\\s*\\n");
        if (paragraphs.length == 1) {
            // No double newlines, split by single newlines
            paragraphs = plainText.split("\\n");
        }
        
        int blockOrder = 0;
        double estimatedY = mediaBox.getHeight() - 50; // Start from top
        double lineHeight = 15.0; // Estimated line height
        
        for (String para : paragraphs) {
            String trimmed = para.trim();
            if (trimmed.isEmpty()) continue;
            
            // Use Gemini AI to correct text in fallback extraction as well
            String correctedText = trimmed;
            if (geminiTextCorrectionService != null) {
                try {
                    String context = "PDF page " + (pageIndex + 1) + " plain text extraction (fallback)";
                    correctedText = geminiTextCorrectionService.correctOcrText(trimmed, context);
                    if (correctedText == null || correctedText.isEmpty()) {
                        correctedText = trimmed; // Fallback to original
                    } else if (!correctedText.equals(trimmed)) {
                        logger.info("🤖 AI corrected fallback text: '{}' -> '{}'", 
                                   trimmed.length() > 50 ? trimmed.substring(0, 50) + "..." : trimmed,
                                   correctedText.length() > 50 ? correctedText.substring(0, 50) + "..." : correctedText);
                    }
                } catch (Exception e) {
                    logger.warn("Error correcting fallback text with Gemini, using original: {}", e.getMessage());
                    correctedText = trimmed;
                }
            }
            
            TextBlock block = new TextBlock();
            block.setId("block_" + pageIndex + "_" + blockOrder++);
            block.setText(correctedText);
            block.setType(determineBlockType(trimmed));
            block.setLevel(determineHeadingLevel(trimmed));
            block.setReadingOrder(blockOrder);
            block.setConfidence(1.0);
            
            // Estimate bounding box (approximate)
            BoundingBox bbox = new BoundingBox();
            bbox.setPageNumber(pageIndex + 1);
            bbox.setX(50.0); // Left margin
            bbox.setY(estimatedY);
            double estimatedWidth = (double)(mediaBox.getWidth() - 100); // Full width minus margins
            bbox.setWidth(estimatedWidth);
            // Estimate height based on line count
            int lineCount = trimmed.split("\\n").length;
            double estimatedHeight = Math.max(lineHeight, lineCount * lineHeight);
            bbox.setHeight(estimatedHeight);
            block.setBoundingBox(bbox);
            
            estimatedY -= (lineCount * lineHeight + 20); // Move down for next block
            
            blocks.add(block);
        }
        
        logger.info("Extracted {} text blocks from page {} using plain text fallback", blocks.size(), pageIndex + 1);
        return blocks;
    }
    
    /**
     * Groups text positions into logical blocks based on proximity and formatting
     */
    private List<TextPositionGroup> groupTextPositions(List<TextPositionInfo> positions, PDRectangle mediaBox) {
        if (positions.isEmpty()) {
            return new ArrayList<>();
        }
        
        // Sort by Y position (top to bottom), then X (left to right)
        // Note: PDF coordinates have Y=0 at bottom, but we want top-to-bottom reading
        positions.sort((a, b) -> {
            int yCompare = Double.compare(b.y, a.y); // Higher Y = top of page
            if (yCompare != 0) return yCompare;
            return Double.compare(a.x, b.x);
        });
        
        List<TextPositionGroup> groups = new ArrayList<>();
        TextPositionGroup currentGroup = null;
        
        // Thresholds for grouping
        double lineHeight = calculateAverageLineHeight(positions);
        double verticalThreshold = lineHeight * 2.0; // Lines within 2x line height are same block
        double horizontalThreshold = Math.max(50, lineHeight * 3); // Characters within threshold are same line
        double maxLineGap = lineHeight * 0.8; // Max gap for same line
        
        for (TextPositionInfo pos : positions) {
            if (pos.text == null || pos.text.trim().isEmpty()) {
                continue; // Skip empty positions
            }
            
            if (currentGroup == null) {
                // Start new group
                currentGroup = new TextPositionGroup();
                currentGroup.positions.add(pos);
                currentGroup.text.append(pos.text);
                currentGroup.minX = pos.x;
                currentGroup.maxX = pos.x + pos.width;
                currentGroup.minY = pos.y;
                currentGroup.maxY = pos.y + pos.height;
            } else {
                // Check if this position belongs to current group
                TextPositionInfo lastPos = currentGroup.positions.get(currentGroup.positions.size() - 1);
                
                double verticalDistance = Math.abs(pos.y - lastPos.y);
                double horizontalDistance = pos.x - (lastPos.x + lastPos.width);
                
                // Same line if similar Y and reasonable X distance
                boolean sameLine = verticalDistance < maxLineGap && horizontalDistance < horizontalThreshold;
                
                // Same block if on same line or within vertical threshold and similar X alignment
                boolean sameBlock = sameLine || (verticalDistance < verticalThreshold && 
                                                 Math.abs(pos.x - currentGroup.minX) < mediaBox.getWidth() * 0.9);
                
                if (sameBlock) {
                    // Add to current group
                    currentGroup.positions.add(pos);
                    if (sameLine) {
                        // Same line - add space if there's a gap
                        if (horizontalDistance > pos.width * 0.5) {
                            currentGroup.text.append(" ");
                        }
                        currentGroup.text.append(pos.text);
                    } else {
                        // New line in same block
                        currentGroup.text.append(" ").append(pos.text);
                    }
                    currentGroup.minX = Math.min(currentGroup.minX, pos.x);
                    currentGroup.maxX = Math.max(currentGroup.maxX, pos.x + pos.width);
                    currentGroup.minY = Math.min(currentGroup.minY, pos.y);
                    currentGroup.maxY = Math.max(currentGroup.maxY, pos.y + pos.height);
                } else {
                    // Start new group
                    groups.add(currentGroup);
                    currentGroup = new TextPositionGroup();
                    currentGroup.positions.add(pos);
                    currentGroup.text.append(pos.text);
                    currentGroup.minX = pos.x;
                    currentGroup.maxX = pos.x + pos.width;
                    currentGroup.minY = pos.y;
                    currentGroup.maxY = pos.y + pos.height;
                }
            }
        }
        
        if (currentGroup != null) {
            groups.add(currentGroup);
        }
        
        logger.debug("Grouped {} text positions into {} blocks", positions.size(), groups.size());
        return groups;
    }
    
    /**
     * Calculates average line height from text positions
     */
    private double calculateAverageLineHeight(List<TextPositionInfo> positions) {
        if (positions.size() < 2) {
            return 12.0; // Default
        }
        
        double totalHeight = 0.0;
        for (TextPositionInfo pos : positions) {
            totalHeight += pos.height;
        }
        return totalHeight / positions.size();
    }
    
    /**
     * Custom PDFTextStripper that captures text positions
     */
    private static class PositionAwareTextStripper extends PDFTextStripper {
        private List<TextPositionInfo> textPositions = new ArrayList<>();
        
        public PositionAwareTextStripper() throws IOException {
            super();
        }
        
        @Override
        protected void writeString(String text, List<TextPosition> textPositions) throws IOException {
            if (textPositions == null || textPositions.isEmpty()) {
                return;
            }
            
            for (TextPosition textPos : textPositions) {
                try {
                    String unicode = textPos.getUnicode();
                    if (unicode == null || unicode.trim().isEmpty()) {
                        continue; // Skip empty positions
                    }
                    
                    TextPositionInfo info = new TextPositionInfo();
                    info.text = unicode;
                    info.x = textPos.getXDirAdj();
                    info.y = textPos.getYDirAdj();
                    info.width = textPos.getWidthDirAdj();
                    info.height = textPos.getHeightDir();
                    info.fontSize = textPos.getFontSize();
                    
                    // Get font name safely
                    try {
                        info.fontName = textPos.getFont() != null ? textPos.getFont().getName() : "Unknown";
                    } catch (Exception e) {
                        info.fontName = "Unknown";
                    }
                    
                    // Try to detect bold/italic from font name
                    String fontNameLower = info.fontName.toLowerCase();
                    info.isBold = fontNameLower.contains("bold") || fontNameLower.contains("black");
                    info.isItalic = fontNameLower.contains("italic") || fontNameLower.contains("oblique");
                    
                    this.textPositions.add(info);
                } catch (Exception e) {
                    // Skip problematic text positions
                    logger.debug("Error processing text position: {}", e.getMessage());
                }
            }
        }
        
        
        public List<TextPositionInfo> getTextPositions() {
            return textPositions;
        }
    }
    
    /**
     * Information about a text position
     */
    private static class TextPositionInfo {
        String text;
        double x;
        double y;
        double width;
        double height;
        double fontSize;
        String fontName;
        boolean isBold;
        boolean isItalic;
    }
    
    /**
     * Group of text positions forming a logical block
     */
    private static class TextPositionGroup {
        List<TextPositionInfo> positions = new ArrayList<>();
        StringBuilder text = new StringBuilder();
        double minX = Double.MAX_VALUE;
        double maxX = Double.MIN_VALUE;
        double minY = Double.MAX_VALUE;
        double maxY = Double.MIN_VALUE;
    }

    private TextBlock.BlockType determineBlockType(String text) {
        String trimmed = text.trim();
        
        if (trimmed.isEmpty()) {
            return TextBlock.BlockType.PARAGRAPH;
        }
        
        // Check for headings (common patterns)
        // 1. Chapter patterns
        if (trimmed.matches("^Chapter \\d+.*") || 
            trimmed.matches("^\\d+\\.\\s+[A-Z].*")) {
            return TextBlock.BlockType.HEADING;
        }
        
        // 2. Short lines that are all caps or title case (likely headings)
        if (trimmed.length() < 100) {
            // All uppercase (likely heading)
            if (trimmed.equals(trimmed.toUpperCase()) && trimmed.length() > 3) {
                return TextBlock.BlockType.HEADING;
            }
            // Title case with no sentence-ending punctuation (likely heading)
            if (isTitleCase(trimmed) && !trimmed.matches(".*[.!?]$")) {
                return TextBlock.BlockType.HEADING;
            }
        }
        
        // 3. Common heading patterns (e.g., "If You Were a Horse", "All About Horses")
        // Short lines that start with capital and have multiple capitalized words
        if (trimmed.length() < 80 && trimmed.matches("^[A-Z][a-z]+(\\s+[A-Z][a-z]+)+.*") && 
            !trimmed.contains(".") && !trimmed.contains("!") && !trimmed.contains("?")) {
            return TextBlock.BlockType.HEADING;
        }
        
        // Check for list items
        if (trimmed.matches("^[•\\-\\*]\\s+.*") || 
            trimmed.matches("^\\d+[.)]\\s+.*") ||
            trimmed.matches("^[a-z][.)]\\s+.*")) {
            return TextBlock.BlockType.LIST_ITEM;
        }
        
        // Check for glossary items (format: "Word: definition")
        if (trimmed.matches("^[A-Z][a-zA-Z]+:\\s+.*")) {
            return TextBlock.BlockType.GLOSSARY_TERM;
        }
        
        return TextBlock.BlockType.PARAGRAPH;
    }
    
    /**
     * Checks if text is in title case (first letter of each word is capitalized)
     */
    private boolean isTitleCase(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        
        String[] words = text.split("\\s+");
        if (words.length < 2) {
            return false; // Single word, not title case
        }
        
        // Check if most words start with capital letter
        int capitalizedWords = 0;
        for (String word : words) {
            if (!word.isEmpty() && Character.isUpperCase(word.charAt(0))) {
                capitalizedWords++;
            }
        }
        
        // Title case if at least 70% of words are capitalized
        return (double) capitalizedWords / words.length >= 0.7;
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

