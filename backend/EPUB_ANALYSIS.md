# EPUB Generation End-to-End Analysis

## Current Flow

### 1. Text Extraction
- **Gemini PDF Extraction**: Returns `{ pageNumber, text, textBlocks: [] }` - NO textBlocks!
- **pdfjs-dist**: Returns textBlocks with coordinates
- **Tesseract OCR**: Returns textBlocks with coordinates

### 2. Text Block Creation (STEP 3.5)
- Tries to create AI text blocks if `textBlocks` is empty
- If AI fails/times out, falls back to simple blocks in EPUB generation

### 3. EPUB Generation
- Uses `page.textBlocks` to generate XHTML
- If empty, creates simple fallback blocks with `isSimple: true`

### 4. XHTML Generation Issues Found

**Problem 1**: Flow blocks (simple blocks) are created but CSS might not apply correctly
- Flow blocks use `class="flow-block"` 
- CSS defines `.flow-block` but it's not nested under `.text-content`
- Need: `.text-content .flow-block` selector

**Problem 2**: Text might be hidden behind image
- `.text-content` has `z-index: 2` (should be above image)
- But `pointer-events: none` on parent might interfere
- Flow blocks need `pointer-events: auto`

**Problem 3**: Text might be too small or invisible
- Font size is 22px which should be visible
- But if blocks have no proper positioning, they might be off-screen

**Problem 4**: Read-aloud requires text in DOM
- Text IS in DOM (in `.text-content` div)
- But if CSS hides it or positions it off-screen, read-aloud won't work

## Fixes Needed

1. **Ensure text blocks are ALWAYS created** (even if AI fails)
2. **Fix CSS for flow blocks** - ensure they're visible and styled
3. **Ensure text is always in DOM** with proper accessibility attributes
4. **Add fallback text layer** if blocks fail completely

