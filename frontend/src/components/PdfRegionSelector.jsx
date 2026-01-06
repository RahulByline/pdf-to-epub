import React, { useEffect, useRef, useState } from 'react';
import { conversionService } from '../services/conversionService';

/**
 * Lightweight PDF page image viewer with draggable selection overlay.
 * Expects backend page image at /api/conversions/:jobId/page-image/:pageNumber.
 */
const PdfRegionSelector = ({ jobId, pageNumber, onClose, onResult }) => {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(null); // {x,y,width,height} in px relative to container
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [xhtml, setXhtml] = useState('');

  useEffect(() => {
    const loadImage = async () => {
      try {
        setError('');
        const url = await conversionService.getPageImage(jobId, pageNumber);
        setImgUrl(url);
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to load page image');
      }
    };
    if (jobId && pageNumber) {
      loadImage();
    }
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [jobId, pageNumber]);

  const toNormalized = (sel, rect) => ({
    normalizedX: sel.x / rect.width,
    normalizedY: sel.y / rect.height,
    normalizedWidth: sel.width / rect.width,
    normalizedHeight: sel.height / rect.height
  });

  const handleMouseDown = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    setSelecting(true);
    setSelection({ x: startX, y: startY, width: 0, height: 0 });
  };

  const handleMouseMove = (e) => {
    if (!selecting || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    setSelection((sel) => {
      if (!sel) return sel;
      const x = Math.min(sel.x, currentX);
      const y = Math.min(sel.y, currentY);
      const width = Math.abs(currentX - sel.x);
      const height = Math.abs(currentY - sel.y);
      return { x, y, width, height };
    });
  };

  const handleMouseUp = () => {
    setSelecting(false);
  };

  const handleExtract = async () => {
    if (!selection || !containerRef.current) return;
    try {
      setLoading(true);
      setError('');
      const rect = containerRef.current.getBoundingClientRect();
      const bbox = toNormalized(selection, rect);
      const result = await conversionService.extractPageRegion(jobId, {
        pageNumber,
        bbox
      });
      setXhtml(result.xhtml || '');
      if (onResult) onResult(result);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to extract region');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={{ margin: 0 }}>Select region - Page {pageNumber}</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        {error && <div style={styles.error}>{error}</div>}
        <div
          ref={containerRef}
          style={styles.imageContainer}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {imgUrl ? (
            <img ref={imgRef} src={imgUrl} alt={`Page ${pageNumber}`} style={styles.image} />
          ) : (
            <div style={{ textAlign: 'center', padding: '2em' }}>Loading page image...</div>
          )}
          {selection && (
            <div
              style={{
                ...styles.selection,
                left: selection.x,
                top: selection.y,
                width: selection.width,
                height: selection.height
              }}
            />
          )}
        </div>
        <div style={styles.actions}>
          <button
            onClick={handleExtract}
            disabled={!selection || loading}
            style={styles.primaryBtn}
          >
            {loading ? 'Extracting...' : 'Extract selection'}
          </button>
          <button onClick={onClose} style={styles.secondaryBtn}>Cancel</button>
        </div>
        {xhtml && (
          <div style={styles.result}>
            <div style={styles.resultHeader}>Extracted XHTML</div>
            <textarea
              readOnly
              value={xhtml}
              style={styles.textarea}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
    padding: '2em'
  },
  modal: {
    background: '#fff',
    borderRadius: '8px',
    boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
    width: '900px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1em',
    padding: '1em'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  closeBtn: {
    border: 'none',
    background: '#eee',
    cursor: 'pointer',
    padding: '0.4em 0.8em',
    borderRadius: '4px'
  },
  imageContainer: {
    position: 'relative',
    border: '1px solid #ddd',
    borderRadius: '6px',
    minHeight: '400px',
    overflow: 'hidden',
    background: '#f9f9f9'
  },
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
    userSelect: 'none',
    pointerEvents: 'none'
  },
  selection: {
    position: 'absolute',
    border: '2px dashed #2196F3',
    background: 'rgba(33,150,243,0.15)',
    pointerEvents: 'none'
  },
  actions: {
    display: 'flex',
    gap: '0.75em',
    alignItems: 'center'
  },
  primaryBtn: {
    padding: '0.6em 1.2em',
    background: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  secondaryBtn: {
    padding: '0.6em 1.2em',
    background: '#f5f5f5',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  error: {
    color: '#c62828',
    background: '#ffebee',
    padding: '0.5em 0.75em',
    borderRadius: '4px'
  },
  result: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5em'
  },
  resultHeader: {
    fontWeight: 600
  },
  textarea: {
    width: '100%',
    height: '200px',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '0.75em',
    borderRadius: '6px',
    border: '1px solid #ddd',
    background: '#fafafa'
  }
};

export default PdfRegionSelector;


