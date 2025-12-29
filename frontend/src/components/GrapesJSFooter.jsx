import React, { useState, useEffect, useRef, useCallback } from 'react';
import './GrapesJSFooter.css';

/**
 * Footer component for GrapesJS mode
 * Provides text formatting (Bold, font family, font color, font size) and image replacement
 */
const GrapesJSFooter = ({ 
  editor, 
  editMode, 
  images = [],
  onImageReplace,
  onXhtmlChange 
}) => {
  const [fontSize, setFontSize] = useState('16');
  const [fontColor, setFontColor] = useState('#000000');
  const [fontFamily, setFontFamily] = useState('serif');
  const [isBold, setIsBold] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [isImageSelected, setIsImageSelected] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [footerMode, setFooterMode] = useState('text'); // 'text' or 'image'
  const footerRef = useRef(null);

  // Get iframe document helper
  const getIframeDoc = useCallback(() => {
    if (!editor) return null;
    try {
      const canvas = editor.Canvas;
      if (!canvas) return null;
      const frameEl = canvas.getFrameEl();
      if (!frameEl) return null;
      return frameEl.contentDocument || frameEl.contentWindow?.document || null;
    } catch (err) {
      console.error('[GrapesJSFooter] Error getting iframe document:', err);
      return null;
    }
  }, [editor]);

  // Update footer state based on selection in iframe
  useEffect(() => {
    if (!editor || !editMode) return;

    const updateFooterState = () => {
      try {
        const frameDoc = getIframeDoc();
        if (!frameDoc) return;

        // First check if an image component is selected via GrapesJS API
        try {
          const selected = editor.getSelected();
          if (selected) {
            const tagName = selected.get('tagName');
            const isImg = tagName === 'img';
            console.log('[GrapesJSFooter] Component selected:', { tagName, isImg });
            setIsImageSelected(isImg);
            if (isImg) {
              const imgId = selected.get('attributes')?.id || selected.getId();
              setSelectedImageId(imgId);
              setSelectedComponent(selected);
              return;
            }
          }
        } catch (err) {
          console.warn('[GrapesJSFooter] Error getting selected component:', err);
        }

        // Also check if an image is clicked in the iframe DOM
        const selection = frameDoc.getSelection();
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;
          const element = container.nodeType === Node.TEXT_NODE 
            ? container.parentElement 
            : container;
          
          // Check if the selected element is an image or inside an image container
          const clickedElement = element.nodeType === Node.ELEMENT_NODE ? element : element.parentElement;
          if (clickedElement) {
            const img = clickedElement.tagName === 'IMG' ? clickedElement : clickedElement.closest('img');
            if (img) {
              console.log('[GrapesJSFooter] Image clicked in iframe:', img.id);
              // Try to find the component corresponding to this image
              try {
                // Use getWrapper() as the root component (like GrapesJSCanvas does)
                const wrapper = editor.getWrapper();
                const findImageComponent = (comp) => {
                  if (!comp || !comp.get) return null;
                  
                  try {
                    // Check if this component is an image with matching ID
                    const tagName = comp.get('tagName');
                    if (tagName === 'img') {
                      const attrs = comp.get('attributes') || {};
                      const compId = attrs.id || comp.getId();
                      if (compId === img.id) {
                        return comp;
                      }
                    }
                    
                    // Recursively search children
                    // GrapesJS components have a 'components' property that is a Collection
                    const children = comp.get('components');
                    if (children && children.models) {
                      for (const child of children.models) {
                        const found = findImageComponent(child);
                        if (found) return found;
                      }
                    }
                  } catch (e) {
                    // Skip this component if there's an error accessing it
                    console.debug('[GrapesJSFooter] Error accessing component:', e);
                  }
                  
                  return null;
                };
                
                const imgComponent = findImageComponent(wrapper);
                if (imgComponent) {
                  editor.select(imgComponent);
                  setIsImageSelected(true);
                  const imgId = img.id || imgComponent.getId();
                  setSelectedImageId(imgId);
                  setSelectedComponent(imgComponent);
                  return;
                }
              } catch (err) {
                console.warn('[GrapesJSFooter] Error finding image component:', err);
              }
            }
          }
        }

        // Text is selected or nothing selected
        setSelectedComponent(null);
        setIsImageSelected(false);
        setSelectedImageId(null);

        // If there's a text selection, update text formatting state
        if (selection && selection.rangeCount > 0) {
          try {
            const range = selection.getRangeAt(0);
            if (!range.collapsed) {
              const container = range.commonAncestorContainer;
              const element = container.nodeType === Node.TEXT_NODE 
                ? container.parentElement 
                : container;

              if (element && element.nodeType === Node.ELEMENT_NODE) {
                const computedStyle = frameDoc.defaultView?.getComputedStyle(element) || window.getComputedStyle(element);
                
                // Get font size - ensure it's always a string for GrapesJS compatibility
                const size = computedStyle.fontSize || '16px';
                const sizeNum = parseInt(size) || 16;
                setFontSize(String(sizeNum));
                
                // Get font color
                const color = computedStyle.color || '#000000';
                setFontColor(color);
                
                // Get font family
                const family = computedStyle.fontFamily || 'serif';
                setFontFamily(family.split(',')[0].replace(/['"]/g, '').trim());
                
                // Get bold state
                const fontWeight = computedStyle.fontWeight || 'normal';
                setIsBold(fontWeight === 'bold' || fontWeight === '700' || parseInt(fontWeight) >= 600);
              }
            }
          } catch (err) {
            // Selection might be invalid, ignore silently
            console.debug('[GrapesJSFooter] Selection error in updateFooterState (ignored):', err);
          }
        }
      } catch (err) {
        console.warn('[GrapesJSFooter] Error updating footer state:', err);
      }
    };

    // Listen for selection changes in iframe and make images clickable
    const frameDoc = getIframeDoc();
    let observer = null;
    
    if (frameDoc) {
      // Make images clickable and selectable
      const makeImagesClickable = () => {
        const images = frameDoc.querySelectorAll('img');
        images.forEach(img => {
          // Make images clickable
          img.style.cursor = 'pointer';
          img.style.pointerEvents = 'auto';
          img.style.userSelect = 'none';
          
          // Add click handler to select image component (use capture phase to intercept)
          img.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('[GrapesJSFooter] Image clicked:', img.id);
            
            // Try to find and select the component
            try {
              // Use getWrapper() as the root component (like GrapesJSCanvas does)
              const wrapper = editor.getWrapper();
              const findImageComponent = (comp) => {
                if (!comp || !comp.get) return null;
                
                try {
                  // Check if this component is an image with matching ID
                  const tagName = comp.get('tagName');
                  if (tagName === 'img') {
                    const attrs = comp.get('attributes') || {};
                    const compId = attrs.id || comp.getId();
                    if (compId === img.id) {
                      return comp;
                    }
                  }
                  
                  // Recursively search children
                  // GrapesJS components have a 'components' property that is a Collection
                  const children = comp.get('components');
                  if (children && children.models) {
                    for (const child of children.models) {
                      const found = findImageComponent(child);
                      if (found) return found;
                    }
                  }
                } catch (e) {
                  // Skip this component if there's an error accessing it
                  console.debug('[GrapesJSFooter] Error accessing component:', e);
                }
                
                return null;
              };
              
              const imgComponent = findImageComponent(wrapper);
              if (imgComponent) {
                console.log('[GrapesJSFooter] Found image component, selecting it:', img.id);
                editor.select(imgComponent);
                // Manually update footer state after selection
                setIsImageSelected(true);
                setSelectedImageId(img.id);
                setSelectedComponent(imgComponent);
              } else {
                console.warn('[GrapesJSFooter] Could not find image component for:', img.id);
              }
            } catch (err) {
              console.warn('[GrapesJSFooter] Error selecting image component on click:', err);
            }
          }, true);
        });
      };
      
      // Make images clickable immediately and on content changes
      makeImagesClickable();
      
      // Use MutationObserver to handle dynamically added images
      observer = new MutationObserver(() => {
        makeImagesClickable();
      });
      observer.observe(frameDoc.body, { childList: true, subtree: true });
      
      frameDoc.addEventListener('selectionchange', updateFooterState);
      frameDoc.addEventListener('mouseup', updateFooterState);
      frameDoc.addEventListener('keyup', updateFooterState);
    }

    // Also listen for component selection (for images)
    const handleComponentSelected = () => {
      try {
        const selected = editor.getSelected();
        if (selected) {
          const tagName = selected.get('tagName');
          const isImg = tagName === 'img';
          console.log('[GrapesJSFooter] Component selected event:', { tagName, isImg });
          setIsImageSelected(isImg);
          if (isImg) {
            const imgId = selected.get('attributes')?.id || selected.getId();
            setSelectedImageId(imgId);
            setSelectedComponent(selected);
          } else {
            updateFooterState();
          }
        } else {
          updateFooterState();
        }
      } catch (err) {
        console.warn('[GrapesJSFooter] Error in handleComponentSelected:', err);
        updateFooterState();
      }
    };

    editor.on('component:selected', handleComponentSelected);
    
    // Initial update
    updateFooterState();

    return () => {
      if (observer) {
        observer.disconnect();
      }
      const cleanupFrameDoc = getIframeDoc();
      if (cleanupFrameDoc) {
        cleanupFrameDoc.removeEventListener('selectionchange', updateFooterState);
        cleanupFrameDoc.removeEventListener('mouseup', updateFooterState);
        cleanupFrameDoc.removeEventListener('keyup', updateFooterState);
      }
      editor.off('component:selected', handleComponentSelected);
    };
  }, [editor, editMode, getIframeDoc]);

  // Make sure text in iframe is editable and allow deletion
  useEffect(() => {
    if (!editor || !editMode) return;

    const makeContentEditable = () => {
      try {
        const frameDoc = getIframeDoc();
        if (!frameDoc || !frameDoc.body) return;

        // Make body content editable
        frameDoc.body.contentEditable = 'true';
        
        // Make all text elements editable
        const textElements = frameDoc.body.querySelectorAll('p, div, span, h1, h2, h3, h4, h5, h6, li, td, th');
        textElements.forEach(el => {
          if (el.tagName !== 'IMG' && !el.classList.contains('image-placeholder') && !el.classList.contains('image-drop-zone')) {
            el.contentEditable = 'true';
          }
        });

        // Ensure deletion is allowed by preventing GrapesJS from blocking it
        const allowDeletion = (e) => {
          // Allow delete, backspace, and other text editing keys
          if (['Delete', 'Backspace'].includes(e.key)) {
            // Check if we're in an editable element
            const target = e.target;
            const isEditable = target && (
              target.contentEditable === 'true' || 
              target.isContentEditable ||
              target.closest('[contenteditable="true"]')
            );
            
            if (isEditable) {
              // Stop propagation to prevent GrapesJS from handling it
              e.stopPropagation();
              // Don't prevent default - allow normal browser deletion behavior
              // This ensures the text is actually deleted
            }
          }
        };

        // Add keydown listener in capture phase to intercept before GrapesJS
        frameDoc.addEventListener('keydown', allowDeletion, true);
        
        // Also handle beforeinput event (modern browsers) - this fires before the actual deletion
        const allowBeforeInput = (e) => {
          if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
            const target = e.target;
            const isEditable = target && (
              target.contentEditable === 'true' || 
              target.isContentEditable ||
              target.closest('[contenteditable="true"]')
            );
            
            if (isEditable) {
              // Stop propagation to prevent GrapesJS from blocking it
              e.stopPropagation();
              // Don't prevent default - allow the deletion to proceed
            }
          }
        };
        frameDoc.addEventListener('beforeinput', allowBeforeInput, true);

        // Store cleanup function
        return () => {
          frameDoc.removeEventListener('keydown', allowDeletion, true);
          frameDoc.removeEventListener('beforeinput', allowBeforeInput, true);
        };
      } catch (err) {
        console.warn('[GrapesJSFooter] Error making content editable:', err);
      }
    };

    // Try immediately and also after a delay
    const cleanup1 = makeContentEditable();
    const timeoutId = setTimeout(() => {
      const cleanup2 = makeContentEditable();
      return cleanup2;
    }, 500);

    return () => {
      clearTimeout(timeoutId);
      if (cleanup1) cleanup1();
    };
  }, [editor, editMode, getIframeDoc]);

  // Handle font size change
  const handleFontSizeChange = useCallback((e) => {
    const size = e.target.value;
    setFontSize(size);
    
    if (!editor || isImageSelected) return;

    try {
      const frameDoc = getIframeDoc();
      if (!frameDoc) {
        console.warn('[GrapesJSFooter] Cannot access iframe document for font size');
        return;
      }

      const selection = frameDoc.getSelection();
      if (!selection || selection.rangeCount === 0) {
        console.warn('[GrapesJSFooter] No text selection for font size');
        return;
      }

      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        console.warn('[GrapesJSFooter] Selection is collapsed for font size');
        return;
      }

      // Set flag to prevent component change events from firing
      window.__footerModifying = true;
      
      // Apply font size by wrapping in span
      const span = frameDoc.createElement('span');
      span.style.fontSize = `${size}px`;
      
      try {
        range.surroundContents(span);
      } catch (err) {
        // If surroundContents fails, extract and wrap
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
      }

      // Reset flag after a short delay to allow DOM changes to settle
      // Short enough to not block image drops, long enough to prevent loops
      setTimeout(() => {
        window.__footerModifying = false;
      }, 200);
      
      // Don't call onXhtmlChange here - the DOM is already updated in the iframe
      // The save function will read directly from the editor/iframe when needed
      // This prevents infinite loops
    } catch (err) {
      console.error('[GrapesJSFooter] Error applying font size:', err);
    }
  }, [editor, isImageSelected, getIframeDoc]);

  // Handle font color change
  const handleFontColorChange = useCallback((e) => {
    const color = e.target.value;
    setFontColor(color);
    
    if (!editor || isImageSelected) return;

    try {
      const frameDoc = getIframeDoc();
      if (!frameDoc) {
        console.warn('[GrapesJSFooter] Cannot access iframe document for font color');
        return;
      }

      const selection = frameDoc.getSelection();
      if (!selection || selection.rangeCount === 0) {
        console.warn('[GrapesJSFooter] No text selection for font color');
        return;
      }

      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        console.warn('[GrapesJSFooter] Selection is collapsed for font color');
        return;
      }

      // Set flag to prevent component change events from firing
      window.__footerModifying = true;
      
      // Use execCommand for color (works better than wrapping)
      frameDoc.execCommand('foreColor', false, color);
      
      // Reset flag after a short delay to allow DOM changes to settle
      // Short enough to not block image drops, long enough to prevent loops
      setTimeout(() => {
        window.__footerModifying = false;
      }, 200);
      
      // Don't call onXhtmlChange here - the DOM is already updated in the iframe
      // The save function will read directly from the editor/iframe when needed
      // This prevents infinite loops
    } catch (err) {
      console.error('[GrapesJSFooter] Error applying font color:', err);
    }
  }, [editor, isImageSelected, getIframeDoc]);

  // Handle font family change
  const handleFontFamilyChange = useCallback((e) => {
    const family = e.target.value;
    setFontFamily(family);
    
    if (!editor || isImageSelected) return;

    try {
      const frameDoc = getIframeDoc();
      if (!frameDoc) {
        console.warn('[GrapesJSFooter] Cannot access iframe document for font family');
        return;
      }

      const selection = frameDoc.getSelection();
      if (!selection || selection.rangeCount === 0) {
        console.warn('[GrapesJSFooter] No text selection for font family');
        return;
      }

      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        console.warn('[GrapesJSFooter] Selection is collapsed for font family');
        return;
      }

      // Set flag to prevent component change events from firing
      window.__footerModifying = true;
      
      // Apply font family by wrapping in span
      const span = frameDoc.createElement('span');
      span.style.fontFamily = family;
      
      try {
        range.surroundContents(span);
      } catch (err) {
        // If surroundContents fails, extract and wrap
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
      }

      // Reset flag after a short delay to allow DOM changes to settle
      // Short enough to not block image drops, long enough to prevent loops
      setTimeout(() => {
        window.__footerModifying = false;
      }, 200);
      
      // Don't call onXhtmlChange here - the DOM is already updated in the iframe
      // The save function will read directly from the editor/iframe when needed
      // This prevents infinite loops
    } catch (err) {
      console.error('[GrapesJSFooter] Error applying font family:', err);
    }
  }, [editor, isImageSelected, getIframeDoc]);

  // Handle bold toggle
  const handleBoldToggle = useCallback((e) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    const newBoldState = !isBold;
    setIsBold(newBoldState);
    
    if (!editor || isImageSelected) return;

    try {
      const frameDoc = getIframeDoc();
      if (!frameDoc) {
        console.warn('[GrapesJSFooter] Cannot access iframe document for bold');
        return;
      }

      const selection = frameDoc.getSelection();
      if (!selection || selection.rangeCount === 0) {
        console.warn('[GrapesJSFooter] No text selection for bold');
        return;
      }

      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        console.warn('[GrapesJSFooter] Selection is collapsed for bold');
        return;
      }

      // Set flag to prevent component change events from firing
      window.__footerModifying = true;
      
      // Use execCommand for bold (works better than wrapping)
      frameDoc.execCommand('bold', false, null);
      
      // Reset flag after a short delay to allow DOM changes to settle
      // Short enough to not block image drops, long enough to prevent loops
      setTimeout(() => {
        window.__footerModifying = false;
      }, 200);
      
      // Don't call onXhtmlChange here - the DOM is already updated in the iframe
      // The save function will read directly from the editor/iframe when needed
      // This prevents infinite loops
    } catch (err) {
      console.error('[GrapesJSFooter] Error applying bold:', err);
    }
  }, [editor, isImageSelected, isBold, getIframeDoc]);

  // Handle image replacement
  const handleImageReplace = useCallback((image) => {
    if (!editor || !selectedComponent || !isImageSelected || !selectedImageId) return;

    try {
      // Set flag since we're modifying component (though this uses GrapesJS API, not direct DOM)
      window.__footerModifying = true;
      
      // For EPUB, use relative path: images/filename
      const relativePath = `images/${image.fileName}`;
      const imgAlt = image.alt || image.title || '';
      
      // Update image attributes
      selectedComponent.setAttributes({
        src: relativePath,
        alt: imgAlt
      });
      
      // Also update style if needed
      selectedComponent.addStyle({
        'max-width': '100%',
        'height': 'auto'
      });
      
      // Reset flag after a short delay to allow component updates to settle
      setTimeout(() => {
        window.__footerModifying = false;
      }, 200);
      
      // Don't call onXhtmlChange for image replacement - save function will read from editor directly
      // This prevents infinite loops
      
      // Call callback if provided
      if (onImageReplace) {
        onImageReplace(selectedImageId, image);
      }
    } catch (err) {
      console.error('[GrapesJSFooter] Error replacing image:', err);
    }
  }, [editor, selectedComponent, isImageSelected, selectedImageId, onImageReplace]);


  // Toggle between text and image modes
  const handleModeToggle = useCallback(() => {
    setFooterMode(prev => prev === 'text' ? 'image' : 'text');
  }, []);

  if (!editMode) return null;

  return (
    <div ref={footerRef} className="grapesjs-footer">
      <div className="grapesjs-footer-content">
        {/* Mode toggle button */}
        <div className="grapesjs-footer-section">
          <button
            className="grapesjs-footer-mode-toggle"
            onClick={handleModeToggle}
            title={footerMode === 'text' ? 'Switch to Image Replacement' : 'Switch to Text Formatting'}
          >
            {footerMode === 'text' ? '🖼️ Images' : '✏️ Text'}
          </button>
        </div>

        {footerMode === 'image' ? (
          // Image replacement mode
          <div className="grapesjs-footer-section">
            {isImageSelected && selectedImageId ? (
              <>
                <div className="grapesjs-footer-label">Replace Image:</div>
                <div className="grapesjs-footer-image-gallery">
                  {images.map((image, index) => (
                    <div
                      key={index}
                      className="grapesjs-footer-image-item"
                      onClick={() => handleImageReplace(image)}
                      title={image.fileName || image.alt || `Image ${index + 1}`}
                    >
                      <img 
                        src={image.url || image.src} 
                        alt={image.alt || image.fileName || `Image ${index + 1}`}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="grapesjs-footer-label" style={{ color: '#757575', fontStyle: 'italic' }}>
                Click on an image to replace it
              </div>
            )}
          </div>
        ) : (
          // Text formatting mode
          <>
            <div className="grapesjs-footer-section">
              <button
                className={`grapesjs-footer-button ${isBold ? 'active' : ''}`}
                onClick={handleBoldToggle}
                title="Bold"
              >
                <strong>B</strong>
              </button>
            </div>
            
            <div className="grapesjs-footer-section">
              <label className="grapesjs-footer-label">Font Size:</label>
              <select
                className="grapesjs-footer-select"
                value={fontSize}
                onChange={handleFontSizeChange}
              >
                {[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72].map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            
            <div className="grapesjs-footer-section">
              <label className="grapesjs-footer-label">Font Family:</label>
              <select
                className="grapesjs-footer-select"
                value={fontFamily}
                onChange={handleFontFamilyChange}
              >
                <option value="serif">Serif</option>
                <option value="sans-serif">Sans-serif</option>
                <option value="monospace">Monospace</option>
                <option value="cursive">Cursive</option>
                <option value="fantasy">Fantasy</option>
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
                <option value="Georgia">Georgia</option>
                <option value="Verdana">Verdana</option>
              </select>
            </div>
            
            <div className="grapesjs-footer-section">
              <label className="grapesjs-footer-label">Font Color:</label>
              <input
                type="color"
                className="grapesjs-footer-color-input"
                value={fontColor}
                onChange={handleFontColorChange}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default GrapesJSFooter;

