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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Service
public class OcrService {

    private static final Logger logger = LoggerFactory.getLogger(OcrService.class);
    private Tesseract tesseract;

    @Value("${tesseract.datapath:}")
    private String tesseractDataPath;

    @PostConstruct
    private void initializeTesseract() {
        try {
            tesseract = new Tesseract();
            
            // Set data path if configured in application.properties
            if (tesseractDataPath != null && !tesseractDataPath.isEmpty()) {
                tesseract.setDatapath(tesseractDataPath);
                logger.info("Tesseract data path set to: " + tesseractDataPath);
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
                            tesseract.setDatapath(path);
                            logger.info("Tesseract data path auto-detected: " + path);
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
            tesseract.setLanguage("eng");
            logger.info("Tesseract OCR initialized successfully");
            
        } catch (Exception e) {
            logger.warn("Tesseract OCR initialization failed. OCR functionality will be limited. " +
                       "Please install Tesseract OCR and ensure it's in your system PATH or configure " +
                       "tesseract.datapath in application.properties", e);
            tesseract = null;
        }
    }

    public PageStructure performOcr(File pdfFile, int pageIndex, String language) throws IOException {
        PageStructure pageStructure = new PageStructure();
        pageStructure.setPageNumber(pageIndex + 1);
        pageStructure.setIsScanned(true);

        if (tesseract == null) {
            logger.error("Tesseract not initialized. Cannot perform OCR. " +
                        "Please install Tesseract OCR and restart the application.");
            pageStructure.setOcrConfidence(0.0);
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

            // Perform OCR
            String ocrText = tesseract.doOCR(image);
            Double confidence = calculateOcrConfidence(ocrText);

            pageStructure.setOcrConfidence(confidence);

            // Convert OCR text to text blocks
            List<TextBlock> textBlocks = parseOcrText(ocrText, pageIndex);
            pageStructure.setTextBlocks(textBlocks);

        } catch (TesseractException e) {
            logger.error("OCR failed for page " + pageIndex, e);
            pageStructure.setOcrConfidence(0.0);
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

