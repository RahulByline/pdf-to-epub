# TOC-First Chapter Detection Approach

This document explains the **TOC-First approach** for intelligent chapter detection in the PDF to EPUB conversion process.

## Overview

Instead of trying to detect chapters after generating all XHTML pages, this approach:

1. **Step A**: Extracts the Table of Contents (TOC) **first** using Gemini AI
2. **Step B**: Uses the TOC mapping to intelligently group pages into chapters during conversion

## How It Works

### **Step A: Pre-Extraction (TOC Analysis)**

```javascript
// Before converting pages, analyze first few pages for TOC
const tocMapping = await this.extractTableOfContents(pageImages, jobId);

// Example result:
{
  "Introduction": 3,
  "If You Were a Horse": 4,
  "All About Horses": 7,
  "Horse Care": 12,
  "Conclusion": 18
}
```

**What Gemini looks for:**
- Title indicators: "Table of Contents", "Contents", "Index"
- Chapter/section titles with page numbers
- Dotted lines connecting titles to pages
- Sequential page numbering patterns

### **Step B: Intelligent Grouping**

```javascript
// Use TOC mapping to group pages logically
if (tocMapping) {
  // Chapter 1: "Introduction" = pages 3-3 (1 page)
  // Chapter 2: "If You Were a Horse" = pages 4-6 (3 pages)  
  // Chapter 3: "All About Horses" = pages 7-11 (5 pages)
  // Chapter 4: "Horse Care" = pages 12-17 (6 pages)
  // Chapter 5: "Conclusion" = pages 18-end (remaining pages)
  
  const chapterPages = await this.groupPagesUsingTocMapping(xhtmlPages, tocMapping, jobId);
}
```

## Configuration

### **Enable TOC-First Approach**

Add to your `.env` file:

```bash
# Enable chapter segregation
USE_CHAPTER_SEGREGATION=true

# Enable TOC extraction (recommended)
USE_TOC_EXTRACTION=true

# AI settings for TOC extraction
USE_AI_CHAPTER_DETECTION=true
GEMINI_API_KEY=your_gemini_api_key_here
```

### **Disable TOC Extraction** (fallback to other methods)

```bash
USE_TOC_EXTRACTION=false
```

## Conversion Flow

### **Complete Flow with TOC-First**

```
1. PDF → PNG Images (all pages)
2. TOC Extraction (first 5 pages only)
   ├─→ Page 1: Check for TOC → Not found
   ├─→ Page 2: Check for TOC → Found! Extract mapping
   └─→ Result: {"Introduction": 3, "Chapter 1": 4, "Chapter 2": 7}
3. XHTML Generation (all pages)
   ├─→ page_1.xhtml, page_2.xhtml, page_3.xhtml...
4. TOC-Based Grouping
   ├─→ Use TOC mapping to group pages
   ├─→ Chapter 1: pages 3-3 → chapter_1.xhtml
   ├─→ Chapter 2: pages 4-6 → chapter_2.xhtml  
   └─→ Chapter 3: pages 7-end → chapter_3.xhtml
5. EPUB Generation (chapter-based files)
```

### **Fallback Flow (if TOC not found)**

```
1. PDF → PNG Images
2. TOC Extraction → No TOC found
3. XHTML Generation
4. Fallback Detection Methods:
   ├─→ Manual Configuration (if saved)
   ├─→ AI Content Analysis
   └─→ Heuristic Detection (page intervals)
5. EPUB Generation
```

## TOC Extraction Details

### **Gemini AI Prompt**

The system sends each of the first 5 pages to Gemini with this instruction:

```
"Analyze this image to determine if it contains a Table of Contents (TOC).

If this IS a Table of Contents page:
- Extract ONLY the chapter/section titles and their corresponding START page numbers
- Return a JSON object mapping chapter titles to page numbers

If this is NOT a Table of Contents page:
- Return exactly: null"
```

### **Example TOC Recognition**

**Input Image Content:**
```
Table of Contents

Introduction ........................ 3
Chapter 1: Getting Started .......... 7  
Chapter 2: Advanced Topics .......... 15
Conclusion .......................... 25
```

**Gemini Response:**
```json
{
  "Introduction": 3,
  "Chapter 1: Getting Started": 7,
  "Chapter 2: Advanced Topics": 15,
  "Conclusion": 25
}
```

### **Page Grouping Logic**

```javascript
// Chapter boundaries are determined by TOC start pages
const chapters = [
  {
    title: "Introduction",
    startPage: 3,
    endPage: 6,        // Until next chapter starts
    pages: [page3]     // Pages 3-6
  },
  {
    title: "Chapter 1: Getting Started", 
    startPage: 7,
    endPage: 14,       // Until next chapter starts
    pages: [page7, page8, ..., page14]
  },
  {
    title: "Chapter 2: Advanced Topics",
    startPage: 15,
    endPage: 24,       // Until next chapter starts  
    pages: [page15, page16, ..., page24]
  },
  {
    title: "Conclusion",
    startPage: 25,
    endPage: 30,       // Until end of document
    pages: [page25, page26, ..., page30]
  }
];
```

## Benefits of TOC-First Approach

### **Accuracy**
- ✅ **Exact chapter titles** from the actual TOC
- ✅ **Precise page boundaries** as intended by the author
- ✅ **No guesswork** about chapter structure

### **Performance**  
- ✅ **Fast TOC extraction** (only 1-5 pages analyzed)
- ✅ **Efficient grouping** (no complex content analysis needed)
- ✅ **Reliable results** (based on document's own structure)

### **User Experience**
- ✅ **Meaningful navigation** with real chapter titles
- ✅ **Logical reading flow** following document structure
- ✅ **Professional appearance** matching original document

## Comparison: TOC-First vs Post-Processing

### **TOC-First Approach** (New):
```
Speed: ⚡ Fast (analyze 1-5 pages for TOC)
Accuracy: 🎯 High (uses document's own structure)
Titles: 📖 Exact (from actual TOC)
Boundaries: ✅ Precise (author-intended)
```

### **Post-Processing Approach** (Previous):
```  
Speed: 🐌 Slower (analyze all pages)
Accuracy: 🎲 Variable (depends on content analysis)
Titles: 🤖 Generated (AI-guessed or generic)
Boundaries: ❓ Approximate (heuristic-based)
```

## Error Handling & Fallbacks

### **TOC Not Found**
```javascript
if (!tocMapping) {
  console.log('No TOC found, using fallback detection...');
  // Falls back to existing detection methods:
  // 1. Manual configuration
  // 2. AI content analysis  
  // 3. Heuristic detection
}
```

### **Invalid TOC Structure**
```javascript
// Validates TOC response:
if (typeof tocMapping === 'object' && tocMapping !== null) {
  const validMapping = {};
  for (const [title, pageNum] of Object.entries(tocMapping)) {
    if (typeof title === 'string' && !isNaN(parseInt(pageNum))) {
      validMapping[title.trim()] = parseInt(pageNum);
    }
  }
  return validMapping;
}
```

### **Missing Pages**
```javascript
// Handles pages not covered by TOC:
const uncoveredPages = xhtmlPages.filter(page => !coveredPageNumbers.has(page.pageNumber));
if (uncoveredPages.length > 0) {
  // Add to last chapter or create new chapter
  lastChapter.pages.push(...uncoveredPages);
}
```

## Testing

### **Test TOC Extraction**

1. **Upload a PDF with a clear TOC** (like a textbook or manual)
2. **Enable TOC extraction**:
   ```bash
   USE_TOC_EXTRACTION=true
   USE_CHAPTER_SEGREGATION=true
   ```
3. **Check the logs** for TOC extraction results:
   ```
   [Job 123] Extracting Table of Contents for intelligent chapter detection...
   [Job 123] TOC found on page 2: {"Introduction": 3, "Chapter 1": 7}
   [Job 123] Using TOC mapping for chapter organization...
   ```

### **Test Fallback Behavior**

1. **Upload a PDF without a TOC** (like a simple document)
2. **Check that fallback methods are used**:
   ```
   [Job 123] No TOC found or extraction failed, will use fallback detection
   [Job 123] TOC mapping not available, using fallback detection...
   ```

### **Verify Chapter Output**

1. **Extract the generated EPUB**:
   ```bash
   unzip converted_job_123.epub
   ls OEBPS/
   ```
2. **Should see chapter files with TOC-based names**:
   ```
   chapter_1.xhtml  # "Introduction"
   chapter_2.xhtml  # "Chapter 1: Getting Started"  
   chapter_3.xhtml  # "Chapter 2: Advanced Topics"
   ```
3. **Check navigation**:
   ```bash
   cat OEBPS/nav.xhtml
   # Should show exact TOC titles
   ```

## Configuration Summary

```bash
# .env settings for TOC-First approach

# Enable chapter segregation
USE_CHAPTER_SEGREGATION=true

# Enable TOC extraction (recommended)
USE_TOC_EXTRACTION=true

# AI settings (required for TOC extraction)
USE_AI_CHAPTER_DETECTION=true
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_API_MODEL=gemini-2.5-flash

# Fallback settings (used if TOC not found)
DEFAULT_PAGES_PER_CHAPTER=10
MAX_CHAPTERS_PER_DOCUMENT=50
MIN_PAGES_PER_CHAPTER=1
```

The TOC-First approach provides the most accurate and user-friendly chapter detection by leveraging the document's own Table of Contents structure!