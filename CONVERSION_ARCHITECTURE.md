# PDF to EPUB3 Conversion System Architecture

## Overview

This system implements a comprehensive 8-step pipeline for converting PDF documents (especially educational content) into EPUB3 format with full accessibility support, semantic structuring, and quality assurance.

## Architecture Components

### 1. Core Services (Step-by-Step Processing)

#### Step 0: Ingestion & Classification
- **Service**: `PdfAnalysisService` (already implemented)
- **Function**: Analyzes uploaded PDFs to identify:
  - Document type (textbook, workbook, teacher guide, etc.)
  - Language(s)
  - Page quality (scanned vs digital-native)
  - Complex elements (tables, formulas, multi-column layouts)

#### Step 1: Text Extraction & OCR
- **Services**: 
  - `TextExtractionService`: Extracts text, fonts, positions from digital PDFs
  - `OcrService`: Performs ML-based OCR for scanned PDFs using Tesseract
- **Output**: Document structure with text blocks, coordinates, reading order markers

#### Step 2: Layout & Structure Understanding
- **Service**: `LayoutAnalysisService`
- **Function**: Infers document structure:
  - Headings hierarchy (H1, H2, H3...)
  - Paragraphs vs lists (ordered/unordered)
  - Sidebars, callouts, questions, exercises
  - Headers/footers exclusion
  - Reading order in multi-column layouts
  - Tables (cells, headers)
  - Figures with captions

#### Step 3: Semantic & Educational Structuring
- **Service**: `SemanticStructuringService`
- **Function**: Identifies semantic entities:
  - Learning objectives
  - Key terms / glossary entries
  - Exercises and answers
  - Examples, Notes, Tips, Warnings
  - Chapter/section boundaries
  - Builds structured table of contents
  - Creates internal linking

#### Step 4: Accessibility & Alt Text
- **Service**: `AccessibilityService`
- **Function**: 
  - Generates alt text for images/figures
  - Adds ARIA roles and semantic tags
  - Ensures reading order for screen readers
  - Checks color-only meanings

#### Step 5: Content Cleanup & Normalization
- **Service**: `ContentCleanupService`
- **Function**:
  - Fixes common OCR errors
  - Normalizes quotes, dashes, bullet characters
  - Normalizes spacing and line breaks
  - Converts numbered lists to proper HTML lists
  - Applies style rules (UK vs US English, etc.)

#### Step 6: Math, Tables & Special Content
- **Service**: `MathAndTablesService`
- **Function**:
  - Detects equations (inline and display)
  - Converts to MathML or LaTeX
  - Detects table boundaries and cell structure
  - Converts to semantic HTML tables
  - Identifies special widgets ("Try it yourself", etc.)

#### Step 7: EPUB3 Generation
- **Service**: `EpubGenerationService`
- **Function**: 
  - Generates XHTML content files with proper semantics
  - Creates nav.xhtml and spine
  - Generates content.opf with metadata
  - Bundles images, CSS, fonts
  - Runs validation

#### Step 8: QA & Human-in-the-loop Review
- **Service**: `ConversionOrchestrationService` (confidence scoring)
- **Function**:
  - Calculates confidence scores
  - Flags low-confidence areas for review
  - Provides review endpoints

### 2. Workflow Orchestration

#### ConversionOrchestrationService
- Manages the complete conversion pipeline
- Handles async processing
- Tracks progress through each step
- Saves intermediate data for review
- Calculates confidence scores

### 3. Data Models

#### ConversionJob
- Tracks conversion status and progress
- Stores intermediate data (JSON)
- Manages review workflow
- Links to PDF document and generated EPUB

#### DocumentStructure
- Complete document representation with:
  - Pages with text blocks, images, tables
  - Table of contents
  - Metadata
  - Semantic blocks
  - Math equations
  - Reading order

### 4. API Endpoints

#### Conversion Management
- `POST /api/conversions/start/{pdfDocumentId}` - Start conversion
- `GET /api/conversions/{jobId}` - Get conversion status
- `GET /api/conversions/pdf/{pdfDocumentId}` - Get all conversions for a PDF
- `GET /api/conversions/status/{status}` - Get conversions by status
- `GET /api/conversions/review-required` - Get jobs requiring review
- `GET /api/conversions/{jobId}/intermediate-data` - Get intermediate structure
- `PUT /api/conversions/{jobId}/review` - Mark as reviewed

## Workflow Flow

```
1. User uploads PDF → PdfController
2. PDF analyzed → PdfAnalysisService (Step 0)
3. User starts conversion → ConversionController
4. Conversion job created → ConversionOrchestrationService
5. Async processing begins:
   - Step 1: Text Extraction/OCR
   - Step 2: Layout Analysis
   - Step 3: Semantic Structuring
   - Step 4: Accessibility Enhancement
   - Step 5: Content Cleanup
   - Step 6: Math & Tables Processing
   - Step 7: EPUB Generation
   - Step 8: QA & Confidence Scoring
6. Job status updated in database
7. EPUB file available for download
8. Low-confidence jobs flagged for review
```

## Configuration

### application.properties
```properties
# File Upload
file.upload.dir=uploads
spring.servlet.multipart.max-file-size=50MB

# EPUB Output
epub.output.dir=epub_output

# Async Processing
spring.task.execution.pool.core-size=5
spring.task.execution.pool.max-size=10
spring.task.execution.pool.queue-capacity=100
```

## Dependencies

- **Apache PDFBox 3.0.0**: PDF processing and text extraction
- **Tesseract OCR (Tess4J 5.8.0)**: OCR for scanned PDFs
- **EPUBLib 3.1**: EPUB3 generation
- **Language Detector 0.6**: Language detection
- **Spring Boot WebFlux**: Async processing support
- **Jackson**: JSON processing for intermediate data
- **JSoup**: HTML processing

## Future Enhancements

1. **ML-Based Classification**: Replace keyword-based document type detection with ML models
2. **Advanced OCR**: Integrate cloud OCR services (Google Vision, AWS Textract)
3. **Layout Analysis**: Use document AI models (Google Document AI, Azure Form Recognizer)
4. **Image Description**: ML-based alt text generation for images
5. **Math Recognition**: Advanced math equation recognition and conversion
6. **Review UI**: Web-based side-by-side PDF/EPUB preview editor
7. **Feedback Loop**: Collect review corrections to improve models
8. **Parallel Processing**: Process multiple pages in parallel
9. **Caching**: Cache intermediate results for faster reprocessing
10. **Monitoring**: Track conversion metrics, error rates, operator productivity

## Testing

### Start Conversion
```bash
curl -X POST http://localhost:8081/api/conversions/start/1
```

### Check Status
```bash
curl http://localhost:8081/api/conversions/1
```

### Get Review Required Jobs
```bash
curl http://localhost:8081/api/conversions/review-required
```

## Notes

- Tesseract OCR requires installation and tessdata files
- EPUB generation uses EPUBLib which may need updates for full EPUB3 compliance
- Some services use simplified algorithms - production would use ML models
- Intermediate data is stored as JSON in the database for review
- All conversions run asynchronously to avoid blocking

