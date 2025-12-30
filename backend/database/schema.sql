-- Create database
CREATE DATABASE IF NOT EXISTS epub_db;
USE epub_db;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PDF Documents table
CREATE TABLE IF NOT EXISTS pdf_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(500) NOT NULL,
    original_file_name VARCHAR(500) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,
    file_size BIGINT NOT NULL,
    total_pages INT NOT NULL,
    document_type ENUM('TEXTBOOK', 'WORKBOOK', 'TEACHER_GUIDE', 'ASSESSMENT', 'REFERENCE_MATERIAL', 'OTHER'),
    page_quality ENUM('SCANNED', 'DIGITAL_NATIVE', 'MIXED'),
    has_tables BOOLEAN DEFAULT FALSE,
    has_formulas BOOLEAN DEFAULT FALSE,
    has_multi_column BOOLEAN DEFAULT FALSE,
    scanned_pages_count INT DEFAULT 0,
    digital_pages_count INT DEFAULT 0,
    analysis_metadata TEXT,
    zip_file_name VARCHAR(500),
    zip_file_group_id VARCHAR(255),
    audio_file_path VARCHAR(1000),
    audio_file_name VARCHAR(500),
    audio_synced BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_zip_group (zip_file_group_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PDF Languages table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS pdf_languages (
    pdf_document_id BIGINT NOT NULL,
    language VARCHAR(50) NOT NULL,
    PRIMARY KEY (pdf_document_id, language),
    FOREIGN KEY (pdf_document_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
    INDEX idx_language (language)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Conversion Jobs table
CREATE TABLE IF NOT EXISTS conversion_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pdf_document_id BIGINT NOT NULL,
    status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    current_step ENUM('STEP_0_CLASSIFICATION', 'STEP_1_TEXT_EXTRACTION', 'STEP_2_LAYOUT_ANALYSIS', 
                      'STEP_3_SEMANTIC_STRUCTURING', 'STEP_4_ACCESSIBILITY', 'STEP_5_CONTENT_CLEANUP',
                      'STEP_6_SPECIAL_CONTENT', 'STEP_7_EPUB_GENERATION', 'STEP_8_QA_REVIEW'),
    progress_percentage INT DEFAULT 0,
    epub_file_path VARCHAR(1000),
    error_message TEXT,
    intermediate_data LONGTEXT,
    confidence_score DOUBLE,
    requires_review BOOLEAN DEFAULT FALSE,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (pdf_document_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
    INDEX idx_pdf_document_id (pdf_document_id),
    INDEX idx_status (status),
    INDEX idx_requires_review (requires_review),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Configurations table
CREATE TABLE IF NOT EXISTS ai_configurations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    api_key VARCHAR(500) NOT NULL,
    model_name VARCHAR(100) NOT NULL DEFAULT 'gemini-pro',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audio Syncs table
CREATE TABLE IF NOT EXISTS audio_syncs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pdf_document_id BIGINT NOT NULL,
    conversion_job_id BIGINT NOT NULL,
    page_number INT NOT NULL,
    block_id VARCHAR(255),
    start_time DOUBLE NOT NULL,
    end_time DOUBLE NOT NULL,
    audio_file_path VARCHAR(1000) NOT NULL,
    notes TEXT,
    custom_text TEXT,
    is_custom_segment BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pdf_document_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (conversion_job_id) REFERENCES conversion_jobs(id) ON DELETE CASCADE,
    INDEX idx_pdf_document_id (pdf_document_id),
    INDEX idx_conversion_job_id (conversion_job_id),
    INDEX idx_page_number (page_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;







