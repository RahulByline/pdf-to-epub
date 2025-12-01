package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ImageBlock {
    private String id;
    private String imagePath;
    private BoundingBox boundingBox;
    private String altText;
    private String caption;
    private ImageType imageType;
    private Double confidence;
    private Boolean requiresAltText;
    
    public enum ImageType {
        FIGURE,
        CHART,
        DIAGRAM,
        PHOTO,
        ILLUSTRATION,
        DECORATIVE,
        FORMULA_IMAGE,
        OTHER
    }
}

