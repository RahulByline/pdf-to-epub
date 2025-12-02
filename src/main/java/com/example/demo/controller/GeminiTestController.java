package com.example.demo.controller;

import com.example.demo.service.GeminiTextCorrectionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Controller for testing Gemini AI integration
 */
@RestController
@RequestMapping("/api/gemini")
public class GeminiTestController {

    @Autowired(required = false)
    private GeminiTextCorrectionService geminiService;

    /**
     * Test endpoint to check if Gemini API is working
     * GET /api/gemini/test
     */
    @GetMapping("/test")
    public ResponseEntity<Map<String, Object>> testGemini() {
        if (geminiService == null) {
            return ResponseEntity.ok(Map.of(
                "status", "SERVICE_NOT_AVAILABLE",
                "message", "GeminiTextCorrectionService is not available"
            ));
        }
        
        Map<String, Object> result = geminiService.testConnection();
        return ResponseEntity.ok(result);
    }
    
    /**
     * Test endpoint to correct a sample OCR text
     * POST /api/gemini/correct
     * Body: { "text": "tin4 ristopher Blazeman", "context": "book cover" }
     */
    @PostMapping("/correct")
    public ResponseEntity<Map<String, Object>> testCorrection(
            @RequestBody Map<String, String> request) {
        
        if (geminiService == null) {
            return ResponseEntity.ok(Map.of(
                "status", "SERVICE_NOT_AVAILABLE",
                "message", "GeminiTextCorrectionService is not available"
            ));
        }
        
        String text = request.get("text");
        String context = request.getOrDefault("context", "PDF document");
        
        if (text == null || text.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Text parameter is required"
            ));
        }
        
        String corrected = geminiService.correctOcrText(text, context);
        
        return ResponseEntity.ok(Map.of(
            "original", text,
            "corrected", corrected,
            "changed", !text.equals(corrected),
            "context", context
        ));
    }
    
    /**
     * List available Gemini models
     * GET /api/gemini/models
     */
    @GetMapping("/models")
    public ResponseEntity<Map<String, Object>> listModels() {
        if (geminiService == null) {
            return ResponseEntity.ok(Map.of(
                "status", "SERVICE_NOT_AVAILABLE",
                "message", "GeminiTextCorrectionService is not available"
            ));
        }
        
        Map<String, Object> result = geminiService.listAvailableModels();
        return ResponseEntity.ok(result);
    }
}

