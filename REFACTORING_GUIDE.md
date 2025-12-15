# PDF to EPUB3 Text-Based Conversion - Refactoring Guide

## Problem Statement

The current application converts PDFs directly to image-only EPUB files, which:
- ❌ Breaks text selection
- ❌ Prevents word tracing during audio playback
- ❌ Makes audio synchronization impossible
- ❌ Creates non-accessible EPUBs

## Solution Architecture

### New Pipeline Flow

```
PDF Upload
  ↓
PDF Analysis (Text-based vs Scanned)
  ↓
Text Extraction (pdfjs-dist OR OCR)
  ↓
Document Structure Analysis (AI Classification)
  ↓
Semantic XHTML Generation (with unique IDs)
  ↓
EPUB3 Packaging (OPF, NAV, SMIL)
  ↓
TTS Audio Generation (per text block)
  ↓
SMIL Media Overlay Creation
  ↓
Final EPUB3 Output (Text-selectable, Audio-synced)
```

## Key Services Created

### 1. `pdfAnalysisService.js`
**Purpose**: Determines if PDF is text-based or scanned

**Methods**:
- `analyzePdf()` - Analyzes PDF using pdf-parse and pdfjs-dist operators
- `hasExtractableText()` - Quick check for extractable text

**Returns**:
```javascript
{
  isTextBased: boolean,
  confidence: number,
  textRatio: number,
  operatorRatio: number,
  metadata: Object
}
```

### 2. `textExtractionService.js`
**Purpose**: Extracts real text from PDFs (text-based or OCR)

**Methods**:
- `extractText()` - Main entry point
- `extractTextFromTextPdf()` - Uses pdfjs-dist for text PDFs
- `extractTextFromScannedPdf()` - Uses OCR for scanned PDFs
- `groupTextIntoBlocks()` - Groups text items into logical blocks

**Returns**:
```javascript
{
  pages: [
    {
      pageNumber: 1,
      textBlocks: [
        {
          text: "Block text",
          x: 100,
          y: 200,
          fontSize: 12,
          fontName: "Arial"
        }
      ]
    }
  ],
  metadata: Object
}
```

### 3. `documentStructureService.js`
**Purpose**: Classifies content into semantic elements

**Methods**:
- `analyzeStructure()` - Main entry point
- `analyzeStructureWithAI()` - Uses Gemini for classification
- `analyzeStructureHeuristic()` - Fallback heuristic method

**Classification Types**:
- `title` - Main document title
- `heading1`, `heading2`, `heading3` - Headings
- `paragraph` - Regular text
- `header`, `footer` - Page headers/footers
- `list_item` - List items
- `caption` - Image captions

### 4. `semanticXhtmlGenerator.js`
**Purpose**: Generates EPUB3-compliant XHTML with semantic tags

**Key Features**:
- Creates `<h1>`, `<h2>`, `<h3>`, `<p>`, `<li>` elements
- Assigns unique IDs to each text block (`p_1`, `h1_1`, etc.)
- Groups pages into chapters
- Generates semantic CSS

**Output**: XHTML files like:
```xhtml
<section epub:type="chapter">
  <h1 id="h1_1">Chapter Title</h1>
  <p id="p_1">Paragraph text...</p>
</section>
```

### 5. `epub3TextBasedGenerator.js`
**Purpose**: Packages complete EPUB3 with all required files

**Generates**:
- `content.opf` - Manifest and spine
- `nav.xhtml` - Navigation document
- `overlay.smil` - Media overlays for audio sync
- `styles.css` - Semantic styles
- `mimetype` - EPUB identifier
- `META-INF/container.xml` - Container file

### 6. `textBasedConversionPipeline.js`
**Purpose**: Orchestrates the entire conversion pipeline

**Usage**:
```javascript
const result = await TextBasedConversionPipeline.convert(
  pdfFilePath,
  outputDir,
  jobId,
  {
    generateAudio: true,
    useAI: true,
    ocrLang: 'eng'
  }
);
```

## Integration Steps

### Step 1: Update Conversion Service

Replace the image-based conversion in `conversionService.js`:

**OLD** (Image-based):
```javascript
const pageImagesData = await PdfExtractionService.renderPagesAsImages(...);
await generateFixedLayoutEpub(jobId, textData, structuredContent, pageImagesData, ...);
```

**NEW** (Text-based):
```javascript
const result = await TextBasedConversionPipeline.convert(
  pdfFilePath,
  epubOutputDir,
  jobId,
  {
    generateAudio: true,
    useAI: true
  }
);
```

### Step 2: Remove Image Rendering

Remove or disable:
- `PdfExtractionService.renderPagesAsImages()`
- `fixedLayoutEpubService.js`
- Image-based EPUB generation logic

### Step 3: Update Routes

The existing PDF upload route should work, but ensure it calls the new pipeline.

## Why Image-Only EPUB Breaks Audio Tracing

1. **No Text Elements**: Images contain no selectable text elements
2. **No IDs**: Without text elements, there are no IDs to map to audio
3. **SMIL Requires Text**: EPUB3 Media Overlays (SMIL) require XHTML text elements with IDs
4. **No Highlighting**: EPUB readers can't highlight text that doesn't exist

## SMIL Media Overlay Structure

```xml
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <seq epub:textref="chapter_1.xhtml">
      <par id="par_p_1">
        <text src="chapter_1.xhtml#p_1"/>
        <audio src="audio.mp3" clipBegin="0:00:00.000" clipEnd="0:00:05.500"/>
      </par>
      <par id="par_p_2">
        <text src="chapter_1.xhtml#p_2"/>
        <audio src="audio.mp3" clipBegin="0:00:05.500" clipEnd="0:00:10.200"/>
      </par>
    </seq>
  </body>
</smil>
```

## Testing Checklist

- [ ] PDF analysis correctly identifies text-based vs scanned
- [ ] Text extraction preserves reading order
- [ ] Document structure classification works
- [ ] XHTML has unique IDs for all text blocks
- [ ] EPUB3 validates with EPUBCheck
- [ ] Text is selectable in Readium/Thorium/Apple Books
- [ ] Audio highlighting works during playback
- [ ] SMIL files are correctly generated
- [ ] Navigation (TOC) works correctly

## Migration Path

1. **Phase 1**: Deploy new services alongside existing code
2. **Phase 2**: Add feature flag to switch between old/new pipeline
3. **Phase 3**: Test with sample PDFs
4. **Phase 4**: Switch default to new pipeline
5. **Phase 5**: Remove old image-based code

## File Structure

```
backend/src/services/
  ├── pdfAnalysisService.js          [NEW]
  ├── textExtractionService.js       [NEW]
  ├── documentStructureService.js    [NEW]
  ├── semanticXhtmlGenerator.js      [NEW]
  ├── epub3TextBasedGenerator.js     [NEW]
  ├── textBasedConversionPipeline.js [NEW]
  ├── conversionService.js            [MODIFY]
  └── pdfExtractionService.js        [KEEP for OCR, REMOVE renderPagesAsImages]
```

## Dependencies

All required dependencies are already installed:
- `pdf-parse` - PDF text extraction
- `pdfjs-dist` - Advanced PDF parsing
- `tesseract.js` - OCR for scanned PDFs
- `@google/generative-ai` - AI classification
- `xmlbuilder2` - XML generation
- `archiver` - EPUB packaging
- `jsdom` - XHTML generation

## Next Steps

1. Integrate `TextBasedConversionPipeline` into `conversionService.js`
2. Update conversion job status updates
3. Test with various PDF types
4. Validate EPUB3 output
5. Remove deprecated image-based code



