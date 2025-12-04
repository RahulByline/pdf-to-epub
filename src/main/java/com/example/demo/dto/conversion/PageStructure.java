package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class PageStructure {
    private Integer pageNumber;
    private List<TextBlock> textBlocks = new ArrayList<>();
    private List<ImageBlock> imageBlocks = new ArrayList<>();
    private List<TableBlock> tableBlocks = new ArrayList<>();
    private ReadingOrder readingOrder;
    private Boolean isScanned;
    private Double ocrConfidence;
    private Boolean isTwoPageSpread; // True if this is a two-page spread (split page with 2 pages)
}

