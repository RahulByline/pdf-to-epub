# EPUB Image Editor Component

## Overview

The `EpubImageEditor` component provides a visual drag-and-drop interface for placing extracted PNG images into XHTML placeholder divs. This tool helps convert fixed-layout EPUB placeholders into reflowable EPUB with actual images.

## Features

- **Visual Editor**: Split-screen interface with image gallery (30%) and XHTML canvas (70%)
- **Drag & Drop**: Drag images from gallery and drop onto placeholder divs
- **Auto-replacement**: Automatically replaces placeholder divs with `<img>` tags
- **Reflowable CSS**: Applies reflowable CSS rules (max-width: 100%, height: auto)
- **Save Functionality**: Saves modified XHTML back to the backend
- **Reset Option**: Reset changes to original XHTML

## Usage

### Route
Access the editor at: `/epub-image-editor/:jobId`

Example: `/epub-image-editor/74`

### Component Props

```jsx
<EpubImageEditor
  jobId={number}        // Conversion job ID
  pageNumber={number}   // Page number to edit
  onSave={(xhtml) => {}} // Optional callback when XHTML is saved
/>
```

## API Endpoints

### Backend Endpoints (added to `conversionRoutes.js`)

1. **GET** `/api/conversions/:jobId/xhtml/:pageNumber`
   - Returns XHTML content for a specific page

2. **GET** `/api/conversions/:jobId/images`
   - Returns list of extracted images for the job

3. **GET** `/api/conversions/:jobId/images/:fileName`
   - Returns a specific image file

4. **GET** `/api/conversions/:jobId/pages`
   - Returns list of all XHTML pages for the job

5. **PUT** `/api/conversions/:jobId/xhtml/:pageNumber`
   - Saves modified XHTML content
   - Body: `{ xhtml: string }`

## File Structure

```
frontend/src/
├── components/
│   ├── EpubImageEditor.jsx      # Main component
│   └── EpubImageEditor.css      # Component styles
├── utils/
│   └── xhtmlUtils.js            # Helper functions
└── pages/
    └── EpubImageEditorPage.jsx  # Page wrapper component
```

## Helper Functions (`xhtmlUtils.js`)

### `injectImageIntoXhtml(xhtml, targetId, imageSrc, imageWidth, imageHeight)`
Replaces a placeholder div with an `<img>` tag.

**Parameters:**
- `xhtml`: XHTML content string
- `targetId`: ID of the placeholder div to replace
- `imageSrc`: Image source path (e.g., `"../images/page1_img1.png"`)
- `imageWidth`: Optional image width
- `imageHeight`: Optional image height

**Returns:** Modified XHTML string

### `applyReflowableCss(xhtml)`
Applies reflowable CSS rules to XHTML, removing fixed-layout styles.

**Parameters:**
- `xhtml`: XHTML content string

**Returns:** XHTML with reflowable CSS applied

### `extractPlaceholders(xhtml)`
Extracts all placeholder divs from XHTML.

**Parameters:**
- `xhtml`: XHTML content string

**Returns:** Array of placeholder objects with `id`, `title`, `className`

## How It Works

1. **Load Phase:**
   - Fetches XHTML for the specified page
   - Applies reflowable CSS reset
   - Extracts placeholder divs (`.image-placeholder` or `.image-drop-zone`)
   - Loads available images from the job's images directory

2. **Drag & Drop:**
   - User drags an image from the gallery
   - Drops it onto a placeholder div in the XHTML canvas
   - Component calls `injectImageIntoXhtml()` to replace the div with an `<img>` tag
   - XHTML is updated and marked as modified

3. **Save Phase:**
   - User clicks "Save XHTML" button
   - Modified XHTML is sent to backend via PUT request
   - Backend saves the XHTML to `html_intermediate/job_{jobId}_html/page_{pageNumber}.xhtml`

## CSS Classes

### Placeholder Classes
- `.image-placeholder` - Standard placeholder div
- `.image-drop-zone` - Alternative placeholder class
- `.drag-over` - Applied when dragging over a placeholder

### Component Classes
- `.epub-image-editor` - Main container
- `.image-gallery` - Left sidebar (30% width)
- `.xhtml-canvas` - Right canvas (70% width)
- `.draggable-image` - Image item in gallery
- `.xhtml-content` - Rendered XHTML container

## Reflowable CSS Rules

The component automatically applies these CSS rules:

```css
img {
  max-width: 100% !important;
  height: auto !important;
  display: block !important;
  margin: 1em auto !important;
}

.page, .container {
  position: relative !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
}
```

## Dependencies

- `react-dnd` - Drag and drop functionality
- `react-dnd-html5-backend` - HTML5 drag and drop backend
- `axios` - API calls (via `api.js`)

## Example Workflow

1. Navigate to `/epub-image-editor/74`
2. Select a page from the dropdown
3. View available images in the left gallery
4. Drag an image onto a placeholder div in the XHTML canvas
5. Image replaces the placeholder automatically
6. Click "Save XHTML" to persist changes
7. Modified XHTML is saved to the backend

## Notes

- The component uses `dangerouslySetInnerHTML` to render XHTML
- Placeholder detection uses both DOM parsing and regex fallback
- Image paths are relative (`../images/filename.png`) for EPUB compatibility
- The component maintains original XHTML for reset functionality

