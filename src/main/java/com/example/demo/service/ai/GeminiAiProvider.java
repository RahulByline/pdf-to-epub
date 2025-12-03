package com.example.demo.service.ai;

import com.example.demo.service.GeminiTextCorrectionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Gemini AI provider implementation
 */
@Component
public class GeminiAiProvider implements AiProvider {
    
    private static final Logger logger = LoggerFactory.getLogger(GeminiAiProvider.class);
    
    @Autowired(required = false)
    private GeminiTextCorrectionService geminiService;
    
    @Autowired(required = false)
    private RateLimiterService rateLimiter;
    
    @Value("${ai.provider.gemini.enabled:true}")
    private boolean enabled;
    
    @Value("${ai.provider.gemini.priority:1}")
    private int priority;
    
    @Override
    public String getName() {
        return "Gemini";
    }
    
    @Override
    public boolean isEnabled() {
        return enabled && geminiService != null;
    }
    
    @Override
    public String extractTextFromImage(byte[] imageBytes, String imageFormat) {
        if (!isEnabled()) {
            return null;
        }
        
        // Check rate limit before making request
        if (rateLimiter != null && !rateLimiter.acquire("Gemini")) {
            logger.debug("Rate limit exceeded for Gemini, skipping request");
            return null; // Will trigger fallback to next provider
        }
        
        try {
            return geminiService.extractTextFromImage(imageBytes, imageFormat);
        } catch (Exception e) {
            logger.warn("Gemini provider error extracting text: {}", e.getMessage());
            return null;
        }
    }
    
    @Override
    public String correctOcrText(String text, String context) {
        if (!isEnabled()) {
            return text;
        }
        
        // Check rate limit before making request
        if (rateLimiter != null && !rateLimiter.acquire("Gemini")) {
            logger.debug("Rate limit exceeded for Gemini, skipping correction");
            return text; // Return original text, will use fallback if available
        }
        
        try {
            return geminiService.correctOcrText(text, context);
        } catch (Exception e) {
            logger.warn("Gemini provider error correcting text: {}", e.getMessage());
            return text;
        }
    }
    
    @Override
    public boolean testConnection() {
        if (!isEnabled()) {
            return false;
        }
        
        try {
            // Simple test - try to correct a short text
            String testText = "test";
            String result = geminiService.correctOcrText(testText, "test");
            return result != null;
        } catch (Exception e) {
            logger.debug("Gemini connection test failed: {}", e.getMessage());
            return false;
        }
    }
    
    @Override
    public int getPriority() {
        return priority;
    }
    
    @Override
    public boolean isAvailable() {
        if (!isEnabled()) {
            return false;
        }
        
        // Check rate limit (without consuming tokens)
        if (rateLimiter != null) {
            return rateLimiter.wouldAllow("Gemini");
        }
        
        return true;
    }
}

