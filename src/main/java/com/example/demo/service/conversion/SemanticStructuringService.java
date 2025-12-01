package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

@Service
public class SemanticStructuringService {

    private static final Logger logger = LoggerFactory.getLogger(SemanticStructuringService.class);

    public DocumentStructure addSemanticStructure(DocumentStructure structure) {
        // Identify semantic blocks
        structure = identifySemanticBlocks(structure);
        
        // Build table of contents
        structure = buildTableOfContents(structure);
        
        // Identify internal links
        structure = identifyInternalLinks(structure);
        
        // Identify educational elements
        structure = identifyEducationalElements(structure);
        
        return structure;
    }

    private DocumentStructure identifySemanticBlocks(DocumentStructure structure) {
        List<SemanticBlock> semanticBlocks = new ArrayList<>();
        int semanticId = 0;

        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                SemanticBlock semantic = identifySemanticType(block, semanticId++);
                if (semantic != null) {
                    semanticBlocks.add(semantic);
                }
            }
        }

        structure.setSemanticBlocks(semanticBlocks);
        return structure;
    }

    private SemanticBlock identifySemanticType(TextBlock block, int id) {
        String text = block.getText().toLowerCase();
        SemanticBlock semantic = new SemanticBlock();
        semantic.setId("semantic_" + id);
        semantic.setContent(block.getText());
        semantic.setRelatedBlockIds(List.of(block.getId()));
        semantic.setConfidence(0.8);

        // Pattern-based semantic identification
        if (text.contains("learning objective") || text.contains("objective:")) {
            semantic.setType(SemanticBlock.SemanticType.LEARNING_OBJECTIVE);
            return semantic;
        }
        
        if (text.contains("key term") || text.contains("definition:")) {
            semantic.setType(SemanticBlock.SemanticType.KEY_TERM);
            return semantic;
        }
        
        if (text.matches(".*exercise \\d+.*") || text.contains("practice problem")) {
            semantic.setType(SemanticBlock.SemanticType.EXERCISE);
            return semantic;
        }
        
        if (text.contains("answer:") || text.contains("solution:")) {
            semantic.setType(SemanticBlock.SemanticType.EXERCISE_ANSWER);
            return semantic;
        }
        
        if (text.contains("example:") || text.contains("example ")) {
            semantic.setType(SemanticBlock.SemanticType.EXAMPLE);
            return semantic;
        }
        
        if (text.contains("note:") || text.startsWith("note ")) {
            semantic.setType(SemanticBlock.SemanticType.NOTE);
            return semantic;
        }
        
        if (text.contains("tip:") || text.contains("hint:")) {
            semantic.setType(SemanticBlock.SemanticType.TIP);
            return semantic;
        }
        
        if (text.contains("warning:") || text.contains("caution:")) {
            semantic.setType(SemanticBlock.SemanticType.WARNING);
            return semantic;
        }
        
        if (text.matches("^chapter \\d+.*") || text.matches("^section \\d+.*")) {
            semantic.setType(SemanticBlock.SemanticType.CHAPTER_BOUNDARY);
            return semantic;
        }
        
        // Check for internal links
        if (text.contains("see chapter") || text.contains("refer to section")) {
            semantic.setType(SemanticBlock.SemanticType.INTERNAL_LINK);
            return semantic;
        }

        return null; // Not a semantic block
    }

    private DocumentStructure buildTableOfContents(DocumentStructure structure) {
        TableOfContents toc = new TableOfContents();
        List<TocEntry> entries = new ArrayList<>();
        
        int currentChapterLevel = 0;
        TocEntry currentChapter = null;
        TocEntry currentSection = null;

        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                if (block.getType() == TextBlock.BlockType.HEADING) {
                    Integer level = block.getLevel();
                    if (level == null) level = 2;
                    
                    TocEntry entry = new TocEntry();
                    entry.setTitle(block.getText());
                    entry.setTargetId(block.getId());
                    entry.setLevel(level);
                    
                    if (level == 1) {
                        // Chapter level
                        if (currentChapter != null) {
                            entries.add(currentChapter);
                        }
                        currentChapter = entry;
                        currentSection = null;
                    } else if (level == 2) {
                        // Section level
                        if (currentChapter != null) {
                            if (currentSection != null) {
                                currentChapter.getChildren().add(currentSection);
                            }
                            currentSection = entry;
                        } else {
                            entries.add(entry);
                        }
                    } else {
                        // Subsection level
                        if (currentSection != null) {
                            currentSection.getChildren().add(entry);
                        } else if (currentChapter != null) {
                            currentChapter.getChildren().add(entry);
                        } else {
                            entries.add(entry);
                        }
                    }
                }
            }
        }
        
        // Add final entries
        if (currentSection != null && currentChapter != null) {
            currentChapter.getChildren().add(currentSection);
        }
        if (currentChapter != null) {
            entries.add(currentChapter);
        }
        
        toc.setEntries(entries);
        structure.setTableOfContents(toc);
        
        return structure;
    }

    private DocumentStructure identifyInternalLinks(DocumentStructure structure) {
        Pattern linkPattern = Pattern.compile(
            "(see|refer to|see also|chapter|section)\\s+(\\d+[.\\d]*)",
            Pattern.CASE_INSENSITIVE
        );

        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                java.util.regex.Matcher matcher = linkPattern.matcher(block.getText());
                if (matcher.find()) {
                    // Create internal link semantic block
                    SemanticBlock link = new SemanticBlock();
                    link.setId("link_" + block.getId());
                    link.setType(SemanticBlock.SemanticType.INTERNAL_LINK);
                    link.setContent(block.getText());
                    link.setRelatedBlockIds(List.of(block.getId()));
                    link.setConfidence(0.9);
                    
                    structure.getSemanticBlocks().add(link);
                }
            }
        }

        return structure;
    }

    private DocumentStructure identifyEducationalElements(DocumentStructure structure) {
        // Identify glossary terms, learning objectives, etc.
        // This would be enhanced with ML models in production
        
        for (SemanticBlock semantic : structure.getSemanticBlocks()) {
            if (semantic.getType() == SemanticBlock.SemanticType.KEY_TERM) {
                // Could extract term and definition
                semantic.setConfidence(0.85);
            }
        }

        return structure;
    }
}

