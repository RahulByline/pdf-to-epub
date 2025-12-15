import React, { useState, useEffect, useRef, useMemo } from 'react';
import './EpubPreview.css';

const EpubPreview = ({ xhtml, structure, pages: pagesFromBackend, styles, onTextSelect, selectedTextId }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const previewRef = useRef(null);
  const [pages, setPages] = useState([]);

  // Use pages from backend if available, otherwise generate from structure
  useEffect(() => {
    if (pagesFromBackend && pagesFromBackend.length > 0) {
      // Use backend pages (maintains exact document structure)
      const processedPages = pagesFromBackend.map(page => page.items || []);
      setPages(processedPages);
      setCurrentPage(0);
    } else if (structure && structure.length > 0) {
      // Fallback: Split structure into pages based on headings
      const pageStructure = [];
      let currentPageItems = [];
      
      structure.forEach((item, index) => {
        // Start a new page when encountering a heading (h1, h2)
        if (item.type === 'heading' && (item.level === 1 || item.level === 2) && currentPageItems.length > 0) {
          pageStructure.push([...currentPageItems]);
          currentPageItems = [item];
        } else {
          currentPageItems.push(item);
        }
      });
      
      // Add the last page if it has items
      if (currentPageItems.length > 0) {
        pageStructure.push(currentPageItems);
      }
      
      // If no headings found, split into chunks of 5 items per page
      if (pageStructure.length === 0 && structure.length > 5) {
        const itemsPerPage = 5;
        for (let i = 0; i < structure.length; i += itemsPerPage) {
          pageStructure.push(structure.slice(i, i + itemsPerPage));
        }
      } else if (pageStructure.length === 0) {
        // Single page if less than 5 items
        pageStructure.push([...structure]);
      }
      
      setPages(pageStructure);
      setCurrentPage(0); // Reset to first page when structure changes
    }
  }, [structure, pagesFromBackend]);

  // Get current page items
  const currentPageItems = useMemo(() => {
    return pages[currentPage] || [];
  }, [pages, currentPage]);

  // Get all IDs for current page
  const currentPageIds = useMemo(() => {
    return currentPageItems.map(item => item.id);
  }, [currentPageItems]);

  // Inject extracted styles into preview
  useEffect(() => {
    if (styles && styles.trim().length > 0) {
      // Create or update style element
      let styleElement = document.getElementById('epub-preview-extracted-styles');
      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'epub-preview-extracted-styles';
        document.head.appendChild(styleElement);
      }
      styleElement.textContent = styles;
    }
    
    return () => {
      // Cleanup: remove style element when component unmounts
      const styleElement = document.getElementById('epub-preview-extracted-styles');
      if (styleElement) {
        styleElement.remove();
      }
    };
  }, [styles]);

  // Parse and display XHTML for current page - preserve all original formatting
  useEffect(() => {
    if (previewRef.current && xhtml && currentPageIds.length > 0) {
      // Extract body content from XHTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtml, 'text/html');
      
      // Build HTML for current page by extracting only current page elements
      // Preserve all attributes, classes, and inline styles
      const body = doc.body;
      let pageHTML = '';
      
      // Get all elements with IDs and filter for current page
      const allElements = Array.from(body.querySelectorAll('[id]'));
      const currentPageElements = allElements.filter(el => currentPageIds.includes(el.id));
      
      // Build HTML string from current page elements - preserve all HTML
      currentPageElements.forEach((el) => {
        pageHTML += el.outerHTML;
      });
      
      // Update preview with page content - preserve all formatting
      previewRef.current.innerHTML = pageHTML || '<p>No content available for this page.</p>';

      // Add click handlers and styling to elements (without removing existing classes/styles)
      const elements = previewRef.current.querySelectorAll('[id]');
      elements.forEach((el) => {
        // Add selectable class without removing existing classes
        if (!el.classList.contains('epub-selectable')) {
          el.classList.add('epub-selectable');
        }
        
        if (el.id === selectedTextId) {
          el.classList.add('epub-selected');
        } else {
          el.classList.remove('epub-selected');
        }
        
        // Remove existing listeners to prevent duplicates
        const newEl = el.cloneNode(true);
        el.parentNode?.replaceChild(newEl, el);
        
        newEl.addEventListener('click', () => {
          if (onTextSelect) {
            onTextSelect(newEl.id);
          }
        });
      });

      // Highlight selected text and scroll to it
      if (selectedTextId && currentPageIds.includes(selectedTextId)) {
        const selectedEl = previewRef.current.querySelector(`#${selectedTextId}`);
        if (selectedEl) {
          setTimeout(() => {
            selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }
    }
  }, [xhtml, selectedTextId, onTextSelect, currentPageIds]);

  // Navigate to page containing selected text
  useEffect(() => {
    if (selectedTextId && pages.length > 0) {
      const pageIndex = pages.findIndex(page => 
        page.some(item => item.id === selectedTextId)
      );
      if (pageIndex !== -1 && pageIndex !== currentPage) {
        setCurrentPage(pageIndex);
      }
    }
  }, [selectedTextId, pages]);

  const totalPages = pages.length;

  // Get page title from backend pages or generate from items
  const pageTitle = useMemo(() => {
    if (pagesFromBackend && pagesFromBackend[currentPage]) {
      return pagesFromBackend[currentPage].title || `Page ${currentPage + 1}`;
    }
    if (currentPageItems.length > 0) {
      const firstHeading = currentPageItems.find(item => item.type === 'heading');
      if (firstHeading) {
        return firstHeading.text;
      }
      return currentPageItems[0].text.substring(0, 50) + (currentPageItems[0].text.length > 50 ? '...' : '');
    }
    return '';
  }, [currentPageItems, pagesFromBackend, currentPage]);

  return (
    <div className="epub-preview-container">
      <div className="epub-preview-header">
        <h2>EPUB Preview</h2>
        <div className="epub-pagination">
          <button
            onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="epub-nav-btn"
          >
            ← Previous
          </button>
          <div className="epub-page-info">
            <span className="epub-page-number">
              Page {currentPage + 1} of {totalPages}
            </span>
            {pageTitle && (
              <span className="epub-page-title">{pageTitle}</span>
            )}
          </div>
          <button
            onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage === totalPages - 1}
            className="epub-nav-btn"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="epub-preview-content" ref={previewRef}>
        {/* Content will be injected via innerHTML */}
      </div>

      <div className="epub-structure-sidebar">
        <h3>Current Page Structure</h3>
        <div className="epub-structure-list">
          {currentPageItems.length > 0 ? (
            currentPageItems.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className={`epub-structure-item ${item.id === selectedTextId ? 'active' : ''}`}
                onClick={() => onTextSelect && onTextSelect(item.id)}
              >
                <span className="epub-structure-id">{item.id}</span>
                <span className="epub-structure-type">{item.type}</span>
                <span className="epub-structure-text">
                  {item.text.substring(0, 40)}
                  {item.text.length > 40 ? '...' : ''}
                </span>
              </div>
            ))
          ) : (
            <div className="epub-structure-empty">No content on this page</div>
          )}
        </div>
        
        {totalPages > 1 && (
          <div className="epub-page-navigator">
            <h4>Jump to Page</h4>
            <div className="epub-page-buttons">
              {pages.map((page, index) => {
                const title = pagesFromBackend && pagesFromBackend[index] 
                  ? pagesFromBackend[index].title
                  : (page.find(item => item.type === 'heading')?.text || 
                     page[0]?.text?.substring(0, 20) || 
                     `Page ${index + 1}`);
                return (
                  <button
                    key={index}
                    className={`epub-page-btn ${index === currentPage ? 'active' : ''}`}
                    onClick={() => setCurrentPage(index)}
                    title={title}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EpubPreview;


