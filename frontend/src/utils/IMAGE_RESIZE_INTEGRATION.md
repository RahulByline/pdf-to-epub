# Image Resize and Position Editor - Integration Guide

This is a pure JavaScript + CSS solution for image editing within XHTML content. It works in any XHTML environment without React or other frameworks.

## Files

- `image-resize.js` - Pure JavaScript implementation
- `image-resize.css` - Styles for resize handles and toolbar

## Usage in Pure XHTML Environment

### 1. Include the CSS

```html
<link rel="stylesheet" href="image-resize.css">
```

Or inject inline:
```html
<style>
/* Copy contents of image-resize.css here */
</style>
```

### 2. Include the JavaScript

```html
<script src="image-resize.js"></script>
```

Or inject inline:
```html
<script>
/* Copy contents of image-resize.js here */
</script>
```

### 3. Initialize

```html
<script>
// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Initialize with container element (defaults to document.body)
  XHTMLImageEditor.init(document.getElementById('content-area'));
  
  // Or initialize for entire document
  XHTMLImageEditor.init();
});
</script>
```

## Features

### Image Selection
- **Single Click**: Selects an image, shows resize border and handles
- **Double Click**: Enters edit mode, allows resizing and dragging

### Resizing
- **Corner Handles**: Resize both width and height
- **Edge Handles**: Resize one dimension
- **Shift Key**: Hold Shift while dragging to maintain aspect ratio
- **Toolbar**: Input fields for precise width/height control

### Positioning
- **Drag & Drop**: Click and drag images to reposition
- **Constrained Movement**: Images stay within container bounds
- **Position Styles**: Uses `position: absolute` with `left` and `top`

### Toolbar Controls
- **Width/Height Inputs**: Set exact dimensions
- **Unit Selection**: Pixels (px) or Percentage (%)
- **Aspect Ratio Lock**: Checkbox to maintain proportions
- **Reset Button**: Remove all size constraints
- **Close Button**: Deselect image

### Keyboard Shortcuts
- **Escape**: Exit edit mode

## API

```javascript
// Initialize editor
XHTMLImageEditor.init(containerElement);

// Select an image programmatically
XHTMLImageEditor.selectImage(imgElement);

// Deselect current image
XHTMLImageEditor.deselectImage();

// Enter edit mode
XHTMLImageEditor.enterEditMode();

// Exit edit mode
XHTMLImageEditor.exitEditMode();
```

## XHTML Compatibility

The script:
- Uses only standard DOM APIs (no React, jQuery, etc.)
- Updates `width` and `height` attributes
- Uses inline `style` attributes for positioning
- Maintains valid XHTML structure
- Works with dynamically loaded images

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires ES5+ JavaScript support
- No external dependencies



