import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Canvas, 
  FabricImage, 
  Rect,
  filters
} from 'fabric';
import './FabricImageEditor.css';

/**
 * FabricImageEditor Component
 * Advanced image editor using Fabric.js for crop, rotate, resize, filters, etc.
 */
const FabricImageEditor = ({ 
  imageUrl, 
  imageId, 
  onSave, 
  onCancel,
  initialImage = null // If editing an already placed image
}) => {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [fabricImage, setFabricImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#f5f5f5',
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;

    // Set up canvas events
    canvas.on('object:modified', () => {
      saveToHistory();
    });

    canvas.on('object:added', () => {
      saveToHistory();
    });

    canvas.on('object:removed', () => {
      saveToHistory();
    });

    return () => {
      canvas.dispose();
    };
  }, []);

  // Load image into canvas
  useEffect(() => {
    if (!fabricCanvasRef.current || !imageUrl) return;

    const loadImage = async () => {
      try {
        setLoading(true);
        
        // Load image from URL
        FabricImage.fromURL(imageUrl, (img) => {
          if (!fabricCanvasRef.current) return;

          const canvas = fabricCanvasRef.current;
          
          // Scale image to fit canvas while maintaining aspect ratio
          const canvasWidth = canvas.width;
          const canvasHeight = canvas.height;
          const imgWidth = img.width;
          const imgHeight = img.height;
          
          const scale = Math.min(
            (canvasWidth * 0.9) / imgWidth,
            (canvasHeight * 0.9) / imgHeight
          );
          
          img.scale(scale);
          img.set({
            left: canvasWidth / 2,
            top: canvasHeight / 2,
            originX: 'center',
            originY: 'center',
            selectable: true,
            hasControls: true,
            hasBorders: true,
          });

          canvas.setActiveObject(img);
          canvas.add(img);
          canvas.renderAll();
          
          setFabricImage(img);
          setLoading(false);
          saveToHistory();
        }, {
          crossOrigin: 'anonymous'
        });
      } catch (error) {
        console.error('Error loading image:', error);
        setLoading(false);
      }
    };

    loadImage();
  }, [imageUrl]);

  // History management
  const saveToHistory = useCallback(() => {
    if (!fabricCanvasRef.current) return;
    
    const json = JSON.stringify(fabricCanvasRef.current.toJSON());
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(json);
      // Limit history to 50 states
      if (newHistory.length > 50) {
        newHistory.shift();
      } else {
        setHistoryIndex(newHistory.length - 1);
      }
      return newHistory;
    });
  }, [historyIndex]);

  // Undo/Redo
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    
    if (fabricCanvasRef.current && history[newIndex]) {
      fabricCanvasRef.current.loadFromJSON(history[newIndex], () => {
        fabricCanvasRef.current.renderAll();
      });
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    
    if (fabricCanvasRef.current && history[newIndex]) {
      fabricCanvasRef.current.loadFromJSON(history[newIndex], () => {
        fabricCanvasRef.current.renderAll();
      });
    }
  }, [history, historyIndex]);

  // Tool handlers
  const handleCrop = useCallback(() => {
    if (!fabricCanvasRef.current || !fabricImage) return;
    
    setActiveTool('crop');
    
    // Create a rectangle for cropping
    const canvas = fabricCanvasRef.current;
    const rect = new Rect({
      left: canvas.width / 4,
      top: canvas.height / 4,
      width: canvas.width / 2,
      height: canvas.height / 2,
      fill: 'rgba(0,0,0,0.1)',
      stroke: '#2196F3',
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      selectable: true,
      hasControls: true,
      hasBorders: true,
    });
    
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  }, [fabricImage]);

  const handleApplyCrop = useCallback(() => {
    if (!fabricCanvasRef.current || !fabricImage) return;
    
    const canvas = fabricCanvasRef.current;
    const activeObject = canvas.getActiveObject();
    
    if (activeObject && activeObject.type === 'rect') {
      const rect = activeObject;
      const img = fabricImage;
      
      // Calculate crop coordinates
      const scaleX = img.scaleX || 1;
      const scaleY = img.scaleY || 1;
      const imgLeft = img.left - (img.width * scaleX) / 2;
      const imgTop = img.top - (img.height * scaleY) / 2;
      
      const cropLeft = Math.max(0, (rect.left - imgLeft) / scaleX);
      const cropTop = Math.max(0, (rect.top - imgTop) / scaleY);
      const cropWidth = Math.min(img.width, rect.width / scaleX);
      const cropHeight = Math.min(img.height, rect.height / scaleY);
      
      // Create cropped image
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropWidth;
      croppedCanvas.height = cropHeight;
      const ctx = croppedCanvas.getContext('2d');
      
      // Get image element
      const imgElement = img.getElement();
      
      ctx.drawImage(
        imgElement,
        cropLeft, cropTop, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      );
      
      // Replace image with cropped version
      FabricImage.fromURL(croppedCanvas.toDataURL(), (newImg) => {
        canvas.remove(img);
        canvas.remove(rect);
        
        newImg.set({
          left: canvas.width / 2,
          top: canvas.height / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          hasControls: true,
          hasBorders: true,
        });
        
        canvas.add(newImg);
        canvas.setActiveObject(newImg);
        canvas.renderAll();
        
        setFabricImage(newImg);
        setActiveTool(null);
        saveToHistory();
      });
    }
  }, [fabricImage, saveToHistory]);

  const handleRotate = useCallback((degrees) => {
    if (!fabricImage) return;
    
    const currentAngle = fabricImage.angle || 0;
    fabricImage.rotate(currentAngle + degrees);
    fabricCanvasRef.current.renderAll();
    saveToHistory();
  }, [fabricImage, saveToHistory]);

  const handleFlip = useCallback((direction) => {
    if (!fabricImage) return;
    
    if (direction === 'horizontal') {
      fabricImage.flipX = !fabricImage.flipX;
    } else {
      fabricImage.flipY = !fabricImage.flipY;
    }
    
    fabricCanvasRef.current.renderAll();
    saveToHistory();
  }, [fabricImage, saveToHistory]);

  const handleFilter = useCallback((filterName) => {
    if (!fabricImage) return;
    
    // Remove existing filters
    fabricImage.filters = [];
    
    switch (filterName) {
      case 'grayscale':
        fabricImage.filters.push(new filters.Grayscale());
        break;
      case 'sepia':
        fabricImage.filters.push(new filters.Sepia());
        break;
      case 'vintage':
        fabricImage.filters.push(new filters.Vintage());
        break;
      case 'brightness':
        fabricImage.filters.push(new filters.Brightness({ brightness: 0.1 }));
        break;
      case 'contrast':
        fabricImage.filters.push(new filters.Contrast({ contrast: 0.1 }));
        break;
      case 'saturation':
        fabricImage.filters.push(new filters.Saturation({ saturation: 0.2 }));
        break;
      case 'blur':
        fabricImage.filters.push(new filters.Blur({ blur: 0.1 }));
        break;
      case 'sharpen':
        fabricImage.filters.push(new filters.Convolute({
          matrix: [0, -1, 0, -1, 5, -1, 0, -1, 0]
        }));
        break;
      case 'remove':
        fabricImage.filters = [];
        break;
      default:
        break;
    }
    
    fabricImage.applyFilters();
    fabricCanvasRef.current.renderAll();
    saveToHistory();
  }, [fabricImage, saveToHistory]);

  const handleReset = useCallback(() => {
    if (!fabricCanvasRef.current || !imageUrl) return;
    
    fabricCanvasRef.current.clear();
    
    FabricImage.fromURL(imageUrl, (img) => {
      const canvas = fabricCanvasRef.current;
      const scale = Math.min(
        (canvas.width * 0.9) / img.width,
        (canvas.height * 0.9) / img.height
      );
      
      img.scale(scale);
      img.set({
        left: canvas.width / 2,
        top: canvas.height / 2,
        originX: 'center',
        originY: 'center',
        selectable: true,
        hasControls: true,
        hasBorders: true,
      });

      canvas.add(img);
      canvas.renderAll();
      
      setFabricImage(img);
      saveToHistory();
    }, {
      crossOrigin: 'anonymous'
    });
  }, [imageUrl, saveToHistory]);

  // Save edited image
  const handleSave = useCallback(() => {
    if (!fabricCanvasRef.current || !fabricImage) return;
    
    // Export canvas as image
    const dataURL = fabricCanvasRef.current.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 1
    });
    
    // Convert to blob
    fetch(dataURL)
      .then(res => res.blob())
      .then(blob => {
        if (onSave) {
          onSave(blob, dataURL);
        }
      })
      .catch(error => {
        console.error('Error saving image:', error);
      });
  }, [fabricImage, onSave]);

  if (loading) {
    return (
      <div className="fabric-editor-loading">
        <div className="loading-spinner">Loading image...</div>
      </div>
    );
  }

  return (
    <div className="fabric-image-editor">
      <div className="fabric-editor-header">
        <h3>Image Editor - {imageId || 'New Image'}</h3>
        <div className="editor-actions">
          <button onClick={handleUndo} disabled={historyIndex <= 0} className="btn-undo">
            ↶ Undo
          </button>
          <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="btn-redo">
            ↷ Redo
          </button>
          <button onClick={handleReset} className="btn-reset">
            ↻ Reset
          </button>
          <button onClick={onCancel} className="btn-cancel">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-save-editor">
            ✓ Save
          </button>
        </div>
      </div>

      <div className="fabric-editor-toolbar">
        <div className="tool-group">
          <span className="tool-label">Transform:</span>
          <button onClick={() => handleRotate(-90)} className="tool-btn" title="Rotate Left">
            ↺ 90°
          </button>
          <button onClick={() => handleRotate(90)} className="tool-btn" title="Rotate Right">
            ↻ 90°
          </button>
          <button onClick={() => handleFlip('horizontal')} className="tool-btn" title="Flip Horizontal">
            ⇄ Flip H
          </button>
          <button onClick={() => handleFlip('vertical')} className="tool-btn" title="Flip Vertical">
            ⇅ Flip V
          </button>
        </div>

        <div className="tool-group">
          <span className="tool-label">Crop:</span>
          <button 
            onClick={handleCrop} 
            className={`tool-btn ${activeTool === 'crop' ? 'active' : ''}`}
            title="Crop Image"
          >
            ✂️ Crop
          </button>
          {activeTool === 'crop' && (
            <button onClick={handleApplyCrop} className="tool-btn btn-apply" title="Apply Crop">
              ✓ Apply
            </button>
          )}
        </div>

        <div className="tool-group">
          <span className="tool-label">Filters:</span>
          <button onClick={() => handleFilter('grayscale')} className="tool-btn" title="Grayscale">
            ⚫ Grayscale
          </button>
          <button onClick={() => handleFilter('sepia')} className="tool-btn" title="Sepia">
            🟤 Sepia
          </button>
          <button onClick={() => handleFilter('vintage')} className="tool-btn" title="Vintage">
            📷 Vintage
          </button>
          <button onClick={() => handleFilter('brightness')} className="tool-btn" title="Brightness">
            ☀️ Bright
          </button>
          <button onClick={() => handleFilter('contrast')} className="tool-btn" title="Contrast">
            🎨 Contrast
          </button>
          <button onClick={() => handleFilter('saturation')} className="tool-btn" title="Saturation">
            🌈 Saturate
          </button>
          <button onClick={() => handleFilter('blur')} className="tool-btn" title="Blur">
            🌫️ Blur
          </button>
          <button onClick={() => handleFilter('sharpen')} className="tool-btn" title="Sharpen">
            ✨ Sharpen
          </button>
          <button onClick={() => handleFilter('remove')} className="tool-btn" title="Remove Filters">
            🗑️ Remove
          </button>
        </div>
      </div>

      <div className="fabric-editor-canvas-container">
        <canvas ref={canvasRef} className="fabric-canvas" />
      </div>

      <div className="fabric-editor-footer">
        <p className="editor-hint">
          💡 Drag to move • Use corner handles to resize • Right-click for more options
        </p>
      </div>
    </div>
  );
};

export default FabricImageEditor;

