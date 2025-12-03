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
import com.example.demo.service.ai.RateLimiterService;

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
    private GeminiService geminiService;
    
    @Autowired(required = false)
    private RateLimiterService rateLimiter;

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
                boolean hasValidChildren = false;
                int validChildCount = 0;
                
                for (Element child : textChildren) {
                    if (child != elem && child.text() != null && !child.text().trim().isEmpty()) {
                        String childText = cleanText(child.text().trim());
                        if (!isOcrArtifact(childText) && childText.length() >= 2) {
                            isLeafNode = false;
                            // Check if this child is already processed or will be processed
                            if (!processedElements.contains(child)) {
                                hasValidChildren = true;
                                validChildCount++;
                            }
                        }
                    }
                }
                
                // Skip parent elements that have valid children - prefer processing children instead
                // Only skip if parent has multiple children (likely a container)
                if (!isLeafNode && hasValidChildren && validChildCount > 1) {
                    continue; // Skip parent container, process children instead
                }
                
                // Also skip if parent text is just concatenation of children (duplicate)
                if (!isLeafNode && validChildCount > 0) {
                    String parentText = cleanText(elem.ownText().trim()); // Only direct text, not children
                    // If parent has no direct text and only has children, skip it
                    if (parentText.length() < 5) {
                        continue; // Skip parent, process children
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
                
                // Check if this text is a subset or superset of already processed text
                for (String processedText : processedTexts) {
                    if (trimmedText.length() > 10 && processedText.length() > 10) {
                        // If one contains the other (with some overlap threshold), skip the shorter one
                        if (trimmedText.contains(processedText) && trimmedText.length() > processedText.length() * 1.2) {
                            // Current text is a superset - skip it if we already have the subset
                            continue;
                        }
                        if (processedText.contains(trimmedText) && processedText.length() > trimmedText.length() * 1.2) {
                            // Processed text is a superset - skip current
                            continue;
                        }
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
                String dataWidth = elem.attr("data-width");
                String dataHeight = elem.attr("data-height");
                
                // Extract coordinates from style or data attributes
                Coordinates coords = extractCoordinates(elem, style, dataX, dataY, dataTop, dataLeft, dataWidth, dataHeight);
                
                // Use Gemini AI to correct OCR artifacts if available
                String correctedText = trimmedText;
                if (geminiService != null && geminiService.isEnabled() && isLikelyOcrError(trimmedText)) {
                    try {
                        String prompt = String.format("""
                            You are a text-cleaning engine for EPUB conversion.
                            
                            Clean and normalize the following text extracted from PDF page %d:
                            - Remove OCR artifacts (e.g., "tin4" -> "Time", "ristopher" -> "Christopher")
                            - Fix missing or incorrect first letters
                            - Normalize spacing and punctuation
                            
                            Return ONLY the cleaned text, nothing else.
                            
                            TEXT:
                            %s
                            """, pageNumber, trimmedText);
                        
                        correctedText = geminiService.generate(prompt);
                        if (correctedText == null || correctedText.isEmpty()) {
                            correctedText = trimmedText; // Fallback to original
                        } else {
                            correctedText = correctedText.trim();
                            logger.debug("Gemini corrected: '{}' -> '{}'", trimmedText, correctedText);
                        }
                    } catch (Exception e) {
                        logger.warn("Error correcting text with Gemini, using original: {}", e.getMessage());
                        correctedText = trimmedText;
                    }
                }
                
                XhtmlTextBlock block = new XhtmlTextBlock();
                block.id = blockId;
                block.text = correctedText; // Use AI-corrected text if available
                
                // Detect semantic element type (heading, list, table, sidebar, callout, etc.)
                SemanticElementInfo semanticInfo = detectSemanticElement(elem, correctedText, pageNumber, htmlContent);
                block.tagName = semanticInfo.tagName;
                block.blockType = semanticInfo.blockType;
                
                // Update HTML to use the detected semantic tag
                if (!semanticInfo.tagName.equalsIgnoreCase(elem.tagName()) || semanticInfo.needsHtmlUpdate) {
                    // Create new HTML with correct semantic tag
                    String escapedText = correctedText.replace("&", "&amp;")
                                                     .replace("<", "&lt;")
                                                     .replace(">", "&gt;");
                    // Add appropriate attributes based on element type
                    String attributes = " id=\"" + blockId + "\"";
                    if (semanticInfo.className != null && !semanticInfo.className.isEmpty()) {
                        attributes += " class=\"" + semanticInfo.className + "\"";
                    }
                    block.html = "<" + semanticInfo.tagName + attributes + ">" + escapedText + "</" + semanticInfo.tagName + ">";
                } else {
                    block.html = htmlContent; // Preserve original HTML with images
                }
                
                block.readingOrder = blockOrder++;
                block.coordinates = coords; // Reading order markers (coordinates)
                
                // Store parent paragraph ID for merge detection
                // Find the closest parent paragraph element
                Element parentPara = elem.parent();
                String parentParaId = null;
                while (parentPara != null && !parentPara.tagName().equals("body")) {
                    if ("p".equalsIgnoreCase(parentPara.tagName()) || 
                        "div".equalsIgnoreCase(parentPara.tagName())) {
                        parentParaId = parentPara.id();
                        if (parentParaId == null || parentParaId.isEmpty()) {
                            // Generate ID for parent if it doesn't have one
                            parentParaId = "parent-" + parentPara.tagName() + "-" + System.identityHashCode(parentPara);
                        }
                        break;
                    }
                    parentPara = parentPara.parent();
                }
                // If element itself is a paragraph, use its own ID
                if ("p".equalsIgnoreCase(elem.tagName()) || "div".equalsIgnoreCase(elem.tagName())) {
                    block.parentElementId = blockId;
                } else {
                    block.parentElementId = parentParaId;
                }
                
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
            
            // Post-process: Detect and mark headers/footers to exclude from reading order
            page.textBlocks = detectAndMarkHeadersFooters(page.textBlocks, pageNumber);
            
            // Post-process: Group list items into ul/ol containers
            page.textBlocks = groupListItems(page.textBlocks);
            
            // Post-process: Improve reading order for multi-column layouts
            page.textBlocks = improveReadingOrder(page.textBlocks);
            
            // Detect if this is a two-page spread
            page.isTwoPageSpread = detectTwoPageSpread(page.textBlocks.stream()
                .filter(b -> !b.excludeFromReadingOrder)
                .collect(java.util.stream.Collectors.toList()));
            
            logger.debug("Extracted {} text blocks from page {} after filtering and merging (two-page spread: {})", 
                        page.textBlocks.size(), pageNumber, page.isTwoPageSpread);

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
                                          String dataTop, String dataLeft,
                                          String dataWidth, String dataHeight) {
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
        
        // Extract width and height from data attributes
        if (!dataWidth.isEmpty()) {
            try {
                coords.width = Double.parseDouble(dataWidth);
            } catch (NumberFormatException e) {
                // Ignore
            }
        }
        
        if (!dataHeight.isEmpty()) {
            try {
                coords.height = Double.parseDouble(dataHeight);
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
        
        // Pattern 3: Random capital letters mixed with lowercase (e.g., "MOMMA NR OAL ARAL. GRE ca")
        // Check if text has many random capitals without proper word structure
        if (text.length() > 5) {
            int capitalCount = 0;
            int lowercaseCount = 0;
            String[] words = text.split("\\s+");
            for (char c : text.toCharArray()) {
                if (Character.isUpperCase(c)) capitalCount++;
                else if (Character.isLowerCase(c)) lowercaseCount++;
            }
            // If mostly capitals with few lowercase and multiple words, likely artifact
            // Examples: "MOMMA NR OAL ARAL. GRE ca" - many capitals, few lowercase
            if (capitalCount > lowercaseCount * 1.5 && capitalCount > 4 && words.length >= 3) {
                return true;
            }
        }
        
        // Pattern 4: Mostly non-alphabetic characters (likely OCR noise)
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
        
        // Pattern 5: Very short fragments with random characters (e.g., "ye kn A tio", "cae ae y")
        // Check if text has many short words (1-3 chars) that don't form coherent sentences
        String[] words = text.split("\\s+");
        if (words.length >= 3) {
            int veryShortWordCount = 0;
            int wordsWithoutVowels = 0;
            for (String word : words) {
                // Remove punctuation for length check
                String cleanWord = word.replaceAll("[^a-zA-Z]", "").toLowerCase();
                if (cleanWord.length() <= 2 && cleanWord.length() > 0) {
                    veryShortWordCount++;
                }
                // Check if word lacks vowels (gibberish detection)
                if (cleanWord.length() >= 2 && !cleanWord.matches(".*[aeiou].*")) {
                    wordsWithoutVowels++;
                }
            }
            // If more than 60% are very short words (1-2 chars), likely artifact
            if (words.length > 0 && veryShortWordCount * 100.0 / words.length > 60) {
                return true;
            }
            // If many words without vowels, likely artifact (e.g., "cae ae y")
            if (words.length > 0 && wordsWithoutVowels * 100.0 / words.length > 40) {
                return true;
            }
        }
        
        // Pattern 6: Repeated single characters (e.g., "aaa", "111")
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
            
            // IMPORTANT: Only merge blocks from the same parent paragraph/div element
            // Don't merge across different paragraphs - they should remain separate
            boolean sameParent = current.parentElementId != null && 
                               block.parentElementId != null &&
                               current.parentElementId.equals(block.parentElementId);
            
            // Also check if both are from same element (same paragraph/container)
            boolean sameElement = current.id != null && block.id != null &&
                                 current.id.equals(block.id);
            
            // Also check if they're from the same tag type (both p, both div, etc.)
            boolean sameTagType = current.tagName != null && block.tagName != null &&
                                 current.tagName.equalsIgnoreCase(block.tagName);
            
            // Check if blocks are adjacent (close reading order) - helps identify fragments
            boolean adjacentBlocks = false;
            if (current.readingOrder != null && block.readingOrder != null) {
                int orderDiff = Math.abs(block.readingOrder - current.readingOrder);
                adjacentBlocks = orderDiff <= 2; // Within 2 positions
            }
            
            // Only merge if blocks are from the same parent element OR are adjacent with same tag
            // This allows merging fragments within same paragraph even if parentElementId is null
            boolean canMerge = sameParent || sameElement || (sameTagType && adjacentBlocks);
            
            if (!canMerge) {
                // Different paragraphs/containers - don't merge, keep separate
                merged.add(current);
                current = block;
                continue;
            }
            
            // Merge if:
            // 1. Current block doesn't end with sentence-ending punctuation (.!?)
            // 2. Next block starts with lowercase (likely continuation of sentence)
            // 3. Both blocks are from the same paragraph/container
            // This handles cases like "Have you ever wished you" + "were a horse?"
            if (canMerge) {
                // Primary merge condition: incomplete sentence + lowercase continuation
                if (nextText.length() > 0 && 
                    !currentText.matches(".*[.!?]\\s*$") &&
                    Character.isLowerCase(nextText.charAt(0))) {
                    shouldMerge = true;
                    logger.debug("Merging blocks: '{}' + '{}' (incomplete sentence)", 
                               currentText.length() > 30 ? currentText.substring(0, 30) + "..." : currentText,
                               nextText.length() > 30 ? nextText.substring(0, 30) + "..." : nextText);
                }
                
                // Also merge if current block ends with a question word or verb that implies continuation
                // e.g., "Have you ever wished you" + "were a horse?"
                if (nextText.length() > 0 && 
                    (currentText.toLowerCase().endsWith(" you") ||
                     currentText.toLowerCase().endsWith(" have") ||
                     currentText.toLowerCase().endsWith(" are") ||
                     currentText.toLowerCase().endsWith(" is") ||
                     currentText.toLowerCase().endsWith(" was") ||
                     currentText.toLowerCase().endsWith(" were") ||
                     currentText.toLowerCase().endsWith(" do") ||
                     currentText.toLowerCase().endsWith(" did") ||
                     currentText.toLowerCase().endsWith(" can") ||
                     currentText.toLowerCase().endsWith(" could") ||
                     currentText.toLowerCase().endsWith(" would") ||
                     currentText.toLowerCase().endsWith(" should"))) {
                    // Check if next block completes the sentence (starts with lowercase or is a question)
                    if (Character.isLowerCase(nextText.charAt(0)) || nextText.trim().endsWith("?")) {
                        shouldMerge = true;
                        logger.debug("Merging blocks: '{}' + '{}' (verb/question continuation)", 
                                   currentText.length() > 30 ? currentText.substring(0, 30) + "..." : currentText,
                                   nextText.length() > 30 ? nextText.substring(0, 30) + "..." : nextText);
                    }
                }
                
                // Also merge if current block is very short (< 10 chars) and doesn't end with sentence punctuation
            if (currentText.length() < 10 && 
                    !currentText.matches(".*[.!?]\\s*$") &&
                nextText.length() > 0 &&
                Character.isLowerCase(nextText.charAt(0))) {
                shouldMerge = true;
            }
            
                // Also merge if both are very short fragments from same element
            if (currentText.length() < 5 && nextText.length() < 5 &&
                    !currentText.matches(".*[.!?]\\s*$")) {
                shouldMerge = true;
                }
                
                // Use AI to intelligently merge if enabled and not already decided
                // Only use AI if rate limit allows (avoid excessive calls)
                if (!shouldMerge && geminiService != null && geminiService.isEnabled()) {
                    // Check if rate limit would allow before making expensive AI call
                    if (rateLimiter != null && rateLimiter.wouldAllow("Gemini")) {
                        shouldMerge = shouldMergeWithAI(currentText, nextText);
                    }
                }
            }
            
            if (shouldMerge) {
                // Check if blocks are duplicates or one is subset of the other
                String mergedText = (currentText + " " + nextText).trim();
                
                // Don't merge if one block is a subset of the other (likely duplicate)
                if (currentText.length() > 20 && nextText.length() > 20) {
                    if (currentText.contains(nextText) || nextText.contains(currentText)) {
                        // One is subset of other - don't merge, keep the longer one
                        if (currentText.length() >= nextText.length()) {
                            merged.add(current);
                            current = block; // Skip the shorter duplicate
                            continue;
                        } else {
                            // Skip current, keep next
                            current = block;
                            continue;
                        }
                    }
                }
                
                // Merge blocks
                current.text = mergedText;
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
        
        // Post-process: Use AI to merge remaining fragments if AI is enabled
        if (geminiService != null && geminiService.isEnabled() && merged.size() > 1) {
            merged = aiMergeSentenceFragments(merged);
        }
        
        // Post-process: Merge blocks that belong to the same paragraph
        // This handles cases where complete sentences are split into multiple blocks
        merged = mergeParagraphBlocks(merged);
        
        return merged;
    }
    
    /**
     * Merges blocks that belong to the same paragraph but were split into multiple blocks
     * This handles cases like: "Horses are fast, too. They" + "are one of the fastest animals in" + "the world."
     * All should be merged into one paragraph
     */
    private List<XhtmlTextBlock> mergeParagraphBlocks(List<XhtmlTextBlock> blocks) {
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
            
            String currentText = current.text.trim();
            String nextText = block.text.trim();
            
            // Check if blocks are from same paragraph/container
            boolean sameParent = current.parentElementId != null && 
                               block.parentElementId != null &&
                               current.parentElementId.equals(block.parentElementId);
            boolean sameTagType = current.tagName != null && block.tagName != null &&
                                 current.tagName.equalsIgnoreCase(block.tagName);
            
            // Check if blocks are adjacent (close reading order)
            boolean adjacentBlocks = false;
            if (current.readingOrder != null && block.readingOrder != null) {
                int orderDiff = Math.abs(block.readingOrder - current.readingOrder);
                adjacentBlocks = orderDiff <= 5; // Within 5 positions (more lenient for paragraphs)
            }
            
            // Determine if blocks belong to same paragraph
            boolean sameParagraph = sameParent || (sameTagType && adjacentBlocks);
            
            if (sameParagraph) {
                boolean shouldMerge = false;
                
                // Use AI to determine if blocks belong to same paragraph (when AI is enabled)
                // Only use AI if rate limit allows (avoid excessive calls)
                if (geminiService != null && geminiService.isEnabled() && 
                    rateLimiter != null && rateLimiter.wouldAllow("Gemini")) {
                    shouldMerge = shouldMergeParagraphsWithAI(currentText, nextText);
                } else {
                    // Heuristic-based merging when AI is not available or rate limited
                    shouldMerge = shouldMergeParagraphsHeuristic(currentText, nextText);
                }
                
                if (shouldMerge) {
                    // Merge blocks into one paragraph
                    String mergedText = (currentText + " " + nextText).trim();
                    current.text = mergedText;
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
                    
                    logger.debug("Merged paragraph blocks: '{}' + '{}'", 
                               currentText.length() > 40 ? currentText.substring(0, 40) + "..." : currentText,
                               nextText.length() > 40 ? nextText.substring(0, 40) + "..." : nextText);
                    continue; // Skip adding block, already merged
                }
            }
            
            // Not merged, add current and move to next
            merged.add(current);
            current = block;
        }
        
        // Add the last block
        if (current != null) {
            merged.add(current);
        }
        
        return merged;
    }
    
    /**
     * Heuristic-based logic to determine if two blocks belong to the same paragraph
     * Works without AI
     */
    private boolean shouldMergeParagraphsHeuristic(String currentText, String nextText) {
        if (currentText == null || nextText == null || currentText.isEmpty() || nextText.isEmpty()) {
            return false;
        }
        
        // Merge if next block starts with lowercase (continuation of sentence or paragraph)
        if (Character.isLowerCase(nextText.charAt(0))) {
            return true;
        }
        
        // Merge if current block doesn't end with sentence punctuation (incomplete sentence)
        if (!currentText.matches(".*[.!?]\\s*$")) {
            return true;
        }
        
        // Merge if current block ends with sentence punctuation but next starts with lowercase
        // This handles cases like "Horses are fast, too. They" where "They" continues the paragraph
        if (currentText.matches(".*[.!?]\\s*$") && 
            nextText.length() > 0 && 
            Character.isLowerCase(nextText.charAt(0))) {
            return true;
        }
        
        // Merge if current block ends without punctuation and next is a continuation
        // Handles: "the animal run far and jump" + "high." + "more than 50 miles per hour!"
        if (!currentText.matches(".*[.!?]\\s*$") && nextText.length() > 0) {
            // If next starts with lowercase or is a short fragment, merge
            if (Character.isLowerCase(nextText.charAt(0)) || nextText.length() < 20) {
                return true;
            }
        }
        
        // Merge if both blocks are short fragments (likely split incorrectly)
        // This handles cases where a paragraph is split into many small pieces
        // Example: "the animal run far and jump" + "high." + "more than 50 miles per hour!"
        if (currentText.length() < 50 && nextText.length() < 50) {
            // Check if they form a coherent text when combined
            String combined = (currentText + " " + nextText).trim();
            // If combined text makes sense (has proper structure), merge
            if (combined.length() > 15) {
                // Check if next block looks like a continuation (starts with lowercase or common words)
                String firstWord = nextText.split("\\s+")[0].toLowerCase();
                if (firstWord.matches("(the|a|an|this|that|these|those|it|they|we|you|he|she|i|and|or|but|so|then|also|too|as|when|while|if|because|since|are|is|was|were|can|could|will|would|should|may|might|must|have|has|had|do|does|did|high|more|most|some|many|few|all|each|every)")) {
                    return true;
                }
                // Also merge if current doesn't end with punctuation (incomplete)
                if (!currentText.matches(".*[.!?]\\s*$")) {
                    return true;
                }
            }
        }
        
        // Merge if current ends with common sentence connectors that expect continuation
        if (currentText.matches(".*\\s+(and|or|but|so|then|also|too|as|when|while|if|because|since)\\s*$")) {
            return true;
        }
        
        // Merge if next block starts with common continuation words (even if capitalized)
        String nextFirstWord = nextText.split("\\s+")[0];
        if (nextFirstWord.matches("(?i)^(The|A|An|This|That|These|Those|It|They|We|You|He|She|I|And|Or|But|So|Then|Also|Too|As|When|While|If|Because|Since)$")) {
            // Check if current block ends with a period (likely same paragraph)
            if (currentText.matches(".*\\.\\s*$")) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Uses AI to determine if two blocks belong to the same paragraph
     */
    private boolean shouldMergeParagraphsWithAI(String currentText, String nextText) {
        if (geminiService == null || !geminiService.isEnabled()) {
            return shouldMergeParagraphsHeuristic(currentText, nextText);
        }
        
        try {
            String prompt = String.format("""
                You are a text segmentation expert. Determine if these two text blocks belong to the same paragraph and should be merged.
                
                Block 1: "%s"
                Block 2: "%s"
                
                Return ONLY "YES" if they belong to the same paragraph (even if Block 1 ends with a period), or "NO" if they are separate paragraphs.
                
                Examples:
                - "Horses are fast, too. They" + "are one of the fastest animals in" = YES (same paragraph, continuation)
                - "Horses are fast, too. They" + "are one of the fastest animals in the world. People like to watch" = YES (same paragraph, multiple sentences)
                - "First paragraph ends here." + "Second paragraph starts here." = NO (different paragraphs)
                - "Some horses can run" + "more than 50 miles per hour!" = YES (same sentence/paragraph)
                
                Answer (YES or NO only):
                """, currentText, nextText);
            
            String response = geminiService.generate(prompt);
            if (response != null) {
                String trimmed = response.trim().toUpperCase();
                return trimmed.contains("YES");
            }
        } catch (Exception e) {
            logger.debug("AI paragraph merge check failed, using heuristic: {}", e.getMessage());
            return shouldMergeParagraphsHeuristic(currentText, nextText);
        }
        
        return false;
    }
    
    /**
     * Semantic element information
     */
    private static class SemanticElementInfo {
        String tagName;
        String blockType;
        String className;
        boolean needsHtmlUpdate;
        
        SemanticElementInfo(String tagName, String blockType, String className, boolean needsHtmlUpdate) {
            this.tagName = tagName;
            this.blockType = blockType;
            this.className = className;
            this.needsHtmlUpdate = needsHtmlUpdate;
        }
    }
    
    /**
     * Detects semantic element type (heading, list, table, sidebar, callout, etc.)
     * Works with or without AI - comprehensive detection for EPUB3 structure
     */
    private SemanticElementInfo detectSemanticElement(Element elem, String text, int pageNumber, String htmlContent) {
        if (text == null || text.trim().isEmpty()) {
            return new SemanticElementInfo(elem.tagName(), "PARAGRAPH", null, false);
        }
        
        String trimmedText = text.trim();
        String originalTag = elem.tagName().toLowerCase();
        
        // Check if element is already a semantic tag
        if (originalTag.matches("h[1-6]|ul|ol|li|table|tr|td|th|aside|figcaption|dfn")) {
            return new SemanticElementInfo(originalTag, getBlockTypeFromTag(originalTag), null, false);
        }
        
        // Use AI to detect semantic elements if enabled
        // Only use AI if rate limit allows (avoid excessive calls)
        // Use heuristics first, then AI only for uncertain cases
        if (geminiService != null && geminiService.isEnabled()) {
            // Check if rate limit would allow before making expensive AI call
            if (rateLimiter != null && rateLimiter.wouldAllow("Gemini")) {
                SemanticElementInfo aiDetected = detectSemanticElementWithAI(trimmedText, pageNumber);
                if (aiDetected != null && !aiDetected.tagName.equals("p")) {
                    return aiDetected;
                }
            }
        }
        
        // Heuristic-based semantic element detection (works without AI)
        return detectSemanticElementHeuristic(elem, trimmedText);
    }
    
    /**
     * Uses AI to detect semantic element type and return appropriate tag/class
     */
    private SemanticElementInfo detectSemanticElementWithAI(String text, int pageNumber) {
        if (geminiService == null || !geminiService.isEnabled()) {
            return null;
        }
        
        try {
            String prompt = String.format("""
                You are a document structure expert for EPUB3 conversion. Determine the semantic element type for this text.
                
                Text: "%s"
                
                Return ONE of the following in this exact format: "TAG:CLASS:TYPE"
                - "h1::HEADING" for main titles (e.g., "All About Horses", "Chapter 1")
                - "h2::HEADING" for section headings
                - "h3::HEADING" for subsection headings
                - "h4::HEADING" for sub-subsection headings
                - "li::LIST_ITEM" for list items (numbered or bulleted)
                - "p::PARAGRAPH" for regular paragraphs
                - "aside::SIDEBAR" for sidebars, callouts, notes
                - "div:callout:CALLOUT" for callout boxes
                - "div:question:QUESTION" for questions
                - "div:exercise:EXERCISE" for exercises
                - "div:example:EXAMPLE" for examples
                - "div:note:NOTE" for notes
                - "div:tip:TIP" for tips
                - "div:warning:WARNING" for warnings
                - "dfn::GLOSSARY_TERM" for glossary terms/key terms
                - "div:learning-objective:LEARNING_OBJECTIVE" for learning objectives
                - "figcaption::CAPTION" for image/figure captions
                - "aside:footnote:FOOTNOTE" for footnotes
                - "header::HEADER" for page headers (to exclude from reading order)
                - "footer::FOOTER" for page footers (to exclude from reading order)
                
                Examples:
                - "All About Horses" = "h1::HEADING"
                - "1. First item" = "li::LIST_ITEM"
                - "• Bullet point" = "li::LIST_ITEM"
                - "Note: Important information" = "div:note:NOTE"
                - "Tip: Remember to..." = "div:tip:TIP"
                - "Question: What is...?" = "div:question:QUESTION"
                - "Exercise 1: Solve..." = "div:exercise:EXERCISE"
                - "Example: Let's consider..." = "div:example:EXAMPLE"
                - "Warning: Be careful..." = "div:warning:WARNING"
                - "Key Term: Definition" = "dfn::GLOSSARY_TERM"
                - "Learning Objective: Students will..." = "div:learning-objective:LEARNING_OBJECTIVE"
                - "Figure 1: Horse running" = "figcaption::CAPTION"
                - "Horses are beautiful animals" = "p::PARAGRAPH"
                
                Return ONLY in format "TAG:CLASS:TYPE", nothing else:
                """, text);
            
            String response = geminiService.generate(prompt);
            if (response != null) {
                String trimmed = response.trim();
                // Parse format: "TAG:CLASS:TYPE"
                String[] parts = trimmed.split(":");
                if (parts.length >= 3) {
                    String tag = parts[0].trim().toLowerCase();
                    String className = parts[1].trim();
                    String blockType = parts[2].trim();
                    if (className.isEmpty()) className = null;
                    return new SemanticElementInfo(tag, blockType, className, true);
                } else if (parts.length == 2) {
                    String tag = parts[0].trim().toLowerCase();
                    String blockType = parts[1].trim();
                    return new SemanticElementInfo(tag, blockType, null, true);
                } else if (trimmed.matches("h[1-6]|p|li|aside|div|dfn|figcaption")) {
                    return new SemanticElementInfo(trimmed, "PARAGRAPH", null, true);
                }
            }
        } catch (Exception e) {
            logger.debug("AI semantic element detection failed, using heuristic: {}", e.getMessage());
        }
        
        return null;
    }
    
    /**
     * Heuristic-based semantic element detection (works without AI)
     */
    private SemanticElementInfo detectSemanticElementHeuristic(Element elem, String text) {
        String originalTag = elem.tagName().toLowerCase();
        
        // Detect lists
        if (text.matches("^\\d+[.)]\\s+.*") || text.matches("^[a-z][.)]\\s+.*")) {
            return new SemanticElementInfo("li", "LIST_ITEM", null, true);
        }
        if (text.matches("^[•\\-\\*]\\s+.*") || text.matches("^[○●▪▫]\\s+.*")) {
            return new SemanticElementInfo("li", "LIST_ITEM", null, true);
        }
        
        // Detect callouts, notes, tips, warnings
        String lowerText = text.toLowerCase();
        if (lowerText.startsWith("note:") || lowerText.startsWith("note ")) {
            return new SemanticElementInfo("div", "NOTE", "note", true);
        }
        if (lowerText.startsWith("tip:") || lowerText.startsWith("tip ")) {
            return new SemanticElementInfo("div", "TIP", "tip", true);
        }
        if (lowerText.startsWith("warning:") || lowerText.startsWith("warning ") || lowerText.startsWith("caution:")) {
            return new SemanticElementInfo("div", "WARNING", "warning", true);
        }
        if (lowerText.startsWith("callout:") || lowerText.startsWith("callout ")) {
            return new SemanticElementInfo("div", "CALLOUT", "callout", true);
        }
        
        // Detect questions
        if (lowerText.startsWith("question:") || lowerText.startsWith("question ") || 
            lowerText.matches("^.*\\?\\s*$") && text.length() < 100) {
            return new SemanticElementInfo("div", "QUESTION", "question", true);
        }
        
        // Detect exercises
        if (lowerText.startsWith("exercise") || lowerText.startsWith("practice") || 
            lowerText.startsWith("activity")) {
            return new SemanticElementInfo("div", "EXERCISE", "exercise", true);
        }
        
        // Detect examples
        if (lowerText.startsWith("example:") || lowerText.startsWith("example ") || 
            lowerText.startsWith("for example")) {
            return new SemanticElementInfo("div", "EXAMPLE", "example", true);
        }
        
        // Detect glossary terms
        if (lowerText.startsWith("key term:") || lowerText.startsWith("glossary:") ||
            lowerText.matches("^[A-Z][a-z]+(\\s+[A-Z][a-z]+)*:\\s+.*")) {
            return new SemanticElementInfo("dfn", "GLOSSARY_TERM", null, true);
        }
        
        // Detect learning objectives
        if (lowerText.startsWith("learning objective") || lowerText.startsWith("objective:") ||
            lowerText.startsWith("students will") || lowerText.startsWith("you will")) {
            return new SemanticElementInfo("div", "LEARNING_OBJECTIVE", "learning-objective", true);
        }
        
        // Detect captions (for figures/images)
        if (lowerText.startsWith("figure") || lowerText.startsWith("image") || 
            lowerText.startsWith("caption:") || lowerText.startsWith("caption ") ||
            lowerText.matches("^(fig|fig\\.|figure\\s+\\d+).*")) {
            return new SemanticElementInfo("figcaption", "CAPTION", null, true);
        }
        
        // Detect footnotes
        if (text.matches("^\\d+\\s+.*") && text.length() < 50) {
            return new SemanticElementInfo("aside", "FOOTNOTE", "footnote", true);
        }
        
        // Detect headers (page headers - exclude from reading order)
        String lowerTrimmed = text.toLowerCase().trim();
        if (lowerTrimmed.matches("^\\d+$") && text.length() < 5) {
            // Could be page number (header/footer)
            return new SemanticElementInfo("header", "HEADER", null, true);
        }
        
        // Detect footers (page footers - exclude from reading order)
        if (lowerTrimmed.matches("^page\\s+\\d+$") || 
            (lowerTrimmed.matches("^\\d+$") && text.length() < 5)) {
            // Could be page number (footer)
            return new SemanticElementInfo("footer", "FOOTER", null, true);
        }
        
        // Detect headings (h1, h2, h3)
        // Improved detection for titles like "If You Were a Horse"
        if (text.length() <= 60 && text.length() >= 3) {
            // Check for title case pattern (each word starts with capital)
            boolean isTitleCase = text.matches("^[A-Z][a-z]+(\\s+[A-Z][a-z]+)*(\\s+[a-z]+)*$");
            // Check for common title patterns
            boolean looksLikeTitle = text.matches("^(If You|All About|About|Chapter|Section|Part|Unit|Lesson|Introduction|Conclusion|Summary|What|How|Why|When|Where).*");
            // Check if it's a short phrase without sentence-ending punctuation
            boolean isShortPhrase = text.length() < 50 && !text.matches(".*[.!]\\s*$");
            // Check if it's a question (ends with ?)
            boolean isQuestion = text.endsWith("?");
            
            // Strong title indicators
            if ((isTitleCase || looksLikeTitle) && (isShortPhrase || isQuestion)) {
                // Determine heading level based on length and position
                if (text.length() < 40 && (looksLikeTitle || isTitleCase)) {
                    return new SemanticElementInfo("h1", "HEADING", null, true);
                } else if (text.length() < 50) {
                    return new SemanticElementInfo("h2", "HEADING", null, true);
                }
            }
        }
        
        // Detect numbered headings (h2, h3)
        if (text.matches("^\\d+[.)]\\s+[A-Z].*")) {
            return new SemanticElementInfo("h2", "HEADING", null, true);
        }
        
        if (text.matches("^\\d+\\.\\d+[.)]\\s+.*")) {
            return new SemanticElementInfo("h3", "HEADING", null, true);
        }
        
        // Default: paragraph
        return new SemanticElementInfo(originalTag, "PARAGRAPH", null, false);
    }
    
    /**
     * Gets block type from HTML tag
     */
    private String getBlockTypeFromTag(String tag) {
        if (tag.matches("h[1-6]")) return "HEADING";
        if (tag.equals("li")) return "LIST_ITEM";
        if (tag.equals("ul")) return "LIST_UNORDERED";
        if (tag.equals("ol")) return "LIST_ORDERED";
        if (tag.equals("table") || tag.equals("tr") || tag.equals("td") || tag.equals("th")) return "TABLE";
        if (tag.equals("aside")) return "SIDEBAR";
        if (tag.equals("figcaption")) return "CAPTION";
        if (tag.equals("dfn")) return "GLOSSARY_TERM";
        return "PARAGRAPH";
    }
    
    /**
     * Detects headers and footers and marks them to exclude from reading order
     */
    private List<XhtmlTextBlock> detectAndMarkHeadersFooters(List<XhtmlTextBlock> blocks, int pageNumber) {
        if (blocks == null || blocks.isEmpty()) {
            return blocks;
        }
        
        // Calculate page boundaries (top 10% = header, bottom 10% = footer)
        double minTop = Double.MAX_VALUE;
        double maxTop = Double.MIN_VALUE;
        
        for (XhtmlTextBlock block : blocks) {
            if (block.coordinates != null && block.coordinates.top != null) {
                minTop = Math.min(minTop, block.coordinates.top);
                maxTop = Math.max(maxTop, block.coordinates.top);
            }
        }
        
        if (minTop == Double.MAX_VALUE || maxTop == Double.MIN_VALUE) {
            return blocks; // No coordinates available
        }
        
        double headerThreshold = minTop + (maxTop - minTop) * 0.1; // Top 10%
        double footerThreshold = maxTop - (maxTop - minTop) * 0.1; // Bottom 10%
        
        for (XhtmlTextBlock block : blocks) {
            if (block.coordinates != null && block.coordinates.top != null) {
                // Detect headers (top of page, short text, often page numbers or titles)
                if (block.coordinates.top <= headerThreshold) {
                    String text = block.text != null ? block.text.trim().toLowerCase() : "";
                    // Common header patterns: page numbers, chapter titles, headers
                    if (text.matches("^\\d+$") || // Page number
                        text.length() < 30 || // Short text at top
                        text.matches("^(chapter|section|part|unit|page).*")) {
                        block.isHeader = true;
                        block.excludeFromReadingOrder = true;
                        block.blockType = "HEADER";
                        logger.debug("Detected header: '{}' at top {}", block.text, block.coordinates.top);
                    }
                }
                
                // Detect footers (bottom of page, short text, often page numbers or footnotes)
                if (block.coordinates.top >= footerThreshold) {
                    String text = block.text != null ? block.text.trim().toLowerCase() : "";
                    // Common footer patterns: page numbers, footnotes
                    if (text.matches("^\\d+$") || // Page number
                        (text.length() < 30 && block.blockType != null && block.blockType.equals("FOOTNOTE"))) {
                        block.isFooter = true;
                        block.excludeFromReadingOrder = true;
                        block.blockType = "FOOTER";
                        logger.debug("Detected footer: '{}' at top {}", block.text, block.coordinates.top);
                    }
                }
            }
            
            // Also detect by text patterns
            String text = block.text != null ? block.text.trim().toLowerCase() : "";
            if (text.matches("^page\\s+\\d+$") || (text.matches("^\\d+$") && text.length() < 5)) {
                // Likely page number - could be header or footer
                if (block.coordinates != null && block.coordinates.top != null) {
                    if (block.coordinates.top <= headerThreshold) {
                        block.isHeader = true;
                        block.excludeFromReadingOrder = true;
                    } else if (block.coordinates.top >= footerThreshold) {
                        block.isFooter = true;
                        block.excludeFromReadingOrder = true;
                    }
                }
            }
        }
        
        return blocks;
    }
    
    /**
     * Groups list items into ul/ol containers
     */
    private List<XhtmlTextBlock> groupListItems(List<XhtmlTextBlock> blocks) {
        if (blocks == null || blocks.isEmpty()) {
            return blocks;
        }
        
        List<XhtmlTextBlock> grouped = new ArrayList<>();
        List<XhtmlTextBlock> currentList = new ArrayList<>();
        String currentListType = null; // "ul" or "ol"
        
        for (XhtmlTextBlock block : blocks) {
            if ("li".equalsIgnoreCase(block.tagName) || "LIST_ITEM".equals(block.blockType)) {
                // Determine list type
                String text = block.text != null ? block.text.trim() : "";
                String listType = null;
                
                if (text.matches("^\\d+[.)]\\s+.*") || text.matches("^[a-z][.)]\\s+.*")) {
                    listType = "ol"; // Ordered list
                } else if (text.matches("^[•\\-\\*]\\s+.*") || text.matches("^[○●▪▫]\\s+.*")) {
                    listType = "ul"; // Unordered list
                }
                
                // If list type matches or is first item, add to current list
                if (currentListType == null || currentListType.equals(listType)) {
                    currentList.add(block);
                    currentListType = listType != null ? listType : "ul"; // Default to ul
                } else {
                    // List type changed, create container for previous list
                    if (!currentList.isEmpty()) {
                        XhtmlTextBlock listContainer = createListContainer(currentList, currentListType);
                        if (listContainer != null) {
                            grouped.add(listContainer);
                        }
                        currentList.clear();
                    }
                    currentList.add(block);
                    currentListType = listType != null ? listType : "ul";
                }
            } else {
                // Not a list item - close current list if any
                if (!currentList.isEmpty()) {
                    XhtmlTextBlock listContainer = createListContainer(currentList, currentListType);
                    if (listContainer != null) {
                        grouped.add(listContainer);
                    }
                    currentList.clear();
                    currentListType = null;
                }
                grouped.add(block);
            }
        }
        
        // Close any remaining list
        if (!currentList.isEmpty()) {
            XhtmlTextBlock listContainer = createListContainer(currentList, currentListType);
            if (listContainer != null) {
                grouped.add(listContainer);
            }
        }
        
        return grouped;
    }
    
    /**
     * Creates a ul/ol container for list items
     */
    private XhtmlTextBlock createListContainer(List<XhtmlTextBlock> listItems, String listType) {
        if (listItems == null || listItems.isEmpty()) {
            return null;
        }
        
        String containerTag = (listType != null && listType.equals("ol")) ? "ol" : "ul";
        String blockType = (listType != null && listType.equals("ol")) ? "LIST_ORDERED" : "LIST_UNORDERED";
        
        // Build HTML for list container
        StringBuilder html = new StringBuilder();
        html.append("<").append(containerTag).append(">");
        for (XhtmlTextBlock item : listItems) {
            html.append(item.html);
        }
        html.append("</").append(containerTag).append(">");
        
        // Create container block
        XhtmlTextBlock container = new XhtmlTextBlock();
        container.id = "list_" + listItems.get(0).id;
        container.tagName = containerTag;
        container.blockType = blockType;
        container.html = html.toString();
        container.text = listItems.stream()
            .map(b -> b.text != null ? b.text : "")
            .collect(java.util.stream.Collectors.joining(" "));
        container.readingOrder = listItems.get(0).readingOrder;
        container.coordinates = listItems.get(0).coordinates;
        container.excludeFromReadingOrder = false;
        
        return container;
    }
    
    /**
     * Improves reading order for multi-column layouts and two-page spreads
     * Handles both single-page and split-page (2 pages per page) layouts
     */
    private List<XhtmlTextBlock> improveReadingOrder(List<XhtmlTextBlock> blocks) {
        if (blocks == null || blocks.isEmpty()) {
            return blocks;
        }
        
        // Filter out headers/footers from reading order
        List<XhtmlTextBlock> mainContent = blocks.stream()
            .filter(b -> !b.excludeFromReadingOrder)
            .collect(java.util.stream.Collectors.toList());
        
        if (mainContent.isEmpty()) {
            return blocks;
        }
        
        // Detect if this is a two-page spread (split page)
        boolean isTwoPageSpread = detectTwoPageSpread(mainContent);
        
        if (isTwoPageSpread) {
            // Two-page spread: Sort by column (left page, then right page), then top-to-bottom
            mainContent.sort((a, b) -> {
                if (a.coordinates != null && b.coordinates != null) {
                    // Get page width to determine left vs right
                    double maxLeft = mainContent.stream()
                        .filter(bl -> bl.coordinates != null && bl.coordinates.left != null)
                        .mapToDouble(bl -> bl.coordinates.left)
                        .max().orElse(0);
                    double pageWidth = maxLeft * 2; // Approximate page width
                    double midPoint = pageWidth / 2;
                    
                    // Determine which column (left or right page)
                    double aLeft = a.coordinates.left != null ? a.coordinates.left : 0;
                    double bLeft = b.coordinates.left != null ? b.coordinates.left : 0;
                    
                    boolean aIsLeft = aLeft < midPoint;
                    boolean bIsLeft = bLeft < midPoint;
                    
                    // Left page comes before right page
                    if (aIsLeft != bIsLeft) {
                        return aIsLeft ? -1 : 1;
                    }
                    
                    // Within same page, sort by top (top to bottom)
                    if (a.coordinates.top != null && b.coordinates.top != null) {
                        int topCompare = Double.compare(a.coordinates.top, b.coordinates.top);
                        if (topCompare != 0) return topCompare;
                    }
                    
                    // Same top, sort by left (left to right within column)
                    if (a.coordinates.left != null && b.coordinates.left != null) {
                        return Double.compare(a.coordinates.left, b.coordinates.left);
                    }
                }
                return 0;
            });
        } else {
            // Single page: Sort by top-to-bottom, then left-to-right
            mainContent.sort((a, b) -> {
                if (a.readingOrder != null && b.readingOrder != null) {
                    return a.readingOrder.compareTo(b.readingOrder);
                }
                // Fallback: sort by coordinates
                if (a.coordinates != null && b.coordinates != null) {
                    // First by top (top to bottom)
                    if (a.coordinates.top != null && b.coordinates.top != null) {
                        int topCompare = Double.compare(a.coordinates.top, b.coordinates.top);
                        if (topCompare != 0) return topCompare;
                    }
                    // Then by left (left to right)
                    if (a.coordinates.left != null && b.coordinates.left != null) {
                        return Double.compare(a.coordinates.left, b.coordinates.left);
                    }
                }
                return 0;
            });
        }
        
        // Update reading order numbers
        int order = 1;
        for (XhtmlTextBlock block : mainContent) {
            block.readingOrder = order++;
        }
        
        // Recombine with headers/footers (they keep their original positions but are excluded)
        List<XhtmlTextBlock> result = new ArrayList<>();
        for (XhtmlTextBlock block : blocks) {
            if (block.excludeFromReadingOrder) {
                result.add(block); // Headers/footers added but not in main reading order
            }
        }
        result.addAll(mainContent); // Main content with proper reading order
        
        return result;
    }
    
    /**
     * Detects if the page is a two-page spread (split page with 2 pages per page)
     */
    private boolean detectTwoPageSpread(List<XhtmlTextBlock> blocks) {
        if (blocks == null || blocks.size() < 2) {
            return false;
        }
        
        // First check: Look for page numbers at bottom (e.g., "10" and "11" on same page)
        // This is a strong indicator of a two-page spread
        List<String> pageNumbers = new ArrayList<>();
        for (XhtmlTextBlock block : blocks) {
            if (block.text != null) {
                String text = block.text.trim();
                // Check for single or double digit page numbers
                if (text.matches("^\\d{1,2}$") && text.length() <= 2) {
                    // Check if it's at the bottom of the page (likely footer)
                    if (block.coordinates != null && block.coordinates.top != null) {
                        pageNumbers.add(text);
                    }
                }
            }
        }
        
        // If we find 2 page numbers, it's likely a two-page spread
        if (pageNumbers.size() >= 2) {
            logger.debug("Detected two-page spread: found page numbers {}", pageNumbers);
            return true;
        }
        
        // Calculate page dimensions
        double minLeft = Double.MAX_VALUE;
        double maxLeft = Double.MIN_VALUE;
        double minTop = Double.MAX_VALUE;
        double maxTop = Double.MIN_VALUE;
        
        for (XhtmlTextBlock block : blocks) {
            if (block.coordinates != null) {
                if (block.coordinates.left != null) {
                    minLeft = Math.min(minLeft, block.coordinates.left);
                    maxLeft = Math.max(maxLeft, block.coordinates.left);
                }
                if (block.coordinates.top != null) {
                    minTop = Math.min(minTop, block.coordinates.top);
                    maxTop = Math.max(maxTop, block.coordinates.top);
                }
            }
        }
        
        if (minLeft == Double.MAX_VALUE || maxLeft == Double.MIN_VALUE) {
            return false; // No coordinates available
        }
        
        double pageWidth = maxLeft - minLeft;
        double midPoint = minLeft + (pageWidth / 2);
        
        // Count blocks in left vs right half
        int leftCount = 0;
        int rightCount = 0;
        
        for (XhtmlTextBlock block : blocks) {
            if (block.coordinates != null && block.coordinates.left != null) {
                if (block.coordinates.left < midPoint) {
                    leftCount++;
                } else {
                    rightCount++;
                }
            }
        }
        
        // If we have significant content in both halves, it's likely a two-page spread
        // Also check if there's a clear separation (gap) in the middle
        boolean hasClearSeparation = false;
        List<Double> leftPositions = new ArrayList<>();
        List<Double> rightPositions = new ArrayList<>();
        
        for (XhtmlTextBlock block : blocks) {
            if (block.coordinates != null && block.coordinates.left != null) {
                if (block.coordinates.left < midPoint) {
                    leftPositions.add(block.coordinates.left);
                } else {
                    rightPositions.add(block.coordinates.left);
                }
            }
        }
        
        if (!leftPositions.isEmpty() && !rightPositions.isEmpty()) {
            double maxLeftPos = leftPositions.stream().mapToDouble(Double::doubleValue).max().orElse(0);
            double minRightPos = rightPositions.stream().mapToDouble(Double::doubleValue).min().orElse(0);
            // If there's a gap between left and right content, it's a two-page spread
            hasClearSeparation = (minRightPos - maxLeftPos) > (pageWidth * 0.1); // 10% gap
        }
        
        // It's a two-page spread if:
        // 1. We have content in both halves, AND
        // 2. There's a clear separation, OR
        // 3. Both halves have significant content (at least 20% of blocks in each)
        boolean bothHalvesHaveContent = leftCount > 0 && rightCount > 0;
        boolean significantContentInBoth = leftCount >= blocks.size() * 0.2 && rightCount >= blocks.size() * 0.2;
        
        boolean isSpread = bothHalvesHaveContent && (hasClearSeparation || significantContentInBoth);
        if (isSpread) {
            logger.debug("Detected two-page spread: leftCount={}, rightCount={}, hasClearSeparation={}", 
                        leftCount, rightCount, hasClearSeparation);
        }
        return isSpread;
    }
    
    /**
     * Uses AI to intelligently determine if two blocks should be merged
     */
    private boolean shouldMergeWithAI(String currentText, String nextText) {
        if (geminiService == null || !geminiService.isEnabled()) {
            return false;
        }
        
        try {
            String prompt = String.format("""
                You are a text segmentation expert. Determine if these two text fragments should be merged into one complete sentence.
                
                Fragment 1: "%s"
                Fragment 2: "%s"
                
                Return ONLY "YES" if they should be merged (Fragment 2 continues Fragment 1), or "NO" if they are separate sentences.
                Do not include any explanation, only "YES" or "NO".
                """, currentText, nextText);
            
            String response = geminiService.generate(prompt);
            if (response != null) {
                String trimmed = response.trim().toUpperCase();
                return trimmed.contains("YES");
            }
        } catch (Exception e) {
            logger.debug("AI merge check failed, using default logic: {}", e.getMessage());
        }
        
        return false;
    }
    
    /**
     * Uses AI to intelligently merge sentence fragments across blocks
     */
    private List<XhtmlTextBlock> aiMergeSentenceFragments(List<XhtmlTextBlock> blocks) {
        if (blocks == null || blocks.size() <= 1 || geminiService == null || !geminiService.isEnabled()) {
            return blocks;
        }
        
        List<XhtmlTextBlock> merged = new ArrayList<>();
        XhtmlTextBlock current = null;
        
        for (XhtmlTextBlock block : blocks) {
            if (current == null) {
                current = block;
                continue;
            }
            
            String currentText = current.text.trim();
            String nextText = block.text.trim();
            
            // Check if blocks are from same paragraph/container
            boolean sameParent = current.parentElementId != null && 
                               block.parentElementId != null &&
                               current.parentElementId.equals(block.parentElementId);
            boolean sameTagType = current.tagName != null && block.tagName != null &&
                                 current.tagName.equalsIgnoreCase(block.tagName);
            
            if (sameParent || sameTagType) {
                // Use AI to check if these should be merged
                try {
                    String prompt = String.format("""
                        You are a text segmentation expert. Determine if these two text fragments from the same paragraph should be merged into one paragraph.
                        
                        Fragment 1: "%s"
                        Fragment 2: "%s"
                        
                        Return ONLY "YES" if Fragment 2 continues Fragment 1 in the same paragraph (even if Fragment 1 ends with a period), or "NO" if they are separate paragraphs.
                        
                        Examples:
                        - "Some horses can run" + "more than 50 miles per hour!" = YES (same sentence)
                        - "A horse can easily carry a person on" + "its back." = YES (same sentence)
                        - "Horses are fast, too. They" + "are one of the fastest animals in the world." = YES (same paragraph, continuation)
                        - "Horses are fast, too. They" + "are one of the fastest animals in" + "the world. People like to watch" = YES (all same paragraph)
                        - "First paragraph ends here." + "Second paragraph starts here." = NO (different paragraphs)
                        
                        Answer (YES or NO only):
                        """, currentText, nextText);
                    
                    String response = geminiService.generate(prompt);
                    if (response != null && response.trim().toUpperCase().contains("YES")) {
                        // Merge blocks
                        String mergedText = (currentText + " " + nextText).trim();
                        current.text = mergedText;
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
                        
                        logger.debug("AI merged: '{}' + '{}'", 
                                   currentText.length() > 40 ? currentText.substring(0, 40) + "..." : currentText,
                                   nextText.length() > 40 ? nextText.substring(0, 40) + "..." : nextText);
                        continue; // Skip adding block, already merged
                    }
                } catch (Exception e) {
                    logger.debug("AI merge failed for blocks, keeping separate: {}", e.getMessage());
                }
            }
            
            // Not merged, add current and move to next
            merged.add(current);
            current = block;
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
                    
                    // Detect semantic element type
                    SemanticElementInfo semanticInfo = detectSemanticElement(elem, trimmedText, pageNumber, elem.html());
                    block.tagName = semanticInfo.tagName;
                    block.blockType = semanticInfo.blockType;
                    
                    // Update HTML to use the detected semantic tag
                    if (semanticInfo.needsHtmlUpdate) {
                        String escapedText = trimmedText.replace("&", "&amp;")
                                                       .replace("<", "&lt;")
                                                       .replace(">", "&gt;");
                        String attributes = " id=\"" + blockId + "\"";
                        if (semanticInfo.className != null && !semanticInfo.className.isEmpty()) {
                            attributes += " class=\"" + semanticInfo.className + "\"";
                        }
                        block.html = "<" + semanticInfo.tagName + attributes + ">" + escapedText + "</" + semanticInfo.tagName + ">";
                    } else {
                    block.html = elem.html();
                    }
                    
                    block.readingOrder = blockOrder++;
                    
                    // Set parent element ID for merge detection
                    Element parentPara = elem.parent();
                    String parentParaId = null;
                    while (parentPara != null && !parentPara.tagName().equals("body")) {
                        if ("p".equalsIgnoreCase(parentPara.tagName()) || 
                            "div".equalsIgnoreCase(parentPara.tagName())) {
                            parentParaId = parentPara.id();
                            if (parentParaId == null || parentParaId.isEmpty()) {
                                parentParaId = "parent-" + parentPara.tagName() + "-" + System.identityHashCode(parentPara);
                            }
                            break;
                        }
                        parentPara = parentPara.parent();
                    }
                    if ("p".equalsIgnoreCase(elem.tagName()) || "div".equalsIgnoreCase(elem.tagName())) {
                        block.parentElementId = blockId;
                    } else {
                        block.parentElementId = parentParaId;
                    }
                    
                    // Extract coordinates
                    String style = elem.attr("style");
                    Coordinates coords = extractCoordinates(elem, style, "", "", "", "", "", "");
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
        public boolean isTwoPageSpread; // True if this is a two-page spread (split page)
        public List<XhtmlImage> images;
    }

    /**
     * XHTML Text Block data structure with segmentation and coordinates
     */
    public static class XhtmlTextBlock {
        public String id;
        public String text;
        public String html; // HTML with images preserved
        public String tagName; // HTML tag (h1, h2, p, li, div, aside, etc.)
        public String blockType; // Semantic block type (HEADING, PARAGRAPH, LIST_ITEM, NOTE, TIP, etc.)
        public Integer readingOrder;
        public Coordinates coordinates; // Reading order markers (position/coordinates)
        public String parentElementId; // ID of parent paragraph/div for merge detection
        public boolean isHeader; // True if this is a header (exclude from main reading order)
        public boolean isFooter; // True if this is a footer (exclude from main reading order)
        public boolean excludeFromReadingOrder; // True if should be excluded from main reading order
        
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

