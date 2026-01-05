/**
 * Image Resize and Position Editor for XHTML Canvas
 * Pure JavaScript implementation - no frameworks or external dependencies
 * Compatible with XHTML standards
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    resizeHandleSize: 8,
    resizeHandleColor: '#2196f3',
    resizeBorderColor: '#2196f3',
    resizeBorderWidth: 2,
    resizeBorderStyle: 'dashed',
    selectedClass: 'xhtml-image-selected',
    editingClass: 'xhtml-image-editing',
    toolbarId: 'xhtml-image-toolbar'
  };

  // State
  let selectedImage = null;
  let isEditing = false;
  let isResizing = false;
  let isDragging = false;
  let resizeHandle = null;
  let dragStartPos = { x: 0, y: 0 };
  let imageStartPos = { x: 0, y: 0 };
  let imageStartSize = { width: 0, height: 0 };
  let aspectRatio = 1;
  let container = null;

  /**
   * Initialize image editing
   */
  function init(containerElement) {
    container = containerElement || document.body;
    
    // Inject CSS if not already present
    injectCSS();
    
    // Create toolbar
    createToolbar();
    
    // Attach event listeners
    attachEventListeners();
    
    console.log('[ImageResize] Initialized');
  }

  /**
   * Inject CSS styles
   */
  function injectCSS() {
    if (document.getElementById('xhtml-image-resize-styles')) {
      return; // Already injected
    }

    const style = document.createElement('style');
    style.id = 'xhtml-image-resize-styles';
    style.textContent = `
      .xhtml-image-selected {
        outline: 2px dashed #2196f3 !important;
        outline-offset: 2px;
        position: relative;
      }

      .xhtml-image-editing {
        cursor: move;
      }

      .xhtml-resize-handle {
        position: absolute;
        width: ${CONFIG.resizeHandleSize}px;
        height: ${CONFIG.resizeHandleSize}px;
        background-color: ${CONFIG.resizeHandleColor};
        border: 2px solid #fff;
        border-radius: 2px;
        z-index: 10000;
        box-sizing: border-box;
      }

      .xhtml-resize-handle-corner {
        width: ${CONFIG.resizeHandleSize}px;
        height: ${CONFIG.resizeHandleSize}px;
      }

      .xhtml-resize-handle-edge {
        background-color: ${CONFIG.resizeHandleColor};
        border: 2px solid #fff;
      }

      .xhtml-resize-handle-nw { cursor: nw-resize; }
      .xhtml-resize-handle-ne { cursor: ne-resize; }
      .xhtml-resize-handle-sw { cursor: sw-resize; }
      .xhtml-resize-handle-se { cursor: se-resize; }
      .xhtml-resize-handle-n { cursor: n-resize; }
      .xhtml-resize-handle-s { cursor: s-resize; }
      .xhtml-resize-handle-w { cursor: w-resize; }
      .xhtml-resize-handle-e { cursor: e-resize; }

      .xhtml-image-toolbar {
        position: absolute;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        z-index: 10001;
        display: none;
        font-family: Arial, sans-serif;
        font-size: 12px;
      }

      .xhtml-image-toolbar.visible {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .xhtml-image-toolbar-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .xhtml-image-toolbar input {
        width: 60px;
        padding: 4px;
        border: 1px solid #ddd;
        border-radius: 3px;
        font-size: 11px;
      }

      .xhtml-image-toolbar button {
        padding: 4px 8px;
        border: 1px solid #ddd;
        border-radius: 3px;
        background: #f5f5f5;
        cursor: pointer;
        font-size: 11px;
      }

      .xhtml-image-toolbar button:hover {
        background: #e0e0e0;
      }

      .xhtml-image-toolbar label {
        font-size: 11px;
        white-space: nowrap;
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * Create floating toolbar
   */
  function createToolbar() {
    if (document.getElementById(CONFIG.toolbarId)) {
      return; // Already exists
    }

    const toolbar = document.createElement('div');
    toolbar.id = CONFIG.toolbarId;
    toolbar.className = 'xhtml-image-toolbar';
    toolbar.innerHTML = `
      <div class="xhtml-image-toolbar-row">
        <label>W:</label>
        <input type="number" id="xhtml-toolbar-width" min="20" step="1">
        <select id="xhtml-toolbar-width-unit">
          <option value="px">px</option>
          <option value="%">%</option>
        </select>
      </div>
      <div class="xhtml-image-toolbar-row">
        <label>H:</label>
        <input type="number" id="xhtml-toolbar-height" min="20" step="1">
        <select id="xhtml-toolbar-height-unit">
          <option value="px">px</option>
          <option value="%">%</option>
        </select>
      </div>
      <div class="xhtml-image-toolbar-row">
        <label>
          <input type="checkbox" id="xhtml-toolbar-lock-aspect"> Lock
        </label>
        <button id="xhtml-toolbar-reset">Reset</button>
        <button id="xhtml-toolbar-close">✕</button>
      </div>
    `;

    document.body.appendChild(toolbar);

    // Attach toolbar event listeners
    attachToolbarListeners();
  }

  /**
   * Attach toolbar event listeners
   */
  function attachToolbarListeners() {
    const widthInput = document.getElementById('xhtml-toolbar-width');
    const heightInput = document.getElementById('xhtml-toolbar-height');
    const widthUnit = document.getElementById('xhtml-toolbar-width-unit');
    const heightUnit = document.getElementById('xhtml-toolbar-height-unit');
    const lockAspect = document.getElementById('xhtml-toolbar-lock-aspect');
    const resetBtn = document.getElementById('xhtml-toolbar-reset');
    const closeBtn = document.getElementById('xhtml-toolbar-close');

    if (widthInput) {
      widthInput.addEventListener('input', handleToolbarWidthChange);
      widthInput.addEventListener('change', handleToolbarWidthChange);
    }

    if (heightInput) {
      heightInput.addEventListener('input', handleToolbarHeightChange);
      heightInput.addEventListener('change', handleToolbarHeightChange);
    }

    if (lockAspect) {
      lockAspect.addEventListener('change', function() {
        if (selectedImage) {
          updateToolbar();
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', handleToolbarReset);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', deselectImage);
    }
  }

  /**
   * Handle toolbar width change
   */
  function handleToolbarWidthChange(e) {
    if (!selectedImage || isResizing || isDragging) return;

    const widthInput = document.getElementById('xhtml-toolbar-width');
    const widthUnit = document.getElementById('xhtml-toolbar-width-unit');
    const lockAspect = document.getElementById('xhtml-toolbar-lock-aspect');

    const newWidth = parseFloat(widthInput.value);
    const unit = widthUnit ? widthUnit.value : 'px';

    if (isNaN(newWidth) || newWidth < 20) return;

    if (lockAspect && lockAspect.checked) {
      const newHeight = Math.round(newWidth / aspectRatio);
      setImageSize(newWidth + unit, newHeight + unit);
      updateToolbar();
    } else {
      setImageSize(newWidth + unit, null);
      updateToolbar();
    }
  }

  /**
   * Handle toolbar height change
   */
  function handleToolbarHeightChange(e) {
    if (!selectedImage || isResizing || isDragging) return;

    const heightInput = document.getElementById('xhtml-toolbar-height');
    const heightUnit = document.getElementById('xhtml-toolbar-height-unit');
    const lockAspect = document.getElementById('xhtml-toolbar-lock-aspect');

    const newHeight = parseFloat(heightInput.value);
    const unit = heightUnit ? heightUnit.value : 'px';

    if (isNaN(newHeight) || newHeight < 20) return;

    if (lockAspect && lockAspect.checked) {
      const newWidth = Math.round(newHeight * aspectRatio);
      setImageSize(newWidth + unit, newHeight + unit);
      updateToolbar();
    } else {
      setImageSize(null, newHeight + unit);
      updateToolbar();
    }
  }

  /**
   * Handle toolbar reset
   */
  function handleToolbarReset() {
    if (!selectedImage) return;

    // Remove width/height attributes and styles
    selectedImage.removeAttribute('width');
    selectedImage.removeAttribute('height');
    const style = selectedImage.getAttribute('style') || '';
    const newStyle = style
      .replace(/width\s*:\s*[^;]+;?/gi, '')
      .replace(/height\s*:\s*[^;]+;?/gi, '')
      .trim();
    
    if (newStyle) {
      selectedImage.setAttribute('style', newStyle);
    } else {
      selectedImage.removeAttribute('style');
    }

    updateHandles();
    updateToolbar();
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Use event delegation for dynamically loaded images
    container.addEventListener('click', handleImageClick, true);
    container.addEventListener('dblclick', handleImageDoubleClick, true);
    container.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Handle image click
   */
  function handleImageClick(e) {
    const img = e.target.closest('img');
    if (!img) {
      if (!e.target.closest('.xhtml-resize-handle') && 
          !e.target.closest('.xhtml-image-toolbar')) {
        deselectImage();
      }
      return;
    }

    e.stopPropagation();
    selectImage(img);
  }

  /**
   * Handle image double-click
   */
  function handleImageDoubleClick(e) {
    const img = e.target.closest('img');
    if (!img) return;

    e.stopPropagation();
    e.preventDefault();
    
    if (selectedImage === img && isEditing) {
      // Double-click again to exit edit mode
      exitEditMode();
    } else {
      selectImage(img);
      enterEditMode();
    }
  }

  /**
   * Handle mouse down
   */
  function handleMouseDown(e) {
    if (!isEditing || !selectedImage) return;

    const handle = e.target.closest('.xhtml-resize-handle');
    if (handle) {
      e.preventDefault();
      e.stopPropagation();
      startResize(handle, e);
      return;
    }

    if (e.target === selectedImage || selectedImage.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      startDrag(e);
    }
  }

  /**
   * Handle mouse move
   */
  function handleMouseMove(e) {
    if (isResizing) {
      continueResize(e);
    } else if (isDragging) {
      continueDrag(e);
    }
  }

  /**
   * Handle mouse up
   */
  function handleMouseUp(e) {
    if (isResizing) {
      endResize();
    } else if (isDragging) {
      endDrag();
    }
  }

  /**
   * Handle key down
   */
  function handleKeyDown(e) {
    if (e.key === 'Escape' && isEditing) {
      exitEditMode();
    }
  }

  /**
   * Select image
   */
  function selectImage(img) {
    deselectImage();
    
    selectedImage = img;
    selectedImage.classList.add(CONFIG.selectedClass);
    
    createHandles();
    updateToolbar();
    showToolbar();
  }

  /**
   * Deselect image
   */
  function deselectImage() {
    if (selectedImage) {
      selectedImage.classList.remove(CONFIG.selectedClass, CONFIG.editingClass);
      removeHandles();
      hideToolbar();
      selectedImage = null;
    }
    isEditing = false;
  }

  /**
   * Enter edit mode
   */
  function enterEditMode() {
    if (!selectedImage) return;
    
    isEditing = true;
    selectedImage.classList.add(CONFIG.editingClass);
    
    // Calculate aspect ratio
    const rect = selectedImage.getBoundingClientRect();
    aspectRatio = rect.width / rect.height;
    
    updateHandles();
  }

  /**
   * Exit edit mode
   */
  function exitEditMode() {
    if (selectedImage) {
      selectedImage.classList.remove(CONFIG.editingClass);
    }
    isEditing = false;
    
    if (isResizing) endResize();
    if (isDragging) endDrag();
  }

  /**
   * Create resize handles
   */
  function createHandles() {
    if (!selectedImage) return;
    
    removeHandles();
    
    const handles = [
      { class: 'xhtml-resize-handle-nw', pos: 'nw' },
      { class: 'xhtml-resize-handle-ne', pos: 'ne' },
      { class: 'xhtml-resize-handle-sw', pos: 'sw' },
      { class: 'xhtml-resize-handle-se', pos: 'se' },
      { class: 'xhtml-resize-handle-n', pos: 'n' },
      { class: 'xhtml-resize-handle-s', pos: 's' },
      { class: 'xhtml-resize-handle-w', pos: 'w' },
      { class: 'xhtml-resize-handle-e', pos: 'e' }
    ];

    handles.forEach(function(handle) {
      const handleEl = document.createElement('div');
      handleEl.className = 'xhtml-resize-handle ' + handle.className;
      handleEl.setAttribute('data-resize-pos', handle.pos);
      selectedImage.parentNode.insertBefore(handleEl, selectedImage.nextSibling);
    });

    updateHandles();
  }

  /**
   * Update handle positions
   */
  function updateHandles() {
    if (!selectedImage) return;
    
    const rect = selectedImage.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    const handles = container.querySelectorAll('.xhtml-resize-handle');
    const offset = CONFIG.resizeHandleSize / 2;
    
    handles.forEach(function(handle) {
      const pos = handle.getAttribute('data-resize-pos');
      let left = rect.left - containerRect.left + container.scrollLeft;
      let top = rect.top - containerRect.top + container.scrollTop;
      
      switch(pos) {
        case 'nw':
          handle.style.left = (left - offset) + 'px';
          handle.style.top = (top - offset) + 'px';
          break;
        case 'ne':
          handle.style.left = (left + rect.width - offset) + 'px';
          handle.style.top = (top - offset) + 'px';
          break;
        case 'sw':
          handle.style.left = (left - offset) + 'px';
          handle.style.top = (top + rect.height - offset) + 'px';
          break;
        case 'se':
          handle.style.left = (left + rect.width - offset) + 'px';
          handle.style.top = (top + rect.height - offset) + 'px';
          break;
        case 'n':
          handle.style.left = (left + rect.width / 2 - offset) + 'px';
          handle.style.top = (top - offset) + 'px';
          handle.style.width = (CONFIG.resizeHandleSize * 2) + 'px';
          break;
        case 's':
          handle.style.left = (left + rect.width / 2 - offset) + 'px';
          handle.style.top = (top + rect.height - offset) + 'px';
          handle.style.width = (CONFIG.resizeHandleSize * 2) + 'px';
          break;
        case 'w':
          handle.style.left = (left - offset) + 'px';
          handle.style.top = (top + rect.height / 2 - offset) + 'px';
          handle.style.height = (CONFIG.resizeHandleSize * 2) + 'px';
          break;
        case 'e':
          handle.style.left = (left + rect.width - offset) + 'px';
          handle.style.top = (top + rect.height / 2 - offset) + 'px';
          handle.style.height = (CONFIG.resizeHandleSize * 2) + 'px';
          break;
      }
    });
  }

  /**
   * Remove resize handles
   */
  function removeHandles() {
    const handles = container.querySelectorAll('.xhtml-resize-handle');
    handles.forEach(function(handle) {
      handle.parentNode.removeChild(handle);
    });
  }

  /**
   * Start resize
   */
  function startResize(handle, e) {
    if (!selectedImage) return;
    
    isResizing = true;
    resizeHandle = handle.getAttribute('data-resize-pos');
    
    const rect = selectedImage.getBoundingClientRect();
    imageStartSize.width = rect.width;
    imageStartSize.height = rect.height;
    aspectRatio = rect.width / rect.height;
    
    dragStartPos.x = e.clientX;
    dragStartPos.y = e.clientY;
  }

  /**
   * Continue resize
   */
  function continueResize(e) {
    if (!selectedImage || !resizeHandle) return;
    
    const deltaX = e.clientX - dragStartPos.x;
    const deltaY = e.clientY - dragStartPos.y;
    
    let newWidth = imageStartSize.width;
    let newHeight = imageStartSize.height;
    
    const shiftKey = e.shiftKey;
    
    // Calculate new dimensions based on handle position
    if (resizeHandle.includes('e')) {
      newWidth = Math.max(20, imageStartSize.width + deltaX);
    } else if (resizeHandle.includes('w')) {
      newWidth = Math.max(20, imageStartSize.width - deltaX);
    }
    
    if (resizeHandle.includes('s')) {
      newHeight = Math.max(20, imageStartSize.height + deltaY);
    } else if (resizeHandle.includes('n')) {
      newHeight = Math.max(20, imageStartSize.height - deltaY);
    }
    
    // Maintain aspect ratio if Shift key is pressed
    if (shiftKey) {
      if (resizeHandle === 'se' || resizeHandle === 'nw') {
        newHeight = newWidth / aspectRatio;
      } else if (resizeHandle === 'sw' || resizeHandle === 'ne') {
        newHeight = newWidth / aspectRatio;
      } else if (resizeHandle === 'e' || resizeHandle === 'w') {
        newHeight = newWidth / aspectRatio;
      } else if (resizeHandle === 'n' || resizeHandle === 's') {
        newWidth = newHeight * aspectRatio;
      }
    }
    
    setImageSize(newWidth + 'px', newHeight + 'px');
    updateHandles();
    updateToolbar();
  }

  /**
   * End resize
   */
  function endResize() {
    isResizing = false;
    resizeHandle = null;
  }

  /**
   * Start drag
   */
  function startDrag(e) {
    if (!selectedImage) return;
    
    isDragging = true;
    
    const rect = selectedImage.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    imageStartPos.x = rect.left - containerRect.left;
    imageStartPos.y = rect.top - containerRect.top;
    
    dragStartPos.x = e.clientX;
    dragStartPos.y = e.clientY;
  }

  /**
   * Continue drag
   */
  function continueDrag(e) {
    if (!selectedImage) return;
    
    const deltaX = e.clientX - dragStartPos.x;
    const deltaY = e.clientY - dragStartPos.y;
    
    const newX = imageStartPos.x + deltaX;
    const newY = imageStartPos.y + deltaY;
    
    // Constrain to container bounds
    const containerRect = container.getBoundingClientRect();
    const imgRect = selectedImage.getBoundingClientRect();
    
    const minX = 0;
    const minY = 0;
    const maxX = containerRect.width - imgRect.width;
    const maxY = containerRect.height - imgRect.height;
    
    const constrainedX = Math.max(minX, Math.min(maxX, newX));
    const constrainedY = Math.max(minY, Math.min(maxY, newY));
    
    setImagePosition(constrainedX + 'px', constrainedY + 'px');
    updateHandles();
    updateToolbar();
  }

  /**
   * End drag
   */
  function endDrag() {
    isDragging = false;
  }

  /**
   * Set image size
   */
  function setImageSize(width, height) {
    if (!selectedImage) return;
    
    let style = selectedImage.getAttribute('style') || '';
    
    if (width) {
      selectedImage.setAttribute('width', parseInt(width));
      style = style.replace(/width\s*:\s*[^;]+;?/gi, '');
      style = (style.trim() ? style + '; ' : '') + 'width: ' + width + ';';
    }
    
    if (height) {
      selectedImage.setAttribute('height', parseInt(height));
      style = style.replace(/height\s*:\s*[^;]+;?/gi, '');
      style = (style.trim() ? style + '; ' : '') + 'height: ' + height + ';';
    }
    
    selectedImage.setAttribute('style', style.trim());
  }

  /**
   * Set image position
   */
  function setImagePosition(left, top) {
    if (!selectedImage) return;
    
    let style = selectedImage.getAttribute('style') || '';
    
    // Ensure position is set
    if (!style.includes('position:')) {
      style = (style.trim() ? style + '; ' : '') + 'position: absolute; ';
    } else {
      style = style.replace(/position\s*:\s*[^;]+;?/gi, 'position: absolute; ');
    }
    
    style = style.replace(/left\s*:\s*[^;]+;?/gi, '');
    style = style.replace(/top\s*:\s*[^;]+;?/gi, '');
    
    style = (style.trim() ? style + '; ' : '') + 'left: ' + left + '; top: ' + top + ';';
    
    selectedImage.setAttribute('style', style.trim());
  }

  /**
   * Update toolbar
   */
  function updateToolbar() {
    if (!selectedImage) return;
    
    const toolbar = document.getElementById(CONFIG.toolbarId);
    if (!toolbar) return;
    
    const rect = selectedImage.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    const widthInput = document.getElementById('xhtml-toolbar-width');
    const heightInput = document.getElementById('xhtml-toolbar-height');
    const widthUnit = document.getElementById('xhtml-toolbar-width-unit');
    const heightUnit = document.getElementById('xhtml-toolbar-height-unit');
    
    if (widthInput) {
      widthInput.value = Math.round(rect.width);
    }
    if (heightInput) {
      heightInput.value = Math.round(rect.height);
    }
    
    // Position toolbar above image
    toolbar.style.left = (rect.left - containerRect.left + container.scrollLeft) + 'px';
    toolbar.style.top = (rect.top - containerRect.top + container.scrollTop - 100) + 'px';
  }

  /**
   * Show toolbar
   */
  function showToolbar() {
    const toolbar = document.getElementById(CONFIG.toolbarId);
    if (toolbar) {
      toolbar.classList.add('visible');
      updateToolbar();
    }
  }

  /**
   * Hide toolbar
   */
  function hideToolbar() {
    const toolbar = document.getElementById(CONFIG.toolbarId);
    if (toolbar) {
      toolbar.classList.remove('visible');
    }
  }

  // Public API
  window.XHTMLImageEditor = {
    init: init,
    selectImage: selectImage,
    deselectImage: deselectImage,
    enterEditMode: enterEditMode,
    exitEditMode: exitEditMode
  };

})();

