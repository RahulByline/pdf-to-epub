package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class DocumentStructure {
    private List<PageStructure> pages = new ArrayList<>();
    private TableOfContents tableOfContents;
    private DocumentMetadata metadata;
    private List<ImageReference> images = new ArrayList<>();
    private List<TableStructure> tables = new ArrayList<>();
    private List<MathEquation> equations = new ArrayList<>();
    private List<SemanticBlock> semanticBlocks = new ArrayList<>();
}

