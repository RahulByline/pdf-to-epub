package com.example.demo.repository;

import com.example.demo.model.AudioSync;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AudioSyncRepository extends JpaRepository<AudioSync, Long> {
    List<AudioSync> findByPdfDocumentId(Long pdfDocumentId);
    List<AudioSync> findByConversionJobId(Long conversionJobId);
    List<AudioSync> findByPdfDocumentIdAndConversionJobId(Long pdfDocumentId, Long conversionJobId);
    void deleteByConversionJobId(Long conversionJobId);
}

