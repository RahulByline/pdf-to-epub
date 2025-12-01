package com.example.demo.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_configurations")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiConfiguration {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "api_key", nullable = false, length = 500)
    private String apiKey;

    @Column(name = "model_name", nullable = false, length = 100)
    private String modelName = "gemini-pro"; // Default model

    @Column(name = "is_active", nullable = false)
    private Boolean isActive = true;

    @Column(name = "description", length = 500)
    private String description;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // Helper method to get the active configuration
    public static AiConfiguration createDefault() {
        AiConfiguration config = new AiConfiguration();
        config.setApiKey("");
        config.setModelName("gemini-pro");
        config.setIsActive(false);
        return config;
    }
}


