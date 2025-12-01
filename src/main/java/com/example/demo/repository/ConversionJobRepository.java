package com.example.demo.repository;

import com.example.demo.model.ConversionJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ConversionJobRepository extends JpaRepository<ConversionJob, Long> {
    List<ConversionJob> findByStatus(ConversionJob.JobStatus status);
    List<ConversionJob> findByPdfDocumentId(Long pdfDocumentId);
    List<ConversionJob> findByRequiresReviewTrue();
}

