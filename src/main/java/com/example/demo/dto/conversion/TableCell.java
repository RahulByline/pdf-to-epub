package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TableCell {
    private String content;
    private Integer row;
    private Integer column;
    private Integer rowSpan = 1;
    private Integer colSpan = 1;
    private Boolean isHeader = false;
}

