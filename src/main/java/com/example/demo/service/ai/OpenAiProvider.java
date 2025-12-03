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
import java.util.HashMap;
import java.util.Map;

/**
 * OpenAI GPT-4 Vision provider implementation
 */
@Component
public class OpenAiProvider implements AiProvider {
    
    private static final Logger logger = LoggerFactory.getLogger(OpenAiProvider.class);
    
    @Value("${ai.provider.openai.enabled:false}")
    private boolean enabled;
    
    @Value("${ai.provider.openai.api.key:}")
    private String apiKey;
    
    @Value("${ai.provider.openai.model:gpt-4o}")
    private String model;
    
    @Value("${ai.provider.openai.priority:3}")
    private int priority;
    
    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    
    public OpenAiProvider() {
        this.webClient = WebClient.builder()
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer ")
            .build();
        this.objectMapper = new ObjectMapper();
    }
    
    @Override
    public String getName() {
        return "OpenAI GPT-4 Vision";
    }
    
    @Override
    public boolean isEnabled() {
        return enabled && apiKey != null && !apiKey.isEmpty();
    }
    
    @Override
    public String extractTextFromImage(byte[] imageBytes, String imageFormat) {
        if (!isEnabled()) {
            return null;
        }
        
        try {
            String base64Image = Base64.getEncoder().encodeToString(imageBytes);
            String mimeType = "image/" + (imageFormat != null ? imageFormat : "png");
            
            // Build OpenAI Vision API request
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);
            
            @SuppressWarnings("unchecked")
            Map<String, Object>[] messages = new Map[1];
            Map<String, Object> message = new HashMap<>();
            message.put("role", "user");
            
            @SuppressWarnings("unchecked")
            Map<String, Object>[] content = new Map[2];
            
            Map<String, Object> textContent = new HashMap<>();
            textContent.put("type", "text");
            textContent.put("text", "Extract all text from this image. Return only the text content, preserving line breaks and structure.");
            
            Map<String, Object> imageContent = new HashMap<>();
            imageContent.put("type", "image_url");
            Map<String, String> imageUrl = new HashMap<>();
            imageUrl.put("url", "data:" + mimeType + ";base64," + base64Image);
            imageContent.put("image_url", imageUrl);
            
            content[0] = textContent;
            content[1] = imageContent;
            message.put("content", content);
            messages[0] = message;
            requestBody.put("messages", messages);
            
            String requestJson = objectMapper.writeValueAsString(requestBody);
            
            String response = webClient.post()
                .uri("https://api.openai.com/v1/chat/completions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .bodyValue(requestJson)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(60))
                .block();
            
            return parseOpenAiResponse(response);
            
        } catch (Exception e) {
            logger.warn("OpenAI provider error extracting text: {}", e.getMessage());
            return null;
        }
    }
    
    @Override
    public String correctOcrText(String text, String context) {
        if (!isEnabled()) {
            return text;
        }
        
        try {
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);
            
            @SuppressWarnings("unchecked")
            Map<String, Object>[] messages = new Map[1];
            Map<String, Object> message = new HashMap<>();
            message.put("role", "user");
            
            String prompt = buildCorrectionPrompt(text, context);
            message.put("content", prompt);
            messages[0] = message;
            requestBody.put("messages", messages);
            
            String requestJson = objectMapper.writeValueAsString(requestBody);
            
            String response = webClient.post()
                .uri("https://api.openai.com/v1/chat/completions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .bodyValue(requestJson)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(30))
                .block();
            
            return parseOpenAiTextResponse(response, text);
            
        } catch (Exception e) {
            logger.warn("OpenAI provider error correcting text: {}", e.getMessage());
            return text;
        }
    }
    
    @Override
    public boolean testConnection() {
        if (!isEnabled()) {
            return false;
        }
        
        try {
            // Simple test with a text prompt
            String result = correctOcrText("test", "test");
            return result != null;
        } catch (Exception e) {
            logger.debug("OpenAI connection test failed: {}", e.getMessage());
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
    
    private String parseOpenAiResponse(String response) {
        if (response == null || response.isEmpty()) {
            return null;
        }
        
        try {
            JsonNode root = objectMapper.readTree(response);
            
            if (root.has("choices") && root.get("choices").isArray() && root.get("choices").size() > 0) {
                JsonNode firstChoice = root.get("choices").get(0);
                if (firstChoice.has("message") && firstChoice.get("message").has("content")) {
                    return firstChoice.get("message").get("content").asText().trim();
                }
            }
        } catch (Exception e) {
            logger.warn("Error parsing OpenAI response: {}", e.getMessage());
        }
        
        return null;
    }
    
    private String parseOpenAiTextResponse(String response, String fallback) {
        String result = parseOpenAiResponse(response);
        return result != null && !result.isEmpty() ? result : fallback;
    }
    
    private String buildCorrectionPrompt(String text, String context) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("You are an expert at correcting OCR (Optical Character Recognition) errors in text extracted from PDF documents.\n\n");
        
        if (context != null && !context.isEmpty()) {
            prompt.append("Context: This text is from a ").append(context).append(".\n\n");
        }
        
        prompt.append("Original OCR text (may contain errors): ").append(text).append("\n\n");
        prompt.append("Please correct any OCR errors in the text above. Common errors include:\n");
        prompt.append("- Numbers mixed with letters (e.g., 'tin4' should be 'Time' or similar)\n");
        prompt.append("- Missing or incorrect first letters (e.g., 'ristopher' should be 'Christopher')\n");
        prompt.append("- Incorrect character recognition\n");
        prompt.append("- Missing spaces or punctuation\n\n");
        prompt.append("Return ONLY the corrected text, nothing else. If the text appears correct, return it as-is.");
        
        return prompt.toString();
    }
}

