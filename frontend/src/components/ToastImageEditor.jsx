import React, { useEffect, useRef, useState } from 'react';
import ImageEditor from '@toast-ui/react-image-editor';
import 'tui-image-editor/dist/tui-image-editor.css';
import './ToastImageEditor.css';

/**
 * ToastImageEditor Component
 * A wrapper around TOAST UI Image Editor that allows:
 * - Editing text overlays
 * - Resizing images
 * - Moving images
 * - Various image filters and effects
 */
const ToastImageEditor = ({
  imageUrl,
  imageId,
  onSave,
  onCancel,
  initialWidth = null,
  initialHeight = null,
}) => {
  const editorRef = useRef(null);
  const [editorInstance, setEditorInstance] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Editor configuration
  const editorOptions = {
    includeUI: {
      loadImage: {
        path: imageUrl,
        name: 'Image',
      },
      theme: {
        'common.bi.image': '',
        'common.bisize.width': '0px',
        'common.bisize.height': '0px',
        'common.backgroundImage': 'none',
        'common.backgroundColor': '#f5f5f5',
        'common.border': '1px solid #e0e0e0',
      },
      menu: [
        'crop',
        'flip',
        'rotate',
        'draw',
        'shape',
        'icon',
        'text',
        'filter',
      ],
      initMenu: 'text', // Start with text menu
      uiSize: {
        width: '100%',
        height: '100%',
      },
      menuBarPosition: 'bottom',
    },
    cssMaxWidth: window.innerWidth,
    cssMaxHeight: window.innerHeight,
    selectionStyle: {
      cornerSize: 20,
      rotatingPointOffset: 70,
    },
    usageStatistics: false,
  };

  // Handle editor ready
  useEffect(() => {
    const timer = setTimeout(() => {
      if (editorRef.current && editorRef.current.getInstance) {
        try {
          const instance = editorRef.current.getInstance();
          setEditorInstance(instance);
          setImageLoaded(true);
          
          // Set initial dimensions if provided
          if (initialWidth && initialHeight) {
            instance.resizeCanvasDimension({
              width: initialWidth,
              height: initialHeight,
            });
          }
        } catch (error) {
          console.error('[ToastImageEditor] Error getting instance:', error);
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [imageUrl, initialWidth, initialHeight]);

  // Handle save
  const handleSave = () => {
    if (!editorInstance) {
      alert('Editor not ready yet. Please wait a moment.');
      return;
    }

    try {
      // Get edited image as data URL
      const dataURL = editorInstance.toDataURL();
      
      // Get canvas dimensions
      const canvasSize = editorInstance.getCanvasSize();
      
      // Call onSave with all the data
      if (onSave) {
        onSave({
          imageId: imageId,
          imageData: {
            dataURL: dataURL,
            width: canvasSize.width,
            height: canvasSize.height,
          },
          texts: [], // TOAST UI handles text as part of the image
          canvasDataURL: dataURL,
        });
      }
    } catch (error) {
      console.error('[ToastImageEditor] Error saving:', error);
      alert('Failed to save image: ' + error.message);
    }
  };

  return (
    <div className="toast-image-editor">
      <div className="editor-toolbar">
        <div className="toolbar-section">
          <h3>TOAST UI Image Editor</h3>
          <p>Use the menu below to edit your image. Add text, resize, move elements, and apply filters.</p>
        </div>
        <div className="toolbar-section actions">
          <button onClick={handleSave} className="btn-save" disabled={!imageLoaded}>
            💾 Save to XHTML
          </button>
          <button onClick={onCancel} className="btn-cancel">
            ❌ Cancel
          </button>
        </div>
      </div>

      <div className="editor-container">
        {!imageLoaded && (
          <div className="loading-overlay">
            <div className="loading-spinner">Loading image editor...</div>
          </div>
        )}
        <ImageEditor
          ref={editorRef}
          {...editorOptions}
        />
      </div>
    </div>
  );
};

export default ToastImageEditor;

