package com.example.demo.service;

import com.example.demo.dto.PdfAnalysisResult;
import com.example.demo.model.PdfDocument;
import com.optimaize.langdetect.LanguageDetector;
import com.optimaize.langdetect.LanguageDetectorBuilder;
import com.optimaize.langdetect.ngram.NgramExtractors;
import com.optimaize.langdetect.profiles.LanguageProfileReader;
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
import java.util.*;
import java.util.regex.Pattern;

@Service
public class PdfAnalysisService {

    private static final Logger logger = LoggerFactory.getLogger(PdfAnalysisService.class);
    private LanguageDetector languageDetector;
    private static final Pattern FORMULA_PATTERN = Pattern.compile(
        ".*[∑∫∂∇√∞±≤≥≠≈∝αβγδεζηθικλμνξοπρστυφχψω].*|.*\\$.*\\$.*|.*\\(.*\\)|.*\\[.*\\].*"
    );

    public PdfAnalysisService() {
        try {
            languageDetector = LanguageDetectorBuilder.create(NgramExtractors.standard())
                    .withProfiles(new LanguageProfileReader().readAllBuiltIn())
                    .build();
        } catch (IOException e) {
            logger.error("Failed to initialize language detector", e);
        }
    }

    public PdfAnalysisResult analyzePdf(File pdfFile) throws IOException {
        PdfAnalysisResult result = new PdfAnalysisResult();
        
        try (PDDocument document = Loader.loadPDF(pdfFile)) {
            int totalPages = document.getNumberOfPages();
            
            // Extract text for analysis
            PDFTextStripper stripper = new PDFTextStripper();
            String fullText = stripper.getText(document);
            
            // Analyze document type
            result.setDocumentType(detectDocumentType(fullText, document));
            
            // Detect languages
            result.setLanguages(detectLanguages(fullText));
            
            // Analyze page quality and complex elements
            analyzePages(document, result, totalPages);
            
            // Determine overall page quality
            result.setPageQuality(determinePageQuality(result.getScannedPagesCount(), result.getDigitalPagesCount()));
            
            // Build metadata
            result.setAnalysisMetadata(buildMetadata(fullText, totalPages));
        }
        
        return result;
    }

    private PdfDocument.DocumentType detectDocumentType(String text, PDDocument document) {
        String lowerText = text.toLowerCase();
        int totalPages = document.getNumberOfPages();
        
        // Check for teacher guide indicators
        if (lowerText.contains("teacher") && (lowerText.contains("guide") || lowerText.contains("manual"))) {
            return PdfDocument.DocumentType.TEACHER_GUIDE;
        }
        
        // Check for workbook indicators
        if (lowerText.contains("workbook") || lowerText.contains("exercise") || 
            lowerText.contains("practice") || lowerText.contains("worksheet")) {
            return PdfDocument.DocumentType.WORKBOOK;
        }
        
        // Check for assessment indicators
        if (lowerText.contains("test") || lowerText.contains("exam") || 
            lowerText.contains("quiz") || lowerText.contains("assessment") ||
            lowerText.contains("question paper")) {
            return PdfDocument.DocumentType.ASSESSMENT;
        }
        
        // Check for reference material indicators
        if (lowerText.contains("reference") || lowerText.contains("dictionary") ||
            lowerText.contains("encyclopedia") || lowerText.contains("handbook")) {
            return PdfDocument.DocumentType.REFERENCE_MATERIAL;
        }
        
        // Textbook is default for educational content
        if (totalPages > 20 && (lowerText.contains("chapter") || lowerText.contains("lesson") ||
            lowerText.contains("unit") || lowerText.contains("section"))) {
            return PdfDocument.DocumentType.TEXTBOOK;
        }
        
        return PdfDocument.DocumentType.OTHER;
    }

    private List<String> detectLanguages(String text) {
        List<String> detectedLanguages = new ArrayList<>();
        
        if (languageDetector == null || text == null || text.trim().isEmpty()) {
            detectedLanguages.add("unknown");
            return detectedLanguages;
        }
        
        try {
            // Sample text for detection (first 1000 characters)
            String sampleText = text.length() > 1000 ? text.substring(0, 1000) : text;
            
            // Use getProbabilities to get language probabilities
            List<com.optimaize.langdetect.DetectedLanguage> probabilities = 
                languageDetector.getProbabilities(sampleText);
            
            if (probabilities != null && !probabilities.isEmpty()) {
                // Get the most probable language
                com.optimaize.langdetect.DetectedLanguage topLanguage = probabilities.get(0);
                String langCode = topLanguage.getLocale().getLanguage();
                detectedLanguages.add(langCode);
                
                // Check for multiple languages by analyzing different sections
                if (text.length() > 2000) {
                    String secondSample = text.substring(1000, Math.min(2000, text.length()));
                    List<com.optimaize.langdetect.DetectedLanguage> secondProbabilities = 
                        languageDetector.getProbabilities(secondSample);
                    
                    if (secondProbabilities != null && !secondProbabilities.isEmpty()) {
                        String secondLang = secondProbabilities.get(0).getLocale().getLanguage();
                        if (!secondLang.equals(langCode) && !detectedLanguages.contains(secondLang)) {
                            detectedLanguages.add(secondLang);
                        }
                    }
                }
            } else {
                detectedLanguages.add("unknown");
            }
        } catch (Exception e) {
            logger.error("Error detecting language", e);
            detectedLanguages.add("unknown");
        }
        
        return detectedLanguages.isEmpty() ? Arrays.asList("unknown") : detectedLanguages;
    }

    private void analyzePages(PDDocument document, PdfAnalysisResult result, int totalPages) throws IOException {
        int scannedCount = 0;
        int digitalCount = 0;
        boolean hasTables = false;
        boolean hasFormulas = false;
        boolean hasMultiColumn = false;
        
        PDFTextStripper stripper = new PDFTextStripper();
        
        // Analyze sample pages (first, middle, last) plus random pages
        Set<Integer> pagesToAnalyze = new HashSet<>();
        pagesToAnalyze.add(1);
        if (totalPages > 1) {
            pagesToAnalyze.add(totalPages);
        }
        if (totalPages > 2) {
            pagesToAnalyze.add(totalPages / 2);
        }
        // Add a few more random pages for better analysis
        Random random = new Random();
        for (int i = 0; i < Math.min(3, totalPages / 10); i++) {
            pagesToAnalyze.add(random.nextInt(totalPages) + 1);
        }
        
        for (int pageNum : pagesToAnalyze) {
            stripper.setStartPage(pageNum);
            stripper.setEndPage(pageNum);
            String pageText = stripper.getText(document);
            
            // Check if page is scanned (low text content or mostly images)
            boolean isScanned = isPageScanned(pageText, document, pageNum - 1);
            if (isScanned) {
                scannedCount++;
            } else {
                digitalCount++;
            }
            
            // Check for tables
            if (!hasTables && containsTable(pageText)) {
                hasTables = true;
            }
            
            // Check for formulas
            if (!hasFormulas && containsFormula(pageText)) {
                hasFormulas = true;
            }
            
            // Check for multi-column layout
            if (!hasMultiColumn && hasMultiColumnLayout(pageText, document, pageNum - 1)) {
                hasMultiColumn = true;
            }
        }
        
        // Extrapolate counts based on sample
        double scannedRatio = (double) scannedCount / pagesToAnalyze.size();
        double digitalRatio = (double) digitalCount / pagesToAnalyze.size();
        
        result.setScannedPagesCount((int) Math.round(scannedRatio * totalPages));
        result.setDigitalPagesCount((int) Math.round(digitalRatio * totalPages));
        result.setHasTables(hasTables);
        result.setHasFormulas(hasFormulas);
        result.setHasMultiColumn(hasMultiColumn);
    }

    private boolean isPageScanned(String pageText, PDDocument document, int pageIndex) {
        // If text is very sparse or empty, likely scanned
        if (pageText == null || pageText.trim().length() < 50) {
            return true;
        }
        
        // Check text density (characters per page area)
        try {
            PDPage page = document.getPage(pageIndex);
            PDRectangle mediaBox = page.getMediaBox();
            float pageArea = mediaBox.getWidth() * mediaBox.getHeight();
            float textDensity = pageText.length() / pageArea;
            
            // Low text density suggests scanned page
            return textDensity < 0.001;
        } catch (Exception e) {
            logger.warn("Error checking page quality", e);
            // Fallback: if text is very short, assume scanned
            return pageText.trim().length() < 100;
        }
    }

    private boolean containsTable(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        
        // Check for table patterns
        String[] lines = text.split("\n");
        int consecutiveTabbedLines = 0;
        int consecutivePipedLines = 0;
        
        for (String line : lines) {
            if (line.contains("\t") && line.split("\t").length >= 3) {
                consecutiveTabbedLines++;
            } else {
                consecutiveTabbedLines = 0;
            }
            
            if (line.contains("|") && line.split("\\|").length >= 3) {
                consecutivePipedLines++;
            } else {
                consecutivePipedLines = 0;
            }
            
            if (consecutiveTabbedLines >= 2 || consecutivePipedLines >= 2) {
                return true;
            }
        }
        
        return false;
    }

    private boolean containsFormula(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        
        // Check for mathematical symbols and patterns
        return FORMULA_PATTERN.matcher(text).find() ||
               text.matches(".*[a-zA-Z]\\s*=\\s*[0-9].*") || // Simple equations
               text.matches(".*\\^[0-9].*") || // Exponents
               text.matches(".*\\/[0-9].*"); // Fractions
    }

    private boolean hasMultiColumnLayout(String text, PDDocument document, int pageIndex) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        
        try {
            // Analyze text flow - multi-column layouts have text that doesn't flow naturally
            String[] lines = text.split("\n");
            int shortLines = 0;
            int longLines = 0;
            
            for (String line : lines) {
                int lineLength = line.trim().length();
                if (lineLength > 0 && lineLength < 30) {
                    shortLines++;
                } else if (lineLength > 60) {
                    longLines++;
                }
            }
            
            // If there are many short lines relative to long lines, might be multi-column
            if (lines.length > 10 && shortLines > longLines * 2) {
                return true;
            }
            
            // Check for repeated patterns that suggest columns
            PDPage page = document.getPage(pageIndex);
            PDRectangle mediaBox = page.getMediaBox();
            float pageWidth = mediaBox.getWidth();
            
            // If page is wide and has many short lines, likely multi-column
            if (pageWidth > 600 && shortLines > lines.length * 0.4) {
                return true;
            }
        } catch (Exception e) {
            logger.warn("Error checking multi-column layout", e);
        }
        
        return false;
    }

    private PdfDocument.PageQuality determinePageQuality(int scannedCount, int digitalCount) {
        if (scannedCount == 0) {
            return PdfDocument.PageQuality.DIGITAL_NATIVE;
        } else if (digitalCount == 0) {
            return PdfDocument.PageQuality.SCANNED;
        } else {
            return PdfDocument.PageQuality.MIXED;
        }
    }

    private String buildMetadata(String text, int totalPages) {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("totalPages", totalPages);
        metadata.put("totalCharacters", text != null ? text.length() : 0);
        metadata.put("estimatedWordCount", text != null ? text.split("\\s+").length : 0);
        
        return metadata.toString();
    }
}

