import React, { useState, useEffect, useRef, useCallback } from 'react';
import './TextFormattingToolbar.css';

const TextFormattingToolbar = ({ editMode }) => {
  const [fontSize, setFontSize] = useState('16');
  const [fontColor, setFontColor] = useState('#000000');
  const [isBold, setIsBold] = useState(false);
  const [hasSavedSelection, setHasSavedSelection] = useState(false);
  const savedSelectionRef = useRef(null);
  const savedSelectionDataRef = useRef(null); // Store selection metadata
  const toolbarRef = useRef(null);

  // Helper function to restore saved selection - defined before useEffect so it's accessible
  const restoreSelection = useCallback(() => {
    const selection = window.getSelection();
    
    // First try current selection
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!range.collapsed) {
        console.log('[TextFormattingToolbar] Using current selection');
        return range; // Current selection is valid
      }
    }
    
    // Try to restore from saved Range object first
    if (savedSelectionRef.current) {
      try {
        const savedRange = savedSelectionRef.current;
        const startContainer = savedRange.startContainer;
        const endContainer = savedRange.endContainer;
        
        if (document.contains(startContainer) && document.contains(endContainer)) {
          try {
            selection.removeAllRanges();
            selection.addRange(savedRange.cloneRange());
            console.log('[TextFormattingToolbar] ✓ Restored from Range object');
            return savedRange;
          } catch (err) {
            console.warn('[TextFormattingToolbar] Range restore failed, trying metadata:', err);
          }
        }
      } catch (err) {
        console.warn('[TextFormattingToolbar] Range object invalid, trying metadata:', err);
      }
    }
    
    // Fallback: Try to restore from metadata
    if (savedSelectionDataRef.current) {
      try {
        const data = savedSelectionDataRef.current;
        
        // Try direct containers first
        if (document.contains(data.startContainer) && document.contains(data.endContainer)) {
          try {
            const newRange = document.createRange();
            newRange.setStart(data.startContainer, data.startOffset);
            newRange.setEnd(data.endContainer, data.endOffset);
            selection.removeAllRanges();
            selection.addRange(newRange);
            console.log('[TextFormattingToolbar] ✓ Restored from metadata');
            savedSelectionRef.current = newRange.cloneRange();
            return newRange;
          } catch (err) {
            console.warn('[TextFormattingToolbar] Metadata restore failed:', err);
          }
        }
      } catch (err) {
        console.error('[TextFormattingToolbar] Error restoring from metadata:', err);
      }
    }
    
    // Clear invalid selection
    savedSelectionRef.current = null;
    savedSelectionDataRef.current = null;
    setHasSavedSelection(false);
    
    return null;
  }, []);

  // Helper to get node path for finding it later - defined first
  const getNodePath = useCallback((node) => {
    const path = [];
    let current = node;
    while (current && current !== document.body) {
      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) {
        index++;
        sibling = sibling.previousSibling;
      }
      path.unshift({ node: current, index });
      current = current.parentNode;
    }
    return path;
  }, []);

  // Save selection data (metadata) for more reliable restoration - defined after getNodePath
  const saveSelectionData = useCallback((range) => {
    if (!range || range.collapsed) return;
    
    try {
      // Store both Range object and metadata
      savedSelectionRef.current = range.cloneRange();
      
      // Store metadata for more reliable restoration
      savedSelectionDataRef.current = {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
        text: range.toString(),
        // Store path to nodes for finding them later
        startPath: getNodePath(range.startContainer),
        endPath: getNodePath(range.endContainer)
      };
      
      setHasSavedSelection(true);
      console.log('[TextFormattingToolbar] Selection saved with metadata:', savedSelectionDataRef.current);
    } catch (err) {
      console.error('Error saving selection:', err);
    }
  }, [getNodePath]);

  // Save selection on mouseup (when user finishes selecting) - defined outside useEffect
  const handleMouseUp = useCallback(() => {
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed) {
          saveSelectionData(range);
        }
      }
    }, 10); // Small delay to ensure selection is complete
  }, [saveSelectionData]);

  // Prevent selection loss when clicking on toolbar - defined outside useEffect
  const handleToolbarMouseDown = useCallback((e) => {
    // Always restore selection when interacting with toolbar
    restoreSelection();
    
    // Don't prevent default on interactive elements (select, input, button)
    // They need to work normally
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
      return;
    }
    // For other elements, prevent default to keep selection
    e.preventDefault();
  }, [restoreSelection]);

  // Update toolbar state based on current selection
  useEffect(() => {
    if (!editMode) return;

    const saveSelection = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        // Save the selection if it's not collapsed (has actual text selected)
        if (!range.collapsed) {
          try {
            // Clone the range to save it
            saveSelectionData(range);
            console.log('[TextFormattingToolbar] Selection saved');
          } catch (err) {
            console.error('Error saving selection:', err);
          }
        } else {
          // If selection is collapsed, don't clear saved selection - keep the last valid one
          console.log('[TextFormattingToolbar] Selection collapsed, keeping previous saved selection');
        }
      }
    };

    const updateToolbarState = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        // No current selection - don't clear saved one, it might still be valid
        return;
      }

      const range = selection.getRangeAt(0);
      
      // Save the selection if it's not collapsed (has actual text selected)
      if (!range.collapsed) {
        saveSelection();
      }
      
      if (range.collapsed) {
        // No selection, check parent element
        const container = range.commonAncestorContainer;
        const element = container.nodeType === Node.TEXT_NODE 
          ? container.parentElement 
          : container;
        
        if (element) {
          const computedStyle = window.getComputedStyle(element);
          const size = computedStyle.fontSize;
          const color = computedStyle.color;
          const fontWeight = computedStyle.fontWeight;
          
          setFontSize(size ? parseInt(size) : 16);
          setFontColor(rgbToHex(color) || '#000000');
          setIsBold(parseInt(fontWeight) >= 600 || fontWeight === 'bold');
        }
      } else {
        // Has selection, check first selected element
        const container = range.commonAncestorContainer;
        const element = container.nodeType === Node.TEXT_NODE 
          ? container.parentElement 
          : container;
        
        if (element) {
          const computedStyle = window.getComputedStyle(element);
          const size = computedStyle.fontSize;
          const color = computedStyle.color;
          const fontWeight = computedStyle.fontWeight;
          
          setFontSize(size ? parseInt(size) : 16);
          setFontColor(rgbToHex(color) || '#000000');
          setIsBold(parseInt(fontWeight) >= 600 || fontWeight === 'bold');
        }
      }
    };

    // Update on selection change - save selection aggressively
    const handleSelectionChange = () => {
      updateToolbarState();
      // Also save selection immediately on any selection change
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed) {
          try {
            saveSelectionData(range);
            console.log('[TextFormattingToolbar] Selection saved on selectionchange');
          } catch (err) {
            console.error('Error saving selection:', err);
          }
        }
      }
    };

    // CRITICAL: Save selection before ANY click on toolbar (capture phase - runs BEFORE other handlers)
    const handleDocumentMouseDown = (e) => {
      // Only save if clicking on toolbar controls
      if (toolbarRef.current && toolbarRef.current.contains(e.target)) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (!range.collapsed) {
            saveSelectionData(range);
            console.log('[TextFormattingToolbar] Selection saved on document mousedown (toolbar click)');
          }
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('click', updateToolbarState);
    document.addEventListener('keyup', updateToolbarState);
    document.addEventListener('mousedown', handleDocumentMouseDown, true); // Use capture phase to run FIRST
    
    // Also listen for mousemove to CONTINUOUSLY save selection when mouse is over toolbar
    const handleMouseMove = (e) => {
      // If mouse is over toolbar, continuously save the current selection
      if (toolbarRef.current && toolbarRef.current.contains(e.target)) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (!range.collapsed) {
            saveSelectionData(range);
            console.log('[TextFormattingToolbar] Selection saved on mousemove (toolbar)');
          }
        }
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);

    // Add event listener to toolbar container using ref
    const toolbar = toolbarRef.current;
      if (toolbar) {
        toolbar.addEventListener('mousedown', handleToolbarMouseDown);
      }

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('click', updateToolbarState);
      document.removeEventListener('keyup', updateToolbarState);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
      if (toolbar) {
        toolbar.removeEventListener('mousedown', handleToolbarMouseDown);
      }
    };
  }, [editMode, handleToolbarMouseDown, handleMouseUp, restoreSelection, saveSelectionData]);

  // Convert RGB to hex
  const rgbToHex = (rgb) => {
    if (!rgb) return null;
    if (rgb.startsWith('#')) return rgb;
    
    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return null;
  };

  // Helper to find text in DOM after re-render
  const findTextInDOM = useCallback((searchText, startOffset, endOffset) => {
    if (!searchText) return null;
    
    // Walk through all text nodes and find the one containing our text
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent || '';
      // Check if this node contains our search text at the expected position
      if (text.length >= endOffset && text.substring(startOffset, endOffset) === searchText) {
        try {
          const range = document.createRange();
          range.setStart(node, startOffset);
          range.setEnd(node, endOffset);
          return range;
        } catch (err) {
          console.warn('[TextFormattingToolbar] Error creating range from found node:', err);
        }
      }
      // Also check if the text appears anywhere in this node
      const index = text.indexOf(searchText);
      if (index !== -1) {
        try {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + searchText.length);
          return range;
        } catch (err) {
          console.warn('[TextFormattingToolbar] Error creating range from found text:', err);
        }
      }
    }
    return null;
  }, []);

  const handleFontSizeChange = (e) => {
    const size = e.target.value;
    setFontSize(size);
    
    // Get saved selection data IMMEDIATELY (before any DOM updates)
    const data = savedSelectionDataRef.current;
    const savedRange = savedSelectionRef.current;
    const savedText = data?.text || '';
    
    console.log('[TextFormattingToolbar] handleFontSizeChange - saved text:', savedText);
    
    if (!data && !savedRange) {
      console.warn('[TextFormattingToolbar] No saved selection for font size');
      return;
    }
    
    // Use setTimeout to handle DOM re-renders
    setTimeout(() => {
      let range = null;
      const selection = window.getSelection();
      
      try {
        // First try: Use saved Range object if still valid
        if (savedRange && document.contains(savedRange.startContainer) && document.contains(savedRange.endContainer)) {
          range = savedRange.cloneRange();
          console.log('[TextFormattingToolbar] Using saved Range object');
        } 
        // Second try: Create range from metadata if containers still exist
        else if (data && document.contains(data.startContainer) && document.contains(data.endContainer)) {
          range = document.createRange();
          range.setStart(data.startContainer, data.startOffset);
          range.setEnd(data.endContainer, data.endOffset);
          console.log('[TextFormattingToolbar] Created range from metadata');
        }
        // Third try: Find text in DOM after re-render
        else if (savedText && data) {
          range = findTextInDOM(savedText, data.startOffset, data.endOffset);
          if (range) {
            console.log('[TextFormattingToolbar] Found text in DOM after re-render');
          }
        }
        
        if (!range || range.collapsed) {
          console.warn('[TextFormattingToolbar] Saved selection is invalid or collapsed, savedText:', savedText);
          // Last resort: try to find any occurrence of the text
          if (savedText) {
            range = findTextInDOM(savedText, 0, savedText.length);
            if (range) {
              console.log('[TextFormattingToolbar] Found text using fallback search');
            }
          }
          if (!range || range.collapsed) {
            return;
          }
        }
        
        // Restore selection to apply formatting
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Has selection - wrap in span with font-size
        const span = document.createElement('span');
        span.style.fontSize = `${size}px`;
        
        try {
          range.surroundContents(span);
        } catch (err) {
          // If surroundContents fails, extract and wrap
          const contents = range.extractContents();
          span.appendChild(contents);
          range.insertNode(span);
        }
        
        // Update selection to span
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        selection.addRange(newRange);
        
        // Re-save the selection
        saveSelectionData(newRange);
        
        // Trigger input event to update XHTML
        const inputEvent = new Event('input', { bubbles: true });
        if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
          range.commonAncestorContainer.parentElement?.dispatchEvent(inputEvent);
        } else {
          range.commonAncestorContainer.dispatchEvent(inputEvent);
        }
      } catch (err) {
        console.error('[TextFormattingToolbar] Error applying font size:', err);
      }
    }, 50); // Increased delay to allow DOM to update
  };

  const handleFontColorChange = (e) => {
    const color = e.target.value;
    setFontColor(color);
    
    // Get saved selection data IMMEDIATELY (before any DOM updates)
    const data = savedSelectionDataRef.current;
    const savedRange = savedSelectionRef.current;
    const savedText = data?.text || '';
    
    console.log('[TextFormattingToolbar] handleFontColorChange - saved text:', savedText);
    
    if (!data && !savedRange) {
      console.warn('[TextFormattingToolbar] No saved selection for font color');
      return;
    }
    
    // Use multiple timeouts to handle DOM re-renders
    setTimeout(() => {
      let range = null;
      const selection = window.getSelection();
      
      try {
        // First try: Use saved Range object if still valid
        if (savedRange && document.contains(savedRange.startContainer) && document.contains(savedRange.endContainer)) {
          range = savedRange.cloneRange();
          console.log('[TextFormattingToolbar] Using saved Range object');
        } 
        // Second try: Create range from metadata if containers still exist
        else if (data && document.contains(data.startContainer) && document.contains(data.endContainer)) {
          range = document.createRange();
          range.setStart(data.startContainer, data.startOffset);
          range.setEnd(data.endContainer, data.endOffset);
          console.log('[TextFormattingToolbar] Created range from metadata');
        }
        // Third try: Find text in DOM after re-render
        else if (savedText && data) {
          range = findTextInDOM(savedText, data.startOffset, data.endOffset);
          if (range) {
            console.log('[TextFormattingToolbar] Found text in DOM after re-render');
          }
        }
        
        if (!range || range.collapsed) {
          console.warn('[TextFormattingToolbar] Saved selection is invalid or collapsed, savedText:', savedText);
          // Last resort: try to find any occurrence of the text
          if (savedText) {
            range = findTextInDOM(savedText, 0, savedText.length);
            if (range) {
              console.log('[TextFormattingToolbar] Found text using fallback search');
            }
          }
          if (!range || range.collapsed) {
            return;
          }
        }
        
        // Restore selection to apply formatting
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Small delay to ensure selection is active
        setTimeout(() => {
          // Apply font color using execCommand
          const success = document.execCommand('foreColor', false, color);
          console.log('[TextFormattingToolbar] execCommand foreColor result:', success);
          
          // Trigger input event to update XHTML
          document.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Re-save the selection after applying formatting
          if (selection && selection.rangeCount > 0) {
            const updatedRange = selection.getRangeAt(0);
            if (!updatedRange.collapsed) {
              saveSelectionData(updatedRange);
            }
          }
        }, 10);
      } catch (err) {
        console.error('[TextFormattingToolbar] Error applying font color:', err);
      }
    }, 50); // Increased delay to allow DOM to update
  };

  const handleBoldToggle = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    
    const newBoldState = !isBold;
    setIsBold(newBoldState);
    
    console.log('[TextFormattingToolbar] handleBoldToggle called');
    console.log('[TextFormattingToolbar] savedSelectionDataRef.current:', savedSelectionDataRef.current);
    console.log('[TextFormattingToolbar] savedSelectionRef.current:', savedSelectionRef.current);
    
    // Get saved selection IMMEDIATELY (before any DOM updates)
    const data = savedSelectionDataRef.current;
    const savedRange = savedSelectionRef.current;
    const savedText = data?.text || '';
    
    console.log('[TextFormattingToolbar] handleBoldToggle - saved text:', savedText);
    
    if (!data && !savedRange) {
      console.warn('[TextFormattingToolbar] No saved selection for bold');
      return;
    }
    
    // Use setTimeout to handle DOM re-renders
    setTimeout(() => {
      let range = null;
      const selection = window.getSelection();
      
      try {
        // First try: Use saved Range object if still valid
        if (savedRange && document.contains(savedRange.startContainer) && document.contains(savedRange.endContainer)) {
          range = savedRange.cloneRange();
          console.log('[TextFormattingToolbar] Using saved Range object');
        } 
        // Second try: Create range from metadata if containers still exist
        else if (data && document.contains(data.startContainer) && document.contains(data.endContainer)) {
          range = document.createRange();
          range.setStart(data.startContainer, data.startOffset);
          range.setEnd(data.endContainer, data.endOffset);
          console.log('[TextFormattingToolbar] Created range from metadata');
        }
        // Third try: Find text in DOM after re-render
        else if (savedText && data) {
          range = findTextInDOM(savedText, data.startOffset, data.endOffset);
          if (range) {
            console.log('[TextFormattingToolbar] Found text in DOM after re-render');
          }
        }
        
        if (!range || range.collapsed) {
          console.warn('[TextFormattingToolbar] Saved selection is invalid or collapsed, savedText:', savedText);
          // Last resort: try to find any occurrence of the text
          if (savedText) {
            range = findTextInDOM(savedText, 0, savedText.length);
            if (range) {
              console.log('[TextFormattingToolbar] Found text using fallback search');
            }
          }
          if (!range || range.collapsed) {
            return;
          }
        }
        
        console.log('[TextFormattingToolbar] Restoring selection, text:', range.toString());
        
        // Restore selection to apply formatting
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Small delay to ensure selection is active
        setTimeout(() => {
          // Apply bold using execCommand
          const success = document.execCommand('bold', false, null);
          console.log('[TextFormattingToolbar] execCommand bold result:', success);
          
          // Trigger input event to update XHTML
          document.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Re-save the selection after applying formatting
          if (selection && selection.rangeCount > 0) {
            const updatedRange = selection.getRangeAt(0);
            if (!updatedRange.collapsed) {
              saveSelectionData(updatedRange);
              console.log('[TextFormattingToolbar] Re-saved selection after formatting');
            }
          }
        }, 10);
      } catch (err) {
        console.error('[TextFormattingToolbar] Error applying bold:', err);
      }
    }, 50); // Increased delay to allow DOM to update
  };

  if (!editMode) {
    return null;
  }

  return (
    <div 
      ref={toolbarRef}
      className="text-formatting-toolbar"
      onMouseDown={(e) => {
        // Restore selection when clicking on toolbar (but not on interactive elements)
        if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
          restoreSelection();
        }
      }}
      onMouseEnter={() => {
        // Restore selection when mouse enters toolbar area - use requestAnimationFrame for immediate restoration
        console.log('[TextFormattingToolbar] Mouse entered toolbar, restoring selection');
        requestAnimationFrame(() => {
          restoreSelection();
        });
      }}
      onMouseOver={(e) => {
        // Also restore on mouseover (more frequent) - but only if selection is lost
        if (savedSelectionRef.current) {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0 || selection.getRangeAt(0).collapsed) {
            requestAnimationFrame(() => {
              restoreSelection();
            });
          }
        }
      }}
    >
      <div className="toolbar-hint" style={{ fontSize: '11px', color: hasSavedSelection ? '#4CAF50' : '#666', fontStyle: 'italic', marginRight: '16px', fontWeight: hasSavedSelection ? '600' : 'normal' }}>
        💡 {hasSavedSelection ? '✓ Selection preserved - format away!' : 'Select text or click on text to format'}
      </div>
      <div className="toolbar-group">
        <label htmlFor="font-size-select" title="Select text first, then choose font size">Font Size:</label>
        <select
          id="font-size-select"
          value={fontSize}
          onMouseDown={(e) => {
            e.stopPropagation();
            // CRITICAL: Save current selection BEFORE click clears it
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              if (!range.collapsed) {
                saveSelectionData(range);
                console.log('[TextFormattingToolbar] Selection saved on mousedown (select)');
              }
            }
          }}
          onFocus={() => {
            // Save selection when focused (before change event)
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              if (!range.collapsed) {
                saveSelectionData(range);
                console.log('[TextFormattingToolbar] Selection saved on focus (select)');
              }
            }
          }}
          onMouseEnter={() => {
            // Save selection when mouse enters (in case it's still active)
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              if (!range.collapsed) {
                saveSelectionData(range);
              }
            }
          }}
          onChange={handleFontSizeChange}
          className="toolbar-select"
          title="Select text first, then choose font size"
        >
          <option value="10">10px</option>
          <option value="12">12px</option>
          <option value="14">14px</option>
          <option value="16">16px</option>
          <option value="18">18px</option>
          <option value="20">20px</option>
          <option value="24">24px</option>
          <option value="28">28px</option>
          <option value="32">32px</option>
          <option value="36">36px</option>
          <option value="48">48px</option>
        </select>
      </div>

      <div className="toolbar-group">
        <label htmlFor="font-color-picker" title="Select text first, then choose color">Font Color:</label>
        <div className="color-picker-wrapper">
          <input
            id="font-color-picker"
            type="color"
            value={fontColor}
            onChange={handleFontColorChange}
            onMouseDown={(e) => {
              e.stopPropagation();
              // CRITICAL: Save current selection BEFORE click clears it
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (!range.collapsed) {
                  saveSelectionData(range);
                  console.log('[TextFormattingToolbar] Selection saved on mousedown (color)');
                }
              }
            }}
            onFocus={() => {
              // Save selection when focused (before change event)
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (!range.collapsed) {
                  saveSelectionData(range);
                  console.log('[TextFormattingToolbar] Selection saved on focus (color)');
                }
              }
            }}
            onMouseEnter={() => {
              // Save selection when mouse enters (in case it's still active)
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (!range.collapsed) {
                  saveSelectionData(range);
                }
              }
            }}
            className="toolbar-color-picker"
            title="Select text first, then choose color (or click to apply to current word)"
          />
          <span className="color-value">{fontColor}</span>
        </div>
      </div>

      <div className="toolbar-group">
        <button
          onMouseDown={(e) => {
            // CRITICAL: Save current selection FIRST, before anything else
            const selection = window.getSelection();
            console.log('[TextFormattingToolbar] Button mousedown - current selection:', selection?.rangeCount);
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              if (!range.collapsed) {
                saveSelectionData(range);
                console.log('[TextFormattingToolbar] Selection saved on mousedown (bold):', range.toString());
              } else {
                console.log('[TextFormattingToolbar] Selection is collapsed, using saved selection');
              }
            }
            
            // Don't prevent default - let the click happen normally
            // But call handler immediately
            handleBoldToggle(e);
          }}
          onClick={(e) => {
            // Also save on click as backup
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              if (!range.collapsed) {
                saveSelectionData(range);
              }
            }
          }}
          onMouseEnter={() => {
            // Save selection when mouse enters (in case it's still active)
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              if (!range.collapsed) {
                saveSelectionData(range);
              }
            }
          }}
          className={`toolbar-button ${isBold ? 'active' : ''}`}
          title="Bold (Ctrl+B) - Select text or click to toggle bold on current word"
        >
          <strong>B</strong>
        </button>
      </div>
    </div>
  );
};

export default TextFormattingToolbar;

