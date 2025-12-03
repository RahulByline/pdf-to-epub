package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.PageStructure;
import com.example.demo.dto.conversion.TextBlock;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import com.example.demo.service.ai.RateLimiterService;

/**
 * Free Tier Friendly Service: Merged cleanup + structure tagging
 * Uses Gemini 2.5 Flash - 1 call per page
 * Combines text cleanup and HTML structure tagging in a single API call
 */
@Service
public class FreeTierCleanupAndTaggingService {
    
    private static final Logger logger = LoggerFactory.getLogger(FreeTierCleanupAndTaggingService.class);
    
    
    @Value("${gemini.api.key:}")
    private String apiKey;
    
    @Value("${gemini.api.enabled:true}")
    private boolean enabled;
    
    @Value("${gemini.api.model:gemini-2.5-flash}")
    private String model;
    
    @Value("${gemini.api.url:https://generativelanguage.googleapis.com/v1beta/models}")
    private String apiUrl;
    
    @Value("${ai.free-tier.cleanup.enabled:true}")
    private boolean cleanupEnabled;
    
    @Autowired(required = false)
    private RateLimiterService rateLimiter;
    
    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    
    public FreeTierCleanupAndTaggingService() {
        this.webClient = WebClient.builder()
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .build();
        this.objectMapper = new ObjectMapper();
    }
    
    /**
     * Process a page: cleanup text + determine HTML structure tags in one call
     * Free tier friendly: 1 API call per page
     */
    public PageStructure processPage(PageStructure page) {
        if (!enabled || !cleanupEnabled || apiKey == null || apiKey.isEmpty()) {
            logger.debug("Gemini cleanup/tagging disabled, skipping AI processing");
            return page;
        }
        
        if (page.getTextBlocks().isEmpty()) {
            return page;
        }
        
        try {
            // Check rate limit before making request
            if (rateLimiter != null && !rateLimiter.acquire("Gemini")) {
                logger.debug("Rate limit exceeded for cleanup/tagging, skipping page {}", page.getPageNumber());
                return page; // Return page unchanged if rate limited
            }
            
            // Build combined prompt for cleanup + tagging
            String prompt = buildCombinedPrompt(page);
            
            // Call Gemini 2.5 Flash
            String response = callGeminiApi(prompt);
            
            if (response != null && !response.isEmpty()) {
                // Parse response and update page
                parseAndApplyResponse(page, response);
                logger.debug("✅ Processed page {} with cleanup + tagging (1 API call)", page.getPageNumber());
            } else {
                logger.warn("⚠️ No response from Gemini for page {}", page.getPageNumber());
            }
            
        } catch (Exception e) {
            logger.warn("⚠️ Error processing page {} with Gemini: {}", page.getPageNumber(), e.getMessage());
        }
        
        return page;
    }
    
    /**
     * Build combined prompt for cleanup + structure tagging
     */
    private String buildCombinedPrompt(PageStructure page) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("You are an EPUB3 conversion expert. Process the following text blocks from a PDF page.\n\n");
        prompt.append("For EACH text block, do TWO things:\n");
        prompt.append("1. CLEANUP: Fix OCR errors, normalize punctuation, fix spacing\n");
        prompt.append("2. TAGGING: Determine the HTML structure tag (p, h1, h2, h3, h4, h5, h6, li, caption, etc.)\n\n");
        prompt.append("Return a JSON array with this exact format:\n");
        prompt.append("[\n");
        prompt.append("  {\"id\": \"block_0\", \"cleaned_text\": \"cleaned text here\", \"html_tag\": \"h1\"},\n");
        prompt.append("  {\"id\": \"block_1\", \"cleaned_text\": \"cleaned text here\", \"html_tag\": \"p\"}\n");
        prompt.append("]\n\n");
        prompt.append("Rules:\n");
        prompt.append("- Use h1-h6 for headings (h1 for main titles, h2 for major sections, etc.)\n");
        prompt.append("- Use 'p' for paragraphs\n");
        prompt.append("- Use 'li' for list items\n");
        prompt.append("- Use 'caption' for image captions\n");
        prompt.append("- Preserve original meaning, only fix errors\n");
        prompt.append("- Return ONLY valid JSON, no other text\n\n");
        prompt.append("Text blocks from page:\n");
        
        for (int i = 0; i < page.getTextBlocks().size(); i++) {
            TextBlock block = page.getTextBlocks().get(i);
            prompt.append(String.format("block_%d: %s\n", i, block.getText()));
        }
        
        return prompt.toString();
    }
    
    /**
     * Call Gemini API
     */
    private String callGeminiApi(String prompt) {
        try {
            String url = String.format("%s/%s:generateContent?key=%s", apiUrl, model, apiKey);
            
            String requestBody = String.format(
                "{\"contents\":[{\"parts\":[{\"text\":\"%s\"}]}]}",
                escapeJson(prompt)
            );
            
            String response = webClient.post()
                .uri(url)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(60))
                .onErrorResume(java.util.concurrent.TimeoutException.class, e -> {
                    logger.warn("⚠️ Gemini API request timed out after 60 seconds");
                    return Mono.just("");
                })
                .block();
            
            return parseGeminiResponse(response);
            
        } catch (Exception e) {
            logger.warn("Error calling Gemini API: {}", e.getMessage());
            return null;
        }
    }
    
    /**
     * Parse Gemini response and apply to page
     */
    private void parseAndApplyResponse(PageStructure page, String response) {
        try {
            JsonNode root = objectMapper.readTree(response);
            
            // Extract text from candidates
            JsonNode candidates = root.path("candidates");
            if (candidates.isArray() && candidates.size() > 0) {
                JsonNode firstCandidate = candidates.get(0);
                JsonNode content = firstCandidate.path("content");
                JsonNode parts = content.path("parts");
                
                if (parts.isArray() && parts.size() > 0) {
                    String responseText = parts.get(0).path("text").asText();
                    
                    // Parse JSON array from response
                    JsonNode blocksArray = objectMapper.readTree(responseText);
                    
                    if (blocksArray.isArray()) {
                        for (int i = 0; i < blocksArray.size() && i < page.getTextBlocks().size(); i++) {
                            JsonNode blockData = blocksArray.get(i);
                            TextBlock block = page.getTextBlocks().get(i);
                            
                            // Update cleaned text
                            String cleanedText = blockData.path("cleaned_text").asText();
                            if (cleanedText != null && !cleanedText.isEmpty()) {
                                block.setText(cleanedText);
                            }
                            
                            // Update block type based on HTML tag
                            String htmlTag = blockData.path("html_tag").asText("p");
                            updateBlockTypeFromTag(block, htmlTag);
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.warn("Error parsing Gemini response: {}", e.getMessage());
        }
    }
    
    /**
     * Parse Gemini API response to extract text
     */
    private String parseGeminiResponse(String response) {
        if (response == null || response.isEmpty()) {
            return null;
        }
        
        try {
            JsonNode root = objectMapper.readTree(response);
            
            if (root.has("candidates") && root.get("candidates").isArray() && root.get("candidates").size() > 0) {
                JsonNode firstCandidate = root.get("candidates").get(0);
                JsonNode content = firstCandidate.path("content");
                JsonNode parts = content.path("parts");
                
                if (parts.isArray() && parts.size() > 0) {
                    return parts.get(0).path("text").asText();
                }
            }
        } catch (Exception e) {
            logger.warn("Error parsing Gemini response: {}", e.getMessage());
        }
        
        return null;
    }
    
    /**
     * Update block type from HTML tag
     */
    private void updateBlockTypeFromTag(TextBlock block, String htmlTag) {
        if (htmlTag == null) {
            return;
        }
        
        switch (htmlTag.toLowerCase()) {
            case "h1":
                block.setType(TextBlock.BlockType.HEADING);
                block.setLevel(1);
                break;
            case "h2":
                block.setType(TextBlock.BlockType.HEADING);
                block.setLevel(2);
                break;
            case "h3":
                block.setType(TextBlock.BlockType.HEADING);
                block.setLevel(3);
                break;
            case "h4":
                block.setType(TextBlock.BlockType.HEADING);
                block.setLevel(4);
                break;
            case "h5":
                block.setType(TextBlock.BlockType.HEADING);
                block.setLevel(5);
                break;
            case "h6":
                block.setType(TextBlock.BlockType.HEADING);
                block.setLevel(6);
                break;
            case "li":
                block.setType(TextBlock.BlockType.LIST_ITEM);
                break;
            case "caption":
                block.setType(TextBlock.BlockType.CAPTION);
                break;
            default:
                block.setType(TextBlock.BlockType.PARAGRAPH);
                break;
        }
    }
    
    /**
     * Escape JSON string
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

