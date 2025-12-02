package com.example.demo.service;

import com.example.demo.model.ConversionJob;
import com.example.demo.repository.ConversionJobRepository;
import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Service to extract XHTML pages from EPUB files and parse text blocks
 */
@Service
public class XhtmlExtractionService {

    private static final Logger logger = LoggerFactory.getLogger(XhtmlExtractionService.class);

    @Autowired
    private ConversionJobRepository conversionJobRepository;

    @Autowired
    private TextSegmentationService textSegmentationService;
    
    @Autowired(required = false)
    private GeminiTextCorrectionService geminiTextCorrectionService;

    /**
     * Extracts XHTML pages from an EPUB file
     * 
     * @param jobId Conversion job ID
     * @return List of XHTML page data with text blocks
     */
    public List<XhtmlPage> extractXhtmlPages(Long jobId) {
        try {
            ConversionJob job = conversionJobRepository.findById(jobId)
                .orElseThrow(() -> new RuntimeException("Conversion job not found with id: " + jobId));

            if (job.getEpubFilePath() == null || job.getEpubFilePath().isEmpty()) {
                throw new RuntimeException("EPUB file not found for job: " + jobId);
            }

            return extractXhtmlPagesFromEpub(job.getEpubFilePath());

        } catch (Exception e) {
            logger.error("Error extracting XHTML pages for job {}: {}", jobId, e.getMessage(), e);
            throw new RuntimeException("Failed to extract XHTML pages: " + e.getMessage(), e);
        }
    }

    /**
     * Extracts XHTML pages from EPUB file path
     * Also extracts PDF page images for visual display
     */
    private List<XhtmlPage> extractXhtmlPagesFromEpub(String epubFilePath) {
        List<XhtmlPage> pages = new ArrayList<>();

        try (ZipFile zipFile = new ZipFile(epubFilePath)) {
            // Get all files from OEBPS directory
            List<FileHeader> fileHeaders = zipFile.getFileHeaders();
            
            // Extract PDF page images (now in image/ subfolder: image/page_1.png, image/page_2.png, etc.)
            java.util.Map<Integer, String> pageImages = new java.util.HashMap<>();
            Pattern imagePattern = Pattern.compile("OEBPS/image/page_(\\d+)\\.png");
            Pattern oldImagePattern = Pattern.compile("OEBPS/page_(\\d+)\\.png"); // Fallback for old structure
            
            // Debug: log all image files found
            int imageFileCount = 0;
            for (FileHeader header : fileHeaders) {
                String fileName = header.getFileName();
                if (fileName.contains(".png") && fileName.contains("OEBPS")) {
                    imageFileCount++;
                    logger.debug("Found image file in EPUB: {}", fileName);
                }
            }
            logger.debug("Total image files found in EPUB: {}", imageFileCount);
            
            for (FileHeader header : fileHeaders) {
                String fileName = header.getFileName();
                // Try new location first (image/ subfolder)
                if (fileName.startsWith("OEBPS/image/page_") && fileName.endsWith(".png")) {
                    Matcher matcher = imagePattern.matcher(fileName);
                    if (matcher.find()) {
                        int pageNum = Integer.parseInt(matcher.group(1));
                        pageImages.put(pageNum, fileName);
                        logger.debug("Found page image in new location: {} -> page {}", fileName, pageNum);
                    }
                } 
                // Fallback: try old location for backward compatibility
                else if (fileName.startsWith("OEBPS/page_") && fileName.endsWith(".png") && 
                         !fileName.contains("/image/")) {
                    Matcher matcher = oldImagePattern.matcher(fileName);
                    if (matcher.find()) {
                        int pageNum = Integer.parseInt(matcher.group(1));
                        // Only add if not already found in new location
                        if (!pageImages.containsKey(pageNum)) {
                            pageImages.put(pageNum, fileName);
                            logger.debug("Found page image in old location: {} -> page {}", fileName, pageNum);
                        }
                    }
                }
            }
            
            logger.info("Extracted {} PDF page images from EPUB (checked {} total files)", 
                       pageImages.size(), fileHeaders.size());
            
            // Filter XHTML files and sort by page number
            List<FileHeader> xhtmlFiles = new ArrayList<>();
            Pattern pagePattern = Pattern.compile("OEBPS/page_(\\d+)\\.xhtml");
            
            for (FileHeader header : fileHeaders) {
                String fileName = header.getFileName();
                if (fileName.startsWith("OEBPS/page_") && fileName.endsWith(".xhtml")) {
                    xhtmlFiles.add(header);
                }
            }
            
            // Sort by page number
            xhtmlFiles.sort((a, b) -> {
                Matcher matcherA = pagePattern.matcher(a.getFileName());
                Matcher matcherB = pagePattern.matcher(b.getFileName());
                int pageA = matcherA.find() ? Integer.parseInt(matcherA.group(1)) : 0;
                int pageB = matcherB.find() ? Integer.parseInt(matcherB.group(1)) : 0;
                return Integer.compare(pageA, pageB);
            });

            // Extract and parse each XHTML file
            for (FileHeader header : xhtmlFiles) {
                try (InputStream is = zipFile.getInputStream(header)) {
                    String xhtmlContent = new String(is.readAllBytes(), StandardCharsets.UTF_8);
                    XhtmlPage page = parseXhtmlPage(xhtmlContent, header.getFileName());
                    if (page != null) {
                        // Add PDF page image if available
                        if (pageImages.containsKey(page.pageNumber)) {
                            page.pdfPageImage = pageImages.get(page.pageNumber);
                        }
                        pages.add(page);
                    }
                } catch (Exception e) {
                    logger.warn("Error parsing XHTML file {}: {}", header.getFileName(), e.getMessage());
                }
            }

            logger.info("Extracted {} XHTML pages from EPUB with {} PDF page images", 
                       pages.size(), pageImages.size());
            return pages;

        } catch (Exception e) {
            logger.error("Error extracting XHTML from EPUB {}: {}", epubFilePath, e.getMessage(), e);
            throw new RuntimeException("Failed to extract XHTML pages: " + e.getMessage(), e);
        }
    }

    /**
     * Parses an XHTML page and extracts text blocks with preserved HTML and images
     * Also segments text into words, sentences, and phrases
     */
    private XhtmlPage parseXhtmlPage(String xhtmlContent, String fileName) {
        try {
            Document doc = Jsoup.parse(xhtmlContent, "UTF-8");
            
            // Extract page number from filename
            int pageNumber = extractPageNumber(fileName);
            
            XhtmlPage page = new XhtmlPage();
            page.pageNumber = pageNumber;
            page.fileName = fileName;
            page.textBlocks = new ArrayList<>();
            page.images = new ArrayList<>();
            page.fullHtml = xhtmlContent; // Preserve full HTML as-is

            // Extract images
            Elements imgElements = doc.select("img");
            for (Element img : imgElements) {
                XhtmlImage image = new XhtmlImage();
                image.src = img.attr("src");
                image.alt = img.attr("alt");
                image.id = img.id();
                if (image.id.isEmpty() && img.hasAttr("id")) {
                    image.id = img.attr("id");
                }
                page.images.add(image);
            }

            // Improved text extraction: prefer leaf nodes to avoid nested duplicates
            // Strategy: Extract from elements that have no text-containing children, or are top-level blocks
            // Include more element types to catch all text (including styled text, labels, etc.)
            Elements allElements = doc.select("div, p, span, h1, h2, h3, h4, h5, h6, li, td, th, article, section, label, strong, em, b, i, a, button");
            
            // Track processed elements to avoid duplicates
            java.util.Set<Element> processedElements = new java.util.HashSet<>();
            java.util.Set<String> processedTexts = new java.util.HashSet<>();
            
            int blockOrder = 1;
            for (Element elem : allElements) {
                // Skip if already processed
                if (processedElements.contains(elem)) {
                    continue;
                }
                
                String text = elem.text();
                if (text == null || text.trim().isEmpty()) {
                    continue;
                }
                
                String trimmedText = cleanText(text.trim());
                
                // Filter out OCR artifacts and very short fragments
                if (isOcrArtifact(trimmedText) || trimmedText.length() < 2) {
                    continue;
                }
                
                // Check if this element is a leaf node (has no text-containing children)
                Elements textChildren = elem.select("div, p, span, h1, h2, h3, h4, h5, h6, li, td, th, label, strong, em, b, i, a, button");
                boolean isLeafNode = true;
                for (Element child : textChildren) {
                    if (child != elem && child.text() != null && !child.text().trim().isEmpty()) {
                        String childText = cleanText(child.text().trim());
                        if (!isOcrArtifact(childText) && childText.length() >= 2) {
                            isLeafNode = false;
                            break;
                        }
                    }
                }
                
                // For non-leaf nodes, check if parent was already processed
                if (!isLeafNode) {
                    Element parent = elem.parent();
                    boolean parentProcessed = false;
                    while (parent != null && !parent.tagName().equals("body")) {
                        if (processedElements.contains(parent)) {
                            // Parent already processed, skip this child
                            parentProcessed = true;
                            break;
                        }
                        parent = parent.parent();
                    }
                    if (parentProcessed) {
                        continue; // Skip this element as its parent was already processed
                    }
                }
                
                // Check for duplicate text (but allow if it's a different element with same text)
                if (processedTexts.contains(trimmedText)) {
                    // Check if this is nested within a processed element
                    Element parent = elem.parent();
                    boolean isNestedInProcessed = false;
                    while (parent != null && !parent.tagName().equals("body")) {
                        if (processedElements.contains(parent)) {
                            isNestedInProcessed = true;
                            break;
                        }
                        parent = parent.parent();
                    }
                    if (isNestedInProcessed) {
                        continue; // Skip nested duplicate
                    }
                }
                
                processedElements.add(elem);
                processedTexts.add(trimmedText);

                // Get or generate ID
                String blockId = elem.id();
                if (blockId == null || blockId.isEmpty()) {
                    blockId = generateBlockId(elem, blockOrder);
                }

                // Preserve HTML structure (with images)
                String htmlContent = elem.html();
                
                // Extract coordinates/position (reading order markers)
                String style = elem.attr("style");
                String dataX = elem.attr("data-x");
                String dataY = elem.attr("data-y");
                String dataTop = elem.attr("data-top");
                String dataLeft = elem.attr("data-left");
                
                // Extract coordinates from style or data attributes
                Coordinates coords = extractCoordinates(elem, style, dataX, dataY, dataTop, dataLeft);
                
                // Use Gemini AI to correct OCR artifacts if available
                String correctedText = trimmedText;
                if (geminiTextCorrectionService != null && isLikelyOcrError(trimmedText)) {
                    try {
                        String context = "PDF page " + pageNumber;
                        correctedText = geminiTextCorrectionService.correctOcrText(trimmedText, context);
                        if (correctedText == null || correctedText.isEmpty()) {
                            correctedText = trimmedText; // Fallback to original
                        }
                        logger.debug("Gemini corrected: '{}' -> '{}'", trimmedText, correctedText);
                    } catch (Exception e) {
                        logger.warn("Error correcting text with Gemini, using original: {}", e.getMessage());
                        correctedText = trimmedText;
                    }
                }
                
                XhtmlTextBlock block = new XhtmlTextBlock();
                block.id = blockId;
                block.text = correctedText; // Use AI-corrected text if available
                block.html = htmlContent; // Preserve HTML with images
                block.tagName = elem.tagName();
                block.readingOrder = blockOrder++;
                block.coordinates = coords; // Reading order markers (coordinates)
                
                // Segment text into words, sentences, and phrases
                TextSegmentationService.TextSegmentation segmentation = 
                    textSegmentationService.segmentText(correctedText, blockId);
                
                block.words = segmentation.words;
                block.sentences = segmentation.sentences;
                block.phrases = segmentation.phrases;
                block.wordCount = segmentation.getWordCount();
                block.sentenceCount = segmentation.getSentenceCount();
                block.phraseCount = segmentation.getPhraseCount();

                page.textBlocks.add(block);
            }
            
            // Post-process: Merge very short fragments that are likely part of a larger block
            page.textBlocks = mergeFragmentedBlocks(page.textBlocks);
            
            logger.debug("Extracted {} text blocks from page {} after filtering and merging", 
                        page.textBlocks.size(), pageNumber);

            // If very few text blocks found, try a more aggressive extraction from body
            // This helps catch text that might be in unusual HTML structures
            if (page.textBlocks.size() < 3) {
                logger.debug("Few text blocks found ({}), attempting fallback extraction from body", 
                            page.textBlocks.size());
                extractFallbackTextBlocks(doc, page, pageNumber);
            }

            // If still no text blocks found, try to extract from body
            if (page.textBlocks.isEmpty()) {
                Element body = doc.body();
                if (body != null) {
                    String bodyText = body.text();
                    if (bodyText != null && !bodyText.trim().isEmpty()) {
                        XhtmlTextBlock block = new XhtmlTextBlock();
                        block.id = "page" + pageNumber;
                        block.text = bodyText.trim();
                        block.html = body.html();
                        block.tagName = "body";
                        block.readingOrder = 1;
                        
                        // Segment text
                        TextSegmentationService.TextSegmentation segmentation = 
                            textSegmentationService.segmentText(bodyText.trim(), block.id);
                        block.words = segmentation.words;
                        block.sentences = segmentation.sentences;
                        block.phrases = segmentation.phrases;
                        block.wordCount = segmentation.getWordCount();
                        block.sentenceCount = segmentation.getSentenceCount();
                        block.phraseCount = segmentation.getPhraseCount();
                        
                        page.textBlocks.add(block);
                    }
                }
            }

            return page;

        } catch (Exception e) {
            logger.error("Error parsing XHTML content: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * Extracts page number from filename
     */
    private int extractPageNumber(String fileName) {
        Pattern pattern = Pattern.compile("page_(\\d+)\\.xhtml");
        Matcher matcher = pattern.matcher(fileName);
        if (matcher.find()) {
            return Integer.parseInt(matcher.group(1));
        }
        return 0;
    }

    /**
     * Generates a stable block ID for syncable segments
     * Format: p-{pageNumber}-{order} for paragraphs, s-{pageNumber}-{order} for sentences
     */
    private String generateBlockId(Element elem, int order) {
        // Try to use existing ID
        if (elem.hasAttr("id")) {
            return elem.attr("id");
        }
        
        // Generate stable ID based on element type and order
        String tagName = elem.tagName().toLowerCase();
        String prefix = "p"; // paragraph by default
        
        if (tagName.startsWith("h")) {
            prefix = "h" + tagName.substring(1); // h1, h2, etc.
        } else if (tagName.equals("li")) {
            prefix = "li";
        } else if (tagName.equals("span")) {
            prefix = "span";
        }
        
        // Generate based on parent structure for better stability
        Element parent = elem.parent();
        if (parent != null && parent.hasAttr("id")) {
            return parent.attr("id") + "_" + prefix + order;
        }
        
        return prefix + "-" + order; // e.g., p-1, p-2, h1-1, etc.
    }
    
    /**
     * Extracts coordinates/position from element (reading order markers)
     */
    private Coordinates extractCoordinates(Element elem, String style, 
                                          String dataX, String dataY, 
                                          String dataTop, String dataLeft) {
        Coordinates coords = new Coordinates();
        
        // Try data attributes first
        if (!dataX.isEmpty() && !dataY.isEmpty()) {
            try {
                coords.x = Double.parseDouble(dataX);
                coords.y = Double.parseDouble(dataY);
            } catch (NumberFormatException e) {
                // Ignore
            }
        }
        
        if (!dataTop.isEmpty() && !dataLeft.isEmpty()) {
            try {
                coords.top = Double.parseDouble(dataTop);
                coords.left = Double.parseDouble(dataLeft);
            } catch (NumberFormatException e) {
                // Ignore
            }
        }
        
        // Extract from CSS style
        if (style != null && !style.isEmpty()) {
            // Parse top, left, width, height from style
            coords.top = extractCssValue(style, "top");
            coords.left = extractCssValue(style, "left");
            coords.width = extractCssValue(style, "width");
            coords.height = extractCssValue(style, "height");
            
            // If top/left not found, try margin-top, margin-left
            if (coords.top == null) {
                coords.top = extractCssValue(style, "margin-top");
            }
            if (coords.left == null) {
                coords.left = extractCssValue(style, "margin-left");
            }
        }
        
        // Calculate reading order based on position (top-to-bottom, left-to-right)
        if (coords.top != null && coords.left != null) {
            // Reading order: higher Y (top) = earlier, same Y: left = earlier
            coords.readingOrder = (int)(coords.top * 1000 + coords.left);
        }
        
        return coords;
    }
    
    /**
     * Extracts numeric value from CSS style string
     */
    private Double extractCssValue(String style, String property) {
        Pattern pattern = Pattern.compile(property + "\\s*:\\s*([\\d.]+)px");
        Matcher matcher = pattern.matcher(style);
        if (matcher.find()) {
            try {
                return Double.parseDouble(matcher.group(1));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }
    
    /**
     * Cleans text by removing extra whitespace and normalizing
     */
    private String cleanText(String text) {
        if (text == null) {
            return "";
        }
        // Replace multiple whitespace with single space
        text = text.replaceAll("\\s+", " ");
        // Remove leading/trailing whitespace
        text = text.trim();
        return text;
    }
    
    /**
     * Detects OCR artifacts and noise patterns
     * Examples: "SS = fF AEE", "tuk", "tin4", single characters, patterns with = signs
     */
    private boolean isOcrArtifact(String text) {
        if (text == null || text.length() < 2) {
            return true; // Very short text is likely artifact
        }
        
        // Pattern 1: Contains = sign with short fragments (e.g., "SS = fF AEE")
        if (text.contains("=") && text.length() < 20) {
            // Check if it looks like an equation or artifact
            String[] parts = text.split("=");
            if (parts.length == 2) {
                String left = parts[0].trim();
                String right = parts[1].trim();
                // If both sides are very short (1-3 chars), likely artifact
                if (left.length() <= 3 && right.length() <= 3) {
                    return true;
                }
            }
        }
        
        // Pattern 1.5: Detect OCR errors like "tin4" (number mixed incorrectly with letters)
        // This pattern catches things like "tin4", "ristopher" (missing first letter), etc.
        if (text.length() >= 3 && text.length() <= 15) {
            // Check for patterns like: letter+number+letter (e.g., "tin4")
            if (text.matches(".*[a-zA-Z]\\d+[a-zA-Z].*") || 
                text.matches(".*\\d+[a-zA-Z]{2,}.*") ||
                text.matches(".*[a-zA-Z]{2,}\\d+.*")) {
                // But allow if it's a valid pattern like "2nd", "3D", "4K", etc.
                if (!text.matches("\\d+(st|nd|rd|th|D|K|HD|p|bit)")) {
                    // Check if it looks like a name or word with OCR error
                    // If it starts with lowercase and has a number, likely OCR error
                    if (Character.isLowerCase(text.charAt(0)) && text.matches(".*\\d.*")) {
                        return true;
                    }
                }
            }
        }
        
        // Pattern 2: Very short text (1-2 characters) that's not a common word
        if (text.length() <= 2) {
            // Allow common short words
            String lower = text.toLowerCase();
            if (!lower.equals("a") && !lower.equals("i") && !lower.equals("an") && 
                !lower.equals("am") && !lower.equals("is") && !lower.equals("it") &&
                !lower.equals("in") && !lower.equals("on") && !lower.equals("at") &&
                !lower.equals("to") && !lower.equals("of") && !lower.equals("or") &&
                !lower.equals("as") && !lower.equals("be") && !lower.equals("we") &&
                !lower.equals("he") && !lower.equals("me") && !lower.equals("my") &&
                !lower.equals("up") && !lower.equals("so") && !lower.equals("no") &&
                !lower.equals("go") && !lower.equals("do") && !lower.equals("if")) {
                return true;
            }
        }
        
        // Pattern 3: Mostly non-alphabetic characters (likely OCR noise)
        int alphaCount = 0;
        int totalChars = 0;
        for (char c : text.toCharArray()) {
            if (Character.isLetter(c)) {
                alphaCount++;
            }
            if (!Character.isWhitespace(c)) {
                totalChars++;
            }
        }
        if (totalChars > 0 && (alphaCount * 100.0 / totalChars) < 30) {
            // Less than 30% alphabetic characters
            return true;
        }
        
        // Pattern 4: Repeated single characters (e.g., "aaa", "111")
        if (text.length() >= 3) {
            char first = text.charAt(0);
            boolean allSame = true;
            for (int i = 1; i < Math.min(text.length(), 5); i++) {
                if (text.charAt(i) != first && !Character.isWhitespace(text.charAt(i))) {
                    allSame = false;
                    break;
                }
            }
            if (allSame) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Checks if text is likely to contain OCR errors that should be corrected
     */
    private boolean isLikelyOcrError(String text) {
        if (text == null || text.length() < 3) {
            return false;
        }
        
        // Check for common OCR error patterns
        // Pattern 1: Number mixed with letters (e.g., "tin4")
        if (text.matches(".*[a-zA-Z]\\d+[a-zA-Z].*") || 
            text.matches(".*\\d+[a-zA-Z]{2,}.*") ||
            text.matches(".*[a-zA-Z]{2,}\\d+.*")) {
            // But allow valid patterns like "2nd", "3D", "4K"
            if (!text.matches(".*\\d+(st|nd|rd|th|D|K|HD|p|bit).*")) {
                return true;
            }
        }
        
        // Pattern 2: Text that looks like it's missing first letter (e.g., "ristopher")
        if (text.length() > 5 && Character.isLowerCase(text.charAt(0))) {
            // Check if it looks like a proper noun that lost its capital
            String firstWord = text.split("\\s+")[0];
            if (firstWord.length() > 4 && firstWord.matches("[a-z]+")) {
                return true;
            }
        }
        
        // Pattern 3: Contains = sign with short fragments
        if (text.contains("=") && text.length() < 20) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Merges fragmented text blocks that are likely part of a larger sentence
     * This helps fix issues where text is split incorrectly across elements
     */
    private List<XhtmlTextBlock> mergeFragmentedBlocks(List<XhtmlTextBlock> blocks) {
        if (blocks == null || blocks.size() <= 1) {
            return blocks;
        }
        
        List<XhtmlTextBlock> merged = new ArrayList<>();
        XhtmlTextBlock current = null;
        
        for (XhtmlTextBlock block : blocks) {
            if (current == null) {
                current = block;
                continue;
            }
            
            // Check if current block ends with punctuation or is very short
            String currentText = current.text.trim();
            String nextText = block.text.trim();
            
            boolean shouldMerge = false;
            
            // Merge if:
            // 1. Current block is very short (< 10 chars) and doesn't end with sentence punctuation
            // 2. Next block starts with lowercase (likely continuation)
            // 3. Current block doesn't end with sentence-ending punctuation
            if (currentText.length() < 10 && 
                !currentText.matches(".*[.!?]$") &&
                nextText.length() > 0 &&
                Character.isLowerCase(nextText.charAt(0))) {
                shouldMerge = true;
            }
            
            // Also merge if both are very short fragments
            if (currentText.length() < 5 && nextText.length() < 5 &&
                !currentText.matches(".*[.!?]$")) {
                shouldMerge = true;
            }
            
            if (shouldMerge) {
                // Merge blocks
                current.text = (currentText + " " + nextText).trim();
                current.html = current.html + " " + block.html;
                // Re-segment merged text
                TextSegmentationService.TextSegmentation segmentation = 
                    textSegmentationService.segmentText(current.text, current.id);
                current.words = segmentation.words;
                current.sentences = segmentation.sentences;
                current.phrases = segmentation.phrases;
                current.wordCount = segmentation.getWordCount();
                current.sentenceCount = segmentation.getSentenceCount();
                current.phraseCount = segmentation.getPhraseCount();
            } else {
                // Add current block and start new one
                merged.add(current);
                current = block;
            }
        }
        
        // Add the last block
        if (current != null) {
            merged.add(current);
        }
        
        return merged;
    }
    
    /**
     * Fallback extraction: Try to extract text from body and other top-level elements
     * when normal extraction finds too few blocks
     */
    private void extractFallbackTextBlocks(org.jsoup.nodes.Document doc, XhtmlPage page, int pageNumber) {
        try {
            // Try extracting from body directly
            Element body = doc.body();
            if (body != null) {
                // Get all direct text nodes and elements
                Elements allBodyElements = body.select("*");
                int initialBlockCount = page.textBlocks.size();
                int blockOrder = initialBlockCount + 1;
                
                for (Element elem : allBodyElements) {
                    // Skip if already processed (check by text content)
                    String text = elem.ownText(); // Get only direct text, not from children
                    if (text == null || text.trim().isEmpty()) {
                        continue;
                    }
                    
                    String trimmedText = cleanText(text.trim());
                    
                    // Check if this text is already in our blocks
                    boolean alreadyExists = page.textBlocks.stream()
                        .anyMatch(b -> b.text.equals(trimmedText) || b.text.contains(trimmedText) || trimmedText.contains(b.text));
                    if (alreadyExists) {
                        continue;
                    }
                    
                    // Less aggressive filtering for fallback - only filter obvious artifacts
                    if (trimmedText.length() < 1 || 
                        (trimmedText.length() == 1 && !Character.isLetterOrDigit(trimmedText.charAt(0)))) {
                        continue;
                    }
                    
                    // Skip if it's clearly an OCR artifact (but be less strict)
                    // Only filter obvious ones like "SS = fF AEE", not potential names
                    if (trimmedText.matches(".*=\\s*[A-Z]{1,3}\\s*[A-Z]{1,3}.*") || 
                        (trimmedText.length() <= 2 && !trimmedText.matches("[A-Za-z]{2}"))) {
                        continue;
                    }
                    
                    // Create block
                    String blockId = elem.id();
                    if (blockId == null || blockId.isEmpty()) {
                        blockId = "fallback-" + pageNumber + "-" + blockOrder;
                    }
                    
                    XhtmlTextBlock block = new XhtmlTextBlock();
                    block.id = blockId;
                    block.text = trimmedText;
                    block.html = elem.html();
                    block.tagName = elem.tagName();
                    block.readingOrder = blockOrder++;
                    
                    // Extract coordinates
                    String style = elem.attr("style");
                    Coordinates coords = extractCoordinates(elem, style, "", "", "", "");
                    block.coordinates = coords;
                    
                    // Segment text
                    TextSegmentationService.TextSegmentation segmentation = 
                        textSegmentationService.segmentText(trimmedText, blockId);
                    block.words = segmentation.words;
                    block.sentences = segmentation.sentences;
                    block.phrases = segmentation.phrases;
                    block.wordCount = segmentation.getWordCount();
                    block.sentenceCount = segmentation.getSentenceCount();
                    block.phraseCount = segmentation.getPhraseCount();
                    
                    page.textBlocks.add(block);
                }
                
                int addedBlocks = page.textBlocks.size() - initialBlockCount;
                logger.debug("Fallback extraction added {} additional text blocks", addedBlocks);
            }
        } catch (Exception e) {
            logger.warn("Error in fallback text extraction: {}", e.getMessage());
        }
    }

    /**
     * XHTML Page data structure
     */
    public static class XhtmlPage {
        public int pageNumber;
        public String fileName;
        public String fullHtml; // Complete HTML as-is
        public String pdfPageImage; // PDF page image (page_1.png, etc.) for visual display
        public List<XhtmlTextBlock> textBlocks;
        public List<XhtmlImage> images;
    }

    /**
     * XHTML Text Block data structure with segmentation and coordinates
     */
    public static class XhtmlTextBlock {
        public String id;
        public String text;
        public String html; // HTML with images preserved
        public String tagName;
        public Integer readingOrder;
        public Coordinates coordinates; // Reading order markers (position/coordinates)
        
        // Text segmentation (word, sentence, phrase level)
        public List<String> words = new ArrayList<>();
        public List<String> sentences = new ArrayList<>();
        public List<String> phrases = new ArrayList<>();
        public int wordCount;
        public int sentenceCount;
        public int phraseCount;
    }
    
    /**
     * Coordinates/Position data structure (reading order markers)
     */
    public static class Coordinates {
        public Double x;
        public Double y;
        public Double top;
        public Double left;
        public Double width;
        public Double height;
        public Integer readingOrder; // Calculated reading order based on position
    }

    /**
     * XHTML Image data structure
     */
    public static class XhtmlImage {
        public String src;
        public String alt;
        public String id;
    }
}

