package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class AccessibilityService {

    private static final Logger logger = LoggerFactory.getLogger(AccessibilityService.class);

    public DocumentStructure enhanceAccessibility(DocumentStructure structure) {
        // Generate alt text for images
        structure = generateAltText(structure);
        
        // Add ARIA roles and semantic tags
        structure = addAriaRoles(structure);
        
        // Ensure color accessibility
        structure = checkColorAccessibility(structure);
        
        // Mark reading order for screen readers
        structure = markReadingOrder(structure);
        
        return structure;
    }

    private DocumentStructure generateAltText(DocumentStructure structure) {
        for (ImageReference image : structure.getImages()) {
            if (image.getAltText() == null || image.getAltText().isEmpty()) {
                // Generate descriptive alt text based on context
                String altText = generateDescriptiveAltText(image);
                image.setAltText(altText);
                // Flag for human review if alt text is missing
            }
        }
        
        // Also check image blocks in pages
        for (PageStructure page : structure.getPages()) {
            for (ImageBlock imageBlock : page.getImageBlocks()) {
                if (imageBlock.getAltText() == null || imageBlock.getAltText().isEmpty()) {
                    String altText = generateDescriptiveAltTextFromBlock(imageBlock);
                    imageBlock.setAltText(altText);
                    imageBlock.setRequiresAltText(true);
                }
            }
        }
        
        return structure;
    }

    private boolean imageRequiresReview(ImageReference image) {
        return image.getAltText() == null || image.getAltText().isEmpty();
    }

    private String generateDescriptiveAltText(ImageReference image) {
        // In production, use image caption, context, or ML-based image description
        if (image.getCaption() != null && !image.getCaption().isEmpty()) {
            return image.getCaption();
        }
        
        // Generate based on image type
        switch (image.getImageType()) {
            case FIGURE:
                return "Figure: " + (image.getCaption() != null ? image.getCaption() : "Illustration");
            case CHART:
                return "Chart: " + (image.getCaption() != null ? image.getCaption() : "Data visualization");
            case DIAGRAM:
                return "Diagram: " + (image.getCaption() != null ? image.getCaption() : "Visual diagram");
            case FORMULA_IMAGE:
                return "Mathematical formula";
            case DECORATIVE:
                return ""; // Decorative images should have empty alt text
            default:
                return "Image: " + (image.getCaption() != null ? image.getCaption() : "Content image");
        }
    }

    private String generateDescriptiveAltTextFromBlock(ImageBlock imageBlock) {
        if (imageBlock.getCaption() != null && !imageBlock.getCaption().isEmpty()) {
            return imageBlock.getCaption();
        }
        
        switch (imageBlock.getImageType()) {
            case FIGURE:
                return "Figure: " + (imageBlock.getCaption() != null ? imageBlock.getCaption() : "Illustration");
            case CHART:
                return "Chart: " + (imageBlock.getCaption() != null ? imageBlock.getCaption() : "Data visualization");
            case DIAGRAM:
                return "Diagram: " + (imageBlock.getCaption() != null ? imageBlock.getCaption() : "Visual diagram");
            case DECORATIVE:
                return "";
            default:
                return "Image: " + (imageBlock.getCaption() != null ? imageBlock.getCaption() : "Content image");
        }
    }

    private DocumentStructure addAriaRoles(DocumentStructure structure) {
        // Add semantic HTML roles based on block types
        // This information will be used during EPUB generation
        // In production, store ARIA roles in block metadata
        
        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                // Map block types to ARIA roles
                // ARIA roles will be applied during EPUB HTML generation
                getAriaRole(block.getType()); // For future use
            }
        }
        
        return structure;
    }

    private String getAriaRole(TextBlock.BlockType blockType) {
        switch (blockType) {
            case HEADING:
                return "heading";
            case LIST_ITEM:
            case LIST_ORDERED:
            case LIST_UNORDERED:
                return "list";
            case CAPTION:
                return "caption";
            case FOOTNOTE:
                return "note";
            case SIDEBAR:
                return "complementary";
            case CALLOUT:
                return "note";
            default:
                return "text";
        }
    }

    private DocumentStructure checkColorAccessibility(DocumentStructure structure) {
        // Check for color-only information
        // In production, analyze PDF for color-dependent content
        // This would require extracting color information from PDF rendering
        
        // Placeholder for color accessibility checks
        // Would flag blocks that rely solely on color for meaning
        
        return structure;
    }

    private DocumentStructure markReadingOrder(DocumentStructure structure) {
        // Ensure reading order is properly marked for screen readers
        // This is already handled in layout analysis, but we verify here
        
        for (PageStructure page : structure.getPages()) {
            ReadingOrder readingOrder = page.getReadingOrder();
            if (readingOrder == null || readingOrder.getBlockIds().isEmpty()) {
                // Rebuild reading order
                readingOrder = new ReadingOrder();
                for (TextBlock block : page.getTextBlocks()) {
                    readingOrder.getBlockIds().add(block.getId());
                }
                page.setReadingOrder(readingOrder);
            }
        }
        
        return structure;
    }
}

