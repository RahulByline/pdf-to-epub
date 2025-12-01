package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TableBlock {
    private String id;
    private BoundingBox boundingBox;
    private Integer rows;
    private Integer columns;
    private List<List<TableCell>> cells = new ArrayList<>();
    private List<String> headers = new ArrayList<>();
    private String caption;
    private Double confidence;
    private Boolean hasHeaderRow = true;
}

