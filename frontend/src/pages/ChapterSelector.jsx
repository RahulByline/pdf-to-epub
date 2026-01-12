import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { pdfService } from '../services/pdfService';
import { conversionService } from '../services/conversionService';
import './ChapterSelector.css';

const ChapterSelector = () => {
  const { pdfId } = useParams();
  const navigate = useNavigate();
  const [pdf, setPdf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!pdfId) return;
    setLoading(true);
    pdfService.getPdfById(pdfId)
      .then(data => {
        setPdf(data);
        setChapters(buildDefaultPlan(data?.totalPages || 1, 3));
      })
      .catch(err => setError(err.message || 'Failed to load PDF'))
      .finally(() => setLoading(false));
  }, [pdfId]);

  const buildDefaultPlan = (totalPages, count) => {
    if (totalPages < 1) {
      return [{ title: 'Chapter 1', startPage: 1, endPage: 1, pageType: 'regular' }];
    }
    const plan = [];
    const perChapter = Math.max(1, Math.floor(totalPages / count));
    let cursor = 1;
    for (let i = 0; i < count && cursor <= totalPages; i++) {
      const startPage = cursor;
      const endPage = i === count - 1 ? totalPages : Math.min(totalPages, cursor + perChapter - 1);
      plan.push({
        title: `Chapter ${i + 1}`,
        startPage,
        endPage: Math.max(endPage, startPage),
        pageType: 'regular' // Options: 'regular', 'cover', 'toc', 'back'
      });
      cursor = endPage + 1;
    }
    if (plan.length === 0) {
      plan.push({
        title: 'Chapter 1',
        startPage: 1,
        endPage: totalPages,
        pageType: 'regular'
      });
    }
    return plan;
  };

  const handleChapterChange = (index, field, value) => {
    setChapters(prev => prev.map((chapter, idx) => {
      if (idx !== index) return chapter;
      
      // Determine the correct value type based on field
      let processedValue = value;
      if (field === 'startPage' || field === 'endPage') {
        processedValue = Number(value) || 0;
      }
      // 'title' and 'pageType' remain as strings
      
      return { ...chapter, [field]: processedValue };
    }));
  };

  const addChapter = () => {
    const totalPages = pdf?.totalPages || 1;
    const last = chapters[chapters.length - 1];
    const lastEnd = Math.max(
      last?.endPage || 0,
      last?.startPage || 0
    );
    const nextStart = Math.max(Math.min(totalPages, Math.max(lastEnd + 1, 1)), 1);
    if (nextStart > totalPages) return;
    setChapters(prev => [
      ...prev,
      {
        title: `Chapter ${prev.length + 1}`,
        startPage: nextStart,
        endPage: Math.min(totalPages, nextStart + Math.max(Math.floor((totalPages - nextStart + 1) / 2), 4) - 1),
        pageType: 'regular'
      }
    ]);
  };

  const removeChapter = (index) => {
    if (chapters.length <= 1) return;
    setChapters(prev => prev.filter((_, idx) => idx !== index));
  };

  const validatePlan = () => {
    const totalPages = Number(pdf?.totalPages); // may be undefined or a placeholder (e.g., 1)
    for (const chapter of chapters) {
      const start = Number(chapter.startPage) || 0;
      const end = Number(chapter.endPage) || 0;

      if (start < 1 || end < 1 || start > end) {
        return 'Each chapter must have valid start and end pages.';
      }

      // Only enforce upper bound when we have a meaningful totalPages (>1)
      if (Number.isFinite(totalPages) && totalPages > 1 && (start > totalPages || end > totalPages)) {
        return `Each chapter must be within 1-${totalPages}.`;
      }
    }
    return '';
  };

  const handleSubmit = async () => {
    const validationMessage = validatePlan();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await conversionService.startConversion(pdfId, {
        chapterPlan: chapters.map(chapter => ({
          title: chapter.title,
          startPage: chapter.startPage,
          endPage: chapter.endPage,
          pageType: chapter.pageType || 'regular'
        }))
      });
      navigate('/conversions');
    } catch (err) {
      setError(err.message || 'Failed to start conversion');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading PDF details…</div>;
  }

  if (!pdf) {
    return <div className="error">PDF not found.</div>;
  }

  return (
    <div className="chapter-plan-page">
      <div className="plan-header">
        <h1>Plan Chapters for "{pdf.originalFileName}"</h1>
        <p>Select the number of chapters and the specific page ranges that should be included in each chapter before conversion starts.</p>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="plan-body">
        <div className="pdf-preview">
          <iframe
            title="PDF Preview"
            src={`/api/pdfs/${pdfId}/view`}
            width="100%"
            height="600"
            style={{ border: '1px solid #ccc', borderRadius: '6px' }}
          />
        </div>

        <div className="plan-controls">
          <h2>Chapters ({chapters.length})</h2>
          <div className="chapter-list">
            {chapters.map((chapter, index) => (
              <div key={index} className="chapter-row">
                <div className="chapter-row-header">
                  <strong>{chapter.title}</strong>
                  {chapters.length > 1 && (
                    <button type="button" className="remove-button" onClick={() => removeChapter(index)}>Remove</button>
                  )}
                </div>
                <label>
                  Title
                  <input
                    type="text"
                    value={chapter.title}
                    onChange={e => handleChapterChange(index, 'title', e.target.value)}
                  />
                </label>
                <label>
                  Start Page
                  <input
                    type="number"
                    min="1"
                    max={pdf.totalPages}
                    value={chapter.startPage}
                    onChange={e => handleChapterChange(index, 'startPage', e.target.value)}
                  />
                </label>
                <label>
                  End Page
                  <input
                    type="number"
                    min="1"
                    max={pdf.totalPages}
                    value={chapter.endPage}
                    onChange={e => handleChapterChange(index, 'endPage', e.target.value)}
                  />
                </label>
                <label>
                  Page Type
                  <select
                    value={chapter.pageType || 'regular'}
                    onChange={e => handleChapterChange(index, 'pageType', e.target.value)}
                  >
                    <option value="regular">Regular Chapter</option>
                    <option value="cover">Cover Page</option>
                    <option value="toc">Table of Contents (TOC)</option>
                    <option value="back">Back Cover</option>
                  </select>
                </label>
              </div>
            ))}
          </div>
          <button type="button" className="add-chapter-button" onClick={addChapter}>Add Chapter</button>
          <div className="plan-actions">
            <button type="button" className="start-conversion" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Starting conversion…' : 'Start Conversion'}
            </button>
            <button type="button" className="cancel" onClick={() => navigate('/pdfs')}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChapterSelector;

