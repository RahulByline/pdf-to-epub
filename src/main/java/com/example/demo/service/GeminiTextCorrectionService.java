package com.example.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import jakarta.annotation.PostConstruct;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * Service for using Google Gemini API to correct OCR artifacts and improve text extraction
 */
@Service
public class GeminiTextCorrectionService {

    private static final Logger logger = LoggerFactory.getLogger(GeminiTextCorrectionService.class);
    
    @Value("${gemini.api.key:}")
    private String apiKey;
    
    @Value("${gemini.api.enabled:true}")
    private boolean enabled;
    
    @Value("${gemini.api.model:gemini-2.5-flash}")
    private String model;
    
    @Value("${gemini.api.url:https://generativelanguage.googleapis.com/v1beta/models}")
    private String apiUrl;
    
    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    
    public GeminiTextCorrectionService() {
        this.webClient = WebClient.builder()
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .build();
        this.objectMapper = new ObjectMapper();
    }
    
    /**
     * Initialize and test Gemini API connection on startup
     */
    @PostConstruct
    public void initialize() {
        if (enabled && apiKey != null && !apiKey.isEmpty()) {
            logger.info("🔧 Gemini AI Service initialized");
            logger.info("   - Model: {}", model);
            logger.info("   - API URL: {}", apiUrl);
            logger.info("   - API Key: {}...{}", 
                       apiKey.substring(0, Math.min(10, apiKey.length())),
                       apiKey.substring(Math.max(0, apiKey.length() - 4)));
            
            // First, try to list available models to see what's actually supported
            try {
                Map<String, Object> modelsResult = listAvailableModels();
                if ("SUCCESS".equals(modelsResult.get("status"))) {
                    @SuppressWarnings("unchecked")
                    List<String> availableModels = (List<String>) modelsResult.get("models");
                    if (availableModels != null && !availableModels.isEmpty()) {
                        logger.info("📋 Available Gemini models: {}", availableModels);
                        // Check if our configured model is in the list
                        if (!availableModels.contains(model)) {
                            logger.warn("⚠️ Configured model '{}' not in available models list. Using first available: {}", 
                                      model, availableModels.get(0));
                            // Optionally auto-switch to first available model
                            // model = availableModels.get(0);
                        }
                    }
                }
            } catch (Exception e) {
                logger.debug("Could not list models on startup: {}", e.getMessage());
            }
            
            // Test connection (non-blocking, just log)
            try {
                Map<String, Object> testResult = testConnection();
                String status = (String) testResult.get("status");
                if ("WORKING".equals(status)) {
                    logger.info("✅ Gemini API connection test: SUCCESS");
                } else {
                    logger.warn("⚠️ Gemini API connection test: {} - {}", 
                              status, testResult.get("message"));
                }
            } catch (Exception e) {
                logger.warn("⚠️ Could not test Gemini API on startup: {}", e.getMessage());
            }
        } else {
            logger.info("ℹ️ Gemini AI Service is disabled or not configured");
        }
    }
    
    /**
     * Corrects OCR artifacts in extracted text using Gemini AI
     * Example: "tin4 ristopher Blazeman" -> "Christopher Blazeman"
     */
    public String correctOcrText(String extractedText, String context) {
        if (!enabled || apiKey == null || apiKey.isEmpty()) {
            logger.debug("Gemini API not enabled or API key not configured, skipping correction");
            return extractedText;
        }
        
        if (extractedText == null || extractedText.trim().isEmpty()) {
            return extractedText;
        }
        
        logger.info("🤖 Gemini AI: Correcting OCR text '{}' with context: {}", extractedText, context);
        
        try {
            String prompt = buildCorrectionPrompt(extractedText, context);
            String corrected = callGeminiApi(prompt);
            
            if (corrected != null && !corrected.isEmpty()) {
                logger.info("✅ Gemini AI: Corrected text '{}' -> '{}'", extractedText, corrected);
                return corrected;
            } else {
                logger.warn("⚠️ Gemini AI: No correction returned, using original text");
            }
        } catch (Exception e) {
            logger.error("❌ Gemini AI: Error correcting text: {}", e.getMessage(), e);
        }
        
        return extractedText; // Return original on error
    }
    
    /**
     * Lists available Gemini models for this API key
     */
    public Map<String, Object> listAvailableModels() {
        Map<String, Object> result = new java.util.HashMap<>();
        
        if (!enabled || apiKey == null || apiKey.isEmpty()) {
            result.put("error", "Gemini API is disabled or API key not configured");
            return result;
        }
        
        try {
            // Use v1 API to list models
            String listUrl = String.format("https://generativelanguage.googleapis.com/v1beta/models?key=%s", apiKey);
            
            logger.info("🔍 Listing available Gemini models...");
            String response = webClient.get()
                .uri(listUrl)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(30))
                .block();
            
            if (response != null) {
                try {
                    JsonNode root = objectMapper.readTree(response);
                    JsonNode models = root.path("models");
                    
                    List<String> modelNames = new ArrayList<>();
                    if (models.isArray()) {
                        for (JsonNode model : models) {
                            String name = model.path("name").asText("");
                            if (!name.isEmpty()) {
                                // Extract just the model name (remove "models/" prefix)
                                String modelName = name.replace("models/", "");
                                modelNames.add(modelName);
                            }
                        }
                    }
                    
                    result.put("status", "SUCCESS");
                    result.put("models", modelNames);
                    result.put("count", modelNames.size());
                    logger.info("✅ Found {} available models", modelNames.size());
                    
                } catch (Exception e) {
                    result.put("status", "PARSE_ERROR");
                    result.put("error", "Could not parse model list: " + e.getMessage());
                    result.put("rawResponse", response.length() > 500 ? response.substring(0, 500) + "..." : response);
                }
            } else {
                result.put("status", "NO_RESPONSE");
                result.put("error", "No response from API");
            }
            
        } catch (Exception e) {
            result.put("status", "ERROR");
            result.put("error", "Error listing models: " + e.getMessage());
            logger.error("❌ Error listing Gemini models: {}", e.getMessage(), e);
        }
        
        return result;
    }
    
    /**
     * Tests the Gemini API connection and returns status
     */
    public Map<String, Object> testConnection() {
        Map<String, Object> result = new java.util.HashMap<>();
        
        result.put("enabled", enabled);
        result.put("apiKeyConfigured", apiKey != null && !apiKey.isEmpty());
        result.put("model", model);
        
        if (!enabled) {
            result.put("status", "DISABLED");
            result.put("message", "Gemini API is disabled in configuration");
            return result;
        }
        
        if (apiKey == null || apiKey.isEmpty()) {
            result.put("status", "NO_API_KEY");
            result.put("message", "API key is not configured");
            return result;
        }
        
        // Test with a simple prompt
        try {
            logger.info("🧪 Testing Gemini API connection...");
            String testPrompt = "Say 'Hello, Gemini API is working!' in exactly those words.";
            String response = callGeminiApi(testPrompt);
            
            if (response != null && !response.isEmpty()) {
                result.put("status", "WORKING");
                result.put("message", "Gemini API is responding correctly");
                result.put("testResponse", response);
                logger.info("✅ Gemini API test successful: {}", response);
            } else {
                result.put("status", "NO_RESPONSE");
                result.put("message", "API call succeeded but no response received");
                logger.warn("⚠️ Gemini API test: No response received");
            }
        } catch (Exception e) {
            result.put("status", "ERROR");
            result.put("message", "Error connecting to Gemini API: " + e.getMessage());
            result.put("error", e.getClass().getSimpleName());
            logger.error("❌ Gemini API test failed: {}", e.getMessage(), e);
        }
        
        return result;
    }
    
    /**
     * Extracts and corrects text from a list of text blocks
     */
    public List<String> correctTextBlocks(List<String> textBlocks, String pageContext) {
        if (!enabled || apiKey == null || apiKey.isEmpty() || textBlocks == null || textBlocks.isEmpty()) {
            return textBlocks;
        }
        
        List<String> corrected = new ArrayList<>();
        
        // Process in batches to avoid rate limits
        int batchSize = 5;
        for (int i = 0; i < textBlocks.size(); i += batchSize) {
            int end = Math.min(i + batchSize, textBlocks.size());
            List<String> batch = textBlocks.subList(i, end);
            
            try {
                String batchPrompt = buildBatchCorrectionPrompt(batch, pageContext);
                String response = callGeminiApi(batchPrompt);
                
                if (response != null) {
                    // Parse JSON response with corrected texts
                    List<String> batchCorrected = parseBatchResponse(response, batch.size());
                    corrected.addAll(batchCorrected);
                } else {
                    corrected.addAll(batch); // Use original if correction fails
                }
            } catch (Exception e) {
                logger.warn("Error correcting batch {}: {}", i / batchSize, e.getMessage());
                corrected.addAll(batch); // Use original on error
            }
        }
        
        return corrected;
    }
    
    /**
     * Extracts text from an image using Gemini Vision API
     */
    public String extractTextFromImage(byte[] imageBytes, String imageFormat) {
        if (!enabled || apiKey == null || apiKey.isEmpty()) {
            return null;
        }
        
        try {
            String base64Image = Base64.getEncoder().encodeToString(imageBytes);
            String mimeType = "image/" + (imageFormat != null ? imageFormat : "png");
            
            String prompt = "Extract all text from this image. Return only the text content, preserving line breaks and structure. If you see book titles, author names, or publisher logos, extract them accurately.";
            
            String extractedText = callGeminiVisionApi(prompt, base64Image, mimeType);
            
            if (extractedText != null && !extractedText.isEmpty()) {
                logger.debug("Extracted {} characters of text from image", extractedText.length());
                return extractedText;
            }
        } catch (Exception e) {
            logger.warn("Error extracting text from image with Gemini: {}", e.getMessage());
        }
        
        return null;
    }
    
    /**
     * Builds a prompt for correcting OCR text
     */
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
    
    /**
     * Builds a prompt for batch correction
     */
    private String buildBatchCorrectionPrompt(List<String> texts, String context) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("You are an expert at correcting OCR errors in text extracted from PDF documents.\n\n");
        
        if (context != null && !context.isEmpty()) {
            prompt.append("Context: These texts are from a ").append(context).append(".\n\n");
        }
        
        prompt.append("Below are multiple OCR-extracted text blocks that may contain errors:\n\n");
        for (int i = 0; i < texts.size(); i++) {
            prompt.append(i + 1).append(". ").append(texts.get(i)).append("\n");
        }
        
        prompt.append("\nPlease correct any OCR errors in each text block.\n");
        prompt.append("Return a JSON array with the corrected texts in the same order, like this:\n");
        prompt.append("[\"corrected text 1\", \"corrected text 2\", ...]\n");
        prompt.append("If a text appears correct, include it unchanged in the array.");
        
        return prompt.toString();
    }
    
    /**
     * Calls Gemini API for text generation
     */
    private String callGeminiApi(String prompt) {
        try {
            String url = String.format("%s/%s:generateContent?key=%s", apiUrl, model, apiKey);
            
            // Build request body
            String requestBody = buildRequestJson(prompt);
            
            logger.debug("📡 Calling Gemini API: {} (prompt length: {})", url, prompt.length());
            logger.debug("📤 Request body: {}", requestBody.length() > 200 ? requestBody.substring(0, 200) + "..." : requestBody);
            
            String response = webClient.post()
                .uri(url)
                .bodyValue(requestBody)
                .retrieve()
                .onStatus(status -> status.isError(), clientResponse -> {
                    logger.error("❌ Gemini API returned HTTP error: {}", clientResponse.statusCode());
                    return clientResponse.bodyToMono(String.class)
                        .doOnNext(errorBody -> logger.error("❌ Error response body: {}", errorBody))
                        .then(Mono.error(new RuntimeException("Gemini API error: " + clientResponse.statusCode())));
                })
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(30))
                .block();
            
            logger.debug("📥 Received response from Gemini API (length: {})", 
                        response != null ? response.length() : 0);
            
            // Log full response for debugging (first 500 chars)
            if (response != null) {
                logger.debug("📄 Response preview: {}", 
                           response.length() > 500 ? response.substring(0, 500) + "..." : response);
            }
            
            return parseGeminiResponse(response);
            
        } catch (Exception e) {
            logger.error("❌ Error calling Gemini API: {}", e.getMessage(), e);
            return null;
        }
    }
    
    /**
     * Calls Gemini Vision API for image text extraction
     */
    private String callGeminiVisionApi(String prompt, String base64Image, String mimeType) {
        try {
            String url = String.format("%s/%s:generateContent?key=%s", apiUrl, model, apiKey);
            
            // Build request body with image
            String requestBody = buildVisionRequestJson(prompt, base64Image, mimeType);
            
            String response = webClient.post()
                .uri(url)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(60))
                .block();
            
            return parseGeminiResponse(response);
            
        } catch (Exception e) {
            logger.error("Error calling Gemini Vision API: {}", e.getMessage(), e);
            return null;
        }
    }
    
    /**
     * Builds JSON request body for text generation
     */
    private String buildRequestJson(String prompt) {
        try {
            return String.format(
                "{\"contents\":[{\"parts\":[{\"text\":\"%s\"}]}]}",
                escapeJson(prompt)
            );
        } catch (Exception e) {
            logger.error("Error building request JSON: {}", e.getMessage());
            return "{\"contents\":[{\"parts\":[{\"text\":\"" + escapeJson(prompt) + "\"}]}]}";
        }
    }
    
    /**
     * Builds JSON request body for vision API
     */
    private String buildVisionRequestJson(String prompt, String base64Image, String mimeType) {
        try {
            return String.format(
                "{\"contents\":[{\"parts\":[{\"text\":\"%s\"},{\"inline_data\":{\"mime_type\":\"%s\",\"data\":\"%s\"}}]}]}",
                escapeJson(prompt), mimeType, base64Image
            );
        } catch (Exception e) {
            logger.error("Error building vision request JSON: {}", e.getMessage());
            return String.format(
                "{\"contents\":[{\"parts\":[{\"text\":\"%s\"},{\"inline_data\":{\"mime_type\":\"%s\",\"data\":\"%s\"}}]}]}",
                escapeJson(prompt), mimeType, base64Image
            );
        }
    }
    
    /**
     * Parses Gemini API response to extract text
     */
    private String parseGeminiResponse(String response) {
        if (response == null || response.isEmpty()) {
            logger.warn("⚠️ Gemini API response is null or empty");
            return null;
        }
        
        try {
            logger.debug("🔍 Parsing Gemini API response...");
            JsonNode root = objectMapper.readTree(response);
            
            // Check for errors first
            if (root.has("error")) {
                JsonNode error = root.path("error");
                String errorMessage = error.path("message").asText("Unknown error");
                logger.error("❌ Gemini API returned an error: {}", errorMessage);
                return null;
            }
            
            // Try to extract text from candidates
            JsonNode candidates = root.path("candidates");
            logger.debug("📋 Found {} candidates", candidates.isArray() ? candidates.size() : 0);
            
            if (candidates.isArray() && candidates.size() > 0) {
                JsonNode firstCandidate = candidates.get(0);
                List<String> candidateKeys = new ArrayList<>();
                firstCandidate.fieldNames().forEachRemaining(candidateKeys::add);
                logger.debug("📝 First candidate keys: {}", candidateKeys);
                
                JsonNode content = firstCandidate.path("content");
                if (content.isMissingNode()) {
                    // Try alternative path
                    content = firstCandidate;
                }
                
                JsonNode parts = content.path("parts");
                logger.debug("📦 Found {} parts", parts.isArray() ? parts.size() : 0);
                
                if (parts.isArray() && parts.size() > 0) {
                    JsonNode firstPart = parts.get(0);
                    List<String> partKeys = new ArrayList<>();
                    firstPart.fieldNames().forEachRemaining(partKeys::add);
                    logger.debug("📄 First part keys: {}", partKeys);
                    
                    JsonNode text = firstPart.path("text");
                    if (text.isTextual()) {
                        String extractedText = text.asText().trim();
                        logger.debug("✅ Successfully extracted text: {} characters", extractedText.length());
                        return extractedText;
                    } else {
                        logger.warn("⚠️ Text field is not textual: {}", text.getNodeType());
                    }
                } else {
                    logger.warn("⚠️ No parts found in content");
                }
            } else {
                logger.warn("⚠️ No candidates found in response");
            }
            
            // Log the full response structure for debugging
            logger.warn("⚠️ Unexpected response format. Full response: {}", 
                      response.length() > 1000 ? response.substring(0, 1000) + "..." : response);
            return null;
            
        } catch (Exception e) {
            logger.error("❌ Error parsing Gemini API response: {}", e.getMessage(), e);
            logger.error("❌ Response that failed to parse: {}", 
                        response.length() > 500 ? response.substring(0, 500) + "..." : response);
            return null;
        }
    }
    
    /**
     * Parses batch correction response
     */
    private List<String> parseBatchResponse(String response, int expectedCount) {
        List<String> corrected = new ArrayList<>();
        
        try {
            // Try to parse as JSON array
            JsonNode array = objectMapper.readTree(response);
            if (array.isArray()) {
                for (JsonNode item : array) {
                    corrected.add(item.asText());
                }
            } else {
                // If not JSON, try to extract from text response
                String text = parseGeminiResponse(response);
                if (text != null) {
                    // Try to split by newlines or numbers
                    String[] lines = text.split("\n");
                    for (String line : lines) {
                        line = line.replaceAll("^\\d+\\.\\s*", "").trim(); // Remove numbering
                        if (!line.isEmpty()) {
                            corrected.add(line);
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.warn("Error parsing batch response, using original response as single result");
            String text = parseGeminiResponse(response);
            if (text != null) {
                corrected.add(text);
            }
        }
        
        // Ensure we have the right number of results
        while (corrected.size() < expectedCount) {
            corrected.add(""); // Add empty strings for missing corrections
        }
        
        return corrected.subList(0, Math.min(corrected.size(), expectedCount));
    }
    
    /**
     * Escapes JSON string
     */
    private String escapeJson(String text) {
        if (text == null) {
            return "";
        }
        return text.replace("\\", "\\\\")
                   .replace("\"", "\\\"")
                   .replace("\n", "\\n")
                   .replace("\r", "\\r")
                   .replace("\t", "\\t");
    }
}

