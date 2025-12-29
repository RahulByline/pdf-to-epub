import React, { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import api from '../services/api';
import { injectImageIntoXhtml, applyReflowableCss } from '../utils/xhtmlUtils';
import DraggableCanvas from './DraggableCanvas';
import GrapesJSCanvas from './GrapesJSCanvas';
import GrapesJSFooter from './GrapesJSFooter';
import FabricImageEditor from './FabricImageEditor';
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
      
      // Only warn if react-dnd didn't handle the drop AND we didn't use native drag events
      // Native drag events (used in GrapesJS mode) bypass react-dnd, so didDrop() will be false
      const usedNativeDrag = typeof window !== 'undefined' && (window.__nativeDragActive || window.currentDragImage !== null);
      if (!didDrop && !usedNativeDrag) {
        // This is a genuine failed drop in react-dnd mode
        console.warn('[DraggableImage] Drop failed - image was not dropped on a valid target');
      } else if (!didDrop && usedNativeDrag) {
        // Native drag was used, react-dnd didn't see it - this is expected
        console.log('[DraggableImage] Native drag event used (GrapesJS mode), react-dnd didDrop is false (expected)');
      }
      
      // Emit event to re-enable text block dragging
      window.dispatchEvent(new CustomEvent('image-drag-end'));
      // Clear global flag
      if (typeof window !== 'undefined') {
        window.__imageDragging = false;
        // Clear currentDragImage and native drag flag (they should already be cleared by native drag end, but ensure cleanup)
        setTimeout(() => {
          window.currentDragImage = null;
          window.__nativeDragActive = false;
        }, 100);
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

  // Support both react-dnd and native HTML5 drag (for GrapesJS)
  const handleNativeDragStart = (e) => {
    console.log('[DraggableImage] Native drag started:', image.fileName);
    // Set custom data for GrapesJS drop handler
    e.dataTransfer.setData('application/epub-image', JSON.stringify(image));
    e.dataTransfer.setData('text/plain', JSON.stringify(image)); // Fallback
    e.dataTransfer.effectAllowed = 'copy';
    
    // CRITICAL: Store in window global for iframe cross-boundary access
    if (typeof window !== 'undefined') {
      window.currentDragImage = image;
      window.__imageDragging = true;
      window.__nativeDragActive = true; // Flag to track native drag usage
    }
    
    // Also set for react-dnd compatibility
    window.dispatchEvent(new CustomEvent('image-drag-start', { detail: image }));
  };

  const handleNativeDragEnd = (e) => {
    console.log('[DraggableImage] Native drag ended:', image.fileName);
    window.dispatchEvent(new CustomEvent('image-drag-end'));
    if (typeof window !== 'undefined') {
      window.__imageDragging = false;
      // Clear the global drag image and native drag flag after a delay (allows react-dnd end handler to check)
      setTimeout(() => {
        if (window.currentDragImage === image) {
          window.currentDragImage = null;
        }
        window.__nativeDragActive = false;
      }, 200); // Increased delay to allow react-dnd end handler to check
    }
  };

  return (
    <div
      ref={drag}
      className={`draggable-image ${isDragging ? 'dragging' : ''}`}
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: 'move',
        touchAction: 'none', // Prevent touch scrolling
      }}
      draggable={true} // Enable native HTML5 drag for GrapesJS
      onDragStart={handleNativeDragStart}
      onDragEnd={handleNativeDragEnd}
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
 * Error Boundary Component to catch errors in XhtmlCanvas
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error in XhtmlCanvas:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return null; // Silently fail instead of crashing
    }
    return this.props.children;
  }
}

/**
 * Drop Zone Overlay Component (for image drops only)
 * This is a transparent overlay that handles image drops
 */
const XhtmlCanvas = ({ xhtml, placeholders, onDrop, canvasRef, editMode = false, oneByOneMode = true, useGrapesJS = false }) => {
  // Early return if onDrop is not a valid function
  if (!onDrop || typeof onDrop !== 'function') {
    console.warn('[XhtmlCanvas] onDrop is not a function, returning null');
    return null;
  }

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
        // Safely get itemType with fallback
        let itemType = null;
        try {
          if (monitor && typeof monitor.getItemType === 'function') {
            itemType = monitor.getItemType();
          } else {
            console.warn('[XhtmlCanvas] canDrop - monitor.getItemType is not a function, monitor:', monitor);
            return false;
          }
        } catch (getItemTypeError) {
          console.error('[XhtmlCanvas] canDrop - Error calling getItemType:', getItemTypeError);
          return false;
        }
        
        if (itemType === null || itemType === undefined) {
          console.warn('[XhtmlCanvas] canDrop - itemType is null/undefined');
          return false;
        }
        
        const isImageDrag = itemType === DRAG_TYPE;
        console.log('[XhtmlCanvas] canDrop check:', isImageDrag, 'itemType:', itemType);
        return isImageDrag;
      } catch (error) {
        console.error('[XhtmlCanvas] canDrop - Unexpected error:', error);
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
      
      // More flexible placeholder detection - not just regex-based
      // Check all divs with IDs for placeholder characteristics
      const allDivsWithId = searchContainer.querySelectorAll('div[id]');
      allDivsWithId.forEach((div) => {
        const hasClass = div.classList.contains('image-placeholder') || div.classList.contains('image-drop-zone');
        const hasText = div.textContent.trim().length > 0;
        const hasImg = div.querySelector('img') !== null;
        const id = div.id;
        const hasTitle = div.hasAttribute('title');
        const computedStyle = window.getComputedStyle(div);
        const isVisible = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
        
        // Skip if already in list
        const placeholderArray = Array.from(allPlaceholders);
        if (placeholderArray.find(p => p.id === id)) {
          return;
        }
        
        // Flexible detection criteria:
        // 1. Has the class (most reliable)
        // 2. Matches ID pattern (pageX_imgY or pageX_divY) - original pattern
        // 3. Has title attribute and looks like placeholder (empty, no img)
        // 4. Has aspect-ratio CSS (common for image placeholders)
        const matchesIdPattern = /^page\d+_(?:img|div)\d+$/i.test(id);
        const hasAspectRatio = computedStyle.aspectRatio && computedStyle.aspectRatio !== 'auto';
        const looksLikePlaceholder = !hasText && !hasImg && (hasTitle || hasAspectRatio || hasClass);
        
        if (hasClass || (matchesIdPattern && looksLikePlaceholder) || (hasTitle && looksLikePlaceholder && isVisible)) {
          console.log(`[XhtmlCanvas] Found placeholder (flexible): ${id}`, {
            hasClass,
            matchesIdPattern,
            hasTitle,
            hasAspectRatio,
            isVisible
          });
          placeholderArray.push(div);
          allPlaceholders = placeholderArray;
          
          // Ensure it has the class for future detection
          if (!hasClass) {
            div.classList.add('image-placeholder');
          }
          
          // Ensure visibility
          div.style.setProperty('border', '2px dashed #007bff', 'important');
          div.style.setProperty('background-color', '#f0f0f0', 'important');
          div.style.setProperty('min-height', '50px', 'important');
          div.style.setProperty('min-width', '50px', 'important');
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
      
      // Sort placeholders by position (top to bottom, left to right) for sequential dropping
      const sortedPlaceholders = Array.from(allPlaceholders).sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        // First sort by top position (vertical)
        if (Math.abs(rectA.top - rectB.top) > 10) {
          return rectA.top - rectB.top;
        }
        // If roughly on the same row, sort by left position (horizontal)
        return rectA.left - rectB.left;
      });
      
      // Find the first empty placeholder (sequential order: 1, 2, 3...)
      const findNextEmptyPlaceholder = () => {
        for (let i = 0; i < sortedPlaceholders.length; i++) {
          const placeholder = sortedPlaceholders[i];
          const hasImage = placeholder.querySelector('img') !== null;
          if (!hasImage) {
            return { placeholder, index: i + 1 }; // Return 1-indexed number
          }
        }
        return null; // All placeholders are filled
      };
      
      const nextEmpty = findNextEmptyPlaceholder();
      
      // In one-by-one mode: only allow drop on the next empty placeholder in sequence
      if (oneByOneMode) {
        if (hoveredPlaceholderIdRef.current) {
          const hoveredPlaceholder = sortedPlaceholders.find(p => p.id === hoveredPlaceholderIdRef.current);
          if (hoveredPlaceholder && hoveredPlaceholder.id) {
            // Check if the hovered placeholder is the next empty one
            if (nextEmpty && hoveredPlaceholder.id === nextEmpty.placeholder.id) {
              console.log(`[XhtmlCanvas] Sequential mode: Dropping on placeholder #${nextEmpty.index} (${hoveredPlaceholder.id})`);
              onDrop(hoveredPlaceholder.id, item.image);
              return { dropped: true, placeholderId: hoveredPlaceholder.id };
            } else if (nextEmpty) {
              console.warn(`[XhtmlCanvas] Sequential mode: Can only drop on placeholder #${nextEmpty.index}, but hovered placeholder is different. Ignoring drop.`);
              // Optionally show a message to the user
              alert(`Please drop the image on placeholder #${nextEmpty.index} first.`);
              return;
            } else {
              console.warn('[XhtmlCanvas] Sequential mode: All placeholders are filled');
              alert('All placeholders are already filled.');
              return;
            }
          } else {
            console.warn('[XhtmlCanvas] Sequential mode: Hovered placeholder not found, ignoring drop');
            return;
          }
        } else {
          // No hovered placeholder, but we can still drop on the next empty one
          if (nextEmpty) {
            console.log(`[XhtmlCanvas] Sequential mode: Auto-dropping on next empty placeholder #${nextEmpty.index} (${nextEmpty.placeholder.id})`);
            onDrop(nextEmpty.placeholder.id, item.image);
            return { dropped: true, placeholderId: nextEmpty.placeholder.id };
          } else {
            console.warn('[XhtmlCanvas] Sequential mode: All placeholders are filled');
            alert('All placeholders are already filled.');
            return;
          }
        }
      }
      
      // PRIMARY METHOD: Use DOM-based detection (elementFromPoint + closest)
      // This is 100% accurate regardless of absolute positioning, transforms, or scroll
      // This handles the "absolute positioning trap" you identified
      console.log('[XhtmlCanvas] Using DOM-based drop detection (elementFromPoint)');
      const elementAtPoint = document.elementFromPoint(dropPoint.x, dropPoint.y);
      console.log('[XhtmlCanvas] Element at drop point:', {
        tag: elementAtPoint?.tagName,
        id: elementAtPoint?.id,
        className: elementAtPoint?.className,
        isPlaceholder: elementAtPoint?.classList?.contains('image-placeholder') || elementAtPoint?.classList?.contains('image-drop-zone')
      });
      
      // Strategy 1: Check if the element itself is a placeholder
      if (elementAtPoint && (
        elementAtPoint.classList?.contains('image-placeholder') || 
        elementAtPoint.classList?.contains('image-drop-zone')
      )) {
        const placeholderId = elementAtPoint.id;
        if (placeholderId) {
          console.log(`[XhtmlCanvas] ✓ Direct match: Element is placeholder ${placeholderId}`);
          onDrop(placeholderId, item.image);
          return { dropped: true, placeholderId };
        }
      }
      
      // Strategy 2: Use closest() to find parent placeholder (handles nested structures)
      const placeholderAtPoint = elementAtPoint?.closest('.image-placeholder, .image-drop-zone');
      if (placeholderAtPoint && placeholderAtPoint.id) {
        console.log(`[XhtmlCanvas] ✓ Found via closest(): ${placeholderAtPoint.id}`);
        onDrop(placeholderAtPoint.id, item.image);
        return { dropped: true, placeholderId: placeholderAtPoint.id };
      }
      
      // Strategy 3: Check if any placeholder contains the element (for absolute positioned children)
      // This handles cases where the element is a child of an absolutely positioned placeholder
      let containingPlaceholder = null;
      for (const placeholder of allPlaceholders) {
        if (placeholder.contains(elementAtPoint) && placeholder.id) {
          containingPlaceholder = placeholder;
          break;
        }
      }
      
      if (containingPlaceholder && containingPlaceholder.id) {
        console.log(`[XhtmlCanvas] ✓ Found containing placeholder: ${containingPlaceholder.id}`);
        onDrop(containingPlaceholder.id, item.image);
        return { dropped: true, placeholderId: containingPlaceholder.id };
      }
      
      // FALLBACK: Coordinate-based detection (only if DOM methods fail)
      // This is less reliable but handles edge cases
      console.warn('[XhtmlCanvas] DOM-based detection failed, falling back to coordinate-based detection');
      let targetPlaceholder = null;
      let minDistance = Infinity;
      
      allPlaceholders.forEach((div, idx) => {
        const rect = div.getBoundingClientRect();
        
        // Skip if element has zero size (might be hidden or not rendered)
        if (rect.width === 0 && rect.height === 0) {
          return;
        }
        
        // Check if drop point is inside this placeholder (with tolerance)
        const tolerance = 10; // Increased tolerance for absolute positioned elements
        const isInside = dropPoint.x >= (rect.left - tolerance) && 
                        dropPoint.x <= (rect.right + tolerance) &&
                        dropPoint.y >= (rect.top - tolerance) && 
                        dropPoint.y <= (rect.bottom + tolerance);
        
        if (isInside) {
          // Found match - use this one
          if (!targetPlaceholder) {
            targetPlaceholder = div;
            minDistance = 0;
            console.log(`[XhtmlCanvas] ✓ Coordinate match: Placeholder ${idx} (id: ${div.id})`);
          }
        } else {
          // Calculate distance to placeholder center
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance = Math.sqrt(
            Math.pow(dropPoint.x - centerX, 2) + Math.pow(dropPoint.y - centerY, 2)
          );
          
          // For absolutely positioned elements, use larger tolerance
          const computedStyle = window.getComputedStyle(div);
          const isAbsolute = computedStyle.position === 'absolute';
          const maxDistance = isAbsolute ? 200 : 150; // Larger tolerance for absolute
          
          if (distance < maxDistance && distance < minDistance) {
            minDistance = distance;
            targetPlaceholder = div;
            console.log(`[XhtmlCanvas] Near match: Placeholder ${idx} (id: ${div.id}), distance: ${distance.toFixed(2)}px, absolute: ${isAbsolute}`);
          }
        }
      });
      
      if (targetPlaceholder && targetPlaceholder.id) {
        console.log(`[XhtmlCanvas] ✓ Selected placeholder via coordinates: ${targetPlaceholder.id}`);
        onDrop(targetPlaceholder.id, item.image);
        return { dropped: true, placeholderId: targetPlaceholder.id };
      } else {
        console.warn('[XhtmlCanvas] ✗ No placeholder found at drop point after all methods');
        console.log('[XhtmlCanvas] Drop point:', dropPoint);
        console.log('[XhtmlCanvas] Element at point:', elementAtPoint);
        console.log('[XhtmlCanvas] Available placeholders:', Array.from(allPlaceholders).map(p => ({
          id: p.id,
          position: window.getComputedStyle(p).position,
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

  // Track which placeholder is currently being hovered (for one-by-one mode)
  const [hoveredPlaceholderId, setHoveredPlaceholderId] = useState(null);
  const hoveredPlaceholderIdRef = useRef(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    hoveredPlaceholderIdRef.current = hoveredPlaceholderId;
  }, [hoveredPlaceholderId]);

  useEffect(() => {
    // Handle placeholder highlighting based on sequential mode
    // DISABLED: Highlighting ONLY happens in GrapesJS mode, not in standard mode
    // Since XhtmlCanvas only renders when useGrapesJS is false, checking for useGrapesJS 
    // ensures this highlighting code never runs (which is what we want)
    if (useGrapesJS && isOver && canvasRef.current) {
      // Find the draggable-canvas-container inside canvasRef
      const draggableCanvas = canvasRef.current.querySelector('[data-draggable-canvas="true"]') || 
                               canvasRef.current.querySelector('.draggable-canvas-container') ||
                               canvasRef.current;
      
      const placeholderDivs = draggableCanvas.querySelectorAll('.image-placeholder, .image-drop-zone');
      
      // Sort placeholders by position (same as in drop handler)
      const sortedPlaceholders = Array.from(placeholderDivs).sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        if (Math.abs(rectA.top - rectB.top) > 10) {
          return rectA.top - rectB.top;
        }
        return rectA.left - rectB.left;
      });
      
      // Find the next empty placeholder
      const findNextEmptyPlaceholder = () => {
        for (let i = 0; i < sortedPlaceholders.length; i++) {
          const placeholder = sortedPlaceholders[i];
          const hasImage = placeholder.querySelector('img') !== null;
          if (!hasImage) {
            return { placeholder, index: i + 1 };
          }
        }
        return null;
      };
      
      const nextEmpty = findNextEmptyPlaceholder();
      
      if (oneByOneMode) {
        // In sequential mode: only highlight the next empty placeholder (or the hovered one if it's the next)
        placeholderDivs.forEach((div) => {
          const isNextEmpty = nextEmpty && div.id === nextEmpty.placeholder.id;
          const isHovered = div.id === hoveredPlaceholderId;
          const isTarget = isNextEmpty && (isHovered || !hoveredPlaceholderId); // Highlight next empty, or hovered if it's the next
          
          if (isTarget) {
            div.classList.add('drag-over', 'drag-over-active');
            // Add a label showing which placeholder number
            let label = div.querySelector('.placeholder-label');
            if (!label) {
              label = document.createElement('div');
              label.className = 'placeholder-label';
              div.style.position = 'relative';
              div.appendChild(label);
            }
            label.textContent = `Drop here: Placeholder #${nextEmpty.index}`;
            label.style.cssText = `
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: rgba(76, 175, 80, 0.95);
              color: white;
              padding: 12px 20px;
              border-radius: 8px;
              font-weight: bold;
              font-size: 14px;
              z-index: 10000;
              pointer-events: none;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              white-space: nowrap;
            `;
          } else {
            div.classList.remove('drag-over', 'drag-over-active');
            div.classList.add('drag-over-disabled');
            // Remove label from other placeholders
            const label = div.querySelector('.placeholder-label');
            if (label) label.remove();
          }
        });
      } else {
        // In normal mode: highlight all placeholders
        placeholderDivs.forEach((div) => {
          div.classList.add('drag-over');
          div.classList.remove('drag-over-disabled', 'drag-over-active');
          // Remove labels
          const label = div.querySelector('.placeholder-label');
          if (label) label.remove();
        });
      }
      
      return () => {
        placeholderDivs.forEach((div) => {
          div.classList.remove('drag-over', 'drag-over-active', 'drag-over-disabled');
          const label = div.querySelector('.placeholder-label');
          if (label) label.remove();
        });
        setHoveredPlaceholderId(null);
      };
    }
  }, [isOver, canvasRef, oneByOneMode, hoveredPlaceholderId, useGrapesJS]);

  // Track mouse movement to find which placeholder is being hovered
  useEffect(() => {
    if (!oneByOneMode || !isOver) {
      setHoveredPlaceholderId(null);
      return;
    }

    const handleMouseMove = (e) => {
      if (!canvasRef?.current) return;

      const draggableCanvas = canvasRef.current.querySelector('[data-draggable-canvas="true"]') || 
                               canvasRef.current.querySelector('.draggable-canvas-container') ||
                               canvasRef.current;
      
      if (!draggableCanvas) return;

      // Find all placeholders
      const allPlaceholders = draggableCanvas.querySelectorAll('.image-placeholder, .image-drop-zone');
      
      // Find which placeholder the mouse is over
      let hoveredId = null;
      let minDistance = Infinity;

      allPlaceholders.forEach((placeholder) => {
        const rect = placeholder.getBoundingClientRect();
        const isInside = e.clientX >= rect.left && 
                        e.clientX <= rect.right && 
                        e.clientY >= rect.top && 
                        e.clientY <= rect.bottom;
        
        if (isInside) {
          // Calculate distance to center for tie-breaking
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance = Math.sqrt(
            Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2)
          );
          
          if (distance < minDistance) {
            minDistance = distance;
            hoveredId = placeholder.id;
          }
        }
      });

      setHoveredPlaceholderId(hoveredId);
    };

    if (canvasRef?.current) {
      canvasRef.current.addEventListener('mousemove', handleMouseMove);
      return () => {
        if (canvasRef?.current) {
          canvasRef.current.removeEventListener('mousemove', handleMouseMove);
        }
      };
    }
  }, [oneByOneMode, isOver, canvasRef]);

  // Note: The GrapesJS drop handler useEffect is in the EpubImageEditor component
  // because it needs access to useGrapesJS state which is defined there

  // This is a transparent overlay for drop handling
  // react-dnd needs this to always be present and active to detect drops
  // Check both local state and global flag to ensure we detect drags
  // Safe access to window object
  const globalFlag = typeof window !== 'undefined' ? (window.__imageDragging || false) : false;
  const isAnyImageDragging = isDragging || globalFlag;
  
  // When edit mode is ON and no image is being dragged, allow pointer events to pass through
  // so text elements can be clicked and edited
  // When an image is being dragged, we need pointer events to detect drops
  // BUT: Always allow pointer events to pass through for image-with-options overlays (z-index 3000)
  const shouldBlockPointerEvents = isAnyImageDragging || !editMode;
  
  // Check if mouse is over an image-with-options wrapper (which has the clear button overlay)
  // If so, don't block pointer events so the button can be clicked
  const [isOverImageOptions, setIsOverImageOptions] = useState(false);
  
  useEffect(() => {
    const handleMouseMove = (e) => {
      const target = e.target;
      const imageWrapper = target.closest('.image-with-options');
      setIsOverImageOptions(!!imageWrapper);
    };
    
    if (canvasRef?.current) {
      canvasRef.current.addEventListener('mousemove', handleMouseMove);
      return () => {
        if (canvasRef?.current) {
          canvasRef.current.removeEventListener('mousemove', handleMouseMove);
        }
      };
    }
  }, [canvasRef]);
  
  console.log('[XhtmlCanvas] Rendering overlay:', { 
    isDragging, 
    isOver, 
    canDrop: canDrop || false,
    globalFlag,
    isAnyImageDragging,
    editMode,
    shouldBlockPointerEvents,
    dropRefType: typeof drop,
    dropRefValue: drop ? 'exists' : 'null'
  });
  
  // CRITICAL: react-dnd requires the drop target to accept pointer events when dragging
  // But when edit mode is ON and not dragging, we want clicks to pass through to text elements
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
        // Allow pointer events to pass through when edit mode is ON and not dragging
        // This enables text editing. When dragging, we need pointer events to detect drops
        // When hovering over image options overlay, allow clicks to pass through
        // Image overlay has z-index 3000, so it's always on top
        pointerEvents: (shouldBlockPointerEvents && !isOverImageOptions) ? 'auto' : 'none',
        zIndex: isAnyImageDragging ? 2000 : (editMode ? 50 : 100), // Lower z-index in edit mode when not dragging (image overlay is 3000)
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
 * Format XHTML for display (prettify)
 */
const formatXHTML = (xhtml) => {
  if (!xhtml) return '';
  
  try {
    // Use DOMParser to parse and format
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtml, 'text/html');
    
    // Simple recursive formatter
    const formatNode = (node, indent = 0) => {
      const indentStr = '  '.repeat(indent);
      
      if (node.nodeType === 1) { // ELEMENT_NODE
        const tagName = node.tagName.toLowerCase();
        let attrs = '';
        if (node.attributes && node.attributes.length > 0) {
          attrs = ' ' + Array.from(node.attributes)
            .map(attr => `${attr.name}="${attr.value}"`)
            .join(' ');
        }
        
        const children = Array.from(node.childNodes).filter(n => 
          n.nodeType === 1 || (n.nodeType === 3 && n.textContent && n.textContent.trim())
        );
        
        if (children.length === 0) {
          // Self-closing or empty tag
          return `${indentStr}<${tagName}${attrs} />\n`;
        } else {
          let result = `${indentStr}<${tagName}${attrs}>\n`;
          children.forEach(child => {
            if (child.nodeType === 1) { // Element
              result += formatNode(child, indent + 1);
            } else if (child.nodeType === 3 && child.textContent && child.textContent.trim()) { // Text
              const text = child.textContent.trim();
              if (text.length > 0) {
                result += '  '.repeat(indent + 1) + text + '\n';
              }
            }
          });
          result += `${indentStr}</${tagName}>\n`;
          return result;
        }
      }
      
      return '';
    };
    
    // Build formatted output
    let formatted = '';
    if (doc.documentElement) {
      // Format head if exists
      if (doc.head && doc.head.innerHTML.trim()) {
        formatted += '<head>\n';
        Array.from(doc.head.childNodes).forEach(child => {
          formatted += formatNode(child, 1);
        });
        formatted += '</head>\n';
      }
      
      // Format body if exists
      if (doc.body && doc.body.innerHTML.trim()) {
        formatted += '<body>\n';
        Array.from(doc.body.childNodes).forEach(child => {
          formatted += formatNode(child, 1);
        });
        formatted += '</body>\n';
      }
    }
    
    return formatted || xhtml;
  } catch (e) {
    console.warn('Failed to format XHTML, using original:', e);
    return xhtml;
  }
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
  const [editMode, setEditMode] = useState(true);
  const [editingImage, setEditingImage] = useState(null); // {imageId, imageUrl, imageElement}
  const [imageEditorVisible, setImageEditorVisible] = useState(false);
  const [galleryWidth, setGalleryWidth] = useState(30); // Percentage width for gallery
  const [isResizing, setIsResizing] = useState(false);
  const oneByOneMode = true; // One-by-one drop mode (always enabled)
  const [useGrapesJS, setUseGrapesJS] = useState(true); // Toggle between GrapesJS and DraggableCanvas
  const [grapesjsEditor, setGrapesjsEditor] = useState(null); // GrapesJS editor instance
  const [showCodeViewer, setShowCodeViewer] = useState(false); // Show/hide XHTML code viewer
  const [editedXhtml, setEditedXhtml] = useState(''); // Editable XHTML code in viewer

  // Initialize edited XHTML when opening code viewer
  useEffect(() => {
    if (showCodeViewer) {
      setEditedXhtml(xhtml);
    }
  }, [showCodeViewer, xhtml]);

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
      
      // Apply reflowable CSS FIRST (needs full document structure)
      xhtmlContent = applyReflowableCss(xhtmlContent);
      
      // Extract body content if XHTML is a full document
      // This prevents rendering issues when inserting full HTML documents via dangerouslySetInnerHTML
      const parser = new DOMParser();
      let doc = parser.parseFromString(xhtmlContent, 'text/html');
      let parserError = doc.querySelector('parsererror');
      
      if (parserError) {
        // Try XML parsing
        doc = parser.parseFromString(xhtmlContent, 'application/xml');
        parserError = doc.querySelector('parsererror');
      }
      
      if (!parserError && (doc.body || doc.documentElement)) {
        // Extract styles from head (including the reflowable CSS we just added)
        const headStyles = doc.head ? Array.from(doc.head.querySelectorAll('style')).map(s => s.innerHTML).join('\n') : '';
        const headLinks = doc.head ? Array.from(doc.head.querySelectorAll('link[rel="stylesheet"]')).map(l => l.outerHTML).join('\n') : '';
        
        // Get body content
        const bodyContent = doc.body ? doc.body.innerHTML : (doc.documentElement ? doc.documentElement.innerHTML : xhtmlContent);
        
        // Reconstruct with styles in a style tag
        if (headStyles || headLinks) {
          xhtmlContent = `<div class="xhtml-content-wrapper">${headLinks ? headLinks : ''}${headStyles ? `<style>${headStyles}</style>` : ''}${bodyContent}</div>`;
        } else {
          xhtmlContent = `<div class="xhtml-content-wrapper">${bodyContent}</div>`;
        }
      } else {
        // If parsing failed, wrap the content anyway to ensure it renders
        console.warn('[EpubImageEditor] XHTML parsing had errors, wrapping content anyway');
        xhtmlContent = `<div class="xhtml-content-wrapper">${xhtmlContent}</div>`;
      }
      
      // Debug: Log the final XHTML structure
      console.log('[EpubImageEditor] Final XHTML length:', xhtmlContent.length);
      console.log('[EpubImageEditor] XHTML contains body content:', xhtmlContent.includes('page4') || xhtmlContent.includes('page'));
      console.log('[EpubImageEditor] XHTML contains styles:', xhtmlContent.includes('<style'));
      
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
      
      // INSPECT: Check for existing images in XHTML
      const tempDoc = parser.parseFromString(xhtmlContent, 'text/html');
      const existingImages = tempDoc.querySelectorAll('img');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[EpubImageEditor] 🔍 INSPECTING XHTML for existing images');
      console.log('[EpubImageEditor] Total images found in XHTML:', existingImages.length);
      
      if (existingImages.length > 0) {
        console.log('[EpubImageEditor] ⚠️ Images already present in XHTML (these will display automatically):');
        existingImages.forEach((img, index) => {
          console.log(`  [${index + 1}] Image ID: "${img.id || '(no ID)'}", SRC: "${img.src || img.getAttribute('src') || '(no src)'}"`);
        });
      } else {
        console.log('[EpubImageEditor] ✓ No images found in XHTML - starting with clean placeholders');
      }
      
      // Also check for placeholder divs
      const placeholderDivs = tempDoc.querySelectorAll('.image-placeholder, .image-drop-zone');
      console.log('[EpubImageEditor] Placeholder divs found:', placeholderDivs.length);
      placeholderDivs.forEach((div, index) => {
        const hasImg = div.querySelector('img') !== null;
        console.log(`  Placeholder [${index + 1}]: ID="${div.id || '(no ID)'}", Has Image=${hasImg}`);
      });
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Extract placeholders
      extractPlaceholdersFromXhtml(xhtmlContent);
      
      // Debug: Log placeholder detection after a short delay to ensure DOM is ready
      setTimeout(() => {
        if (canvasRef?.current) {
          // Check if GrapesJS is enabled - placeholders are in the iframe
          const grapesJSCanvas = canvasRef.current.querySelector('.grapesjs-canvas-container');
          if (grapesJSCanvas) {
            // For GrapesJS, placeholders are in the iframe - we can't query them directly
            // But we know they exist from extractPlaceholdersFromXhtml
            console.log(`[EpubImageEditor] After load - GrapesJS mode: Found ${placeholders.length} placeholders from XHTML parsing (placeholders are in GrapesJS iframe)`);
          } else {
            // Standard mode - query DOM directly
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
    let doc = parser.parseFromString(xhtmlContent, 'text/html');
    
    let parserError = doc.querySelector('parsererror');
    if (parserError) {
      doc = parser.parseFromString(xhtmlContent, 'application/xml');
      parserError = doc.querySelector('parsererror');
    }
    
    const found = [];
    
    if (parserError) {
      // Fallback to regex - also look for divs with title attributes (image placeholders)
      console.log('[EpubImageEditor] Using regex fallback for placeholder detection');
      
      // Find divs with image-placeholder or image-drop-zone class
      const classRegex = /<div[^>]*class=["'][^"]*(?:image-placeholder|image-drop-zone)[^"]*["'][^>]*id=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = classRegex.exec(xhtmlContent)) !== null) {
        found.push({ id: match[1] });
      }
      
      // Also find img tags with IDs matching placeholder pattern (these are placed images)
      const imgRegex = /<img[^>]*id=["'](page\d+_(?:div|img)\d+)["'][^>]*>/gi;
      while ((match = imgRegex.exec(xhtmlContent)) !== null) {
        const id = match[1];
        if (!found.find(p => p.id === id)) {
          found.push({ id });
        }
      }
      
      // Also find divs with title attributes that look like image placeholders
      const titleRegex = /<div[^>]*id=["'](page\d+_(?:div|img)\d+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
      while ((match = titleRegex.exec(xhtmlContent)) !== null) {
        const id = match[1];
        if (!found.find(p => p.id === id)) {
          found.push({ id });
        }
      }
      
      console.log(`[EpubImageEditor] Found ${found.length} placeholders via regex`);
      setPlaceholders(found);
      return;
    }
    
    // Find placeholders with the class (divs)
    const placeholderElements = doc.querySelectorAll('.image-placeholder, .image-drop-zone');
    placeholderElements.forEach((el) => {
      const id = el.id || `placeholder_${Math.random()}`;
      if (!found.find(p => p.id === id)) {
        found.push({ id, title: el.getAttribute('title') || '' });
      }
    });
    
    // Also find img tags with IDs matching placeholder pattern (these are placed images)
    const imgElements = doc.querySelectorAll('img[id]');
    imgElements.forEach((img) => {
      const id = img.id;
      // Check if ID matches placeholder pattern (pageX_divY or pageX_imgY)
      if (id && /^page\d+_(?:div|img)\d+$/.test(id)) {
        if (!found.find(p => p.id === id)) {
          found.push({ id, title: img.getAttribute('alt') || img.getAttribute('title') || '' });
        }
      }
    });
    
    // Also find divs with title attributes that look like image placeholders
    const allDivs = doc.querySelectorAll('div[title], div[id]');
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
    
    console.log(`[EpubImageEditor] Found ${found.length} placeholders total:`, found.map(p => p.id));
    setPlaceholders(found);
  };

  // Handle saving edited XHTML from code viewer
  const handleSaveEditedXhtml = useCallback(() => {
    try {
      // Update the main XHTML state with edited content
      // Use functional update to ensure we're working with latest state
      setXhtml((currentXhtml) => {
        console.log('[EpubImageEditor] Saving edited XHTML from code viewer', {
          currentLength: currentXhtml.length,
          newLength: editedXhtml.length,
          changed: currentXhtml !== editedXhtml
        });
        return editedXhtml;
      });
      setModified(true);
      
      // Extract placeholders from the updated XHTML
      extractPlaceholdersFromXhtml(editedXhtml);
      
      // Force preview update by triggering a refresh
      // For GrapesJS, the useEffect watching xhtml will handle it
      // For DraggableCanvas, the key change will force re-render
      if (useGrapesJS && grapesjsEditor) {
        // Force GrapesJS to refresh
        setTimeout(() => {
          if (grapesjsEditor && grapesjsEditor.refresh) {
            grapesjsEditor.refresh();
            console.log('[EpubImageEditor] Forced GrapesJS refresh after code edit');
          }
        }, 100);
      }
      
      // Close the code viewer
      setShowCodeViewer(false);
      
      console.log('[EpubImageEditor] XHTML code saved from editor, preview should update');
    } catch (error) {
      console.error('[EpubImageEditor] Error saving edited XHTML:', error);
      alert('Error saving XHTML code. Please check the syntax.');
    }
  }, [editedXhtml, extractPlaceholdersFromXhtml, useGrapesJS, grapesjsEditor]);

  // Handle ESC key to close code viewer and Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showCodeViewer) {
        if (e.key === 'Escape') {
          setShowCodeViewer(false);
        } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          handleSaveEditedXhtml();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCodeViewer, handleSaveEditedXhtml]);

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
        absoluteUrl
      });
      
      // CRITICAL FIX: Use functional update to get the latest xhtml state
      // This ensures we're working with the most recent version, including all previous edits
      setXhtml((currentXhtml) => {
        console.log('[handleDrop] Using latest XHTML state, length:', currentXhtml.length);
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
          setModified(true);
          
          // Re-extract placeholders after modification (async, outside the setState callback)
          setTimeout(() => {
            extractPlaceholdersFromXhtml(previewXhtml);
          
          // Verify image persists in DOM after state update
          // Use multiple timeouts to catch the image at different render stages
          [100, 300, 500, 1000].forEach((delay, idx) => {
            setTimeout(() => {
              if (canvasRef?.current) {
                // In GrapesJS mode, images are in the iframe document
                // In standard mode, images are directly in canvasRef
                let img = null;
                let searchDoc = document;
                
                if (useGrapesJS) {
                  // Look in GrapesJS iframe
                  const grapesContainer = canvasRef.current.querySelector('.grapesjs-canvas-container');
                  if (grapesContainer) {
                    const iframe = grapesContainer.querySelector('iframe');
                    if (iframe) {
                      const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
                      if (frameDoc) {
                        searchDoc = frameDoc;
                        img = frameDoc.querySelector(`img[id="${placeholderId}"]`);
                      }
                    }
                  }
                } else {
                  // Standard mode - search in canvasRef
                  img = canvasRef.current.querySelector(`img[id="${placeholderId}"]`);
                }
                
                if (img) {
                  const rect = img.getBoundingClientRect();
                  // Use the correct window object (iframe window if in GrapesJS mode)
                  const imgWindow = useGrapesJS && searchDoc.defaultView ? searchDoc.defaultView : window;
                  const computedStyle = imgWindow.getComputedStyle(img);
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
                  // In GrapesJS mode, rendering is async so image might not be in DOM yet
                  if (useGrapesJS) {
                    console.log(`[handleDrop] Image not yet in DOM (check ${idx + 1}) - GrapesJS renders asynchronously, this is expected`);
                    // In GrapesJS mode, we rely on the XHTML string verification which already passed
                    // GrapesJS will update its content when it receives the new XHTML prop
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
              }
            }, delay);
            });
          }, 100);
          
          return previewXhtml;
        } else {
          console.error('[handleDrop] ✗ Image injection verification failed');
          setError(`Failed to inject image: ${!imgTagMatch ? 'Image tag not found' : 'Placeholder still exists'}`);
          return currentXhtml; // Return unchanged on failure
        }
      });
    } catch (err) {
      console.error('Error handling drop:', err);
      setError('Failed to insert image: ' + err.message);
    }
  }, [jobId, extractPlaceholdersFromXhtml, canvasRef, useGrapesJS]);

  // CRITICAL: Add drop handler for GrapesJS mode (bypasses react-dnd)
  // Use document-level handler in capture phase to intercept before react-dnd
  useEffect(() => {
    console.log('[EpubImageEditor] Drop handler useEffect running', {
      useGrapesJS,
      hasCanvasRef: !!canvasRef.current,
      hasHandleDrop: !!handleDrop
    });
    
    if (!useGrapesJS) {
      console.log('[EpubImageEditor] GrapesJS disabled, skipping drop handler setup');
      return;
    }
    
    console.log('[EpubImageEditor] ✓ GrapesJS is enabled, setting up document-level drop handler');
    
    // Function to initialize highlighting when drag starts - defined outside attachIframeHandlers so it persists
    const initializeHighlighting = () => {
      try {
        const canvasWrapper = canvasRef.current;
        if (!canvasWrapper) {
          console.log('[EpubImageEditor] initializeHighlighting - no canvas wrapper');
          return;
        }
        const grapesContainer = canvasWrapper.querySelector('.grapesjs-canvas-container');
        if (!grapesContainer) {
          console.log('[EpubImageEditor] initializeHighlighting - no grapes container');
          return;
        }
        const iframe = grapesContainer.querySelector('iframe');
        if (!iframe) {
          console.log('[EpubImageEditor] initializeHighlighting - no iframe');
          return;
        }
        const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!frameDoc) {
          console.log('[EpubImageEditor] initializeHighlighting - cannot access frameDoc');
          return;
        }
        
        // Find all placeholders
        const allPlaceholders = frameDoc.querySelectorAll('.image-placeholder, .image-drop-zone');
        if (allPlaceholders.length === 0) {
          console.log('[EpubImageEditor] initializeHighlighting - No placeholders found');
          return;
        }
        
        // Log removed to reduce console noise
        // console.log('[EpubImageEditor] initializeHighlighting - Found', allPlaceholders.length, 'placeholders');
        
        // Sort placeholders
        const sortedPlaceholders = Array.from(allPlaceholders).sort((a, b) => {
          const rectA = a.getBoundingClientRect();
          const rectB = b.getBoundingClientRect();
          if (Math.abs(rectA.top - rectB.top) > 10) {
            return rectA.top - rectB.top;
          }
          return rectA.left - rectB.left;
        });
        
        // Find next empty placeholder
        const findNextEmptyPlaceholder = () => {
          for (let i = 0; i < sortedPlaceholders.length; i++) {
            const placeholder = sortedPlaceholders[i];
            const hasImage = placeholder.querySelector('img') !== null;
            if (!hasImage) {
              return { placeholder, index: i + 1 };
            }
          }
          return null;
        };
        
        const nextEmpty = findNextEmptyPlaceholder();
        // Log removed to reduce console noise
        // console.log('[EpubImageEditor] initializeHighlighting - Next empty:', nextEmpty ? nextEmpty.placeholder.id : 'none');
        
        // Apply initial highlighting - always use one-by-one mode
        allPlaceholders.forEach((placeholder) => {
          const hasImage = placeholder.querySelector('img') !== null;
          
          const isNextEmpty = nextEmpty && placeholder.id === nextEmpty.placeholder.id;
          if (isNextEmpty && !hasImage) {
            placeholder.classList.add('drag-over', 'drag-over-active');
            placeholder.classList.remove('drag-over-disabled');
            // Log removed to reduce console noise
            // console.log('[EpubImageEditor] initializeHighlighting - Marked as active:', placeholder.id);
          } else if (!hasImage) {
            placeholder.classList.add('drag-over-disabled');
            placeholder.classList.remove('drag-over', 'drag-over-active');
          } else {
            placeholder.classList.remove('drag-over', 'drag-over-active', 'drag-over-disabled');
          }
        });
        
        // Log removed to reduce console noise
        // console.log('[EpubImageEditor] Initial placeholder highlighting applied to', allPlaceholders.length, 'placeholders');
      } catch (err) {
        console.warn('[EpubImageEditor] Error initializing highlighting:', err);
      }
    };
    
    // Listen for drag start to initialize highlighting - add at window level (outside attachIframeHandlers)
    const handleImageDragStart = () => {
      console.log('[EpubImageEditor] image-drag-start event received, currentDragImage:', !!window.currentDragImage);
      if (window.currentDragImage) {
        // Small delay to ensure iframe is ready
        setTimeout(() => {
          initializeHighlighting();
        }, 100);
      } else {
        // If currentDragImage not set yet, try again after a short delay
        setTimeout(() => {
          if (window.currentDragImage) {
            initializeHighlighting();
          }
        }, 200);
      }
    };
    
    window.addEventListener('image-drag-start', handleImageDragStart);
    console.log('[EpubImageEditor] ✓ Added image-drag-start listener at window level');
    
    const handleDocumentDragOver = (e) => {
      // Only handle if we're dragging an image
      if (!window.currentDragImage) {
        return; // Let other handlers process it
      }
      
      // CRITICAL: Always prevent default to allow drops when dragging images
      // Without this, the browser's default behavior prevents the drop event
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Stop react-dnd from handling it
        e.dataTransfer.dropEffect = 'copy';
      
      // Log removed to reduce console noise - dragover fires many times per second
      // console.log('[EpubImageEditor] Document dragover (GrapesJS mode)', {
      //   clientX: e.clientX,
      //   clientY: e.clientY,
      //   hasCurrentDragImage: !!window.currentDragImage
      // });
    };
    
    const handleDocumentDrop = (e) => {
      // Log EVERY drop event to see if handler is being called
      console.log('[EpubImageEditor] ⚡⚡⚡ Document drop event FIRED ⚡⚡⚡', {
        hasCurrentDragImage: !!window.currentDragImage,
        currentDragImage: window.currentDragImage?.fileName,
        target: e.target?.tagName,
        targetClass: e.target?.className,
        clientX: e.clientX,
        clientY: e.clientY,
        dataTransferTypes: Array.from(e.dataTransfer?.types || [])
      });
      
      // Always prevent default to avoid browser's default drop behavior
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Only handle if we're dragging an image
      if (!window.currentDragImage) {
        console.log('[EpubImageEditor] No currentDragImage, ignoring drop');
        return;
      }
      
      // Check if we're over the canvas area
      const canvasWrapper = canvasRef.current;
      if (!canvasWrapper) {
        console.warn('[EpubImageEditor] Canvas wrapper not found');
        return;
      }
      
      const rect = canvasWrapper.getBoundingClientRect();
      const isOverCanvas = e.clientX >= rect.left && 
                          e.clientX <= rect.right && 
                          e.clientY >= rect.top && 
                          e.clientY <= rect.bottom;
      
      if (!isOverCanvas) {
        console.log('[EpubImageEditor] Drop outside canvas area, ignoring');
        return;
      }
      
      // preventDefault already called above, but keep for clarity
      console.log('[EpubImageEditor] ✓ Document drop detected on canvas (GrapesJS mode)');
      
      const image = window.currentDragImage;
      if (!image) {
        console.warn('[EpubImageEditor] No image in window.currentDragImage after check');
        return;
      }
      
      // Find the GrapesJS iframe
      const grapesContainer = canvasWrapper.querySelector('.grapesjs-canvas-container');
      if (!grapesContainer) {
        console.warn('[EpubImageEditor] GrapesJS container not found');
        return;
      }
      
      // Find the iframe inside GrapesJS
      const iframe = grapesContainer.querySelector('iframe');
      if (!iframe) {
        console.warn('[EpubImageEditor] GrapesJS iframe not found');
        return;
      }
      
      const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!frameDoc) {
        console.warn('[EpubImageEditor] Cannot access iframe document');
        return;
      }
      
      // Get drop coordinates relative to iframe
      const iframeRect = iframe.getBoundingClientRect();
      const x = e.clientX - iframeRect.left;
      const y = e.clientY - iframeRect.top;
      
      console.log('[EpubImageEditor] Drop coordinates in iframe:', x, y);
      
      // Find element at drop point
      const elementAtPoint = frameDoc.elementFromPoint(x, y);
      if (!elementAtPoint) {
        console.warn('[EpubImageEditor] No element at drop point in iframe');
        const allPlaceholders = frameDoc.querySelectorAll('.image-placeholder');
        console.log('[EpubImageEditor] Available placeholders in iframe:', allPlaceholders.length, Array.from(allPlaceholders).map(p => p.id));
        return;
      }
      
      console.log('[EpubImageEditor] Element at drop point:', elementAtPoint.tagName, elementAtPoint.className, elementAtPoint.id);
      
      const placeholder = elementAtPoint.closest('.image-placeholder');
      if (!placeholder) {
        console.warn('[EpubImageEditor] No placeholder found at drop point');
        return;
      }
      
      const placeholderId = placeholder.id || placeholder.getAttribute('id');
      if (!placeholderId) {
        console.warn('[EpubImageEditor] Placeholder has no ID');
        return;
      }
      
      console.log('[EpubImageEditor] ✓ Found placeholder at drop point:', placeholderId);
      
      // Call the handleDrop callback
      if (handleDrop) {
        console.log('[EpubImageEditor] ✓ Calling handleDrop with:', placeholderId, image.fileName);
        handleDrop(placeholderId, image);
      } else {
        console.warn('[EpubImageEditor] handleDrop callback not available');
      }
    };
    
    // Also add a catch-all drop handler to debug if events are reaching us
    const debugDropHandler = (e) => {
      console.log('[EpubImageEditor] 🔍 DEBUG: Any drop event detected', {
        target: e.target?.tagName,
        currentTarget: e.currentTarget?.tagName,
        hasCurrentDragImage: !!window.currentDragImage,
        dataTransferTypes: Array.from(e.dataTransfer?.types || [])
      });
    };
    
    // Use capture phase and add to window (highest priority) to intercept before react-dnd
    window.addEventListener('dragover', handleDocumentDragOver, true);
    window.addEventListener('drop', handleDocumentDrop, true);
    window.addEventListener('drop', debugDropHandler, true); // Debug handler
    document.addEventListener('dragover', handleDocumentDragOver, true);
    document.addEventListener('drop', handleDocumentDrop, true);
    document.addEventListener('drop', debugDropHandler, true); // Debug handler
    
    // CRITICAL: Also attach handlers to iframe document (drops into iframe happen there)
    const attachIframeHandlers = () => {
      const canvasWrapper = canvasRef.current;
      if (!canvasWrapper) return;
      
      const grapesContainer = canvasWrapper.querySelector('.grapesjs-canvas-container');
      if (!grapesContainer) return;
      
      const iframe = grapesContainer.querySelector('iframe');
      if (!iframe) return;
      
      try {
        const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
        const frameWin = iframe.contentWindow;
        if (!frameDoc || !frameWin) {
          console.log('[EpubImageEditor] Iframe not accessible yet, will retry');
          return;
        }
        
        console.log('[EpubImageEditor] ✓ Attaching drop handlers to iframe document');
        
        // Inject placeholder highlighting CSS into iframe if not already present
        const placeholderHighlightCSS = `
          .image-placeholder.drag-over,
          .image-drop-zone.drag-over {
            border: 2px solid #2196F3 !important;
            background-color: rgba(33, 150, 243, 0.1) !important;
            outline: 2px solid #2196F3 !important;
            outline-offset: 2px !important;
          }
          .image-placeholder.drag-over-active,
          .image-drop-zone.drag-over-active {
            border: 3px solid #4CAF50 !important;
            background-color: rgba(76, 175, 80, 0.15) !important;
            outline: 3px solid #4CAF50 !important;
            outline-offset: 3px !important;
            box-shadow: 0 0 0 6px rgba(76, 175, 80, 0.3), 0 4px 12px rgba(76, 175, 80, 0.5) !important;
            transform: scale(1.02) !important;
            z-index: 1000 !important;
            transition: all 0.2s ease !important;
          }
          .image-placeholder.drag-over-disabled,
          .image-drop-zone.drag-over-disabled {
            border: 1px dashed #ccc !important;
            background-color: rgba(0, 0, 0, 0.03) !important;
            opacity: 0.5 !important;
            pointer-events: none !important;
          }
        `;
        
        // Check if placeholder highlight styles are already injected
        let placeholderStyleEl = frameDoc.getElementById('placeholder-highlight-styles');
        if (!placeholderStyleEl) {
          placeholderStyleEl = frameDoc.createElement('style');
          placeholderStyleEl.id = 'placeholder-highlight-styles';
          placeholderStyleEl.textContent = placeholderHighlightCSS;
          frameDoc.head.appendChild(placeholderStyleEl);
          console.log('[EpubImageEditor] ✓ Injected placeholder highlighting CSS into iframe');
        }
        
        // Iframe dragover handler - must prevent default to allow drops
        const iframeDragOver = (e) => {
          // Check parent window for drag image
          if (!window.currentDragImage) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.dataTransfer.dropEffect = 'copy';
          
          // Highlight placeholders in iframe
          const x = e.clientX;
          const y = e.clientY;
          const elementAtPoint = frameDoc.elementFromPoint(x, y);
          
          // Find all placeholders in iframe
          const allPlaceholders = frameDoc.querySelectorAll('.image-placeholder, .image-drop-zone');
          
          // Log removed - dragover fires too frequently
          // console.log('[EpubImageEditor] Iframe dragover - found placeholders:', allPlaceholders.length);
          
          // Sort placeholders by position (top to bottom, left to right)
          const sortedPlaceholders = Array.from(allPlaceholders).sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            if (Math.abs(rectA.top - rectB.top) > 10) {
              return rectA.top - rectB.top;
            }
            return rectA.left - rectB.left;
          });
          
          // Find the next empty placeholder
          const findNextEmptyPlaceholder = () => {
            for (let i = 0; i < sortedPlaceholders.length; i++) {
              const placeholder = sortedPlaceholders[i];
              const hasImage = placeholder.querySelector('img') !== null;
              if (!hasImage) {
                return { placeholder, index: i + 1 };
              }
            }
            return null;
          };
          
          const nextEmpty = findNextEmptyPlaceholder();
          // Log removed - dragover fires too frequently
          // console.log('[EpubImageEditor] Next empty placeholder:', nextEmpty ? nextEmpty.placeholder.id : 'none');
          
          // Find which placeholder is being hovered
          let hoveredPlaceholder = null;
          if (elementAtPoint) {
            hoveredPlaceholder = elementAtPoint.closest('.image-placeholder, .image-drop-zone');
            // Log removed - dragover fires too frequently
            // if (hoveredPlaceholder) {
            //   console.log('[EpubImageEditor] Hovered placeholder:', hoveredPlaceholder.id);
            // }
          }
          
          // Update highlighting based on mode
          allPlaceholders.forEach((placeholder) => {
            const hasImage = placeholder.querySelector('img') !== null;
            
            if (oneByOneMode) {
              // In one-by-one mode: highlight only the next empty placeholder (or hovered if it's the next)
              const isNextEmpty = nextEmpty && placeholder.id === nextEmpty.placeholder.id;
              const isHovered = hoveredPlaceholder && placeholder.id === hoveredPlaceholder.id;
              const isTarget = isNextEmpty && (isHovered || !hoveredPlaceholder);
              
              if (isTarget && !hasImage) {
                placeholder.classList.add('drag-over', 'drag-over-active');
                placeholder.classList.remove('drag-over-disabled');
                // Log removed - dragover fires too frequently
                // console.log('[EpubImageEditor] Highlighting placeholder:', placeholder.id, 'as active');
              } else if (!hasImage) {
                placeholder.classList.add('drag-over-disabled');
                placeholder.classList.remove('drag-over', 'drag-over-active');
              } else {
                placeholder.classList.remove('drag-over', 'drag-over-active', 'drag-over-disabled');
              }
            } else {
              // In normal mode: highlight all empty placeholders
              if (!hasImage) {
                placeholder.classList.add('drag-over');
                placeholder.classList.remove('drag-over-disabled', 'drag-over-active');
              } else {
                placeholder.classList.remove('drag-over', 'drag-over-active', 'drag-over-disabled');
              }
            }
          });
        };
        
        // Cleanup highlighting when drag ends
        const cleanupHighlighting = () => {
          try {
            const canvasWrapper = canvasRef.current;
            if (!canvasWrapper) return;
            const grapesContainer = canvasWrapper.querySelector('.grapesjs-canvas-container');
            if (!grapesContainer) return;
            const iframe = grapesContainer.querySelector('iframe');
            if (!iframe) return;
            const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!frameDoc) return;
            
            const allPlaceholders = frameDoc.querySelectorAll('.image-placeholder, .image-drop-zone');
            allPlaceholders.forEach((placeholder) => {
              placeholder.classList.remove('drag-over', 'drag-over-active', 'drag-over-disabled');
            });
          } catch (err) {
            // Ignore errors during cleanup
          }
        };
        
        // Listen for drag end events to cleanup highlighting
        const handleIframeDragEnd = () => {
          cleanupHighlighting();
        };
        
        // Iframe drop handler - coordinates are already relative to iframe
        const iframeDrop = (e) => {
          console.log('[EpubImageEditor] ⚡⚡⚡ IFRAME drop event FIRED ⚡⚡⚡', {
            hasCurrentDragImage: !!window.currentDragImage,
            currentDragImage: window.currentDragImage?.fileName,
            target: e.target?.tagName,
            clientX: e.clientX,
            clientY: e.clientY
          });
          
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          if (!window.currentDragImage) {
            console.log('[EpubImageEditor] No currentDragImage in iframe drop');
            return;
          }
          
          const image = window.currentDragImage;
          
          // Use coordinates directly from iframe event (they're already relative to iframe)
          const x = e.clientX;
          const y = e.clientY;
          
          console.log('[EpubImageEditor] Iframe drop coordinates:', x, y);
          
          // Find element at drop point in iframe document
          const elementAtPoint = frameDoc.elementFromPoint(x, y);
          if (!elementAtPoint) {
            console.warn('[EpubImageEditor] No element at drop point in iframe');
            const allPlaceholders = frameDoc.querySelectorAll('.image-placeholder');
            console.log('[EpubImageEditor] Available placeholders in iframe:', allPlaceholders.length, Array.from(allPlaceholders).map(p => p.id));
            return;
          }
          
          console.log('[EpubImageEditor] Element at drop point in iframe:', elementAtPoint.tagName, elementAtPoint.className, elementAtPoint.id);
          
          // Check if the element itself is a placeholder (has either class)
          let placeholder = null;
          if (elementAtPoint.classList?.contains('image-placeholder') || elementAtPoint.classList?.contains('image-drop-zone')) {
            placeholder = elementAtPoint;
          } else {
            // Try to find parent placeholder
            placeholder = elementAtPoint.closest('.image-placeholder, .image-drop-zone');
          }
          
          if (!placeholder) {
            console.warn('[EpubImageEditor] No placeholder found at drop point in iframe');
            console.warn('[EpubImageEditor] Element classes:', elementAtPoint.className);
            console.warn('[EpubImageEditor] Element ID:', elementAtPoint.id);
            return;
          }
          
          const placeholderId = placeholder.id || placeholder.getAttribute('id');
          if (!placeholderId) {
            console.warn('[EpubImageEditor] Placeholder has no ID in iframe');
            return;
          }
          
          console.log('[EpubImageEditor] ✓ Found placeholder at drop point in iframe:', placeholderId);
          
          // Call the handleDrop callback
          if (handleDrop) {
          console.log('[EpubImageEditor] ✓ Calling handleDrop from iframe with:', placeholderId, image.fileName);
          handleDrop(placeholderId, image);
        } else {
          console.warn('[EpubImageEditor] handleDrop callback not available');
        }
        
        // Cleanup highlighting after drop
        cleanupHighlighting();
      };
      
      
      frameDoc.addEventListener('dragover', iframeDragOver, true);
      frameDoc.addEventListener('drop', iframeDrop, true);
      
      // Also listen for dragend on window to cleanup highlighting
      const handleWindowDragEnd = () => {
        cleanupHighlighting();
      };
      window.addEventListener('dragend', handleWindowDragEnd, true);
        
        // Store handlers for cleanup
        iframe._dragHandlers = { 
          dragover: iframeDragOver, 
          drop: iframeDrop,
          dragend: handleWindowDragEnd,
          cleanup: cleanupHighlighting
        };
      } catch (err) {
        console.warn('[EpubImageEditor] Error attaching iframe handlers:', err);
      }
    };
    
    // Try to attach iframe handlers immediately, and also set up a retry mechanism
    attachIframeHandlers();
    const iframeRetryInterval = setInterval(() => {
      const canvasWrapper = canvasRef.current;
      if (!canvasWrapper) return;
      const grapesContainer = canvasWrapper.querySelector('.grapesjs-canvas-container');
      if (!grapesContainer) return;
      const iframe = grapesContainer.querySelector('iframe');
      if (!iframe) return;
      const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (frameDoc && !iframe._dragHandlers) {
        attachIframeHandlers();
        clearInterval(iframeRetryInterval); // Stop retrying once attached
      }
    }, 500);
    
    console.log('[EpubImageEditor] ✓ Added window, document, and iframe-level GrapesJS drop handlers');
    
    return () => {
      window.removeEventListener('dragover', handleDocumentDragOver, true);
      window.removeEventListener('drop', handleDocumentDrop, true);
      window.removeEventListener('drop', debugDropHandler, true);
      document.removeEventListener('dragover', handleDocumentDragOver, true);
      document.removeEventListener('drop', handleDocumentDrop, true);
      document.removeEventListener('drop', debugDropHandler, true);
      
      // Cleanup iframe handlers
      const canvasWrapper = canvasRef.current;
      if (canvasWrapper) {
        const grapesContainer = canvasWrapper.querySelector('.grapesjs-canvas-container');
        if (grapesContainer) {
          const iframe = grapesContainer.querySelector('iframe');
          if (iframe && iframe._dragHandlers) {
            try {
              const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (frameDoc) {
                frameDoc.removeEventListener('dragover', iframe._dragHandlers.dragover, true);
                frameDoc.removeEventListener('drop', iframe._dragHandlers.drop, true);
                window.removeEventListener('dragend', iframe._dragHandlers.dragend, true);
                // Cleanup highlighting
                if (iframe._dragHandlers.cleanup) {
                  iframe._dragHandlers.cleanup();
                }
              }
            } catch (err) {
              console.warn('[EpubImageEditor] Error removing iframe handlers:', err);
            }
            delete iframe._dragHandlers;
          }
        }
      }
      
      clearInterval(iframeRetryInterval);
      // Remove image-drag-start listener
      window.removeEventListener('image-drag-start', handleImageDragStart);
      console.log('[EpubImageEditor] Removed window, document, and iframe-level GrapesJS drop handlers');
    };
  }, [useGrapesJS, canvasRef, handleDrop]);

  // Allow clearing a dropped image (restore placeholder div so it can be replaced)
  const handleClearImage = useCallback((placeholderId) => {
    console.log('[EpubImageEditor] handleClearImage called with:', placeholderId);
    if (!placeholderId) {
      console.warn('[EpubImageEditor] handleClearImage called without placeholderId');
      return;
    }
    
    // Confirm before clearing
    if (!window.confirm(`Are you sure you want to clear the image from placeholder "${placeholderId}"? You can drop a new image to replace it.`)) {
      console.log('[EpubImageEditor] User cancelled clearing image');
      return;
    }
    
    console.log('[EpubImageEditor] User confirmed clearing image for:', placeholderId);
    
    // CRITICAL FIX: Use functional update to get the latest xhtml state
    // This ensures we're working with the most recent version, including all previous edits
    setXhtml((currentXhtml) => {
      if (!currentXhtml) {
        console.warn('[EpubImageEditor] No XHTML to clear from');
        return currentXhtml;
      }
      
      try {
        console.log(`[EpubImageEditor] Clearing image for placeholder: ${placeholderId}`);
        const parser = new DOMParser();
        let doc = parser.parseFromString(currentXhtml, 'text/html');
      
        // Check for parsing errors
        let parserError = doc.querySelector('parsererror');
        if (parserError) {
          console.warn('[EpubImageEditor] HTML parsing failed, trying XML');
          doc = parser.parseFromString(currentXhtml, 'application/xml');
          parserError = doc.querySelector('parsererror');
          if (parserError) {
            console.error('[EpubImageEditor] Both HTML and XML parsing failed');
            alert('Failed to parse XHTML. Please try again.');
            return currentXhtml; // Return unchanged on error
          }
        }
        
        // Try multiple methods to find the target element
        let target = doc.getElementById(placeholderId);
        if (!target) {
          target = doc.querySelector(`#${placeholderId}`);
        }
        if (!target) {
          target = doc.querySelector(`[id="${placeholderId}"]`);
        }
        if (!target && doc.body) {
          target = doc.body.querySelector(`#${placeholderId}`) || doc.body.querySelector(`[id="${placeholderId}"]`);
        }
        
        if (!target) {
          console.error(`[EpubImageEditor] Placeholder ${placeholderId} not found in XHTML`);
          alert(`Placeholder "${placeholderId}" not found. The image may have already been cleared.`);
          return currentXhtml; // Return unchanged
        }
        
        const targetTag = target.tagName ? target.tagName.toLowerCase() : '';
        
        if (targetTag !== 'img') {
          console.log(`[EpubImageEditor] Target ${placeholderId} is not an img tag, it's a ${targetTag}`);
          // Check if it's already a placeholder div
          if (targetTag === 'div' && (target.classList.contains('image-placeholder') || target.classList.contains('image-drop-zone'))) {
            console.log(`[EpubImageEditor] Placeholder ${placeholderId} is already a placeholder div, nothing to clear`);
            alert('This placeholder already has no image. You can drop a new image on it.');
            return currentXhtml; // Return unchanged
          }
          alert(`Cannot clear: Element "${placeholderId}" is not an image. It's a ${targetTag}.`);
          return currentXhtml; // Return unchanged
        }
        
        // Create a new placeholder div with both classes for proper detection
        const placeholderDiv = doc.createElement('div');
        placeholderDiv.setAttribute('id', placeholderId);
        placeholderDiv.setAttribute('class', 'image-placeholder image-drop-zone');
        placeholderDiv.setAttribute('title', 'Drop image here');
        placeholderDiv.textContent = 'Drop image here';
        
        // Copy any style attributes from the img to preserve dimensions
        if (target.hasAttribute('style')) {
          const imgStyle = target.getAttribute('style');
          if (imgStyle) {
            placeholderDiv.setAttribute('style', imgStyle);
          }
        }
        
        // Copy width/height attributes if present
        if (target.hasAttribute('width')) {
          placeholderDiv.style.width = target.getAttribute('width') + (target.getAttribute('width').includes('%') ? '' : 'px');
        }
        if (target.hasAttribute('height')) {
          placeholderDiv.style.height = target.getAttribute('height') + (target.getAttribute('height').includes('%') ? '' : 'px');
        }
        
        // Set default styles if not present
        if (!placeholderDiv.style.minHeight) {
          placeholderDiv.style.minHeight = '80px';
        }
        if (!placeholderDiv.style.minWidth) {
          placeholderDiv.style.minWidth = '80px';
        }
        
        // Ensure placeholder is visible
        placeholderDiv.style.display = 'flex';
        placeholderDiv.style.alignItems = 'center';
        placeholderDiv.style.justifyContent = 'center';
        
        // Replace the img with the placeholder div
        // If the img is inside an image-with-options wrapper, replace the wrapper entirely
        // Otherwise, just replace the img
        if (target.parentNode) {
          const parent = target.parentNode;
          // Check if parent is an image-with-options wrapper
          if (parent.classList && parent.classList.contains('image-with-options')) {
            // Replace the entire wrapper with the placeholder div
            parent.parentNode.replaceChild(placeholderDiv, parent);
            console.log(`[EpubImageEditor] Replaced wrapper containing image ${placeholderId} with placeholder div`);
          } else {
            // Just replace the img with the placeholder div
            parent.replaceChild(placeholderDiv, target);
            console.log(`[EpubImageEditor] Replaced image ${placeholderId} with placeholder div`);
          }
        } else {
          console.error(`[EpubImageEditor] Target ${placeholderId} has no parent node`);
          alert('Failed to clear image: Element has no parent.');
          return currentXhtml; // Return unchanged
        }

        const serializer = new XMLSerializer();
        let updated = serializer.serializeToString(doc.documentElement);
        
        // Handle HTML5 parser output (might wrap in <html><body>)
        if (doc.documentElement.tagName === 'HTML' && doc.body) {
          const doctypeMatch = currentXhtml.match(/<!DOCTYPE[^>]*>/i);
          const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';
          const xmlnsMatch = currentXhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
          const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';
          
          const headContent = doc.head ? doc.head.innerHTML : '';
          const bodyContent = doc.body ? doc.body.innerHTML : '';
          
          updated = `${doctype}\n<html xmlns="${xmlns}">\n`;
          if (headContent) {
            updated += `<head>\n${headContent}\n</head>\n`;
          }
          updated += `<body>\n${bodyContent}\n</body>\n</html>`;
        }
        
        // Ensure self-closing tags for meta and img after DOM manipulation
        updated = updated.replace(/<meta([^>]*?)>/gi, (match, attrs) => {
          return attrs.includes('/') ? match : `<meta${attrs}/>`;
        });
        updated = updated.replace(/<img([^>]*?)>/gi, (match, attrs) => {
          return attrs.includes('/') ? match : `<img${attrs}/>`;
        });
        
        console.log(`[EpubImageEditor] ✓ Image cleared for ${placeholderId}, placeholder restored`);
        console.log(`[EpubImageEditor] Updated XHTML length: ${updated.length}`);
        console.log(`[EpubImageEditor] Placeholder div exists in updated XHTML:`, updated.includes(`id="${placeholderId}"`) && updated.includes('image-drop-zone'));
        
        setModified(true);
        
        // Re-extract placeholders to update the UI immediately (async, outside the setState callback)
        setTimeout(() => {
          extractPlaceholdersFromXhtml(updated);
          
          // Also verify in DOM after a short delay
          if (canvasRef?.current) {
            const draggableCanvas = canvasRef.current.querySelector('[data-draggable-canvas="true"]') || 
                                     canvasRef.current.querySelector('.draggable-canvas-container');
            if (draggableCanvas) {
              const restoredPlaceholder = draggableCanvas.querySelector(`#${placeholderId}`);
              if (restoredPlaceholder) {
                console.log(`[EpubImageEditor] ✓ Placeholder ${placeholderId} verified in DOM:`, {
                  tag: restoredPlaceholder.tagName,
                  classes: restoredPlaceholder.className,
                  hasText: restoredPlaceholder.textContent.trim().length > 0
                });
              } else {
                console.warn(`[EpubImageEditor] ⚠ Placeholder ${placeholderId} not found in DOM after clearing`);
              }
            }
          }
        }, 200);
        
        return updated;
      } catch (err) {
        console.error('[EpubImageEditor] Failed to clear image for placeholder', placeholderId, err);
        alert('Failed to clear image: ' + (err.message || 'Unknown error'));
        return currentXhtml; // Return unchanged on error
      }
    });
  }, [extractPlaceholdersFromXhtml, canvasRef]);

  // Handle image editing operations (zoom, crop, fit)
  const handleImageEdit = useCallback((placeholderId, operation, value = null) => {
    console.log('[EpubImageEditor] handleImageEdit called:', { placeholderId, operation, value });
    if (!placeholderId) {
      console.warn('[EpubImageEditor] handleImageEdit called without placeholderId');
      return;
    }

    setXhtml((currentXhtml) => {
      if (!currentXhtml) {
        console.warn('[EpubImageEditor] No XHTML to edit');
        return currentXhtml;
      }

      try {
        const parser = new DOMParser();
        let doc = parser.parseFromString(currentXhtml, 'text/html');

        // Check for parsing errors
        let parserError = doc.querySelector('parsererror');
        if (parserError) {
          console.warn('[EpubImageEditor] HTML parsing failed, trying XML');
          doc = parser.parseFromString(currentXhtml, 'application/xml');
          parserError = doc.querySelector('parsererror');
          if (parserError) {
            console.error('[EpubImageEditor] Both HTML and XML parsing failed');
            return currentXhtml;
          }
        }

        // Find the target image
        let target = doc.getElementById(placeholderId);
        if (!target) {
          target = doc.querySelector(`#${placeholderId}`);
        }
        if (!target && doc.body) {
          target = doc.body.querySelector(`#${placeholderId}`);
        }

        if (!target || target.tagName?.toLowerCase() !== 'img') {
          console.error(`[EpubImageEditor] Image ${placeholderId} not found`);
          return currentXhtml;
        }

        // Get current styles
        const currentStyle = target.getAttribute('style') || '';
        const currentWidth = target.getAttribute('width') || '';
        const currentHeight = target.getAttribute('height') || '';
        
        // Parse current transform if exists
        let currentScale = 1;
        const transformMatch = currentStyle.match(/transform\s*:\s*scale\(([^)]+)\)/i);
        if (transformMatch) {
          currentScale = parseFloat(transformMatch[1]) || 1;
        }

        // Apply operation
        let newStyle = currentStyle;
        let newWidth = currentWidth;
        let newHeight = currentHeight;

        switch (operation) {
          case 'zoom-in':
            const zoomInScale = Math.min(currentScale * 1.2, 5); // Max 5x zoom
            newStyle = currentStyle.replace(/transform\s*:\s*scale\([^)]+\)/i, '');
            newStyle = (newStyle.trim() ? newStyle + '; ' : '') + `transform: scale(${zoomInScale})`;
            target.setAttribute('style', newStyle);
            break;

          case 'zoom-out':
            const zoomOutScale = Math.max(currentScale / 1.2, 0.1); // Min 0.1x zoom
            newStyle = currentStyle.replace(/transform\s*:\s*scale\([^)]+\)/i, '');
            newStyle = (newStyle.trim() ? newStyle + '; ' : '') + `transform: scale(${zoomOutScale})`;
            target.setAttribute('style', newStyle);
            break;

          case 'fit-container':
            // Remove transform and set width/height to fit container
            newStyle = currentStyle.replace(/transform\s*:\s*scale\([^)]+\)/gi, '').trim();
            if (newStyle.endsWith(';')) {
              newStyle = newStyle.slice(0, -1);
            }
            newStyle = (newStyle ? newStyle + '; ' : '') + 'width: 100%; height: auto; max-width: 100%;';
            target.setAttribute('style', newStyle);
            target.removeAttribute('width');
            target.removeAttribute('height');
            break;

          case 'crop':
            // For crop, we'll use object-fit: cover and object-position
            // This is a simplified crop - full crop would need a more complex UI
            newStyle = currentStyle.replace(/object-fit\s*:[^;]+/gi, '');
            newStyle = currentStyle.replace(/object-position\s*:[^;]+/gi, '');
            newStyle = (newStyle.trim() ? newStyle + '; ' : '') + 'object-fit: cover; object-position: center;';
            target.setAttribute('style', newStyle);
            break;

          default:
            console.warn(`[EpubImageEditor] Unknown operation: ${operation}`);
            return currentXhtml;
        }

        // Serialize back to XHTML
        const serializer = new XMLSerializer();
        let updated = serializer.serializeToString(doc.documentElement);

        // Handle HTML5 parser output
        if (doc.documentElement.tagName === 'HTML' && doc.body) {
          const doctypeMatch = currentXhtml.match(/<!DOCTYPE[^>]*>/i);
          const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';
          const xmlnsMatch = currentXhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
          const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';

          const headContent = doc.head ? doc.head.innerHTML : '';
          const bodyContent = doc.body ? doc.body.innerHTML : '';

          updated = `${doctype}\n<html xmlns="${xmlns}">\n`;
          if (headContent) {
            updated += `<head>\n${headContent}\n</head>\n`;
          }
          updated += `<body>\n${bodyContent}\n</body>\n</html>`;
        }

        // Ensure self-closing tags
        updated = updated.replace(/<meta([^>]*?)>/gi, (match, attrs) => {
          return attrs.includes('/') ? match : `<meta${attrs}/>`;
        });
        updated = updated.replace(/<img([^>]*?)>/gi, (match, attrs) => {
          return attrs.includes('/') ? match : `<img${attrs}/>`;
        });

        console.log(`[EpubImageEditor] ✓ Image ${operation} applied to ${placeholderId}`);
        setModified(true);
        return updated;
      } catch (err) {
        console.error('[EpubImageEditor] Failed to edit image:', err);
        return currentXhtml;
      }
    });
  }, []);

  // Open image editor for a specific image
  const handleOpenImageEditor = useCallback((placeholderId) => {
    console.log('[EpubImageEditor] Opening image editor for:', placeholderId);
    
    // Find the image in XHTML
    const parser = new DOMParser();
    let doc = parser.parseFromString(xhtml, 'text/html');
    let parserError = doc.querySelector('parsererror');
    if (parserError) {
      doc = parser.parseFromString(xhtml, 'application/xml');
    }
    
    const imgElement = doc.getElementById(placeholderId) || doc.querySelector(`#${placeholderId}`);
    if (!imgElement || imgElement.tagName?.toLowerCase() !== 'img') {
      alert('Image not found. Please place an image first.');
      return;
    }
    
    const imgSrc = imgElement.getAttribute('src');
    if (!imgSrc) {
      alert('Image source not found.');
      return;
    }
    
    console.log('[EpubImageEditor] Original image src from XHTML:', imgSrc);
    
    // Get absolute URL if it's relative
    let imageUrl = imgSrc;
    if (!imgSrc.startsWith('http://') && !imgSrc.startsWith('https://')) {
      // Handle different URL formats
      if (imgSrc.startsWith('images/')) {
        const fileName = imgSrc.replace('images/', '');
        imageUrl = `${api.defaults.baseURL}/conversions/${jobId}/images/${fileName}`;
      } else if (imgSrc.startsWith('../images/')) {
        const fileName = imgSrc.replace('../images/', '');
        imageUrl = `${api.defaults.baseURL}/conversions/${jobId}/images/${fileName}`;
      } else if (imgSrc.startsWith('/api/')) {
        // Already has /api/ prefix, just prepend base URL if needed
        if (!imgSrc.startsWith(api.defaults.baseURL)) {
          imageUrl = `${api.defaults.baseURL}${imgSrc.replace('/api', '')}`;
        } else {
          imageUrl = imgSrc;
        }
      } else {
        // Assume it's just a filename
        imageUrl = `${api.defaults.baseURL}/conversions/${jobId}/images/${imgSrc}`;
      }
    }
    
    console.log('[EpubImageEditor] Constructed image URL:', imageUrl);
    
    // Get image dimensions
    const width = imgElement.getAttribute('width') || imgElement.style.width;
    const height = imgElement.getAttribute('height') || imgElement.style.height;
    
    // Extract existing text overlays from data attributes if any
    const textsData = [];
    const textOverlays = imgElement.getAttribute('data-text-overlays');
    if (textOverlays) {
      try {
        textsData.push(...JSON.parse(textOverlays));
      } catch (e) {
        console.warn('Failed to parse text overlays:', e);
      }
    }
    
    setEditingImage({
      imageId: placeholderId,
      imageUrl: imageUrl,
      imageElement: imgElement,
      initialWidth: width ? parseInt(width) : null,
      initialHeight: height ? parseInt(height) : null,
      initialTexts: textsData,
    });
    setImageEditorVisible(true);
  }, [xhtml, jobId]);

  // Save edited image from FabricImageEditor
  const handleSaveEditedImage = useCallback(async (editorData) => {
    try {
      console.log('[EpubImageEditor] Saving edited image:', editorData);
      
      // Convert dataURL to blob
      const dataURL = editorData.canvasDataURL;
      const response = await fetch(dataURL);
      const blob = await response.blob();
      
      // Get the original image filename
      const imageObj = images.find(img => img.id === editorData.imageId || 
        xhtml.includes(`images/${img.fileName}`) && 
        xhtml.match(new RegExp(`id=["']${editorData.imageId}["']`)));
      
      let fileName = imageObj?.fileName || `edited_${editorData.imageId}.png`;
      if (!fileName.endsWith('.png') && !fileName.endsWith('.jpg') && !fileName.endsWith('.jpeg')) {
        fileName = fileName.replace(/\.[^.]+$/, '.png');
      }
      
      // Upload edited image to backend
      // Try to upload, but if endpoint doesn't exist, use data URL approach
      let uploadedFileName = fileName;
      
      try {
        const formData = new FormData();
        formData.append('image', blob, fileName);
        
        // Try uploading to backend
        const uploadResponse = await api.post(`/conversions/${jobId}/images/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        
        uploadedFileName = uploadResponse.data?.fileName || fileName;
      } catch (uploadError) {
        console.warn('[EpubImageEditor] Image upload endpoint not available, using data URL:', uploadError);
        // If upload fails, we'll use the data URL directly in XHTML
        // This is a fallback - the image will be embedded as base64
        const dataUrl = editorData.canvasDataURL;
        
        // Update XHTML with data URL directly
        setXhtml((currentXhtml) => {
          const parser = new DOMParser();
          let doc = parser.parseFromString(currentXhtml, 'text/html');
          let parserError = doc.querySelector('parsererror');
          if (parserError) {
            doc = parser.parseFromString(currentXhtml, 'application/xml');
          }
          
          const imgElement = doc.getElementById(editorData.imageId) || doc.querySelector(`#${editorData.imageId}`);
          if (imgElement) {
            imgElement.setAttribute('src', dataUrl);
            
            // Store text overlay data
            if (editorData.texts && editorData.texts.length > 0) {
              imgElement.setAttribute('data-text-overlays', JSON.stringify(editorData.texts));
            }
            
            // Serialize back to XHTML
            const serializer = new XMLSerializer();
            let updated = serializer.serializeToString(doc.documentElement);
            
            // Handle HTML5 parser output
            if (doc.documentElement.tagName === 'HTML' && doc.body) {
              const doctypeMatch = currentXhtml.match(/<!DOCTYPE[^>]*>/i);
              const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';
              const xmlnsMatch = currentXhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
              const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';
              
              const headContent = doc.head ? doc.head.innerHTML : '';
              const bodyContent = doc.body ? doc.body.innerHTML : '';
              
              updated = `${doctype}\n<html xmlns="${xmlns}">\n`;
              if (headContent) {
                updated += `<head>\n${headContent}\n</head>\n`;
              }
              updated += `<body>\n${bodyContent}\n</body>\n</html>`;
            }
            
            // Ensure self-closing tags
            updated = updated.replace(/<meta([^>]*?)>/gi, (match, attrs) => {
              return attrs.includes('/') ? match : `<meta${attrs}/>`;
            });
            updated = updated.replace(/<img([^>]*?)>/gi, (match, attrs) => {
              return attrs.includes('/') ? match : `<img${attrs}/>`;
            });
            
            setModified(true);
            setImageEditorVisible(false);
            setEditingImage(null);
            alert('Image edited and saved! (Note: Using embedded data URL - image may be large)');
            return updated;
          }
          
          return currentXhtml;
        });
        
        return; // Exit early if using data URL
      }
      const relativePath = `images/${uploadedFileName}`;
      
      // Update XHTML with the edited image
      setXhtml((currentXhtml) => {
        const parser = new DOMParser();
        let doc = parser.parseFromString(currentXhtml, 'text/html');
        let parserError = doc.querySelector('parsererror');
        if (parserError) {
          doc = parser.parseFromString(currentXhtml, 'application/xml');
        }
        
        const imgElement = doc.getElementById(editorData.imageId) || doc.querySelector(`#${editorData.imageId}`);
        if (imgElement) {
          // Update image source
          imgElement.setAttribute('src', relativePath);
          
          // Update dimensions if changed
          if (editorData.imageData.width) {
            imgElement.setAttribute('width', Math.round(editorData.imageData.width));
          }
          if (editorData.imageData.height) {
            imgElement.setAttribute('height', Math.round(editorData.imageData.height));
          }
          
          // Store text overlay data as data attribute (for future editing)
          if (editorData.texts && editorData.texts.length > 0) {
            imgElement.setAttribute('data-text-overlays', JSON.stringify(editorData.texts));
          }
          
          // Serialize back to XHTML
          const serializer = new XMLSerializer();
          let updated = serializer.serializeToString(doc.documentElement);
          
          // Handle HTML5 parser output
          if (doc.documentElement.tagName === 'HTML' && doc.body) {
            const doctypeMatch = currentXhtml.match(/<!DOCTYPE[^>]*>/i);
            const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';
            const xmlnsMatch = currentXhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
            const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';
            
            const headContent = doc.head ? doc.head.innerHTML : '';
            const bodyContent = doc.body ? doc.body.innerHTML : '';
            
            updated = `${doctype}\n<html xmlns="${xmlns}">\n`;
            if (headContent) {
              updated += `<head>\n${headContent}\n</head>\n`;
            }
            updated += `<body>\n${bodyContent}\n</body>\n</html>`;
          }
          
          // Ensure self-closing tags
          updated = updated.replace(/<meta([^>]*?)>/gi, (match, attrs) => {
            return attrs.includes('/') ? match : `<meta${attrs}/>`;
          });
          updated = updated.replace(/<img([^>]*?)>/gi, (match, attrs) => {
            return attrs.includes('/') ? match : `<img${attrs}/>`;
          });
          
          // Convert to preview URL for display
          const previewUrl = `${api.defaults.baseURL}/conversions/${jobId}/images/${uploadedFileName}`;
          updated = updated.replace(
            new RegExp(`src=["']${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g'),
            `src="${previewUrl}"`
          );
          
          setModified(true);
          return updated;
        }
        
        return currentXhtml;
      });
      
      setImageEditorVisible(false);
      setEditingImage(null);
      alert('Image edited and saved successfully!');
    } catch (err) {
      console.error('[EpubImageEditor] Error saving edited image:', err);
      alert('Failed to save edited image: ' + (err.response?.data?.message || err.message));
    }
  }, [jobId, images, xhtml]);

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      setError('');
      
      // If using GrapesJS, read HTML directly from the editor/iframe to get latest changes
      let xhtmlToSave = xhtml;
      if (useGrapesJS && grapesjsEditor) {
        try {
          const canvas = grapesjsEditor.Canvas;
          if (canvas) {
            const frameEl = canvas.getFrameEl();
            if (frameEl) {
              const frameDoc = frameEl.contentDocument || frameEl.contentWindow?.document;
              if (frameDoc && frameDoc.body) {
                // Read latest HTML from iframe body
                const html = frameDoc.body.innerHTML;
                const css = grapesjsEditor.getCss();
                xhtmlToSave = `<style>${css}</style>${html}`;
              } else {
                // Fallback to editor methods
                const html = grapesjsEditor.getHtml();
                const css = grapesjsEditor.getCss();
                xhtmlToSave = `<style>${css}</style>${html}`;
              }
            } else {
              // Fallback to editor methods
              const html = grapesjsEditor.getHtml();
              const css = grapesjsEditor.getCss();
              xhtmlToSave = `<style>${css}</style>${html}`;
            }
          }
        } catch (err) {
          console.warn('[EpubImageEditor] Error reading from GrapesJS editor, using xhtml state:', err);
          // Fall back to xhtml state if reading from editor fails
        }
      }
      
      // Convert absolute image URLs back to relative paths for EPUB
      // Find all img tags with absolute URLs and convert them to relative paths
      // EPUB structure: OEBPS/page_1.xhtml and OEBPS/images/file.jpg
      // So path should be "images/file.jpg" (not "../images/")
      
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
  }, [xhtml, jobId, pageNumber, onSave, useGrapesJS, grapesjsEditor]);

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

  // Determine which placeholders currently have images (by id)
  const placeholdersWithStatus = useMemo(() => {
    if (!xhtml || !placeholders) {
      console.log('[EpubImageEditor] placeholdersWithStatus: No xhtml or placeholders', { xhtml: !!xhtml, placeholders: placeholders?.length });
      return [];
    }
    const result = placeholders.map((p) => {
      const hasImg = new RegExp(`<img[^>]*id=["']${p.id}["']`, 'i').test(xhtml);
      return { ...p, hasImg };
    });
    console.log('[EpubImageEditor] placeholdersWithStatus:', {
      total: result.length,
      withImages: result.filter(p => p.hasImg).length,
      withoutImages: result.filter(p => !p.hasImg).length,
      placeholders: result.map(p => ({ id: p.id, hasImg: p.hasImg }))
    });
    return result;
  }, [xhtml, placeholders]);

  // Handle resizer drag
  const editorContentRef = useRef(null);
  
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeMove = useCallback((e) => {
    if (!isResizing || !editorContentRef.current) return;
    
    const container = editorContentRef.current;
    const containerRect = container.getBoundingClientRect();
    const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    
    // Constrain between 20% and 70%
    const constrainedWidth = Math.max(20, Math.min(70, newWidth));
    setGalleryWidth(constrainedWidth);
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (isResizing) {
      const handleMouseMove = (e) => handleResizeMove(e);
      const handleMouseUp = () => handleResizeEnd();
      
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

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
            <button
              onClick={() => setUseGrapesJS(!useGrapesJS)}
              className={`btn-toggle-grapesjs ${useGrapesJS ? 'active' : ''}`}
              title={useGrapesJS ? 'Switch to Standard Canvas' : 'Switch to GrapesJS Canvas (Component-based)'}
              style={{
                padding: '8px 16px',
                background: useGrapesJS ? '#9C27B0' : '#f5f5f5',
                color: useGrapesJS ? 'white' : '#666',
                border: `1px solid ${useGrapesJS ? '#9C27B0' : '#ddd'}`,
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'all 0.2s ease',
              }}
            >
              {useGrapesJS ? '🎨 GrapesJS ON' : '🎨 GrapesJS OFF'}
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
              onClick={() => setShowCodeViewer(true)}
              className="btn-view-code"
              style={{
                padding: '8px 16px',
                background: '#2196F3',
                color: 'white',
                border: '1px solid #2196F3',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'all 0.2s ease',
                display: 'inline-block',
                visibility: 'visible',
              }}
              title="View XHTML Code"
            >
              📄 View Code
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

        <div className="editor-content" ref={editorContentRef}>
          {/* Left Sidebar - Image Gallery (resizable) */}
          <div 
            className="image-gallery"
            style={{ width: `${galleryWidth}%` }}
          >
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

          {/* Resizer */}
          <div 
            className="panel-resizer"
            onMouseDown={handleResizeStart}
            style={{ cursor: 'col-resize' }}
          />

          {/* Right Canvas - XHTML Display (resizable) */}
          <div 
            className="xhtml-canvas-wrapper" 
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              height: '100%',
              width: `${100 - galleryWidth}%`
            }}
          >
            <div className="canvas-header">
              <h3>XHTML Canvas</h3>
              {placeholders.length > 0 && (
                <div className="placeholders-info">
                  <p>{placeholders.length} placeholder(s) found - Drag images from gallery to placeholders</p>
                </div>
              )}
            </div>
            <div 
              className="canvas-wrapper" 
              ref={canvasRef} 
              style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}
            >
              {useGrapesJS ? (
                <>
                  <GrapesJSCanvas
                    key={`grapesjs-canvas-${pageNumber}-${xhtml.length}-${modified ? 'modified' : 'initial'}`}
                    xhtml={xhtml}
                    onXhtmlChange={(updatedXhtml) => {
                      setXhtml((currentXhtml) => {
                        console.log('[EpubImageEditor] GrapesJS XHTML update:', {
                          currentLength: currentXhtml.length,
                          updatedLength: updatedXhtml.length,
                        });
                        return updatedXhtml;
                      });
                      setModified(true);
                    }}
                    editMode={editMode}
                    onEditModeChange={setEditMode}
                    onClearImage={handleClearImage}
                    onImageEdit={handleImageEdit}
                    onOpenImageEditor={handleOpenImageEditor}
                    images={images}
                    onDropImage={handleDrop}
                    placeholders={placeholders}
                    oneByOneMode={oneByOneMode}
                    onEditorReady={(editor) => {
                      setGrapesjsEditor(editor);
                    }}
                  />
                  {editMode && grapesjsEditor && (
                    <GrapesJSFooter
                      editor={grapesjsEditor}
                      editMode={editMode}
                      images={images}
                      onImageReplace={(imageId, image) => {
                        // Handle image replacement
                        handleDrop(imageId, image);
                      }}
                      onXhtmlChange={(updatedXhtml) => {
                        setXhtml(updatedXhtml);
                        setModified(true);
                      }}
                    />
                  )}
                </>
              ) : (
                <>
                  <DraggableCanvas
                    key={`canvas-${pageNumber}-${modified ? Date.now() : 'initial'}`} // Force re-render when XHTML changes
                    xhtml={xhtml}
                    onXhtmlChange={(updatedXhtml) => {
                      // Use functional update to ensure we're working with latest state
                      // This prevents overwriting changes when multiple edits happen quickly
                      setXhtml((currentXhtml) => {
                        // If the updated XHTML is based on DOM reading, use it directly
                        // Otherwise, merge changes intelligently
                        console.log('[EpubImageEditor] XHTML update:', {
                          currentLength: currentXhtml.length,
                          updatedLength: updatedXhtml.length,
                          currentImgCount: (currentXhtml.match(/<img[^>]*>/gi) || []).length,
                          updatedImgCount: (updatedXhtml.match(/<img[^>]*>/gi) || []).length
                        });
                        return updatedXhtml;
                      });
                      setModified(true);
                    }}
                    editMode={editMode}
                    onEditModeChange={setEditMode}
                    onClearImage={handleClearImage}
                    onImageEdit={handleImageEdit}
                    onOpenImageEditor={handleOpenImageEditor}
                  />
                  {/* Transparent drop zone overlay for image drops - only active when dragging images */}
                  {/* Only render XhtmlCanvas when NOT using GrapesJS */}
                  {!useGrapesJS && (
                    <ErrorBoundary fallback={<div style={{ display: 'none' }} />}>
                      <XhtmlCanvas
                        xhtml=""
                        placeholders={placeholders}
                        onDrop={handleDrop}
                        canvasRef={canvasRef}
                        editMode={editMode}
                        oneByOneMode={oneByOneMode}
                      />
                    </ErrorBoundary>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Image Editor Modal */}
      {imageEditorVisible && editingImage && (
        <div className="image-editor-modal" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <FabricImageEditor
            imageUrl={editingImage.imageUrl}
            imageId={editingImage.imageId}
            initialWidth={editingImage.initialWidth}
            initialHeight={editingImage.initialHeight}
            initialTexts={editingImage.initialTexts}
            onSave={handleSaveEditedImage}
            onCancel={() => {
              setImageEditorVisible(false);
              setEditingImage(null);
            }}
          />
        </div>
      )}

      {/* XHTML Code Viewer Modal */}
      {showCodeViewer && (
        <div 
          className="code-viewer-modal" 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 10001,
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCodeViewer(false);
            }
          }}
        >
          <div style={{
            backgroundColor: '#1e1e1e',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxWidth: '95vw',
            maxHeight: '95vh',
            margin: '0 auto',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#252526',
              borderRadius: '8px 8px 0 0',
            }}>
              <h3 style={{ 
                margin: 0, 
                color: '#fff',
                fontSize: '18px',
                fontWeight: '600',
              }}>
                XHTML Code Editor - Page {pageNumber}
              </h3>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(editedXhtml).then(() => {
                      alert('XHTML code copied to clipboard!');
                    }).catch(err => {
                      console.error('Failed to copy:', err);
                    });
                  }}
                  style={{
                    padding: '6px 12px',
                    background: '#0e639c',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'background 0.2s',
                  }}
                  onMouseOver={(e) => e.target.style.background = '#1177bb'}
                  onMouseOut={(e) => e.target.style.background = '#0e639c'}
                  title="Copy to clipboard"
                >
                  📋 Copy
                </button>
                <button
                  onClick={handleSaveEditedXhtml}
                  style={{
                    padding: '6px 12px',
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'background 0.2s',
                    fontWeight: '600',
                  }}
                  onMouseOver={(e) => e.target.style.background = '#45a049'}
                  onMouseOut={(e) => e.target.style.background = '#4CAF50'}
                  title="Save edited XHTML"
                >
                  💾 Save
                </button>
                <button
                  onClick={() => setShowCodeViewer(false)}
                  style={{
                    padding: '6px 12px',
                    background: '#d32f2f',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'background 0.2s',
                  }}
                  onMouseOver={(e) => e.target.style.background = '#f44336'}
                  onMouseOut={(e) => e.target.style.background = '#d32f2f'}
                  title="Close"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Code Editor */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '20px',
              backgroundColor: '#1e1e1e',
            }}>
              <textarea
                value={editedXhtml}
                onChange={(e) => setEditedXhtml(e.target.value)}
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: '400px',
                  backgroundColor: '#1e1e1e',
                  color: '#d4d4d4',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  padding: '15px',
                  resize: 'vertical',
                  whiteSpace: 'pre',
                  overflowWrap: 'normal',
                  overflowX: 'auto',
                }}
                spellCheck={false}
                placeholder="Edit XHTML code here..."
              />
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid #333',
              backgroundColor: '#252526',
              borderRadius: '0 0 8px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              color: '#999',
            }}>
              <span>Length: {editedXhtml.length} characters</span>
              <span>Press ESC to close | Ctrl+S to save</span>
            </div>
          </div>
        </div>
      )}
    </DndProvider>
  );
};

export default EpubImageEditor;

