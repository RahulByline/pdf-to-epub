# Fixed: Page Merging and Content Cutting Issues

## Problem
- Pages were merging (2 pages showing in one EPUB page)
- Content was being cut off
- Text blocks from multiple pages appearing together

## Root Causes Identified

1. **Shared CSS with Max Dimensions**: All pages were using the same CSS with maximum dimensions, causing smaller pages to be stretched or content to overflow
2. **No Page Boundary Enforcement**: Text blocks weren't being filtered to ensure they only belong to their specific page
3. **Spread View Enabled**: EPUB was allowing side-by-side page display
4. **Missing Max Constraints**: CSS didn't have max-width/max-height to prevent overflow

## Fixes Applied

### 1. Page-Specific CSS
- Each page now gets its own CSS embedded directly in the XHTML
- CSS uses the exact dimensions of that specific page (not max dimensions)
- Prevents pages from being stretched or merged

### 2. Text Block Filtering
- Added filtering to ensure text blocks only belong to their page
- Checks `block.pageNumber` matches the current page
- Prevents text from other pages appearing

### 3. EPUB Spread Settings
- Changed `rendition:spread` from `auto` to `none`
- Prevents side-by-side page display
- Forces one page per view

### 4. CSS Constraints
- Added `max-width` and `max-height` to all containers
- Added `box-sizing: border-box` to prevent overflow
- Ensures content stays within page boundaries

### 5. Viewport Settings
- Each page uses its own viewport dimensions
- Viewport meta tag uses page-specific rendered dimensions
- Prevents scaling issues

## Code Changes

### Before:
```javascript
// All pages used max dimensions
const pageCss = generateFixedLayoutCSS(maxWidth, maxHeight, maxRenderedWidth, maxRenderedHeight);
```

### After:
```javascript
// Each page uses its own dimensions
const actualPageWidthPoints = page.width || pageWidthPoints;
const actualPageHeightPoints = page.height || pageHeightPoints;
const pageCss = generateFixedLayoutCSS(
  actualPageWidthPoints,
  actualPageHeightPoints,
  actualRenderedWidth,
  actualRenderedHeight
);
```

### Text Block Filtering:
```javascript
// Only include blocks from THIS page
const textBlocks = (page.textBlocks || []).filter(block => {
  const blockPageNum = block.pageNumber || block.boundingBox?.pageNumber;
  return !blockPageNum || blockPageNum === pageNumber;
});
```

## Testing

To verify the fix:

1. **Convert a PDF with varying page sizes**
2. **Check EPUB in reader**:
   - Each page should display separately
   - No content should be cut off
   - Text should only appear on its correct page
   - Pages should not merge together

3. **Check page dimensions**:
   - Each page XHTML should have its own viewport
   - CSS should match page dimensions exactly
   - Images should fit within page boundaries

## Expected Behavior

- ✅ One PDF page = One EPUB page
- ✅ Each page has correct dimensions
- ✅ Text blocks only on their page
- ✅ No content overflow or cutting
- ✅ No side-by-side page display
- ✅ Proper page boundaries

## If Issues Persist

1. **Check page dimensions**: Verify `page.width` and `page.height` are correct
2. **Check rendered images**: Ensure images match page dimensions
3. **Check text extraction**: Verify text blocks have correct `pageNumber`
4. **Check EPUB reader**: Some readers may have their own display quirks

## Files Modified

- `src/services/conversionService.js`:
  - `generateFixedLayoutEpub()` - Added page-specific CSS generation
  - `generateFixedLayoutPageXHTML()` - Added CSS embedding and text filtering
  - `generateFixedLayoutCSS()` - Added max constraints
  - `generateFixedLayoutContentOpf()` - Changed spread to "none"

