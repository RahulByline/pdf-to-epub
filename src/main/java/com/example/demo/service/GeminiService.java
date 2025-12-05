package com.example.demo.service;

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

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Service wrapper for Google Gemini AI operations using REST API
 * Provides clean interface for text generation, image analysis, and structured outputs
 */
@Service
public class GeminiService {

    private static final Logger logger = LoggerFactory.getLogger(GeminiService.class);

    @Value("${gemini.api.key:}")
    private String apiKey;

    @Value("${gemini.api.enabled:true}")
    private boolean enabled;

    @Value("${gemini.api.model:gemini-2.5-flash}")
    private String modelName;

    @Value("${gemini.api.url:https://generativelanguage.googleapis.com/v1beta/models}")
    private String apiUrl;
    
    @Autowired(required = false)
    private RateLimiterService rateLimiter;

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    public GeminiService() {
        this.webClient = WebClient.builder()
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .build();
        this.objectMapper = new ObjectMapper();
    }

    /**
     * Generates text response from a prompt
     * 
     * @param prompt The text prompt
     * @return Generated text response, or null if disabled/error
     */
    public String generate(String prompt) {
        if (!enabled || apiKey == null || apiKey.isEmpty()) {
            logger.debug("Gemini API not enabled or API key not configured, skipping generation");
            return null;
        }

        if (prompt == null || prompt.trim().isEmpty()) {
            logger.warn("Empty prompt provided to Gemini");
            return null;
        }

        // Check rate limit before making request
        if (rateLimiter != null && !rateLimiter.acquire("Gemini")) {
            logger.debug("Rate limit exceeded for Gemini, skipping generation");
            return null;
        }

        try {
            logger.debug("🤖 Gemini: Generating response for prompt (length: {})", prompt.length());

            String url = String.format("%s/%s:generateContent?key=%s", apiUrl, modelName, apiKey);
            String requestBody = buildRequestJson(prompt);

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
                .timeout(java.time.Duration.ofSeconds(60))
                .onErrorResume(java.util.concurrent.TimeoutException.class, e -> {
                    logger.warn("⚠️ Gemini API request timed out after 60 seconds, returning null");
                    return Mono.just("");
                })
                .block();

            String generatedText = parseGeminiResponse(response);
            logger.debug("✅ Gemini: Generated {} characters", generatedText != null ? generatedText.length() : 0);
            return generatedText;

        } catch (Exception e) {
            logger.error("❌ Error generating content with Gemini: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * Generates text response from an image and prompt (Vision API)
     * 
     * @param imageFile The image file to analyze
     * @param prompt The text prompt describing what to do with the image
     * @return Generated text response, or null if disabled/error
     */
    public String generateWithImage(File imageFile, String prompt) {
        if (!enabled || apiKey == null || apiKey.isEmpty()) {
            logger.debug("Gemini API not enabled or API key not configured, skipping image generation");
            return null;
        }

        if (imageFile == null || !imageFile.exists()) {
            logger.warn("Image file not found: {}", imageFile);
            return null;
        }

        if (prompt == null || prompt.trim().isEmpty()) {
            logger.warn("Empty prompt provided to Gemini Vision");
            return null;
        }

        // Check rate limit before making request
        if (rateLimiter != null && !rateLimiter.acquire("Gemini")) {
            logger.debug("Rate limit exceeded for Gemini Vision, skipping image analysis");
            return null;
        }

        try {
            logger.debug("🤖 Gemini Vision: Analyzing image {} with prompt (length: {})", 
                        imageFile.getName(), prompt.length());

            // Read image file and encode to base64
            byte[] imageBytes = Files.readAllBytes(imageFile.toPath());
            String base64Image = Base64.getEncoder().encodeToString(imageBytes);

            // Determine MIME type from file extension
            String mimeType = determineMimeType(imageFile.getName());

            String url = String.format("%s/%s:generateContent?key=%s", apiUrl, modelName, apiKey);
            String requestBody = buildVisionRequestJson(prompt, base64Image, mimeType);

            String response = webClient.post()
                .uri(url)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(java.time.Duration.ofSeconds(60))
                .onErrorResume(java.util.concurrent.TimeoutException.class, e -> {
                    logger.warn("⚠️ Gemini Vision API request timed out after 60 seconds");
                    return Mono.just("");
                })
                .block();

            String generatedText = parseGeminiResponse(response);
            logger.debug("✅ Gemini Vision: Generated {} characters", generatedText != null ? generatedText.length() : 0);
            return generatedText;

        } catch (IOException e) {
            logger.error("❌ Error reading image file: {}", e.getMessage(), e);
            return null;
        } catch (Exception e) {
            logger.error("❌ Error generating content with Gemini Vision: {}", e.getMessage(), e);
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
            if (candidates.isArray() && candidates.size() > 0) {
                JsonNode firstCandidate = candidates.get(0);
                JsonNode content = firstCandidate.path("content");
                if (content.isMissingNode()) {
                    content = firstCandidate;
                }

                JsonNode parts = content.path("parts");
                if (parts.isArray() && parts.size() > 0) {
                    JsonNode firstPart = parts.get(0);
                    JsonNode text = firstPart.path("text");
                    if (text.isTextual()) {
                        return text.asText().trim();
                    }
                }
            }

            logger.warn("⚠️ Unexpected response format. Full response: {}", 
                      response.length() > 1000 ? response.substring(0, 1000) + "..." : response);
            return null;

        } catch (Exception e) {
            logger.error("❌ Error parsing Gemini API response: {}", e.getMessage(), e);
            return null;
        }
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

    /**
     * Determines MIME type from file extension
     */
    private String determineMimeType(String fileName) {
        String lowerName = fileName.toLowerCase();
        if (lowerName.endsWith(".png")) {
            return "image/png";
        } else if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
            return "image/jpeg";
        } else if (lowerName.endsWith(".gif")) {
            return "image/gif";
        } else if (lowerName.endsWith(".webp")) {
            return "image/webp";
        } else {
            return "image/png"; // Default
        }
    }

    /**
     * Checks if Gemini service is enabled and available
     */
    public boolean isEnabled() {
        return enabled && apiKey != null && !apiKey.isEmpty();
    }

    /**
     * Determines HTML structure tag for a text block (p, h1, h2, li, etc.)
     * 
     * @param text The text content
     * @param context Optional context (e.g., "PDF page 5")
     * @return HTML tag name (e.g., "p", "h1", "li")
     */
    public String determineStructureTag(String text, String context) {
        if (!isEnabled() || text == null || text.trim().isEmpty()) {
            return "p"; // Default to paragraph
        }

        try {
            String prompt = String.format("""
                You are an HTML structure analyzer for EPUB conversion.
                
                Analyze the following text and determine the most appropriate HTML tag.
                Return ONLY the tag name (e.g., "p", "h1", "h2", "h3", "li", "table", "caption").
                
                Rules:
                - Use "h1" for main titles
                - Use "h2" for major section headings
                - Use "h3" for subsection headings
                - Use "p" for regular paragraphs
                - Use "li" for list items
                - Use "caption" for image captions
                - Use "table" for table structures
                
                Return ONLY the tag name, nothing else.
                
                TEXT:
                %s
                """, text);

            String tag = generate(prompt);
            if (tag != null) {
                tag = tag.trim().toLowerCase();
                // Validate it's a valid tag
                if (tag.matches("^(p|h[1-6]|li|ul|ol|table|caption|div|span)$")) {
                    return tag;
                }
            }
        } catch (Exception e) {
            logger.warn("Error determining structure tag with Gemini: {}", e.getMessage());
        }

        return "p"; // Fallback to paragraph
    }

    /**
     * Generates WCAG-compliant alt text for an image
     * 
     * @param imageFile The image file
     * @param context Optional context (e.g., "Figure 3.1 in Chapter 3")
     * @return Alt text description, or null if error
     */
    public String generateAltText(File imageFile, String context) {
        if (!isEnabled() || imageFile == null || !imageFile.exists()) {
            return null;
        }

        try {
            String prompt = """
                You are an accessibility expert generating alt text for EPUB images.
                
                Analyze this image and generate a factual, concise (1-2 sentences) WCAG-compliant alt text description.
                Return ONLY a JSON object with this exact format:
                {
                  "alt": "A factual 1–2 sentence WCAG-compliant description."
                }
                
                Rules:
                - Be factual and descriptive
                - Avoid phrases like "image of" or "picture showing"
                - Focus on content and meaning
                - Keep it concise (1-2 sentences)
                - Return ONLY valid JSON, no other text
                """;

            if (context != null && !context.isEmpty()) {
                prompt += "\nContext: " + context;
            }

            String jsonResponse = generateWithImage(imageFile, prompt);
            if (jsonResponse == null || jsonResponse.trim().isEmpty()) {
                return null;
            }

            // Parse JSON response
            JsonNode root = objectMapper.readTree(jsonResponse);
            String altText = root.path("alt").asText();
            
            return altText != null && !altText.isEmpty() ? altText : null;

        } catch (Exception e) {
            logger.error("Error generating alt text with Gemini: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * Generates SMIL entry for audio synchronization
     * 
     * @param textId The text element ID (e.g., "page_15.xhtml#s1")
     * @param audioFile The audio file name
     * @param startTime Start time in seconds
     * @param endTime End time in seconds
     * @return SMIL XML string, or null if error
     */
    public String generateSmilEntry(String textId, String audioFile, double startTime, double endTime) {
        if (!isEnabled()) {
            // Fallback to manual generation
            return String.format(
                "<par>\n  <text src=\"%s\"/>\n  <audio src=\"%s\" clipBegin=\"%.3f\" clipEnd=\"%.3f\"/>\n</par>",
                textId, audioFile, startTime, endTime
            );
        }

        try {
            String prompt = String.format("""
                You are an EPUB 3 SMIL (Synchronized Multimedia Integration Language) generator.
                
                Generate a SMIL <par> entry that synchronizes text with audio.
                
                Parameters:
                - Text ID: %s
                - Audio file: %s
                - Start time: %.3f seconds
                - End time: %.3f seconds
                
                Return ONLY the SMIL XML in this exact format:
                <par>
                  <text src="[textId]"/>
                  <audio src="[audioFile]" clipBegin="[startTime formatted as HH:MM:SS.mmm]" clipEnd="[endTime formatted as HH:MM:SS.mmm]"/>
                </par>
                
                Format times as HH:MM:SS.mmm (e.g., 00:00:05.100 for 5.1 seconds).
                Return ONLY the XML, no other text.
                """, textId, audioFile, startTime, endTime);

            String smilXml = generate(prompt);
            if (smilXml != null) {
                smilXml = smilXml.trim();
                // Validate it contains the expected structure
                if (smilXml.contains("<par>") && smilXml.contains("<text") && smilXml.contains("<audio")) {
                    return smilXml;
                }
            }
        } catch (Exception e) {
            logger.warn("Error generating SMIL with Gemini, using fallback: {}", e.getMessage());
        }

        // Fallback to manual generation
        return String.format(
            "<par>\n  <text src=\"%s\"/>\n  <audio src=\"%s\" clipBegin=\"%.3f\" clipEnd=\"%.3f\"/>\n</par>",
            textId, audioFile, startTime, endTime
        );
    }

    /**
     * Generates a spoken-friendly version of text for TTS
     * 
     * @param text The original text
     * @return Spoken-friendly version optimized for TTS
     */
    public String generateSpokenFriendlyText(String text) {
        if (!isEnabled() || text == null || text.trim().isEmpty()) {
            return text;
        }

        try {
            String prompt = String.format("""
                You are a text-to-speech optimization engine for EPUB audio sync.
                
                Convert the following text into a spoken-friendly version optimized for TTS:
                - Expand abbreviations (e.g., "Dr." -> "Doctor", "U.S.A." -> "U S A")
                - Spell out numbers in a natural way
                - Add pauses for readability
                - Handle special characters appropriately
                - Preserve meaning and context
                
                Return ONLY the spoken-friendly text, nothing else.
                
                TEXT:
                %s
                """, text);

            String spokenText = generate(prompt);
            return spokenText != null && !spokenText.isEmpty() ? spokenText.trim() : text;

        } catch (Exception e) {
            logger.warn("Error generating spoken-friendly text with Gemini: {}", e.getMessage());
            return text;
        }
    }

    /**
     * Corrects and segments text in a single AI call
     * Returns structured JSON with corrected text and segmentation (words, sentences, phrases)
     * 
     * @param text The original text extracted from PDF
     * @param pageNumber Page number for context
     * @return Structured result with corrected text and segmentation, or null if error
     */
    public CorrectedAndSegmentedText correctAndSegmentText(String text, int pageNumber) {
        if (!isEnabled() || text == null || text.trim().isEmpty()) {
            return null;
        }

        try {
            String prompt = String.format("""
                You are a text-processing engine for EPUB conversion with audio synchronization.
                
                Process the following text extracted from PDF page %d:
                
                1. CORRECT the text:
                   - Remove OCR artifacts (e.g., "tin4" -> "Time", "ristopher" -> "Christopher")
                   - Fix missing or incorrect first letters
                   - Normalize spacing and punctuation
                   - Preserve proper names, titles, and technical terms
                
                2. SEGMENT the corrected text:
                   - Split into sentences (handle abbreviations like "Dr.", "U.S.A." correctly)
                   - Split each sentence into phrases (comma-separated, semicolon-separated, etc.)
                   - Split each phrase into individual words
                
                Return ONLY a JSON object with this exact format:
                {
                  "correctedText": "The fully corrected and normalized text.",
                  "sentences": [
                    "First sentence.",
                    "Second sentence."
                  ],
                  "phrases": [
                    "First phrase",
                    "second phrase",
                    "third phrase"
                  ],
                  "words": [
                    "The",
                    "fully",
                    "corrected",
                    "text"
                  ]
                }
                
                Rules:
                - Preserve all punctuation and capitalization in corrected text
                - Sentences should be complete with ending punctuation
                - Phrases should be meaningful chunks (comma/semicolon separated)
                - Words should be individual tokens (alphanumeric, handle contractions)
                - Return ONLY valid JSON, no other text
                
                TEXT TO PROCESS:
                %s
                """, pageNumber, text);

            String jsonResponse = generate(prompt);
            if (jsonResponse == null || jsonResponse.trim().isEmpty()) {
                logger.debug("Gemini returned empty response for text correction and segmentation");
                return null;
            }

            // Parse JSON response
            JsonNode root = objectMapper.readTree(jsonResponse);
            
            CorrectedAndSegmentedText result = new CorrectedAndSegmentedText();
            result.correctedText = root.path("correctedText").asText();
            
            // Parse sentences
            JsonNode sentencesNode = root.path("sentences");
            if (sentencesNode.isArray()) {
                for (JsonNode sentenceNode : sentencesNode) {
                    String sentence = sentenceNode.isTextual() ? sentenceNode.asText() : sentenceNode.toString();
                    if (sentence != null && !sentence.trim().isEmpty()) {
                        result.sentences.add(sentence.trim());
                    }
                }
            }
            
            // Parse phrases
            JsonNode phrasesNode = root.path("phrases");
            if (phrasesNode.isArray()) {
                for (JsonNode phraseNode : phrasesNode) {
                    String phrase = phraseNode.isTextual() ? phraseNode.asText() : phraseNode.toString();
                    if (phrase != null && !phrase.trim().isEmpty()) {
                        result.phrases.add(phrase.trim());
                    }
                }
            }
            
            // Parse words
            JsonNode wordsNode = root.path("words");
            if (wordsNode.isArray()) {
                for (JsonNode wordNode : wordsNode) {
                    String word = wordNode.isTextual() ? wordNode.asText() : wordNode.toString();
                    if (word != null && !word.trim().isEmpty()) {
                        result.words.add(word.trim());
                    }
                }
            }

            // Validate we got at least corrected text
            if (result.correctedText == null || result.correctedText.trim().isEmpty()) {
                logger.warn("Gemini did not return correctedText in response");
                return null;
            }

            logger.debug("✅ Gemini corrected and segmented text: {} chars, {} sentences, {} phrases, {} words", 
                        result.correctedText.length(), result.sentences.size(), 
                        result.phrases.size(), result.words.size());
            
            return result;

        } catch (Exception e) {
            logger.warn("Error using Gemini for text correction and segmentation, falling back to separate processing: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Result class for corrected and segmented text
     */
    public static class CorrectedAndSegmentedText {
        public String correctedText;
        public List<String> sentences = new ArrayList<>();
        public List<String> phrases = new ArrayList<>();
        public List<String> words = new ArrayList<>();
        
        public int getWordCount() {
            return words.size();
        }
        
        public int getSentenceCount() {
            return sentences.size();
        }
        
        public int getPhraseCount() {
            return phrases.size();
        }
    }
}
