# 📖 Table of Contents Detection - Implementation

## Overview

This implementation adds automatic detection and skipping of table of contents pages during TTS (Text-to-Speech) audio generation. When converting PDFs to EPUB with TTS, the system will now automatically identify TOC pages and exclude them from audio generation.

## What Was Changed

### 1. Modified `textBasedConversionPipeline.js`

**File:** `backend/src/services/textBasedConversionPipeline.js`

#### Changes Made:
- Added automatic TOC detection before AI-based exclusion detection
- Integrated TOC detection results with existing exclusion logic
- Enhanced logging to show detected TOC pages

#### Code Changes:
```javascript
// Before: Only AI-based detection
const detectionResult = await TtsConfigService.detectExcludedPages(...);

// After: Automatic TOC detection + AI-based detection
const tocPages = this.detectTableOfContentsPages(structure.pages);
const detectionResult = await TtsConfigService.detectExcludedPages(...);
detectedExcludedPages.push(...tocPages, ...aiExcludedPages);
```

### 2. Added `detectTableOfContentsPages()` Method

**New Method:** `TextBasedConversionPipeline.detectTableOfContentsPages(pages)`

#### Detection Logic:
The method uses multiple heuristics to identify TOC pages:

1. **Pattern Matching:**
   - "Table of Contents" (case insensitive)
   - "Contents page"
   - "Chapter X" references
   - "Section X" references

2. **Structural Analysis:**
   - Multiple chapter/section references in sequence
   - Page numbers with titles and dots (e.g., "Introduction...........1")
   - Consistent formatting with dots and numbers
   - Numbered lists (1., 2., 3., etc.)

3. **Density Analysis:**
   - High ratio of numbered lines to total lines (>30%)
   - Multiple entries with consistent structure

#### Example TOC Patterns Detected:
```
Table of Contents
Contents

Chapter 1. Introduction...........1
Chapter 2. Background............5
Chapter 3. Methodology..........12

1. Introduction
2. Literature Review
3. Methodology
4. Results
```

## How It Works

### TTS Generation Flow:

```
1. PDF Processing
   ↓
2. Page Structure Analysis
   ↓
3. TOC Detection (NEW)
   ↓
4. AI-Based Exclusion (existing)
   ↓
5. TTS Audio Generation (skips TOC pages)
   ↓
6. EPUB Creation
```

### Integration with Existing System:

- **Automatic:** No user configuration required
- **Non-intrusive:** Works alongside existing AI-based exclusions
- **Fallback:** If detection fails, TTS continues normally
- **Logging:** Shows which pages were detected as TOC

## Testing

### Test the Detection:

```javascript
// Example usage
const pages = [
  {
    pageNumber: 1,
    text: "Table of Contents\n\nChapter 1. Introduction...........3\nChapter 2. Methods..............10"
  },
  {
    pageNumber: 2,
    text: "This is regular content page with normal text."
  }
];

const tocPages = TextBasedConversionPipeline.detectTableOfContentsPages(pages);
// Returns: [1]
```

### Manual Testing:
1. Upload a PDF with a table of contents
2. Enable TTS generation
3. Check console logs for TOC detection messages
4. Verify that TOC pages are excluded from audio generation

## Console Output

When TOC pages are detected, you'll see:
```
[Pipeline job_123] Automatically detected 1 table of contents page(s): 2
[TOC Detection] Detected page 2 as table of contents
[Pipeline job_123] Skipping TTS for page 2 (detected as excluded)
```

## Benefits

### ✅ Advantages:
- **Automatic:** No manual configuration needed
- **Reliable:** Uses multiple detection methods
- **Fast:** Pattern-based, no AI calls required
- **User-friendly:** TTS audio doesn't include navigation pages
- **Compatible:** Works with existing exclusion systems

### 🎯 Use Cases:
- Academic papers with TOC
- Books with chapter listings
- Reports with section overviews
- Any document with navigational content

## Configuration

### No Configuration Required
The TOC detection is **automatic** and works out-of-the-box.

### Optional: Custom Exclusions
Users can still use the existing TTS configuration to exclude additional pages:
- Go to TTS Config in the UI
- Set exclusion prompts like "cover pages, blank pages"
- The system combines automatic TOC detection with user-defined exclusions

## Technical Details

### Detection Algorithm:

1. **Text Extraction:** Gets page text from `page.text` or `page.textBlocks`
2. **Pattern Matching:** Applies regex patterns for common TOC indicators
3. **Structural Analysis:** Counts numbered entries and formatting patterns
4. **Threshold Application:** Requires multiple matches for confidence
5. **Page Number Return:** Returns array of page numbers to exclude

### Performance:
- **Fast:** Pattern matching is instant
- **Lightweight:** No external dependencies
- **Non-blocking:** Runs synchronously
- **Memory efficient:** Only processes text content

### Error Handling:
- **Graceful degradation:** If detection fails, continues with TTS
- **No exceptions:** Wrapped in try-catch blocks
- **Logging:** Warns if detection encounters issues

## Files Modified

### Primary Changes:
- `backend/src/services/textBasedConversionPipeline.js`
  - Added TOC detection method
  - Integrated with existing TTS filtering logic

### Documentation:
- `TOC_DETECTION_IMPLEMENTATION.md` (this file)
- Console logging enhanced

## Future Enhancements

### Potential Improvements:
- **Multi-language support:** Add TOC patterns for other languages
- **Advanced heuristics:** Machine learning-based detection
- **User feedback:** Allow users to confirm/reject detections
- **Custom patterns:** User-defined TOC patterns

### Integration Ideas:
- **Chapter detection:** Use TOC to improve chapter segmentation
- **Navigation:** Generate EPUB navigation from detected TOC
- **Metadata:** Extract document structure from TOC

## Troubleshooting

### Common Issues:

#### ❌ TOC pages not detected:
- Check page text extraction quality
- Verify TOC formatting matches patterns
- Look at console logs for detection attempts

#### ❌ Regular pages incorrectly detected as TOC:
- Review detection patterns
- Check for false positives in numbered lists
- Adjust threshold if needed

#### ❌ TTS still includes TOC pages:
- Verify TTS generation is enabled
- Check that exclusion is working
- Look for console messages about exclusions

### Debug Mode:
Add console logs to see detection process:
```javascript
console.log(`[TOC Debug] Page ${pageNumber} text:`, pageText.substring(0, 200));
console.log(`[TOC Debug] Pattern matches:`, matchCount);
```

## Summary

The implementation provides **automatic, reliable table of contents detection** for TTS generation, ensuring that navigational pages are skipped during audio creation. The system is:

- ✅ **Automatic** - No configuration required
- ✅ **Reliable** - Multiple detection methods
- ✅ **Fast** - Pattern-based detection
- ✅ **Integrated** - Works with existing systems
- ✅ **User-friendly** - Improves TTS experience

---

**Result:** TTS audio generation now automatically skips table of contents pages! 🎉
