import React, { useEffect, useRef, useState, useCallback } from 'react';
import './DraggableCanvas.css';

/**
 * DraggableCanvas Component
 * Handles the new XHTML structure with draggable text blocks and canvas background
 */
const DraggableCanvas = ({ xhtml, onXhtmlChange, editMode = false, onEditModeChange }) => {
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
    if (editMode) return;
    
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
  }, [editMode, imageDragging]);

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

      // Set contentEditable on sync-word elements based on editMode
      const syncWords = container.querySelectorAll('.sync-word');
      syncWords.forEach(word => {
        word.contentEditable = editMode;
        if (editMode) {
          word.style.cursor = 'text';
          word.style.outline = '1px dashed rgba(33, 150, 243, 0.3)';
        } else {
          word.style.cursor = 'inherit';
          word.style.outline = 'none';
        }
      });

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
      };
    }, 100); // Small delay to ensure DOM is updated

    return () => clearTimeout(timeoutId);
  }, [xhtml, editMode, handleMouseDown]);

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

  // Handle word editing
  const handleWordEdit = useCallback((e) => {
    if (!editMode) return;
    
    const word = e.target;
    if (!word.classList.contains('sync-word')) return;

    // Prevent default behavior
    e.preventDefault();
    
    // Allow text editing
    word.contentEditable = true;
    word.focus();
  }, [editMode]);

  // Handle word blur (save changes)
  const handleWordBlur = useCallback((e) => {
    const word = e.target;
    if (!word.classList.contains('sync-word')) return;

    word.contentEditable = false;
    
    // Update XHTML with edited content
    if (onXhtmlChange) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtml, 'text/html');
      const updatedWord = doc.getElementById(word.id);
      
      if (updatedWord) {
        updatedWord.textContent = word.textContent;
        
        const serializer = new XMLSerializer();
        const updatedXhtml = serializer.serializeToString(doc.documentElement);
        onXhtmlChange(updatedXhtml);
      }
    }
  }, [xhtml, onXhtmlChange]);

  // Mark this container so XhtmlCanvas can find it
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-draggable-canvas', 'true');
    }
  }, []);

  // Force re-render when xhtml changes by using a key
  // Use a more robust key that detects actual content changes
  const xhtmlKey = React.useMemo(() => {
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
      onClick={handleWordEdit}
      onBlur={handleWordBlur}
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

