package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SemanticBlock {
    private String id;
    private SemanticType type;
    private String content;
    private List<String> relatedBlockIds = new ArrayList<>();
    private Double confidence;
    
    public enum SemanticType {
        LEARNING_OBJECTIVE,
        KEY_TERM,
        GLOSSARY_ENTRY,
        EXERCISE,
        EXERCISE_ANSWER,
        EXAMPLE,
        NOTE,
        TIP,
        WARNING,
        CHAPTER_BOUNDARY,
        SECTION_BOUNDARY,
        INTERNAL_LINK,
        OTHER
    }
}

