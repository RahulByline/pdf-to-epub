package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.DocumentStructure;
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

import java.util.ArrayList;
import java.util.List;

/**
 * Free Tier Friendly: Audio-friendly text transformation
 * Uses Gemini 2.5 Flash - 1 call per page OR batch per chapter
 * Optimizes text for TTS/audio reading
 */
@Service
public class AudioFriendlyTransformationService {
    
    private static final Logger logger = LoggerFactory.getLogger(AudioFriendlyTransformationService.class);
    
    @Value("${gemini.api.key:}")
    private String apiKey;
    
    @Value("${gemini.api.enabled:true}")
    private boolean enabled;
    
    @Value("${gemini.api.model:gemini-2.5-flash}")
    private String model;
    
    @Value("${gemini.api.url:https://generativelanguage.googleapis.com/v1beta/models}")
    private String apiUrl;
    
    @Value("${ai.free-tier.audio-transformation.enabled:true}")
    private boolean transformationEnabled;
    
    @Value("${ai.free-tier.audio-transformation.batch-mode:true}")
    private boolean batchMode; // true = batch per chapter, false = 1 call per page
    
    @Autowired(required = false)
    private RateLimiterService rateLimiter;
    
    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    
    public AudioFriendlyTransformationService() {
        this.webClient = WebClient.builder()
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .build();
        this.objectMapper = new ObjectMapper();
    }
    
    /**
     * Transform text for audio-friendly reading
     * Free tier friendly: batches multiple pages to reduce API calls
     */
    public DocumentStructure transformForAudio(DocumentStructure structure) {
        if (!enabled || !transformationEnabled || apiKey == null || apiKey.isEmpty()) {
            logger.debug("Audio transformation disabled, skipping");
            return structure;
        }
        
        try {
            if (batchMode) {
                // Batch mode: process by chapter (more efficient)
                return transformByChapter(structure);
            } else {
                // Page mode: 1 call per page
                return transformByPage(structure);
            }
        } catch (Exception e) {
            logger.warn("Error in audio transformation: {}", e.getMessage());
            return structure;
        }
    }
    
    /**
     * Transform by chapter (batch mode - fewer API calls)
     */
    private DocumentStructure transformByChapter(DocumentStructure structure) {
        // Group pages by chapter (simplified - assumes chapters are separated)
        List<List<PageStructure>> chapters = groupPagesByChapter(structure);
        
        int apiCalls = 0;
        for (List<PageStructure> chapter : chapters) {
            try {
                String chapterText = extractChapterText(chapter);
                String transformedText = callGeminiForAudioTransformation(chapterText);
                
                if (transformedText != null) {
                    applyTransformationToChapter(chapter, transformedText);
                    apiCalls++;
                    logger.debug("✅ Transformed chapter with {} pages (1 API call)", chapter.size());
                }
            } catch (Exception e) {
                logger.warn("Error transforming chapter: {}", e.getMessage());
            }
        }
        
        logger.info("Audio transformation completed: {} API calls for {} chapters", 
                   apiCalls, chapters.size());
        return structure;
    }
    
    /**
     * Transform by page (1 call per page)
     */
    private DocumentStructure transformByPage(DocumentStructure structure) {
        int apiCalls = 0;
        for (PageStructure page : structure.getPages()) {
            try {
                String pageText = extractPageText(page);
                String transformedText = callGeminiForAudioTransformation(pageText);
                
                if (transformedText != null) {
                    applyTransformationToPage(page, transformedText);
                    apiCalls++;
                }
            } catch (Exception e) {
                logger.warn("Error transforming page {}: {}", page.getPageNumber(), e.getMessage());
            }
        }
        
        logger.info("Audio transformation completed: {} API calls for {} pages", 
                   apiCalls, structure.getPages().size());
        return structure;
    }
    
    /**
     * Call Gemini for audio-friendly transformation
     */
    private String callGeminiForAudioTransformation(String text) {
        // Check rate limit before making request
        if (rateLimiter != null && !rateLimiter.acquire("Gemini")) {
            logger.debug("Rate limit exceeded for audio transformation, skipping");
            return null; // Will use original text
        }
        
        try {
            String prompt = buildAudioTransformationPrompt(text);
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
            logger.warn("Error calling Gemini for audio transformation: {}", e.getMessage());
            return null;
        }
    }
    
    /**
     * Build prompt for audio-friendly transformation
     */
    private String buildAudioTransformationPrompt(String text) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("You are a text-to-speech optimization engine.\n\n");
        prompt.append("Transform the following text to be more audio-friendly for TTS:\n");
        prompt.append("- Expand abbreviations (e.g., 'Dr.' -> 'Doctor', 'U.S.A.' -> 'U S A')\n");
        prompt.append("- Spell out numbers in a natural way when appropriate\n");
        prompt.append("- Add pauses for readability (use commas strategically)\n");
        prompt.append("- Handle special characters appropriately\n");
        prompt.append("- Preserve meaning and context\n");
        prompt.append("- Keep the text readable and natural\n\n");
        prompt.append("Return ONLY the transformed text, nothing else.\n\n");
        prompt.append("TEXT:\n");
        prompt.append(text);
        
        return prompt.toString();
    }
    
    /**
     * Group pages by chapter (simplified implementation)
     */
    private List<List<PageStructure>> groupPagesByChapter(DocumentStructure structure) {
        List<List<PageStructure>> chapters = new ArrayList<>();
        List<PageStructure> currentChapter = new ArrayList<>();
        
        for (PageStructure page : structure.getPages()) {
            // Simple heuristic: if page has h1 or h2, start new chapter
            boolean isChapterStart = false;
            for (TextBlock block : page.getTextBlocks()) {
                // Check if block is a heading (h1 or h2)
                if (block.getType() == TextBlock.BlockType.HEADING) {
                    Integer level = block.getLevel();
                    if (level != null && (level == 1 || level == 2)) {
                        isChapterStart = true;
                        break;
                    }
                }
            }
            
            if (isChapterStart && !currentChapter.isEmpty()) {
                chapters.add(new ArrayList<>(currentChapter));
                currentChapter.clear();
            }
            
            currentChapter.add(page);
        }
        
        if (!currentChapter.isEmpty()) {
            chapters.add(currentChapter);
        }
        
        return chapters;
    }
    
    /**
     * Extract text from chapter
     */
    private String extractChapterText(List<PageStructure> chapter) {
        StringBuilder text = new StringBuilder();
        for (PageStructure page : chapter) {
            for (TextBlock block : page.getTextBlocks()) {
                text.append(block.getText()).append(" ");
            }
        }
        return text.toString().trim();
    }
    
    /**
     * Extract text from page
     */
    private String extractPageText(PageStructure page) {
        StringBuilder text = new StringBuilder();
        for (TextBlock block : page.getTextBlocks()) {
            text.append(block.getText()).append(" ");
        }
        return text.toString().trim();
    }
    
    /**
     * Apply transformation to chapter
     */
    private void applyTransformationToChapter(List<PageStructure> chapter, String transformedText) {
        // Simple implementation: split transformed text back to pages
        // In production, you'd want more sophisticated mapping
        String[] sentences = transformedText.split("\\. ");
        int sentenceIndex = 0;
        
        for (PageStructure page : chapter) {
            for (TextBlock block : page.getTextBlocks()) {
                if (sentenceIndex < sentences.length) {
                    block.setText(sentences[sentenceIndex++]);
                }
            }
        }
    }
    
    /**
     * Apply transformation to page
     */
    private void applyTransformationToPage(PageStructure page, String transformedText) {
        // Simple implementation: split by sentences
        String[] sentences = transformedText.split("\\. ");
        int blockIndex = 0;
        
        for (TextBlock block : page.getTextBlocks()) {
            if (blockIndex < sentences.length) {
                block.setText(sentences[blockIndex++]);
            }
        }
    }
    
    /**
     * Parse Gemini response
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

