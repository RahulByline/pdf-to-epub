import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import './DraggableCanvas.css';

/**
 * DraggableCanvas Component
 * Handles the new XHTML structure with draggable text blocks and canvas background
 */
const DraggableCanvas = ({ xhtml, onXhtmlChange, editMode = false, onEditModeChange, onClearImage, onImageEdit, onOpenImageEditor }) => {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const [draggingElement, setDraggingElement] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [scale, setScale] = useState(1);
  const isCalculatingRef = useRef(false);
  const lastDimensionsRef = useRef({ width: 0, height: 0 });
  const currentScaleRef = useRef(1);

  // Track if an image is being dragged (from react-dnd)
  const [imageDragging, setImageDragging] = useState(false);

  // Listen for image drag events
  useEffect(() => {
    const handleDragStart = () => {
      setImageDragging(true);
      console.log('[DraggableCanvas] Image drag started - disabling text block dragging');
    };
    
    const handleDragEnd = () => {
      setImageDragging(false);
      console.log('[DraggableCanvas] Image drag ended - enabling text block dragging');
    };

    // Listen for custom events from XhtmlCanvas
    window.addEventListener('image-drag-start', handleDragStart);
    window.addEventListener('image-drag-end', handleDragEnd);

    return () => {
      window.removeEventListener('image-drag-start', handleDragStart);
      window.removeEventListener('image-drag-end', handleDragEnd);
    };
  }, []);

  // Define handleMouseDown BEFORE useEffect that uses it
  const handleMouseDown = useCallback((e) => {
    if (editMode) return;
    
    // Don't allow text block dragging when an image is being dragged
    if (imageDragging) {
      console.log('[DraggableCanvas] Ignoring text drag - image is being dragged');
      return;
    }
    
    // Check if clicking on a placeholder - if so, don't drag the text block
    const clickedPlaceholder = e.target.closest('.image-placeholder, .image-drop-zone, .has-image');
    if (clickedPlaceholder) {
      console.log('[DraggableCanvas] Clicked on placeholder - allowing image drop');
      return; // Let the image drop handler take over
    }
    
    // Check if the clicked element or its parent is a draggable block
    let block = e.target;
    while (block && block !== containerRef.current) {
      if (block.classList && block.classList.contains('draggable-text-block')) {
        break;
      }
      block = block.parentElement;
    }
    
    if (!block || !block.classList.contains('draggable-text-block')) {
      return; // Not a draggable block
    }

    e.preventDefault();
    e.stopPropagation();

    const rect = block.getBoundingClientRect();
    const container = containerRef.current;
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    console.log('Starting drag on element:', block.id, 'Offset:', offsetX, offsetY);

    setDraggingElement(block);
    setDragOffset({ x: offsetX, y: offsetY });
    setIsDragging(true);
    block.classList.add('dragging');
  }, [editMode, imageDragging]);

  // Handle text blur (save changes) - work with all editable elements
  // CRITICAL FIX: Use functional update to read latest state, preventing overwrites
  // Moved here before useEffect that uses it to avoid "Cannot access before initialization" error
  const handleTextBlur = useCallback((e) => {
    const el = e.target;
    const tag = el.tagName.toLowerCase();
    
    // Skip non-text elements
    if (['script', 'style', 'meta', 'link', 'img', 'svg', 'canvas', 'iframe'].includes(tag)) return;
    // Skip placeholders and images
    if (el.classList.contains('image-placeholder') || el.classList.contains('image-drop-zone') || el.classList.contains('has-image')) return;
    if (tag === 'img') return;
    
    // Check if this is an editable element
    const isSyncWord = el.classList.contains('sync-word') || el.classList.contains('sync-sentence');
    const editableTags = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div', 'td', 'th', 'label', 'figcaption', 'blockquote', 'article', 'section', 'aside'];
    const hasText = el.textContent && el.textContent.trim().length > 0;
    
    if (!isSyncWord && !editableTags.includes(tag) && !hasText) return;

    el.contentEditable = false;
    
    if (!onXhtmlChange) return;
    
    // CRITICAL FIX: Read from the actual rendered DOM, not from potentially stale state
    // This ensures we capture ALL changes made to the DOM, including previous edits
    if (!containerRef.current) {
      console.warn('[DraggableCanvas] Container ref not available for text update');
      return;
    }
    
    // Get the inner div that contains the rendered XHTML
    const contentDiv = containerRef.current.querySelector('div:first-child');
    if (!contentDiv) {
      console.warn('[DraggableCanvas] Content div not found');
      return;
    }
    
    // Clone the content to avoid modifying live DOM
    const clonedContent = contentDiv.cloneNode(true);
    
    // CRITICAL FIX: Read from DOM and use latest xhtml state via ref or closure
    // Get the latest xhtml from the rendered content, not from stale state
    try {
      // Use the current xhtml prop to get the structure (DOCTYPE, xmlns, head)
      // But replace body content with actual DOM content (which has all edits)
      const parser = new DOMParser();
      let doc = parser.parseFromString(xhtml, 'text/html');
      
      // Check for parsing errors
      let parserError = doc.querySelector('parsererror');
      if (parserError) {
        doc = parser.parseFromString(xhtml, 'application/xml');
        parserError = doc.querySelector('parsererror');
        if (parserError) {
          console.error('[DraggableCanvas] Both HTML and XML parsing failed, using DOM directly');
          // Fallback: serialize the cloned DOM content directly
          const tempDoc = document.implementation.createHTMLDocument('');
          tempDoc.body.innerHTML = clonedContent.innerHTML;
          const serializer = new XMLSerializer();
          let bodyContent = serializer.serializeToString(tempDoc.body);
          // Extract just the body content (remove <body> tags)
          bodyContent = bodyContent.replace(/<\/?body[^>]*>/gi, '');
          
          // Reconstruct XHTML with original structure
          const doctypeMatch = xhtml.match(/<!DOCTYPE[^>]*>/i);
          const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
          const xmlnsMatch = xhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
          const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';
          const headMatch = xhtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
          const headContent = headMatch ? headMatch[1] : '';
          
          let updatedXhtml = `${doctype}\n<html xmlns="${xmlns}">\n`;
          if (headContent) {
            updatedXhtml += `<head>\n${headContent}\n</head>\n`;
          }
          updatedXhtml += `<body>\n${bodyContent}\n</body>\n</html>`;
          
          // Ensure self-closing tags
          updatedXhtml = updatedXhtml.replace(/<meta([^>]*?)>/gi, (match, attrs) => {
            return attrs.includes('/') ? match : `<meta${attrs}/>`;
          });
          updatedXhtml = updatedXhtml.replace(/<img([^>]*?)>/gi, (match, attrs) => {
            return attrs.includes('/') ? match : `<img${attrs}/>`;
          });
          
          console.log('[DraggableCanvas] Text edit saved - updated XHTML from DOM (fallback method)');
          onXhtmlChange(updatedXhtml);
          return;
        }
      }
      
      // Replace body content with the updated content from DOM
      // This captures ALL changes made to the DOM, not just the current edit
      if (doc.body) {
        doc.body.innerHTML = clonedContent.innerHTML;
      } else if (doc.documentElement) {
        // For XML parser, find body or use documentElement
        const body = doc.querySelector('body') || doc.documentElement;
        body.innerHTML = clonedContent.innerHTML;
      }
      
      const serializer = new XMLSerializer();
      let updatedXhtml = serializer.serializeToString(doc.documentElement);
      
      // Handle HTML5 parser output
      if (doc.documentElement.tagName === 'HTML') {
        const doctypeMatch = xhtml.match(/<!DOCTYPE[^>]*>/i);
        const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
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
      
      console.log('[DraggableCanvas] Text edit saved - updated XHTML from DOM, preserving all changes');
      onXhtmlChange(updatedXhtml);
    } catch (error) {
      console.error('[DraggableCanvas] Error updating XHTML from DOM:', error);
    }
  }, [xhtml, onXhtmlChange]);


  // Initialize draggable text blocks after XHTML is rendered
  useEffect(() => {
    if (!containerRef.current) return;

    // Click handler to prevent image stretching when clicking on placeholders
    const handlePlaceholderClick = (e) => {
      // If clicking on blank space (not on an image), prevent any dimension changes
      const target = e.target;
      if (target.classList.contains('image-placeholder') || target.classList.contains('image-drop-zone')) {
        // Find any images inside this placeholder
        const img = target.querySelector('img');
        if (img) {
          // Preserve aspect ratio - prevent stretching
          const currentWidth = img.style.width;
          const currentHeight = img.style.height;
          
          // If dimensions are set to 100% or percentages, reset them
          if (currentWidth && (currentWidth.includes('%') || currentWidth === '100%')) {
            img.style.setProperty('width', 'auto', 'important');
          }
          if (currentHeight && (currentHeight.includes('%') || currentHeight === '100%')) {
            img.style.setProperty('height', 'auto', 'important');
          }
          
          // Ensure object-fit is set
          img.style.setProperty('object-fit', 'contain', 'important');
          img.style.setProperty('max-width', '100%', 'important');
          img.style.setProperty('max-height', '100%', 'important');
          
          // Also check and fix computed dimensions
          const clickComputedStyle = window.getComputedStyle(img);
          const parentRect = target.getBoundingClientRect();
          const imgRect = img.getBoundingClientRect();
          
          // If image is stretched to parent dimensions, fix it
          if (parentRect.width > 0 && Math.abs(imgRect.width - parentRect.width) < 10) {
            img.style.setProperty('width', 'auto', 'important');
          }
          if (parentRect.height > 0 && Math.abs(imgRect.height - parentRect.height) < 10) {
            img.style.setProperty('height', 'auto', 'important');
          }
        }
      }
    };

    // Wait for DOM to update after XHTML is rendered
    const timeoutId = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      // Find draggable blocks - search in the nested div that contains the XHTML
      const xhtmlContainer = container.querySelector('div[style*="position"]') || container.firstElementChild || container;
      const draggableBlocks = xhtmlContainer.querySelectorAll ? xhtmlContainer.querySelectorAll('.draggable-text-block') : container.querySelectorAll('.draggable-text-block');

      console.log(`[DraggableCanvas] Found ${draggableBlocks.length} draggable text blocks`);
      
      // Find and ensure placeholders are visible
      const placeholders = container.querySelectorAll('.image-placeholder, .image-drop-zone, .has-image');
      console.log(`[DraggableCanvas] Found ${placeholders.length} placeholders`);
      
      // Add click handler to prevent image stretching when clicking on placeholders
      placeholders.forEach((placeholder) => {
        // Remove existing listener if any, then add new one
        placeholder.removeEventListener('click', handlePlaceholderClick);
        placeholder.addEventListener('click', handlePlaceholderClick, true); // Use capture phase
      });
      
      // Also check for img tags (replaced placeholders)
      const imgTags = container.querySelectorAll('img');
      console.log(`[DraggableCanvas] Found ${imgTags.length} img tags`);
      imgTags.forEach((img, idx) => {
        const rect = img.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(img);
        console.log(`[DraggableCanvas] Image ${idx}: id=${img.id}, src=${img.src}, size=${rect.width}x${rect.height}, visible=${rect.width > 0 && rect.height > 0}`);
        console.log(`[DraggableCanvas] Image ${idx} computed styles:`, {
          display: computedStyle.display,
          visibility: computedStyle.visibility,
          opacity: computedStyle.opacity,
          position: computedStyle.position,
          zIndex: computedStyle.zIndex,
          width: computedStyle.width,
          height: computedStyle.height,
          top: computedStyle.top,
          left: computedStyle.left
        });
        console.log(`[DraggableCanvas] Image ${idx} position:`, {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          isInViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
          isPartiallyVisible: rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0
        });
        
        // Check if image is actually loading
        img.onload = () => {
          console.log(`[DraggableCanvas] Image ${img.id} loaded successfully`);
        };
        img.onerror = (e) => {
          console.error(`[DraggableCanvas] Image ${img.id} failed to load:`, e);
        };
        
        // Ensure images are visible
        if (rect.width === 0 || rect.height === 0) {
          console.warn(`[DraggableCanvas] Image ${img.id} has zero size - may be hidden`);
        }
        
        // Force image visibility with important flags for ALL images
        // But maintain aspect ratio - don't stretch
        img.style.setProperty('max-width', '100%', 'important');
        img.style.setProperty('max-height', '100%', 'important');
        img.style.setProperty('width', 'auto', 'important');
        img.style.setProperty('height', 'auto', 'important');
        img.style.setProperty('object-fit', 'contain', 'important');
        img.style.setProperty('display', 'block', 'important');
        img.style.setProperty('visibility', 'visible', 'important');
        img.style.setProperty('opacity', '1', 'important');
        img.style.setProperty('position', 'relative', 'important');
        img.style.setProperty('z-index', '10', 'important');
        
        // Add hover overlay with options for images (not placeholders) with IDs matching placeholder pattern
        // Only create overlay for actual <img> tags, not placeholder divs
        if (img.tagName && img.tagName.toLowerCase() === 'img' && img.id && /^page\d+_(?:div|img)\d+$/.test(img.id) && (onClearImage || onImageEdit)) {
          // Create wrapper if it doesn't exist
          let wrapper = img.parentElement;
          if (!wrapper || !wrapper.classList.contains('image-with-options')) {
            wrapper = document.createElement('div');
            wrapper.className = 'image-with-options';
          wrapper.style.position = 'relative';
          wrapper.style.display = 'inline-block';
          wrapper.style.zIndex = '3000';
          wrapper.style.pointerEvents = 'auto';
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
          }
          
          // Always recreate overlay to ensure it has the latest onClearImage callback
          // Remove existing overlay if it exists (it gets removed when React re-renders)
          let overlay = wrapper.querySelector('.image-options-overlay');
          if (overlay) {
            overlay.remove();
          }
          
          // Create new overlay with latest callback
          overlay = document.createElement('div');
          overlay.className = 'image-options-overlay';
          overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            /* Keep overlay transparent to avoid "black overlay" effect on large images */
            background: transparent;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 3000 !important;
            border-radius: 4px;
            pointer-events: auto !important;
            flex-direction: column;
            gap: 8px;
            padding: 12px;
          `;
          
          // Create button container
          const buttonContainer = document.createElement('div');
          buttonContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
            justify-content: center;
            width: 100%;
          `;
          
          // Use a closure to capture the current img.id and callbacks
          const imageId = img.id;
          const clearImageCallback = onClearImage;
          const imageEditCallback = onImageEdit;
          const openImageEditorCallback = onOpenImageEditor;
          
          // Helper function to create buttons
          const createButton = (text, icon, bgColor, hoverColor, onClick) => {
            const btn = document.createElement('button');
            btn.innerHTML = `${icon} ${text}`;
            btn.style.cssText = `
              padding: 8px 16px;
              background: ${bgColor};
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 13px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              transition: all 0.2s ease;
              pointer-events: auto;
              width: 100%;
              max-width: 200px;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
            `;
            btn.onmouseenter = () => {
              btn.style.background = hoverColor;
              btn.style.transform = 'scale(1.05)';
            };
            btn.onmouseleave = () => {
              btn.style.background = bgColor;
              btn.style.transform = 'scale(1)';
            };
            btn.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              e.stopImmediatePropagation();
              onClick();
              return false;
            };
            btn.onmousedown = (e) => {
              e.stopPropagation();
              e.stopImmediatePropagation();
            };
            return btn;
          };
          
          // Zoom In button
          if (imageEditCallback) {
            const zoomInBtn = createButton('Zoom In', '🔍+', '#1976d2', '#1565c0', () => {
              console.log('[DraggableCanvas] Zoom in clicked for:', imageId);
              if (imageEditCallback && imageId) {
                imageEditCallback(imageId, 'zoom-in');
              }
            });
            buttonContainer.appendChild(zoomInBtn);
          }
          
          // Zoom Out button
          if (imageEditCallback) {
            const zoomOutBtn = createButton('Zoom Out', '🔍-', '#1976d2', '#1565c0', () => {
              console.log('[DraggableCanvas] Zoom out clicked for:', imageId);
              if (imageEditCallback && imageId) {
                imageEditCallback(imageId, 'zoom-out');
              }
            });
            buttonContainer.appendChild(zoomOutBtn);
          }
          
          // Fit to Container button
          if (imageEditCallback) {
            const fitBtn = createButton('Fit to Container', '📐', '#388e3c', '#2e7d32', () => {
              console.log('[DraggableCanvas] Fit to container clicked for:', imageId);
              if (imageEditCallback && imageId) {
                imageEditCallback(imageId, 'fit-container');
              }
            });
            buttonContainer.appendChild(fitBtn);
          }
          
          // Edit Image button (opens FabricImageEditor)
          if (openImageEditorCallback) {
            const editBtn = createButton('Edit Image', '✏️', '#9c27b0', '#7b1fa2', () => {
              console.log('[DraggableCanvas] Edit image clicked for:', imageId);
              if (openImageEditorCallback && imageId) {
                openImageEditorCallback(imageId);
              }
            });
            buttonContainer.appendChild(editBtn);
          }
          
          // Clear Image button
          if (clearImageCallback) {
            const clearBtn = createButton('Clear Image', '🗑️', '#d32f2f', '#b71c1c', () => {
              console.log('[DraggableCanvas] Clear image button clicked for:', imageId);
              if (clearImageCallback && imageId) {
                try {
                  clearImageCallback(imageId);
                  console.log('[DraggableCanvas] onClearImage called successfully');
                } catch (error) {
                  console.error('[DraggableCanvas] Error calling onClearImage:', error);
                  alert('Error clearing image: ' + error.message);
                }
              } else {
                console.warn('[DraggableCanvas] Cannot clear image - onClearImage:', !!clearImageCallback, 'img.id:', imageId);
                alert('Cannot clear image: Clear function not available');
              }
            });
            buttonContainer.appendChild(clearBtn);
          }
          
          overlay.appendChild(buttonContainer);
          wrapper.appendChild(overlay);
          
          // Show overlay on hover
          wrapper.onmouseenter = () => {
            overlay.style.display = 'flex';
          };
          wrapper.onmouseleave = () => {
            overlay.style.display = 'none';
          };
          
          console.log('[DraggableCanvas] Created overlay for image:', imageId);
        }
        
        // Ensure proper sizing for all images (not just page1_img2)
        // Check if image has zero or very small dimensions
        if (rect.width === 0 || rect.height === 0 || rect.width < 10 || rect.height < 10) {
          console.log(`[DraggableCanvas] Image ${img.id} has zero/small size - enforcing dimensions`);
          img.style.setProperty('width', 'auto', 'important');
          img.style.setProperty('min-width', '100px', 'important');
          img.style.setProperty('min-height', '100px', 'important');
        }
        
        // Prevent image from stretching when clicked - maintain aspect ratio
        // Remove any width/height that would cause stretching
        const currentWidth = img.style.width;
        const currentHeight = img.style.height;
        const imgComputedStyle = window.getComputedStyle(img);
        const computedWidth = imgComputedStyle.width;
        const computedHeight = imgComputedStyle.height;
        
        // Check if image has percentage-based dimensions that would cause stretching
        if (currentWidth && (currentWidth.includes('%') || currentWidth === '100%')) {
          img.style.setProperty('width', 'auto', 'important');
        }
        if (currentHeight && (currentHeight.includes('%') || currentHeight === '100%')) {
          img.style.setProperty('height', 'auto', 'important');
        }
        
        // Also check computed styles - if they're 100%, remove them
        if (computedWidth && computedWidth.includes('px')) {
          const widthValue = parseFloat(computedWidth);
          const parentWidth = img.parentElement ? img.parentElement.getBoundingClientRect().width : 0;
          if (parentWidth > 0 && Math.abs(widthValue - parentWidth) < 5) {
            // Image is stretched to parent width, fix it
            img.style.setProperty('width', 'auto', 'important');
          }
        }
        if (computedHeight && computedHeight.includes('px')) {
          const heightValue = parseFloat(computedHeight);
          const parentHeight = img.parentElement ? img.parentElement.getBoundingClientRect().height : 0;
          if (parentHeight > 0 && Math.abs(heightValue - parentHeight) < 5) {
            // Image is stretched to parent height, fix it
            img.style.setProperty('height', 'auto', 'important');
          }
        }
        
        // Ensure object-fit is set to prevent stretching
        img.style.setProperty('object-fit', 'contain', 'important');
        img.style.setProperty('max-width', '100%', 'important');
        img.style.setProperty('max-height', '100%', 'important');
        
        // Remove width/height attributes if they're percentages
        const widthAttr = img.getAttribute('width');
        const heightAttr = img.getAttribute('height');
        if (widthAttr && (widthAttr.includes('%') || widthAttr === '100')) {
          img.removeAttribute('width');
        }
        if (heightAttr && (heightAttr.includes('%') || heightAttr === '100')) {
          img.removeAttribute('height');
        }
        
        // Check if image is in viewport (for ALL images, not just page1_img2)
        const isFullyInViewport = rect.top >= 0 && 
                                 rect.left >= 0 && 
                                 rect.bottom <= window.innerHeight && 
                                 rect.right <= window.innerWidth;
        const isPartiallyVisible = rect.top < window.innerHeight && 
                                   rect.bottom > 0 && 
                                   rect.left < window.innerWidth && 
                                   rect.right > 0;
        
        console.log(`[DraggableCanvas] Image ${img.id} viewport check:`, {
          fullyInViewport: isFullyInViewport,
          partiallyVisible: isPartiallyVisible,
          rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width, height: rect.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollY: window.scrollY,
          scrollX: window.scrollX,
          isOffScreenRight: rect.left > window.innerWidth,
          isOffScreenLeft: rect.right < 0,
          isOffScreenTop: rect.bottom < 0,
          isOffScreenBottom: rect.top > window.innerHeight
        });
        
        // If image is not visible or has zero size, ensure it's visible and scrolled into view
        if (!isPartiallyVisible || rect.width === 0 || rect.height === 0) {
          console.log(`[DraggableCanvas] Image ${img.id} is not visible or has zero size - ensuring visibility and scrolling into view`);
          
          // Find the scrollable parent (canvas-wrapper)
          let scrollableParent = img.parentElement;
          while (scrollableParent && scrollableParent !== document.body) {
            const style = window.getComputedStyle(scrollableParent);
            if (style.overflow === 'auto' || style.overflowY === 'auto' || style.overflow === 'scroll' || style.overflowY === 'scroll') {
              console.log(`[DraggableCanvas] Found scrollable parent for ${img.id}:`, scrollableParent.className, {
                scrollTop: scrollableParent.scrollTop,
                scrollLeft: scrollableParent.scrollLeft,
                clientWidth: scrollableParent.clientWidth,
                clientHeight: scrollableParent.clientHeight
              });
              const parentRect = scrollableParent.getBoundingClientRect();
              const imgRelativeTop = rect.top - parentRect.top + scrollableParent.scrollTop;
              const imgRelativeLeft = rect.left - parentRect.left + scrollableParent.scrollLeft;
              
              // Center the image in the scrollable container
              scrollableParent.scrollTo({
                top: imgRelativeTop - scrollableParent.clientHeight / 2 + rect.height / 2,
                left: imgRelativeLeft - scrollableParent.clientWidth / 2 + rect.width / 2,
                behavior: 'smooth'
              });
              break;
            }
            scrollableParent = scrollableParent.parentElement;
          }
          
          // Also try scrolling the image itself (for window-level scrolling)
          setTimeout(() => {
            img.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          }, 100);
          
          // Add a temporary highlight border to make it visible
          img.style.setProperty('border', '3px solid #4CAF50', 'important');
          img.style.setProperty('box-shadow', '0 0 10px rgba(76, 175, 80, 0.5)', 'important');
          
          // Remove highlight after 3 seconds
          setTimeout(() => {
            img.style.setProperty('border', '', 'important');
            img.style.setProperty('box-shadow', '', 'important');
          }, 3000);
        }
      });
      
      // Sort placeholders by position (top to bottom, left to right) for consistent numbering
      const sortedPlaceholders = Array.from(placeholders).sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        // First sort by top position (vertical)
        if (Math.abs(rectA.top - rectB.top) > 10) {
          return rectA.top - rectB.top;
        }
        // If roughly on the same row, sort by left position (horizontal)
        return rectA.left - rectB.left;
      });
      
      sortedPlaceholders.forEach((placeholder, idx) => {
        const rect = placeholder.getBoundingClientRect();
        console.log(`[DraggableCanvas] Placeholder ${idx + 1}: id=${placeholder.id}, size=${rect.width}x${rect.height}, visible=${rect.width > 0 && rect.height > 0}`);
        
        // Remove any image-with-options wrapper if placeholder is inside one
        // This can happen if an image was cleared but the wrapper persisted
        let currentElement = placeholder;
        if (currentElement.parentElement && currentElement.parentElement.classList.contains('image-with-options')) {
          const wrapper = currentElement.parentElement;
          const grandParent = wrapper.parentElement;
          if (grandParent) {
            // Move placeholder out of wrapper and remove wrapper
            grandParent.insertBefore(placeholder, wrapper);
            wrapper.remove();
            console.log(`[DraggableCanvas] Removed image-with-options wrapper from placeholder ${placeholder.id}`);
          }
        }
        
        // Force visibility for placeholders
        if (rect.width === 0 || rect.height === 0) {
          console.warn(`[DraggableCanvas] Placeholder ${placeholder.id} has zero size - may be hidden`);
        }
        
        // Ensure placeholder is visible and has proper styling
        placeholder.style.setProperty('border', '2px dashed #007bff', 'important');
        placeholder.style.setProperty('background-color', '#f0f0f0', 'important');
        placeholder.style.setProperty('min-height', '50px', 'important');
        placeholder.style.setProperty('min-width', '50px', 'important');
        placeholder.style.setProperty('opacity', '1', 'important');
        placeholder.style.setProperty('pointer-events', 'auto', 'important');
        placeholder.style.setProperty('z-index', '100', 'important');
        placeholder.style.setProperty('position', 'relative', 'important');
        
        // Add numbering label (1, 2, 3, etc.)
        let numberLabel = placeholder.querySelector('.placeholder-number');
        if (!numberLabel) {
          numberLabel = document.createElement('div');
          numberLabel.className = 'placeholder-number';
          numberLabel.textContent = (idx + 1).toString();
          numberLabel.style.cssText = `
            position: absolute;
            top: 4px;
            left: 4px;
            background-color: #2196F3;
            color: white;
            font-weight: bold;
            font-size: 14px;
            padding: 4px 8px;
            border-radius: 4px;
            z-index: 101;
            pointer-events: none;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          `;
          placeholder.appendChild(numberLabel);
        } else {
          // Update number if it changed
          numberLabel.textContent = (idx + 1).toString();
        }
      });
      
      // Debug: Log all elements with position absolute
      if (draggableBlocks.length === 0) {
        const allAbsolute = container.querySelectorAll('[style*="position: absolute"], [style*="position:absolute"]');
        console.log(`[DraggableCanvas] No .draggable-text-block found. Found ${allAbsolute.length} elements with absolute positioning`);
        if (allAbsolute.length > 0) {
          console.log('[DraggableCanvas] Sample elements:', Array.from(allAbsolute).slice(0, 3).map(el => ({
            tag: el.tagName,
            classes: el.className,
            id: el.id,
            style: el.getAttribute('style')
          })));
        }
      }

      // Set contentEditable on text elements based on editMode
      // More comprehensive selector to catch all text-containing elements
      // Include sync-word plus common text tags, and also check for text content
      const editableSelector = '.sync-word, .sync-sentence, p, span, h1, h2, h3, h4, h5, h6, li, div, td, th, label, figcaption, blockquote, article, section, aside';
      const textNodes = container.querySelectorAll(editableSelector);
      
      // Also find elements with text content that might not match the selector
      const allElements = container.querySelectorAll('*');
      const textContainingElements = Array.from(allElements).filter(el => {
        const tag = el.tagName.toLowerCase();
        // Skip non-text elements
        if (['script', 'style', 'meta', 'link', 'img', 'svg', 'canvas', 'iframe'].includes(tag)) return false;
        // Skip placeholders and images
        if (el.classList.contains('image-placeholder') || el.classList.contains('image-drop-zone') || el.classList.contains('has-image')) return false;
        // Check if element has text content or contains text nodes
        const hasText = el.textContent && el.textContent.trim().length > 0;
        const hasTextNodes = Array.from(el.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
        return hasText || hasTextNodes;
      });
      
      // Combine both sets and remove duplicates
      const allEditableElements = new Set([...textNodes, ...textContainingElements]);
      
      allEditableElements.forEach(node => {
        // Skip placeholders and images
        if (node.classList.contains('image-placeholder') || node.classList.contains('image-drop-zone')) return;
        if (node.tagName.toLowerCase() === 'img') return;
        // Skip if it's a parent of a placeholder/image
        if (node.querySelector('.image-placeholder, .image-drop-zone, .has-image, img')) {
          // Only make it editable if it has direct text content (not just nested placeholders)
          const directText = Array.from(node.childNodes).some(n => 
            n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
          );
          if (!directText) return;
        }

        node.contentEditable = editMode;
        if (editMode) {
          node.style.cursor = 'text';
          node.style.outline = '1px dashed rgba(33, 150, 243, 0.3)';
          node.style.userSelect = 'text';
        } else {
          node.style.cursor = 'inherit';
          node.style.outline = 'none';
          node.style.userSelect = 'none';
        }
      });
      
      console.log(`[DraggableCanvas] Made ${allEditableElements.size} elements editable in edit mode: ${editMode}`);

      // Add input event listeners to editable elements to capture formatting changes
      const inputHandlers = new Map();
      if (editMode) {
        const handleInput = (e) => {
          // Formatting change detected, update XHTML after a short delay
          setTimeout(() => {
            if (e.target && e.target.contentEditable === 'true') {
              handleTextBlur(e);
            }
          }, 200);
        };

        allEditableElements.forEach(node => {
          node.addEventListener('input', handleInput);
          inputHandlers.set(node, handleInput);
        });
      }

      // Add drag handlers to draggable blocks
      const mouseDownHandler = (e) => {
        handleMouseDown(e);
      };

      draggableBlocks.forEach(block => {
        // Remove existing listeners first
        block.removeEventListener('mousedown', mouseDownHandler);
        
        block.style.cursor = editMode ? 'default' : 'move';
        block.style.userSelect = editMode ? 'text' : 'none';
        
        if (!editMode) {
          block.addEventListener('mousedown', mouseDownHandler);
          block.classList.add('draggable-enabled');
        } else {
          block.classList.remove('draggable-enabled');
        }
      });

      return () => {
        draggableBlocks.forEach(block => {
          block.removeEventListener('mousedown', mouseDownHandler);
        });
        // Cleanup input handlers
        inputHandlers.forEach((handler, node) => {
          node.removeEventListener('input', handler);
        });
        // Cleanup placeholder click handlers
        const allPlaceholders = container.querySelectorAll('.image-placeholder, .image-drop-zone, .has-image');
        allPlaceholders.forEach((placeholder) => {
          placeholder.removeEventListener('click', handlePlaceholderClick);
        });
      };
    }, 100); // Small delay to ensure DOM is updated

    return () => clearTimeout(timeoutId);
    }, [xhtml, editMode, handleMouseDown, onClearImage, onImageEdit, onOpenImageEditor, handleTextBlur]);

  useEffect(() => {
    if (!isDragging || !draggingElement) return;

    const handleMouseMove = (e) => {
      if (!containerRef.current || !draggingElement) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;

      // Calculate new position in pixels
      const newX = e.clientX - containerRect.left - dragOffset.x;
      const newY = e.clientY - containerRect.top - dragOffset.y;

      // Convert to percentages
      const percentX = (newX / containerWidth) * 100;
      const percentY = (newY / containerHeight) * 100;

      // Clamp to container bounds
      const clampedX = Math.max(0, Math.min(100, percentX));
      const clampedY = Math.max(0, Math.min(100, percentY));

      // Update element position
      draggingElement.style.left = `${clampedX}%`;
      draggingElement.style.top = `${clampedY}%`;

      // Update XHTML
      updateXhtmlPosition(draggingElement.id, clampedX, clampedY);
    };

    const handleMouseUp = () => {
      if (draggingElement) {
        draggingElement.classList.remove('dragging');
      }
      setIsDragging(false);
      setDraggingElement(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, draggingElement, dragOffset]);

  const updateXhtmlPosition = useCallback((elementId, leftPercent, topPercent) => {
    if (!onXhtmlChange) return;

    // Count img tags before parsing to ensure we don't lose them
    const imgCountBefore = (xhtml.match(/<img[^>]*>/gi) || []).length;
    console.log(`[DraggableCanvas] updateXhtmlPosition - img count before: ${imgCountBefore}`);
    
    const parser = new DOMParser();
    let doc = parser.parseFromString(xhtml, 'text/html');
    
    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.warn('[DraggableCanvas] HTML parsing failed in updateXhtmlPosition, trying XML');
      doc = parser.parseFromString(xhtml, 'application/xml');
    }
    
    const element = doc.getElementById(elementId);

    if (element) {
      element.style.left = `${leftPercent}%`;
      element.style.top = `${topPercent}%`;
      
      const serializer = new XMLSerializer();
      let updatedXhtml = serializer.serializeToString(doc.documentElement);
      
      // Verify we didn't lose any img tags
      const imgCountAfter = (updatedXhtml.match(/<img[^>]*>/gi) || []).length;
      console.log(`[DraggableCanvas] updateXhtmlPosition - img count after: ${imgCountAfter}`);
      
      if (imgCountAfter < imgCountBefore) {
        console.error(`[DraggableCanvas] Lost ${imgCountBefore - imgCountAfter} img tag(s) during position update!`);
        console.error('[DraggableCanvas] Aborting position update to preserve images');
        return; // Don't update if we'd lose images
      }
      
      onXhtmlChange(updatedXhtml);
    }
  }, [xhtml, onXhtmlChange]);

  // Handle text editing - make it work for all text elements
  const handleTextEdit = useCallback((e) => {
    if (!editMode) return;
    
    let el = e.target;
    const tag = el.tagName.toLowerCase();
    
    // Skip non-text elements
    if (['script', 'style', 'meta', 'link', 'img', 'svg', 'canvas', 'iframe'].includes(tag)) return;
    // Skip placeholders and images
    if (el.classList.contains('image-placeholder') || el.classList.contains('image-drop-zone') || el.classList.contains('has-image')) return;
    if (tag === 'img') return;
    
    // Helper function to check if an element contains text (directly or in children)
    const hasTextContent = (element) => {
      if (!element) return false;
      // Check direct text content
      if (element.textContent && element.textContent.trim().length > 0) return true;
      // Check for direct text nodes
      if (Array.from(element.childNodes).some(node => 
        node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
      )) return true;
      // Check if it contains text elements (but not just placeholders/images)
      const textElements = element.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, li, td, th, label, figcaption, blockquote, article, section, aside, .sync-word, .sync-sentence');
      const hasRealTextElements = Array.from(textElements).some(te => {
        const hasPlaceholder = te.classList.contains('image-placeholder') || te.classList.contains('image-drop-zone') || te.querySelector('.image-placeholder, .image-drop-zone, .has-image, img');
        return !hasPlaceholder && te.textContent && te.textContent.trim().length > 0;
      });
      return hasRealTextElements;
    };
    
    // Check if current element has text content
    const hasText = hasTextContent(el);
    
    // Allow editing if it's a known text element or has text content
    const isSyncWord = el.classList.contains('sync-word') || el.classList.contains('sync-sentence');
    const editableTags = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div', 'td', 'th', 'label', 'figcaption', 'blockquote', 'article', 'section', 'aside', 'em', 'strong', 'b', 'i', 'u', 'small', 'sub', 'sup', 'code', 'pre', 'a'];
    
    // If current element is not editable, try to find an editable parent or child
    if (!isSyncWord && !editableTags.includes(tag) && !hasText) {
      // First, try to find a child element that's editable
      const editableChild = el.querySelector(editableTags.map(t => t).join(', ') + ', .sync-word, .sync-sentence');
      if (editableChild && hasTextContent(editableChild)) {
        el = editableChild;
      } else {
        // Try to find a parent element that's editable
        let parent = el.parentElement;
        let foundEditableParent = false;
        while (parent && parent !== containerRef.current) {
          const parentTag = parent.tagName.toLowerCase();
          const parentHasText = hasTextContent(parent);
          if (editableTags.includes(parentTag) || parent.classList.contains('sync-word') || parent.classList.contains('sync-sentence') || parentHasText) {
            el = parent;
            foundEditableParent = true;
            break;
          }
          parent = parent.parentElement;
        }
        
        if (!foundEditableParent) {
          // Last resort: try to find any nearby text element
          const allTextElements = containerRef.current?.querySelectorAll(editableTags.map(t => t).join(', ') + ', .sync-word, .sync-sentence');
          if (allTextElements && allTextElements.length > 0) {
            // Find the closest text element to the clicked position
            const clickRect = el.getBoundingClientRect();
            let closestEl = null;
            let minDistance = Infinity;
            allTextElements.forEach(te => {
              if (hasTextContent(te) && !te.classList.contains('image-placeholder') && !te.classList.contains('image-drop-zone')) {
                const teRect = te.getBoundingClientRect();
                const distance = Math.sqrt(
                  Math.pow(clickRect.left - teRect.left, 2) + 
                  Math.pow(clickRect.top - teRect.top, 2)
                );
                if (distance < minDistance) {
                  minDistance = distance;
                  closestEl = te;
                }
              }
            });
            if (closestEl && minDistance < 200) { // Only use if within 200px
              el = closestEl;
            } else {
              console.log('[DraggableCanvas] Could not find editable element for:', {
                tag,
                className: el.className,
                textContent: el.textContent?.substring(0, 50)
              });
              return; // Give up if we can't find anything
            }
          } else {
            return; // No text elements found at all
          }
        }
      }
    }

    // Final check: make sure we have a valid editable element
    if (!el || el.classList.contains('image-placeholder') || el.classList.contains('image-drop-zone')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    el.contentEditable = true;
    el.focus();
    
    // Try to position cursor at click location
    try {
      const range = document.createRange();
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        range.setStart(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (err) {
      // Ignore cursor positioning errors
    }
    
    console.log('[DraggableCanvas] Made element editable:', {
      tag: el.tagName.toLowerCase(),
      className: el.className,
      textContent: el.textContent?.substring(0, 50)
    });
  }, [editMode]);

  // Mark this container so XhtmlCanvas can find it
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-draggable-canvas', 'true');
    }
  }, []);

  // Calculate scale to fit content in viewport
  useEffect(() => {
    let debounceTimer = null;
    let calculationTimer = null;
    
    const calculateScale = () => {
      // Prevent concurrent calculations
      if (isCalculatingRef.current) {
        return;
      }
      
      if (!containerRef.current || !contentRef.current) return;
      
      const container = containerRef.current;
      const content = contentRef.current;
      
      // Get container dimensions (available viewport)
      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      
      if (containerWidth === 0 || containerHeight === 0) return;
      
      // Check if dimensions changed significantly (more than 5px difference)
      const lastDims = lastDimensionsRef.current;
      const widthDiff = Math.abs(containerWidth - lastDims.width);
      const heightDiff = Math.abs(containerHeight - lastDims.height);
      
      // Skip if dimensions haven't changed significantly and we already have a scale
      if (widthDiff < 5 && heightDiff < 5 && currentScaleRef.current !== 1) {
        return;
      }
      
      // Update last dimensions
      lastDimensionsRef.current = { width: containerWidth, height: containerHeight };
      
      isCalculatingRef.current = true;
      
      // Temporarily remove transform to measure natural size
      const currentTransform = content.style.transform;
      const currentWidth = content.style.width;
      const currentHeight = content.style.height;
      const currentMaxWidth = content.style.maxWidth;
      const currentMaxHeight = content.style.maxHeight;
      
      content.style.transform = 'scale(1)';
      content.style.width = 'auto';
      content.style.height = 'auto';
      content.style.maxWidth = 'none';
      content.style.maxHeight = 'none';
      
      // Get content dimensions after it's rendered
      // Use requestAnimationFrame for better timing
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!contentRef.current || !containerRef.current) {
            isCalculatingRef.current = false;
            return;
          }
          
          // Force a reflow to get accurate measurements
          void content.offsetHeight;
          void content.offsetWidth;
          
          // Get the actual rendered size of the content
          const contentRect = content.getBoundingClientRect();
          let contentWidth = contentRect.width;
          let contentHeight = contentRect.height;
          
          // Fallback to scroll dimensions if bounding rect is 0
          if (contentWidth === 0 || contentWidth < 10) {
            contentWidth = content.scrollWidth || containerWidth;
          }
          if (contentHeight === 0 || contentHeight < 10) {
            contentHeight = content.scrollHeight || containerHeight;
          }
          
          // Add small padding to prevent edge cutting (3% on each side for safety)
          const paddingFactor = 0.94; // 94% of container to leave 3% padding on each side
          const availableWidth = containerWidth * paddingFactor;
          const availableHeight = containerHeight * paddingFactor;
          
          // Calculate scale to fit both width and height
          const scaleX = availableWidth / contentWidth;
          const scaleY = availableHeight / contentHeight;
          const newScale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
          
          // Set a minimum scale to prevent content from being too small
          const minScale = 0.1;
          const finalScale = Math.max(newScale, minScale);
          
          // Only update if scale changed significantly (more than 0.01 difference)
          if (Math.abs(finalScale - currentScaleRef.current) > 0.01) {
            currentScaleRef.current = finalScale;
            setScale(finalScale);
          }
          
          // Restore transform and dimensions
          content.style.transform = currentTransform;
          content.style.width = currentWidth;
          content.style.height = currentHeight;
          content.style.maxWidth = currentMaxWidth;
          content.style.maxHeight = currentMaxHeight;
          
          isCalculatingRef.current = false;
        });
      });
    };
    
    // Debounced calculation function
    const debouncedCalculate = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(calculateScale, 200);
    };
    
    // Calculate scale on mount and when xhtml changes
    // Use a single timeout after content is likely rendered
    calculationTimer = setTimeout(calculateScale, 300);
    
    // Recalculate on window resize (debounced)
    const handleResize = () => {
      debouncedCalculate();
    };
    
    window.addEventListener('resize', handleResize);
    
    // Use ResizeObserver to detect container size changes (debounced)
    let resizeObserver = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        debouncedCalculate();
      });
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (calculationTimer) clearTimeout(calculationTimer);
      if (resizeObserver && containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
      isCalculatingRef.current = false;
    };
  }, [xhtml]);

  // Force re-render when xhtml changes by using a key
  // Use a more robust key that detects actual content changes
  const xhtmlKey = useMemo(() => {
    if (!xhtml) return 'empty';
    // Create a key based on:
    // 1. Length (catches additions/removals)
    // 2. First 200 chars (catches header changes)
    // 3. Last 200 chars (catches footer changes)
    // 4. Count of img tags (catches image injections)
    const imgCount = (xhtml.match(/<img[^>]*>/gi) || []).length;
    const firstPart = xhtml.substring(0, 200);
    const lastPart = xhtml.substring(Math.max(0, xhtml.length - 200));
    return `${xhtml.length}-${imgCount}-${firstPart.substring(0, 50)}-${lastPart.substring(Math.max(0, lastPart.length - 50))}`;
  }, [xhtml]);
  
  // Debug: Log when xhtml changes
  useEffect(() => {
    console.log('[DraggableCanvas] XHTML updated, new key:', xhtmlKey);
    console.log('[DraggableCanvas] XHTML length:', xhtml?.length);
    console.log('[DraggableCanvas] Image count:', (xhtml?.match(/<img[^>]*>/gi) || []).length);
  }, [xhtml, xhtmlKey]);

  return (
    <div 
      ref={containerRef}
      className={`draggable-canvas-container ${editMode ? 'edit-mode' : ''}`}
      onClick={handleTextEdit}
      onBlur={handleTextBlur}
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%',
        zIndex: 1, // Below the drop overlay (z-index 1000)
        pointerEvents: 'auto' // Ensure it can receive mouse events
      }}
    >
      <div 
        ref={contentRef}
        key={xhtmlKey} 
        dangerouslySetInnerHTML={{ __html: xhtml }}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          width: '100%',
          height: 'fit-content',
          maxWidth: `${100 / scale}%`,
          maxHeight: `${100 / scale}%`,
          display: 'block',
        }}
      />
    </div>
  );
};

export default DraggableCanvas;

