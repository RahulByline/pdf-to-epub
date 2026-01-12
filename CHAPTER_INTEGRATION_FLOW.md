# Chapter Segregation Integration in Conversion Process

This document shows exactly where and how chapter segregation is integrated into the PDF to EPUB conversion pipeline.

## Conversion Flow with Chapter Integration

```
📄 PDF Upload
    ↓
🔍 PDF Analysis (pdfAnalysisService.js)
    ├─→ Text-based PDF? → Extract with pdfjs-dist
    └─→ Scanned PDF? → Extract with OCR (Tesseract.js)
    ↓
📝 Text Extraction (textExtractionService.js)
    ├─→ Preserves reading order
    ├─→ Captures font size, position
    └─→ Groups into logical blocks
    ↓
🏗️ Document Structure Analysis (documentStructureService.js)
    ├─→ AI Classification (Gemini) OR
    └─→ Heuristic Classification
    ├─→ Classifies: title, headings, paragraphs, headers, footers
    ↓
📚 CHAPTER SEGREGATION (NEW!)
    ├─→ ChapterDetectionService.detectChapters()
    ├─→ ChapterConfigService.applyManualConfiguration()
    └─→ SemanticXhtmlGenerator.detectChapters()
    ↓
📖 XHTML Generation (semanticXhtmlGenerator.js)
    ├─→ Creates chapter-based XHTML files
    ├─→ Assigns unique IDs per chapter
    └─→ Preserves PDF styling per chapter
    ↓
📦 EPUB3 Packaging (epub3TextBasedGenerator.js)
    ├─→ Generates content.opf with chapter manifest
    ├─→ Generates nav.xhtml with chapter TOC
    ├─→ Generates SMIL with chapter-based audio sync
    └─→ Creates META-INF/container.xml
    ↓
🎵 TTS Audio Generation (Optional)
    ├─→ Generates audio per chapter
    └─→ Creates chapter-based timing mappings
    ↓
📱 Final EPUB3 Output
    ├─→ Chapters are navigable
    ├─→ Audio syncs per chapter
    └─→ Text is selectable per chapter
```

## Integration Points

### 1. **Text-Based Conversion Pipeline** (`textBasedConversionPipeline.js`)

**Location**: Step 5 - EPUB3 Generation
```javascript
// Step 5: Generate EPUB3
console.log(`[Pipeline ${jobId}] Step 5: Generating EPUB3 package...`);
const epubGenerator = new Epub3TextBasedGenerator(outputDir, jobId);

// Pass chapter detection options to the generator
const chapterOptions = {
  documentId: jobId,           // 🔑 Used for manual config lookup
  useAI: options.useAI !== false,
  respectPageNumbers: options.respectPageNumbers !== false,
  minChapterLength: options.minChapterLength || 1,
  maxChapters: options.maxChapters || 50
};

const epubPath = await epubGenerator.generate(
  structure.pages,
  audioFilePath,
  audioMappings,
  chapterOptions              // 🔑 Chapter options passed here
);
```

### 2. **Semantic XHTML Generator** (`semanticXhtmlGenerator.js`)

**Location**: `generatePages()` method
```javascript
async generatePages(structuredPages, outputDir, options = {}) {
  // ... existing code ...
  
  // 🔑 CHAPTER DETECTION HAPPENS HERE
  const chapters = await this.detectChapters(structuredPages, options);
  
  // 🔑 GENERATE XHTML FILES PER CHAPTER (NOT PER PAGE)
  for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
    const chapter = chapters[chapterIdx];
    this.chapterCounter++;
    
    const chapterId = `chapter_${this.chapterCounter}`;
    const fileName = `${chapterId}.xhtml`;
    const filePath = path.join(outputDir, fileName);
    
    // Generate XHTML for this chapter (multiple pages combined)
    const xhtmlContent = await this.generateChapterXhtml(chapter, chapterId, outputDir);
    
    await fs.writeFile(filePath, xhtmlContent, 'utf-8');
    
    pages.push({
      id: chapterId,
      href: fileName,
      title: chapter.title || `Chapter ${this.chapterCounter}`,
      pageNumbers: chapter.pages.map(p => p.pageNumber), // 🔑 Track original pages
      confidence: chapter.confidence || 0.8,
      detectionMethod: chapter.reason || 'automatic'
    });
  }
  
  return pages; // 🔑 Returns chapters, not individual pages
}
```

**Chapter Detection Priority**:
```javascript
async detectChapters(pages, options = {}) {
  const documentId = options.documentId || options.jobId;
  
  // 1️⃣ Try manual configuration first (highest priority)
  if (documentId) {
    const manualChapters = await ChapterConfigService.applyManualConfiguration(pages, documentId);
    if (manualChapters && manualChapters.length > 0) {
      console.log(`Using manual chapter configuration: ${manualChapters.length} chapters`);
      return manualChapters;
    }
  }
  
  // 2️⃣ Try AI-powered detection (if enabled)
  if (options.useAI !== false) {
    try {
      const aiChapters = await ChapterDetectionService.detectChapters(pages, options);
      if (aiChapters && aiChapters.length > 0) {
        console.log(`Using AI chapter detection: ${aiChapters.length} chapters`);
        return aiChapters;
      }
    } catch (error) {
      console.warn('AI chapter detection failed:', error.message);
    }
  }
  
  // 3️⃣ Fallback to original heuristic method
  console.log('Using fallback heuristic chapter detection');
  return this.groupIntoChapters(pages);
}
```

### 3. **EPUB3 Generator** (`epub3TextBasedGenerator.js`)

**Location**: `generate()` method
```javascript
async generate(structuredPages, audioFilePath = null, audioMappings = [], chapterOptions = {}) {
  // ... existing code ...
  
  // 🔑 CHAPTER OPTIONS PASSED TO XHTML GENERATOR
  this.pages = await xhtmlGenerator.generatePages(structuredPages, oebpsDir, {
    pdfFilePath: structuredPages[0]?.pdfFilePath || null,
    useAI: chapterOptions.useAI !== false,
    documentId: chapterOptions.documentId,        // 🔑 For manual config lookup
    respectPageNumbers: chapterOptions.respectPageNumbers,
    minChapterLength: chapterOptions.minChapterLength,
    maxChapters: chapterOptions.maxChapters
  });
  
  // ... rest of EPUB generation uses chapter-based pages ...
}
```

**Navigation Generation** (uses chapters):
```javascript
async generateNAV() {
  // ... create nav structure ...
  
  // 🔑 CHAPTERS BECOME TOC ENTRIES
  this.pages.forEach(page => {  // 'pages' are actually chapters now
    const li = doc.createElement('li');
    const a = doc.createElement('a');
    a.setAttribute('href', page.href);
    a.textContent = page.title;    // 🔑 Chapter title in TOC
    li.appendChild(a);
    ol.appendChild(li);
  });
  
  // ... save nav.xhtml ...
}
```

**OPF Manifest Generation** (uses chapters):
```javascript
async generateOPF(audioFileName = null) {
  // ... create OPF structure ...
  
  // 🔑 ADD CHAPTER XHTML FILES TO MANIFEST
  this.pages.forEach(page => {  // 'pages' are actually chapters
    manifest.ele('item', {
      id: page.id,                // chapter_1, chapter_2, etc.
      href: page.href,            // chapter_1.xhtml, chapter_2.xhtml, etc.
      'media-type': 'application/xhtml+xml',
      properties: audioFileName && this.audioMappings.length > 0 ? 'media:overlay' : undefined
    });
  });
  
  // 🔑 SPINE USES CHAPTERS (NOT INDIVIDUAL PAGES)
  const spine = packageEl.ele('spine', { toc: 'nav' });
  this.pages.forEach(page => {  // 'pages' are actually chapters
    spine.ele('itemref', { idref: page.id });
  });
  
  // ... save content.opf ...
}
```

## How Chapters Transform the Output

### **Before Chapter Segregation** (Page-based):
```
EPUB Structure:
├── page_1.xhtml    (1 page = 1 file)
├── page_2.xhtml
├── page_3.xhtml
├── ...
└── page_50.xhtml

Navigation:
- Page 1
- Page 2  
- Page 3
- ...
- Page 50
```

### **After Chapter Segregation** (Chapter-based):
```
EPUB Structure:
├── chapter_1.xhtml  (Multiple pages combined)
├── chapter_2.xhtml
├── chapter_3.xhtml
└── chapter_4.xhtml

Navigation:
- Introduction (Pages 1-5)
- Chapter 1: Getting Started (Pages 6-20)
- Chapter 2: Advanced Topics (Pages 21-35)
- Conclusion (Pages 36-50)
```

## Configuration Options

### **Environment Variables**
```bash
# Enable AI chapter detection
USE_AI_CHAPTER_DETECTION=true

# Default settings
DEFAULT_PAGES_PER_CHAPTER=10
MAX_CHAPTERS_PER_DOCUMENT=50
MIN_PAGES_PER_CHAPTER=1
```

### **Pipeline Options**
```javascript
const pipelineOptions = {
  useAI: true,                    // Enable AI detection
  respectPageNumbers: true,       // Consider page breaks
  minChapterLength: 2,           // Minimum pages per chapter
  maxChapters: 25,               // Maximum chapters
  documentId: jobId              // For manual config lookup
};

const result = await TextBasedConversionPipeline.convert(
  pdfFilePath,
  outputDir, 
  jobId,
  pipelineOptions
);
```

### **Manual Configuration** (Highest Priority)
```javascript
// Save manual configuration
const chapterConfig = [
  { title: "Introduction", startPage: 1, endPage: 5 },
  { title: "Chapter 1", startPage: 6, endPage: 20 },
  { title: "Chapter 2", startPage: 21, endPage: 35 },
  { title: "Conclusion", startPage: 36, endPage: 50 }
];

await ChapterConfigService.saveChapterConfig(jobId, chapterConfig);

// This will be automatically used in the next conversion
```

## API Integration

### **Frontend Usage**
```javascript
// Configure chapters before conversion
const chapterConfig = await fetch('/api/chapters/detect/job_123?useAI=true');
const chapters = await chapterConfig.json();

// Optionally modify and save
await fetch('/api/chapters/config/job_123', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chapters: chapters.chapters, totalPages: 50 })
});

// Start conversion (will use saved configuration)
await fetch('/api/conversions/start/pdf_123', { method: 'POST' });
```

### **Backend Routes**
```javascript
// Chapter detection
GET /api/chapters/detect/:jobId

// Manual configuration
POST /api/chapters/config/:documentId
GET /api/chapters/config/:documentId
DELETE /api/chapters/config/:documentId

// Auto-generation
POST /api/chapters/auto-generate

// Validation
POST /api/chapters/validate
```

## Impact on EPUB Features

### **1. Navigation**
- ✅ **Before**: 50 page entries in TOC
- ✅ **After**: 4 meaningful chapter entries in TOC

### **2. Audio Synchronization**
- ✅ **Before**: Audio mapped to individual pages
- ✅ **After**: Audio mapped to chapters with proper text highlighting

### **3. Reading Experience**
- ✅ **Before**: Users navigate page by page
- ✅ **After**: Users navigate chapter by chapter (natural reading flow)

### **4. File Size**
- ✅ **Before**: 50 small XHTML files
- ✅ **After**: 4 larger, more meaningful XHTML files

### **5. Accessibility**
- ✅ **Before**: Screen readers announce "Page 1", "Page 2"
- ✅ **After**: Screen readers announce "Introduction", "Chapter 1"

## Testing the Integration

### **1. Test Chapter Detection**
```bash
# Test the detection algorithms
node backend/tests/test-chapter-detection.js
```

### **2. Test API Integration**
```bash
# Test the REST API endpoints
node backend/tests/test-api-endpoints.js
```

### **3. Test Full Pipeline**
```bash
# Upload a PDF and check the generated EPUB structure
# Look for chapter_*.xhtml files instead of page_*.xhtml files
```

### **4. Verify EPUB Output**
```bash
# Extract the EPUB and check:
unzip converted_job_123.epub
ls OEBPS/
# Should see: chapter_1.xhtml, chapter_2.xhtml, etc.

# Check navigation
cat OEBPS/nav.xhtml
# Should see chapter titles, not page numbers
```

The chapter segregation system is fully integrated into the conversion pipeline and transforms the entire EPUB structure from page-based to chapter-based, providing a much better reading experience!