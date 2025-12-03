package com.example.demo.service.ai;

/**
 * Interface for AI providers that support OCR text extraction and correction
 */
public interface AiProvider {
    
    /**
     * Get the name of this provider
     */
    String getName();
    
    /**
     * Check if this provider is enabled and available
     */
    boolean isEnabled();
    
    /**
     * Extract text from an image
     * 
     * @param imageBytes The image as byte array
     * @param imageFormat Image format (png, jpeg, etc.)
     * @return Extracted text, or null if extraction failed
     */
    String extractTextFromImage(byte[] imageBytes, String imageFormat);
    
    /**
     * Correct OCR errors in text
     * 
     * @param text The text with potential OCR errors
     * @param context Optional context about the text source
     * @return Corrected text, or original text if correction failed
     */
    String correctOcrText(String text, String context);
    
    /**
     * Test the provider connection
     * 
     * @return true if provider is working, false otherwise
     */
    boolean testConnection();
    
    /**
     * Get provider priority (lower number = higher priority)
     * Used for fallback ordering
     */
    int getPriority();
    
    /**
     * Check if provider has quota/rate limit available
     * 
     * @return true if provider can handle requests, false if quota exceeded
     */
    boolean isAvailable();
}

