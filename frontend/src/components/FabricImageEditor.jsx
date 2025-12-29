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
  const isMountedRef = useRef(true);
  const blobUrlRef = useRef(null); // Track blob URL for cleanup
  const [selectedObject, setSelectedObject] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [fontSize, setFontSize] = useState(24);
  const [textColor, setTextColor] = useState('#000000');
  const [fontFamily, setFontFamily] = useState('Arial');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [tool, setTool] = useState('select'); // 'select', 'text', 'move', 'resize'

  // Debug: Log when imageLoaded changes
  useEffect(() => {
    console.log('[FabricImageEditor] imageLoaded state changed to:', imageLoaded);
  }, [imageLoaded]);

  // Initialize Fabric.js canvas (only once)
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Mark component as mounted
    isMountedRef.current = true;
    
    // Only create canvas if it doesn't exist
    if (canvasInstanceRef.current) {
      console.log('[FabricImageEditor] Canvas already exists, skipping creation');
      return;
    }

    console.log('[FabricImageEditor] Creating new canvas');
    console.log('[FabricImageEditor] Canvas ref element:', canvasRef.current);
    
    if (canvasRef.current) {
      // Ensure canvas element has explicit size attributes
      canvasRef.current.setAttribute('width', '800');
      canvasRef.current.setAttribute('height', '600');
      canvasRef.current.style.width = '800px';
      canvasRef.current.style.height = '600px';
      canvasRef.current.style.display = 'block';
      canvasRef.current.style.visibility = 'visible';
      canvasRef.current.style.opacity = '1';
      
      console.log('[FabricImageEditor] Canvas ref element size:', {
        width: canvasRef.current.offsetWidth,
        height: canvasRef.current.offsetHeight,
        clientWidth: canvasRef.current.clientWidth,
        clientHeight: canvasRef.current.clientHeight,
        widthAttr: canvasRef.current.getAttribute('width'),
        heightAttr: canvasRef.current.getAttribute('height'),
        display: window.getComputedStyle(canvasRef.current).display,
        visibility: window.getComputedStyle(canvasRef.current).visibility
      });
    }
    
    const canvas = new Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#f5f5f5',
      preserveObjectStacking: true,
    });

    canvasInstanceRef.current = canvas;
    
    // Verify canvas was created correctly
    const canvasEl = canvas.getElement();
    console.log('[FabricImageEditor] Canvas created:');
    console.log('  - Canvas width/height:', `${canvas.width} x ${canvas.height}`);
    console.log('  - Element width/height attributes:', `${canvasEl?.width} x ${canvasEl?.height}`);
    console.log('  - Element offset size:', `${canvasEl?.offsetWidth} x ${canvasEl?.offsetHeight}`);
    console.log('  - Element client size:', `${canvasEl?.clientWidth} x ${canvasEl?.clientHeight}`);
    
    // Ensure canvas element is visible
    if (canvasEl) {
      canvasEl.style.display = 'block';
      canvasEl.style.visibility = 'visible';
      canvasEl.style.opacity = '1';
      
      // Check for Fabric.js upper canvas (for interactions)
      const upperCanvas = canvasRef.current?.parentElement?.querySelector('.upper-canvas');
      if (upperCanvas) {
        console.log('[FabricImageEditor] Found upper canvas, ensuring visibility');
        upperCanvas.style.display = 'block';
        upperCanvas.style.visibility = 'visible';
        upperCanvas.style.opacity = '1';
      }
      
      // Check all canvas elements in container
      const allCanvases = canvasRef.current?.parentElement?.querySelectorAll('canvas');
      console.log('[FabricImageEditor] Total canvas elements found:', allCanvases?.length);
      allCanvases?.forEach((c, idx) => {
        const style = window.getComputedStyle(c);
        console.log(`[FabricImageEditor] Canvas ${idx}:`, {
          class: c.className,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          width: c.width,
          height: c.height
        });
      });
    }
    
    // Force initial render
    canvas.renderAll();
    console.log('[FabricImageEditor] Initial canvas render completed');

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

    return () => {
      console.log('[FabricImageEditor] Disposing canvas');
      isMountedRef.current = false;
      if (canvasInstanceRef.current) {
        try {
          canvasInstanceRef.current.dispose();
        } catch (error) {
          console.warn('[FabricImageEditor] Error disposing canvas:', error);
        }
        canvasInstanceRef.current = null;
      }
    };
  }, []); // Only run once on mount

  // Load image when imageUrl changes (separate effect)
  useEffect(() => {
    if (!canvasInstanceRef.current || !imageUrl) {
      if (!imageUrl) {
        console.warn('[FabricImageEditor] No image URL provided');
        if (isMountedRef.current) {
          setImageLoaded(false);
        }
      }
      return;
    }

    const canvas = canvasInstanceRef.current;
    let isCancelled = false;
    
    // Clear existing objects before loading new image
    try {
      canvas.clear();
      // Set background color directly (Fabric.js v5+ API)
      canvas.backgroundColor = '#f5f5f5';
      canvas.renderAll();
    } catch (error) {
      console.error('[FabricImageEditor] Error clearing canvas:', error);
      return;
    }
    
    if (isMountedRef.current) {
      setImageLoaded(false);
      setSelectedObject(null);
    }

    console.log('[FabricImageEditor] Loading image from URL:', imageUrl);
    
    // Fetch image with proper headers (including auth if needed) and convert to blob URL
    // This ensures authentication headers are included and CORS is handled correctly
    const token = localStorage.getItem('token');
    const headers = {
      'Accept': 'image/*',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    fetch(imageUrl, { headers })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (isCancelled || !isMountedRef.current || !canvasInstanceRef.current) {
          console.log('[FabricImageEditor] Image fetch cancelled or component unmounted');
          return;
        }
        
        // Create blob URL and load into Fabric.js
        // Clean up previous blob URL if exists
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        console.log('[FabricImageEditor] Created blob URL, loading into Fabric.js:', blobUrl);
        
        // Use Image.fromURL - it handles loading automatically
        return Image.fromURL(blobUrl, {
          crossOrigin: 'anonymous',
        });
      })
      .then((img) => {
        // Check if component is still mounted and canvas is still valid
        if (isCancelled || !isMountedRef.current || !canvasInstanceRef.current) {
          console.log('[FabricImageEditor] Image load cancelled or component unmounted');
          return;
        }

        const currentCanvas = canvasInstanceRef.current;
        if (!currentCanvas) {
          console.warn('[FabricImageEditor] Canvas no longer exists');
          return;
        }

        try {
          console.log('[FabricImageEditor] Image loaded successfully:', img.width, 'x', img.height);
          console.log('[FabricImageEditor] Canvas dimensions:', currentCanvas.width, 'x', currentCanvas.height);
          
          // Set initial dimensions if provided
          if (initialWidth && initialHeight) {
            img.scaleToWidth(initialWidth);
            img.scaleToHeight(initialHeight);
            console.log('[FabricImageEditor] Scaled to initial dimensions:', initialWidth, 'x', initialHeight);
          } else {
            // Scale to fit canvas while maintaining aspect ratio
            const maxWidth = currentCanvas.width * 0.9;
            const maxHeight = currentCanvas.height * 0.9;
            console.log('[FabricImageEditor] Max dimensions for scaling:', maxWidth, 'x', maxHeight);
            
            if (img.width > maxWidth || img.height > maxHeight) {
              const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
              console.log('[FabricImageEditor] Scaling image by factor:', scale);
              img.scale(scale);
            } else {
              console.log('[FabricImageEditor] Image fits canvas, no scaling needed');
            }
          }

          // Calculate position after scaling
          const scaledWidth = img.width * img.scaleX;
          const scaledHeight = img.height * img.scaleY;
          const left = (currentCanvas.width - scaledWidth) / 2;
          const top = (currentCanvas.height - scaledHeight) / 2;
          
          console.log('[FabricImageEditor] Image scaled dimensions:', scaledWidth, 'x', scaledHeight);
          console.log('[FabricImageEditor] Image position:', left, ',', top);
          console.log('[FabricImageEditor] Image scaleX:', img.scaleX, 'scaleY:', img.scaleY);

          img.set({
            left: left,
            top: top,
            selectable: true,
            evented: true,
            lockMovementX: false,
            lockMovementY: false,
            hasControls: true,
            hasBorders: true,
          });

          console.log('[FabricImageEditor] Adding image to canvas...');
          
          // Verify image has an element before adding
          console.log('[FabricImageEditor] Image element check:', {
            hasElement: !!img._element,
            elementComplete: img._element?.complete,
            elementNaturalWidth: img._element?.naturalWidth,
            elementNaturalHeight: img._element?.naturalHeight
          });
          
          currentCanvas.add(img);
          console.log('[FabricImageEditor] Image added. Canvas objects count:', currentCanvas.getObjects().length);
          
          currentCanvas.setActiveObject(img);
          console.log('[FabricImageEditor] Active object set:', currentCanvas.getActiveObject()?.type);
          
          // Force render multiple times to ensure image is displayed
          currentCanvas.renderAll();
          
          // Use requestAnimationFrame to ensure render happens after DOM update
          requestAnimationFrame(() => {
            if (canvasInstanceRef.current && isMountedRef.current) {
              console.log('[FabricImageEditor] Force render via requestAnimationFrame');
              canvasInstanceRef.current.renderAll();
              
              // Check if image element is now available
              const addedImg = canvasInstanceRef.current.getObjects().find(obj => obj === img);
              if (addedImg) {
                console.log('[FabricImageEditor] Image element after render:', {
                  hasElement: !!addedImg._element,
                  elementComplete: addedImg._element?.complete,
                  elementNaturalWidth: addedImg._element?.naturalWidth,
                  elementNaturalHeight: addedImg._element?.naturalHeight
                });
              }
            }
          });
          
          // Verify image is actually on canvas
          const objectsOnCanvas = currentCanvas.getObjects();
          const imageOnCanvas = objectsOnCanvas.find(obj => obj === img);
          
          console.log('[FabricImageEditor] Canvas rendered. Image details:');
          console.log('  - Position:', `left=${img.left}, top=${img.top}`);
          console.log('  - Scaled size:', `${scaledWidth} x ${scaledHeight}`);
          console.log('  - Scale factors:', `scaleX=${img.scaleX}, scaleY=${img.scaleY}`);
          console.log('  - Visible:', img.visible, 'Opacity:', img.opacity);
          console.log('  - On canvas:', !!imageOnCanvas);
          console.log('  - Total objects:', objectsOnCanvas.length);
          
          // Verify canvas element is visible
          const canvasElement = currentCanvas.getElement();
          if (canvasElement) {
            const rect = canvasElement.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(canvasElement);
            console.log('[FabricImageEditor] Canvas element details:');
            console.log('  - Display:', computedStyle.display);
            console.log('  - Visibility:', computedStyle.visibility);
            console.log('  - Opacity:', computedStyle.opacity);
            console.log('  - Size:', `${rect.width} x ${rect.height}`);
            console.log('  - Position:', `left=${rect.left}, top=${rect.top}`);
            console.log('  - In viewport:', rect.width > 0 && rect.height > 0);
            console.log('  - Canvas width/height:', `${currentCanvas.width} x ${currentCanvas.height}`);
            console.log('  - Element width/height attributes:', `${canvasElement.width} x ${canvasElement.height}`);
            
            // Check if canvas is actually visible
            if (rect.width === 0 || rect.height === 0) {
              console.error('[FabricImageEditor] ⚠️ Canvas element has zero size! This is why the image is not visible.');
              console.error('[FabricImageEditor] Canvas ref element:', canvasRef.current);
              if (canvasRef.current) {
                const containerRect = canvasRef.current.getBoundingClientRect();
                const containerStyle = window.getComputedStyle(canvasRef.current);
                console.error('[FabricImageEditor] Container details:', {
                  size: `${containerRect.width} x ${containerRect.height}`,
                  display: containerStyle.display,
                  visibility: containerStyle.visibility,
                  position: containerStyle.position
                });
              }
            }
          } else {
            console.error('[FabricImageEditor] ⚠️ Canvas element is null!');
          }
          
          // Verify the image is actually rendered by checking canvas context
          try {
            const canvasEl = currentCanvas.getElement();
            if (canvasEl) {
              const ctx = canvasEl.getContext('2d');
              if (ctx) {
                // Check if canvas has any non-transparent pixels (basic check)
                const imageData = ctx.getImageData(0, 0, Math.min(100, canvasEl.width), Math.min(100, canvasEl.height));
                const hasPixels = imageData.data.some((val, idx) => idx % 4 !== 3 || val !== 255); // Check for non-white pixels
                console.log('[FabricImageEditor] Canvas context check - has pixels:', hasPixels);
              }
            }
          } catch (e) {
            console.warn('[FabricImageEditor] Could not check canvas context:', e);
          }
          
          console.log('[FabricImageEditor] Setting imageLoaded to true');
          
          if (isMountedRef.current) {
            setImageLoaded(true);
            console.log('[FabricImageEditor] imageLoaded state set to true');
          } else {
            console.warn('[FabricImageEditor] Component not mounted, cannot set imageLoaded');
          }
          
          // Force another render after a short delay to ensure everything is displayed
          setTimeout(() => {
            if (canvasInstanceRef.current && isMountedRef.current) {
              console.log('[FabricImageEditor] Force re-render after delay');
              const canvas = canvasInstanceRef.current;
              const canvasEl = canvas.getElement();
              
              // Verify canvas is still valid
              if (canvasEl) {
                const rect = canvasEl.getBoundingClientRect();
                console.log('[FabricImageEditor] After delay - Canvas size:', `${rect.width} x ${rect.height}`);
                
                // Get all objects and verify image is still there
                const objects = canvas.getObjects();
                console.log('[FabricImageEditor] After delay - Objects on canvas:', objects.length);
                const imageObj = objects.find(obj => obj.type === 'image');
                if (imageObj) {
                  console.log('[FabricImageEditor] After delay - Image object:', {
                    left: imageObj.left,
                    top: imageObj.top,
                    width: imageObj.width * imageObj.scaleX,
                    height: imageObj.height * imageObj.scaleY,
                    visible: imageObj.visible,
                    opacity: imageObj.opacity
                  });
                } else {
                  console.error('[FabricImageEditor] After delay - Image object not found on canvas!');
                }
                
                // If canvas has zero size, try to fix it
                if (rect.width === 0 || rect.height === 0) {
                  console.warn('[FabricImageEditor] Canvas has zero size, attempting to resize...');
                  // Try to set explicit size on the canvas element
                  if (canvasRef.current) {
                    const container = canvasRef.current.parentElement;
                    if (container) {
                      const containerRect = container.getBoundingClientRect();
                      if (containerRect.width > 0 && containerRect.height > 0) {
                        // Resize canvas to fit container (with some padding)
                        const newWidth = Math.min(800, containerRect.width - 40);
                        const newHeight = Math.min(600, containerRect.height - 40);
                        canvas.setDimensions({ width: newWidth, height: newHeight });
                        console.log('[FabricImageEditor] Resized canvas to:', `${newWidth} x ${newHeight}`);
                        canvas.renderAll();
                      }
                    }
                  }
                }
              }
              
              // Force render multiple times to ensure it's displayed
              canvas.renderAll();
              requestAnimationFrame(() => {
                if (canvasInstanceRef.current) {
                  canvasInstanceRef.current.renderAll();
                }
              });
            }
          }, 100);

          // Load initial text overlays
          if (initialTexts && initialTexts.length > 0 && isMountedRef.current && canvasInstanceRef.current) {
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
              if (canvasInstanceRef.current) {
                canvasInstanceRef.current.add(text);
              }
            });
            if (canvasInstanceRef.current) {
              canvasInstanceRef.current.renderAll();
            }
          }
        } catch (error) {
          console.error('[FabricImageEditor] Error processing loaded image:', error);
          if (isMountedRef.current) {
            setImageLoaded(false);
          }
        }
      })
      .catch((error) => {
        if (isCancelled || !isMountedRef.current) {
          console.log('[FabricImageEditor] Image load error ignored (component unmounted)');
          return;
        }
        console.error('[FabricImageEditor] Error loading image:', error);
        console.error('[FabricImageEditor] Image URL was:', imageUrl);
        console.error('[FabricImageEditor] Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
        
        // Try direct Image.fromURL as fallback (in case fetch fails but direct load works)
        console.log('[FabricImageEditor] Attempting fallback: direct Image.fromURL');
        Image.fromURL(imageUrl, { crossOrigin: 'anonymous' })
          .then((img) => {
            if (isCancelled || !isMountedRef.current || !canvasInstanceRef.current) {
              return;
            }
            const currentCanvas = canvasInstanceRef.current;
            if (!currentCanvas) return;
            
            try {
              console.log('[FabricImageEditor] Fallback: Image loaded successfully:', img.width, 'x', img.height);
              
              // Scale to fit canvas
              const maxWidth = currentCanvas.width * 0.9;
              const maxHeight = currentCanvas.height * 0.9;
              if (img.width > maxWidth || img.height > maxHeight) {
                const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
                img.scale(scale);
              }

              img.set({
                left: (currentCanvas.width - img.width * img.scaleX) / 2,
                top: (currentCanvas.height - img.height * img.scaleY) / 2,
                selectable: true,
                evented: true,
                lockMovementX: false,
                lockMovementY: false,
                hasControls: true,
                hasBorders: true,
              });

              currentCanvas.add(img);
              currentCanvas.setActiveObject(img);
              currentCanvas.renderAll();
              
              if (isMountedRef.current) {
                setImageLoaded(true);
              }
            } catch (fallbackError) {
              console.error('[FabricImageEditor] Fallback also failed:', fallbackError);
              alert(`Failed to load image: ${error.message || 'Unknown error'}\n\nURL: ${imageUrl}\n\nPlease check:\n1. The image exists on the server\n2. CORS is properly configured\n3. The image URL is correct\n4. Check browser console for more details`);
              if (isMountedRef.current) {
                setImageLoaded(false);
              }
            }
          })
          .catch((fallbackError) => {
            console.error('[FabricImageEditor] Fallback also failed:', fallbackError);
            alert(`Failed to load image: ${error.message || 'Unknown error'}\n\nURL: ${imageUrl}\n\nPlease check:\n1. The image exists on the server\n2. CORS is properly configured\n3. The image URL is correct\n4. Check browser console for more details`);
            if (isMountedRef.current) {
              setImageLoaded(false);
            }
          });
      });

    // Cleanup function to cancel image loading if effect re-runs or component unmounts
    return () => {
      isCancelled = true;
      // Clean up blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [imageUrl, initialWidth, initialHeight, initialTexts]); // Only reload when these change

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
