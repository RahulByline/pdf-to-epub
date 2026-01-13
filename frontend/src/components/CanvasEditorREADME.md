# Canvas Layout Editor

A React-based canvas editor for visual layout customization, designed for fixing distorted PDF layouts and arranging text/image elements.

## Features

### ✅ Implemented
- **HTML5 Canvas Rendering**: Pure canvas-based editing surface
- **Object Management**: Independent draggable/resizable objects
- **Object Types**: Text blocks, images, and placeholders
- **Selection System**: Visual bounding boxes and selection handles
- **Resize Handles**: Corner handles for resizing objects
- **Text Editing**: Double-click to edit text content
- **Drag & Drop**: Drop images directly onto canvas
- **Zoom Support**: Mouse wheel zoom with controls
- **Keyboard Shortcuts**: Delete key to remove objects
- **Mobile Responsive**: Touch support for mobile devices
- **State Management**: JSON-based object state
- **Hit Detection**: Precise object selection and manipulation

### 🚧 Planned (Optional)
- Rotation handles
- Undo/Redo system
- Snap-to-grid functionality
- Alignment guides
- Export to image/PDF

## Quick Start

### 1. Import Components

```jsx
import CanvasEditor from './components/CanvasEditor';
import CanvasEditorExample from './components/CanvasEditorExample';
import {
  createTextObject,
  createImageObject,
  createPlaceholderObject
} from './components/canvasUtils';
```

### 2. Basic Usage

```jsx
import React, { useState } from 'react';
import CanvasEditor from './components/CanvasEditor';
import { createTextObject, createImageObject } from './components/canvasUtils';

const MyEditor = () => {
  const [objects, setObjects] = useState([
    createTextObject(50, 50, 200, 60, 'Hello World!'),
    createImageObject(50, 150, 200, 150)
  ]);

  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [zoom, setZoom] = useState(1);

  return (
    <CanvasEditor
      width={800}
      height={600}
      objects={objects}
      onObjectsChange={setObjects}
      onObjectSelect={setSelectedObjectId}
      selectedObjectId={selectedObjectId}
      zoom={zoom}
      onZoomChange={setZoom}
    />
  );
};
```

### 3. Advanced Usage with Drag & Drop

```jsx
import React, { useState, useCallback } from 'react';
import CanvasEditor from './components/CanvasEditor';
import { createImageObject, loadImage, fileToDataURL } from './components/canvasUtils';

const AdvancedEditor = () => {
  const [objects, setObjects] = useState([]);
  const [selectedObjectId, setSelectedObjectId] = useState(null);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await fileToDataURL(file);
        const img = await loadImage(dataUrl);

        const newImage = createImageObject(
          e.clientX - 100,
          e.clientY - 75,
          200,
          150,
          dataUrl
        );
        newImage.image = img;

        setObjects(prev => [...prev, newImage]);
      }
    }
  }, []);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <CanvasEditor
        width={800}
        height={600}
        objects={objects}
        onObjectsChange={setObjects}
        onObjectSelect={setSelectedObjectId}
        selectedObjectId={selectedObjectId}
      />
    </div>
  );
};
```

## API Reference

### CanvasEditor Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | number | 800 | Canvas width in pixels |
| `height` | number | 600 | Canvas height in pixels |
| `objects` | Array | [] | Array of canvas objects |
| `onObjectsChange` | function | - | Called when objects are modified |
| `onObjectSelect` | function | - | Called when object selection changes |
| `selectedObjectId` | string | null | ID of currently selected object |
| `zoom` | number | 1 | Current zoom level |
| `onZoomChange` | function | - | Called when zoom changes |
| `backgroundColor` | string | '#ffffff' | Canvas background color |

### Object Structure

```javascript
{
  id: 'unique-id',           // Unique identifier
  type: 'text' | 'image' | 'placeholder',  // Object type
  x: 0,                      // X position
  y: 0,                      // Y position
  width: 200,                // Object width
  height: 100,               // Object height
  rotation: 0,               // Rotation in degrees

  // Text-specific properties
  content: 'Hello World',    // Text content
  fontSize: 16,              // Font size
  fontFamily: 'Arial',       // Font family
  color: '#000000',          // Text color

  // Image-specific properties
  imageSrc: 'data:...',      // Image data URL
  image: Image,              // Loaded Image object

  // Placeholder-specific properties
  placeholderType: 'text' | 'image' | 'audio'  // Placeholder type
}
```

## Canvas Utils

### Object Creation

```javascript
import {
  createTextObject,
  createImageObject,
  createPlaceholderObject
} from './components/canvasUtils';

// Create a text object
const textObj = createTextObject(x, y, width, height, content);

// Create an image object
const imageObj = createImageObject(x, y, width, height, imageSrc);

// Create a placeholder object
const placeholderObj = createPlaceholderObject(x, y, width, height, type);
```

### Image Handling

```javascript
import { loadImage, fileToDataURL } from './components/canvasUtils';

// Convert file to data URL
const dataUrl = await fileToDataURL(file);

// Load image from URL
const image = await loadImage(dataUrl);
```

### Hit Detection & Coordinates

```javascript
import {
  screenToCanvas,
  canvasToScreen,
  pointInRect,
  getObjectCenter
} from './components/canvasUtils';

// Convert screen coordinates to canvas coordinates
const canvasCoords = screenToCanvas(screenX, screenY, canvas, zoom);

// Check if point is inside rectangle
const isInside = pointInRect(x, y, rect, rotation);

// Get object center point
const center = getObjectCenter(object);
```

## Integration with Existing XHTML Viewer

### Replace Placeholders with Canvas Objects

```jsx
const convertPlaceholdersToObjects = (xhtmlContent) => {
  const objects = [];

  // Parse XHTML and extract placeholders
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtmlContent, 'text/html');

  // Convert image placeholders
  doc.querySelectorAll('img[data-placeholder]').forEach((img, index) => {
    objects.push(createPlaceholderObject(
      parseInt(img.style.left) || index * 220,
      parseInt(img.style.top) || 50,
      parseInt(img.style.width) || 200,
      parseInt(img.style.height) || 150,
      'image'
    ));
  });

  // Convert text placeholders
  doc.querySelectorAll('[data-text-placeholder]').forEach((div, index) => {
    objects.push(createPlaceholderObject(
      parseInt(div.style.left) || index * 220,
      parseInt(div.style.top) || 220,
      parseInt(div.style.width) || 200,
      parseInt(div.style.height) || 80,
      'text'
    ));
  });

  return objects;
};
```

### Export Canvas Objects to XHTML

```jsx
const exportObjectsToXHTML = (objects, template) => {
  let xhtml = template;

  objects.forEach(obj => {
    if (obj.type === 'image' && obj.imageSrc) {
      // Replace image placeholders with actual images
      xhtml = xhtml.replace(
        /<img[^>]*data-placeholder="image"[^>]*>/,
        `<img src="${obj.imageSrc}" style="position:absolute;left:${obj.x}px;top:${obj.y}px;width:${obj.width}px;height:${obj.height}px;" />`
      );
    } else if (obj.type === 'text') {
      // Replace text placeholders with actual text
      xhtml = xhtml.replace(
        /<div[^>]*data-text-placeholder[^>]*>.*?<\/div>/,
        `<div style="position:absolute;left:${obj.x}px;top:${obj.y}px;width:${obj.width}px;height:${obj.height}px;font-size:${obj.fontSize}px;font-family:${obj.fontFamily};color:${obj.color};">${obj.content}</div>`
      );
    }
  });

  return xhtml;
};
```

## Styling

The components use CSS modules for styling. You can customize the appearance by:

1. **Modifying CSS variables** in `CanvasEditor.css`
2. **Overriding component styles** in your app's CSS
3. **Using theme props** (future enhancement)

## Performance Considerations

### Optimization Tips
- **Object Limiting**: Limit the number of objects for better performance
- **Image Preloading**: Preload images before adding to canvas
- **Debounced Updates**: Debounce frequent state updates
- **Virtual Scrolling**: For very large canvases (future enhancement)

### Memory Management
- **Image Cleanup**: Remove unused image objects
- **Canvas Clearing**: Properly clear canvas on resize
- **Object Disposal**: Clean up object references when removed

## Browser Compatibility

- **Chrome**: Full support
- **Firefox**: Full support
- **Safari**: Full support (iOS 12+)
- **Edge**: Full support
- **Mobile Browsers**: Touch support included

## Troubleshooting

### Common Issues

**Objects not rendering:**
- Check canvas dimensions and zoom level
- Verify object coordinates are within canvas bounds
- Ensure objects have valid dimensions (> 0)

**Selection not working:**
- Check if objects are properly positioned
- Verify hit detection is working
- Check for overlapping objects

**Images not loading:**
- Verify image URLs are accessible
- Check CORS headers for external images
- Ensure images are loaded before rendering

**Performance issues:**
- Reduce number of objects
- Lower canvas resolution
- Implement object culling for large canvases

## Future Enhancements

- **Rotation handles** with visual feedback
- **Undo/Redo system** with command pattern
- **Snap-to-grid** and alignment guides
- **Multi-selection** with shift+click
- **Copy/Paste** functionality
- **Layer management** panel
- **Export options** (PNG, PDF, SVG)
- **Collaboration features** (future)

## Contributing

When adding new features:
1. Update the component's prop types
2. Add corresponding CSS classes
3. Update utility functions as needed
4. Test on multiple browsers and devices
5. Update this documentation

## License

This component is part of the PDF-to-EPUB converter project.