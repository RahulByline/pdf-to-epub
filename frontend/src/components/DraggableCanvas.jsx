import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import './DraggableCanvas.css';

/**
 * DraggableCanvas Component
 * Handles the new XHTML structure with draggable text blocks and canvas background
 */
const DraggableCanvas = ({ xhtml, onXhtmlChange, onOpenImageEditor }) => {
  const containerRef = useRef(null);
  const [draggingElement, setDraggingElement] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

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
    // Don't allow text block dragging when an image is being dragged
    if (imageDragging) {
      console.log('[DraggableCanvas] Ignoring text drag - image is being dragged');
      return;
    }
    
    // Check if clicking on a placeholder - if so, don't drag the text block
    const clickedPlaceholder = e.target.closest('.image-placeholder, .image-drop-zone');
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
  }, [imageDragging]);

  // Handle text blur (save changes) - work with all editable elements
  // CRITICAL FIX: Use functional update to read latest state, preventing overwrites
  // Moved here before useEffect that uses it to avoid "Cannot access before initialization" error
  const handleTextBlur = useCallback((e) => {
    const el = e.target;
    const tag = el.tagName.toLowerCase();
    
    // Skip non-text elements
    if (['script', 'style', 'meta', 'link', 'img', 'svg', 'canvas', 'iframe'].includes(tag)) return;
    // Skip placeholders and images
    if (el.classList.contains('image-placeholder') || el.classList.contains('image-drop-zone')) return;
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

    // Wait for DOM to update after XHTML is rendered
    const timeoutId = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      // Find draggable blocks - search in the nested div that contains the XHTML
      const xhtmlContainer = container.querySelector('div[style*="position"]') || container.firstElementChild || container;
      const draggableBlocks = xhtmlContainer.querySelectorAll ? xhtmlContainer.querySelectorAll('.draggable-text-block') : container.querySelectorAll('.draggable-text-block');

      console.log(`[DraggableCanvas] Found ${draggableBlocks.length} draggable text blocks`);
      
      // Find and ensure placeholders are visible
      const placeholders = container.querySelectorAll('.image-placeholder, .image-drop-zone');
      console.log(`[DraggableCanvas] Found ${placeholders.length} placeholders`);
      
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
        img.style.setProperty('max-width', '100%', 'important');
        img.style.setProperty('height', 'auto', 'important');
        img.style.setProperty('display', 'block', 'important');
        img.style.setProperty('visibility', 'visible', 'important');
        img.style.setProperty('opacity', '1', 'important');
        img.style.setProperty('position', 'relative', 'important');
        img.style.setProperty('z-index', '10', 'important');
        
        // Add double-click to open image editor for images with IDs matching placeholder pattern
        if (img.id && /^page\d+_(?:div|img)\d+$/.test(img.id) && onOpenImageEditor) {
          img.style.cursor = 'pointer';
          img.title = 'Double-click to edit image with TOAST UI Editor';
          
          const imageId = img.id;
          const openEditorCallback = onOpenImageEditor;
          
          // Remove existing double-click listener if any
          const existingHandler = img._doubleClickHandler;
          if (existingHandler) {
            img.removeEventListener('dblclick', existingHandler);
          }
          
          // Create new handler
          const doubleClickHandler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('[DraggableCanvas] Double-clicked image:', imageId);
            if (openEditorCallback) {
              openEditorCallback(imageId);
            }
          };
          
          // Store handler reference and add listener
          img._doubleClickHandler = doubleClickHandler;
          img.addEventListener('dblclick', doubleClickHandler);
        }
        
        
        // Ensure proper sizing for all images (not just page1_img2)
        // Check if image has zero or very small dimensions
        if (rect.width === 0 || rect.height === 0 || rect.width < 10 || rect.height < 10) {
          console.log(`[DraggableCanvas] Image ${img.id} has zero/small size - enforcing dimensions`);
          img.style.setProperty('width', 'auto', 'important');
          img.style.setProperty('min-width', '100px', 'important');
          img.style.setProperty('min-height', '100px', 'important');
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
      
      placeholders.forEach((placeholder, idx) => {
        const rect = placeholder.getBoundingClientRect();
        console.log(`[DraggableCanvas] Placeholder ${idx}: id=${placeholder.id}, size=${rect.width}x${rect.height}, visible=${rect.width > 0 && rect.height > 0}`);
        
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

      // Set contentEditable on text elements - always enabled
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
        if (el.classList.contains('image-placeholder') || el.classList.contains('image-drop-zone')) return false;
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
        if (node.querySelector('.image-placeholder, .image-drop-zone, img')) {
          // Only make it editable if it has direct text content (not just nested placeholders)
          const directText = Array.from(node.childNodes).some(n => 
            n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
          );
          if (!directText) return;
        }

        node.contentEditable = true;
        node.style.cursor = 'text';
        node.style.outline = '1px dashed rgba(33, 150, 243, 0.3)';
        node.style.userSelect = 'text';
      });
      
      console.log(`[DraggableCanvas] Made ${allEditableElements.size} elements editable`);

      // Add input event listeners to editable elements to capture formatting changes
      const inputHandlers = new Map();
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

      // Add drag handlers to draggable blocks
      const mouseDownHandler = (e) => {
        handleMouseDown(e);
      };

      draggableBlocks.forEach(block => {
        // Remove existing listeners first
        block.removeEventListener('mousedown', mouseDownHandler);
        
        block.style.cursor = 'move';
        block.style.userSelect = 'none';
        
        block.addEventListener('mousedown', mouseDownHandler);
        block.classList.add('draggable-enabled');
      });

      return () => {
        draggableBlocks.forEach(block => {
          block.removeEventListener('mousedown', mouseDownHandler);
        });
        // Cleanup input handlers
        inputHandlers.forEach((handler, node) => {
          node.removeEventListener('input', handler);
        });
      };
    }, 100); // Small delay to ensure DOM is updated

    return () => clearTimeout(timeoutId);
    }, [xhtml, handleMouseDown, handleTextBlur, onOpenImageEditor]);

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
    let el = e.target;
    const tag = el.tagName.toLowerCase();
    
    // Skip non-text elements
    if (['script', 'style', 'meta', 'link', 'img', 'svg', 'canvas', 'iframe'].includes(tag)) return;
    // Skip placeholders and images
    if (el.classList.contains('image-placeholder') || el.classList.contains('image-drop-zone')) return;
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
        const hasPlaceholder = te.classList.contains('image-placeholder') || te.classList.contains('image-drop-zone') || te.querySelector('.image-placeholder, .image-drop-zone, img');
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
  }, []);

  // Mark this container so XhtmlCanvas can find it
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-draggable-canvas', 'true');
    }
  }, []);

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
      className="draggable-canvas-container"
      onClick={handleTextEdit}
      onBlur={handleTextBlur}
      style={{ 
        position: 'relative', 
        width: '100%', 
        minHeight: '100vh',
        zIndex: 1, // Below the drop overlay (z-index 1000)
        pointerEvents: 'auto' // Ensure it can receive mouse events
      }}
    >
      <div key={xhtmlKey} dangerouslySetInnerHTML={{ __html: xhtml }} />
    </div>
  );
};

export default DraggableCanvas;

