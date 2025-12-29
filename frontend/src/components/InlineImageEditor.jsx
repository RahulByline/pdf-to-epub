import React, { useState, useEffect, useRef, useCallback } from 'react';
import './InlineImageEditor.css';

/**
 * InlineImageEditor Component
 * Provides inline editing controls for images in the canvas:
 * - Resize handles
 * - Crop tool
 * - Dimension inputs
 * - Position controls
 * - Aspect ratio lock
 * - Rotation
 */
const InlineImageEditor = ({ 
  imageElement, 
  imageId, 
  onUpdate, 
  onClose,
  editMode = true 
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [cropArea, setCropArea] = useState(null);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });
  
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const cropStartRef = useRef(null);
  const resizeHandleRef = useRef(null);
  const dragStartRef = useRef(null);
  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Initialize dimensions and position from image element's current position
  useEffect(() => {
    if (!imageElement) return;
    
    const updatePosition = () => {
      const img = imageElement;
      const rect = img.getBoundingClientRect();
      
      // Get the canvas container to calculate relative position
      const canvasContainer = img.closest('.canvas-wrapper') || 
                             img.closest('.gjs-cv-canvas') ||
                             img.offsetParent ||
                             document.body;
      
      const containerRect = canvasContainer.getBoundingClientRect();
      
      // Calculate position relative to container
      const x = rect.left - containerRect.left;
      const y = rect.top - containerRect.top;
      
      // Get dimensions from image
      const width = parseInt(img.getAttribute('width')) || rect.width;
      const height = parseInt(img.getAttribute('height')) || rect.height;
      const style = img.getAttribute('style') || '';
      
      // Extract rotation
      let rot = 0;
      if (style.includes('transform:')) {
        const rotMatch = style.match(/rotate\(([^)]+)deg\)/);
        if (rotMatch) rot = parseFloat(rotMatch[1]) || 0;
      }
      
      setDimensions({ width, height });
      setOriginalDimensions({ width, height });
      setPosition({ x, y });
      setRotation(rot);
    };
    
    // Initial update
    updatePosition();
    
    // Update position when window resizes or scrolls
    const handleUpdate = () => {
      if (imageElement && containerRef.current) {
        updatePosition();
      }
    };
    
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    
    // Also update periodically to catch any layout changes
    const intervalId = setInterval(handleUpdate, 100);
    
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
      clearInterval(intervalId);
    };
  }, [imageElement]);

  // Apply changes to image element (defined early so other functions can use it)
  // This updates dimensions, position, crop, and rotation - all changes saved to XHTML
  const applyChanges = useCallback(() => {
    if (!imageElement || !onUpdate) return;
    
    let style = imageElement.getAttribute('style') || '';
    
    // Update dimensions
    imageElement.setAttribute('width', Math.round(dimensions.width));
    imageElement.setAttribute('height', Math.round(dimensions.height));
    
    // Update position - add position styles if position has changed
    style = style.replace(/position\s*:[^;]+/gi, '');
    style = style.replace(/left\s*:[^;]+/gi, '');
    style = style.replace(/top\s*:[^;]+/gi, '');
    style = style.replace(/margin\s*:[^;]+/gi, '');
    
    // Add position styles if position is not at origin
    if (position.x !== 0 || position.y !== 0) {
      style = (style.trim() ? style + '; ' : '') + 
        `position: relative; left: ${Math.round(position.x)}px; top: ${Math.round(position.y)}px;`;
    }
    
    // Update rotation
    style = style.replace(/transform\s*:[^;]+/gi, '');
    if (rotation !== 0) {
      style = (style.trim() ? style + '; ' : '') + `transform: rotate(${rotation}deg);`;
    }
    
    // Update crop - apply clip-path to crop at current position
    if (cropArea && cropArea.width > 0 && cropArea.height > 0) {
      style = style.replace(/object-fit\s*:[^;]+/gi, '');
      style = style.replace(/object-position\s*:[^;]+/gi, '');
      style = style.replace(/clip-path\s*:[^;]+/gi, '');
      
      // Calculate crop percentages relative to current image dimensions
      const clipX = (cropArea.x / dimensions.width) * 100;
      const clipY = (cropArea.y / dimensions.height) * 100;
      const clipW = (cropArea.width / dimensions.width) * 100;
      const clipH = (cropArea.height / dimensions.height) * 100;
      
      // Apply clip-path: inset(top right bottom left)
      style = (style.trim() ? style + '; ' : '') + 
        `clip-path: inset(${clipY}% ${100 - clipX - clipW}% ${100 - clipY - clipH}% ${clipX}%);`;
    } else {
      // Remove crop if no crop area
      style = style.replace(/clip-path\s*:[^;]+/gi, '');
    }
    
    // Clean up style (remove extra semicolons and whitespace)
    style = style.replace(/;\s*;/g, ';').trim();
    if (style && !style.endsWith(';')) {
      style += ';';
    }
    
    // Apply style to image element
    if (style) {
      imageElement.setAttribute('style', style);
    } else {
      imageElement.removeAttribute('style');
    }
    
    // Notify parent to update XHTML
    onUpdate(imageElement);
  }, [imageElement, dimensions, position, rotation, cropArea, onUpdate]);

  // Handle resize
  const handleResizeStart = useCallback((e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    isResizingRef.current = true;
    resizeHandleRef.current = handle;
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = dimensions.width;
    const startHeight = dimensions.height;
    
    const handleMouseMove = (e) => {
      if (!isResizingRef.current) {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        return;
      }
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      let newWidth = startWidth;
      let newHeight = startHeight;
      
      // Calculate new dimensions based on handle
      if (handle.includes('right')) {
        newWidth = Math.max(50, startWidth + deltaX);
      }
      if (handle.includes('left')) {
        newWidth = Math.max(50, startWidth - deltaX);
      }
      if (handle.includes('bottom')) {
        newHeight = Math.max(50, startHeight + deltaY);
      }
      if (handle.includes('top')) {
        newHeight = Math.max(50, startHeight - deltaY);
      }
      
      // Maintain aspect ratio if locked
      if (aspectRatioLocked && originalDimensions.width && originalDimensions.height) {
        const ratio = originalDimensions.width / originalDimensions.height;
        if (handle.includes('right') || handle.includes('left')) {
          newHeight = newWidth / ratio;
        } else {
          newWidth = newHeight * ratio;
        }
      }
      
      setDimensions({ width: newWidth, height: newHeight });
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      isResizingRef.current = false;
      resizeHandleRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      applyChanges();
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [dimensions, aspectRatioLocked, originalDimensions, applyChanges]);

  // Handle crop start
  const handleCropStart = useCallback((e) => {
    if (!isCropping) {
      setIsCropping(true);
      const rect = imageRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        cropStartRef.current = { x, y };
        setCropArea({ x, y, width: 0, height: 0 });
      }
    }
  }, [isCropping]);

  // Handle crop drag
  useEffect(() => {
    if (!isCropping || !cropStartRef.current) return;
    
    const handleMouseMove = (e) => {
      const rect = imageRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      
      const x = Math.min(cropStartRef.current.x, currentX);
      const y = Math.min(cropStartRef.current.y, currentY);
      const width = Math.abs(currentX - cropStartRef.current.x);
      const height = Math.abs(currentY - cropStartRef.current.y);
      
      setCropArea({ x, y, width, height });
    };
    
    const handleMouseUp = () => {
      setIsCropping(false);
      cropStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isCropping]);

  // Handle drag to adjust image position
  const handleDragStart = useCallback((e) => {
    if (isCropping || isResizingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    isDraggingRef.current = true;
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = position.x;
    const startPosY = position.y;
    
    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        return;
      }
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      setPosition({
        x: startPosX + deltaX,
        y: startPosY + deltaY
      });
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      applyChanges();
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position, isCropping, applyChanges]);
  
  // Continuously update editor position to match image position (when not dragging or resizing)
  useEffect(() => {
    if (!imageElement || !containerRef.current) return;
    
    const updateEditorPosition = () => {
      // Don't update if user is actively dragging or resizing
      if (isDraggingRef.current || isResizingRef.current) return;
      
      const rect = imageElement.getBoundingClientRect();
      const canvasContainer = imageElement.closest('.canvas-wrapper') || 
                             imageElement.closest('.gjs-cv-canvas') ||
                             imageElement.offsetParent ||
                             document.body;
      const containerRect = canvasContainer.getBoundingClientRect();
      
      const x = rect.left - containerRect.left;
      const y = rect.top - containerRect.top;
      
      if (containerRef.current) {
        containerRef.current.style.left = `${x}px`;
        containerRef.current.style.top = `${y}px`;
      }
      
      // Also update position state if it's different (but don't trigger applyChanges)
      if (Math.abs(position.x - x) > 1 || Math.abs(position.y - y) > 1) {
        setPosition({ x, y });
      }
    };
    
    // Update immediately
    updateEditorPosition();
    
    // Update on scroll/resize (less frequently to avoid conflicts)
    const intervalId = setInterval(updateEditorPosition, 100);
    window.addEventListener('resize', updateEditorPosition);
    window.addEventListener('scroll', updateEditorPosition, true);
    
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('resize', updateEditorPosition);
      window.removeEventListener('scroll', updateEditorPosition, true);
    };
  }, [imageElement, position]);

  // Handle dimension input changes
  const handleDimensionChange = useCallback((field, value) => {
    const numValue = parseFloat(value) || 0;
    if (numValue <= 0) return;
    
    if (field === 'width') {
      let newWidth = numValue;
      let newHeight = dimensions.height;
      
      if (aspectRatioLocked && originalDimensions.width && originalDimensions.height) {
        const ratio = originalDimensions.width / originalDimensions.height;
        newHeight = newWidth / ratio;
      }
      
      setDimensions({ width: newWidth, height: newHeight });
    } else {
      let newHeight = numValue;
      let newWidth = dimensions.width;
      
      if (aspectRatioLocked && originalDimensions.width && originalDimensions.height) {
        const ratio = originalDimensions.width / originalDimensions.height;
        newWidth = newHeight * ratio;
      }
      
      setDimensions({ width: newWidth, height: newHeight });
    }
  }, [dimensions, aspectRatioLocked, originalDimensions]);

  // Apply changes when dimensions change
  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      const timeoutId = setTimeout(() => {
        applyChanges();
      }, 300); // Debounce
      return () => clearTimeout(timeoutId);
    }
  }, [dimensions, applyChanges]);

  if (!imageElement || !editMode) return null;

  const handles = [
    'top-left', 'top', 'top-right',
    'left', 'right',
    'bottom-left', 'bottom', 'bottom-right'
  ];

  // Get current position from image element
  const getCurrentPosition = () => {
    if (!imageElement) return { x: 0, y: 0 };
    
    const rect = imageElement.getBoundingClientRect();
    const canvasContainer = imageElement.closest('.canvas-wrapper') || 
                           imageElement.closest('.gjs-cv-canvas') ||
                           imageElement.offsetParent ||
                           document.body;
    const containerRect = canvasContainer.getBoundingClientRect();
    
    return {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top
    };
  };

  const currentPos = getCurrentPosition();

  return (
    <div 
      ref={containerRef}
      className="inline-image-editor"
      style={{
        position: 'absolute',
        left: `${currentPos.x}px`,
        top: `${currentPos.y}px`,
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        border: '2px solid #2196F3',
        boxSizing: 'border-box',
        zIndex: 1000,
        pointerEvents: 'auto'
      }}
    >
      {/* Image with crop overlay */}
      <div 
        ref={imageRef}
        className="editor-image-container"
        onMouseDown={(e) => {
          if (isCropping) {
            handleCropStart(e);
          } else if (!isResizingRef.current) {
            handleDragStart(e);
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          cursor: isCropping ? 'crosshair' : (isDragging ? 'move' : 'default')
        }}
      >
        {imageElement && (
          <img
            src={imageElement.src}
            alt={imageElement.alt || ''}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `rotate(${rotation}deg)`,
              display: 'block'
            }}
            draggable={false}
          />
        )}
        
        {/* Crop area overlay */}
        {cropArea && cropArea.width > 0 && cropArea.height > 0 && (
          <div
            className="crop-overlay"
            style={{
              position: 'absolute',
              left: `${cropArea.x}px`,
              top: `${cropArea.y}px`,
              width: `${cropArea.width}px`,
              height: `${cropArea.height}px`,
              border: '2px dashed #4CAF50',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              boxSizing: 'border-box',
              pointerEvents: 'none'
            }}
          />
        )}
      </div>

      {/* Resize handles */}
      {handles.map(handle => (
        <div
          key={handle}
          className={`resize-handle resize-handle-${handle}`}
          onMouseDown={(e) => handleResizeStart(e, handle)}
          style={{
            position: 'absolute',
            width: '12px',
            height: '12px',
            backgroundColor: '#2196F3',
            border: '2px solid white',
            borderRadius: '50%',
            cursor: `${handle}-resize`,
            zIndex: 1001
          }}
        />
      ))}

      {/* Control panel */}
      <div className="image-editor-controls">
        <div className="controls-row">
          <label>
            Width:
            <input
              type="number"
              value={Math.round(dimensions.width)}
              onChange={(e) => handleDimensionChange('width', e.target.value)}
              min="50"
              step="1"
            />
          </label>
          <label>
            Height:
            <input
              type="number"
              value={Math.round(dimensions.height)}
              onChange={(e) => handleDimensionChange('height', e.target.value)}
              min="50"
              step="1"
            />
          </label>
        </div>
        
        <div className="controls-row">
          <label>
            <input
              type="checkbox"
              checked={aspectRatioLocked}
              onChange={(e) => setAspectRatioLocked(e.target.checked)}
            />
            Lock Aspect Ratio
          </label>
        </div>
        
        <div className="controls-row">
          <label>
            Position X:
            <input
              type="number"
              value={Math.round(position.x)}
              onChange={(e) => {
                const newX = parseFloat(e.target.value) || 0;
                setPosition(prev => ({ ...prev, x: newX }));
              }}
              onBlur={applyChanges}
              step="1"
            />
          </label>
          <label>
            Position Y:
            <input
              type="number"
              value={Math.round(position.y)}
              onChange={(e) => {
                const newY = parseFloat(e.target.value) || 0;
                setPosition(prev => ({ ...prev, y: newY }));
              }}
              onBlur={applyChanges}
              step="1"
            />
          </label>
        </div>
        
        <div className="controls-row">
          <label>
            Rotation:
            <input
              type="range"
              min="-180"
              max="180"
              value={rotation}
              onChange={(e) => {
                setRotation(parseFloat(e.target.value));
                applyChanges();
              }}
            />
            <span>{rotation}°</span>
          </label>
        </div>
        
        <div className="controls-row">
          <button onClick={() => setIsCropping(!isCropping)}>
            {isCropping ? 'Finish Crop' : 'Crop'}
          </button>
          <button onClick={() => {
            setRotation(0);
            setDimensions(originalDimensions);
            setPosition({ x: 0, y: 0 });
            setCropArea(null);
            applyChanges();
          }}>
            Reset
          </button>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default InlineImageEditor;

