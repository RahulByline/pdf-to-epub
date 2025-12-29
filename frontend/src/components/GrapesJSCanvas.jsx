import React, { useEffect, useRef, useState, useCallback } from 'react';
import grapesjs from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import './GrapesJSCanvas.css';

/**
 * GrapesJS Canvas Component for EPUB Image Editor
 * Uses component-based approach for accurate drop detection
 * This solves the "absolute positioning trap" by using DOM-based component detection
 */
const GrapesJSCanvas = ({ 
  xhtml, 
  onXhtmlChange, 
  editMode = false, 
  onEditModeChange,
  onClearImage,
  onImageEdit,
  onOpenImageEditor,
  images = [],
  onDropImage,
  placeholders = [],
  oneByOneMode = true,
  onEditorReady
}) => {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const [editor, setEditor] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const isUpdatingFromExternalRef = useRef(false); // Flag to prevent loops
  const lastXhtmlRef = useRef(''); // Track last xhtml to prevent unnecessary updates
  const isMountedRef = useRef(true); // Track if component is still mounted
  const onXhtmlChangeRef = useRef(onXhtmlChange); // Store callback in ref to avoid stale closures
  const initializationStartedRef = useRef(false); // Prevent multiple initializations
  const initialContentLoadedRef = useRef(false); // Track if initial content has been loaded
  const pendingXhtmlUpdateRef = useRef(null); // Track pending XHTML update to apply once editor is ready

  // Keep ref updated when callback changes
  useEffect(() => {
    onXhtmlChangeRef.current = onXhtmlChange;
  }, [onXhtmlChange]);

  // Initialize GrapesJS editor
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Prevent multiple initializations - use multiple guards
    // Check if container already has GrapesJS initialized
    if (containerRef.current.querySelector('.gjs-cv-canvas')) {
      console.warn('[GrapesJSCanvas] Container already has GrapesJS canvas, skipping initialization');
      return;
    }
    
    if (initializationStartedRef.current || editorRef.current || window.__grapesjsInitializing) {
      console.warn('[GrapesJSCanvas] Editor already initialized or initializing, skipping');
      return;
    }

    console.log('[GrapesJSCanvas] Initializing GrapesJS editor');
    
    // Mark initialization as started using ref (no state update = no re-render)
    initializationStartedRef.current = true;
    
    // Set global flag to prevent concurrent initializations
    window.__grapesjsInitializing = true;

    const grapesEditor = grapesjs.init({
      container: containerRef.current,
      height: '100%',
      width: '100%',
      fromElement: false, // Don't parse from container - we'll set content manually
      storageManager: false, // Disable default storage
      plugins: [],
      pluginsOpts: {},
      canvas: {
        styles: [], // We'll use the XHTML styles
        scripts: [], // No scripts needed
      },
      deviceManager: {
        devices: [
          {
            name: 'Desktop',
            width: '',
          },
        ],
      },
      // Disable default panels we don't need
      panels: { defaults: [] },
      // Custom block manager
      blockManager: {
        appendTo: null,
      },
      // Layer manager
      layerManager: {
        appendTo: null,
      },
      // Style manager
      styleManager: {
        appendTo: null,
      },
      // Trait manager
      traitManager: {
        appendTo: null,
      },
      // Selector manager
      selectorManager: {
        appendTo: null,
      },
      // Rich text editor
      richTextEditor: {
        actions: ['bold', 'italic', 'underline', 'link'],
      },
      // Notice: We'll work in view mode and handle interactions manually
      noticeOnUnload: false,
      // Disable selection to prevent errors
      allowScripts: 0,
      // Allow text editing and deletion
      keymaps: {
        // Don't override default browser behavior for text editing
        defaults: {},
      },
    });
    
    // Wait for editor to be fully initialized before setting up event handlers
    setTimeout(() => {
      if (!isMountedRef.current || !grapesEditor) return;
      
      try {
        // Override getSelected to prevent errors
        if (grapesEditor.getSelected) {
          const originalGetSelected = grapesEditor.getSelected.bind(grapesEditor);
          grapesEditor.getSelected = function() {
            try {
              return originalGetSelected();
            } catch (e) {
              console.warn('[GrapesJSCanvas] Error getting selected component:', e);
              return null;
            }
          };
        }
        
        // Prevent selection events from causing errors
        grapesEditor.on('component:selected', () => {
          // Silently handle selection without errors
        });
        
        // Allow component selection (needed for image replacement in footer)
        // Don't prevent selection - the footer needs to detect selected images
        // grapesEditor.on('component:select', () => {
        //   return false;
        // });
      } catch (e) {
        console.warn('[GrapesJSCanvas] Error setting up selection handlers:', e);
      }
    }, 100);

    // Load content into GrapesJS - called after canvas:mount
    const loadContent = () => {
      if (!isMountedRef.current || !grapesEditor || !xhtml) {
        console.warn('[GrapesJSCanvas] Cannot load content - missing requirements');
        return;
      }
      
      try {
        console.log('[GrapesJSCanvas] Canvas mounted, setting initial content');
        console.log('[GrapesJSCanvas] XHTML length:', xhtml.length);
        
        // Parse XHTML to extract body content (GrapesJS setComponents expects body HTML, not full document)
        const parser = new DOMParser();
        const doc = parser.parseFromString(xhtml, 'text/html');
        
        // Extract body content
        let bodyContent = '';
        if (doc.body) {
          bodyContent = doc.body.innerHTML;
        } else if (doc.documentElement) {
          // Fallback if no body tag
          bodyContent = doc.documentElement.innerHTML;
        }
        
        // Extract styles
        const styles = doc.querySelector('style')?.innerHTML || '';
        
        console.log('[GrapesJSCanvas] Body content length:', bodyContent.length, 'Styles length:', styles.length);
        
        if (!bodyContent) {
          console.error('[GrapesJSCanvas] No body content extracted from XHTML!');
          return;
        }
        
        // Set flag to prevent initial load from triggering events
        isUpdatingFromExternalRef.current = true;
        
        // CRITICAL: Set components with body content (not full document)
        try {
          grapesEditor.setComponents(bodyContent);
          console.log('[GrapesJSCanvas] Components set via API');
        } catch (setError) {
          console.error('[GrapesJSCanvas] Error setting components via API:', setError);
        }
        
        // Set styles
        if (styles && typeof grapesEditor.setStyle === 'function') {
          try {
            grapesEditor.setStyle(styles);
            console.log('[GrapesJSCanvas] Styles set via API');
          } catch (styleError) {
            console.error('[GrapesJSCanvas] Error setting styles:', styleError);
          }
        }
        
        // CRITICAL: Also set content directly in iframe as primary method
        const canvas = grapesEditor.Canvas;
        if (canvas) {
          const frameEl = canvas.getFrameEl();
          if (frameEl) {
            try {
              const frameDoc = frameEl.contentDocument || frameEl.contentWindow?.document;
              if (frameDoc) {
                // Set body content directly
                if (frameDoc.body) {
                  frameDoc.body.innerHTML = bodyContent;
                  console.log('[GrapesJSCanvas] Content set directly in iframe body');
                } else {
                  console.warn('[GrapesJSCanvas] Frame document has no body element');
                }
                
                // Set styles in head
                if (styles) {
                  let styleEl = frameDoc.querySelector('style');
                  if (!styleEl) {
                    styleEl = frameDoc.createElement('style');
                    frameDoc.head.appendChild(styleEl);
                  }
                  styleEl.textContent = styles;
                  console.log('[GrapesJSCanvas] Styles injected into iframe head');
                }
                
                // Ensure body is visible
                if (frameDoc.body) {
                  frameDoc.body.style.opacity = '1';
                  frameDoc.body.style.overflow = 'auto';
                  frameDoc.body.style.visibility = 'visible';
                  frameDoc.body.style.display = 'block';
                  frameDoc.body.style.minHeight = '100%';
                  frameDoc.body.style.margin = '0';
                  frameDoc.body.style.padding = '0';
                  
                  // Check body content
                  const bodyHtml = frameDoc.body.innerHTML || '';
                  console.log('[GrapesJSCanvas] Iframe body innerHTML length:', bodyHtml.length);
                  
                  if (bodyHtml.length === 0) {
                    console.error('[GrapesJSCanvas] Iframe body is still empty after injection!');
                  } else {
                    console.log('[GrapesJSCanvas] Iframe body has content - preview:', bodyHtml.substring(0, 100));
                  }
                }
              } else {
                console.warn('[GrapesJSCanvas] Could not access frame document');
              }
            } catch (iframeError) {
              console.error('[GrapesJSCanvas] Error accessing iframe:', iframeError);
            }
          } else {
            console.warn('[GrapesJSCanvas] Could not get frame element');
          }
        }
        
        // Force refresh to render
        grapesEditor.refresh();
        
        // Verify content was set (after a delay to allow processing)
        setTimeout(() => {
          const verifyHtml = grapesEditor.getHtml();
          const verifyCss = grapesEditor.getCss();
          console.log('[GrapesJSCanvas] Verification - HTML length:', verifyHtml.length, 'CSS length:', verifyCss.length);
          
          if (verifyHtml.length === 0) {
            console.error('[GrapesJSCanvas] getHtml() returned empty string!');
          }
        }, 200);
        
        // Initialize last known value
        lastXhtmlRef.current = xhtml;
        initialContentLoadedRef.current = true; // Mark initial load as complete
        
        // Reset flag after initialization
        setTimeout(() => {
          if (isMountedRef.current) {
            isUpdatingFromExternalRef.current = false;
          }
        }, 300);
        
      } catch (e) {
        console.error('[GrapesJSCanvas] Error loading content:', e);
        console.error('[GrapesJSCanvas] Error stack:', e.stack);
      }
    };
    
    // CRITICAL: Wait for canvas:mount event - this guarantees the iframe is ready
    // This is the most reliable way to ensure content loads correctly
    let contentLoaded = false;
    
    const tryLoadContent = () => {
      console.log('[GrapesJSCanvas] tryLoadContent called', {
        isMounted: isMountedRef.current,
        contentLoaded,
        hasXhtml: !!xhtml,
        xhtmlLength: xhtml?.length || 0
      });
      
      // Don't check isMounted here - React Strict Mode can cause false negatives
      // The useEffect will handle loading when both editor and xhtml are ready
      if (contentLoaded) {
        console.warn('[GrapesJSCanvas] Content already loaded, skipping');
        return;
      }
      
      if (!xhtml) {
        console.warn('[GrapesJSCanvas] No xhtml available yet, skipping');
        return;
      }
      
      // Editor is already initialized, don't set state again to avoid loops
      // setEditor is already called below, don't call it again here
    };
    
    grapesEditor.on('canvas:mount', () => {
      console.log('[GrapesJSCanvas] canvas:mount event fired');
      tryLoadContent();
    });
    
    // Also listen for canvas:frame:load (iframe is ready)
    grapesEditor.on('canvas:frame:load', () => {
      console.log('[GrapesJSCanvas] canvas:frame:load event fired');
      setTimeout(() => {
        if (!contentLoaded) {
          tryLoadContent();
        }
      }, 100);
    });
    
    // Fallback: Also listen for load event (in case canvas:mount doesn't fire)
    grapesEditor.on('load', () => {
      console.log('[GrapesJSCanvas] Editor load event fired');
      setTimeout(() => {
        if (!contentLoaded) {
          tryLoadContent();
        }
      }, 300);
    });
    
    // Additional fallback: Check if iframe is ready after a delay
    setTimeout(() => {
      if (isMountedRef.current && !contentLoaded) {
        console.log('[GrapesJSCanvas] Fallback timeout - checking iframe');
        const canvas = grapesEditor.Canvas;
        if (canvas) {
          const frameEl = canvas.getFrameEl();
          if (frameEl) {
            try {
              const frameDoc = frameEl.contentDocument || frameEl.contentWindow?.document;
              if (frameDoc && frameDoc.readyState === 'complete') {
                console.log('[GrapesJSCanvas] Iframe ready (fallback check)');
                tryLoadContent();
              } else {
                console.log('[GrapesJSCanvas] Iframe not ready yet, readyState:', frameDoc?.readyState);
              }
            } catch (e) {
              console.warn('[GrapesJSCanvas] Could not check iframe:', e);
            }
          } else {
            console.warn('[GrapesJSCanvas] No frame element found');
          }
        } else {
          console.warn('[GrapesJSCanvas] No canvas found');
        }
      }
    }, 1500);
    
    // Store editor reference
    editorRef.current = grapesEditor;

    // Debounced handler for component changes to prevent infinite loops
    // DISABLED: Component change events cause infinite loops with xhtml sync
    // The save function reads directly from editor, so we don't need to sync on every change
    const updateTimeoutRef = { current: null };
    const handleComponentChange = () => {
      // Completely disable component change handler to prevent loops
      // The save function will read directly from the editor when needed
      return;
      
      // OLD CODE - DISABLED TO PREVENT LOOPS
      /*
      // Ignore changes when footer is modifying DOM directly
      if (window.__footerModifying) {
        return;
      }
      
      if (!isMountedRef.current || isUpdatingFromExternalRef.current) return;
      
      // Clear any pending updates
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
      
      // Debounce the update
      updateTimeoutRef.current = setTimeout(() => {
        // Check flag again in timeout callback (footer might still be modifying)
        if (window.__footerModifying) {
          updateTimeoutRef.current = null;
          return;
        }
        
        if (!isMountedRef.current || isUpdatingFromExternalRef.current || !grapesEditor) {
          updateTimeoutRef.current = null;
          return;
        }
        
        try {
          const updatedHtml = grapesEditor.getHtml();
          const updatedCss = grapesEditor.getCss();
          const fullHtml = `<style>${updatedCss}</style>${updatedHtml}`;
          
          // Only update if different from last known value
          if (fullHtml !== lastXhtmlRef.current && onXhtmlChangeRef.current) {
            lastXhtmlRef.current = fullHtml;
            onXhtmlChangeRef.current(fullHtml);
          }
        } catch (e) {
          console.warn('[GrapesJSCanvas] Error in component change handler:', e);
        }
        updateTimeoutRef.current = null;
      }, 500); // Longer debounce to prevent loops
      */
    };

    // Component change listeners DISABLED to prevent infinite loops
    // The save function reads directly from editor, so we don't need to sync on every change
    // grapesEditor.on('component:update', handleComponentChange);
    // grapesEditor.on('component:add', handleComponentChange);
    // grapesEditor.on('component:remove', handleComponentChange);

    // Define custom component type for image placeholders
    const placeholderType = grapesEditor.DomComponents.addType('image-placeholder', {
      model: {
        defaults: {
          tagName: 'div',
          draggable: false,
          droppable: true,
          attributes: {
            class: 'image-placeholder image-drop-zone',
          },
          traits: [
            {
              type: 'text',
              name: 'id',
              label: 'ID',
            },
            {
              type: 'text',
              name: 'title',
              label: 'Title',
            },
          ],
        },
        init() {
          this.on('change:attributes', () => {
            this.updatePlaceholderNumber();
          });
          this.updatePlaceholderNumber();
        },
        updatePlaceholderNumber() {
          // Update will be handled by view
        },
      },
      view: {
        init() {
          this.updatePlaceholderNumber();
        },
        updatePlaceholderNumber() {
          if (!this.el) return;
          
          let badge = this.el.querySelector('.placeholder-number');
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'placeholder-number';
            badge.style.cssText = `
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
            this.el.style.position = 'relative';
            this.el.appendChild(badge);
          }
          
          // Get index from sorted placeholders
          const allPlaceholders = Array.from(
            this.el.closest('.gjs-cv-canvas')?.querySelectorAll('.image-placeholder') || []
          );
          const sorted = Array.from(allPlaceholders).sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            if (Math.abs(rectA.top - rectB.top) > 10) {
              return rectA.top - rectB.top;
            }
            return rectA.left - rectB.left;
          });
          const index = sorted.indexOf(this.el) + 1;
          badge.textContent = index.toString();
        },
        events: {
          'dragover': 'handleDragOver',
          'drop': 'handleDrop',
        },
        handleDragOver(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const component = this.model;
          const hasImage = component.get('components').length > 0 && 
                          component.get('components').models.some(c => c.get('tagName') === 'img');
          
          // Check if this is the next empty placeholder (sequential mode)
          if (oneByOneMode) {
            const allPlaceholders = Array.from(
              this.el.closest('.gjs-cv-canvas')?.querySelectorAll('.image-placeholder') || []
            );
            const sorted = Array.from(allPlaceholders).sort((a, b) => {
              const rectA = a.getBoundingClientRect();
              const rectB = b.getBoundingClientRect();
              if (Math.abs(rectA.top - rectB.top) > 10) {
                return rectA.top - rectB.top;
              }
              return rectA.left - rectB.left;
            });
            
            // Find next empty placeholder
            let nextEmptyIndex = -1;
            for (let i = 0; i < sorted.length; i++) {
              const placeholder = sorted[i];
              // Check DOM directly instead of using GrapesJS component API
              const hasImg = placeholder.querySelector('img') !== null;
              if (!hasImg) {
                nextEmptyIndex = i;
                break;
              }
            }
            
            const currentIndex = sorted.indexOf(this.el);
            if (currentIndex === nextEmptyIndex && !hasImage) {
              this.el.classList.add('drag-over-active');
            } else {
              this.el.classList.remove('drag-over-active');
              this.el.classList.add('drag-over-disabled');
            }
          } else {
            if (!hasImage) {
              this.el.classList.add('drag-over-active');
            } else {
              this.el.classList.remove('drag-over-active');
            }
          }
        },
        handleDrop(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const component = this.model;
          const hasImage = component.get('components').length > 0 && 
                          component.get('components').models.some(c => c.get('tagName') === 'img');
          
          if (hasImage) {
            console.log('[GrapesJSCanvas] Placeholder already has image');
            return;
          }

          // Check sequential mode
          if (oneByOneMode) {
            const allPlaceholders = Array.from(
              this.el.closest('.gjs-cv-canvas')?.querySelectorAll('.image-placeholder') || []
            );
            const sorted = Array.from(allPlaceholders).sort((a, b) => {
              const rectA = a.getBoundingClientRect();
              const rectB = b.getBoundingClientRect();
              if (Math.abs(rectA.top - rectB.top) > 10) {
                return rectA.top - rectB.top;
              }
              return rectA.left - rectB.left;
            });
            
            // Find next empty placeholder
            let nextEmptyIndex = -1;
            for (let i = 0; i < sorted.length; i++) {
              const placeholder = sorted[i];
              // Check DOM directly instead of using GrapesJS component API
              const hasImg = placeholder.querySelector('img') !== null;
              if (!hasImg) {
                nextEmptyIndex = i;
                break;
              }
            }
            
            const currentIndex = sorted.indexOf(this.el);
            if (currentIndex !== nextEmptyIndex) {
              alert(`Please drop the image on placeholder #${nextEmptyIndex + 1} first.`);
              return;
            }
          }

          // Get dropped image data - try multiple methods
          let image = null;
          
          // Method 1: Try dataTransfer.getData (works if drag started inside iframe)
          try {
            const imageData = e.dataTransfer?.getData('application/epub-image');
            if (imageData) {
              image = JSON.parse(imageData);
              console.log('[GrapesJSCanvas] Got image from dataTransfer (application/epub-image):', image);
            }
          } catch (err) {
            console.warn('[GrapesJSCanvas] Error parsing application/epub-image:', err);
          }
          
          // Method 2: Try text/plain (fallback)
          if (!image) {
            try {
              const imageData = e.dataTransfer?.getData('text/plain');
              if (imageData) {
                image = JSON.parse(imageData);
                console.log('[GrapesJSCanvas] Got image from text/plain:', image);
              }
            } catch (err) {
              console.warn('[GrapesJSCanvas] Error parsing text/plain:', err);
            }
          }
          
          // Method 3: Check window global (bridge from parent document)
          if (!image && typeof window !== 'undefined' && window.currentDragImage) {
            image = window.currentDragImage;
            console.log('[GrapesJSCanvas] Got image from window.currentDragImage:', image);
          }
          
          if (image && onDropImage) {
            console.log('[GrapesJSCanvas] Calling onDropImage with placeholder:', component.get('attributes').id);
            onDropImage(component.get('attributes').id, image);
          } else {
            console.error('[GrapesJSCanvas] No image data found in drop event');
            console.log('[GrapesJSCanvas] dataTransfer types:', Array.from(e.dataTransfer?.types || []));
          }
        },
      },
    });

    setEditor(grapesEditor);
    editorRef.current = grapesEditor;
    
    // Mark as initialized now that editor is created
        setIsInitialized(true);
        
        // Check if there's a pending XHTML update to apply now that editor is ready
        if (pendingXhtmlUpdateRef.current && pendingXhtmlUpdateRef.current !== lastXhtmlRef.current) {
          console.log('[GrapesJSCanvas] Applying pending XHTML update after initialization');
          const pendingXhtml = pendingXhtmlUpdateRef.current;
          pendingXhtmlUpdateRef.current = null;
          
          // Use setTimeout to ensure editor is fully ready
          setTimeout(() => {
            if (isMountedRef.current && editor && pendingXhtml !== lastXhtmlRef.current) {
              // Trigger the update by setting a flag that the update useEffect can check
              // Actually, we'll just directly update here since we have the editor
              const parser = new DOMParser();
              const doc = parser.parseFromString(pendingXhtml, 'text/html');
              let bodyContent = '';
              if (doc.body) {
                bodyContent = doc.body.innerHTML;
              }
              const styles = doc.querySelector('style')?.innerHTML || '';
              
              if (bodyContent) {
                try {
                  editor.setComponents(bodyContent);
                  if (styles) {
                    editor.setStyle(styles);
                  }
                  
                  const canvas = editor.Canvas;
                  const frameEl = canvas?.getFrameEl();
                  const frameDoc = frameEl?.contentDocument || frameEl?.contentWindow?.document;
                  if (frameDoc && frameDoc.body) {
                    frameDoc.body.innerHTML = bodyContent;
                    if (styles) {
                      let styleEl = frameDoc.querySelector('style');
                      if (!styleEl) {
                        styleEl = frameDoc.createElement('style');
                        frameDoc.head.appendChild(styleEl);
                      }
                      styleEl.textContent = styles;
                    }
                  }
                  
                  editor.refresh();
                  lastXhtmlRef.current = pendingXhtml;
                  console.log('[GrapesJSCanvas] Pending XHTML update applied successfully');
                } catch (e) {
                  console.error('[GrapesJSCanvas] Error applying pending update:', e);
                }
              }
            }
          }, 100);
        }
    
    // Clear the initialization flag now that editor is created
    window.__grapesjsInitializing = false;
    
    // Notify parent that editor is ready (use setTimeout to avoid state updates during render)
    if (onEditorReady) {
      setTimeout(() => {
        onEditorReady(grapesEditor);
      }, 0);
    }

    return () => {
      isMountedRef.current = false; // Stop all pending callbacks
      
      // Clear initialization flags
      initializationStartedRef.current = false;
      window.__grapesjsInitializing = false;
      
      // Clear update timeout
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
      
      if (grapesEditor) {
        // Unsubscribe from events
        grapesEditor.off('canvas:mount');
        grapesEditor.off('load');
        grapesEditor.off('component:update', handleComponentChange);
        grapesEditor.off('component:add', handleComponentChange);
        grapesEditor.off('component:remove', handleComponentChange);
        grapesEditor.off('component:selected');
        grapesEditor.off('component:select');
        
        try {
          grapesEditor.destroy();
        } catch (e) {
          console.warn('[GrapesJSCanvas] Error destroying editor:', e);
        }
        setIsInitialized(false);
        setEditor(null);
        editorRef.current = null;
      }
    };
  }, []); // Only run once on mount - don't re-initialize when xhtml changes

  // CRITICAL: Bridge drag events from parent window to iframe
  useEffect(() => {
    if (!editor || !isInitialized) return;
    
    const canvas = editor.Canvas;
    if (!canvas) return;
    
    const frameEl = canvas.getFrameEl();
    if (!frameEl) return;
    
    console.log('[GrapesJSCanvas] Setting up iframe drag bridge');
    
    // Listen for drag events on the iframe to forward them inside
    const handleIframeDragOver = (e) => {
      // Allow drop on iframe
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    };
    
    const handleIframeDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('[GrapesJSCanvas] Drop detected on iframe');
      
      // Get image from window global (set by DraggableImage)
      const image = window.currentDragImage;
      if (!image) {
        console.warn('[GrapesJSCanvas] No image in window.currentDragImage');
        return;
      }
      
      console.log('[GrapesJSCanvas] Got image from window:', image);
      
      // Find the element under the drop point in the iframe
      const frameDoc = frameEl.contentDocument || frameEl.contentWindow?.document;
      if (!frameDoc) {
        console.warn('[GrapesJSCanvas] Cannot access frame document');
        return;
      }
      
      const iframeRect = frameEl.getBoundingClientRect();
      const x = e.clientX - iframeRect.left;
      const y = e.clientY - iframeRect.top;
      
      console.log('[GrapesJSCanvas] Drop coordinates in iframe:', x, y);
      
      const elementAtPoint = frameDoc.elementFromPoint(x, y);
      if (!elementAtPoint) {
        console.warn('[GrapesJSCanvas] No element at drop point');
        return;
      }
      
      const placeholder = elementAtPoint.closest('.image-placeholder');
      if (!placeholder) {
        console.warn('[GrapesJSCanvas] No placeholder found at drop point');
        return;
      }
      
      console.log('[GrapesJSCanvas] Found placeholder:', placeholder.id || placeholder.className);
      
      // Get placeholder ID
      const placeholderId = placeholder.id || placeholder.getAttribute('id');
      if (!placeholderId) {
        console.warn('[GrapesJSCanvas] Placeholder has no ID');
        return;
      }
      
      // Call onDropImage directly
      if (onDropImage) {
        console.log('[GrapesJSCanvas] Calling onDropImage with:', placeholderId, image);
        onDropImage(placeholderId, image);
      } else {
        console.warn('[GrapesJSCanvas] onDropImage callback not available');
      }
    };
    
    // Use capture phase to catch events before they bubble
    frameEl.addEventListener('dragover', handleIframeDragOver, true);
    frameEl.addEventListener('drop', handleIframeDrop, true);
    
    console.log('[GrapesJSCanvas] ✓ Iframe drag bridge listeners added (capture phase)');
    
    return () => {
      frameEl.removeEventListener('dragover', handleIframeDragOver, true);
      frameEl.removeEventListener('drop', handleIframeDrop, true);
    };
  }, [editor, isInitialized, onDropImage]);

  // CRITICAL: Load initial content when editor is ready and xhtml is available
  useEffect(() => {
    if (!editor || !xhtml || !isInitialized) {
      return;
    }
    
    console.log('[GrapesJSCanvas] Checking if content needs to be loaded', {
      hasEditor: !!editor,
      hasXhtml: !!xhtml,
      xhtmlLength: xhtml.length,
      isInitialized
    });
    
    // Use a timeout to ensure iframe is ready
    const timeoutId = setTimeout(() => {
      console.log('[GrapesJSCanvas] Timeout callback executing - checking iframe');
      
      // Check if iframe body is empty
      const canvas = editor.Canvas;
      if (!canvas) {
        console.warn('[GrapesJSCanvas] Canvas not available');
        return;
      }
      
      console.log('[GrapesJSCanvas] Canvas found, getting frame element');
      
      const frameEl = canvas.getFrameEl();
      if (!frameEl) {
        console.warn('[GrapesJSCanvas] Frame element not available');
        return;
      }
      
      try {
        const frameDoc = frameEl.contentDocument || frameEl.contentWindow?.document;
        if (!frameDoc) {
          console.warn('[GrapesJSCanvas] Frame document not accessible');
          return;
        }
        
        if (!frameDoc.body) {
          console.warn('[GrapesJSCanvas] Frame body not available');
          return;
        }
        
        const bodyHtml = frameDoc.body.innerHTML || '';
        console.log('[GrapesJSCanvas] Current iframe body length:', bodyHtml.length);
        
        // Always ensure visibility, even if content exists
        frameDoc.body.style.opacity = '1';
        frameDoc.body.style.visibility = 'visible';
        frameDoc.body.style.display = 'block';
        frameDoc.body.style.margin = '0';
        frameDoc.body.style.padding = '0';
        frameDoc.body.style.minHeight = '100%';
        frameDoc.body.style.width = '100%';
        
        // Check iframe document and html element
        if (frameDoc.documentElement) {
          frameDoc.documentElement.style.height = '100%';
          frameDoc.documentElement.style.width = '100%';
          frameDoc.documentElement.style.margin = '0';
          frameDoc.documentElement.style.padding = '0';
        }
        
        // Check computed styles
        const bodyComputed = window.getComputedStyle(frameDoc.body);
        console.log('[GrapesJSCanvas] Body computed styles:', {
          display: bodyComputed.display,
          visibility: bodyComputed.visibility,
          opacity: bodyComputed.opacity,
          height: bodyComputed.height,
          width: bodyComputed.width
        });
        
        // If body is empty or very small, load content
        if (bodyHtml.length < 100) {
          console.log('[GrapesJSCanvas] Iframe body is empty, loading content now');
          
          // Parse and set content
          const parser = new DOMParser();
          const doc = parser.parseFromString(xhtml, 'text/html');
          let bodyContent = '';
          if (doc.body) {
            bodyContent = doc.body.innerHTML;
          }
          const styles = doc.querySelector('style')?.innerHTML || '';
          
          console.log('[GrapesJSCanvas] Extracted body content length:', bodyContent.length, 'styles length:', styles.length);
          
          if (bodyContent) {
            // Set via API first
            try {
              editor.setComponents(bodyContent);
              console.log('[GrapesJSCanvas] Components set via API');
              if (styles) {
                editor.setStyle(styles);
                console.log('[GrapesJSCanvas] Styles set via API');
              }
            } catch (apiError) {
              console.warn('[GrapesJSCanvas] API method failed:', apiError);
            }
            
            // Also set directly in iframe (more reliable)
            frameDoc.body.innerHTML = bodyContent;
            console.log('[GrapesJSCanvas] Content set directly in iframe body');
            
            if (styles) {
              let styleEl = frameDoc.querySelector('style');
              if (!styleEl) {
                styleEl = frameDoc.createElement('style');
                frameDoc.head.appendChild(styleEl);
              }
              styleEl.textContent = styles;
              console.log('[GrapesJSCanvas] Styles injected into iframe head');
            }
            
            // Verify content was set
            const verifyBodyHtml = frameDoc.body.innerHTML || '';
            console.log('[GrapesJSCanvas] Verification - iframe body length after set:', verifyBodyHtml.length);
            
            editor.refresh();
            lastXhtmlRef.current = xhtml;
            initialContentLoadedRef.current = true; // Mark initial load as complete
            console.log('[GrapesJSCanvas] Content loaded successfully via useEffect (initial load)');
          } else {
            console.error('[GrapesJSCanvas] No body content extracted from XHTML!');
          }
        } else {
          console.log('[GrapesJSCanvas] Iframe body already has content');
          console.log('[GrapesJSCanvas] Body content preview:', bodyHtml.substring(0, 200));
          
          // Check if this is just GrapesJS default content (starts with <style> and scrollbar styles)
          // If so, we need to replace it with actual XHTML content
          if (bodyHtml.includes('::-webkit-scrollbar') || bodyHtml.length < 2000) {
            console.log('[GrapesJSCanvas] Detected GrapesJS default content, replacing with XHTML');
            
            // Parse and set actual XHTML content
            const parser = new DOMParser();
            const doc = parser.parseFromString(xhtml, 'text/html');
            let bodyContent = '';
            if (doc.body) {
              bodyContent = doc.body.innerHTML;
            }
            const styles = doc.querySelector('style')?.innerHTML || '';
            
            console.log('[GrapesJSCanvas] Extracted body content length:', bodyContent.length, 'styles length:', styles.length);
            
            if (bodyContent && bodyContent.length > 100) {
              // Set via API
              try {
                editor.setComponents(bodyContent);
                console.log('[GrapesJSCanvas] Components set via API');
                if (styles) {
                  editor.setStyle(styles);
                  console.log('[GrapesJSCanvas] Styles set via API');
                }
              } catch (apiError) {
                console.warn('[GrapesJSCanvas] API method failed:', apiError);
              }
              
              // Set directly in iframe
              frameDoc.body.innerHTML = bodyContent;
              console.log('[GrapesJSCanvas] XHTML content set directly in iframe body');
              
              if (styles) {
                let styleEl = frameDoc.querySelector('style');
                if (!styleEl) {
                  styleEl = frameDoc.createElement('style');
                  frameDoc.head.appendChild(styleEl);
                }
                styleEl.textContent = styles;
                console.log('[GrapesJSCanvas] Styles injected into iframe head');
              }
              
              // Ensure visibility
              frameDoc.body.style.opacity = '1';
              frameDoc.body.style.visibility = 'visible';
              frameDoc.body.style.display = 'block';
              frameDoc.body.style.margin = '0';
              frameDoc.body.style.padding = '0';
              
              // Verify
              const verifyBodyHtml = frameDoc.body.innerHTML || '';
              console.log('[GrapesJSCanvas] Verification - iframe body length after replacement:', verifyBodyHtml.length);
              console.log('[GrapesJSCanvas] New body content preview:', verifyBodyHtml.substring(0, 200));
              
              editor.refresh();
              lastXhtmlRef.current = xhtml;
              initialContentLoadedRef.current = true; // Mark initial load as complete
            }
          } else {
            // Content looks correct, but check if xhtml prop has changed
            // Extract current body content to compare with xhtml prop
            const currentBodyContent = frameDoc.body.innerHTML || '';
            
            // Parse xhtml prop to get expected body content
            const parser = new DOMParser();
            const expectedDoc = parser.parseFromString(xhtml, 'text/html');
            let expectedBodyContent = '';
            if (expectedDoc.body) {
              expectedBodyContent = expectedDoc.body.innerHTML;
            }
            
            // Compare lengths as a quick check (if very different, content needs update)
            const currentLength = currentBodyContent.length;
            const expectedLength = expectedBodyContent.length;
            const lengthDiff = Math.abs(currentLength - expectedLength);
            const significantDiff = lengthDiff > 100; // More than 100 chars difference
            
            console.log('[GrapesJSCanvas] Content exists, checking if update needed', {
              currentLength,
              expectedLength,
              lengthDiff,
              significantDiff
            });
            
            if (significantDiff || currentBodyContent !== expectedBodyContent) {
              // Content doesn't match xhtml prop, update it
              console.log('[GrapesJSCanvas] Content mismatch detected, updating from xhtml prop');
              
              if (expectedBodyContent && expectedBodyContent.length > 100) {
                // Set via API
                try {
                  editor.setComponents(expectedBodyContent);
                  const styles = expectedDoc.querySelector('style')?.innerHTML || '';
                  if (styles) {
                    editor.setStyle(styles);
                  }
                } catch (apiError) {
                  console.warn('[GrapesJSCanvas] API method failed:', apiError);
                }
                
                // Set directly in iframe
                frameDoc.body.innerHTML = expectedBodyContent;
                
                // Update styles in iframe head
                const styles = expectedDoc.querySelector('style')?.innerHTML || '';
                if (styles) {
                  let styleEl = frameDoc.querySelector('style');
                  if (!styleEl) {
                    styleEl = frameDoc.createElement('style');
                    frameDoc.head.appendChild(styleEl);
                  }
                  styleEl.textContent = styles;
                }
                
            editor.refresh();
                lastXhtmlRef.current = xhtml;
                console.log('[GrapesJSCanvas] Content updated to match xhtml prop');
              }
            } else {
              // Content matches, just ensure visibility
              console.log('[GrapesJSCanvas] Content matches xhtml prop, ensuring visibility');
            }
            
            editor.refresh();
            initialContentLoadedRef.current = true; // Mark initial load as complete
            lastXhtmlRef.current = xhtml; // Update last known xhtml
            
            // Ensure visibility
              frameDoc.body.style.display = 'block';
          }
        }
      } catch (e) {
        console.error('[GrapesJSCanvas] Error checking/loading content:', e);
      }
    }, 500); // Give iframe time to be ready
    
    return () => clearTimeout(timeoutId);
  }, [editor, xhtml, isInitialized]); // Keep xhtml in deps to ensure it's available, but use ref to prevent re-running

  // Update editor content when xhtml changes externally
  useEffect(() => {
    console.log('[GrapesJSCanvas] Update useEffect triggered', {
      xhtmlLength: xhtml?.length || 0,
      lastXhtmlLength: lastXhtmlRef.current?.length || 0,
      hasEditor: !!editor,
      isInitialized,
      footerModifying: !!window.__footerModifying
    });
    
    // Don't update if footer is currently modifying (prevents loops)
    if (window.__footerModifying) {
      console.log('[GrapesJSCanvas] Skipping update - footer is modifying');
      return;
    }
    
    if (!isMountedRef.current || !editor || !xhtml || !isInitialized) {
      console.log('[GrapesJSCanvas] Skipping update - not ready, storing for later', {
        isMounted: isMountedRef.current,
        hasEditor: !!editor,
        hasXhtml: !!xhtml,
        isInitialized
      });
      // Store the xhtml update to apply once editor is ready
      if (xhtml && xhtml !== lastXhtmlRef.current) {
        pendingXhtmlUpdateRef.current = xhtml;
      }
      return;
    }
    
    // Skip if this is the same as what we last set (unless we have a pending update)
    if (xhtml === lastXhtmlRef.current && !pendingXhtmlUpdateRef.current) {
      console.log('[GrapesJSCanvas] Skipping update - xhtml unchanged', {
        xhtmlLength: xhtml.length,
        lastXhtmlLength: lastXhtmlRef.current.length || 0
      });
      return;
    }
    
    // Use pending update if it exists and is different, otherwise use current xhtml
    const xhtmlToApply = pendingXhtmlUpdateRef.current || xhtml;
    
    console.log('[GrapesJSCanvas] XHTML changed, scheduling update', {
      xhtmlLength: xhtml.length,
      pendingLength: pendingXhtmlUpdateRef.current?.length || 0,
      lastXhtmlLength: lastXhtmlRef.current.length || 0,
      usingPending: !!pendingXhtmlUpdateRef.current
    });
    
    // Debounce to prevent rapid updates and blinking
    const timeoutId = setTimeout(() => {
      // Check flag again in timeout (footer might still be modifying)
      if (window.__footerModifying) {
        return;
      }
      
      // Determine which xhtml to apply (pending takes precedence, use current xhtml if no pending)
      const xhtmlToApplyInTimeout = pendingXhtmlUpdateRef.current || xhtml;
      
      // Check again if component is still mounted
      if (!isMountedRef.current || !editor || !xhtmlToApplyInTimeout || xhtmlToApplyInTimeout === lastXhtmlRef.current) {
        return;
      }
      
      // Check if editor model is still available
      if (!editor.getModel() || typeof editor.setComponents !== 'function') {
        console.warn('[GrapesJSCanvas] Editor not ready for update, storing as pending');
        if (xhtmlToApplyInTimeout && xhtmlToApplyInTimeout !== lastXhtmlRef.current) {
          pendingXhtmlUpdateRef.current = xhtmlToApplyInTimeout;
        }
        return;
      }
      
      try {
        // Extract body content from XHTML to apply - match the logic used in initial load
        const parser = new DOMParser();
        const newDoc = parser.parseFromString(xhtmlToApplyInTimeout, 'text/html');
        let newBodyContent = '';
        
        // Extract body content (this will include xhtml-content-wrapper div)
        if (newDoc.body) {
          newBodyContent = newDoc.body.innerHTML;
        } else if (newDoc.documentElement) {
          newBodyContent = newDoc.documentElement.innerHTML;
        }
        
        console.log('[GrapesJSCanvas] Updating editor content from external change', {
          newBodyLength: newBodyContent.length,
          xhtmlLength: xhtmlToApplyInTimeout.length,
          lastXhtmlLength: lastXhtmlRef.current.length || 0,
          wasPending: !!pendingXhtmlUpdateRef.current
        });
          
          // Set flag to prevent event handlers from firing
          isUpdatingFromExternalRef.current = true;
          
        const styles = newDoc.querySelector('style')?.innerHTML || '';
        
        // Update editor with new content - use both API and direct iframe update (like initial load)
        try {
          editor.setComponents(newBodyContent);
          if (styles) {
            editor.setStyle(styles);
          }
          
          // Also set directly in iframe (more reliable, matches initial load approach)
          const canvas = editor.Canvas;
          if (canvas) {
            const frameEl = canvas.getFrameEl();
            if (frameEl) {
              const frameDoc = frameEl.contentDocument || frameEl.contentWindow?.document;
              if (frameDoc && frameDoc.body) {
                frameDoc.body.innerHTML = newBodyContent;
                
                // Update styles in iframe head
          if (styles) {
                  let styleEl = frameDoc.querySelector('style');
                  if (!styleEl) {
                    styleEl = frameDoc.createElement('style');
                    frameDoc.head.appendChild(styleEl);
                  }
                  styleEl.textContent = styles;
                }
              }
            }
          }
          
          // Refresh editor to ensure changes are visible
          editor.refresh();
        } catch (updateError) {
          console.error('[GrapesJSCanvas] Error updating editor:', updateError);
          throw updateError; // Re-throw to be caught by outer catch
          }
          
        // Update last known value AFTER successful update (use the xhtml we actually applied)
        lastXhtmlRef.current = xhtmlToApplyInTimeout;
        pendingXhtmlUpdateRef.current = null; // Clear pending update since we've applied it
          
          // Reset flag after a short delay to allow editor to process
          setTimeout(() => {
            if (isMountedRef.current) {
              isUpdatingFromExternalRef.current = false;
            }
          }, 200);
      } catch (e) {
        console.error('[GrapesJSCanvas] Error updating content:', e);
        if (isMountedRef.current) {
          isUpdatingFromExternalRef.current = false;
        }
      }
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [xhtml, editor, isInitialized]);

  // Handle edit mode changes
  // Note: GrapesJS doesn't have a setMode method
  // For our use case, we're using GrapesJS primarily for accurate drop detection
  // Edit mode is handled at the parent component level (EpubImageEditor)
  // Edit mode changes are handled by the parent component - no action needed here

  // Mark placeholders in the editor
  useEffect(() => {
    if (editor && placeholders.length > 0 && isInitialized) {
      console.log('[GrapesJSCanvas] Marking placeholders:', placeholders.length);
      
      // CRITICAL: Query placeholders from GrapesJS iframe document, not main document
      try {
        const canvas = editor.Canvas;
        if (canvas) {
          const doc = canvas.getDocument();
          if (doc) {
            const domPlaceholders = doc.querySelectorAll('.image-placeholder');
            console.log(`[GrapesJSCanvas] Found ${domPlaceholders.length} placeholders inside GrapesJS iframe`);
          }
        }
      } catch (e) {
        console.warn('[GrapesJSCanvas] Could not query iframe document:', e);
      }
      
      // Wait for editor to be ready
      setTimeout(() => {
        if (!editor || !editor.Components) {
          console.warn('[GrapesJSCanvas] Editor or Components not available');
          return;
        }
        
        placeholders.forEach((placeholder) => {
          try {
            // Try to get component by ID
            let component = null;
            if (editor.Components && typeof editor.Components.getComponent === 'function') {
              component = editor.Components.getComponent(`#${placeholder.id}`);
            }
            
            if (component) {
              // Update existing component
              component.set('type', 'image-placeholder');
              component.addAttributes({
                class: 'image-placeholder image-drop-zone',
                id: placeholder.id,
                title: placeholder.title || 'Drop image here',
              });
            } else {
              // Try to find by traversing components
              const wrapper = editor.getWrapper();
              if (wrapper) {
                const findComponent = (comp) => {
                  if (!comp || !comp.get) return null;
                  try {
                    const attrs = comp.get('attributes');
                    if (attrs && attrs.id === placeholder.id) {
                      return comp;
                    }
                    const children = comp.get('components');
                    if (children && children.models) {
                      for (const child of children.models) {
                        const found = findComponent(child);
                        if (found) return found;
                      }
                    }
                  } catch (e) {
                    console.warn('[GrapesJSCanvas] Error finding component:', e);
                  }
                  return null;
                };
                
                const found = findComponent(wrapper);
                if (found) {
                  found.set('type', 'image-placeholder');
                  found.addAttributes({
                    class: 'image-placeholder image-drop-zone',
                    id: placeholder.id,
                    title: placeholder.title || 'Drop image here',
                  });
                }
              }
            }
          } catch (e) {
            console.warn(`[GrapesJSCanvas] Error processing placeholder ${placeholder.id}:`, e);
          }
        });
      }, 500);
    }
  }, [editor, placeholders, isInitialized]);

  // Add container-level drop handler as backup
  useEffect(() => {
    if (!containerRef.current) {
      console.warn('[GrapesJSCanvas] Container ref not available for drop handler');
      return;
    }
    
    if (!onDropImage) {
      console.warn('[GrapesJSCanvas] onDropImage not available for drop handler');
      return;
    }
    
    const container = containerRef.current;
    
    const handleContainerDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      console.log('[GrapesJSCanvas] Container dragover');
    };
    
    const handleContainerDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[GrapesJSCanvas] Container dragenter, currentDragImage:', !!window.currentDragImage);
    };
    
    const handleContainerDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('[GrapesJSCanvas] Drop detected on container');
      console.log('[GrapesJSCanvas] window.currentDragImage:', window.currentDragImage);
      
      // Get image from window global
      const image = window.currentDragImage;
      if (!image) {
        console.warn('[GrapesJSCanvas] No image in window.currentDragImage');
        return;
      }
      
      console.log('[GrapesJSCanvas] Got image from window (container drop):', image);
      
      // Find the iframe
      if (!editor) {
        console.warn('[GrapesJSCanvas] No editor available');
        return;
      }
      
      const canvas = editor.Canvas;
      if (!canvas) {
        console.warn('[GrapesJSCanvas] No canvas available');
        return;
      }
      
      const frameEl = canvas.getFrameEl();
      if (!frameEl) {
        console.warn('[GrapesJSCanvas] No frame element');
        return;
      }
      
      const frameDoc = frameEl.contentDocument || frameEl.contentWindow?.document;
      if (!frameDoc) {
        console.warn('[GrapesJSCanvas] Cannot access frame document (container drop)');
        return;
      }
      
      // Get drop coordinates relative to iframe
      const iframeRect = frameEl.getBoundingClientRect();
      const x = e.clientX - iframeRect.left;
      const y = e.clientY - iframeRect.top;
      
      console.log('[GrapesJSCanvas] Drop coordinates (container):', x, y, 'iframe rect:', iframeRect);
      
      // Find element at drop point
      const elementAtPoint = frameDoc.elementFromPoint(x, y);
      if (!elementAtPoint) {
        console.warn('[GrapesJSCanvas] No element at drop point (container)');
        return;
      }
      
      console.log('[GrapesJSCanvas] Element at point:', elementAtPoint.tagName, elementAtPoint.className, elementAtPoint.id);
      
      const placeholder = elementAtPoint.closest('.image-placeholder');
      if (!placeholder) {
        console.warn('[GrapesJSCanvas] No placeholder found (container), element:', elementAtPoint.tagName, elementAtPoint.className);
        // Try to find all placeholders and log them
        const allPlaceholders = frameDoc.querySelectorAll('.image-placeholder');
        console.log('[GrapesJSCanvas] Available placeholders in iframe:', allPlaceholders.length);
        allPlaceholders.forEach((p, i) => {
          const rect = p.getBoundingClientRect();
          console.log(`[GrapesJSCanvas] Placeholder ${i}:`, p.id, 'rect:', rect);
        });
        return;
      }
      
      const placeholderId = placeholder.id || placeholder.getAttribute('id');
      if (!placeholderId) {
        console.warn('[GrapesJSCanvas] Placeholder has no ID (container)');
        return;
      }
      
      console.log('[GrapesJSCanvas] Found placeholder (container):', placeholderId);
      console.log('[GrapesJSCanvas] Calling onDropImage (container):', placeholderId, image);
      onDropImage(placeholderId, image);
    };
    
    container.addEventListener('dragenter', handleContainerDragEnter);
    container.addEventListener('dragover', handleContainerDragOver);
    container.addEventListener('drop', handleContainerDrop);
    
    console.log('[GrapesJSCanvas] Container drop handlers added');
    
    return () => {
      container.removeEventListener('dragenter', handleContainerDragEnter);
      container.removeEventListener('dragover', handleContainerDragOver);
      container.removeEventListener('drop', handleContainerDrop);
    };
  }, [editor, onDropImage]);

  return (
    <div 
      ref={containerRef} 
      className="grapesjs-canvas-container"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    />
  );
};

export default GrapesJSCanvas;
