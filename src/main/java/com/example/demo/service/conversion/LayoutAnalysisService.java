package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

@Service
public class LayoutAnalysisService {

    private static final Logger logger = LoggerFactory.getLogger(LayoutAnalysisService.class);

    public DocumentStructure analyzeLayout(DocumentStructure structure) {
        // Analyze headings hierarchy
        structure = analyzeHeadingHierarchy(structure);
        
        // Detect and structure lists
        structure = detectAndStructureLists(structure);
        
        // Detect tables
        structure = detectTables(structure);
        
        // Detect images and figures
        structure = detectImages(structure);
        
        // Improve reading order
        structure = improveReadingOrder(structure);
        
        return structure;
    }

    private DocumentStructure analyzeHeadingHierarchy(DocumentStructure structure) {
        int currentLevel = 0;
        List<Integer> levelStack = new ArrayList<>();

        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                if (block.getType() == TextBlock.BlockType.HEADING) {
                    Integer detectedLevel = block.getLevel();
                    
                    if (detectedLevel == null) {
                        // Infer level from text patterns
                        detectedLevel = inferHeadingLevel(block.getText());
                    }
                    
                    // Adjust level based on hierarchy
                    if (levelStack.isEmpty() || detectedLevel <= levelStack.get(levelStack.size() - 1)) {
                        levelStack.clear();
                    }
                    levelStack.add(detectedLevel);
                    
                    block.setLevel(detectedLevel);
                }
            }
        }

        return structure;
    }

    private Integer inferHeadingLevel(String text) {
        // Pattern-based heading level detection
        if (Pattern.matches("^Chapter \\d+.*", text)) return 1;
        if (Pattern.matches("^\\d+\\.\\s+[A-Z].*", text)) return 2;
        if (Pattern.matches("^\\d+\\.\\d+\\s+.*", text)) return 3;
        if (Pattern.matches("^\\d+\\.\\d+\\.\\d+\\s+.*", text)) return 4;
        
        // Check font size (if available) - larger = higher level
        // This would require font information from PDF
        
        return 2; // Default to level 2
    }

    private DocumentStructure detectAndStructureLists(DocumentStructure structure) {
        for (PageStructure page : structure.getPages()) {
            List<TextBlock> listItems = new ArrayList<>();
            TextBlock.BlockType listType = null;

            for (TextBlock block : page.getTextBlocks()) {
                if (block.getType() == TextBlock.BlockType.LIST_ITEM) {
                    listItems.add(block);
                    
                    // Determine list type
                    String text = block.getText();
                    if (text.matches("^\\d+[.)]\\s+.*")) {
                        listType = TextBlock.BlockType.LIST_ORDERED;
                    } else if (text.matches("^[•\\-\\*]\\s+.*") || text.matches("^[a-z][.)]\\s+.*")) {
                        listType = TextBlock.BlockType.LIST_UNORDERED;
                    }
                } else if (!listItems.isEmpty()) {
                    // End of list, mark all items
                    for (TextBlock item : listItems) {
                        item.setType(listType != null ? listType : TextBlock.BlockType.LIST_ITEM);
                    }
                    listItems.clear();
                }
            }
            
            // Handle list at end of page
            if (!listItems.isEmpty()) {
                for (TextBlock item : listItems) {
                    item.setType(listType != null ? listType : TextBlock.BlockType.LIST_ITEM);
                }
            }
        }

        return structure;
    }

    private DocumentStructure detectTables(DocumentStructure structure) {
        List<TableStructure> tables = new ArrayList<>();
        int tableId = 0;

        for (PageStructure page : structure.getPages()) {
            List<TextBlock> potentialTableRows = new ArrayList<>();
            
            for (TextBlock block : page.getTextBlocks()) {
                // Detect table-like patterns (multiple tabs, pipes, or aligned columns)
                if (isTableRow(block.getText())) {
                    potentialTableRows.add(block);
                } else if (potentialTableRows.size() >= 2) {
                    // We have a table
                    TableStructure table = createTableFromRows(potentialTableRows, tableId++);
                    tables.add(table);
                    potentialTableRows.clear();
                } else {
                    potentialTableRows.clear();
                }
            }
            
            // Handle table at end of page
            if (potentialTableRows.size() >= 2) {
                TableStructure table = createTableFromRows(potentialTableRows, tableId++);
                tables.add(table);
            }
        }

        structure.setTables(tables);
        return structure;
    }

    private boolean isTableRow(String text) {
        // Check for tab-separated or pipe-separated content
        String[] tabParts = text.split("\t");
        String[] pipeParts = text.split("\\|");
        
        return (tabParts.length >= 3) || (pipeParts.length >= 3);
    }

    private TableStructure createTableFromRows(List<TextBlock> rows, int tableId) {
        TableStructure table = new TableStructure();
        table.setId("table_" + tableId);
        
        TableBlock tableBlock = new TableBlock();
        tableBlock.setId("table_block_" + tableId);
        
        List<List<TableCell>> cells = new ArrayList<>();
        boolean firstRow = true;
        
        for (TextBlock row : rows) {
            String[] parts = row.getText().split("\t|\\|");
            List<TableCell> rowCells = new ArrayList<>();
            
            for (int i = 0; i < parts.length; i++) {
                TableCell cell = new TableCell();
                cell.setContent(parts[i].trim());
                cell.setRow(cells.size());
                cell.setColumn(i);
                cell.setIsHeader(firstRow);
                rowCells.add(cell);
            }
            
            if (firstRow) {
                tableBlock.setHasHeaderRow(true);
                for (TableCell cell : rowCells) {
                    tableBlock.getHeaders().add(cell.getContent());
                }
                firstRow = false;
            }
            
            cells.add(rowCells);
        }
        
        tableBlock.setRows(cells.size());
        tableBlock.setColumns(cells.isEmpty() ? 0 : cells.get(0).size());
        tableBlock.setCells(cells);
        table.setTableBlock(tableBlock);
        table.setConfidence(0.7); // Medium confidence for pattern-based detection
        
        return table;
    }

    private DocumentStructure detectImages(DocumentStructure structure) {
        // Image detection would require PDF image extraction
        // This is a placeholder - in production, extract images from PDF
        List<ImageReference> images = new ArrayList<>();
        structure.setImages(images);
        return structure;
    }

    private DocumentStructure improveReadingOrder(DocumentStructure structure) {
        for (PageStructure page : structure.getPages()) {
            // Sort blocks by reading order (top to bottom, left to right)
            page.getTextBlocks().sort((a, b) -> {
                Integer orderA = a.getReadingOrder();
                Integer orderB = b.getReadingOrder();
                if (orderA == null) orderA = Integer.MAX_VALUE;
                if (orderB == null) orderB = Integer.MAX_VALUE;
                return orderA.compareTo(orderB);
            });
            
            // Update reading order IDs
            ReadingOrder readingOrder = new ReadingOrder();
            for (TextBlock block : page.getTextBlocks()) {
                readingOrder.getBlockIds().add(block.getId());
            }
            page.setReadingOrder(readingOrder);
        }
        
        return structure;
    }
}

