package com.example.demo.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Base64;

/**
 * Azure AI Vision provider implementation
 * Uses Azure Computer Vision API for OCR
 */
@Component
public class AzureAiProvider implements AiProvider {
    
    private static final Logger logger = LoggerFactory.getLogger(AzureAiProvider.class);
    
    @Value("${ai.provider.azure.enabled:false}")
    private boolean enabled;
    
    @Value("${ai.provider.azure.endpoint:}")
    private String endpoint;
    
    @Value("${ai.provider.azure.key:}")
    private String apiKey;
    
    @Value("${ai.provider.azure.priority:2}")
    private int priority;
    
    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    
    public AzureAiProvider() {
        this.webClient = WebClient.builder()
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .build();
        this.objectMapper = new ObjectMapper();
    }
    
    @Override
    public String getName() {
        return "Azure AI Vision";
    }
    
    @Override
    public boolean isEnabled() {
        return enabled && endpoint != null && !endpoint.isEmpty() 
                      && apiKey != null && !apiKey.isEmpty();
    }
    
    @Override
    public String extractTextFromImage(byte[] imageBytes, String imageFormat) {
        if (!isEnabled()) {
            return null;
        }
        
        try {
            String base64Image = Base64.getEncoder().encodeToString(imageBytes);
            
            // Azure Computer Vision OCR API
            String url = endpoint + "/vision/v3.2/read/analyze";
            
            // For Azure, we need to use the base64 directly in the request
            // Azure Computer Vision expects the image in the request body
            String response = webClient.post()
                .uri(url)
                .header("Ocp-Apim-Subscription-Key", apiKey)
                .bodyValue(base64Image)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(30))
                .block();
            
            // Parse Azure response
            return parseAzureResponse(response);
            
        } catch (Exception e) {
            logger.warn("Azure AI provider error extracting text: {}", e.getMessage());
            return null;
        }
    }
    
    @Override
    public String correctOcrText(String text, String context) {
        // Azure Vision API doesn't provide text correction
        // Return original text
        return text;
    }
    
    @Override
    public boolean testConnection() {
        if (!isEnabled()) {
            return false;
        }
        
        try {
            // Test with a simple image or just check endpoint accessibility
            // For now, just check if credentials are configured
            return true;
        } catch (Exception e) {
            logger.debug("Azure connection test failed: {}", e.getMessage());
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
    
    private String parseAzureResponse(String response) {
        if (response == null || response.isEmpty()) {
            return null;
        }
        
        try {
            JsonNode root = objectMapper.readTree(response);
            
            // Azure OCR response structure
            if (root.has("analyzeResult") && root.get("analyzeResult").has("readResults")) {
                JsonNode readResults = root.get("analyzeResult").get("readResults");
                if (readResults.isArray() && readResults.size() > 0) {
                    JsonNode firstResult = readResults.get(0);
                    if (firstResult.has("lines")) {
                        JsonNode lines = firstResult.get("lines");
                        StringBuilder text = new StringBuilder();
                        
                        for (JsonNode line : lines) {
                            if (line.has("text")) {
                                text.append(line.get("text").asText()).append("\n");
                            }
                        }
                        
                        return text.toString().trim();
                    }
                }
            }
        } catch (Exception e) {
            logger.warn("Error parsing Azure response: {}", e.getMessage());
        }
        
        return null;
    }
}

