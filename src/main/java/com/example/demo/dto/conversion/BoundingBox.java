package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class BoundingBox {
    private Double x;
    private Double y;
    private Double width;
    private Double height;
    private Integer pageNumber;
}

