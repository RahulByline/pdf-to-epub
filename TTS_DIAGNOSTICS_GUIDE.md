# TTS Audio Generation Diagnostics Guide

## Overview
Comprehensive diagnostics have been added to trace why audio is being generated word-by-word instead of paragraph-by-paragraph.

## Diagnostic Logs Location

All diagnostic logs are prefixed with `[DIAGNOSTIC]` for easy filtering in the browser console or server logs.

---

## Frontend Diagnostics

### 1. **XHTML Parsing Stage** (`parseXhtmlElements`)
**Location:** `frontend/src/pages/SyncStudio.jsx`

**What it logs:**
- Number of paragraph-block elements found
- For each paragraph:
  - ID, text length, text preview
  - Number of nested words/sentences
  - Whether it was added or skipped (and why)
- Summary of parsed elements by type (paragraph, sentence, word)

**Example log:**
```
[DIAGNOSTIC] parseXhtmlElements - Section 0: Starting parse
[DIAGNOSTIC] parseXhtmlElements - Found 2 paragraph-block elements
[DIAGNOSTIC] parseXhtmlElements - Paragraph 1: {
  id: "page4_p1",
  textLength: 35,
  textPreview: "Have you ever wished you were a horse?",
  hasNestedWords: 8,
  hasNestedSentences: 1
}
[DIAGNOSTIC] parseXhtmlElements - Section 0 Summary: {
  totalElements: 2,
  paragraphCount: 2,
  sentenceCount: 0,
  wordCount: 0
}
```

**What to check:**
- ✅ Are paragraph-block elements being found?
- ✅ Are they being added to elements array?
- ⚠️ If `paragraphCount: 0`, check why paragraphs are being skipped

---

### 2. **Element Filtering Stage** (`handleGenerateAudio`)
**Location:** `frontend/src/pages/SyncStudio.jsx`

**What it logs:**
- Total parsed elements before filtering
- Breakdown by type (paragraph, sentence, word, other)
- Sample elements with IDs and text previews
- After filtering: how many elements remain and their types

**Example log:**
```
[DIAGNOSTIC] handleGenerateAudio - Parsed elements before filtering: {
  total: 10,
  byType: {
    paragraph: 2,
    sentence: 0,
    word: 8,
    other: 0
  },
  sampleElements: [
    { id: "page4_p1", type: "paragraph", text: "Have you ever wished...", pageNumber: 4 },
    ...
  ]
}
[DIAGNOSTIC] handleGenerateAudio - Filtered elements: {
  total: 2,
  byType: {
    paragraph: 2,
    sentence: 0
  }
}
```

**What to check:**
- ✅ Are paragraph elements present before filtering?
- ✅ Are they passing the filter?
- ⚠️ If word elements are present, they should be filtered out

---

### 3. **Text Block Processing Stage** (`handleGenerateAudio`)
**Location:** `frontend/src/pages/SyncStudio.jsx`

**What it logs:**
- How many paragraph blocks vs sentence blocks vs word fragments
- Sample text blocks with:
  - ID (check if it's a paragraph ID like `page4_p1`)
  - Whether ID contains word pattern (`_w`)
  - Whether ID matches paragraph pattern (`pageX_pY`)
- **WARNING** if any blocks still have word IDs
- Count of blocks with proper paragraph IDs

**Example log:**
```
[DIAGNOSTIC] handleGenerateAudio - Text blocks summary: {
  totalBlocks: 2,
  paragraphBlocks: 2,
  sentenceBlocks: 0,
  wordFragments: 0,
  sampleTextBlocks: [
    {
      id: "page4_p1",
      pageNumber: 4,
      textLength: 35,
      textPreview: "Have you ever wished you were a horse?",
      isParagraphId: true,  // ✅ Should be true
      hasWordId: false,      // ✅ Should be false
      hasSentenceId: false
    }
  ]
}
[DIAGNOSTIC] Blocks with proper paragraph IDs (pageX_pY): 2 out of 2
```

**What to check:**
- ✅ `isParagraphId: true` for all blocks
- ✅ `hasWordId: false` for all blocks
- ⚠️ If `hasWordId: true`, words are not being grouped correctly
- ⚠️ If `isParagraphId: false`, paragraph ID extraction is failing

---

### 4. **Backend Request Stage** (`handleGenerateAudio`)
**Location:** `frontend/src/pages/SyncStudio.jsx`

**What it logs:**
- What's being sent to backend API
- Sample text blocks with ID analysis
- TTS options being used

**Example log:**
```
[DIAGNOSTIC] handleGenerateAudio - Sending to backend: {
  pdfId: 1,
  jobId: 103,
  voice: "standard",
  textBlocksCount: 2,
  textBlocksPreview: [
    {
      id: "page4_p1",  // ✅ Should be paragraph ID
      pageNumber: 4,
      text: "Have you ever wished you were a horse?",
      textLength: 35
    }
  ]
}
```

---

## Backend Diagnostics

### 5. **API Endpoint Stage** (`/api/audio-sync/generate`)
**Location:** `backend/src/routes/audioSyncRoutes.js`

**What it logs:**
- What was received from frontend
- Text blocks with ID analysis (paragraph ID vs word ID)
- Count of chunks with word IDs vs paragraph IDs

**Example log:**
```
[DIAGNOSTIC] /api/audio-sync/generate - Received request: {
  pdfId: 1,
  jobId: 103,
  textBlocksCount: 2,
  textBlocksPreview: [
    {
      id: "page4_p1",
      isParagraphId: true,  // ✅ Should be true
      hasWordId: false      // ✅ Should be false
    }
  ],
  chunksWithWordIds: 0,        // ✅ Should be 0
  chunksWithParagraphIds: 2    // ✅ Should match total
}
```

**What to check:**
- ✅ `chunksWithWordIds: 0` - no word IDs should reach backend
- ✅ `chunksWithParagraphIds` should equal total chunks

---

### 6. **Audio Generation Stage** (`generateCompleteAudio`)
**Location:** `backend/src/services/audioSyncService.js`

**What it logs:**
- Input chunks with ID analysis
- For each chunk being processed:
  - ID, text length, text preview
  - Whether it's a paragraph ID
  - Word count in the text
  - Whether ID contains word pattern

**Example log:**
```
[DIAGNOSTIC] generateCompleteAudio - Starting: {
  totalChunks: 2,
  sampleChunks: [
    {
      id: "page4_p1",
      textLength: 35,
      textPreview: "Have you ever wished you were a horse?",
      isParagraphId: true,  // ✅ Should be true
      hasWordId: false       // ✅ Should be false
    }
  ],
  chunksWithWordIds: 0,        // ✅ Should be 0
  chunksWithParagraphIds: 2   // ✅ Should match total
}
[DIAGNOSTIC] generateCompleteAudio - Processing chunk 1/2: {
  id: "page4_p1",
  textLength: 35,
  textPreview: "Have you ever wished you were a horse?",
  isParagraphId: true,
  hasWordId: false,
  wordCount: 8  // ✅ Should be multiple words (paragraph)
}
```

**What to check:**
- ✅ Each chunk should have `isParagraphId: true`
- ✅ Each chunk should have `hasWordId: false`
- ✅ `wordCount` should be > 1 (complete paragraph)
- ⚠️ If `wordCount: 1`, it's generating word-by-word

---

## How to Use Diagnostics

### Step 1: Open Browser Console
1. Open your browser's Developer Tools (F12)
2. Go to the Console tab
3. Filter by `[DIAGNOSTIC]` to see only diagnostic logs

### Step 2: Generate Audio
1. Click "Generate Audio" in SyncStudio
2. Watch the console logs in real-time

### Step 3: Check Each Stage

**Stage 1 - XHTML Parsing:**
- Look for: `[DIAGNOSTIC] parseXhtmlElements`
- Check: Are paragraph-block elements found?
- Issue: If `paragraphCount: 0`, paragraphs aren't being extracted

**Stage 2 - Filtering:**
- Look for: `[DIAGNOSTIC] handleGenerateAudio - Parsed elements before filtering`
- Check: Are paragraph elements present?
- Issue: If word elements are present, they should be filtered out

**Stage 3 - Text Block Processing:**
- Look for: `[DIAGNOSTIC] handleGenerateAudio - Text blocks summary`
- Check: `isParagraphId: true` and `hasWordId: false`
- Issue: If `hasWordId: true`, words aren't being grouped

**Stage 4 - Backend:**
- Look for: `[DIAGNOSTIC] /api/audio-sync/generate`
- Check: `chunksWithWordIds: 0`
- Issue: If > 0, word IDs are reaching the backend

**Stage 5 - Audio Generation:**
- Look for: `[DIAGNOSTIC] generateCompleteAudio`
- Check: Each chunk has `wordCount > 1`
- Issue: If `wordCount: 1`, it's generating word-by-word

---

## Common Issues and Solutions

### Issue 1: Paragraph-block elements not found
**Symptom:** `paragraphCount: 0` in parseXhtmlElements
**Solution:** Check XHTML structure - ensure elements have `class="paragraph-block"`

### Issue 2: Words not being grouped
**Symptom:** `hasWordId: true` in text blocks
**Solution:** Check paragraph ID extraction logic - ensure it extracts `page4_p1` from `page4_p1_s1_w1`

### Issue 3: Word IDs reaching backend
**Symptom:** `chunksWithWordIds > 0` in backend logs
**Solution:** Frontend grouping logic is failing - check `handleGenerateAudio` text block processing

### Issue 4: Single word per chunk
**Symptom:** `wordCount: 1` in generateCompleteAudio
**Solution:** Text blocks are not being combined - check grouping logic

---

## Quick Diagnostic Checklist

When generating audio, verify:

- [ ] `parseXhtmlElements` finds paragraph-block elements
- [ ] `paragraphCount > 0` in parsed elements
- [ ] Filtered elements only contain paragraph/sentence types
- [ ] Text blocks have `isParagraphId: true`
- [ ] Text blocks have `hasWordId: false`
- [ ] Backend receives `chunksWithWordIds: 0`
- [ ] Each chunk has `wordCount > 1`

If any checkbox fails, check the corresponding diagnostic log for details.

