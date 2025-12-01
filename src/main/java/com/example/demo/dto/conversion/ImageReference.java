package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ImageReference {
    private String id;
    private String originalPath;
    private String epubPath;
    private String altText;
    private String caption;
    private ImageBlock.ImageType imageType;
}

