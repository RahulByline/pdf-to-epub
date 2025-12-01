package com.example.demo.repository;

import com.example.demo.model.PdfDocument;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface PdfDocumentRepository extends JpaRepository<PdfDocument, Long> {
    
    @Query("SELECT p FROM PdfDocument p LEFT JOIN FETCH p.languages WHERE p.id = :id")
    Optional<PdfDocument> findByIdWithLanguages(@Param("id") Long id);
}

