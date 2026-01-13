import React, { useState, useCallback } from 'react';
import CanvasEditor from './CanvasEditor';
import {
  createTextObject,
  createImageObject,
  createPlaceholderObject,
  loadImage,
  fileToDataURL,
  generateObjectId
} from './canvasUtils';
import './CanvasEditorExample.css';

/**
 * Example usage of CanvasEditor component
 * Demonstrates integration with drag-and-drop, object creation, and property editing
 */
const CanvasEditorExample = () => {
  const [objects, setObjects] = useState([
    // Example objects
    createTextObject(50, 50, 200, 60, 'Welcome to Canvas Editor!\nDouble-click to edit this text.'),
    createImageObject(50, 150, 200, 150),
    createPlaceholderObject(300, 50, 150, 100, 'text'),
    createPlaceholderObject(300, 180, 150, 100, 'image'),
    createPlaceholderObject(300, 310, 150, 50, 'audio')
  ]);

  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [isDragOver, setIsDragOver] = useState(false);

  // Handle object changes
  const handleObjectsChange = useCallback((newObjects) => {
    setObjects(newObjects);
  }, []);

  // Handle object selection
  const handleObjectSelect = useCallback((objectId) => {
    setSelectedObjectId(objectId);
  }, []);

  // Handle zoom changes
  const handleZoomChange = useCallback((newZoom) => {
    setZoom(newZoom);
  }, []);

  // Add text object
  const handleAddText = useCallback(() => {
    const newText = createTextObject(
      Math.random() * (canvasSize.width - 200),
      Math.random() * (canvasSize.height - 100),
      200,
      50,
      'New text block'
    );
    setObjects(prev => [...prev, newText]);
    setSelectedObjectId(newText.id);
  }, [canvasSize]);

  // Add image placeholder
  const handleAddImagePlaceholder = useCallback(() => {
    const newPlaceholder = createPlaceholderObject(
      Math.random() * (canvasSize.width - 200),
      Math.random() * (canvasSize.height - 150),
      200,
      150,
      'image'
    );
    setObjects(prev => [...prev, newPlaceholder]);
    setSelectedObjectId(newPlaceholder.id);
  }, [canvasSize]);

  // Add text placeholder
  const handleAddTextPlaceholder = useCallback(() => {
    const newPlaceholder = createPlaceholderObject(
      Math.random() * (canvasSize.width - 200),
      Math.random() * (canvasSize.height - 80),
      200,
      80,
      'text'
    );
    setObjects(prev => [...prev, newPlaceholder]);
    setSelectedObjectId(newPlaceholder.id);
  }, [canvasSize]);

  // Handle file drop
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const rect = e.currentTarget.getBoundingClientRect();

    // Calculate drop position relative to canvas
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await fileToDataURL(file);
          const img = await loadImage(dataUrl);

          // Create image object at drop position
          const newImage = createImageObject(dropX - 100, dropY - 75, 200, 150, dataUrl);
          newImage.image = img; // Store loaded image

          setObjects(prev => [...prev, newImage]);
          setSelectedObjectId(newImage.id);
        } catch (error) {
          console.error('Failed to load image:', error);
        }
      }
    }
  }, []);

  // Handle drag over
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // Clear all objects
  const handleClearAll = useCallback(() => {
    setObjects([]);
    setSelectedObjectId(null);
  }, []);

  // Export canvas
  const handleExport = useCallback(() => {
    // This would require access to the canvas element
    // For now, we'll just log the objects
    console.log('Current objects:', objects);
    console.log('Export JSON:', JSON.stringify(objects, null, 2));
  }, [objects]);

  // Get selected object for property editing
  const selectedObject = objects.find(obj => obj.id === selectedObjectId);

  // Update selected object properties
  const updateSelectedObject = useCallback((updates) => {
    if (!selectedObjectId) return;

    setObjects(prev => prev.map(obj =>
      obj.id === selectedObjectId
        ? { ...obj, ...updates }
        : obj
    ));
  }, [selectedObjectId]);

  return (
    <div className="canvas-editor-example">
      <div className="toolbar">
        <h2>Canvas Layout Editor</h2>
        <div className="toolbar-actions">
          <button onClick={handleAddText} title="Add Text Block">
            📝 Add Text
          </button>
          <button onClick={handleAddImagePlaceholder} title="Add Image Placeholder">
            🖼️ Add Image Placeholder
          </button>
          <button onClick={handleAddTextPlaceholder} title="Add Text Placeholder">
            📄 Add Text Placeholder
          </button>
          <button onClick={handleClearAll} title="Clear All Objects">
            🗑️ Clear All
          </button>
          <button onClick={handleExport} title="Export Objects">
            💾 Export
          </button>
        </div>
        <div className="zoom-controls">
          <button onClick={() => handleZoomChange(Math.max(0.1, zoom - 0.1))}>-</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => handleZoomChange(Math.min(5, zoom + 0.1))}>+</button>
        </div>
      </div>

      <div className="editor-container">
        <div
          className={`canvas-wrapper ${isDragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <CanvasEditor
            width={canvasSize.width}
            height={canvasSize.height}
            objects={objects}
            onObjectsChange={handleObjectsChange}
            onObjectSelect={handleObjectSelect}
            selectedObjectId={selectedObjectId}
            zoom={zoom}
            onZoomChange={handleZoomChange}
            backgroundColor="#ffffff"
          />

          {isDragOver && (
            <div className="drop-overlay">
              <div className="drop-message">
                📷 Drop images here to add them to the canvas
              </div>
            </div>
          )}
        </div>

        {selectedObject && (
          <div className="properties-panel">
            <h3>Object Properties</h3>
            <div className="property-group">
              <label>Type: {selectedObject.type}</label>
            </div>

            <div className="property-group">
              <label>Position:</label>
              <div className="position-inputs">
                <input
                  type="number"
                  value={Math.round(selectedObject.x)}
                  onChange={(e) => updateSelectedObject({ x: parseInt(e.target.value) || 0 })}
                  placeholder="X"
                />
                <input
                  type="number"
                  value={Math.round(selectedObject.y)}
                  onChange={(e) => updateSelectedObject({ y: parseInt(e.target.value) || 0 })}
                  placeholder="Y"
                />
              </div>
            </div>

            <div className="property-group">
              <label>Size:</label>
              <div className="size-inputs">
                <input
                  type="number"
                  value={Math.round(selectedObject.width)}
                  onChange={(e) => updateSelectedObject({ width: Math.max(10, parseInt(e.target.value) || 10) })}
                  placeholder="Width"
                  min="10"
                />
                <input
                  type="number"
                  value={Math.round(selectedObject.height)}
                  onChange={(e) => updateSelectedObject({ height: Math.max(10, parseInt(e.target.value) || 10) })}
                  placeholder="Height"
                  min="10"
                />
              </div>
            </div>

            {selectedObject.type === 'text' && (
              <>
                <div className="property-group">
                  <label>Font Size:</label>
                  <input
                    type="number"
                    value={selectedObject.fontSize || 16}
                    onChange={(e) => updateSelectedObject({ fontSize: parseInt(e.target.value) || 16 })}
                    min="8"
                    max="72"
                  />
                </div>

                <div className="property-group">
                  <label>Font Family:</label>
                  <select
                    value={selectedObject.fontFamily || 'Arial'}
                    onChange={(e) => updateSelectedObject({ fontFamily: e.target.value })}
                  >
                    <option value="Arial">Arial</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Verdana">Verdana</option>
                  </select>
                </div>

                <div className="property-group">
                  <label>Text Color:</label>
                  <input
                    type="color"
                    value={selectedObject.color || '#000000'}
                    onChange={(e) => updateSelectedObject({ color: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="property-group">
              <label>Rotation:</label>
              <input
                type="number"
                value={selectedObject.rotation || 0}
                onChange={(e) => updateSelectedObject({ rotation: parseInt(e.target.value) || 0 })}
                min="-180"
                max="180"
                step="15"
              />
            </div>
          </div>
        )}
      </div>

      <div className="instructions">
        <h3>Instructions:</h3>
        <ul>
          <li><strong>Drag & Drop:</strong> Drag images from your computer onto the canvas</li>
          <li><strong>Select:</strong> Click on objects to select them</li>
          <li><strong>Move:</strong> Drag selected objects to reposition them</li>
          <li><strong>Resize:</strong> Drag the corner handles to resize objects</li>
          <li><strong>Edit Text:</strong> Double-click text objects to edit content</li>
          <li><strong>Delete:</strong> Press Delete key to remove selected objects</li>
          <li><strong>Zoom:</strong> Use mouse wheel or zoom controls to zoom in/out</li>
          <li><strong>Keyboard:</strong> Ctrl+Z for undo (not implemented yet)</li>
        </ul>
      </div>
    </div>
  );
};

export default CanvasEditorExample;