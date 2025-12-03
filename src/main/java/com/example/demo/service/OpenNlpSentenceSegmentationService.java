package com.example.demo.service;

import opennlp.tools.sentdetect.SentenceDetectorME;
import opennlp.tools.sentdetect.SentenceModel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Free Tier Friendly: Local sentence segmentation using OpenNLP
 * No AI calls - runs completely locally
 */
@Service
public class OpenNlpSentenceSegmentationService {
    
    private static final Logger logger = LoggerFactory.getLogger(OpenNlpSentenceSegmentationService.class);
    
    private SentenceDetectorME sentenceDetector;
    private boolean initialized = false;
    
    @PostConstruct
    public void initialize() {
        try {
            // Load English sentence detection model
            // The model is included in the OpenNLP library
            InputStream modelStream = getClass().getResourceAsStream("/opennlp/en-sent.bin");
            
            if (modelStream == null) {
                // Try alternative path or download model
                logger.warn("OpenNLP sentence model not found. Attempting to load from classpath...");
                // For now, we'll use a fallback regex-based approach
                logger.info("Using regex-based sentence segmentation as fallback");
                initialized = false;
                return;
            }
            
            SentenceModel model = new SentenceModel(modelStream);
            sentenceDetector = new SentenceDetectorME(model);
            initialized = true;
            logger.info("✅ OpenNLP sentence segmentation initialized (local, no AI calls)");
            modelStream.close();
            
        } catch (Exception e) {
            logger.warn("⚠️ Could not initialize OpenNLP, using regex fallback: {}", e.getMessage());
            initialized = false;
        }
    }
    
    /**
     * Segment text into sentences using OpenNLP (local, no AI)
     */
    public List<String> segmentSentences(String text) {
        if (text == null || text.trim().isEmpty()) {
            return new ArrayList<>();
        }
        
        if (initialized && sentenceDetector != null) {
            try {
                String[] sentences = sentenceDetector.sentDetect(text);
                List<String> result = new ArrayList<>();
                for (String sentence : sentences) {
                    String trimmed = sentence.trim();
                    if (!trimmed.isEmpty()) {
                        result.add(trimmed);
                    }
                }
                return result;
            } catch (Exception e) {
                logger.warn("OpenNLP segmentation error, using regex fallback: {}", e.getMessage());
            }
        }
        
        // Fallback to regex-based segmentation
        return segmentSentencesRegex(text);
    }
    
    /**
     * Regex-based sentence segmentation (fallback)
     */
    private List<String> segmentSentencesRegex(String text) {
        List<String> sentences = new ArrayList<>();
        
        // Split by sentence endings (. ! ?) followed by space or newline
        String[] parts = text.split("(?<=[.!?])\\s+");
        
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                sentences.add(trimmed);
            }
        }
        
        // If no sentences found, return the whole text as one sentence
        if (sentences.isEmpty()) {
            sentences.add(text.trim());
        }
        
        return sentences;
    }
    
    /**
     * Check if OpenNLP is initialized
     */
    public boolean isInitialized() {
        return initialized;
    }
}

