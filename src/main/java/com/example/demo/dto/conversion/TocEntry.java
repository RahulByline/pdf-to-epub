package com.example.demo.dto.conversion;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TocEntry {
    private String title;
    private String targetId;
    private Integer level;
    private List<TocEntry> children = new ArrayList<>();
}

