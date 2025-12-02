package com.example.demo.service;

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

    // Sentence ending patterns
    private static final Pattern SENTENCE_END = Pattern.compile("[.!?]+\\s*");
    
    // Phrase patterns (commas, semicolons, colons, dashes)
    private static final Pattern PHRASE_DELIMITER = Pattern.compile("[,;:—–-]+\\s*");
    
    // Word pattern (alphanumeric and common punctuation)
    private static final Pattern WORD_PATTERN = Pattern.compile("\\b\\w+\\b");

    /**
     * Segments text into words, sentences, and phrases
     */
    public TextSegmentation segmentText(String text, String blockId) {
        if (text == null || text.trim().isEmpty()) {
            return new TextSegmentation(blockId, text);
        }

        TextSegmentation segmentation = new TextSegmentation(blockId, text);
        
        // Segment into sentences
        List<String> sentences = segmentSentences(text);
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

