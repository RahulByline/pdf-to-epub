import React, { useRef, useEffect, useState, useCallback } from 'react';
import './CanvasEditor.css';

/**
 * Canvas-based Layout Editor Component
 * Provides visual editing capabilities for arranging text and image elements
 */
const CanvasEditor = ({
  width = 800,
  height = 600,
  objects = [],
  onObjectsChange,
  onObjectSelect,
  selectedObjectId = null,
  zoom = 1,
  onZoomChange,
  backgroundColor = '#ffffff'
}) => {
  const canvasRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedHandle, setSelectedHandle] = useState(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textInputPosition, setTextInputPosition] = useState({ x: 0, y: 0 });

  // Handle resize corner types
  const RESIZE_HANDLES = {
    TOP_LEFT: 'nw-resize',
    TOP_RIGHT: 'ne-resize',
    BOTTOM_LEFT: 'sw-resize',
    BOTTOM_RIGHT: 'se-resize',
    TOP: 'n-resize',
    BOTTOM: 's-resize',
    LEFT: 'w-resize',
    RIGHT: 'e-resize'
  };

  /**
   * Convert screen coordinates to canvas coordinates
   */
  const screenToCanvas = useCallback((screenX, screenY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (screenX - rect.left) * scaleX / zoom,
      y: (screenY - rect.top) * scaleY / zoom
    };
  }, [zoom]);

  /**
   * Convert canvas coordinates to screen coordinates
   */
  const canvasToScreen = useCallback((canvasX, canvasY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    return {
      x: rect.left + (canvasX * scaleX * zoom),
      y: rect.top + (canvasY * scaleY * zoom)
    };
  }, [zoom]);

  /**
   * Check if a point is inside a rectangle
   */
  const pointInRect = (x, y, rect) => {
    return x >= rect.x && x <= rect.x + rect.width &&
           y >= rect.y && y <= rect.y + rect.height;
  };

  /**
   * Get resize handle at position
   */
  const getResizeHandle = (x, y, obj) => {
    const handleSize = 8 / zoom;

    // Corner handles
    if (pointInRect(x, y, { x: obj.x - handleSize/2, y: obj.y - handleSize/2, width: handleSize, height: handleSize })) {
      return RESIZE_HANDLES.TOP_LEFT;
    }
    if (pointInRect(x, y, { x: obj.x + obj.width - handleSize/2, y: obj.y - handleSize/2, width: handleSize, height: handleSize })) {
      return RESIZE_HANDLES.TOP_RIGHT;
    }
    if (pointInRect(x, y, { x: obj.x - handleSize/2, y: obj.y + obj.height - handleSize/2, width: handleSize, height: handleSize })) {
      return RESIZE_HANDLES.BOTTOM_LEFT;
    }
    if (pointInRect(x, y, { x: obj.x + obj.width - handleSize/2, y: obj.y + obj.height - handleSize/2, width: handleSize, height: handleSize })) {
      return RESIZE_HANDLES.BOTTOM_RIGHT;
    }

    // Edge handles (optional - can be enabled later)
    // const edgeThreshold = 4 / zoom;
    // if (Math.abs(y - obj.y) < edgeThreshold && x >= obj.x && x <= obj.x + obj.width) {
    //   return RESIZE_HANDLES.TOP;
    // }
    // ... add other edge handles

    return null;
  };

  /**
   * Find object at position
   */
  const getObjectAtPosition = (x, y) => {
    // Check in reverse order (top to bottom)
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (pointInRect(x, y, obj)) {
        return { object: obj, index: i };
      }
    }
    return null;
  };

  /**
   * Render an object on the canvas
   */
  const renderObject = (ctx, obj, isSelected = false) => {
    ctx.save();

    // Apply object transformations if any
    if (obj.rotation) {
      ctx.translate(obj.x + obj.width/2, obj.y + obj.height/2);
      ctx.rotate(obj.rotation * Math.PI / 180);
      ctx.translate(-(obj.x + obj.width/2), -(obj.y + obj.height/2));
    }

    // Render based on object type
    if (obj.type === 'text') {
      renderTextObject(ctx, obj);
    } else if (obj.type === 'image') {
      renderImageObject(ctx, obj);
    } else if (obj.type === 'placeholder') {
      renderPlaceholderObject(ctx, obj);
    }

    // Render selection outline
    if (isSelected) {
      renderSelectionOutline(ctx, obj);
    }

    ctx.restore();
  };

  /**
   * Render text object
   */
  const renderTextObject = (ctx, obj) => {
    ctx.fillStyle = obj.color || '#000000';
    ctx.font = `${obj.fontSize || 16}px ${obj.fontFamily || 'Arial'}`;

    // Handle text wrapping
    const words = (obj.content || '').split(' ');
    const lines = [];
    let currentLine = '';
    const maxWidth = obj.width;

    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);

    // Render lines
    const lineHeight = obj.fontSize || 16;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], obj.x, obj.y + (i + 1) * lineHeight);
    }
  };

  /**
   * Render image object
   */
  const renderImageObject = (ctx, obj) => {
    if (obj.image) {
      try {
        ctx.drawImage(obj.image, obj.x, obj.y, obj.width, obj.height);
      } catch (e) {
        // Fallback for loading images
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        ctx.strokeStyle = '#ccc';
        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.fillText('Loading...', obj.x + 5, obj.y + 20);
      }
    } else {
      // Placeholder for missing image
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.strokeStyle = '#ccc';
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
      ctx.fillStyle = '#666';
      ctx.font = '12px Arial';
      ctx.fillText('Image', obj.x + 5, obj.y + 20);
    }
  };

  /**
   * Render placeholder object
   */
  const renderPlaceholderObject = (ctx, obj) => {
    ctx.strokeStyle = '#007bff';
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
    ctx.setLineDash([]);

    ctx.fillStyle = '#007bff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';

    let placeholderText = '';
    if (obj.placeholderType === 'image') {
      placeholderText = '📷 Drop Image Here';
    } else if (obj.placeholderType === 'text') {
      placeholderText = '📝 Text Block';
    } else if (obj.placeholderType === 'audio') {
      placeholderText = '🔊 Audio';
    } else {
      placeholderText = 'Drop Content Here';
    }

    ctx.fillText(placeholderText, obj.x + obj.width/2, obj.y + obj.height/2);
  };

  /**
   * Render selection outline with handles
   */
  const renderSelectionOutline = (ctx, obj) => {
    const handleSize = 8 / zoom;

    // Selection rectangle
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);

    // Corner handles
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 1 / zoom;

    const handles = [
      { x: obj.x - handleSize/2, y: obj.y - handleSize/2 },
      { x: obj.x + obj.width - handleSize/2, y: obj.y - handleSize/2 },
      { x: obj.x - handleSize/2, y: obj.y + obj.height - handleSize/2 },
      { x: obj.x + obj.width - handleSize/2, y: obj.y + obj.height - handleSize/2 }
    ];

    handles.forEach(handle => {
      ctx.fillRect(handle.x, handle.y, handleSize, handleSize);
      ctx.strokeRect(handle.x, handle.y, handleSize, handleSize);
    });
  };

  /**
   * Main render function
   */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply zoom transformation
    ctx.save();
    ctx.scale(zoom, zoom);

    // Render all objects
    objects.forEach(obj => {
      renderObject(ctx, obj, obj.id === selectedObjectId);
    });

    ctx.restore();
  }, [objects, selectedObjectId, zoom, backgroundColor]);

  // Render on changes
  useEffect(() => {
    render();
  }, [render]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
      render();
    }
  }, [width, height, render]);

  // Mouse/Touch event handlers
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const canvasCoords = screenToCanvas(e.clientX, e.clientY);

    // Check if clicking on resize handle first
    if (selectedObjectId) {
      const selectedObj = objects.find(obj => obj.id === selectedObjectId);
      if (selectedObj) {
        const handle = getResizeHandle(canvasCoords.x, canvasCoords.y, selectedObj);
        if (handle) {
          setIsResizing(true);
          setSelectedHandle(handle);
          setDragStart({ x: canvasCoords.x, y: canvasCoords.y });
          return;
        }
      }
    }

    // Check if clicking on an object
    const hit = getObjectAtPosition(canvasCoords.x, canvasCoords.y);
    if (hit) {
      onObjectSelect(hit.object.id);
      setIsDragging(true);
      setDragStart({ x: canvasCoords.x - hit.object.x, y: canvasCoords.y - hit.object.y });

      // Double click to edit text
      if (e.detail === 2 && hit.object.type === 'text') {
        startTextEditing(hit.object);
      }
    } else {
      onObjectSelect(null);
    }
  };

  const handleMouseMove = (e) => {
    if (!isDragging && !isResizing) return;

    const canvasCoords = screenToCanvas(e.clientX, e.clientY);

    if (isResizing && selectedObjectId) {
      handleResize(canvasCoords);
    } else if (isDragging && selectedObjectId) {
      handleDrag(canvasCoords);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
    setSelectedHandle(null);
  };

  const handleDrag = (canvasCoords) => {
    const newObjects = objects.map(obj => {
      if (obj.id === selectedObjectId) {
        return {
          ...obj,
          x: canvasCoords.x - dragStart.x,
          y: canvasCoords.y - dragStart.y
        };
      }
      return obj;
    });

    onObjectsChange(newObjects);
  };

  const handleResize = (canvasCoords) => {
    const selectedObj = objects.find(obj => obj.id === selectedObjectId);
    if (!selectedObj || !selectedHandle) return;

    let newObj = { ...selectedObj };
    const dx = canvasCoords.x - dragStart.x;
    const dy = canvasCoords.y - dragStart.y;

    switch (selectedHandle) {
      case RESIZE_HANDLES.TOP_LEFT:
        newObj.x += dx;
        newObj.y += dy;
        newObj.width -= dx;
        newObj.height -= dy;
        break;
      case RESIZE_HANDLES.TOP_RIGHT:
        newObj.y += dy;
        newObj.width += dx;
        newObj.height -= dy;
        break;
      case RESIZE_HANDLES.BOTTOM_LEFT:
        newObj.x += dx;
        newObj.width -= dx;
        newObj.height += dy;
        break;
      case RESIZE_HANDLES.BOTTOM_RIGHT:
        newObj.width += dx;
        newObj.height += dy;
        break;
    }

    // Prevent negative dimensions
    if (newObj.width < 10) newObj.width = 10;
    if (newObj.height < 10) newObj.height = 10;

    const newObjects = objects.map(obj =>
      obj.id === selectedObjectId ? newObj : obj
    );

    onObjectsChange(newObjects);
    setDragStart(canvasCoords);
  };

  const startTextEditing = (obj) => {
    setIsEditingText(true);
    setTextInput(obj.content || '');
    const screenPos = canvasToScreen(obj.x, obj.y);
    setTextInputPosition(screenPos);
  };

  const finishTextEditing = () => {
    if (selectedObjectId) {
      const newObjects = objects.map(obj => {
        if (obj.id === selectedObjectId) {
          return { ...obj, content: textInput };
        }
        return obj;
      });
      onObjectsChange(newObjects);
    }
    setIsEditingText(false);
  };

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' && selectedObjectId) {
        const newObjects = objects.filter(obj => obj.id !== selectedObjectId);
        onObjectsChange(newObjects);
        onObjectSelect(null);
      } else if (e.ctrlKey && e.key === 'z') {
        // Undo functionality could be implemented here
        console.log('Undo not implemented yet');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectId, objects, onObjectsChange, onObjectSelect]);

  // Handle wheel events for zooming
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, zoom * delta));
    onZoomChange && onZoomChange(newZoom);
  };

  return (
    <div className="canvas-editor-container">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        style={{
          border: '1px solid #ccc',
          cursor: isDragging ? 'grabbing' : isResizing ? selectedHandle : 'default',
          maxWidth: '100%',
          height: 'auto'
        }}
      />

      {isEditingText && (
        <textarea
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onBlur={finishTextEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              finishTextEditing();
            } else if (e.key === 'Escape') {
              setIsEditingText(false);
            }
          }}
          style={{
            position: 'absolute',
            left: textInputPosition.x,
            top: textInputPosition.y,
            zIndex: 1000,
            fontSize: '16px',
            padding: '4px',
            border: '1px solid #007bff',
            background: 'white',
            resize: 'none'
          }}
          autoFocus
        />
      )}
    </div>
  );
};

export default CanvasEditor;