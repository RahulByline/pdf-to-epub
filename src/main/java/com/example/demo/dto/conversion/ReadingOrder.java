package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ReadingOrder {
    private List<String> blockIds = new ArrayList<>(); // Ordered list of block IDs
    private Boolean isMultiColumn = false;
    private Integer columnCount = 1;
}

