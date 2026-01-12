# Chapter Segregation Guide

This guide explains how to segregate PDF pages into chapters using the enhanced chapter detection system.

## Overview

The system provides multiple methods for organizing pages into chapters:

1. **AI-Powered Detection** - Uses Gemini AI to intelligently detect chapter boundaries
2. **Manual Configuration** - Allows precise control over chapter organization
3. **Auto-Generation** - Creates chapters based on page count
4. **Heuristic Detection** - Fallback method using text analysis

## Method 1: AI-Powered Chapter Detection

### Automatic Detection
```javascript
// The AI automatically detects chapters during conversion
const options = {
  useAI: true,
  respectPageNumbers: true,
  minChapterLength: 1,
  maxChapters: 50
};

const result = await TextBasedConversionPipeline.convert(
  pdfFilePath,
  outputDir,
  jobId,
  options
);
```

### Manual AI Detection
```javascript
import { ChapterDetectionService } from './services/chapterDetectionService.js';

const chapters = await ChapterDetectionService.detectChapters(pages, {
  respectPageNumbers: true,
  minChapterLength: 2,
  maxChapters: 20
});

console.log(`Detected ${chapters.length} chapters:`);
chapters.forEach(chapter => {
  console.log(`- ${chapter.title}: Pages ${chapter.startPage}-${chapter.endPage} (confidence: ${chapter.confidence})`);
});
```

### What AI Looks For:
- **Chapter titles**: "Chapter 1", "Introduction", "Conclusion"
- **Font changes**: Larger fonts indicating headings
- **Page breaks**: Significant content gaps
- **Numbering patterns**: Sequential chapter numbering
- **Content themes**: Topic shifts

## Method 2: Manual Chapter Configuration

### Save Manual Configuration
```javascript
import { ChapterConfigService } from './services/chapterConfigService.js';

const chapterConfig = [
  {
    title: "Introduction",
    startPage: 1,
    endPage: 5
  },
  {
    title: "Chapter 1: Getting Started",
    startPage: 6,
    endPage: 20
  },
  {
    title: "Chapter 2: Advanced Topics",
    startPage: 21,
    endPage: 35
  },
  {
    title: "Conclusion",
    startPage: 36,
    endPage: 40
  }
];

await ChapterConfigService.saveChapterConfig('job_123', chapterConfig);
```

### Alternative Formats

**Using Page Ranges:**
```javascript
const chapterConfig = [
  { title: "Introduction", pageRange: "1-5" },
  { title: "Chapter 1", pageRange: "6-20" },
  { title: "Chapter 2", pageRange: "21-35" }
];
```

**Using Page Arrays:**
```javascript
const chapterConfig = [
  { title: "Introduction", pages: [1, 2, 3, 4, 5] },
  { title: "Chapter 1", pages: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] }
];
```

### Load and Apply Configuration
```javascript
// Load existing configuration
const config = await ChapterConfigService.loadChapterConfig('job_123');

// Apply to pages during conversion
const chapters = await ChapterConfigService.applyManualConfiguration(pages, 'job_123');
```

## Method 3: Auto-Generation

### Generate by Page Count
```javascript
// Generate chapters with 10 pages each
const config = ChapterConfigService.autoGenerateConfig(100, 10);

// Result: 10 chapters, each with 10 pages
console.log(config);
// [
//   { title: "Chapter 1", startPage: 1, endPage: 10 },
//   { title: "Chapter 2", startPage: 11, endPage: 20 },
//   ...
// ]
```

### Custom Auto-Generation
```javascript
// Generate chapters with varying sizes
const customConfig = [];
let currentPage = 1;

// Introduction (5 pages)
customConfig.push({
  title: "Introduction",
  startPage: currentPage,
  endPage: currentPage + 4
});
currentPage += 5;

// Main chapters (15 pages each)
for (let i = 1; i <= 5; i++) {
  customConfig.push({
    title: `Chapter ${i}`,
    startPage: currentPage,
    endPage: currentPage + 14
  });
  currentPage += 15;
}

// Conclusion (remaining pages)
customConfig.push({
  title: "Conclusion",
  startPage: currentPage,
  endPage: totalPages
});
```

## Method 4: API Usage

### Detect Chapters via API
```bash
# Auto-detect chapters for a job
curl -X GET "http://localhost:8081/api/chapters/detect/job_123?useAI=true&respectPageNumbers=true"
```

### Save Configuration via API
```bash
curl -X POST "http://localhost:8081/api/chapters/config/job_123" \
  -H "Content-Type: application/json" \
  -d '{
    "chapters": [
      {
        "title": "Introduction",
        "startPage": 1,
        "endPage": 5
      },
      {
        "title": "Chapter 1: Getting Started",
        "startPage": 6,
        "endPage": 20
      }
    ],
    "totalPages": 100
  }'
```

### Auto-Generate via API
```bash
curl -X POST "http://localhost:8081/api/chapters/auto-generate" \
  -H "Content-Type: application/json" \
  -d '{
    "totalPages": 100,
    "pagesPerChapter": 15,
    "documentId": "job_123"
  }'
```

## Frontend Integration

### Using the ChapterManager Component
```jsx
import ChapterManager from './components/ChapterManager';

function ConversionPage({ jobId, pdfId, totalPages }) {
  const handleChaptersChange = (chapters) => {
    console.log('Chapters updated:', chapters);
    // Update your state or trigger re-conversion
  };

  return (
    <div>
      <h2>PDF Conversion</h2>
      
      <ChapterManager
        jobId={jobId}
        pdfId={pdfId}
        totalPages={totalPages}
        onChaptersChange={handleChaptersChange}
      />
      
      {/* Other conversion controls */}
    </div>
  );
}
```

## Best Practices

### 1. Chapter Detection Strategy
```javascript
// Recommended approach: Try methods in order of preference
async function detectOptimalChapters(pages, jobId) {
  // 1. Try manual configuration first
  let chapters = await ChapterConfigService.applyManualConfiguration(pages, jobId);
  if (chapters) {
    console.log('Using manual configuration');
    return chapters;
  }
  
  // 2. Try AI detection
  try {
    chapters = await ChapterDetectionService.detectChapters(pages, { useAI: true });
    if (chapters.length > 1 && chapters.every(ch => ch.confidence > 0.7)) {
      console.log('Using AI detection');
      return chapters;
    }
  } catch (error) {
    console.warn('AI detection failed:', error.message);
  }
  
  // 3. Fallback to auto-generation
  const totalPages = pages.length;
  const pagesPerChapter = Math.max(5, Math.floor(totalPages / 10)); // 5-10 chapters max
  chapters = ChapterConfigService.autoGenerateConfig(totalPages, pagesPerChapter);
  console.log('Using auto-generation fallback');
  return chapters;
}
```

### 2. Validation
```javascript
// Always validate chapter configuration
const validation = ChapterConfigService.validateConfiguration(chapters, totalPages);

if (!validation.isValid) {
  console.error('Chapter validation failed:', validation.errors);
  // Handle errors or use fallback
}

if (validation.warnings.length > 0) {
  console.warn('Chapter validation warnings:', validation.warnings);
}

console.log(`Chapter coverage: ${validation.coverage.toFixed(1)}%`);
```

### 3. Chapter Naming
```javascript
// Smart chapter title extraction
function extractChapterTitle(page) {
  if (!page.textBlocks) return null;
  
  // Look for the first significant heading
  const headingBlock = page.textBlocks.find(block => 
    block.type === 'heading1' || 
    block.type === 'title' ||
    (block.fontSize && block.fontSize > 14)
  );
  
  if (headingBlock && headingBlock.text) {
    let title = headingBlock.text.trim();
    
    // Clean up common patterns
    title = title.replace(/^(chapter\s+\d+:?\s*)/i, ''); // Remove "Chapter 1:"
    title = title.replace(/^\d+\.\s*/, ''); // Remove "1. "
    
    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);
    
    // Limit length
    if (title.length > 80) {
      title = title.substring(0, 77) + '...';
    }
    
    return title;
  }
  
  return null;
}
```

## Common Use Cases

### Academic Papers
```javascript
// Typical academic paper structure
const academicChapters = [
  { title: "Abstract", pageRange: "1-1" },
  { title: "Introduction", pageRange: "2-5" },
  { title: "Literature Review", pageRange: "6-15" },
  { title: "Methodology", pageRange: "16-25" },
  { title: "Results", pageRange: "26-35" },
  { title: "Discussion", pageRange: "36-45" },
  { title: "Conclusion", pageRange: "46-50" },
  { title: "References", pageRange: "51-55" }
];
```

### Technical Manuals
```javascript
// Technical manual with numbered chapters
const manualChapters = [];
let currentPage = 1;

// Table of contents
manualChapters.push({
  title: "Table of Contents",
  startPage: currentPage,
  endPage: currentPage + 2
});
currentPage += 3;

// Numbered chapters
for (let i = 1; i <= 10; i++) {
  manualChapters.push({
    title: `${i}. Chapter ${i}`,
    startPage: currentPage,
    endPage: currentPage + 9
  });
  currentPage += 10;
}

// Appendices
manualChapters.push({
  title: "Appendices",
  startPage: currentPage,
  endPage: totalPages
});
```

### Books with Parts
```javascript
// Book with multiple parts and chapters
const bookStructure = [
  { title: "Preface", pageRange: "1-5" },
  { title: "Part I: Foundations", pageRange: "6-6" }, // Part divider
  { title: "Chapter 1: Introduction", pageRange: "7-20" },
  { title: "Chapter 2: Basics", pageRange: "21-35" },
  { title: "Part II: Advanced Topics", pageRange: "36-36" }, // Part divider
  { title: "Chapter 3: Advanced Concepts", pageRange: "37-55" },
  { title: "Chapter 4: Applications", pageRange: "56-75" },
  { title: "Conclusion", pageRange: "76-80" },
  { title: "Index", pageRange: "81-85" }
];
```

## Troubleshooting

### Common Issues

1. **AI Detection Fails**
   ```javascript
   // Fallback to heuristic detection
   const chapters = ChapterDetectionService.detectChaptersHeuristic(pages, {
     respectPageNumbers: true
   });
   ```

2. **Overlapping Chapters**
   ```javascript
   // Validate and fix overlaps
   const validation = ChapterConfigService.validateConfiguration(chapters, totalPages);
   if (validation.errors.some(e => e.includes('already assigned'))) {
     // Use auto-generation to fix
     chapters = ChapterConfigService.autoGenerateConfig(totalPages, 10);
   }
   ```

3. **Missing Pages**
   ```javascript
   // Ensure all pages are covered
   const coveredPages = new Set();
   chapters.forEach(ch => {
     for (let p = ch.startPage; p <= ch.endPage; p++) {
       coveredPages.add(p);
     }
   });
   
   const missingPages = [];
   for (let p = 1; p <= totalPages; p++) {
     if (!coveredPages.has(p)) {
       missingPages.push(p);
     }
   }
   
   if (missingPages.length > 0) {
     // Add missing pages to last chapter or create new chapter
     if (chapters.length > 0) {
       chapters[chapters.length - 1].endPage = totalPages;
     }
   }
   ```

## Configuration Examples

### Environment Variables
```bash
# Enable AI chapter detection
USE_AI_CHAPTER_DETECTION=true

# Default pages per chapter for auto-generation
DEFAULT_PAGES_PER_CHAPTER=10

# Maximum number of chapters
MAX_CHAPTERS_PER_DOCUMENT=50

# Minimum pages per chapter
MIN_PAGES_PER_CHAPTER=1
```

### Pipeline Configuration
```javascript
// Configure chapter detection in conversion pipeline
const pipelineOptions = {
  useAI: true,
  chapterDetection: {
    method: 'ai', // 'ai', 'manual', 'auto', 'heuristic'
    respectPageNumbers: true,
    minChapterLength: 2,
    maxChapters: 25,
    pagesPerChapter: 12, // for auto-generation
    aiPrompt: 'custom prompt for chapter detection' // optional
  }
};
```

This enhanced chapter segregation system provides flexible, intelligent ways to organize PDF pages into meaningful chapters, improving the reading experience and navigation in the generated EPUB files.