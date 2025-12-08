# Java to Node.js Porting Plan

## Current Status
✅ Fixed XML null character error in text extraction
✅ Basic PDF text extraction implemented
✅ Basic EPUB generation implemented  
✅ Gemini AI integration started

## What Needs to Be Ported

### 1. Core Conversion Services (8-Step Pipeline)

#### Step 1: Text Extraction & OCR ✅ (Partially Done)
- [x] Basic text extraction with pdf-parse
- [ ] Text extraction with positioning (like PDFBox PositionAwareTextStripper)
- [ ] Group text positions into blocks
- [ ] Extract images with coordinates
- [ ] OCR support for scanned pages (Tesseract.js)

#### Step 2: Layout Analysis
- [ ] Detect headings hierarchy (H1-H6)
- [ ] Detect paragraphs vs lists
- [ ] Detect multi-column layouts
- [ ] Detect tables structure
- [ ] Detect figures with captions
- [ ] Two-page spread detection

#### Step 3: Semantic Structuring
- [ ] Identify learning objectives
- [ ] Identify glossary terms
- [ ] Identify exercises/answers
- [ ] Identify examples, notes, tips
- [ ] Build table of contents
- [ ] Create internal linking

#### Step 4: Accessibility
- [ ] Generate alt text for images (AI-powered)
- [ ] Add ARIA roles
- [ ] Ensure reading order
- [ ] Check color-only meanings

#### Step 5: Content Cleanup
- [ ] Fix OCR errors (already started with Gemini)
- [ ] Normalize quotes, dashes
- [ ] Normalize spacing
- [ ] Convert numbered lists to HTML lists

#### Step 6: Math & Tables
- [ ] Detect equations (inline/display)
- [ ] Convert to MathML
- [ ] Detect table boundaries
- [ ] Convert to HTML tables

#### Step 7: EPUB Generation ✅ (Basic Done)
- [x] Basic EPUB structure
- [ ] Full EPUB3 with proper semantics
- [ ] Fixed-layout support
- [ ] Audio sync support (SMIL files)
- [ ] CSS styling

#### Step 8: QA & Review
- [ ] Confidence scoring
- [ ] Review flags
- [ ] Intermediate data storage

### 2. Supporting Services

- [ ] AudioSyncService (KITABOO-style)
- [ ] TTSService (text-to-speech)
- [ ] AudioAnalysisService
- [ ] TextSegmentationService (OpenNLP equivalent)

### 3. Data Models

Need to create JavaScript equivalents of:
- DocumentStructure
- PageStructure  
- TextBlock (with all properties)
- ImageBlock
- TableBlock
- BoundingBox
- ReadingOrder
- etc.

## Key Libraries Needed

- ✅ pdf-parse (text extraction)
- ✅ pdf-lib (PDF manipulation)
- ✅ jszip (EPUB generation)
- ✅ @google/generative-ai (Gemini AI)
- [ ] pdf.js (better positioning extraction) OR pdf2json
- [ ] tesseract.js (OCR)
- [ ] natural (NLP for segmentation)
- [ ] mathml (MathML generation)

## Next Steps Priority

1. **High Priority** - Fix null character error ✅
2. **High Priority** - Improve text extraction with positioning
3. **High Priority** - Port LayoutAnalysisService
4. **High Priority** - Port SemanticStructuringService  
5. **Medium Priority** - Port ContentCleanupService
6. **Medium Priority** - Port AccessibilityService
7. **Low Priority** - Math & Tables (can be simplified)
8. **Low Priority** - Audio sync (can be added later)

## Implementation Strategy

For each service:
1. Read Java implementation
2. Understand algorithm/logic
3. Port to Node.js with equivalent libraries
4. Test with sample PDFs
5. Integrate into conversion pipeline

