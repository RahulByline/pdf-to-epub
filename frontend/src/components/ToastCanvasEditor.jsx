import React, { useEffect, useRef, useState, useCallback } from 'react';
import ImageEditor from '@toast-ui/react-image-editor';
import 'tui-image-editor/dist/tui-image-editor.css';
import { useDrop } from 'react-dnd';
import './ToastCanvasEditor.css';

const DRAG_TYPE = 'EPUB_IMAGE';

const ToastCanvasEditor = ({
  xhtml,
  images = [],
  onXhtmlChange,
  jobId,
  pageNumber,
}) => {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const [editorInstance, setEditorInstance] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(null);
  const [droppedImages, setDroppedImages] = useState([]);
  const cleanupRef = useRef({ keyboard: null, doubleClick: null });

  // Helper function to add image to editor
  const addImageToEditor = useCallback(async (imageUrl, left = 200, top = 200) => {
    if (!editorInstance) {
      alert('Editor not ready yet');
      return;
    }

    try {
      const fabricCanvas = editorInstance._graphics && editorInstance._graphics._canvas;
      if (!fabricCanvas) {
        throw new Error('Canvas not available');
      }

      // Load the image
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });

      // Calculate reasonable size
      const maxSize = 400;
      let targetWidth = Math.min(img.width, maxSize);
      let targetHeight = Math.min(img.height, maxSize);
      
      if (targetWidth / targetHeight !== img.width / img.height) {
        // Maintain aspect ratio
        if (img.width > img.height) {
          targetHeight = targetWidth / (img.width / img.height);
        } else {
          targetWidth = targetHeight * (img.width / img.height);
        }
      }

      const scaleX = targetWidth / img.width;
      const scaleY = targetHeight / img.height;

      // Try to add using TOAST UI's graphics
      const graphics = editorInstance._graphics;
      
      if (graphics && typeof graphics.addImageObject === 'function') {
        const addedObject = await graphics.addImageObject(imageUrl, {
          left: left,
          top: top,
          scaleX: scaleX,
          scaleY: scaleY,
        });
        
        if (addedObject) {
          // Set as active after a short delay to ensure it's fully added
          setTimeout(() => {
            try {
              if (addedObject && typeof fabricCanvas.setActiveObject === 'function') {
                fabricCanvas.setActiveObject(addedObject);
                fabricCanvas.renderAll();
              }
            } catch (error) {
              console.warn('[ToastCanvasEditor] Could not set active object:', error);
            }
          }, 100);
          fabricCanvas.renderAll();
          console.log('[ToastCanvasEditor] Image added via Add Image button');
          return;
        }
      }

      // Fallback: Use Fabric directly
      const Fabric = graphics?._fabric || window.fabric;
      if (Fabric && Fabric.Image) {
        const fabricImage = new Fabric.Image(img, {
          left: left,
          top: top,
          scaleX: scaleX,
          scaleY: scaleY,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
        });
        
        fabricCanvas.add(fabricImage);
        // Set as active after a short delay to ensure it's fully added
        setTimeout(() => {
          try {
            if (fabricImage && typeof fabricCanvas.setActiveObject === 'function') {
              fabricCanvas.setActiveObject(fabricImage);
              fabricCanvas.renderAll();
            }
          } catch (error) {
            console.warn('[ToastCanvasEditor] Could not set active object:', error);
          }
        }, 100);
        fabricCanvas.renderAll();
        console.log('[ToastCanvasEditor] Image added via Fabric.js');
      } else {
        throw new Error('Could not access Fabric.js');
      }
    } catch (error) {
      console.error('[ToastCanvasEditor] Error adding image:', error);
      alert('Failed to add image: ' + error.message);
    }
  }, [editorInstance]);

  // Extract placeholders and text elements from XHTML with accurate positioning
  const extractEditableElements = useCallback((xhtmlContent) => {
    if (!xhtmlContent) return { placeholders: [], textElements: [] };
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtmlContent, 'text/html');
      const placeholders = [];
      const textElements = [];
      
      // Helper to parse style attribute and extract values
      const parseStyle = (styleStr) => {
        const styles = {};
        if (!styleStr) return styles;
        
        styleStr.split(';').forEach(rule => {
          const [key, value] = rule.split(':').map(s => s.trim());
          if (key && value) {
            styles[key] = value;
          }
        });
        return styles;
      };
      
      // Helper to extract pixel value from style
      const extractPx = (value) => {
        if (!value) return 0;
        const match = value.toString().match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : 0;
      };
      
      // Create temporary container to get actual computed positions
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.width = '800px';
      tempContainer.style.backgroundColor = 'white';
      tempContainer.innerHTML = xhtmlContent;
      document.body.appendChild(tempContainer);
      
      // Find placeholder containers (divs with borders, dashed borders, or container classes)
      const allDivs = tempContainer.querySelectorAll('div');
      allDivs.forEach((div, index) => {
        const style = div.getAttribute('style') || '';
        const id = div.id || '';
        const className = div.className || '';
        const styles = parseStyle(style);
        
        // Check for borders or container indicators
        const hasBorder = (style.includes('border') && !style.includes('border: none') && !style.includes('border: 0')) ||
                         styles.border || styles['border-width'];
        const hasDashedBorder = style.includes('dashed') || styles['border-style'] === 'dashed';
        const isContainer = hasBorder || hasDashedBorder || 
                           id.includes('container') || className.includes('container') ||
                           id.includes('placeholder') || className.includes('placeholder');
        
        if (isContainer) {
          // Get actual computed position and size from rendered element
          const rect = div.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(div);
          
          const width = rect.width || extractPx(computedStyle.width) || extractPx(styles.width) || 300;
          const height = rect.height || extractPx(computedStyle.height) || extractPx(styles.height) || 200;
          const left = rect.left - tempContainer.getBoundingClientRect().left || extractPx(styles.left) || extractPx(computedStyle.left) || 0;
          const top = rect.top - tempContainer.getBoundingClientRect().top || extractPx(styles.top) || extractPx(computedStyle.top) || 0;
          
          placeholders.push({
            id: id || `placeholder_${index}`,
            className: className,
            left: Math.max(0, left),
            top: Math.max(0, top),
            width: Math.max(50, width),
            height: Math.max(50, height),
            border: hasDashedBorder ? 'dashed' : 'solid',
            element: div,
            originalStyle: style,
          });
        }
      });
      
      // Find text elements with accurate positioning
      const allTextElements = tempContainer.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div');
      allTextElements.forEach((elem, index) => {
        // Skip if it's already a placeholder or contains images
        if (elem.closest('div[style*="border"]') || elem.querySelector('img')) return;
        
        const text = elem.textContent?.trim() || '';
        if (text && text.length > 0) {
          const style = elem.getAttribute('style') || '';
          const styles = parseStyle(style);
          const computedStyle = window.getComputedStyle(elem);
          
          // Get actual position
          const rect = elem.getBoundingClientRect();
          const left = rect.left - tempContainer.getBoundingClientRect().left || extractPx(styles.left) || extractPx(computedStyle.left) || 0;
          const top = rect.top - tempContainer.getBoundingClientRect().top || extractPx(styles.top) || extractPx(computedStyle.top) || 0;
          
          // Extract font properties
          const fontSize = extractPx(computedStyle.fontSize) || extractPx(styles['font-size']) || 16;
          const fontFamily = computedStyle.fontFamily || styles['font-family'] || 'Arial';
          const color = computedStyle.color || styles.color || '#000000';
          
          textElements.push({
            id: elem.id || `text_${index}`,
            text: text,
            left: Math.max(0, left),
            top: Math.max(0, top),
            fontSize: Math.max(10, fontSize),
            fontFamily: fontFamily.replace(/['"]/g, '').split(',')[0].trim(), // Get first font family
            fill: color,
            element: elem,
            originalStyle: style,
          });
        }
      });
      
      // Clean up temporary container
      document.body.removeChild(tempContainer);
      
      console.log('[ToastCanvasEditor] Extracted elements:', {
        placeholders: placeholders.length,
        textElements: textElements.length,
        placeholderDetails: placeholders.map(p => ({ id: p.id, left: p.left, top: p.top, width: p.width, height: p.height })),
        textDetails: textElements.map(t => ({ id: t.id, text: t.text.substring(0, 30), left: t.left, top: t.top }))
      });
      
      return { placeholders, textElements };
    } catch (error) {
      console.error('[ToastCanvasEditor] Error extracting editable elements:', error);
      return { placeholders: [], textElements: [] };
    }
  }, []);

  // Convert XHTML to image for TOAST UI editor
  useEffect(() => {
    const convertXhtmlToImage = async () => {
      try {
        // Create a temporary container to render XHTML
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.width = '800px';
        tempDiv.style.backgroundColor = 'white';
        tempDiv.innerHTML = xhtml;
        document.body.appendChild(tempDiv);

        // Wait for images to load
        const images = tempDiv.querySelectorAll('img');
        const imagePromises = Array.from(images).map(img => {
          return new Promise((resolve) => {
            if (img.complete) {
              resolve();
            } else {
              img.onload = resolve;
              img.onerror = resolve;
            }
          });
        });
        await Promise.all(imagePromises);

        // Use html2canvas to convert to image
        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(tempDiv, {
          backgroundColor: '#ffffff',
          scale: 1,
          useCORS: true,
          logging: false,
        });

        const dataURL = canvas.toDataURL('image/png');
        setBackgroundImageUrl(dataURL);
        document.body.removeChild(tempDiv);
      } catch (error) {
        console.error('[ToastCanvasEditor] Error converting XHTML to image:', error);
        // Fallback: create a blank canvas
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 1000;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        setBackgroundImageUrl(canvas.toDataURL('image/png'));
      }
    };

    if (xhtml) {
      convertXhtmlToImage();
    }
  }, [xhtml]);

  // Editor configuration
  const editorOptions = {
    includeUI: {
      loadImage: {
        path: backgroundImageUrl || '',
        name: `Page_${pageNumber}`,
      },
      theme: {
        'common.bi.image': '',
        'common.bisize.width': '0px',
        'common.bisize.height': '0px',
        'common.backgroundImage': 'none',
        'common.backgroundColor': '#f5f5f5',
        'common.border': '1px solid #e0e0e0',
      },
      menu: [
        'crop',
        'flip',
        'rotate',
        'draw',
        'shape',
        'icon',
        'text',
        'filter',
      ],
      initMenu: 'icon', // Start with icon menu to make it more visible
      uiSize: {
        width: '100%',
        height: '100%',
      },
      menuBarPosition: 'bottom',
      // Ensure all menus are visible
      menuBarVisibility: true,
    },
    cssMaxWidth: window.innerWidth,
    cssMaxHeight: window.innerHeight,
    selectionStyle: {
      cornerSize: 20,
      rotatingPointOffset: 70,
      cornerStyle: 'circle',
      cornerColor: '#2196F3',
      borderColor: '#2196F3',
    },
    usageStatistics: false,
    // Enable grid for better alignment
    // Note: TOAST UI doesn't have built-in grid, but we'll add it via canvas configuration
  };

  // Handle editor ready
  useEffect(() => {
    if (!backgroundImageUrl) return;

    const timer = setTimeout(() => {
      if (editorRef.current && editorRef.current.getInstance) {
        try {
          const instance = editorRef.current.getInstance();
          setEditorInstance(instance);
          setImageLoaded(true);
          
          // Disable double-click text addition
          try {
            const fabricCanvas = instance._graphics && instance._graphics._canvas;
            if (fabricCanvas) {
              // Prevent double-click from automatically adding text
              // Method 1: Intercept and remove auto-generated "Double Click" text
              const removeDoubleClickText = (e) => {
                const obj = e.target;
                if (obj && (obj.type === 'i-text' || obj.type === 'text')) {
                  const textContent = obj.text || '';
                  // Only remove the default "Double Click" placeholder text
                  // Allow user-added text from the text menu
                  if (textContent === 'Double Click') {
                    setTimeout(() => {
                      if (fabricCanvas.getObjects().includes(obj) && obj.text === 'Double Click') {
                        fabricCanvas.remove(obj);
                        fabricCanvas.renderAll();
                        console.log('[ToastCanvasEditor] Removed auto-generated "Double Click" text');
                      }
                    }, 50);
                  }
                }
              };
              
              fabricCanvas.on('object:added', removeDoubleClickText);
              
              // Method 2: Prevent double-click event from triggering text addition
              // Override the double-click handler
              const originalDblClick = fabricCanvas._onDoubleClick;
              if (originalDblClick) {
                fabricCanvas._onDoubleClick = function(e) {
                  // Prevent the default double-click text addition behavior
                  console.log('[ToastCanvasEditor] Double-click intercepted - preventing auto text addition');
                  // Don't call the original handler
                  return false;
                };
              }
              
              // Method 3: Also prevent at DOM level for canvas area only
              const editorElement = editorRef.current?.getRootElement?.();
              if (editorElement) {
                const handleDblClick = (e) => {
                  const target = e.target;
                  // Only prevent on canvas, not on UI controls
                  if (target && target.tagName === 'CANVAS') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    console.log('[ToastCanvasEditor] DOM double-click prevented on canvas');
                    return false;
                  }
                };
                // Use capture phase to intercept before TOAST UI handles it
                editorElement.addEventListener('dblclick', handleDblClick, true);
                
                // Store cleanup function in ref
                cleanupRef.current.doubleClick = () => {
                  editorElement.removeEventListener('dblclick', handleDblClick, true);
                };
              }
              
              console.log('[ToastCanvasEditor] Double-click text addition disabled');
            }
          } catch (configError) {
            console.warn('[ToastCanvasEditor] Could not disable double-click:', configError);
          }
          
          // Enhance object movement and positioning
          try {
            const fabricCanvas = instance._graphics && instance._graphics._canvas;
            if (fabricCanvas) {
              // Enable snap to grid for precise positioning
              const gridSize = 10; // 10px grid
              let isSnapToGrid = true;
              
              // Override object movement to add snap-to-grid
              const originalSet = fabricCanvas.setActiveObject.bind(fabricCanvas);
              fabricCanvas.setActiveObject = function(object) {
                // First call the original method
                const result = originalSet(object);
                
                // Then apply snap-to-grid if object is valid and has set method
                if (object && isSnapToGrid && typeof object.set === 'function') {
                  try {
                    // Snap object position to grid when selected
                    const currentLeft = object.left || 0;
                    const currentTop = object.top || 0;
                    object.set({
                      left: Math.round(currentLeft / gridSize) * gridSize,
                      top: Math.round(currentTop / gridSize) * gridSize,
                    });
                    fabricCanvas.renderAll();
                  } catch (snapError) {
                    console.warn('[ToastCanvasEditor] Error snapping to grid:', snapError);
                  }
                }
                
                return result;
              };
              
              // Listen for object movement events to enable snap-to-grid
              fabricCanvas.on('object:moving', (e) => {
                if (isSnapToGrid && e.target) {
                  const obj = e.target;
                  // Snap to grid while moving
                  obj.set({
                    left: Math.round(obj.left / gridSize) * gridSize,
                    top: Math.round(obj.top / gridSize) * gridSize,
                  });
                }
              });
              
              // Listen for object modified to ensure final position is snapped
              fabricCanvas.on('object:modified', (e) => {
                if (isSnapToGrid && e.target) {
                  const obj = e.target;
                  obj.set({
                    left: Math.round(obj.left / gridSize) * gridSize,
                    top: Math.round(obj.top / gridSize) * gridSize,
                  });
                  fabricCanvas.renderAll();
                }
              });
              
              // Add keyboard shortcuts for precise movement
              const handleKeyDown = (e) => {
                const activeObject = fabricCanvas.getActiveObject();
                if (!activeObject) return;
                
                const moveStep = e.shiftKey ? gridSize * 5 : gridSize; // Shift = 5x faster
                
                switch(e.key) {
                  case 'ArrowUp':
                    e.preventDefault();
                    activeObject.set('top', activeObject.top - moveStep);
                    fabricCanvas.renderAll();
                    break;
                  case 'ArrowDown':
                    e.preventDefault();
                    activeObject.set('top', activeObject.top + moveStep);
                    fabricCanvas.renderAll();
                    break;
                  case 'ArrowLeft':
                    e.preventDefault();
                    activeObject.set('left', activeObject.left - moveStep);
                    fabricCanvas.renderAll();
                    break;
                  case 'ArrowRight':
                    e.preventDefault();
                    activeObject.set('left', activeObject.left + moveStep);
                    fabricCanvas.renderAll();
                    break;
                }
              };
              
              // Add keyboard event listener
              window.addEventListener('keydown', handleKeyDown);
              
              // Store cleanup in ref
              cleanupRef.current.keyboard = () => {
                window.removeEventListener('keydown', handleKeyDown);
              };
              
              // Toggle snap to grid function (accessible via console or can add UI button)
              instance._toggleSnapToGrid = () => {
                isSnapToGrid = !isSnapToGrid;
                console.log('[ToastCanvasEditor] Snap to grid:', isSnapToGrid ? 'ON' : 'OFF');
                return isSnapToGrid;
              };
              
              // Make objects more easily selectable
              fabricCanvas.on('mouse:down', (e) => {
                // Ensure objects are selectable
                if (e.target) {
                  e.target.set({
                    selectable: true,
                    evented: true,
                  });
                }
              });
              
              console.log('[ToastCanvasEditor] Enhanced movement enabled:');
              console.log('  - Snap to 10px grid (use arrow keys for precise movement)');
              console.log('  - Shift + Arrow keys for 5x faster movement');
              console.log('  - Click and drag to move objects');
            }
          } catch (enhanceError) {
            console.warn('[ToastCanvasEditor] Could not enhance movement:', enhanceError);
          }
          
          // Convert placeholders and text from XHTML to editable objects
          try {
            const fabricCanvas = instance._graphics && instance._graphics._canvas;
            if (fabricCanvas) {
              const { placeholders, textElements } = extractEditableElements(xhtml);
              const Fabric = instance._graphics?._fabric || window.fabric;
              
              if (Fabric) {
                // Add placeholder containers as editable rectangles
                placeholders.forEach((placeholder) => {
                  try {
                    const rect = new Fabric.Rect({
                      left: placeholder.left,
                      top: placeholder.top,
                      width: placeholder.width,
                      height: placeholder.height,
                      fill: 'rgba(255, 255, 255, 0.1)', // Slight fill to make it visible
                      stroke: placeholder.border === 'dashed' ? '#999999' : '#2196F3',
                      strokeWidth: 2,
                      strokeDashArray: placeholder.border === 'dashed' ? [10, 5] : undefined,
                      selectable: true,
                      evented: true,
                      hasControls: true,
                      hasBorders: true,
                      lockMovementX: false,
                      lockMovementY: false,
                      lockRotation: false,
                      lockScalingX: false,
                      lockScalingY: false,
                      name: `placeholder_${placeholder.id}`,
                      customData: { 
                        type: 'placeholder', 
                        id: placeholder.id, 
                        className: placeholder.className,
                        original: placeholder 
                      },
                    });
                    
                    fabricCanvas.add(rect);
                    console.log('[ToastCanvasEditor] Added editable placeholder:', {
                      id: placeholder.id,
                      position: { left: placeholder.left, top: placeholder.top },
                      size: { width: placeholder.width, height: placeholder.height },
                      border: placeholder.border
                    });
                  } catch (error) {
                    console.warn('[ToastCanvasEditor] Error adding placeholder:', error);
                  }
                });
                
                // Add text elements as editable text objects
                textElements.forEach((textElem) => {
                  try {
                    const text = new Fabric.Text(textElem.text, {
                      left: textElem.left,
                      top: textElem.top,
                      fontSize: textElem.fontSize,
                      fontFamily: textElem.fontFamily,
                      fill: textElem.fill,
                      selectable: true,
                      evented: true,
                      hasControls: true,
                      hasBorders: true,
                      lockMovementX: false,
                      lockMovementY: false,
                      lockRotation: false,
                      lockScalingX: false,
                      lockScalingY: false,
                      editable: true, // Allow text editing
                      name: `text_${textElem.id}`,
                      customData: { 
                        type: 'text', 
                        id: textElem.id, 
                        original: textElem 
                      },
                    });
                    
                    fabricCanvas.add(text);
                    console.log('[ToastCanvasEditor] Added editable text:', {
                      id: textElem.id,
                      text: textElem.text.substring(0, 50),
                      position: { left: textElem.left, top: textElem.top },
                      fontSize: textElem.fontSize,
                      fontFamily: textElem.fontFamily,
                      color: textElem.fill
                    });
                  } catch (error) {
                    console.warn('[ToastCanvasEditor] Error adding text:', error);
                  }
                });
                
                fabricCanvas.renderAll();
                console.log('[ToastCanvasEditor] Added', placeholders.length, 'placeholders and', textElements.length, 'text elements as editable objects');
              }
            }
          } catch (editableError) {
            console.warn('[ToastCanvasEditor] Could not add editable elements:', editableError);
          }
          
          // TOAST UI Image Editor handles object movement by default
          console.log('[ToastCanvasEditor] Editor ready - objects are movable by default');
        } catch (error) {
          console.error('[ToastCanvasEditor] Error getting instance:', error);
        }
      }
    }, 1000);

    return () => {
      clearTimeout(timer);
      // Cleanup event listeners
      try {
        if (cleanupRef.current.keyboard) {
          cleanupRef.current.keyboard();
          cleanupRef.current.keyboard = null;
        }
        if (cleanupRef.current.doubleClick) {
          cleanupRef.current.doubleClick();
          cleanupRef.current.doubleClick = null;
        }
      } catch (cleanupError) {
        console.warn('[ToastCanvasEditor] Cleanup error:', cleanupError);
      }
    };
  }, [backgroundImageUrl]);

  // Detect container at drop position using canvas analysis
  const detectContainerAtPosition = useCallback((x, y, fabricCanvas) => {
    if (!fabricCanvas) return null;
    
    try {
      // Get all objects on canvas to find container-like shapes
      const objects = fabricCanvas.getObjects();
      
      // Look for rectangles or shapes that might be containers
      // Containers are often large rectangles with borders
      for (const obj of objects) {
        if (obj.type === 'rect' || obj.type === 'group') {
          const objLeft = obj.left || 0;
          const objTop = obj.top || 0;
          const objWidth = (obj.width || 0) * (obj.scaleX || 1);
          const objHeight = (obj.height || 0) * (obj.scaleY || 1);
          
          // Check if drop position is within this object
          if (x >= objLeft && x <= objLeft + objWidth &&
              y >= objTop && y <= objTop + objHeight) {
            // This looks like a container
            return {
              left: objLeft,
              top: objTop,
              width: objWidth,
              height: objHeight,
            };
          }
        }
      }
      
      // If no container found, estimate based on common container sizes
      // Large left panel: ~400x600, Right panels: ~300x200
      const canvasSize = fabricCanvas.getWidth && fabricCanvas.getHeight ? 
        { width: fabricCanvas.getWidth(), height: fabricCanvas.getHeight() } :
        { width: 800, height: 1000 };
      
      // Check if dropped in left half (large container)
      if (x < canvasSize.width * 0.6) {
        return {
          left: 20,
          top: 100,
          width: canvasSize.width * 0.5 - 40,
          height: canvasSize.height * 0.6,
        };
      } else {
        // Right side - smaller containers
        if (y < canvasSize.height * 0.5) {
          return {
            left: canvasSize.width * 0.55,
            top: 100,
            width: canvasSize.width * 0.4 - 40,
            height: canvasSize.height * 0.35,
          };
        } else {
          return {
            left: canvasSize.width * 0.55,
            top: canvasSize.height * 0.5 + 20,
            width: canvasSize.width * 0.4 - 40,
            height: canvasSize.height * 0.35,
          };
        }
      }
    } catch (error) {
      console.error('[ToastCanvasEditor] Error detecting container:', error);
      return null;
    }
  }, []);

  // Handle image drop from gallery
  const [{ isOver }, drop] = useDrop({
    accept: DRAG_TYPE,
    drop: async (item, monitor) => {
      if (!editorInstance || !item.image) {
        console.warn('[ToastCanvasEditor] Editor not ready or no image in drop item');
        return;
      }

      try {
        const image = item.image;
        const dropResult = monitor.getDropResult();
        const clientOffset = monitor.getClientOffset();
        
        console.log('[ToastCanvasEditor] Dropping image:', image.fileName, image.url, {
          dropResult,
          clientOffset
        });
        
        // Get drop position relative to canvas and detect container
        let containerDimensions = null;
        let dropX = 100;
        let dropY = 100;
        
        try {
          const fabricCanvas = editorInstance._graphics && editorInstance._graphics._canvas;
          
          if (clientOffset && fabricCanvas) {
            // Get canvas position
            const editorElement = editorRef.current?.getRootElement?.();
            if (editorElement) {
              const canvasContainer = editorElement.querySelector('.tui-image-editor-canvas-container') ||
                                     editorElement.querySelector('canvas')?.parentElement;
              
              if (canvasContainer) {
                const canvasRect = canvasContainer.getBoundingClientRect();
                dropX = clientOffset.x - canvasRect.left;
                dropY = clientOffset.y - canvasRect.top;
                
                // Detect container at drop position
                containerDimensions = detectContainerAtPosition(dropX, dropY, fabricCanvas);
                
                if (containerDimensions) {
                  console.log('[ToastCanvasEditor] Detected container at drop position:', containerDimensions);
                }
              }
            }
          }
        } catch (containerError) {
          console.warn('[ToastCanvasEditor] Could not detect container:', containerError);
        }
        
        // Add image to TOAST UI editor
        try {
          const fabricCanvas = editorInstance._graphics && editorInstance._graphics._canvas;
          
          if (fabricCanvas) {
            // Load the image
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = image.url;
            });
            
            // Calculate dimensions to fit container
            let targetWidth = Math.min(img.width, 400);
            let targetHeight = Math.min(img.height, 400);
            let targetLeft = dropX;
            let targetTop = dropY;
            
            if (containerDimensions) {
              // Fit image to container while maintaining aspect ratio
              const containerAspect = containerDimensions.width / containerDimensions.height;
              const imageAspect = img.width / img.height;
              
              if (imageAspect > containerAspect) {
                // Image is wider - fit to width
                targetWidth = containerDimensions.width * 0.9; // 90% to leave some padding
                targetHeight = targetWidth / imageAspect;
              } else {
                // Image is taller - fit to height
                targetHeight = containerDimensions.height * 0.9; // 90% to leave some padding
                targetWidth = targetHeight * imageAspect;
              }
              
              // Center in container
              targetLeft = containerDimensions.left + (containerDimensions.width - targetWidth) / 2;
              targetTop = containerDimensions.top + (containerDimensions.height - targetHeight) / 2;
              
              console.log('[ToastCanvasEditor] Image will be fitted to container:', {
                original: { width: img.width, height: img.height },
                fitted: { width: targetWidth, height: targetHeight },
                position: { left: targetLeft, top: targetTop },
                container: containerDimensions
              });
            } else {
              // No container detected - use drop position with reasonable size
              targetWidth = Math.min(img.width, 300);
              targetHeight = Math.min(img.height, 300);
              if (targetWidth / targetHeight !== img.width / img.height) {
                // Maintain aspect ratio
                if (img.width > img.height) {
                  targetHeight = targetWidth / (img.width / img.height);
                } else {
                  targetWidth = targetHeight * (img.width / img.height);
                }
              }
            }
            
            // Calculate scale factors
            const scaleX = targetWidth / img.width;
            const scaleY = targetHeight / img.height;
            
            // Use TOAST UI's graphics module to add image
            try {
              const graphics = editorInstance._graphics;
              
              // Method 1: Try using TOAST UI's addImageObject if available
              if (graphics && typeof graphics.addImageObject === 'function') {
                const addedObject = await graphics.addImageObject(image.url, {
                  left: targetLeft,
                  top: targetTop,
                  scaleX: scaleX,
                  scaleY: scaleY,
                });
                
                if (addedObject) {
                  // Set as active after a short delay to ensure it's fully added
                  setTimeout(() => {
                    try {
                      if (addedObject && typeof fabricCanvas.setActiveObject === 'function') {
                        fabricCanvas.setActiveObject(addedObject);
                        fabricCanvas.renderAll();
                      }
                    } catch (error) {
                      console.warn('[ToastCanvasEditor] Could not set active object:', error);
                    }
                  }, 100);
                  fabricCanvas.renderAll();
                  console.log('[ToastCanvasEditor] Image added and fitted to container via TOAST UI API');
                  setDroppedImages(prev => [...prev, image]);
                  return;
                }
              }
              
              // Method 2: Use fabric.js directly (TOAST UI's internal fabric instance)
              // Access fabric from TOAST UI's graphics
              const Fabric = graphics?._fabric || window.fabric;
              
              if (Fabric && Fabric.Image) {
                const fabricImage = new Fabric.Image(img, {
                  left: targetLeft,
                  top: targetTop,
                  scaleX: scaleX,
                  scaleY: scaleY,
                  selectable: true,
                  evented: true,
                  hasControls: true,
                  hasBorders: true,
                });
                
        fabricCanvas.add(fabricImage);
        // Set as active after a short delay to ensure it's fully added
        setTimeout(() => {
          try {
            if (fabricImage && typeof fabricCanvas.setActiveObject === 'function') {
              fabricCanvas.setActiveObject(fabricImage);
              fabricCanvas.renderAll();
            }
          } catch (error) {
            console.warn('[ToastCanvasEditor] Could not set active object:', error);
          }
        }, 100);
        fabricCanvas.renderAll();
        
        console.log('[ToastCanvasEditor] Image added and fitted to container via Fabric.js');
                setDroppedImages(prev => [...prev, image]);
                return;
              }
              
              throw new Error('Could not access Fabric.js from TOAST UI');
            } catch (addError) {
              console.error('[ToastCanvasEditor] Error adding image:', addError);
              // Fallback: Show instructions
              alert(
                `Image "${image.fileName}" dropped!\n\n` +
                `Container detected! To add and fit this image:\n` +
                `1. Click the "Icon" menu in the editor\n` +
                `2. Select "Custom Image"\n` +
                `3. Paste: ${image.url}\n` +
                `4. The image will be added - resize to fit your container`
              );
              
              setDroppedImages(prev => [...prev, image]);
            }
          } else {
            throw new Error('Fabric canvas not available');
          }
        } catch (error) {
          console.error('[ToastCanvasEditor] Error adding image:', error);
          alert(`Image "${image.fileName}" dropped!\n\nUse the editor's "Icon" menu to add images.\nImage URL: ${image.url}`);
          setDroppedImages(prev => [...prev, image]);
        }
      } catch (error) {
        console.error('[ToastCanvasEditor] Error processing dropped image:', error);
        alert('Failed to process dropped image: ' + (error.message || 'Unknown error'));
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  // Handle save - convert editor content back to XHTML
  const handleSave = useCallback(() => {
    if (!editorInstance) {
      alert('Editor not ready yet. Please wait a moment.');
      return;
    }

    try {
      const fabricCanvas = editorInstance._graphics && editorInstance._graphics._canvas;
      if (!fabricCanvas) {
        throw new Error('Canvas not available');
      }

      // Get all objects from canvas
      const objects = fabricCanvas.getObjects();
      
      // Get edited canvas as data URL (this includes all edits: text, images, filters, etc.)
      const dataURL = editorInstance.toDataURL();
      
      // Get canvas dimensions
      const canvasSize = editorInstance.getCanvasSize();
      
      console.log('[ToastCanvasEditor] Saving canvas:', {
        width: canvasSize.width,
        height: canvasSize.height,
        dataURLLength: dataURL.length,
        objectCount: objects.length
      });

      // Convert edited canvas back to XHTML
      if (onXhtmlChange) {
        // Create updated XHTML with the edited canvas image
        const parser = new DOMParser();
        let doc = parser.parseFromString(xhtml, 'text/html');
        let parserError = doc.querySelector('parsererror');
        if (parserError) {
          doc = parser.parseFromString(xhtml, 'application/xml');
        }

        // Update body with edited canvas content
        const body = doc.body || doc.querySelector('body');
        if (body) {
          // Clear existing content
          body.innerHTML = '';
          
          // Reconstruct placeholders and text from canvas objects
          const placeholders = [];
          const textElements = [];
          const images = [];
          
          objects.forEach((obj) => {
            const customData = obj.customData || {};
            
            if (customData.type === 'placeholder') {
              // Reconstruct placeholder div
              const placeholderDiv = doc.createElement('div');
              placeholderDiv.setAttribute('id', customData.id || obj.name);
              placeholderDiv.setAttribute('style', 
                `position: absolute; ` +
                `left: ${obj.left}px; ` +
                `top: ${obj.top}px; ` +
                `width: ${obj.width * (obj.scaleX || 1)}px; ` +
                `height: ${obj.height * (obj.scaleY || 1)}px; ` +
                `border: 2px ${customData.original?.border === 'dashed' ? 'dashed' : 'solid'} #999; ` +
                `background: transparent;`
              );
              placeholders.push(placeholderDiv);
            } else if (customData.type === 'text') {
              // Reconstruct text element
              const textElem = doc.createElement('p');
              textElem.setAttribute('id', customData.id || obj.name);
              textElem.setAttribute('style',
                `position: absolute; ` +
                `left: ${obj.left}px; ` +
                `top: ${obj.top}px; ` +
                `font-size: ${obj.fontSize}px; ` +
                `font-family: ${obj.fontFamily || 'Arial'}; ` +
                `color: ${obj.fill || '#000000'};`
              );
              textElem.textContent = obj.text || '';
              textElements.push(textElem);
            } else if (obj.type === 'image') {
              // Store image objects for later
              images.push(obj);
            }
          });
          
          // Add placeholders first
          placeholders.forEach(placeholder => body.appendChild(placeholder));
          
          // Add text elements
          textElements.forEach(textElem => body.appendChild(textElem));
          
          // Add images
          images.forEach((imgObj) => {
            const img = doc.createElement('img');
            // Try to get image source from object
            if (imgObj._element && imgObj._element.src) {
              img.setAttribute('src', imgObj._element.src);
            } else if (imgObj.toDataURL) {
              img.setAttribute('src', imgObj.toDataURL());
            }
            img.setAttribute('style',
              `position: absolute; ` +
              `left: ${imgObj.left}px; ` +
              `top: ${imgObj.top}px; ` +
              `width: ${(imgObj.width || 0) * (imgObj.scaleX || 1)}px; ` +
              `height: ${(imgObj.height || 0) * (imgObj.scaleY || 1)}px;`
            );
            body.appendChild(img);
          });
          
          // Add the edited canvas as background if no other content
          if (placeholders.length === 0 && textElements.length === 0 && images.length === 0) {
            const img = doc.createElement('img');
            img.setAttribute('src', dataURL);
            img.setAttribute('alt', `Edited Page ${pageNumber}`);
            img.setAttribute('style', `width: ${canvasSize.width}px; height: ${canvasSize.height}px; max-width: 100%; height: auto;`);
            img.setAttribute('id', `page${pageNumber}_edited_canvas`);
            body.appendChild(img);
          }
        }

        // Serialize back to XHTML
        const serializer = new XMLSerializer();
        let updatedXhtml = serializer.serializeToString(doc.documentElement);

        // Handle HTML5 parser output
        if (doc.documentElement.tagName === 'HTML' && doc.body) {
          const doctypeMatch = xhtml.match(/<!DOCTYPE[^>]*>/i);
          const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';
          const xmlnsMatch = xhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
          const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';

          const headContent = doc.head ? doc.head.innerHTML : '';
          const bodyContent = doc.body ? doc.body.innerHTML : '';

          updatedXhtml = `${doctype}\n<html xmlns="${xmlns}">\n`;
          if (headContent) {
            updatedXhtml += `<head>\n${headContent}\n</head>\n`;
          }
          updatedXhtml += `<body>\n${bodyContent}\n</body>\n</html>`;
        }

        // Ensure self-closing tags
        updatedXhtml = updatedXhtml.replace(/<meta([^>]*?)>/gi, (match, attrs) => {
          return attrs.includes('/') ? match : `<meta${attrs}/>`;
        });
        updatedXhtml = updatedXhtml.replace(/<img([^>]*?)>/gi, (match, attrs) => {
          return attrs.includes('/') ? match : `<img${attrs}/>`;
        });

        onXhtmlChange(updatedXhtml);
        console.log('[ToastCanvasEditor] XHTML updated successfully');
      }
    } catch (error) {
      console.error('[ToastCanvasEditor] Error saving:', error);
      alert('Failed to save: ' + error.message);
    }
  }, [editorInstance, xhtml, pageNumber, onXhtmlChange]);

  // Expose save method via ref (using useImperativeHandle would require forwardRef)
  // For now, we'll add a save button in the UI
  useEffect(() => {
    if (editorInstance) {
      // Store save handler globally for access from parent if needed
      window.__toastCanvasEditorSave = handleSave;
    }
    return () => {
      delete window.__toastCanvasEditorSave;
    };
  }, [editorInstance, handleSave]);

  return (
    <div 
      ref={(node) => {
        containerRef.current = node;
        drop(node);
      }}
      className="toast-canvas-editor"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: isOver ? 'rgba(33, 150, 243, 0.1)' : 'transparent',
        border: isOver ? '2px dashed #2196F3' : 'none',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {!backgroundImageUrl ? (
        <div className="loading-overlay">
          <div className="loading-spinner">Converting XHTML to image...</div>
        </div>
      ) : (
        <>
          {isOver && (
            <div className="drop-indicator">
              Drop image here to add to editor
            </div>
          )}
          <div className="editor-toolbar" style={{
            padding: '0.5rem 1rem',
            background: 'white',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 10,
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}>
            <div style={{ flex: 1, minWidth: '300px' }}>
              <strong>TOAST UI Editor</strong> - 
              <span style={{ marginLeft: '0.5rem', color: '#666', fontSize: '0.9em' }}>
                Click and drag to move • Arrow keys for precise movement • Shift+Arrow for faster • Snap to 10px grid enabled
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                onClick={async () => {
                  if (!editorInstance) {
                    alert('Editor not ready yet');
                    return;
                  }
                  
                  // Show available images from gallery or prompt for URL
                  if (images && images.length > 0) {
                    const imageList = images.map((img, idx) => `${idx + 1}. ${img.fileName}`).join('\n');
                    const choice = prompt(
                      `Available images:\n${imageList}\n\n` +
                      `Enter image number (1-${images.length}) or paste an image URL:`
                    );
                    
                    if (!choice) return;
                    
                    // Check if it's a number (image index)
                    const imageIndex = parseInt(choice) - 1;
                    if (imageIndex >= 0 && imageIndex < images.length) {
                      // Use gallery image
                      await addImageToEditor(images[imageIndex].url, 200, 200);
                    } else {
                      // Treat as URL
                      await addImageToEditor(choice, 200, 200);
                    }
                  } else {
                    // No gallery images, prompt for URL
                    const imageUrl = prompt('Enter image URL to add:');
                    if (imageUrl) {
                      await addImageToEditor(imageUrl, 200, 200);
                    }
                  }
                }}
                disabled={!imageLoaded}
                style={{
                  padding: '0.5rem 1rem',
                  background: imageLoaded ? '#4CAF50' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: imageLoaded ? 'pointer' : 'not-allowed',
                  fontWeight: '500',
                  whiteSpace: 'nowrap',
                  fontSize: '0.9em',
                }}
                title="Add image from gallery or URL"
              >
                📷 Add Image
              </button>
              <button
                onClick={handleSave}
                disabled={!imageLoaded}
                className="btn-save-toast"
                style={{
                  padding: '0.5rem 1rem',
                  background: imageLoaded ? '#2196F3' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: imageLoaded ? 'pointer' : 'not-allowed',
                  fontWeight: '500',
                  whiteSpace: 'nowrap',
                }}
              >
                💾 Save to XHTML
              </button>
            </div>
          </div>
          <div className="editor-container" style={{ flex: 1, position: 'relative' }}>
            {!imageLoaded && (
              <div className="loading-overlay">
                <div className="loading-spinner">Loading TOAST UI editor...</div>
              </div>
            )}
            <ImageEditor
              ref={editorRef}
              {...editorOptions}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default ToastCanvasEditor;

