package com.example.demo.service;

import com.example.demo.dto.conversion.DocumentStructure;
import com.example.demo.dto.conversion.TextBlock;
import com.example.demo.model.AiConfiguration;
import com.example.demo.repository.AiConfigurationRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.*;

@Service
public class GeminiAiService {

    private static final Logger logger = LoggerFactory.getLogger(GeminiAiService.class);
    private static final String GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

    @Autowired
    private AiConfigurationRepository aiConfigurationRepository;

    @Autowired
    private ObjectMapper objectMapper;

    private WebClient webClient;

    public GeminiAiService() {
        this.webClient = WebClient.builder()
            .baseUrl(GEMINI_API_BASE_URL)
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .build();
    }

    /**
     * Check if AI is configured and active
     */
    public boolean isAiEnabled() {
        Optional<AiConfiguration> config = aiConfigurationRepository.findByIsActiveTrue();
        return config.isPresent() && 
               config.get().getApiKey() != null && 
               !config.get().getApiKey().trim().isEmpty();
    }

    /**
     * Get active AI configuration
     */
    public Optional<AiConfiguration> getActiveConfiguration() {
        return aiConfigurationRepository.findByIsActiveTrue();
    }

    /**
     * Improve document structure using AI - fixes headers, captions, spellings
     */
    public DocumentStructure improveDocumentStructure(DocumentStructure structure) {
        if (!isAiEnabled()) {
            logger.warn("AI is not enabled, skipping AI improvement");
            return structure;
        }

        try {
            Optional<AiConfiguration> configOpt = getActiveConfiguration();
            if (configOpt.isEmpty()) {
                return structure;
            }

            AiConfiguration config = configOpt.get();
            logger.info("Using AI model: {} to improve document structure", config.getModelName());

            // Process each page's text blocks to improve structure
            for (int i = 0; i < structure.getPages().size(); i++) {
                var page = structure.getPages().get(i);
                logger.debug("Processing page {} with AI", i + 1);

                // Group text blocks for batch processing
                List<TextBlock> textBlocks = page.getTextBlocks();
                if (textBlocks.isEmpty()) {
                    continue;
                }

                // Process blocks in batches to avoid token limits
                int batchSize = 10;
                for (int j = 0; j < textBlocks.size(); j += batchSize) {
                    int end = Math.min(j + batchSize, textBlocks.size());
                    List<TextBlock> batch = textBlocks.subList(j, end);
                    
                    List<TextBlock> improvedBatch = improveTextBlocks(batch, config);
                    
                    // Update the original blocks with improved versions
                    for (int k = 0; k < batch.size(); k++) {
                        if (k < improvedBatch.size()) {
                            TextBlock improved = improvedBatch.get(k);
                            TextBlock original = batch.get(k);
                            
                            // Update text, type, and other properties
                            original.setText(improved.getText());
                            if (improved.getType() != null) {
                                original.setType(improved.getType());
                            }
                        }
                    }
                }
            }

            // Improve table of contents structure
            if (structure.getTableOfContents() != null && 
                structure.getTableOfContents().getEntries() != null) {
                structure.setTableOfContents(improveTableOfContents(
                    structure.getTableOfContents(), config));
            }

            logger.info("AI improvement completed successfully");
            return structure;

        } catch (Exception e) {
            logger.error("Error during AI improvement: {}", e.getMessage(), e);
            // Return original structure if AI fails
            return structure;
        }
    }

    /**
     * Improve text blocks - fix spellings, identify headers, improve structure
     */
    private List<TextBlock> improveTextBlocks(List<TextBlock> blocks, AiConfiguration config) {
        try {
            // Build prompt for AI
            StringBuilder promptBuilder = new StringBuilder();
            promptBuilder.append("You are an expert at analyzing and improving document structure. ");
            promptBuilder.append("Analyze the following text blocks from a PDF document and:\n");
            promptBuilder.append("1. Fix any spelling errors\n");
            promptBuilder.append("2. Identify and properly classify headers (H1, H2, H3, etc.)\n");
            promptBuilder.append("3. Identify captions for images/figures\n");
            promptBuilder.append("4. Improve text formatting and readability\n");
            promptBuilder.append("5. Preserve the original meaning and structure\n\n");
            promptBuilder.append("Text blocks to analyze:\n\n");

            for (int i = 0; i < blocks.size(); i++) {
                TextBlock block = blocks.get(i);
                promptBuilder.append(String.format("Block %d:\n", i + 1));
                promptBuilder.append(String.format("  Current Type: %s\n", 
                    block.getType() != null ? block.getType().name() : "UNKNOWN"));
                promptBuilder.append(String.format("  Text: %s\n", block.getText()));
                promptBuilder.append("\n");
            }

            promptBuilder.append("\nReturn a JSON array where each element corresponds to a block and contains:\n");
            promptBuilder.append("- 'text': corrected and improved text\n");
            promptBuilder.append("- 'type': one of HEADING, PARAGRAPH, CAPTION, LIST_ITEM, LIST_ORDERED, LIST_UNORDERED\n");
            promptBuilder.append("- 'level': for headings, use 1 for H1, 2 for H2, 3 for H3, etc.\n");
            promptBuilder.append("- 'isHeader': boolean indicating if it's a header\n");
            promptBuilder.append("- 'isCaption': boolean indicating if it's a caption\n");

            String prompt = promptBuilder.toString();

            // Call Gemini API
            String response = callGeminiApi(prompt, config);
            
            // Parse response
            return parseTextBlockImprovements(response, blocks);

        } catch (Exception e) {
            logger.error("Error improving text blocks: {}", e.getMessage(), e);
            return blocks; // Return original blocks on error
        }
    }

    /**
     * Improve table of contents using AI
     */
    private com.example.demo.dto.conversion.TableOfContents improveTableOfContents(
            com.example.demo.dto.conversion.TableOfContents toc, 
            AiConfiguration config) {
        try {
            StringBuilder promptBuilder = new StringBuilder();
            promptBuilder.append("Analyze and improve the table of contents structure. ");
            promptBuilder.append("Fix any spelling errors, improve hierarchy, and ensure proper formatting.\n\n");
            promptBuilder.append("Current TOC entries:\n");
            
            if (toc.getEntries() != null) {
                for (var entry : toc.getEntries()) {
                    promptBuilder.append(String.format("- Level %d: %s\n", 
                        entry.getLevel(), entry.getTitle()));
                }
            }

            promptBuilder.append("\nReturn improved TOC structure in JSON format.");

            // Call AI to improve TOC (simplified - in production would fully parse response)
            // For now, just return the original TOC as AI improvement for TOC is complex
            return toc;
        } catch (Exception e) {
            logger.error("Error improving TOC: {}", e.getMessage(), e);
            return toc;
        }
    }

    /**
     * Call Gemini API with the given prompt
     */
    private String callGeminiApi(String prompt, AiConfiguration config) {
        try {
            Map<String, Object> requestBody = new HashMap<>();
            Map<String, Object> contents = new HashMap<>();
            List<Map<String, Object>> parts = new ArrayList<>();
            
            Map<String, Object> textPart = new HashMap<>();
            textPart.put("text", prompt);
            parts.add(textPart);
            
            contents.put("parts", parts);
            
            List<Map<String, Object>> contentsList = new ArrayList<>();
            contentsList.add(contents);
            
            requestBody.put("contents", contentsList);
            
            // Add generation config
            Map<String, Object> generationConfig = new HashMap<>();
            generationConfig.put("temperature", 0.3);
            generationConfig.put("topK", 40);
            generationConfig.put("topP", 0.95);
            generationConfig.put("maxOutputTokens", 8192);
            requestBody.put("generationConfig", generationConfig);

            String modelName = config.getModelName();
            if (modelName != null && !modelName.startsWith("models/")) {
                modelName = "models/" + modelName;
            } else if (modelName == null) {
                modelName = "models/gemini-pro";
            }

            String url = String.format("/%s:generateContent?key=%s", modelName, config.getApiKey());

            logger.debug("Calling Gemini API: {}", url);

            String response = webClient.post()
                .uri(url)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(String.class)
                .block();

            logger.debug("Gemini API response received");
            return response;

        } catch (Exception e) {
            logger.error("Error calling Gemini API: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to call Gemini API: " + e.getMessage(), e);
        }
    }

    /**
     * Parse AI response and create improved text blocks
     */
    private List<TextBlock> parseTextBlockImprovements(String aiResponse, List<TextBlock> originalBlocks) {
        try {
            JsonNode rootNode = objectMapper.readTree(aiResponse);
            JsonNode candidates = rootNode.path("candidates");
            
            if (candidates.isEmpty() || !candidates.has(0)) {
                logger.warn("No candidates in AI response");
                return originalBlocks;
            }

            JsonNode content = candidates.get(0).path("content");
            JsonNode parts = content.path("parts");
            
            if (parts.isEmpty() || !parts.has(0)) {
                logger.warn("No parts in AI response");
                return originalBlocks;
            }

            String text = parts.get(0).path("text").asText();
            
            // Try to extract JSON from the response text
            // AI might return JSON wrapped in markdown code blocks
            text = text.trim();
            if (text.startsWith("```json")) {
                text = text.substring(7);
            }
            if (text.startsWith("```")) {
                text = text.substring(3);
            }
            if (text.endsWith("```")) {
                text = text.substring(0, text.length() - 3);
            }
            text = text.trim();

            // Parse JSON array
            JsonNode blocksArray = objectMapper.readTree(text);
            
            List<TextBlock> improvedBlocks = new ArrayList<>();
            for (int i = 0; i < blocksArray.size() && i < originalBlocks.size(); i++) {
                JsonNode blockNode = blocksArray.get(i);
                TextBlock original = originalBlocks.get(i);
                TextBlock improved = new TextBlock();
                
                // Copy original properties
                improved.setBoundingBox(original.getBoundingBox());
                improved.setConfidence(original.getConfidence());
                improved.setFontSize(original.getFontSize());
                improved.setFontName(original.getFontName());
                improved.setIsBold(original.getIsBold());
                improved.setIsItalic(original.getIsItalic());
                improved.setReadingOrder(original.getReadingOrder());
                improved.setLevel(original.getLevel());
                
                // Update with AI improvements
                if (blockNode.has("text")) {
                    improved.setText(blockNode.get("text").asText());
                } else {
                    improved.setText(original.getText());
                }
                
                if (blockNode.has("type")) {
                    String typeStr = blockNode.get("type").asText();
                    try {
                        improved.setType(TextBlock.BlockType.valueOf(typeStr));
                    } catch (IllegalArgumentException e) {
                        // If AI returns HEADING_1, HEADING_2, etc., map to HEADING
                        if (typeStr.startsWith("HEADING")) {
                            improved.setType(TextBlock.BlockType.HEADING);
                            // Set level if provided
                            if (blockNode.has("level")) {
                                improved.setLevel(blockNode.get("level").asInt());
                            } else {
                                // Try to extract level from type string (e.g., HEADING_1 -> 1)
                                try {
                                    String levelStr = typeStr.replace("HEADING_", "");
                                    improved.setLevel(Integer.parseInt(levelStr));
                                } catch (NumberFormatException ex) {
                                    improved.setLevel(original.getLevel());
                                }
                            }
                        } else {
                            improved.setType(original.getType());
                        }
                    }
                } else {
                    improved.setType(original.getType());
                }
                
                // Set level if provided in response
                if (blockNode.has("level")) {
                    improved.setLevel(blockNode.get("level").asInt());
                }
                
                improvedBlocks.add(improved);
            }

            // Fill remaining blocks with originals if AI returned fewer
            while (improvedBlocks.size() < originalBlocks.size()) {
                improvedBlocks.add(originalBlocks.get(improvedBlocks.size()));
            }

            return improvedBlocks;

        } catch (Exception e) {
            logger.error("Error parsing AI response: {}", e.getMessage(), e);
            return originalBlocks;
        }
    }

    /**
     * Classify document type using AI
     */
    public String classifyDocumentType(DocumentStructure structure) {
        if (!isAiEnabled()) {
            return "UNKNOWN";
        }

        try {
            Optional<AiConfiguration> configOpt = getActiveConfiguration();
            if (configOpt.isEmpty()) {
                return "UNKNOWN";
            }

            AiConfiguration config = configOpt.get();

            // Extract sample text from first few pages
            StringBuilder sampleText = new StringBuilder();
            int pagesToSample = Math.min(3, structure.getPages().size());
            for (int i = 0; i < pagesToSample; i++) {
                var page = structure.getPages().get(i);
                for (var block : page.getTextBlocks()) {
                    if (block.getText() != null && block.getText().length() > 20) {
                        sampleText.append(block.getText()).append("\n");
                    }
                }
            }

            String prompt = String.format(
                "Analyze the following document excerpt and classify it into one of these categories: " +
                "TEXTBOOK, WORKBOOK, TEACHER_GUIDE, RESEARCH_PAPER, MANUAL, NOVEL, ARTICLE, OTHER.\n\n" +
                "Document excerpt:\n%s\n\n" +
                "Return only the category name in uppercase.",
                sampleText.toString().substring(0, Math.min(2000, sampleText.length()))
            );

            String response = callGeminiApi(prompt, config);
            JsonNode rootNode = objectMapper.readTree(response);
            JsonNode candidates = rootNode.path("candidates");
            
            if (!candidates.isEmpty() && candidates.has(0)) {
                String text = candidates.get(0).path("content").path("parts").get(0).path("text").asText();
                return text.trim().toUpperCase();
            }

            return "UNKNOWN";

        } catch (Exception e) {
            logger.error("Error classifying document: {}", e.getMessage(), e);
            return "UNKNOWN";
        }
    }
}

