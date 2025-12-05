package com.example.demo.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiConfigurationDTO {
    private Long id;
    private String apiKey;
    private String modelName;
    private Boolean isActive;
    private String description;
    
    // Available Gemini models
    public static final String[] AVAILABLE_MODELS = {
        "gemini-pro",
        "gemini-pro-vision",
        "gemini-1.5-pro",
        "gemini-1.5-flash"
    };
}



