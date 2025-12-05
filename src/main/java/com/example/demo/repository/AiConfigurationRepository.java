package com.example.demo.repository;

import com.example.demo.model.AiConfiguration;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface AiConfigurationRepository extends JpaRepository<AiConfiguration, Long> {
    
    Optional<AiConfiguration> findByIsActiveTrue();
    
    Optional<AiConfiguration> findFirstByOrderByCreatedAtDesc();
}



