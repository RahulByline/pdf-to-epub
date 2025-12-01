package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TableStructure {
    private String id;
    private TableBlock tableBlock;
    private String htmlContent;
    private Double confidence;
}

