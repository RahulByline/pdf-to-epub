package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class DocumentMetadata {
    private String title;
    private List<String> authors = new ArrayList<>();
    private String isbn;
    private String language;
    private List<String> languages = new ArrayList<>();
    private String subject;
    private String gradeLevel;
    private String publisher;
    private String publicationDate;
    private String description;
    private List<String> keywords = new ArrayList<>();
}

