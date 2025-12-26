import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, Image, Textbox } from 'fabric';
import './FabricImageEditor.css';

/**
 * FabricImageEditor Component
 * A comprehensive image editor using Fabric.js that allows:
 * - Adding text overlays to images
 * - Moving and resizing images and text
 * - Adjusting image size
 * - Exporting edited content to XHTML
 */
const FabricImageEditor = ({ 
  imageUrl, 
  imageId, 
  onSave, 
  onCancel,
  initialWidth = null,
  initialHeight = null,
  initialTexts = [] // Array of {text, x, y, fontSize, color, fontFamily}
}) => {
  const canvasRef = useRef(null);
  const canvasInstanceRef = useRef(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [fontSize, setFontSize] = useState(24);
  const [textColor, setTextColor] = useState('#000000');
  const [fontFamily, setFontFamily] = useState('Arial');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [tool, setTool] = useState('select'); // 'select', 'text', 'move', 'resize'

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#f5f5f5',
      preserveObjectStacking: true,
    });

    canvasInstanceRef.current = canvas;

    // Handle object selection
    canvas.on('selection:created', (e) => {
      setSelectedObject(e.selected[0]);
      if (e.selected[0] && e.selected[0].type === 'textbox') {
        setTextInput(e.selected[0].text || '');
        setFontSize(e.selected[0].fontSize || 24);
        setTextColor(e.selected[0].fill || '#000000');
        setFontFamily(e.selected[0].fontFamily || 'Arial');
      }
    });

    canvas.on('selection:updated', (e) => {
      setSelectedObject(e.selected[0]);
      if (e.selected[0] && e.selected[0].type === 'textbox') {
        setTextInput(e.selected[0].text || '');
        setFontSize(e.selected[0].fontSize || 24);
        setTextColor(e.selected[0].fill || '#000000');
        setFontFamily(e.selected[0].fontFamily || 'Arial');
      }
    });

    canvas.on('selection:cleared', () => {
      setSelectedObject(null);
      setTextInput('');
    });

    // Load image
    if (imageUrl) {
      Image.fromURL(
        imageUrl,
        (img) => {
          // Set initial dimensions if provided
          if (initialWidth && initialHeight) {
            img.scaleToWidth(initialWidth);
            img.scaleToHeight(initialHeight);
          } else {
            // Scale to fit canvas while maintaining aspect ratio
            const maxWidth = canvas.width * 0.9;
            const maxHeight = canvas.height * 0.9;
            if (img.width > maxWidth || img.height > maxHeight) {
              const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
              img.scale(scale);
            }
          }

          img.set({
            left: (canvas.width - img.width * img.scaleX) / 2,
            top: (canvas.height - img.height * img.scaleY) / 2,
            selectable: true,
            evented: true,
            lockMovementX: false,
            lockMovementY: false,
            hasControls: true,
            hasBorders: true,
          });

          canvas.add(img);
          canvas.setActiveObject(img);
          canvas.renderAll();
          setImageLoaded(true);

          // Load initial text overlays
          if (initialTexts && initialTexts.length > 0) {
            initialTexts.forEach((textData) => {
              const text = new Textbox(textData.text || 'Text', {
                left: textData.x || 100,
                top: textData.y || 100,
                fontSize: textData.fontSize || 24,
                fill: textData.color || '#000000',
                fontFamily: textData.fontFamily || 'Arial',
                width: 200,
                textAlign: textData.textAlign || 'left',
                selectable: true,
                evented: true,
                hasControls: true,
                hasBorders: true,
              });
              canvas.add(text);
            });
            canvas.renderAll();
          }
        },
        {
          crossOrigin: 'anonymous',
        }
      ).catch((error) => {
        console.error('[FabricImageEditor] Error loading image:', error);
        alert('Failed to load image. Please check the image URL.');
        setImageLoaded(false);
      });
    }

    return () => {
      canvas.dispose();
    };
  }, [imageUrl, initialWidth, initialHeight, initialTexts]);

  // Handle tool changes
  useEffect(() => {
    if (!canvasInstanceRef.current) return;

    const canvas = canvasInstanceRef.current;
    const objects = canvas.getObjects();

    objects.forEach((obj) => {
      switch (tool) {
        case 'select':
          obj.selectable = true;
          obj.evented = true;
          obj.hasControls = true;
          obj.hasBorders = true;
          break;
        case 'move':
          obj.selectable = true;
          obj.evented = true;
          obj.hasControls = false;
          obj.hasBorders = true;
          break;
        case 'resize':
          obj.selectable = true;
          obj.evented = true;
          obj.hasControls = true;
          obj.hasBorders = true;
          break;
        case 'text':
          obj.selectable = true;
          obj.evented = true;
          obj.hasControls = true;
          obj.hasBorders = true;
          break;
      }
    });

    canvas.renderAll();
  }, [tool]);

  // Add text overlay
  const handleAddText = useCallback(() => {
    if (!canvasInstanceRef.current) return;

    const canvas = canvasInstanceRef.current;
    const text = new Textbox(textInput || 'Double click to edit', {
      left: canvas.width / 2 - 100,
      top: canvas.height / 2 - 15,
      fontSize: fontSize,
      fill: textColor,
      fontFamily: fontFamily,
      width: 200,
      textAlign: 'left',
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    setSelectedObject(text);
    setTool('select');
  }, [textInput, fontSize, textColor, fontFamily]);

  // Update selected text properties
  const handleUpdateText = useCallback(() => {
    if (!canvasInstanceRef.current || !selectedObject || selectedObject.type !== 'textbox') return;

    selectedObject.set({
      text: textInput,
      fontSize: fontSize,
      fill: textColor,
      fontFamily: fontFamily,
    });

    canvasInstanceRef.current.renderAll();
  }, [selectedObject, textInput, fontSize, textColor, fontFamily]);

  // Delete selected object
  const handleDelete = useCallback(() => {
    if (!canvasInstanceRef.current || !selectedObject) return;

    const canvas = canvasInstanceRef.current;
    canvas.remove(selectedObject);
    canvas.renderAll();
    setSelectedObject(null);
  }, [selectedObject]);

  // Export to XHTML
  const handleExport = useCallback(() => {
    if (!canvasInstanceRef.current) return;

    const canvas = canvasInstanceRef.current;
    
    // Get all objects (image + texts)
    const objects = canvas.getObjects();
    const imageObj = objects.find(obj => obj.type === 'image');
    const textObjects = objects.filter(obj => obj.type === 'textbox');

    if (!imageObj) {
      alert('No image found in canvas');
      return;
    }

    // Export canvas to data URL
    const dataURL = canvas.toDataURL({
      format: 'png',
      quality: 1.0,
      multiplier: 2, // Higher resolution
    });

    // Get image dimensions and position
    const imageData = {
      dataURL: dataURL,
      width: imageObj.width * imageObj.scaleX,
      height: imageObj.height * imageObj.scaleY,
      left: imageObj.left,
      top: imageObj.top,
      scaleX: imageObj.scaleX,
      scaleY: imageObj.scaleY,
    };

    // Get text overlay data
    const textsData = textObjects.map((text) => ({
      text: text.text,
      x: text.left,
      y: text.top,
      fontSize: text.fontSize,
      color: text.fill,
      fontFamily: text.fontFamily,
      width: text.width,
      height: text.height,
      angle: text.angle,
      scaleX: text.scaleX,
      scaleY: text.scaleY,
    }));

    // Call onSave with all the data
    if (onSave) {
      onSave({
        imageId: imageId,
        imageData: imageData,
        texts: textsData,
        canvasDataURL: dataURL,
      });
    }
  }, [imageId, onSave]);

  // Zoom controls
  const handleZoom = useCallback((factor) => {
    if (!canvasInstanceRef.current) return;

    const canvas = canvasInstanceRef.current;
    const zoom = canvas.getZoom();
    const newZoom = zoom * factor;
    canvas.setZoom(Math.max(0.1, Math.min(5, newZoom)));
    canvas.renderAll();
  }, []);

  // Reset zoom
  const handleResetZoom = useCallback(() => {
    if (!canvasInstanceRef.current) return;

    const canvas = canvasInstanceRef.current;
    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.renderAll();
  }, []);

  return (
    <div className="fabric-image-editor">
      <div className="editor-toolbar">
        <div className="toolbar-section">
          <h3>Tools</h3>
          <div className="tool-buttons">
            <button
              className={tool === 'select' ? 'active' : ''}
              onClick={() => setTool('select')}
              title="Select and edit objects"
            >
              ✏️ Select
            </button>
            <button
              className={tool === 'text' ? 'active' : ''}
              onClick={() => setTool('text')}
              title="Add text overlay"
            >
              📝 Text
            </button>
            <button
              className={tool === 'move' ? 'active' : ''}
              onClick={() => setTool('move')}
              title="Move objects"
            >
              ↔️ Move
            </button>
            <button
              className={tool === 'resize' ? 'active' : ''}
              onClick={() => setTool('resize')}
              title="Resize objects"
            >
              🔍 Resize
            </button>
          </div>
        </div>

        {tool === 'text' && (
          <div className="toolbar-section">
            <h3>Text Properties</h3>
            <div className="text-controls">
              <input
                type="text"
                placeholder="Enter text..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="text-input"
              />
              <div className="control-row">
                <label>
                  Size:
                  <input
                    type="number"
                    min="8"
                    max="200"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="number-input"
                  />
                </label>
                <label>
                  Color:
                  <input
                    type="color"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="color-input"
                  />
                </label>
                <label>
                  Font:
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="select-input"
                  >
                    <option value="Arial">Arial</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Helvetica">Helvetica</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button onClick={handleAddText} className="btn-primary">
                  Add Text
                </button>
                {selectedObject && selectedObject.type === 'textbox' && (
                  <button onClick={handleUpdateText} className="btn-secondary">
                    Update Text
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {selectedObject && (
          <div className="toolbar-section">
            <h3>Selected Object</h3>
            <div className="object-info">
              <p>Type: {selectedObject.type}</p>
              {selectedObject.type === 'textbox' && (
                <>
                  <p>Text: {selectedObject.text}</p>
                  <p>Size: {selectedObject.fontSize}px</p>
                  <p>Position: ({Math.round(selectedObject.left)}, {Math.round(selectedObject.top)})</p>
                </>
              )}
              {selectedObject.type === 'image' && (
                <>
                  <p>Dimensions: {Math.round(selectedObject.width * selectedObject.scaleX)} × {Math.round(selectedObject.height * selectedObject.scaleY)}</p>
                  <p>Position: ({Math.round(selectedObject.left)}, {Math.round(selectedObject.top)})</p>
                </>
              )}
              <button onClick={handleDelete} className="btn-danger">
                🗑️ Delete
              </button>
            </div>
          </div>
        )}

        <div className="toolbar-section">
          <h3>Zoom</h3>
          <div className="zoom-controls">
            <button onClick={() => handleZoom(1.2)} title="Zoom In">🔍+</button>
            <button onClick={handleResetZoom} title="Reset Zoom">🔍 Reset</button>
            <button onClick={() => handleZoom(0.8)} title="Zoom Out">🔍-</button>
          </div>
        </div>

        <div className="toolbar-section actions">
          <button onClick={handleExport} className="btn-save" disabled={!imageLoaded}>
            💾 Save to XHTML
          </button>
          <button onClick={onCancel} className="btn-cancel">
            ❌ Cancel
          </button>
        </div>
      </div>

      <div className="editor-canvas-container">
        <canvas ref={canvasRef} className="fabric-canvas" />
        {!imageLoaded && (
          <div className="loading-overlay">
            <div className="loading-spinner">Loading image...</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FabricImageEditor;
