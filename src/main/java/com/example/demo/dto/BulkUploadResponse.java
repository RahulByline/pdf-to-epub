package com.example.demo.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class BulkUploadResponse {
    private int totalUploaded;
    private int totalFailed;
    private List<PdfUploadResponse> successfulUploads;
    private List<UploadError> errors;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UploadError {
        private String fileName;
        private String errorMessage;
    }
}

