package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TextBlock {
    private String id;
    private String text;
    private BlockType type; // HEADING, PARAGRAPH, LIST_ITEM, CAPTION, etc.
    private Integer level; // For headings (H1, H2, etc.)
    private BoundingBox boundingBox;
    private String fontName;
    private Double fontSize;
    private Boolean isBold;
    private Boolean isItalic;
    private Integer readingOrder;
    private Double confidence;
    private List<String> languages = new ArrayList<>();
    
    public enum BlockType {
        HEADING,
        PARAGRAPH,
        LIST_ITEM,
        LIST_ORDERED,
        LIST_UNORDERED,
        CAPTION,
        FOOTNOTE,
        SIDEBAR,
        CALLOUT,
        QUESTION,
        EXERCISE,
        ANSWER,
        EXAMPLE,
        NOTE,
        TIP,
        WARNING,
        GLOSSARY_TERM,
        LEARNING_OBJECTIVE,
        OTHER
    }
}

