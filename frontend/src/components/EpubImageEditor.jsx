import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import api from '../services/api';
import { injectImageIntoXhtml, applyReflowableCss } from '../utils/xhtmlUtils';
import DraggableCanvas from './DraggableCanvas';
import './EpubImageEditor.css';

const DRAG_TYPE = 'EPUB_IMAGE';

/**
 * Draggable Image Item Component
 */
const DraggableImage = ({ image, pageNumber }) => {
  const [imgError, setImgError] = useState(false);
  const [imgSrc, setImgSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [{ isDragging }, drag] = useDrag({
    type: DRAG_TYPE,
    item: () => {
      console.log('[DraggableImage] Drag started:', image.fileName);
      // Emit event to disable text block dragging
      window.dispatchEvent(new CustomEvent('image-drag-start'));
      // Set global flag to track image dragging
      if (typeof window !== 'undefined') {
        window.__imageDragging = true;
      }
      return { image, pageNumber };
    },
    end: (item, monitor) => {
      const didDrop = monitor.didDrop();
      console.log('[DraggableImage] Drag ended:', image.fileName, 'Did drop:', didDrop);
      if (!didDrop) {
        console.warn('[DraggableImage] Drop failed - image was not dropped on a valid target');
      }
      // Emit event to re-enable text block dragging
      window.dispatchEvent(new CustomEvent('image-drag-end'));
      // Clear global flag
      if (typeof window !== 'undefined') {
        window.__imageDragging = false;
      }
    },
    collect: (monitor) => {
      if (!monitor || typeof monitor.isDragging !== 'function') {
        return { isDragging: false };
      }
      try {
        return {
          isDragging: monitor.isDragging(),
        };
      } catch (error) {
        console.error('[DraggableImage] collect - Error:', error);
        return { isDragging: false };
      }
    },
  });

  // Load image - try multiple approaches
  useEffect(() => {
    const loadImage = async () => {
      try {
        setLoading(true);
        setImgError(false);
        
        console.log('[DraggableImage] Loading image:', {
          fileName: image.fileName,
          url: image.url,
          originalUrl: image.originalUrl
        });
        
        // Check if URL is already absolute (includes http/https)
        const isAbsoluteUrl = image.url.startsWith('http://') || image.url.startsWith('https://');
        
        if (isAbsoluteUrl) {
          // For absolute URLs, use fetch directly (axios has issues with baseURL)
          const token = localStorage.getItem('token');
          const headers = {
            'Accept': 'image/*',
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          
          console.log('[DraggableImage] Loading image with fetch:', image.url);
          console.log('[DraggableImage] Headers:', headers);
          
          const fetchResponse = await fetch(image.url, {
            headers: headers,
            // Don't use credentials: 'include' - it conflicts with CORS wildcard
            // We're already sending Authorization header manually
          });
          
          console.log('[DraggableImage] Fetch response status:', fetchResponse.status, fetchResponse.statusText);
          console.log('[DraggableImage] Response headers:', Object.fromEntries(fetchResponse.headers.entries()));
          
          if (!fetchResponse.ok) {
            const errorText = await fetchResponse.text().catch(() => 'Unable to read error');
            console.error('[DraggableImage] Fetch error response:', errorText);
            throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}. ${errorText.substring(0, 200)}`);
          }
          
          const blob = await fetchResponse.blob();
          console.log('[DraggableImage] Blob created, size:', blob.size, 'type:', blob.type);
          
          if (blob.size === 0) {
            throw new Error('Received empty blob');
          }
          
          // Check if blob type is valid image
          if (!blob.type.startsWith('image/')) {
            console.warn('[DraggableImage] Blob type is not an image:', blob.type, '- but trying to use it anyway');
            // Still try to use it, might work
          }
          
          const blobUrl = URL.createObjectURL(blob);
          console.log('[DraggableImage] Created blob URL:', blobUrl);
          setImgSrc(blobUrl);
          setImgError(false);
        } else {
          // Relative URL - use axios
          console.log('[DraggableImage] Loading image with axios (relative):', image.url);
          const response = await api.get(image.url, {
            responseType: 'blob',
          });
          console.log('[DraggableImage] Axios response received, size:', response.data.size, 'type:', response.data.type);
          const blobUrl = URL.createObjectURL(response.data);
          console.log('[DraggableImage] Created blob URL from axios:', blobUrl);
          setImgSrc(blobUrl);
          setImgError(false);
        }
      } catch (err) {
        console.error('[DraggableImage] Error loading image:', {
          fileName: image.fileName,
          url: image.url,
          originalUrl: image.originalUrl,
          error: err.message,
          stack: err.stack,
          response: err.response?.data,
          status: err.response?.status,
        });
        setImgError(true);
        // Don't set imgSrc on error - let the error UI show
      } finally {
        setLoading(false);
      }
    };
    
    if (image && image.url) {
      loadImage();
    } else {
      console.warn('[DraggableImage] Missing image or URL:', image);
      setImgError(true);
      setLoading(false);
    }
    
    // Cleanup blob URL on unmount
    return () => {
      if (imgSrc && imgSrc.startsWith('blob:')) {
        URL.revokeObjectURL(imgSrc);
      }
    };
  }, [image.url, image.fileName]);

  return (
    <div
      ref={drag}
      className={`draggable-image ${isDragging ? 'dragging' : ''}`}
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: 'move',
        touchAction: 'none', // Prevent touch scrolling
      }}
      draggable={false} // Let react-dnd handle dragging, not native HTML5 drag
    >
      {loading ? (
        <div className="image-loading">
          <div className="loading-spinner-small">Loading...</div>
        </div>
      ) : !imgError && imgSrc ? (
        <img
          src={imgSrc}
          alt={image.fileName}
          className="thumbnail-image"
          onError={() => {
            console.error('Failed to render image blob:', image.url);
            setImgError(true);
          }}
          onLoad={() => console.log('Image loaded successfully:', image.fileName)}
        />
      ) : (
        <div className="image-error">
          <div className="error-icon">⚠️</div>
          <div className="error-text">Failed to load</div>
        </div>
      )}
      <div className="image-label" title={image.url}>{image.fileName}</div>
    </div>
  );
};

/**
 * XHTML Canvas Component with Drop Handling
 */
/**
 * Drop Zone Overlay Component (for image drops only)
 * This is a transparent overlay that handles image drops
 */
const XhtmlCanvas = ({ xhtml, placeholders, onDrop, canvasRef }) => {
  const [{ isOver, isDragging, canDrop = false }, drop] = useDrop({
    accept: DRAG_TYPE,
    canDrop: (item, monitor) => {
      // Safety check: ensure monitor exists
      if (!monitor) {
        console.error('[XhtmlCanvas] canDrop - monitor is undefined');
        return false;
      }
      
      try {
        // Always allow drop when dragging an image
        const itemType = monitor.getItemType();
        const isImageDrag = itemType === DRAG_TYPE;
        console.log('[XhtmlCanvas] canDrop check:', isImageDrag);
        return isImageDrag;
      } catch (error) {
        console.error('[XhtmlCanvas] canDrop - Error:', error);
        return false;
      }
    },
    hover: (item, monitor) => {
      // Safety check: ensure monitor exists
      if (!monitor) {
        return;
      }
      
      try {
        // Emit custom event when image drag starts
        if (!isDragging && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('image-drag-start'));
        }
        console.log('[XhtmlCanvas] Hovering over drop zone with image:', item?.image?.fileName);
      } catch (error) {
        console.error('[XhtmlCanvas] hover - Error:', error);
      }
    },
    drop: (item, monitor) => {
      console.log('[XhtmlCanvas] ===== DROP HANDLER CALLED =====', {
        item: item?.image?.fileName,
        dropResult: monitor?.getDropResult(),
        didDrop: monitor?.didDrop()
      });
      
      // Safety check: ensure monitor exists
      if (!monitor) {
        console.error('[XhtmlCanvas] drop - monitor is undefined');
        return;
      }
      
      try {
        // Emit custom event when image drag ends
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('image-drag-end'));
        }
        
        // Safety check: ensure onDrop is a function
        if (!onDrop || typeof onDrop !== 'function') {
          console.error('[XhtmlCanvas] onDrop is not a function:', typeof onDrop);
          return;
        }
        
        // Safety check: ensure item and item.image exist
        if (!item || !item.image) {
          console.error('[XhtmlCanvas] Invalid drop item:', item);
          return;
        }
        
        const dropPoint = monitor.getClientOffset();
        if (!dropPoint) {
          console.warn('[XhtmlCanvas] No drop point available');
          return;
        }
        
        console.log('[XhtmlCanvas] Drop event triggered', { item, dropPoint });
        
        // Find the draggable-canvas-container inside canvasRef (where placeholders actually are)
        let searchContainer = null;
        if (canvasRef?.current) {
          searchContainer = canvasRef.current.querySelector('[data-draggable-canvas="true"]') || 
                            canvasRef.current.querySelector('.draggable-canvas-container') ||
                            canvasRef.current;
        }
        
        if (!searchContainer) {
          console.error('[XhtmlCanvas] Cannot find canvas container');
          return;
        }
        
        // Get ALL placeholders - search the entire container recursively
      // Include both divs with the class AND divs with title attributes that look like placeholders
      // Use querySelectorAll with a more comprehensive selector to find nested placeholders
      let allPlaceholders = searchContainer.querySelectorAll('.image-placeholder, .image-drop-zone');
      
      console.log(`[XhtmlCanvas] Initial query found ${allPlaceholders.length} placeholders`);
      
      // Also find divs with title attributes that should be placeholders but don't have the class
      const divsWithTitle = searchContainer.querySelectorAll('div[title]');
      console.log(`[XhtmlCanvas] Found ${divsWithTitle.length} divs with title attributes`);
      
      divsWithTitle.forEach((div) => {
        const hasClass = div.classList.contains('image-placeholder') || div.classList.contains('image-drop-zone');
        const hasText = div.textContent.trim().length > 0;
        const hasImg = div.querySelector('img') !== null;
        const id = div.id;
        const rect = div.getBoundingClientRect();
        
        // If it has a title, no class, no text content, no img child, and ID matches pattern
        if (!hasClass && !hasText && !hasImg && id && /^page\d+_(?:div|img)\d+$/.test(id)) {
          console.log(`[XhtmlCanvas] Found potential placeholder without class: ${id}, size: ${rect.width}x${rect.height}`);
          // Add to list (convert NodeList to Array first)
          const placeholderArray = Array.from(allPlaceholders);
          if (!placeholderArray.find(p => p.id === id)) {
            placeholderArray.push(div);
            allPlaceholders = placeholderArray; // Update the list
            // Add the class so it's detected properly
            div.classList.add('image-placeholder');
            // Force visibility
            div.style.setProperty('border', '2px dashed #007bff', 'important');
            div.style.setProperty('background-color', '#f0f0f0', 'important');
            div.style.setProperty('min-height', '50px', 'important');
            div.style.setProperty('min-width', '50px', 'important');
          }
        }
      });
      
      // Also check for divs with IDs matching the pattern even if they don't have title
      const divsWithIdPattern = searchContainer.querySelectorAll('div[id^="page"][id*="_img"], div[id^="page"][id*="_div"]');
      divsWithIdPattern.forEach((div) => {
        const hasClass = div.classList.contains('image-placeholder') || div.classList.contains('image-drop-zone');
        const hasText = div.textContent.trim().length > 0;
        const hasImg = div.querySelector('img') !== null;
        const id = div.id;
        
        // If it matches the pattern, has no class, no text, no img, it's likely a placeholder
        if (!hasClass && !hasText && !hasImg && /^page\d+_(?:img|div)\d+$/.test(id)) {
          const placeholderArray = Array.from(allPlaceholders);
          if (!placeholderArray.find(p => p.id === id)) {
            console.log(`[XhtmlCanvas] Found placeholder by ID pattern: ${id}`);
            placeholderArray.push(div);
            allPlaceholders = placeholderArray;
            div.classList.add('image-placeholder');
            div.style.setProperty('border', '2px dashed #007bff', 'important');
            div.style.setProperty('background-color', '#f0f0f0', 'important');
            div.style.setProperty('min-height', '50px', 'important');
            div.style.setProperty('min-width', '50px', 'important');
          }
        }
      });
      
      // Convert to array if it's still a NodeList
      if (allPlaceholders instanceof NodeList) {
        allPlaceholders = Array.from(allPlaceholders);
      }
      
      console.log(`[XhtmlCanvas] Found ${allPlaceholders.length} placeholders total`);
      
      // Debug: Log all placeholder details
      if (allPlaceholders.length > 0) {
        console.log('[XhtmlCanvas] Placeholder details:', Array.from(allPlaceholders).map((p, idx) => {
          const rect = p.getBoundingClientRect();
          return {
            index: idx,
            id: p.id,
            classes: p.className,
            size: `${rect.width}x${rect.height}`,
            position: `(${rect.left}, ${rect.top}) to (${rect.right}, ${rect.bottom})`,
            visible: rect.width > 0 && rect.height > 0,
            hasTitle: !!p.getAttribute('title')
          };
        }));
      }
      
      if (allPlaceholders.length === 0) {
        console.warn('[XhtmlCanvas] No placeholders found in canvas');
        console.warn('[XhtmlCanvas] Search container:', searchContainer?.tagName, searchContainer?.className);
        console.warn('[XhtmlCanvas] Canvas ref:', canvasRef?.current?.tagName, canvasRef?.current?.className);
        return;
      }
      
      // Find the placeholder that contains the drop point
      let targetPlaceholder = null;
      let minDistance = Infinity;
      
      allPlaceholders.forEach((div, idx) => {
        const rect = div.getBoundingClientRect();
        
        // Skip if element has zero size (might be hidden or not rendered)
        if (rect.width === 0 && rect.height === 0) {
          console.log(`[XhtmlCanvas] Skipping placeholder ${idx} (id: ${div.id}) - zero size`);
          return;
        }
        
        // Log detailed bounds for debugging
        console.log(`[XhtmlCanvas] Placeholder ${idx} (${div.id}):`, {
          bounds: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          },
          dropPoint: dropPoint,
          isInsideX: dropPoint.x >= rect.left && dropPoint.x <= rect.right,
          isInsideY: dropPoint.y >= rect.top && dropPoint.y <= rect.bottom
        });
        
        // Check if drop point is inside this placeholder (with some tolerance for edge cases)
        const tolerance = 5; // 5px tolerance for edge detection
        const isInside = dropPoint.x >= (rect.left - tolerance) && 
                        dropPoint.x <= (rect.right + tolerance) &&
                        dropPoint.y >= (rect.top - tolerance) && 
                        dropPoint.y <= (rect.bottom + tolerance);
        
        if (isInside) {
          // Found exact match - use this one
          if (!targetPlaceholder) {
            targetPlaceholder = div;
            minDistance = 0;
            console.log(`[XhtmlCanvas] ✓ Exact match: Placeholder ${idx} (id: ${div.id}, size: ${rect.width}x${rect.height})`);
          }
        } else {
          // Calculate distance to placeholder center
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance = Math.sqrt(
            Math.pow(dropPoint.x - centerX, 2) + Math.pow(dropPoint.y - centerY, 2)
          );
          
          // Also calculate distance to nearest edge (for very thin placeholders)
          const distToLeft = Math.abs(dropPoint.x - rect.left);
          const distToRight = Math.abs(dropPoint.x - rect.right);
          const distToTop = Math.abs(dropPoint.y - rect.top);
          const distToBottom = Math.abs(dropPoint.y - rect.bottom);
          const minEdgeDistance = Math.min(distToLeft, distToRight, distToTop, distToBottom);
          
          // Use the minimum of center distance and edge distance
          const effectiveDistance = Math.min(distance, minEdgeDistance);
          
          // Increase tolerance for near matches (150px for center, 50px for edge)
          const isNear = effectiveDistance < (minEdgeDistance < 50 ? 50 : 150);
          
          if (isNear && effectiveDistance < minDistance) {
            minDistance = effectiveDistance;
            targetPlaceholder = div;
            console.log(`[XhtmlCanvas] Near match: Placeholder ${idx} (id: ${div.id}), center distance: ${distance.toFixed(2)}px, edge distance: ${minEdgeDistance.toFixed(2)}px, size: ${rect.width}x${rect.height}`);
          }
        }
      });
      
      if (targetPlaceholder && targetPlaceholder.id) {
        console.log(`[XhtmlCanvas] ✓ Selected placeholder: ${targetPlaceholder.id}`);
        onDrop(targetPlaceholder.id, item.image);
      } else {
        // Fallback: Use elementFromPoint to find what's actually at the drop location
        console.warn('[XhtmlCanvas] ✗ No placeholder found at drop point, trying elementFromPoint fallback');
        const elementAtPoint = document.elementFromPoint(dropPoint.x, dropPoint.y);
        console.log('[XhtmlCanvas] Element at drop point:', elementAtPoint?.tagName, elementAtPoint?.id, elementAtPoint?.className);
        
        // Check if the element at point is a placeholder or inside one
        const placeholderAtPoint = elementAtPoint?.closest('.image-placeholder, .image-drop-zone');
        if (placeholderAtPoint && placeholderAtPoint.id) {
          console.log(`[XhtmlCanvas] ✓ Found placeholder via elementFromPoint: ${placeholderAtPoint.id}`);
            if (onDrop && typeof onDrop === 'function') {
              onDrop(placeholderAtPoint.id, item.image);
            }
          return;
        }
        
        // Last resort: Check if any placeholder contains the element at point
        allPlaceholders.forEach((placeholder) => {
          if (placeholder.contains(elementAtPoint) && placeholder.id) {
            console.log(`[XhtmlCanvas] ✓ Found placeholder containing element: ${placeholder.id}`);
            if (onDrop && typeof onDrop === 'function') {
              onDrop(placeholder.id, item.image);
            }
            return;
          }
        });
        
        // Final fallback: Find the closest placeholder by distance (even if not near)
        // This handles cases where the placeholder is very small or the drop point is slightly off
        if (allPlaceholders.length > 0) {
          let closestPlaceholder = null;
          let closestDistance = Infinity;
          
          allPlaceholders.forEach((placeholder) => {
            const rect = placeholder.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distance = Math.sqrt(
              Math.pow(dropPoint.x - centerX, 2) + Math.pow(dropPoint.y - centerY, 2)
            );
            
            // Also check distance to edges (for very thin placeholders)
            const distToLeft = Math.abs(dropPoint.x - rect.left);
            const distToRight = Math.abs(dropPoint.x - rect.right);
            const distToTop = Math.abs(dropPoint.y - rect.top);
            const distToBottom = Math.abs(dropPoint.y - rect.bottom);
            const minEdgeDistance = Math.min(distToLeft, distToRight, distToTop, distToBottom);
            
            // Use the minimum distance (center or edge)
            const effectiveDistance = Math.min(distance, minEdgeDistance);
            
            if (effectiveDistance < closestDistance) {
              closestDistance = effectiveDistance;
              closestPlaceholder = placeholder;
            }
          });
          
          if (closestPlaceholder && closestPlaceholder.id) {
            console.log(`[XhtmlCanvas] ✓ Using closest placeholder as final fallback: ${closestPlaceholder.id}, distance: ${closestDistance.toFixed(2)}px`);
            if (onDrop && typeof onDrop === 'function') {
              onDrop(closestPlaceholder.id, item.image);
            }
            return;
          }
        }
        
        console.warn('[XhtmlCanvas] ✗ No placeholder found at drop point after all fallbacks');
        console.log('[XhtmlCanvas] Drop point:', dropPoint);
        console.log('[XhtmlCanvas] Available placeholders:', Array.from(allPlaceholders).map(p => ({
          id: p.id,
          bounds: p.getBoundingClientRect()
        })));
      }
      } catch (error) {
        console.error('[XhtmlCanvas] drop - Error:', error);
      }
    },
    collect: (monitor) => {
      // Safety check: ensure monitor exists and has required methods
      if (!monitor) {
        console.error('[XhtmlCanvas] collect - monitor is undefined');
        return {
          isOver: false,
          isDragging: false,
          canDrop: false,
        };
      }
      
      try {
        // Safely get monitor values with fallbacks
        const item = (monitor && typeof monitor.getItem === 'function') ? monitor.getItem() : null;
        const itemType = (monitor && typeof monitor.getItemType === 'function') ? monitor.getItemType() : null;
        const isImageDrag = itemType === DRAG_TYPE;
        const isOverDrop = (monitor && typeof monitor.isOver === 'function') ? monitor.isOver() : false;
        const isDraggingNow = (monitor && typeof monitor.isDragging === 'function') ? monitor.isDragging() : false;
        const canDropValue = (monitor && typeof monitor.canDrop === 'function') ? monitor.canDrop() : false;
        
        // Always check global flag as fallback - even if monitor says not dragging
        const globalFlag = typeof window !== 'undefined' ? (window.__imageDragging || false) : false;
        const actuallyDragging = isDraggingNow || (globalFlag && isImageDrag);
        
        // If monitor methods aren't available but global flag is set, use it
        if ((!monitor || typeof monitor.isDragging !== 'function') && globalFlag) {
          console.warn('[XhtmlCanvas] collect - Using global flag as fallback (monitor methods not available)');
          return {
            isOver: false, // Can't determine without monitor
            isDragging: true, // Use global flag
            canDrop: true, // Assume we can drop if dragging
          };
        }
        
        // Log when dragging starts/stops
        if (actuallyDragging && isImageDrag) {
          console.log('[XhtmlCanvas] collect - Image being dragged:', {
            itemType,
            fileName: item?.image?.fileName,
            isOver: isOverDrop,
            canDrop: canDropValue,
            isDraggingNow,
            globalFlag,
            actuallyDragging
          });
        }
        
        return {
          isOver: isOverDrop,
          isDragging: isImageDrag && actuallyDragging, // Use combined check (monitor + global flag)
          canDrop: canDropValue || (globalFlag && isImageDrag), // Allow drop if global flag is set
        };
      } catch (error) {
        console.error('[XhtmlCanvas] collect - Error:', error);
        // On error, check global flag as last resort
        const globalFlag = typeof window !== 'undefined' ? (window.__imageDragging || false) : false;
        return {
          isOver: false,
          isDragging: globalFlag, // Use global flag on error
          canDrop: globalFlag, // Allow drop if global flag is set
        };
      }
    },
  });

  useEffect(() => {
    // Add drag-over class to placeholders when dragging over canvas
    if (isOver && canvasRef.current) {
      // Find the draggable-canvas-container inside canvasRef
      const draggableCanvas = canvasRef.current.querySelector('[data-draggable-canvas="true"]') || 
                               canvasRef.current.querySelector('.draggable-canvas-container') ||
                               canvasRef.current;
      
      const placeholderDivs = draggableCanvas.querySelectorAll('.image-placeholder, .image-drop-zone');
      placeholderDivs.forEach((div) => {
        div.classList.add('drag-over');
      });
      
      return () => {
        placeholderDivs.forEach((div) => {
          div.classList.remove('drag-over');
        });
      };
    }
  }, [isOver, canvasRef]);

  // This is a transparent overlay for drop handling
  // react-dnd needs this to always be present and active to detect drops
  // Check both local state and global flag to ensure we detect drags
  // Safe access to window object
  const globalFlag = typeof window !== 'undefined' ? (window.__imageDragging || false) : false;
  const isAnyImageDragging = isDragging || globalFlag;
  
  console.log('[XhtmlCanvas] Rendering overlay:', { 
    isDragging, 
    isOver, 
    canDrop: canDrop || false,
    globalFlag,
    isAnyImageDragging,
    dropRefType: typeof drop,
    dropRefValue: drop ? 'exists' : 'null'
  });
  
  // CRITICAL: react-dnd requires the drop target to always accept pointer events
  // Setting pointerEvents to 'none' prevents react-dnd from detecting drops
  // Instead, we'll make it always active but transparent when not dragging
  return (
    <div 
      ref={drop}
      data-drop-zone="true"
      data-testid="xhtml-canvas-drop-zone"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        // CRITICAL: react-dnd requires the drop target to always accept pointer events
        // Setting pointerEvents to 'none' prevents react-dnd from detecting drops
        // react-dnd will only intercept drag events, not regular clicks
        pointerEvents: 'auto', // Always active so react-dnd can detect drops
        zIndex: isAnyImageDragging ? 2000 : 100, // High z-index when dragging
        backgroundColor: isOver ? 'rgba(33, 150, 243, 0.2)' : (isAnyImageDragging ? 'rgba(33, 150, 243, 0.05)' : 'transparent'),
        border: isAnyImageDragging ? '2px dashed rgba(33, 150, 243, 0.5)' : 'none', // Visual indicator
        transition: 'background-color 0.2s ease',
        // Debug: Make overlay visible when dragging
        outline: isAnyImageDragging ? '2px solid rgba(33, 150, 243, 0.3)' : 'none',
      }}
      // REMOVED: Native onDragOver and onDrop handlers
      // These were interfering with react-dnd's event handling
      // react-dnd handles all drag/drop events internally
    />
  );
};

/**
 * Main EpubImageEditor Component
 */
const EpubImageEditor = ({ jobId, pageNumber, onSave, onStateChange }) => {
  const [xhtml, setXhtml] = useState('');
  const [originalXhtml, setOriginalXhtml] = useState('');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [placeholders, setPlaceholders] = useState([]);
  const canvasRef = useRef(null);
  const [modified, setModified] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Load XHTML and images
  // Only reload if pageNumber or jobId changes, NOT if we're just modifying XHTML
  useEffect(() => {
    // Reset modified flag when page changes
    setModified(false);
    loadData();
  }, [jobId, pageNumber]);
  
  // Prevent accidental reloads - log when loadData is called
  const loadDataRef = useRef(false);
  useEffect(() => {
    if (loadDataRef.current) {
      console.warn('[EpubImageEditor] loadData called - this will reset XHTML state');
    }
    loadDataRef.current = true;
  }, [jobId, pageNumber]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Load XHTML
      const xhtmlResponse = await api.get(`/conversions/${jobId}/xhtml/${pageNumber}`, {
        responseType: 'text',
      });
      let xhtmlContent = xhtmlResponse.data;
      
      // Apply reflowable CSS
      xhtmlContent = applyReflowableCss(xhtmlContent);
      
      // Convert relative image paths to absolute URLs for browser preview
      // Pattern: src="images/filename.ext" or src="../images/filename.ext" -> absolute URL
      const relativeImagePattern1 = /src=["']images\/([^"']+)["']/gi;
      const relativeImagePattern2 = /src=["']\.\.\/images\/([^"']+)["']/gi;
      
      xhtmlContent = xhtmlContent.replace(relativeImagePattern1, (match, fileName) => {
        const absoluteUrl = `${api.defaults.baseURL}/conversions/${jobId}/images/${fileName}`;
        console.log('Converting relative image path (images/):', match, '->', absoluteUrl);
        return `src="${absoluteUrl}"`;
      });
      
      xhtmlContent = xhtmlContent.replace(relativeImagePattern2, (match, fileName) => {
        const absoluteUrl = `${api.defaults.baseURL}/conversions/${jobId}/images/${fileName}`;
        console.log('Converting relative image path (../images/):', match, '->', absoluteUrl);
        return `src="${absoluteUrl}"`;
      });
      
      setOriginalXhtml(xhtmlContent);
      setXhtml(xhtmlContent);
      
      // Extract placeholders
      extractPlaceholdersFromXhtml(xhtmlContent);
      
      // Debug: Log placeholder detection after a short delay to ensure DOM is ready
      setTimeout(() => {
        if (canvasRef?.current) {
          const draggableCanvas = canvasRef.current.querySelector('[data-draggable-canvas="true"]') || 
                                   canvasRef.current.querySelector('.draggable-canvas-container') ||
                                   canvasRef.current;
          
          if (draggableCanvas) {
            const foundPlaceholders = draggableCanvas.querySelectorAll('.image-placeholder, .image-drop-zone');
            console.log(`[EpubImageEditor] After load - Found ${foundPlaceholders.length} placeholders in DOM:`, 
              Array.from(foundPlaceholders).map(p => ({
                id: p.id,
                classes: p.className,
                size: `${p.getBoundingClientRect().width}x${p.getBoundingClientRect().height}`,
                visible: p.getBoundingClientRect().width > 0 && p.getBoundingClientRect().height > 0,
                position: {
                  top: p.getBoundingClientRect().top,
                  left: p.getBoundingClientRect().left,
                  right: p.getBoundingClientRect().right,
                  bottom: p.getBoundingClientRect().bottom
                }
              }))
            );
          }
        }
      }, 500);
      
      // Load images
      const imagesResponse = await api.get(`/conversions/${jobId}/images`);
      const imagesList = imagesResponse.data.data || [];
      console.log('[EpubImageEditor] Loaded images from API:', imagesList.length, 'images');
      console.log('[EpubImageEditor] Sample image data:', imagesList[0]);
      
      // Get auth token for image URLs if needed
      const token = localStorage.getItem('token');
      const baseURL = api.defaults.baseURL || 'http://localhost:8081/api';
      console.log('[EpubImageEditor] API baseURL:', baseURL);
      
      // Convert relative URLs to absolute API URLs
      const imagesWithAbsoluteUrls = imagesList.map(img => {
        // Ensure URL is absolute
        let imageUrl = img.url;
        const originalUrl = imageUrl;
        
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          // Backend returns URLs like "/api/conversions/75/images/file.jpg"
          // baseURL is "http://localhost:8081/api"
          // We need to construct the full URL correctly
          
          if (imageUrl.startsWith('/api/')) {
            // URL is "/api/conversions/75/images/file.jpg"
            // baseURL is "http://localhost:8081/api"
            // Result should be "http://localhost:8081/api/conversions/75/images/file.jpg"
            // So we need to remove the leading "/api" and prepend baseURL
            imageUrl = `${baseURL}${imageUrl.substring(4)}`; // Remove '/api' (4 chars)
          } else if (imageUrl.startsWith('/')) {
            // URL starts with / but not /api, prepend baseURL
            imageUrl = `${baseURL}${imageUrl}`;
          } else {
            // Relative URL without leading slash
            imageUrl = `${baseURL}/conversions/${jobId}/images/${imageUrl}`;
          }
        }
        
        console.log('[EpubImageEditor] Image URL transformation:', {
          original: originalUrl,
          transformed: imageUrl,
          fileName: img.fileName
        });
        
        return {
          ...img,
          url: imageUrl,
          // Store original for debugging
          originalUrl: originalUrl
        };
      });
      
      console.log('[EpubImageEditor] Final images with absolute URLs:', imagesWithAbsoluteUrls.length);
      
      console.log('Images with absolute URLs:', imagesWithAbsoluteUrls);
      setImages(imagesWithAbsoluteUrls);
      
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.response?.data?.message || err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const extractPlaceholdersFromXhtml = (xhtmlContent) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtmlContent, 'application/xml');
    
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      // Fallback to regex - also look for divs with title attributes (image placeholders)
      const found = [];
      
      // Find divs with image-placeholder or image-drop-zone class
      const classRegex = /<div[^>]*class=["'][^"]*(?:image-placeholder|image-drop-zone)[^"]*["'][^>]*id=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = classRegex.exec(xhtmlContent)) !== null) {
        found.push({ id: match[1] });
      }
      
      // Also find divs with title attributes that look like image placeholders
      // Pattern: div with title attribute, no text content, ID like pageX_divY or pageX_imgY
      const titleRegex = /<div[^>]*id=["'](page\d+_(?:div|img)\d+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
      while ((match = titleRegex.exec(xhtmlContent)) !== null) {
        const id = match[1];
        // Check if not already added
        if (!found.find(p => p.id === id)) {
          found.push({ id });
        }
      }
      
      setPlaceholders(found);
      return;
    }
    
    // Find placeholders with the class
    const placeholderElements = doc.querySelectorAll('.image-placeholder, .image-drop-zone');
    const found = Array.from(placeholderElements).map((el) => ({
      id: el.id || `placeholder_${Math.random()}`,
      title: el.getAttribute('title') || '',
    }));
    
    // Also find divs with title attributes that look like image placeholders
    // These are divs that should be placeholders but don't have the class
    const allDivs = doc.querySelectorAll('div[title]');
    allDivs.forEach((div) => {
      const id = div.id;
      const title = div.getAttribute('title') || '';
      const hasClass = div.classList.contains('image-placeholder') || div.classList.contains('image-drop-zone');
      const hasText = div.textContent.trim().length > 0;
      
      // If it has a title, no class, no text content, and ID matches pattern (pageX_divY or pageX_imgY)
      if (!hasClass && !hasText && id && /^page\d+_(?:div|img)\d+$/.test(id)) {
        // This is likely an image placeholder - add it
        if (!found.find(p => p.id === id)) {
          found.push({ id, title });
          // Also add the class to the element for future use
          div.classList.add('image-placeholder');
        }
      }
    });
    
    setPlaceholders(found);
  };

  const handleDrop = useCallback((placeholderId, image) => {
    try {
      // For EPUB, use relative path: images/filename (not ../images/)
      // In EPUB structure: OEBPS/page_1.xhtml and OEBPS/images/file.jpg
      // So from page_1.xhtml, path should be "images/file.jpg"
      const relativePath = `images/${image.fileName}`;
      const absoluteUrl = image.url; // Already has the full URL
      
      console.log('Dropping image:', {
        placeholderId,
        fileName: image.fileName,
        relativePath,
        absoluteUrl,
        currentXhtmlLength: xhtml.length
      });
      
      // Use the current xhtml state - but ensure we're using the latest version
      // Get the current xhtml from state at the time of drop
      const currentXhtml = xhtml;
      console.log('[handleDrop] Current XHTML contains placeholder:', currentXhtml.includes(placeholderId));
      console.log('[handleDrop] Current XHTML contains image-drop-zone:', currentXhtml.includes('image-drop-zone'));
      
      // Inject image into XHTML with relative path (for EPUB)
      // But we'll also create a preview version with absolute URLs
      let modifiedXhtml = injectImageIntoXhtml(currentXhtml, placeholderId, relativePath);
      
      console.log('[handleDrop] After injection - modifiedXhtml length:', modifiedXhtml.length);
      console.log('[handleDrop] After injection - contains img tag:', modifiedXhtml.includes('<img'));
      console.log('[handleDrop] After injection - contains placeholder:', modifiedXhtml.includes(placeholderId) && modifiedXhtml.includes('image-drop-zone'));
      
      // For browser preview, replace relative paths with absolute URLs
      // This allows images to display in the preview while keeping EPUB-compatible paths
      const previewXhtml = modifiedXhtml.replace(
        new RegExp(`src=["']images/${image.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g'),
        `src="${absoluteUrl}"`
      );
      
      console.log('[handleDrop] Modified XHTML length:', previewXhtml.length);
      console.log('[handleDrop] Checking if image was injected:', previewXhtml.includes(image.fileName));
      console.log('[handleDrop] Checking if absolute URL exists:', previewXhtml.includes(absoluteUrl));
      console.log('[handleDrop] Sample of modified XHTML around image:', previewXhtml.substring(
        Math.max(0, previewXhtml.indexOf('page1_img2') - 100),
        Math.min(previewXhtml.length, previewXhtml.indexOf('page1_img2') + 200)
      ));
      
      // Verify the img tag exists and placeholder was replaced
      const imgTagPattern = new RegExp(`<img[^>]*id=["']${placeholderId}["'][^>]*>`, 'i');
      const imgTagMatch = previewXhtml.match(imgTagPattern);
      const placeholderDivPattern = new RegExp(`<div[^>]*id=["']${placeholderId}["'][^>]*class=["'][^"]*image-drop-zone[^"]*["']`, 'i');
      const placeholderStillExists = previewXhtml.match(placeholderDivPattern);
      
      console.log('[handleDrop] Verification:', {
        imgTagFound: !!imgTagMatch,
        placeholderStillExists: !!placeholderStillExists,
        hasAbsoluteUrl: previewXhtml.includes(absoluteUrl),
        hasRelativePath: previewXhtml.includes(`images/${image.fileName}`)
      });
      
      if (imgTagMatch && !placeholderStillExists) {
        console.log('[handleDrop] ✓ Image successfully injected - updating XHTML state');
        setXhtml(previewXhtml);
        setModified(true);
        
        // Re-extract placeholders after modification
        setTimeout(() => {
          extractPlaceholdersFromXhtml(previewXhtml);
          
          // Verify image persists in DOM after state update
          // Use multiple timeouts to catch the image at different render stages
          [100, 300, 500, 1000].forEach((delay, idx) => {
            setTimeout(() => {
              if (canvasRef?.current) {
                const img = canvasRef.current.querySelector(`img[id="${placeholderId}"]`);
                if (img) {
                  const rect = img.getBoundingClientRect();
                  const computedStyle = window.getComputedStyle(img);
                  console.log(`[handleDrop] ✓ Verification PASSED (check ${idx + 1}) - Image persists in DOM:`, {
                    id: img.id,
                    src: img.src,
                    size: `${rect.width}x${rect.height}`,
                    visible: rect.width > 0 && rect.height > 0,
                    display: computedStyle.display,
                    visibility: computedStyle.visibility,
                    opacity: computedStyle.opacity,
                    position: { top: rect.top, left: rect.left }
                  });
                  
                  // If image has zero size or is off-screen, force visibility
                  if (rect.width === 0 || rect.height === 0 || !img.src) {
                    console.warn(`[handleDrop] Image ${placeholderId} has issues - forcing visibility`);
                    img.style.setProperty('display', 'block', 'important');
                    img.style.setProperty('visibility', 'visible', 'important');
                    img.style.setProperty('opacity', '1', 'important');
                    img.style.setProperty('max-width', '100%', 'important');
                    img.style.setProperty('height', 'auto', 'important');
                    
                    // Scroll into view
                    setTimeout(() => {
                      img.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                    }, 100);
                  }
                } else {
                  console.error(`[handleDrop] ✗ Verification FAILED (check ${idx + 1}) - Image not found in DOM!`);
                  if (idx === 3) { // Last check - force restore
                    console.log('[handleDrop] Attempting to restore image by forcing re-render...');
                    setXhtml(prev => {
                      // If the image is missing, restore it
                      if (!prev.includes(`id="${placeholderId}"`) || prev.match(placeholderDivPattern)) {
                        console.log('[handleDrop] Restoring image from previewXhtml');
                        return previewXhtml;
                      }
                      return prev;
                    });
                  }
                }
              }
            }, delay);
          });
        }, 100);
        
        console.log('[handleDrop] Image inserted successfully');
      } else {
        console.error('[handleDrop] ✗ Image injection verification failed');
        setError(`Failed to inject image: ${!imgTagMatch ? 'Image tag not found' : 'Placeholder still exists'}`);
      }
      
    } catch (err) {
      console.error('Error handling drop:', err);
      setError('Failed to insert image: ' + err.message);
    }
  }, [xhtml, jobId]);

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      setError('');
      
      // Convert absolute image URLs back to relative paths for EPUB
      // Find all img tags with absolute URLs and convert them to relative paths
      // EPUB structure: OEBPS/page_1.xhtml and OEBPS/images/file.jpg
      // So path should be "images/file.jpg" (not "../images/")
      let xhtmlToSave = xhtml;
      
      // Pattern to match img src with absolute URLs pointing to our API
      const absoluteUrlPattern = new RegExp(
        `src=["']${api.defaults.baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/conversions/${jobId}/images/([^"']+)["']`,
        'gi'
      );
      
      xhtmlToSave = xhtmlToSave.replace(absoluteUrlPattern, (match, fileName) => {
        return `src="images/${fileName}"`;
      });
      
      // Also convert any ../images/ paths to images/ (fix old format)
      xhtmlToSave = xhtmlToSave.replace(/src=["']\.\.\/images\/([^"']+)["']/gi, (match, fileName) => {
        return `src="images/${fileName}"`;
      });
      
      console.log('Saving XHTML with relative image paths');
      
      // Send modified XHTML to backend
      await api.put(`/conversions/${jobId}/xhtml/${pageNumber}`, {
        xhtml: xhtmlToSave,
      });
      
      // Store the saved version (with relative paths) as original
      // But keep the preview version (with absolute URLs) in xhtml state
      setOriginalXhtml(xhtmlToSave);
      
      // Keep the current xhtml state (with absolute URLs) for preview
      // Don't change it - it already has absolute URLs that work in browser
      
      setModified(false);
      
      console.log('Saved XHTML with relative paths, kept preview with absolute URLs');
      
      if (onSave) {
        onSave(xhtmlToSave);
      }
      
      alert('XHTML saved successfully!');
    } catch (err) {
      console.error('Error saving XHTML:', err);
      setError(err.response?.data?.message || err.message || 'Failed to save XHTML');
    } finally {
      setSaving(false);
    }
  }, [xhtml, jobId, pageNumber, onSave]);

  const handleReset = useCallback(() => {
    if (window.confirm('Are you sure you want to reset all changes?')) {
      // Convert relative paths in originalXhtml to absolute URLs for preview
      let resetXhtml = originalXhtml;
      
      // Handle both formats: images/ and ../images/
      const relativeImagePattern1 = /src=["']images\/([^"']+)["']/gi;
      const relativeImagePattern2 = /src=["']\.\.\/images\/([^"']+)["']/gi;
      
      resetXhtml = resetXhtml.replace(relativeImagePattern1, (match, fileName) => {
        return `src="${api.defaults.baseURL}/conversions/${jobId}/images/${fileName}"`;
      });
      
      resetXhtml = resetXhtml.replace(relativeImagePattern2, (match, fileName) => {
        return `src="${api.defaults.baseURL}/conversions/${jobId}/images/${fileName}"`;
      });
      
      setXhtml(resetXhtml);
      setModified(false);
      extractPlaceholdersFromXhtml(resetXhtml);
    }
  }, [originalXhtml, jobId]);

  // Expose state to parent component (after functions are defined)
  // Only include state values in dependencies, not functions (they're memoized with useCallback)
  useEffect(() => {
    if (onStateChange) {
      onStateChange({ 
        editMode, 
        modified, 
        saving, 
        handleSave, 
        handleReset, 
        setEditMode 
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, modified, saving]); // Functions are stable (useCallback), onStateChange should be stable in parent

  if (loading) {
    return (
      <div className="epub-image-editor loading">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  // Debug: Log button visibility state
  console.log('[EpubImageEditor] Render state:', {
    editMode,
    modified,
    saving,
    saveButtonDisabled: saving || !modified || !editMode
  });

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="epub-image-editor">
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}
        
        <div className="editor-header" style={{ position: 'relative', zIndex: 10, minHeight: '60px' }}>
          <h2>EPUB Image Editor - Page {pageNumber}</h2>
          <div className="header-actions" style={{ display: 'flex', gap: '1em', alignItems: 'center', flexWrap: 'nowrap', minWidth: '400px' }}>
            <button
              onClick={() => setEditMode(!editMode)}
              className={`btn-toggle-edit ${editMode ? 'active' : ''}`}
              title={editMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
            >
              {editMode ? '✏️ Edit Mode ON' : '✏️ Edit Mode OFF'}
            </button>
            {modified && (
              <span className="modified-indicator">Modified</span>
            )}
            <button
              onClick={handleReset}
              disabled={!modified || !editMode}
              className="btn-reset"
              style={{ display: 'block', visibility: 'visible' }}
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !modified || !editMode}
              className="btn-save"
              style={{ 
                display: 'inline-block', 
                visibility: 'visible', 
                minWidth: '120px',
                opacity: (saving || !modified || !editMode) ? 0.6 : 1
              }}
              title={!editMode ? 'Enable Edit Mode to save' : (!modified ? 'No changes to save' : 'Save XHTML')}
            >
              {saving ? 'Saving...' : 'Save XHTML'}
            </button>
          </div>
        </div>

        <div className="editor-content">
          {/* Left Sidebar - Image Gallery (30%) */}
          <div className="image-gallery">
            <h3>Image Gallery ({images.length} images)</h3>
            {images.length === 0 ? (
              <div className="empty-gallery">
                <p>No images available</p>
                <button onClick={loadData} className="btn-refresh">
                  Refresh
                </button>
              </div>
            ) : (
              <>
                <div className="gallery-grid">
                  {images.map((image, index) => (
                    <DraggableImage
                      key={index}
                      image={image}
                      pageNumber={pageNumber}
                    />
                  ))}
                </div>
                {/* Debug info - remove in production */}
                {process.env.NODE_ENV === 'development' && (
                  <div className="debug-info" style={{ padding: '1em', fontSize: '0.8em', color: '#666', borderTop: '1px solid #e0e0e0' }}>
                    <strong>Debug:</strong>
                    {images.slice(0, 2).map((img, idx) => (
                      <div key={idx} style={{ marginTop: '0.5em', wordBreak: 'break-all' }}>
                        {img.fileName}: {img.url}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right Canvas - XHTML Display (70%) */}
          <div className="xhtml-canvas-wrapper">
            <div className="canvas-header">
              <h3>XHTML Canvas</h3>
              {placeholders.length > 0 && (
                <div className="placeholders-info">
                  <p>{placeholders.length} placeholder(s) found - Drag images from gallery to placeholders</p>
                </div>
              )}
            </div>
            <div className="canvas-wrapper" ref={canvasRef} style={{ position: 'relative' }}>
              <DraggableCanvas
                key={`canvas-${pageNumber}-${modified ? Date.now() : 'initial'}`} // Force re-render when XHTML changes
                xhtml={xhtml}
                onXhtmlChange={(updatedXhtml) => {
                  setXhtml(updatedXhtml);
                  setModified(true);
                }}
                editMode={editMode}
                onEditModeChange={setEditMode}
              />
              {/* Transparent drop zone overlay for image drops - only active when dragging images */}
              <XhtmlCanvas
                xhtml=""
                placeholders={placeholders}
                onDrop={handleDrop}
                canvasRef={canvasRef}
              />
            </div>
          </div>
        </div>
      </div>
    </DndProvider>
  );
};

export default EpubImageEditor;

