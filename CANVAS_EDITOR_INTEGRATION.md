# Canvas Layout Editor - Integration Guide

## 🎨 Overview

I've created a complete HTML5 Canvas-based layout editor for your React application. This replaces the need for heavy libraries like Fabric.js while providing all the essential features for visual layout customization.

## 📁 Files Created

```
frontend/src/components/
├── CanvasEditor.jsx              # Main canvas editor component
├── CanvasEditor.css              # Component styling
├── CanvasEditorExample.jsx       # Example usage with drag & drop
├── CanvasEditorExample.css       # Example component styling
├── canvasUtils.js                # Helper functions and utilities
└── CanvasEditorREADME.md         # Detailed documentation
```

## 🚀 Quick Integration

### 1. Add to Your Existing Page

```jsx
// In your XHTML viewer component, add:
import CanvasEditor from '../components/CanvasEditor';
import { createPlaceholderObject, createTextObject } from '../components/canvasUtils';

// Convert your existing placeholders to canvas objects
const convertXHTMLToCanvasObjects = (xhtmlContent) => {
  const objects = [];

  // Parse and convert image placeholders
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtmlContent, 'text/html');

  doc.querySelectorAll('img[data-placeholder]').forEach((img, index) => {
    objects.push(createPlaceholderObject(
      parseInt(img.style.left) || index * 220,
      parseInt(img.style.top) || 50,
      parseInt(img.style.width) || 200,
      parseInt(img.style.height) || 150,
      'image'
    ));
  });

  return objects;
};

// In your component render:
const [canvasObjects, setCanvasObjects] = useState([]);
const [selectedObjectId, setSelectedObjectId] = useState(null);

useEffect(() => {
  const objects = convertXHTMLToCanvasObjects(currentXhtmlContent);
  setCanvasObjects(objects);
}, [currentXhtmlContent]);

return (
  <div className="xhtml-viewer-with-editor">
    <CanvasEditor
      width={800}
      height={600}
      objects={canvasObjects}
      onObjectsChange={setCanvasObjects}
      onObjectSelect={setSelectedObjectId}
      selectedObjectId={selectedObjectId}
      backgroundColor="#ffffff"
    />
  </div>
);
```

### 2. Handle Image Drops on Placeholders

```jsx
// Add drag & drop handling
const handleImageDrop = useCallback(async (droppedFiles, placeholderId) => {
  for (const file of droppedFiles) {
    if (file.type.startsWith('image/')) {
      const dataUrl = await fileToDataURL(file);
      const img = await loadImage(dataUrl);

      // Replace placeholder with actual image
      setCanvasObjects(prev => prev.map(obj => {
        if (obj.id === placeholderId && obj.type === 'placeholder') {
          return {
            ...obj,
            type: 'image',
            imageSrc: dataUrl,
            image: img
          };
        }
        return obj;
      }));
    }
  }
}, []);
```

### 3. Export Canvas Layout Back to XHTML

```jsx
const exportCanvasToXHTML = (objects) => {
  let xhtml = originalXhtmlTemplate;

  objects.forEach(obj => {
    if (obj.type === 'image' && obj.imageSrc) {
      // Replace placeholder with positioned image
      xhtml = xhtml.replace(
        /<img[^>]*data-placeholder="image"[^>]*\/?>/,
        `<img src="${obj.imageSrc}" style="position:absolute;left:${obj.x}px;top:${obj.y}px;width:${obj.width}px;height:${obj.height}px;transform:rotate(${obj.rotation || 0}deg);" />`
      );
    } else if (obj.type === 'text') {
      // Replace text placeholder with positioned text
      xhtml = xhtml.replace(
        /<div[^>]*data-text-placeholder[^>]*>.*?<\/div>/,
        `<div style="position:absolute;left:${obj.x}px;top:${obj.y}px;width:${obj.width}px;height:${obj.height}px;font-size:${obj.fontSize}px;font-family:${obj.fontFamily};color:${obj.color};transform:rotate(${obj.rotation || 0}deg);white-space:pre-wrap;">${obj.content}</div>`
      );
    }
  });

  return xhtml;
};
```

## ✨ Key Features Implemented

### ✅ Core Functionality
- **Pure HTML5 Canvas**: No external dependencies
- **Object-Based Editing**: Independent text and image objects
- **Visual Selection**: Bounding boxes with resize handles
- **Drag & Drop**: Drop images directly onto placeholders
- **Text Editing**: Double-click to edit text content
- **Zoom Support**: Mouse wheel zooming with controls
- **Mobile Touch**: Full touch support for mobile devices

### ✅ Advanced Features
- **Precise Hit Detection**: Accurate object selection
- **Coordinate Transformation**: Screen ↔ Canvas coordinate conversion
- **State Management**: JSON-based object persistence
- **Keyboard Shortcuts**: Delete key, Escape, Enter
- **Rotation Support**: Object rotation (degrees)
- **Performance Optimized**: Efficient rendering and updates

## 🔧 Customization Options

### Canvas Size & Styling
```jsx
<CanvasEditor
  width={1024}
  height={768}
  backgroundColor="#f5f5f5"
  // ... other props
/>
```

### Object Properties
```jsx
// Text object
{
  type: 'text',
  content: 'Hello World',
  fontSize: 16,
  fontFamily: 'Arial',
  color: '#000000',
  x: 50,
  y: 50,
  width: 200,
  height: 60,
  rotation: 0
}

// Image object
{
  type: 'image',
  imageSrc: 'data:image/png;base64,...',
  x: 50,
  y: 150,
  width: 200,
  height: 150,
  rotation: 0
}

// Placeholder object
{
  type: 'placeholder',
  placeholderType: 'image', // 'text', 'image', 'audio'
  x: 300,
  y: 50,
  width: 150,
  height: 100,
  rotation: 0
}
```

## 📱 Mobile & Touch Support

The editor automatically detects touch devices and provides:
- **Touch dragging** for object movement
- **Pinch-to-zoom** support
- **Responsive UI** that adapts to screen size
- **Touch-friendly handles** for resize operations

## 🎯 Use Cases

### Perfect For:
- **PDF Layout Correction**: Fix distorted text/image positioning
- **EPUB Content Arrangement**: Reorganize extracted content
- **Visual Template Editing**: Customize document layouts
- **Interactive Content Creation**: Build rich media documents

### Integration Points:
- **XHTML Viewer**: Replace static placeholders with editable canvas
- **PDF Processing**: Correct OCR/extraction positioning errors
- **EPUB Generation**: Export corrected layouts to EPUB format
- **Content Management**: Visual editing of document templates

## 🚦 Getting Started

1. **Import the components** into your existing XHTML viewer
2. **Convert placeholders** to canvas objects using the utility functions
3. **Add drag & drop handlers** for image uploads
4. **Implement export functionality** to convert back to XHTML
5. **Style and customize** the UI to match your application

## 📚 Full Documentation

See `CanvasEditorREADME.md` for complete API documentation, examples, and advanced usage patterns.

## 🎉 Result

You now have a powerful, lightweight canvas editor that integrates seamlessly with your existing React application, providing users with intuitive visual layout customization capabilities without the overhead of heavy canvas libraries.