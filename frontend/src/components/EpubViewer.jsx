import React, { useState, useEffect, useRef } from 'react';
import { conversionService } from '../services/conversionService';
import { HiOutlineChevronLeft, HiOutlineChevronRight, HiOutlineZoomIn, HiOutlineZoomOut } from 'react-icons/hi';
import './EpubViewer.css';

/**
 * EPUB Viewer Component
 * Displays the generated EPUB content as readable XHTML text
 * Shows pages one at a time with proper fitting and layout
 */
const EpubViewer = ({ jobId, onTextSelect }) => {
  const [sections, setSections] = useState([]);
  const [currentSection, setCurrentSection] = useState(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [xhtmlContent, setXhtmlContent] = useState('');
  const [rawXhtmlContent, setRawXhtmlContent] = useState('');
  const [leftPageContent, setLeftPageContent] = useState('');
  const [rightPageContent, setRightPageContent] = useState('');
  const [styles, setStyles] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [showRawXhtml, setShowRawXhtml] = useState(true);
  const contentRef = useRef(null);
  const pageContainerRef = useRef(null);

  useEffect(() => {
    if (jobId) {
      loadEpubContent();
    }
  }, [jobId]);

  useEffect(() => {
    if (currentSection || currentPageIndex >= 0) {
      loadSpreadPages();
    }
  }, [currentSection, currentPageIndex, sections]);

  const loadEpubContent = async () => {
    try {
      setLoading(true);
      setError('');

      // Load EPUB sections
      const epubSections = await conversionService.getEpubSections(parseInt(jobId));
      setSections(epubSections);

      if (epubSections && epubSections.length > 0) {
        setCurrentSection(epubSections[0]);
        // Calculate total pages from sections
        const total = epubSections.reduce((sum, section) => {
          return sum + (section.pageNumbers?.length || 1);
        }, 0);
        setTotalPages(total || epubSections.length);
      }
    } catch (err) {
      console.error('Error loading EPUB content:', err);
      setError('Failed to load EPUB content. The EPUB file may not be available yet.');
    } finally {
      setLoading(false);
    }
  };

  const loadSpreadPages = async () => {
    try {
      // Single page view - load only the current page
      const currentPageIdx = currentPageIndex;
      
      // Find section for current page
      const findSectionForPage = (pageIdx) => {
        let pageCount = 0;
        for (const section of sections) {
          const sectionPages = section.pageNumbers?.length || 1;
          if (pageIdx >= pageCount && pageIdx < pageCount + sectionPages) {
            return section;
          }
          pageCount += sectionPages;
        }
        return sections[0]; // Fallback
      };
      
      const currentSection = findSectionForPage(currentPageIdx);
      
      // Load current page
      if (currentSection) {
        const xhtml = await conversionService.getSectionXhtml(parseInt(jobId), currentSection.id);
        setLeftPageContent(xhtml);
        setRightPageContent(''); // No right page in single view
        setCurrentSection(currentSection);
        setXhtmlContent(xhtml);
        setRawXhtmlContent(xhtml); // Store raw XHTML for preview
        
        // Extract styles
        const styleMatch = xhtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        if (styleMatch) {
          setStyles(styleMatch[1]);
        }
      }
    } catch (err) {
      console.error('Error loading page:', err);
      setError('Failed to load EPUB page.');
    }
  };

  const renderPageContent = (xhtmlContent) => {
    if (!xhtmlContent) return null;
    const parser = new DOMParser();
    let doc;
    try {
      doc = parser.parseFromString(xhtmlContent, 'application/xhtml+xml');
    } catch (e) {
      doc = parser.parseFromString(xhtmlContent, 'text/html');
    }
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      const htmlDoc = parser.parseFromString(xhtmlContent, 'text/html');
      return htmlDoc.body.innerHTML;
    } else {
      const body = doc.querySelector('body') || doc.body;
      return body ? body.innerHTML : '';
    }
  };

  const addTextSelectionHandlers = (contentDiv) => {
    contentDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target.closest('[id]');
      if (target && target.id) {
        contentRef.current?.querySelectorAll('.text-selected').forEach(el => {
          el.classList.remove('text-selected');
        });
        target.classList.add('text-selected');
        if (onTextSelect) {
          onTextSelect(target.id, target.textContent || target.innerText, target);
        }
      }
    });
    contentDiv.querySelectorAll('[id]').forEach(el => {
      el.style.cursor = 'pointer';
      el.classList.add('text-clickable');
    });
  };

  useEffect(() => {
    if (contentRef.current && (leftPageContent || rightPageContent || xhtmlContent)) {
      contentRef.current.innerHTML = '';
      
      if (showRawXhtml) {
        // Show raw XHTML content
        const pageContainer = document.createElement('div');
        pageContainer.className = 'epub-single-page-container';
        
        const xhtmlViewer = document.createElement('div');
        xhtmlViewer.className = 'epub-xhtml-viewer';
        
        const preElement = document.createElement('pre');
        preElement.className = 'epub-xhtml-code';
        
        const codeElement = document.createElement('code');
        codeElement.className = 'language-xml';
        
        // Format and display raw XHTML
        const rawContent = rawXhtmlContent || leftPageContent || xhtmlContent;
        if (rawContent) {
          // Better XML/XHTML formatting with proper indentation
          let formatted = rawContent;
          
          // Try to format the XHTML with proper indentation
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawContent, 'application/xhtml+xml');
            const serializer = new XMLSerializer();
            formatted = serializer.serializeToString(doc);
            
            // Add line breaks and basic indentation
            formatted = formatted
              .replace(/></g, '>\n<')
              .split('\n')
              .map((line, index) => {
                const trimmed = line.trim();
                if (!trimmed) return '';
                // Simple indentation based on opening/closing tags
                const indent = (line.match(/^(\s*)/)[0].length / 2) + 
                              (trimmed.startsWith('</') ? -1 : 0);
                return '  '.repeat(Math.max(0, indent)) + trimmed;
              })
              .filter(line => line.length > 0)
              .join('\n');
          } catch (e) {
            // Fallback to basic formatting if parsing fails
            formatted = rawContent
              .replace(/></g, '>\n<')
              .replace(/>\s+</g, '>\n<')
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .join('\n');
          }
          
          codeElement.textContent = formatted;
          preElement.appendChild(codeElement);
          xhtmlViewer.appendChild(preElement);
          pageContainer.appendChild(xhtmlViewer);
        }
        
        contentRef.current.appendChild(pageContainer);
        pageContainerRef.current = pageContainer;
      } else {
        // Show rendered EPUB view
        const linkElement = document.createElement('link');
        linkElement.rel = 'stylesheet';
        linkElement.type = 'text/css';
        linkElement.href = `/api/conversions/${jobId}/epub-css`;
        contentRef.current.appendChild(linkElement);
        if (styles) {
          const styleElement = document.createElement('style');
          styleElement.textContent = styles;
          contentRef.current.appendChild(styleElement);
        }
        // Create single page container
        const pageContainer = document.createElement('div');
        pageContainer.className = 'epub-single-page-container';
        pageContainer.style.transform = `scale(${zoom})`;
        pageContainer.style.transformOrigin = 'top center';

        // Single page
        const pageContent = leftPageContent || xhtmlContent;
        if (pageContent) {
          const pageDiv = document.createElement('div');
          pageDiv.className = 'epub-page epub-single-page';
          const content = renderPageContent(pageContent);
          pageDiv.innerHTML = content || '';

          // Fix image paths
          pageDiv.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('/')) {
              img.src = `/api/conversions/${jobId}/epub-image/${encodeURIComponent(src)}`;
            }
          });

          // Add click handlers
          addTextSelectionHandlers(pageDiv);
          pageContainer.appendChild(pageDiv);
        }

        contentRef.current.appendChild(pageContainer);
        pageContainerRef.current = pageContainer;
      }
    }
  }, [leftPageContent, rightPageContent, xhtmlContent, rawXhtmlContent, styles, onTextSelect, jobId, zoom, currentPageIndex, totalPages, showRawXhtml]);
  
  // Update zoom when changed
  useEffect(() => {
    if (pageContainerRef.current) {
      pageContainerRef.current.style.transform = `scale(${zoom})`;
    }
  }, [zoom]);
  
  const handlePreviousPage = () => {
    // Move back by 1 page
    const newIndex = Math.max(0, currentPageIndex - 1);
    setCurrentPageIndex(newIndex);
  };
  
  const handleNextPage = () => {
    // Move forward by 1 page
    const newIndex = Math.min(totalPages - 1, currentPageIndex + 1);
    setCurrentPageIndex(newIndex);
  };
  
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.1, 2));
  };
  
  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.1, 0.5));
  };
  
  const goToPage = (pageNum) => {
    const pageIndex = pageNum - 1;
    if (pageIndex >= 0 && pageIndex < totalPages) {
      setCurrentPageIndex(pageIndex);
    }
  };

  if (loading) {
    return (
      <div className="epub-viewer-loading">
        <div className="loading-spinner"></div>
        <p>Loading EPUB content...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="epub-viewer-error">
        <p>{error}</p>
      </div>
    );
  }

  if (!sections || sections.length === 0) {
    return (
      <div className="epub-viewer-empty">
        <p>No EPUB content available. The conversion may not be completed yet.</p>
      </div>
    );
  }

  return (
    <div className="epub-viewer-container">
      {/* Section Navigation */}
      <div className="epub-viewer-sidebar">
        <h3>Chapters</h3>
        <nav className="epub-sections-nav">
          {sections.map((section) => (
            <button
              key={section.id}
              className={`epub-section-btn ${currentSection?.id === section.id ? 'active' : ''}`}
              onClick={() => {
                setCurrentSection(section);
                // Calculate page index for this section
                const sectionIndex = sections.findIndex(s => s.id === section.id);
                const pageStart = sections.slice(0, sectionIndex).reduce((sum, s) => sum + (s.pageNumbers?.length || 1), 0);
                setCurrentPageIndex(pageStart);
              }}
            >
              {section.title || section.id}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="epub-viewer-content">
        <div className="epub-viewer-header">
          <h2 className="epub-preview-title">XHTML Preview</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => setShowRawXhtml(!showRawXhtml)}
              style={{
                padding: '6px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: '4px',
                background: showRawXhtml ? '#1976d2' : '#ffffff',
                color: showRawXhtml ? '#ffffff' : '#212121',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
              }}
            >
              {showRawXhtml ? 'Show Rendered' : 'Show XHTML'}
            </button>
            {!showRawXhtml && (
              <div className="epub-zoom-indicator">
                <span className="epub-zoom-level-badge">{Math.round(zoom * 100)}%</span>
              </div>
            )}
          </div>
        </div>
        <div className="epub-viewer-body-wrapper">
          <div 
            ref={contentRef} 
            className="epub-viewer-body"
          />
        </div>
        <div className="epub-viewer-footer">
          <div className="epub-zoom-controls-footer">
            <button 
              onClick={handleZoomOut} 
              className="epub-zoom-btn" 
              title="Zoom Out"
              disabled={zoom <= 0.5}
            >
              <HiOutlineZoomOut size={20} />
            </button>
            <button 
              onClick={handleZoomIn} 
              className="epub-zoom-btn" 
              title="Zoom In"
              disabled={zoom >= 2}
            >
              <HiOutlineZoomIn size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EpubViewer;

