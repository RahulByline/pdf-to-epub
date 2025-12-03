package com.example.demo.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import jakarta.annotation.PostConstruct;

/**
 * Spring configuration for Google Gemini AI integration
 * Note: Using REST API approach via GeminiService (no client library dependency needed)
 */
@Configuration
public class GeminiConfiguration {

    private static final Logger logger = LoggerFactory.getLogger(GeminiConfiguration.class);

    @Value("${gemini.api.key:}")
    private String apiKey;

    @Value("${gemini.api.enabled:true}")
    private boolean enabled;

    @Value("${gemini.api.model:gemini-2.5-flash}")
    private String modelName;

    @PostConstruct
    public void initialize() {
        if (enabled && apiKey != null && !apiKey.isEmpty()) {
            logger.info("✅ Gemini AI Service configured (REST API)");
            logger.info("   - Model: {}", modelName);
            logger.info("   - API Key: {}...{}", 
                       apiKey.substring(0, Math.min(10, apiKey.length())),
                       apiKey.substring(Math.max(0, apiKey.length() - 4)));
        } else {
            logger.info("ℹ️ Gemini AI Service is disabled or not configured");
        }
    }
}

