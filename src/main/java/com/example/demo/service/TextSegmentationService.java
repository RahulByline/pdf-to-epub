package com.example.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Service to segment text into words, sentences, and phrases
 * for granular audio synchronization (KITABOO-style)
 */
@Service
public class TextSegmentationService {

    private static final Logger logger = LoggerFactory.getLogger(TextSegmentationService.class);

    @Autowired(required = false)
    private GeminiService geminiService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // Sentence ending patterns
    private static final Pattern SENTENCE_END = Pattern.compile("[.!?]+\\s*");
    
    // Phrase patterns (commas, semicolons, colons, dashes)
    private static final Pattern PHRASE_DELIMITER = Pattern.compile("[,;:—–-]+\\s*");
    
    // Word pattern (alphanumeric and common punctuation)
    private static final Pattern WORD_PATTERN = Pattern.compile("\\b\\w+\\b");

    @Autowired(required = false)
    private com.example.demo.service.OpenNlpSentenceSegmentationService openNlpService;
    
    /**
     * Segments text into words, sentences, and phrases
     * Free Tier Friendly: Uses OpenNLP (local) instead of AI
     */
    public TextSegmentation segmentText(String text, String blockId) {
        if (text == null || text.trim().isEmpty()) {
            return new TextSegmentation(blockId, text);
        }

        TextSegmentation segmentation = new TextSegmentation(blockId, text);
        
        // Use OpenNLP for sentence segmentation (local, no AI calls)
        List<String> sentences;
        if (openNlpService != null && openNlpService.isInitialized()) {
            sentences = openNlpService.segmentSentences(text);
        } else {
            // Fallback to regex-based segmentation
            sentences = segmentSentences(text);
        }
        
        segmentation.sentences = sentences;
        
        // Segment each sentence into phrases
        for (int i = 0; i < sentences.size(); i++) {
            String sentence = sentences.get(i);
            List<String> phrases = segmentPhrases(sentence);
            segmentation.phrases.addAll(phrases);
            
            // Segment each phrase into words
            for (String phrase : phrases) {
                List<String> words = segmentWords(phrase);
                segmentation.words.addAll(words);
            }
        }
        
        return segmentation;
    }

    /**
     * Uses Gemini AI to segment text into sentences with structured JSON output
     */
    private List<String> segmentSentencesWithGemini(String text) {
        if (geminiService == null || !geminiService.isEnabled()) {
            return null;
        }

        try {
            String prompt = """
                You are a text segmentation engine for EPUB audio synchronization.
                
                Split the following text into sentences and return a JSON array with this exact format:
                {
                  "sentences": [
                    {"id": "s1", "text": "First sentence."},
                    {"id": "s2", "text": "Second sentence."}
                  ]
                }
                
                Rules:
                - Preserve all punctuation and capitalization
                - Handle abbreviations correctly (e.g., "Dr.", "U.S.A.")
                - Handle quotes and nested punctuation
                - Return ONLY valid JSON, no other text
                
                TEXT:
                """ + text;

            String jsonResponse = geminiService.generate(prompt);
            if (jsonResponse == null || jsonResponse.trim().isEmpty()) {
                logger.debug("Gemini returned empty response for sentence segmentation");
                return null;
            }

            // Parse JSON response
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode sentencesNode = root.path("sentences");
            
            if (!sentencesNode.isArray()) {
                logger.warn("Gemini response does not contain sentences array");
                return null;
            }

            List<String> sentences = new ArrayList<>();
            for (JsonNode sentenceNode : sentencesNode) {
                String sentenceText = sentenceNode.path("text").asText();
                if (sentenceText != null && !sentenceText.trim().isEmpty()) {
                    sentences.add(sentenceText.trim());
                }
            }

            logger.debug("Gemini segmented text into {} sentences", sentences.size());
            return sentences.isEmpty() ? null : sentences;

        } catch (Exception e) {
            logger.warn("Error using Gemini for sentence segmentation, falling back to regex: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Segments text into sentences
     */
    private List<String> segmentSentences(String text) {
        List<String> sentences = new ArrayList<>();
        
        // Split by sentence endings
        String[] parts = SENTENCE_END.split(text);
        int lastIndex = 0;
        
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i].trim();
            if (part.isEmpty()) continue;
            
            // Find the sentence ending
            int endIndex = text.indexOf(part, lastIndex);
            if (endIndex >= 0) {
                endIndex += part.length();
                // Find the actual sentence ending punctuation
                while (endIndex < text.length() && 
                       (text.charAt(endIndex) == '.' || 
                        text.charAt(endIndex) == '!' || 
                        text.charAt(endIndex) == '?')) {
                    endIndex++;
                }
                String sentence = text.substring(lastIndex, endIndex).trim();
                if (!sentence.isEmpty()) {
                    sentences.add(sentence);
                }
                lastIndex = endIndex;
            }
        }
        
        // Add remaining text if any
        if (lastIndex < text.length()) {
            String remaining = text.substring(lastIndex).trim();
            if (!remaining.isEmpty()) {
                sentences.add(remaining);
            }
        }
        
        return sentences;
    }

    /**
     * Segments text into phrases (comma-separated, etc.)
     */
    private List<String> segmentPhrases(String text) {
        List<String> phrases = new ArrayList<>();
        
        // Split by phrase delimiters
        String[] parts = PHRASE_DELIMITER.split(text);
        int lastIndex = 0;
        
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i].trim();
            if (part.isEmpty()) continue;
            
            // Find the phrase delimiter
            int endIndex = text.indexOf(part, lastIndex);
            if (endIndex >= 0) {
                endIndex += part.length();
                // Find the actual delimiter
                while (endIndex < text.length() && 
                       (text.charAt(endIndex) == ',' || 
                        text.charAt(endIndex) == ';' || 
                        text.charAt(endIndex) == ':' ||
                        text.charAt(endIndex) == '—' ||
                        text.charAt(endIndex) == '–' ||
                        text.charAt(endIndex) == '-')) {
                    endIndex++;
                }
                String phrase = text.substring(lastIndex, endIndex).trim();
                if (!phrase.isEmpty()) {
                    phrases.add(phrase);
                }
                lastIndex = endIndex;
            }
        }
        
        // Add remaining text if any
        if (lastIndex < text.length()) {
            String remaining = text.substring(lastIndex).trim();
            if (!remaining.isEmpty()) {
                phrases.add(remaining);
            }
        }
        
        // If no phrases found, return the whole text as one phrase
        if (phrases.isEmpty()) {
            phrases.add(text.trim());
        }
        
        return phrases;
    }

    /**
     * Segments text into words
     */
    private List<String> segmentWords(String text) {
        List<String> words = new ArrayList<>();
        
        java.util.regex.Matcher matcher = WORD_PATTERN.matcher(text);
        while (matcher.find()) {
            String word = matcher.group();
            if (!word.isEmpty()) {
                words.add(word);
            }
        }
        
        return words;
    }

    /**
     * Text segmentation result
     */
    public static class TextSegmentation {
        public String blockId;
        public String fullText;
        public List<String> sentences = new ArrayList<>();
        public List<String> phrases = new ArrayList<>();
        public List<String> words = new ArrayList<>();
        
        public TextSegmentation(String blockId, String fullText) {
            this.blockId = blockId;
            this.fullText = fullText;
        }
        
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

