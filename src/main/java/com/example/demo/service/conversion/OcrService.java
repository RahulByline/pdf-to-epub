package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.PageStructure;
import com.example.demo.dto.conversion.TextBlock;
import net.sourceforge.tess4j.Tesseract;
import net.sourceforge.tess4j.TesseractException;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.rendering.ImageType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import com.example.demo.service.GeminiTextCorrectionService;
import com.example.demo.service.ai.MultiProviderAiService;

import jakarta.annotation.PostConstruct;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Semaphore;

@Service
public class OcrService {

    private static final Logger logger = LoggerFactory.getLogger(OcrService.class);
    
    // ThreadLocal Tesseract instances for thread safety
    private static final ThreadLocal<Tesseract> tesseractThreadLocal = new ThreadLocal<>();

    @Value("${tesseract.datapath:}")
    private String tesseractDataPath;

    @Value("${ocr.enabled:true}")
    private boolean ocrEnabled;
    
    @Value("${ocr.use-ai-providers:false}")
    private boolean useAiProviders;
    
    @Value("${ocr.max-image-dimension:2500}")
    private int maxImageDimension;
    
    @Value("${ocr.max-concurrent:1}")
    private int maxConcurrentOcr;
    
    // Semaphore to limit concurrent OCR operations (Tesseract is not fully thread-safe)
    private Semaphore ocrSemaphore;
    
    @Autowired(required = false)
    private GeminiTextCorrectionService geminiTextCorrectionService;
    
    @Autowired(required = false)
    private MultiProviderAiService multiProviderAiService;
    
    @Value("${gemini.api.enabled:true}")
    private boolean geminiEnabled;

    /**
     * Gets or creates a thread-local Tesseract instance
     */
    private Tesseract getTesseractInstance() {
        Tesseract instance = tesseractThreadLocal.get();
        if (instance == null) {
            instance = createTesseractInstance();
            if (instance != null) {
                tesseractThreadLocal.set(instance);
            }
        }
        return instance;
    }
    
    /**
     * Creates a new Tesseract instance with proper configuration
     */
    private Tesseract createTesseractInstance() {
        try {
            Tesseract tess = new Tesseract();
            
            // Configure Tesseract to be more tolerant of errors
            // Set page segmentation mode to auto (mode 3) which is more robust
            tess.setPageSegMode(3); // Auto page segmentation
            
            // Set OCR engine mode (0 = Original Tesseract only, 1 = LSTM only, 2 = Both, 3 = Default)
            tess.setOcrEngineMode(3); // Use default (both engines)
            
            // Set data path if configured in application.properties
            if (tesseractDataPath != null && !tesseractDataPath.isEmpty()) {
                tess.setDatapath(tesseractDataPath);
                logger.debug("Tesseract data path set to: " + tesseractDataPath);
            } else {
                // Try to auto-detect common installation paths
                String[] defaultPaths = {
                    System.getenv("TESSDATA_PREFIX"),  // Environment variable
                    "D:/BYLINE-AACHAL/java-project/Tesseract/tessdata",  // User's custom path
                    "C:/Program Files/Tesseract-OCR/tessdata",  // Windows default
                    "C:/Program Files (x86)/Tesseract-OCR/tessdata",  // Windows 32-bit
                    "/usr/share/tesseract-ocr/5/tessdata",  // Linux Tesseract 5
                    "/usr/share/tesseract-ocr/4.00/tessdata",  // Linux Tesseract 4
                    "/usr/local/share/tesseract-ocr/tessdata",  // macOS Homebrew
                    "/opt/homebrew/share/tesseract-ocr/tessdata",  // macOS Homebrew (Apple Silicon)
                    "./tessdata"  // Local project directory
                };
                
                boolean pathFound = false;
                for (String path : defaultPaths) {
                    if (path != null) {
                        File dataDir = new File(path);
                        if (dataDir.exists() && dataDir.isDirectory()) {
                            tess.setDatapath(path);
                            logger.debug("Tesseract data path auto-detected: " + path);
                            pathFound = true;
                            break;
                        }
                    }
                }
                
                if (!pathFound) {
                    logger.warn("Tesseract data path not found. Trying default system paths. " +
                               "If OCR fails, set 'tesseract.datapath' in application.properties");
                }
            }
            
            // Set default language to English
            tess.setLanguage("eng");
            logger.debug("Tesseract OCR instance created for thread: {}", Thread.currentThread().getName());
            return tess;
            
        } catch (Exception e) {
            logger.warn("Failed to create Tesseract instance: {}", e.getMessage());
            return null;
        }
    }
    
    @PostConstruct
    private void initializeTesseract() {
        // Initialize semaphore with configured max concurrent OCR operations
        ocrSemaphore = new Semaphore(maxConcurrentOcr);
        logger.info("OCR configured with max concurrent operations: {} (semaphore permits: {})", 
                   maxConcurrentOcr, ocrSemaphore.availablePermits());
        
        // Test initialization by creating one instance
        Tesseract testInstance = createTesseractInstance();
        if (testInstance != null) {
            logger.info("Tesseract OCR initialization test successful. Instances will be created per-thread.");
            // Clean up test instance
            tesseractThreadLocal.remove();
        } else {
            logger.warn("Tesseract OCR initialization test failed. OCR functionality will be limited. " +
                       "Please install Tesseract OCR and ensure it's in your system PATH or configure " +
                       "tesseract.datapath in application.properties");
        }
    }
    
    /**
     * Cleanup thread-local Tesseract instance (call when thread is done)
     */
    public void cleanup() {
        Tesseract instance = tesseractThreadLocal.get();
        if (instance != null) {
            tesseractThreadLocal.remove();
            logger.debug("Cleaned up Tesseract instance for thread: {}", Thread.currentThread().getName());
        }
    }

    public PageStructure performOcr(File pdfFile, int pageIndex, String language) throws IOException {
        PageStructure pageStructure = new PageStructure();
        pageStructure.setPageNumber(pageIndex + 1);
        pageStructure.setIsScanned(true);

        // Check if OCR is disabled via configuration
        if (!ocrEnabled) {
            logger.info("OCR is disabled via configuration. Skipping OCR for page {}", pageIndex);
            pageStructure.setOcrConfidence(0.0);
            pageStructure.setTextBlocks(new ArrayList<>());
            return pageStructure;
        }

        Tesseract tesseract = getTesseractInstance();
        if (tesseract == null) {
            logger.warn("Tesseract not initialized. Skipping OCR for page {}. " +
                       "Will use image-based fixed-layout EPUB instead.", pageIndex);
            pageStructure.setOcrConfidence(0.0);
            pageStructure.setTextBlocks(new ArrayList<>());
            return pageStructure;
        }

        try (PDDocument document = Loader.loadPDF(pdfFile)) {
            // Set language if provided, mapping common ISO codes to Tesseract codes
            if (language != null && !language.isEmpty()) {
                String tessLang = mapLanguageCode(language);
                tesseract.setLanguage(tessLang);
                logger.debug("Using Tesseract language: {} (mapped from: {})", tessLang, language);
            }

            // Render PDF page to image
            PDFRenderer renderer = new PDFRenderer(document);
            BufferedImage image = renderer.renderImageWithDPI(pageIndex, 300, ImageType.RGB);

            // Try AI providers first (multi-provider with automatic fallback)
            // Free Tier: Disabled by default - use local Tesseract only
            String ocrText = null;
            if (useAiProviders && multiProviderAiService != null && multiProviderAiService.hasAvailableProvider()) {
                try {
                    logger.debug("🖼️ Attempting to extract text from page {} image using AI providers", pageIndex + 1);
                    // Convert BufferedImage to byte array
                    java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                    javax.imageio.ImageIO.write(image, "PNG", baos);
                    byte[] imageBytes = baos.toByteArray();
                    
                    ocrText = multiProviderAiService.extractTextFromImage(imageBytes, "png");
                    if (ocrText != null && !ocrText.trim().isEmpty()) {
                        logger.info("✅ AI provider extracted {} characters from page {} image", 
                                   ocrText.length(), pageIndex + 1);
                    } else {
                        logger.debug("⚠️ AI providers returned no text, falling back to Tesseract");
                    }
                } catch (Exception e) {
                    logger.warn("⚠️ Error using AI providers, falling back to Tesseract: {}", e.getMessage());
                }
            }
            // Fallback to legacy Gemini service if multi-provider not available
            else if (geminiTextCorrectionService != null && geminiEnabled) {
                try {
                    logger.debug("🖼️ Attempting to extract text from page {} image using Gemini Vision API (legacy)", pageIndex + 1);
                    java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                    javax.imageio.ImageIO.write(image, "PNG", baos);
                    byte[] imageBytes = baos.toByteArray();
                    
                    ocrText = geminiTextCorrectionService.extractTextFromImage(imageBytes, "png");
                    if (ocrText != null && !ocrText.trim().isEmpty()) {
                        logger.info("✅ Gemini Vision extracted {} characters from page {} image", 
                                   ocrText.length(), pageIndex + 1);
                    } else {
                        logger.debug("⚠️ Gemini Vision returned no text, falling back to Tesseract");
                    }
                } catch (Exception e) {
                    logger.warn("⚠️ Error using Gemini Vision API, falling back to Tesseract: {}", e.getMessage());
                }
            }
            
            // Fallback to Tesseract OCR if Gemini Vision didn't work
            if (ocrText == null || ocrText.trim().isEmpty()) {
                // Perform OCR with comprehensive error handling for assertion failures
                // Use semaphore to ensure only one OCR operation at a time (Tesseract is not fully thread-safe)
                try {
                    // Acquire semaphore to limit concurrent OCR operations
                    if (ocrSemaphore != null) {
                        ocrSemaphore.acquire();
                    }
                    try {
                        ocrText = performOcrWithFallback(renderer, pageIndex, image, tesseract);
                    } finally {
                        if (ocrSemaphore != null) {
                            ocrSemaphore.release();
                        }
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    logger.error("OCR interrupted for page {}", pageIndex);
                    ocrText = "";
                }
            }

            // Process OCR results if we got any text
            if (ocrText != null && !ocrText.trim().isEmpty()) {
            // Use Gemini AI to correct OCR errors if available
            String correctedOcrText = ocrText;
            if (geminiTextCorrectionService != null && geminiEnabled) {
                try {
                    String context = "OCR result from scanned PDF page " + (pageIndex + 1);
                    correctedOcrText = geminiTextCorrectionService.correctOcrText(ocrText, context);
                    if (correctedOcrText == null || correctedOcrText.isEmpty()) {
                        correctedOcrText = ocrText; // Fallback to original
                    } else {
                        logger.info("🤖 AI corrected OCR text for page {} ({} chars -> {} chars)", 
                                   pageIndex + 1, ocrText.length(), correctedOcrText.length());
                    }
                } catch (Exception e) {
                    logger.warn("Error correcting OCR text with Gemini, using original: {}", e.getMessage());
                    correctedOcrText = ocrText;
                }
            }
            
            Double confidence = calculateOcrConfidence(correctedOcrText);
            pageStructure.setOcrConfidence(confidence);

            // Convert OCR text to text blocks
            List<TextBlock> textBlocks = parseOcrText(correctedOcrText, pageIndex);
            pageStructure.setTextBlocks(textBlocks);
            } else {
                // No text extracted - set low confidence
                logger.warn("No text extracted from page {} via OCR", pageIndex);
                pageStructure.setOcrConfidence(0.0);
                pageStructure.setTextBlocks(new ArrayList<>());
            }

        } catch (Throwable e) {
            // Catch any unexpected exceptions or errors during PDF rendering or processing
            logger.error("Unexpected error/exception during OCR processing for page {} ({}): {}", 
                        pageIndex, e.getClass().getSimpleName(), e.getMessage(), e);
            pageStructure.setOcrConfidence(0.0);
            pageStructure.setTextBlocks(new ArrayList<>());
        }

        return pageStructure;
    }

    private List<TextBlock> parseOcrText(String ocrText, int pageIndex) {
        List<TextBlock> blocks = new ArrayList<>();
        String[] lines = ocrText.split("\n");
        int blockOrder = 0;

        for (String line : lines) {
            if (line.trim().isEmpty()) continue;

            TextBlock block = new TextBlock();
            block.setId("ocr_block_" + pageIndex + "_" + blockOrder++);
            block.setText(line.trim());
            block.setType(TextBlock.BlockType.PARAGRAPH); // OCR typically doesn't preserve structure
            block.setReadingOrder(blockOrder);
            block.setConfidence(0.8); // OCR has lower confidence than digital text
            blocks.add(block);
        }

        return blocks;
    }

    private Double calculateOcrConfidence(String ocrText) {
        // Simplified confidence calculation
        // In production, use Tesseract's confidence scores per word/character
        if (ocrText == null || ocrText.trim().isEmpty()) {
            return 0.0;
        }

        // Basic heuristic: longer text with fewer suspicious characters = higher confidence
        int suspiciousChars = 0;
        for (char c : ocrText.toCharArray()) {
            if (c == '?' || c == '|' || c == '1' && ocrText.length() < 10) {
                suspiciousChars++;
            }
        }

        double baseConfidence = 0.7;
        double penalty = Math.min(0.3, suspiciousChars * 0.05);
        return Math.max(0.0, baseConfidence - penalty);
    }

    public void setLanguage(String language) {
        Tesseract tesseract = getTesseractInstance();
        if (tesseract != null) {
            try {
                String tessLang = mapLanguageCode(language);
                tesseract.setLanguage(tessLang);
            } catch (Exception e) {
                logger.warn("Failed to set OCR language to " + language, e);
            }
        }
    }

    /**
     * Performs OCR with comprehensive fallback strategies for handling assertion failures
     */
    private String performOcrWithFallback(PDFRenderer renderer, int pageIndex, BufferedImage image, Tesseract tesseract) {
        // Validate image before processing
        if (image == null || image.getWidth() <= 0 || image.getHeight() <= 0) {
            logger.error("Invalid image for page {}: width={}, height={}", 
                        pageIndex, image != null ? image.getWidth() : 0, 
                        image != null ? image.getHeight() : 0);
            return "";
        }
        
        // Check image size - if too large, scale it down to prevent memory issues
        // Use configured max dimension to prevent memory access errors
        int maxDimension = maxImageDimension;
        if (image.getWidth() > maxDimension || image.getHeight() > maxDimension) {
            logger.warn("Image for page {} is very large ({}x{}). Scaling down to prevent memory issues.", 
                       pageIndex, image.getWidth(), image.getHeight());
            double scale = Math.min((double)maxDimension / image.getWidth(), 
                                   (double)maxDimension / image.getHeight());
            int newWidth = (int)(image.getWidth() * scale);
            int newHeight = (int)(image.getHeight() * scale);
            Image scaledImage = image.getScaledInstance(newWidth, newHeight, Image.SCALE_SMOOTH);
            BufferedImage scaledBuffered = new BufferedImage(newWidth, newHeight, BufferedImage.TYPE_INT_RGB);
            Graphics2D g2d = scaledBuffered.createGraphics();
            g2d.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, 
                               java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g2d.drawImage(scaledImage, 0, 0, null);
            g2d.dispose();
            image = scaledBuffered;
        }
        
        // Strategy 1: Try normal OCR first (with timeout protection)
        try {
            // Use a smaller image size initially to reduce memory pressure
            if (image.getWidth() > 2500 || image.getHeight() > 2500) {
                // Pre-scale to 2500px max before OCR
                double scale = Math.min(2500.0 / image.getWidth(), 2500.0 / image.getHeight());
                int newWidth = (int)(image.getWidth() * scale);
                int newHeight = (int)(image.getHeight() * scale);
                Image scaled = image.getScaledInstance(newWidth, newHeight, Image.SCALE_SMOOTH);
                BufferedImage scaledBuffered = new BufferedImage(newWidth, newHeight, BufferedImage.TYPE_INT_RGB);
                Graphics2D g2d = scaledBuffered.createGraphics();
                g2d.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, 
                                   java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                g2d.drawImage(scaled, 0, 0, null);
                g2d.dispose();
                image = scaledBuffered;
            }
            return tesseract.doOCR(image);
        } catch (TesseractException e) {
            String errorMsg = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
            String exceptionClass = e.getClass().getSimpleName();
            
            // Check if it's an assertion failure or internal error
            boolean isAssertionFailure = errorMsg.contains("assert") || 
                                       errorMsg.contains("textord") || 
                                       errorMsg.contains("pagesegmain") ||
                                       errorMsg.contains("singleton") ||
                                       errorMsg.contains("to_blocks") ||
                                       exceptionClass.contains("Assertion");
            
            if (isAssertionFailure) {
                logger.warn("Tesseract assertion failure on page {} ({}). " +
                           "Attempting fallback strategies. Error: {}", 
                           pageIndex, exceptionClass, e.getMessage());
                
                // Strategy 2: Try with different page segmentation mode (single block)
                try {
                    tesseract.setPageSegMode(6); // Assume uniform block of text
                    String result = tesseract.doOCR(image);
                    tesseract.setPageSegMode(3); // Restore original mode (auto)
                    logger.info("Fallback OCR succeeded for page {} with PSM 6 (single block)", pageIndex);
                    return result;
                } catch (Throwable e2) {
                    tesseract.setPageSegMode(3); // Restore original mode
                    logger.debug("Fallback strategy 2 (PSM 6) failed for page {}: {}", 
                                pageIndex, e2.getClass().getSimpleName());
                }
                
                // Strategy 3: Try with single line mode
                try {
                    tesseract.setPageSegMode(7); // Treat image as single text line
                    String result = tesseract.doOCR(image);
                    tesseract.setPageSegMode(3); // Restore original mode (auto)
                    logger.info("Fallback OCR succeeded for page {} with PSM 7 (single line)", pageIndex);
                    return result;
                } catch (Throwable e3) {
                    tesseract.setPageSegMode(3); // Restore original mode
                    logger.debug("Fallback strategy 3 (PSM 7) failed for page {}: {}", 
                                pageIndex, e3.getClass().getSimpleName());
                }
                
                // Strategy 4: Try with lower DPI (200)
                try {
                    BufferedImage fallbackImage = renderer.renderImageWithDPI(pageIndex, 200, ImageType.RGB);
                    String result = tesseract.doOCR(fallbackImage);
                    logger.info("Fallback OCR succeeded for page {} at 200 DPI", pageIndex);
                    return result;
                } catch (Throwable e4) {
                    logger.debug("Fallback strategy 4 (200 DPI) failed for page {}: {}", 
                                pageIndex, e4.getClass().getSimpleName());
                }
                
                // Strategy 5: Try with even lower DPI (150) and single line mode
                try {
                    tesseract.setPageSegMode(7); // Single line
                    BufferedImage fallbackImage = renderer.renderImageWithDPI(pageIndex, 150, ImageType.RGB);
                    String result = tesseract.doOCR(fallbackImage);
                    tesseract.setPageSegMode(3); // Restore original mode (auto)
                    logger.info("Fallback OCR succeeded for page {} at 150 DPI with PSM 7", pageIndex);
                    return result;
                } catch (Throwable e5) {
                    tesseract.setPageSegMode(3); // Restore original mode
                    logger.debug("Fallback strategy 5 (150 DPI + PSM 7) failed for page {}: {}", 
                                pageIndex, e5.getClass().getSimpleName());
                }
                
                // All fallbacks failed
                logger.error("All OCR fallback strategies failed for page {}. Using empty text.", pageIndex);
                return ""; // Use empty text as last resort
            } else {
                // Not an assertion failure - log and return empty
                logger.error("Non-assertion OCR error for page {}: {}", pageIndex, e.getMessage(), e);
                return "";
            }
        } catch (Throwable e) {
            // Catch any other unexpected exceptions or errors (including memory access errors)
            String errorMsg = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
            String errorType = e.getClass().getSimpleName();
            
            // Check for memory access errors or assertion failures
            boolean isMemoryError = errorMsg.contains("invalid memory access") || 
                                   errorMsg.contains("memory") ||
                                   errorType.contains("Error") ||
                                   errorType.contains("OutOfMemory");
            
            boolean isAssertionFailure = errorMsg.contains("assert") || 
                                       errorMsg.contains("pagesegmain") || 
                                       errorMsg.contains("textord") || 
                                       errorMsg.contains("singleton");
            
            if (isMemoryError || isAssertionFailure) {
                logger.warn("Caught {} on page {} ({}). Attempting fallback. Error: {}", 
                          errorType, pageIndex, isMemoryError ? "memory issue" : "assertion failure", 
                          e.getMessage());
                
                // Try one more time with lower DPI and smaller image
                try {
                    BufferedImage fallbackImage = renderer.renderImageWithDPI(pageIndex, 200, ImageType.RGB);
                    // Scale down if still too large
                    if (fallbackImage.getWidth() > 3000 || fallbackImage.getHeight() > 3000) {
                        double scale = Math.min(3000.0 / fallbackImage.getWidth(), 
                                               3000.0 / fallbackImage.getHeight());
                        int newWidth = (int)(fallbackImage.getWidth() * scale);
                        int newHeight = (int)(fallbackImage.getHeight() * scale);
                        Image scaled = fallbackImage.getScaledInstance(newWidth, newHeight, 
                                                                       Image.SCALE_SMOOTH);
                        BufferedImage scaledBuffered = new BufferedImage(newWidth, newHeight, 
                                                                        BufferedImage.TYPE_INT_RGB);
                        Graphics2D g2d = scaledBuffered.createGraphics();
                        g2d.drawImage(scaled, 0, 0, null);
                        g2d.dispose();
                        fallbackImage = scaledBuffered;
                    }
                    return tesseract.doOCR(fallbackImage);
                } catch (Throwable fallbackException) {
                    logger.error("Final fallback also failed for page {} ({}). Using empty text.", 
                               pageIndex, fallbackException.getClass().getSimpleName());
                    return "";
                }
            }
            
            // Unknown error - log and return empty
            logger.error("Unexpected OCR error/exception for page {} ({}): {}", 
                        pageIndex, errorType, e.getMessage(), e);
            return "";
        }
    }

    /**
     * Maps common ISO 639-1 language codes to Tesseract language codes
     */
    private String mapLanguageCode(String language) {
        if (language == null || language.isEmpty()) {
            return "eng";
        }
        
        // Map common ISO 639-1 codes to Tesseract 3-letter codes
        switch (language.toLowerCase()) {
            case "en": return "eng";
            case "es": return "spa";
            case "fr": return "fra";
            case "de": return "deu";
            case "it": return "ita";
            case "pt": return "por";
            case "ru": return "rus";
            case "zh": return "chi_sim";
            case "ja": return "jpn";
            case "ko": return "kor";
            case "ar": return "ara";
            case "hi": return "hin";
            default: return language; // Return as-is if already in correct format
        }
    }
}

