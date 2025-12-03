package com.example.demo.service.ai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Multi-provider AI service with automatic fallback
 * Tries providers in priority order until one succeeds
 */
@Service
public class MultiProviderAiService {
    
    private static final Logger logger = LoggerFactory.getLogger(MultiProviderAiService.class);
    
    @Autowired(required = false)
    private List<AiProvider> providers;
    
    @Value("${ai.provider.fallback.enabled:true}")
    private boolean fallbackEnabled;
    
    @Value("${ai.provider.fallback.log.enabled:true}")
    private boolean logFallback;
    
    private List<AiProvider> sortedProviders;
    private final AtomicInteger requestCounter = new AtomicInteger(0);
    private final AtomicInteger fallbackCounter = new AtomicInteger(0);
    
    @PostConstruct
    public void initialize() {
        if (providers == null || providers.isEmpty()) {
            logger.warn("⚠️ No AI providers found. OCR and text correction will be limited.");
            sortedProviders = new ArrayList<>();
            return;
        }
        
        // Sort providers by priority (lower number = higher priority)
        sortedProviders = new ArrayList<>(providers);
        sortedProviders.sort(Comparator.comparingInt(AiProvider::getPriority));
        
        logger.info("🤖 Multi-Provider AI Service initialized with {} providers:", sortedProviders.size());
        for (AiProvider provider : sortedProviders) {
            String status = provider.isEnabled() ? "✅" : "❌";
            logger.info("   {} {} (priority: {})", status, provider.getName(), provider.getPriority());
        }
        
        // Test connections
        testAllProviders();
    }
    
    /**
     * Extract text from image using available providers with fallback
     */
    public String extractTextFromImage(byte[] imageBytes, String imageFormat) {
        if (sortedProviders == null || sortedProviders.isEmpty()) {
            logger.debug("No AI providers available for text extraction");
            return null;
        }
        
        requestCounter.incrementAndGet();
        
        for (AiProvider provider : sortedProviders) {
            if (!provider.isEnabled() || !provider.isAvailable()) {
                continue;
            }
            
            try {
                if (logFallback && provider.getPriority() > sortedProviders.get(0).getPriority()) {
                    logger.debug("Trying fallback provider: {}", provider.getName());
                }
                
                String text = provider.extractTextFromImage(imageBytes, imageFormat);
                
                if (text != null && !text.trim().isEmpty()) {
                    if (logFallback && provider.getPriority() > sortedProviders.get(0).getPriority()) {
                        logger.info("✅ Fallback provider {} succeeded", provider.getName());
                        fallbackCounter.incrementAndGet();
                    }
                    return text;
                }
                
            } catch (Exception e) {
                logger.debug("Provider {} failed: {}", provider.getName(), e.getMessage());
                // Continue to next provider
            }
        }
        
        logger.warn("⚠️ All AI providers failed to extract text from image");
        return null;
    }
    
    /**
     * Correct OCR text using available providers with fallback
     */
    public String correctOcrText(String text, String context) {
        if (sortedProviders == null || sortedProviders.isEmpty()) {
            logger.debug("No AI providers available for text correction");
            return text; // Return original if no providers
        }
        
        if (text == null || text.trim().isEmpty()) {
            return text;
        }
        
        for (AiProvider provider : sortedProviders) {
            if (!provider.isEnabled() || !provider.isAvailable()) {
                continue;
            }
            
            try {
                // Skip providers that don't support text correction (like Tesseract)
                if (provider instanceof TesseractAiProvider) {
                    continue;
                }
                
                if (logFallback && provider.getPriority() > sortedProviders.get(0).getPriority()) {
                    logger.debug("Trying fallback provider for correction: {}", provider.getName());
                }
                
                String corrected = provider.correctOcrText(text, context);
                
                if (corrected != null && !corrected.equals(text)) {
                    if (logFallback && provider.getPriority() > sortedProviders.get(0).getPriority()) {
                        logger.info("✅ Fallback provider {} corrected text", provider.getName());
                        fallbackCounter.incrementAndGet();
                    }
                    return corrected;
                }
                
                // If correction returned same text, try next provider
                
            } catch (Exception e) {
                logger.debug("Provider {} failed to correct text: {}", provider.getName(), e.getMessage());
                // Continue to next provider
            }
        }
        
        // If all providers failed or returned same text, return original
        return text;
    }
    
    /**
     * Test all providers and log their status
     */
    private void testAllProviders() {
        logger.info("🔍 Testing AI provider connections...");
        
        for (AiProvider provider : sortedProviders) {
            if (!provider.isEnabled()) {
                continue;
            }
            
            try {
                boolean working = provider.testConnection();
                String status = working ? "✅ WORKING" : "❌ FAILED";
                logger.info("   {} - {}", status, provider.getName());
            } catch (Exception e) {
                logger.warn("   ❌ ERROR - {}: {}", provider.getName(), e.getMessage());
            }
        }
    }
    
    /**
     * Get statistics about provider usage
     */
    public String getStatistics() {
        if (sortedProviders == null || sortedProviders.isEmpty()) {
            return "No providers configured";
        }
        
        StringBuilder stats = new StringBuilder();
        stats.append("Total requests: ").append(requestCounter.get()).append("\n");
        stats.append("Fallback usage: ").append(fallbackCounter.get()).append("\n");
        stats.append("Providers:\n");
        
        for (AiProvider provider : sortedProviders) {
            stats.append("  - ").append(provider.getName())
                 .append(": ").append(provider.isEnabled() ? "enabled" : "disabled")
                 .append(" (priority: ").append(provider.getPriority()).append(")\n");
        }
        
        return stats.toString();
    }
    
    /**
     * Check if any provider is available
     */
    public boolean hasAvailableProvider() {
        if (sortedProviders == null || sortedProviders.isEmpty()) {
            return false;
        }
        
        return sortedProviders.stream()
            .anyMatch(p -> p.isEnabled() && p.isAvailable());
    }
}

