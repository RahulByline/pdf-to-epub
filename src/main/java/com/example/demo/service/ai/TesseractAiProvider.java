package com.example.demo.service.ai;

import net.sourceforge.tess4j.Tesseract;
import net.sourceforge.tess4j.TesseractException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import javax.imageio.ImageIO;

/**
 * Tesseract OCR provider implementation (fallback/local option)
 */
@Component
public class TesseractAiProvider implements AiProvider {
    
    private static final Logger logger = LoggerFactory.getLogger(TesseractAiProvider.class);
    
    @Value("${ai.provider.tesseract.enabled:true}")
    private boolean enabled;
    
    @Value("${ai.provider.tesseract.priority:99}")
    private int priority;
    
    @Value("${tesseract.datapath:}")
    private String tesseractDataPath;
    
    private Tesseract tesseract;
    
    private synchronized Tesseract getTesseractInstance() {
        if (tesseract == null) {
            tesseract = new Tesseract();
            
            if (tesseractDataPath != null && !tesseractDataPath.isEmpty()) {
                tesseract.setDatapath(tesseractDataPath);
            }
            
            tesseract.setLanguage("eng");
        }
        
        return tesseract;
    }
    
    @Override
    public String getName() {
        return "Tesseract OCR";
    }
    
    @Override
    public boolean isEnabled() {
        return enabled;
    }
    
    @Override
    public String extractTextFromImage(byte[] imageBytes, String imageFormat) {
        if (!isEnabled()) {
            return null;
        }
        
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (image == null) {
                logger.warn("Tesseract: Could not read image from bytes");
                return null;
            }
            
            Tesseract tess = getTesseractInstance();
            String text = tess.doOCR(image);
            
            if (text != null && !text.trim().isEmpty()) {
                logger.debug("Tesseract extracted {} characters", text.length());
                return text.trim();
            }
            
        } catch (TesseractException e) {
            logger.warn("Tesseract OCR error: {}", e.getMessage());
        } catch (Exception e) {
            logger.warn("Tesseract provider error: {}", e.getMessage());
        }
        
        return null;
    }
    
    @Override
    public String correctOcrText(String text, String context) {
        // Tesseract doesn't provide text correction
        // Return original text
        return text;
    }
    
    @Override
    public boolean testConnection() {
        if (!isEnabled()) {
            return false;
        }
        
        try {
            Tesseract tess = getTesseractInstance();
            // Just check if we can create an instance
            return tess != null;
        } catch (Exception e) {
            logger.debug("Tesseract connection test failed: {}", e.getMessage());
            return false;
        }
    }
    
    @Override
    public int getPriority() {
        return priority;
    }
    
    @Override
    public boolean isAvailable() {
        return isEnabled();
    }
}

