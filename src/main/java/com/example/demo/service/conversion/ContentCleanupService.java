package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.regex.Pattern;

@Service
public class ContentCleanupService {

    private static final Logger logger = LoggerFactory.getLogger(ContentCleanupService.class);

    public DocumentStructure cleanupAndNormalize(DocumentStructure structure) {
        // Fix OCR errors
        structure = fixOcrErrors(structure);
        
        // Normalize quotes and dashes
        structure = normalizePunctuation(structure);
        
        // Normalize spacing
        structure = normalizeSpacing(structure);
        
        // Normalize lists
        structure = normalizeLists(structure);
        
        // Apply style rules
        structure = applyStyleRules(structure);
        
        return structure;
    }

    private DocumentStructure fixOcrErrors(DocumentStructure structure) {
        // Common OCR error patterns
        Pattern[][] ocrFixes = {
            {Pattern.compile("rn"), Pattern.compile("m")}, // rn -> m
            {Pattern.compile("0"), Pattern.compile("O")}, // 0 -> O (in words)
            {Pattern.compile("1"), Pattern.compile("l")}, // 1 -> l (in words)
            {Pattern.compile("5"), Pattern.compile("S")}, // 5 -> S (in words)
        };

        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                String text = block.getText();
                
                // Apply OCR fixes (simplified - in production use more sophisticated correction)
                for (Pattern[] fix : ocrFixes) {
                    // Only apply if confidence is low
                    if (block.getConfidence() != null && block.getConfidence() < 0.8) {
                        text = fix[0].matcher(text).replaceAll(fix[1].pattern());
                    }
                }
                
                block.setText(text);
            }
        }

        return structure;
    }

    private DocumentStructure normalizePunctuation(DocumentStructure structure) {
        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                String text = block.getText();
                
                // Normalize quotes
                text = text.replace("\u201C", "\""); // Left double quotation mark
                text = text.replace("\u201D", "\""); // Right double quotation mark
                text = text.replace("\u2018", "'"); // Left single quotation mark
                text = text.replace("\u2019", "'"); // Right single quotation mark
                
                // Normalize dashes
                text = text.replace("\u2014", "\u2014"); // em dash
                text = text.replace("\u2013", "-"); // en dash to hyphen
                
                // Normalize ellipsis
                text = text.replace("...", "\u2026"); // Horizontal ellipsis
                
                block.setText(text);
            }
        }

        return structure;
    }

    private DocumentStructure normalizeSpacing(DocumentStructure structure) {
        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                String text = block.getText();
                
                // Remove multiple spaces
                text = text.replaceAll(" +", " ");
                
                // Remove leading/trailing whitespace
                text = text.trim();
                
                // Normalize line breaks (remove excessive line breaks)
                text = text.replaceAll("\n{3,}", "\n\n");
                
                block.setText(text);
            }
        }

        return structure;
    }

    private DocumentStructure normalizeLists(DocumentStructure structure) {
        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                if (block.getType() == TextBlock.BlockType.LIST_ITEM ||
                    block.getType() == TextBlock.BlockType.LIST_ORDERED ||
                    block.getType() == TextBlock.BlockType.LIST_UNORDERED) {
                    
                    String text = block.getText();
                    
                    // Remove list markers for normalization (will be added back in HTML)
                    text = text.replaceFirst("^[•\\-\\*]\\s+", "");
                    text = text.replaceFirst("^\\d+[.)]\\s+", "");
                    text = text.replaceFirst("^[a-z][.)]\\s+", "");
                    
                    block.setText(text.trim());
                }
            }
        }

        return structure;
    }

    private DocumentStructure applyStyleRules(DocumentStructure structure) {
        // Apply client-specific style rules
        // For example: UK vs US English, specific formatting rules
        
        // This would be configurable per client/project
        String locale = structure.getMetadata() != null ? 
            structure.getMetadata().getLanguage() : "en";
        
        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                String text = block.getText();
                
                // Example: UK vs US English (simplified)
                if ("en-GB".equals(locale) || "en-UK".equals(locale)) {
                    text = text.replace("color", "colour");
                    text = text.replace("organize", "organise");
                    // Add more UK English conversions
                }
                
                block.setText(text);
            }
        }

        return structure;
    }
}

