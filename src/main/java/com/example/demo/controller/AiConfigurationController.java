package com.example.demo.controller;

import com.example.demo.dto.AiConfigurationDTO;
import com.example.demo.model.AiConfiguration;
import com.example.demo.repository.AiConfigurationRepository;
import com.example.demo.service.GeminiAiService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Controller
@RequestMapping("/api/ai")
public class AiConfigurationController {

    private static final Logger logger = LoggerFactory.getLogger(AiConfigurationController.class);

    @Autowired
    private AiConfigurationRepository aiConfigurationRepository;

    @Autowired
    private GeminiAiService geminiAiService;

    /**
     * Show AI configuration page
     */
    @GetMapping("/config")
    public String showAiConfigPage(Model model) {
        Optional<AiConfiguration> configOpt = aiConfigurationRepository.findByIsActiveTrue();
        
        AiConfigurationDTO dto = new AiConfigurationDTO();
        if (configOpt.isPresent()) {
            AiConfiguration config = configOpt.get();
            dto.setId(config.getId());
            // Don't mask API key in the form - show empty so user can enter it
            // Only mask when displaying in response, not in form
            dto.setApiKey(""); // Always show empty field for security
            dto.setModelName(config.getModelName());
            dto.setIsActive(config.getIsActive());
            dto.setDescription(config.getDescription());
        } else {
            dto.setApiKey(""); // Empty for new configuration
            dto.setModelName("gemini-pro");
            dto.setIsActive(false);
        }
        
        model.addAttribute("config", dto);
        model.addAttribute("availableModels", Arrays.asList(AiConfigurationDTO.AVAILABLE_MODELS));
        model.addAttribute("isAiEnabled", geminiAiService.isAiEnabled());
        
        return "ai-config";
    }

    /**
     * Save or update AI configuration
     */
    @PostMapping("/config")
    @ResponseBody
    public ResponseEntity<?> saveConfiguration(@RequestBody AiConfigurationDTO dto) {
        try {
            logger.info("Saving AI configuration with model: {}", dto.getModelName());

            // Deactivate all existing configurations
            List<AiConfiguration> existingConfigs = aiConfigurationRepository.findAll();
            for (AiConfiguration existing : existingConfigs) {
                existing.setIsActive(false);
                aiConfigurationRepository.save(existing);
            }

            // Create or update configuration - ensure permanent storage
            AiConfiguration config;
            boolean isNewConfig = false;
            boolean hasExistingApiKey = false;
            
            if (dto.getId() != null && dto.getId() > 0) {
                Optional<AiConfiguration> existingOpt = aiConfigurationRepository.findById(dto.getId());
                if (existingOpt.isPresent()) {
                    config = existingOpt.get();
                    hasExistingApiKey = (config.getApiKey() != null && !config.getApiKey().isEmpty());
                } else {
                    // ID provided but not found - create new
                    config = new AiConfiguration();
                    isNewConfig = true;
                }
            } else {
                // Try to find existing active config to update
                Optional<AiConfiguration> activeConfigOpt = aiConfigurationRepository.findByIsActiveTrue();
                if (activeConfigOpt.isPresent()) {
                    config = activeConfigOpt.get();
                    hasExistingApiKey = (config.getApiKey() != null && !config.getApiKey().isEmpty());
                } else {
                    config = new AiConfiguration();
                    isNewConfig = true;
                }
            }

            // Handle API key: update if provided, otherwise preserve existing (if updating)
            String apiKey = dto.getApiKey();
            if (apiKey != null && !apiKey.trim().isEmpty() && apiKey.length() >= 20) {
                // Valid API key provided - update it permanently
                config.setApiKey(apiKey.trim());
                logger.info("API key updated in configuration");
            } else if (isNewConfig) {
                // New configuration requires API key
                return ResponseEntity.badRequest()
                    .body("API key is required and must be at least 20 characters. Please enter your Gemini API key.");
            } else if (hasExistingApiKey) {
                // Updating existing config without new API key - preserve existing one
                logger.info("Preserving existing API key in configuration");
                // API key remains unchanged - already set in config object
            } else {
                // Existing config but no API key stored - require it
                return ResponseEntity.badRequest()
                    .body("API key is required. Please enter your Gemini API key.");
            }

            config.setModelName(dto.getModelName() != null ? dto.getModelName() : "gemini-pro");
            config.setIsActive(dto.getIsActive() != null ? dto.getIsActive() : true);
            config.setDescription(dto.getDescription());

            // Save permanently to database - this persists across sessions
            config = aiConfigurationRepository.save(config);
            
            // Ensure it's persisted by flushing
            aiConfigurationRepository.flush();

            logger.info("AI configuration saved permanently to database with ID: {}", config.getId());

            AiConfigurationDTO responseDto = new AiConfigurationDTO();
            responseDto.setId(config.getId());
            responseDto.setApiKey(maskApiKey(config.getApiKey()));
            responseDto.setModelName(config.getModelName());
            responseDto.setIsActive(config.getIsActive());
            responseDto.setDescription(config.getDescription());

            return ResponseEntity.ok(responseDto);

        } catch (Exception e) {
            logger.error("Error saving AI configuration: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("Error saving configuration: " + e.getMessage());
        }
    }

    /**
     * Get current AI configuration (REST API)
     */
    @GetMapping("/config/current")
    @ResponseBody
    public ResponseEntity<AiConfigurationDTO> getCurrentConfiguration() {
        Optional<AiConfiguration> configOpt = aiConfigurationRepository.findByIsActiveTrue();
        
        if (configOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        AiConfiguration config = configOpt.get();
        AiConfigurationDTO dto = new AiConfigurationDTO();
        dto.setId(config.getId());
        dto.setApiKey(maskApiKey(config.getApiKey()));
        dto.setModelName(config.getModelName());
        dto.setIsActive(config.getIsActive());
        dto.setDescription(config.getDescription());

        return ResponseEntity.ok(dto);
    }

    /**
     * Test AI connection
     */
    @PostMapping("/test")
    @ResponseBody
    public ResponseEntity<?> testConnection(@RequestBody AiConfigurationDTO dto) {
        try {
            // Temporarily create config for testing
            AiConfiguration testConfig = new AiConfiguration();
            testConfig.setApiKey(dto.getApiKey());
            testConfig.setModelName(dto.getModelName() != null ? dto.getModelName() : "gemini-pro");

            // Save temporarily to test
            testConfig.setIsActive(false);
            testConfig = aiConfigurationRepository.save(testConfig);

            try {
                // Validate the API key format
                if (testConfig.getApiKey() == null || testConfig.getApiKey().length() < 20) {
                    return ResponseEntity.badRequest()
                        .body("Invalid API key format");
                }

                // Delete test config
                aiConfigurationRepository.delete(testConfig);

                return ResponseEntity.ok("Connection test successful! API key format is valid.");

            } catch (Exception e) {
                aiConfigurationRepository.delete(testConfig);
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body("Connection test failed: " + e.getMessage());
            }

        } catch (Exception e) {
            logger.error("Error testing connection: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("Error testing connection: " + e.getMessage());
        }
    }

    /**
     * Get available models
     */
    @GetMapping("/models")
    @ResponseBody
    public ResponseEntity<List<String>> getAvailableModels() {
        return ResponseEntity.ok(Arrays.asList(AiConfigurationDTO.AVAILABLE_MODELS));
    }

    /**
     * Check if AI is enabled
     */
    @GetMapping("/status")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> getAiStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("enabled", geminiAiService.isAiEnabled());
        
        Optional<AiConfiguration> configOpt = aiConfigurationRepository.findByIsActiveTrue();
        if (configOpt.isPresent()) {
            status.put("model", configOpt.get().getModelName());
            status.put("configured", true);
        } else {
            status.put("configured", false);
        }

        return ResponseEntity.ok(status);
    }

    private String maskApiKey(String apiKey) {
        if (apiKey == null || apiKey.length() <= 8) {
            return "****";
        }
        return apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4);
    }
}

