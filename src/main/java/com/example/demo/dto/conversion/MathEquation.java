package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class MathEquation {
    private String id;
    private String originalText;
    private String mathml;
    private String latex;
    private BoundingBox boundingBox;
    private Boolean isInline;
    private Double confidence;
}

