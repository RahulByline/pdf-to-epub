package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import com.example.demo.model.PdfDocument;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDResources;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.PDXObject;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.apache.pdfbox.cos.COSName;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import com.example.demo.service.GeminiService;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class TextExtractionService {

    private static final Logger logger = LoggerFactory.getLogger(TextExtractionService.class);
    
    @Autowired(required = false)
    private GeminiService geminiService;
    
    @Autowired(required = false)
    private com.example.demo.service.TextSegmentationService textSegmentationService;
    
    @Value("${file.upload.dir:uploads}")
    private String uploadDir;

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
        
        // Extract images from digital PDFs
        List<ImageBlock> imageBlocks = new ArrayList<>();
        if (!isScanned) {
            imageBlocks = extractImagesFromPage(document, pageIndex, pdfDocument);
        }
        pageStructure.setImageBlocks(imageBlocks);
        
        // Detect if this is a two-page spread (split page) - do this before reading order
        boolean isTwoPageSpread = detectTwoPageSpread(textBlocks, mediaBox);
        pageStructure.setIsTwoPageSpread(isTwoPageSpread);
        logger.debug("Page {} detected as two-page spread: {}", pageIndex + 1, isTwoPageSpread);
        
        // Determine reading order (handles two-page spreads correctly)
        ReadingOrder readingOrder = determineReadingOrder(textBlocks, mediaBox);
        pageStructure.setReadingOrder(readingOrder);
        
        return pageStructure;
    }
    
    /**
     * Detects if a page is a two-page spread (split page with 2 pages per page)
     * Uses similar logic to XhtmlExtractionService but works with TextBlocks
     */
    private boolean detectTwoPageSpread(List<TextBlock> textBlocks, PDRectangle mediaBox) {
        if (textBlocks == null || textBlocks.size() < 2) {
            return false;
        }
        
        double pageWidth = mediaBox.getWidth();
        double pageHeight = mediaBox.getHeight();
        double midPoint = pageWidth / 2.0;
        
        // First check: Look for page numbers at bottom (e.g., "10" and "11" on same page)
        List<String> pageNumbers = new ArrayList<>();
        for (TextBlock block : textBlocks) {
            if (block.getText() != null) {
                String text = block.getText().trim();
                // Check for single or double digit page numbers
                if (text.matches("^\\d{1,2}$") && text.length() <= 2) {
                    // Check if it's at the bottom of the page (likely footer)
                    if (block.getBoundingBox() != null && block.getBoundingBox().getY() != null) {
                        double y = block.getBoundingBox().getY();
                        // Page numbers are usually at bottom 10% of page
                        if (y > pageHeight * 0.85) {
                            pageNumbers.add(text);
                        }
                    }
                }
            }
        }
        
        // If we find 2 page numbers, it's likely a two-page spread
        if (pageNumbers.size() >= 2) {
            logger.debug("Detected two-page spread: found page numbers {}", pageNumbers);
            return true;
        }
        
        // Count blocks in left vs right half
        int leftCount = 0;
        int rightCount = 0;
        List<Double> leftPositions = new ArrayList<>();
        List<Double> rightPositions = new ArrayList<>();
        
        for (TextBlock block : textBlocks) {
            if (block.getBoundingBox() != null && block.getBoundingBox().getX() != null) {
                double x = block.getBoundingBox().getX();
                if (x < midPoint) {
                    leftCount++;
                    leftPositions.add(x);
                } else {
                    rightCount++;
                    rightPositions.add(x);
                }
            }
        }
        
        // Check if there's a clear separation (gap) in the middle
        boolean hasClearSeparation = false;
        if (!leftPositions.isEmpty() && !rightPositions.isEmpty()) {
            double maxLeftPos = leftPositions.stream().mapToDouble(Double::doubleValue).max().orElse(0);
            double minRightPos = rightPositions.stream().mapToDouble(Double::doubleValue).min().orElse(pageWidth);
            // If there's a gap between left and right content, it's a two-page spread
            hasClearSeparation = (minRightPos - maxLeftPos) > (pageWidth * 0.1); // 10% gap
        }
        
        // It's a two-page spread if:
        // 1. We have content in both halves, AND
        // 2. There's a clear separation, OR
        // 3. Both halves have significant content (at least 20% of blocks in each)
        boolean bothHalvesHaveContent = leftCount > 0 && rightCount > 0;
        boolean significantContentInBoth = leftCount >= textBlocks.size() * 0.2 && rightCount >= textBlocks.size() * 0.2;
        
        boolean isSpread = bothHalvesHaveContent && (hasClearSeparation || significantContentInBoth);
        if (isSpread) {
            logger.debug("Detected two-page spread: leftCount={}, rightCount={}, hasClearSeparation={}", 
                        leftCount, rightCount, hasClearSeparation);
        }
        return isSpread;
    }
    
    /**
     * Extracts images from a PDF page using PDFBox
     * For digital PDFs, extracts embedded images from page resources
     */
    private List<ImageBlock> extractImagesFromPage(PDDocument document, int pageIndex, PdfDocument pdfDocument) throws IOException {
        List<ImageBlock> imageBlocks = new ArrayList<>();
        
        try {
            PDPage page = document.getPage(pageIndex);
            PDResources resources = page.getResources();
            if (resources == null) {
                return imageBlocks;
            }
            
            // Get page dimensions for positioning
            PDRectangle mediaBox = page.getMediaBox();
            double pageWidth = mediaBox.getWidth();
            double pageHeight = mediaBox.getHeight();
            
            // Create image directory if it doesn't exist
            Path imageDir = Paths.get(uploadDir, "extracted_images");
            Files.createDirectories(imageDir);
            
            // Extract images from resources
            int imageIndex = 0;
            for (COSName xObjectName : resources.getXObjectNames()) {
                try {
                    PDXObject xobject = resources.getXObject(xObjectName);
                    if (xobject instanceof PDImageXObject) {
                        PDImageXObject image = (PDImageXObject) xobject;
                        
                        // Convert to BufferedImage
                        BufferedImage bufferedImage = image.getImage();
                        
                        // Generate unique filename
                        String imageFileName = String.format("page_%d_img_%d_%s.png", 
                            pageIndex + 1, imageIndex++, UUID.randomUUID().toString().substring(0, 8));
                        Path imagePath = imageDir.resolve(imageFileName);
                        
                        // Save image
                        ImageIO.write(bufferedImage, "png", imagePath.toFile());
                        
                        // Create ImageBlock
                        ImageBlock imageBlock = new ImageBlock();
                        imageBlock.setId("img_" + pageIndex + "_" + imageIndex);
                        imageBlock.setImagePath(imagePath.toString());
                        imageBlock.setImageType(ImageBlock.ImageType.FIGURE); // Default type
                        
                        // Set bounding box - use image dimensions, position will be determined by layout
                        // For now, place at center of page (layout analysis can refine this)
                        BoundingBox bbox = new BoundingBox();
                        double imageWidth = image.getWidth();
                        double imageHeight = image.getHeight();
                        // Scale to page coordinates (PDF uses points, 1 point = 1/72 inch)
                        double scaleX = pageWidth / 612.0; // Assuming standard page width
                        double scaleY = pageHeight / 792.0; // Assuming standard page height
                        bbox.setX((pageWidth - imageWidth * scaleX) / 2); // Center horizontally
                        bbox.setY((pageHeight - imageHeight * scaleY) / 2); // Center vertically
                        bbox.setWidth(imageWidth * scaleX);
                        bbox.setHeight(imageHeight * scaleY);
                        bbox.setPageNumber(pageIndex + 1);
                        imageBlock.setBoundingBox(bbox);
                        
                        imageBlocks.add(imageBlock);
                        logger.debug("Extracted image from page {}: {} ({}x{} points)", 
                            pageIndex + 1, imageFileName, imageWidth, imageHeight);
                    }
                } catch (Exception e) {
                    logger.warn("Failed to extract image {} from page {}: {}", 
                        imageIndex, pageIndex + 1, e.getMessage());
                }
            }
            
            logger.info("Extracted {} images from page {}", imageBlocks.size(), pageIndex + 1);
            
        } catch (Exception e) {
            logger.warn("Error extracting images from page {}: {}", pageIndex + 1, e.getMessage());
        }
        
        return imageBlocks;
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
                
                // Use Gemini AI to correct AND segment text in a single call
                // This is more efficient and provides better segmentation than separate calls
                String correctedText = blockText;
                List<String> words = new ArrayList<>();
                List<String> sentences = new ArrayList<>();
                List<String> phrases = new ArrayList<>();
                
                if (geminiService != null && geminiService.isEnabled()) {
                    try {
                        // Try combined correction and segmentation in one AI call
                        GeminiService.CorrectedAndSegmentedText aiResult = 
                            geminiService.correctAndSegmentText(blockText, pageIndex + 1);
                        
                        if (aiResult != null && aiResult.correctedText != null && !aiResult.correctedText.trim().isEmpty()) {
                            correctedText = aiResult.correctedText.trim();
                            
                            // Use AI-provided segmentation
                            if (!aiResult.words.isEmpty()) {
                                words = aiResult.words;
                            }
                            if (!aiResult.sentences.isEmpty()) {
                                sentences = aiResult.sentences;
                            }
                            if (!aiResult.phrases.isEmpty()) {
                                phrases = aiResult.phrases;
                            }
                            
                            if (!correctedText.equals(blockText)) {
                                logger.info("🤖 AI corrected and segmented text block: '{}' -> '{}' ({} words, {} sentences, {} phrases)", 
                                           blockText.length() > 50 ? blockText.substring(0, 50) + "..." : blockText,
                                           correctedText.length() > 50 ? correctedText.substring(0, 50) + "..." : correctedText,
                                           words.size(), sentences.size(), phrases.size());
                            } else {
                                logger.debug("🤖 AI segmented text block: {} words, {} sentences, {} phrases", 
                                           words.size(), sentences.size(), phrases.size());
                            }
                        } else {
                            // Fallback: try separate correction call (old method)
                            logger.debug("Combined AI correction/segmentation failed, trying separate correction");
                            String prompt = String.format("""
                                You are a text-cleaning engine for EPUB conversion.
                                
                                Clean and normalize the following text extracted from PDF page %d:
                                - Remove OCR artifacts (e.g., "tin4" -> "Time", "ristopher" -> "Christopher")
                                - Fix missing or incorrect first letters
                                - Normalize spacing and punctuation
                                - Preserve proper names, titles, and technical terms
                                
                                Return ONLY the cleaned text, nothing else.
                                
                                TEXT:
                                %s
                                """, pageIndex + 1, blockText);
                            
                            correctedText = geminiService.generate(prompt);
                            if (correctedText == null || correctedText.isEmpty()) {
                                correctedText = blockText; // Fallback to original
                            } else {
                                correctedText = correctedText.trim();
                                if (!correctedText.equals(blockText)) {
                                    logger.info("🤖 AI corrected text block: '{}' -> '{}'", 
                                               blockText.length() > 50 ? blockText.substring(0, 50) + "..." : blockText,
                                               correctedText.length() > 50 ? correctedText.substring(0, 50) + "..." : correctedText);
                                }
                            }
                        }
                    } catch (Exception e) {
                        logger.warn("Error correcting/segmenting text with Gemini, using original: {}", e.getMessage());
                        correctedText = blockText;
                    }
                }
                
                TextBlock block = new TextBlock();
                block.setId("block_" + pageIndex + "_" + blockOrder++);
                block.setText(correctedText);
                
                // Use Gemini AI to determine structure tag if available, fallback to regex
                TextBlock.BlockType blockType = determineBlockTypeWithGemini(correctedText, pageIndex + 1);
                if (blockType == null) {
                    blockType = determineBlockType(correctedText);
                }
                block.setType(blockType);
                
                // Determine heading level
                Integer headingLevel = determineHeadingLevel(correctedText);
                if (blockType == TextBlock.BlockType.HEADING && headingLevel == null) {
                    // Use Gemini to determine heading level if it's a heading
                    headingLevel = determineHeadingLevelWithGemini(correctedText);
                }
                block.setLevel(headingLevel);
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
                // Note: In PDF, Y=0 is at bottom, Y increases upward
                // getYDirAdj() returns Y coordinate from bottom
                // minY = bottom-most Y (smallest Y value, closest to bottom)
                // maxY = top-most Y (largest Y value, closest to top)
                // For HTML positioning, we need the TOP coordinate
                BoundingBox bbox = new BoundingBox();
                bbox.setPageNumber(pageIndex + 1);
                bbox.setX(group.minX);
                // Store minY (bottom coordinate from bottom of page) for conversion later
                bbox.setY(group.minY);
                double width = Math.max(0.0, group.maxX - group.minX);
                double height = Math.max(0.0, group.maxY - group.minY);
                bbox.setWidth(width);
                bbox.setHeight(height);
                block.setBoundingBox(bbox);
                
                // Debug: log coordinate info for first few blocks
                if (blocks.size() < 3) {
                    logger.debug("Block {}: minY={}, maxY={}, height={}, Y from bottom={}", 
                               block.getId(), group.minY, group.maxY, height, bbox.getY());
                }
                
                // Set segmentation from AI if available, otherwise use TextSegmentationService
                if (!words.isEmpty() && !sentences.isEmpty() && !phrases.isEmpty()) {
                    // Use AI-provided segmentation (already done above)
                    block.setWords(words);
                    block.setSentences(sentences);
                    block.setPhrases(phrases);
                    block.setWordCount(words.size());
                    block.setSentenceCount(sentences.size());
                    block.setPhraseCount(phrases.size());
                    logger.debug("Using AI-provided segmentation for block {}: {} words, {} sentences, {} phrases", 
                               block.getId(), words.size(), sentences.size(), phrases.size());
                } else if (textSegmentationService != null && correctedText != null && !correctedText.trim().isEmpty()) {
                    // Fallback: use TextSegmentationService if AI didn't provide segmentation
                    try {
                        com.example.demo.service.TextSegmentationService.TextSegmentation segmentation = 
                            textSegmentationService.segmentText(correctedText, block.getId());
                        block.setWords(segmentation.words);
                        block.setSentences(segmentation.sentences);
                        block.setPhrases(segmentation.phrases);
                        block.setWordCount(segmentation.getWordCount());
                        block.setSentenceCount(segmentation.getSentenceCount());
                        block.setPhraseCount(segmentation.getPhraseCount());
                        logger.debug("Using TextSegmentationService segmentation for block {}: {} words, {} sentences, {} phrases", 
                                   block.getId(), segmentation.words.size(), segmentation.sentences.size(), segmentation.phrases.size());
                    } catch (Exception e) {
                        logger.debug("Error segmenting text for block {}: {}", block.getId(), e.getMessage());
                        // Continue without segmentation if it fails
                    }
                }
                
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
            if (geminiService != null && geminiService.isEnabled()) {
                try {
                    String prompt = String.format("""
                        You are a text-cleaning engine for EPUB conversion.
                        
                        Clean and normalize the following text extracted from PDF page %d (fallback extraction):
                        - Remove OCR artifacts
                        - Fix missing or incorrect characters
                        - Normalize spacing and punctuation
                        
                        Return ONLY the cleaned text, nothing else.
                        
                        TEXT:
                        %s
                        """, pageIndex + 1, trimmed);
                    
                    correctedText = geminiService.generate(prompt);
                    if (correctedText == null || correctedText.isEmpty()) {
                        correctedText = trimmed; // Fallback to original
                    } else {
                        correctedText = correctedText.trim();
                        if (!correctedText.equals(trimmed)) {
                            logger.info("🤖 AI corrected fallback text: '{}' -> '{}'", 
                                       trimmed.length() > 50 ? trimmed.substring(0, 50) + "..." : trimmed,
                                       correctedText.length() > 50 ? correctedText.substring(0, 50) + "..." : correctedText);
                        }
                    }
                } catch (Exception e) {
                    logger.warn("Error correcting fallback text with Gemini, using original: {}", e.getMessage());
                    correctedText = trimmed;
                }
            }
            
            TextBlock block = new TextBlock();
            block.setId("block_" + pageIndex + "_" + blockOrder++);
            block.setText(correctedText);
            
            // Use Gemini AI to determine structure tag if available, fallback to regex
            TextBlock.BlockType blockType = determineBlockTypeWithGemini(correctedText, pageIndex + 1);
            if (blockType == null) {
                blockType = determineBlockType(trimmed);
            }
            block.setType(blockType);
            
            // Determine heading level
            Integer headingLevel = determineHeadingLevel(trimmed);
            if (blockType == TextBlock.BlockType.HEADING && headingLevel == null) {
                // Use Gemini to determine heading level if it's a heading
                headingLevel = determineHeadingLevelWithGemini(correctedText);
            }
            block.setLevel(headingLevel);
            block.setReadingOrder(blockOrder);
            block.setConfidence(1.0);
            
            // Perform text segmentation (words, sentences, phrases) for audio sync
            if (textSegmentationService != null && correctedText != null && !correctedText.trim().isEmpty()) {
                try {
                    com.example.demo.service.TextSegmentationService.TextSegmentation segmentation = 
                        textSegmentationService.segmentText(correctedText, block.getId());
                    block.setWords(segmentation.words);
                    block.setSentences(segmentation.sentences);
                    block.setPhrases(segmentation.phrases);
                    block.setWordCount(segmentation.getWordCount());
                    block.setSentenceCount(segmentation.getSentenceCount());
                    block.setPhraseCount(segmentation.getPhraseCount());
                } catch (Exception e) {
                    logger.debug("Error segmenting text for block {}: {}", block.getId(), e.getMessage());
                    // Continue without segmentation if it fails
                }
            }
            
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

    /**
     * Uses Gemini AI to determine the HTML structure tag for a text block
     * Returns null if Gemini is unavailable or fails
     */
    private TextBlock.BlockType determineBlockTypeWithGemini(String text, int pageNumber) {
        if (geminiService == null || !geminiService.isEnabled() || text == null || text.trim().isEmpty()) {
            return null;
        }

        try {
            String prompt = String.format("""
                You are an HTML structure analyzer for EPUB conversion.
                
                Analyze the following text from PDF page %d and determine the most appropriate HTML tag.
                Return ONLY the tag name (e.g., "p", "h1", "h2", "h3", "li", "table", "caption").
                
                Rules:
                - Use "h1" for main titles/chapter titles
                - Use "h2" for major section headings
                - Use "h3" for subsection headings
                - Use "p" for regular paragraphs
                - Use "li" for list items
                - Use "caption" for image captions
                - Use "table" for table structures
                - Use "glossary_term" for glossary entries (format: "Word: definition")
                
                Return ONLY the tag name in lowercase, nothing else.
                
                TEXT:
                %s
                """, pageNumber, text);

            String tagName = geminiService.generate(prompt);
            if (tagName != null) {
                tagName = tagName.trim().toLowerCase();
                
                // Map tag names to BlockType enum
                switch (tagName) {
                    case "h1":
                    case "h2":
                    case "h3":
                    case "h4":
                    case "h5":
                    case "h6":
                        return TextBlock.BlockType.HEADING;
                    case "li":
                        return TextBlock.BlockType.LIST_ITEM;
                    case "ul":
                        return TextBlock.BlockType.LIST_UNORDERED;
                    case "ol":
                        return TextBlock.BlockType.LIST_ORDERED;
                    case "caption":
                        return TextBlock.BlockType.CAPTION;
                    case "table":
                        return TextBlock.BlockType.OTHER; // Table handling is separate
                    case "glossary_term":
                    case "glossary":
                        return TextBlock.BlockType.GLOSSARY_TERM;
                    case "p":
                    default:
                        return TextBlock.BlockType.PARAGRAPH;
                }
            }
        } catch (Exception e) {
            logger.debug("Error using Gemini for structure tagging: {}", e.getMessage());
        }

        return null; // Fallback to regex-based detection
    }

    /**
     * Uses Gemini AI to determine heading level (1-6)
     * Returns null if Gemini is unavailable or fails
     */
    private Integer determineHeadingLevelWithGemini(String text) {
        if (geminiService == null || !geminiService.isEnabled() || text == null || text.trim().isEmpty()) {
            return null;
        }

        try {
            String prompt = String.format("""
                You are an HTML structure analyzer for EPUB conversion.
                
                The following text has been identified as a heading. Determine its heading level (1-6).
                - Level 1 (h1): Main title, chapter title
                - Level 2 (h2): Major section heading
                - Level 3 (h3): Subsection heading
                - Level 4-6 (h4-h6): Deeper subsections
                
                Return ONLY the number (1, 2, 3, 4, 5, or 6), nothing else.
                
                TEXT:
                %s
                """, text);

            String levelStr = geminiService.generate(prompt);
            if (levelStr != null) {
                levelStr = levelStr.trim();
                // Extract first digit if response contains other text
                String digit = levelStr.replaceAll("[^1-6]", "");
                if (!digit.isEmpty()) {
                    int level = Integer.parseInt(digit.substring(0, 1));
                    if (level >= 1 && level <= 6) {
                        return level;
                    }
                }
            }
        } catch (Exception e) {
            logger.debug("Error using Gemini for heading level: {}", e.getMessage());
        }

        return null; // Fallback to regex-based detection
    }

    /**
     * Fallback method: Determines block type using regex patterns
     */
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
        return determineReadingOrder(blocks, null);
    }
    
    private ReadingOrder determineReadingOrder(List<TextBlock> blocks, PDRectangle mediaBox) {
        ReadingOrder order = new ReadingOrder();
        
        if (blocks == null || blocks.isEmpty()) {
            order.setIsMultiColumn(false);
            order.setColumnCount(1);
            return order;
        }
        
        // Check if this is a two-page spread
        boolean isTwoPageSpread = false;
        if (mediaBox != null) {
            isTwoPageSpread = detectTwoPageSpread(blocks, mediaBox);
        }
        
        if (isTwoPageSpread && mediaBox != null) {
            // Two-page spread: Sort by column (left page, then right page), then top-to-bottom
            double pageWidth = mediaBox.getWidth();
            double midPoint = pageWidth / 2.0;
            
            // Separate blocks into left and right
            List<TextBlock> leftBlocks = new ArrayList<>();
            List<TextBlock> rightBlocks = new ArrayList<>();
            
            for (TextBlock block : blocks) {
                if (block.getBoundingBox() != null && block.getBoundingBox().getX() != null) {
                    double x = block.getBoundingBox().getX();
                    if (x < midPoint) {
                        leftBlocks.add(block);
                    } else {
                        rightBlocks.add(block);
                    }
                } else {
                    // If no coordinates, add to left by default
                    leftBlocks.add(block);
                }
            }
            
            // Sort left blocks by Y (top to bottom), then X
            leftBlocks.sort((a, b) -> {
                Double yA = a.getBoundingBox() != null ? a.getBoundingBox().getY() : null;
                Double yB = b.getBoundingBox() != null ? b.getBoundingBox().getY() : null;
                if (yA == null && yB == null) return 0;
                if (yA == null) return 1;
                if (yB == null) return -1;
                int yCompare = yA.compareTo(yB);
                if (yCompare != 0) return yCompare;
                Double xA = a.getBoundingBox() != null ? a.getBoundingBox().getX() : null;
                Double xB = b.getBoundingBox() != null ? b.getBoundingBox().getX() : null;
                if (xA == null && xB == null) return 0;
                if (xA == null) return 1;
                if (xB == null) return -1;
                return xA.compareTo(xB);
            });
            
            // Sort right blocks by Y (top to bottom), then X
            rightBlocks.sort((a, b) -> {
                Double yA = a.getBoundingBox() != null ? a.getBoundingBox().getY() : null;
                Double yB = b.getBoundingBox() != null ? b.getBoundingBox().getY() : null;
                if (yA == null && yB == null) return 0;
                if (yA == null) return 1;
                if (yB == null) return -1;
                int yCompare = yA.compareTo(yB);
                if (yCompare != 0) return yCompare;
                Double xA = a.getBoundingBox() != null ? a.getBoundingBox().getX() : null;
                Double xB = b.getBoundingBox() != null ? b.getBoundingBox().getX() : null;
                if (xA == null && xB == null) return 0;
                if (xA == null) return 1;
                if (xB == null) return -1;
                return xA.compareTo(xB);
            });
            
            // Add left blocks first, then right blocks
            for (TextBlock block : leftBlocks) {
                order.getBlockIds().add(block.getId());
            }
            for (TextBlock block : rightBlocks) {
                order.getBlockIds().add(block.getId());
            }
            
            order.setIsMultiColumn(true);
            order.setColumnCount(2);
            logger.debug("Two-page spread reading order: {} left blocks, {} right blocks", 
                        leftBlocks.size(), rightBlocks.size());
        } else {
            // Single page: Simple reading order: top to bottom, left to right
            List<TextBlock> sortedBlocks = new ArrayList<>(blocks);
            sortedBlocks.sort((a, b) -> {
                Double yA = a.getBoundingBox() != null ? a.getBoundingBox().getY() : null;
                Double yB = b.getBoundingBox() != null ? b.getBoundingBox().getY() : null;
                if (yA == null && yB == null) return 0;
                if (yA == null) return 1;
                if (yB == null) return -1;
                int yCompare = yA.compareTo(yB);
                if (yCompare != 0) return yCompare;
                Double xA = a.getBoundingBox() != null ? a.getBoundingBox().getX() : null;
                Double xB = b.getBoundingBox() != null ? b.getBoundingBox().getX() : null;
                if (xA == null && xB == null) return 0;
                if (xA == null) return 1;
                if (xB == null) return -1;
                return xA.compareTo(xB);
            });
            
            for (TextBlock block : sortedBlocks) {
                order.getBlockIds().add(block.getId());
            }
            
            order.setIsMultiColumn(false);
            order.setColumnCount(1);
        }
        
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

