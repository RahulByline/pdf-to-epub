/**
 * XHTML Generator from Transcript
 * 
 * Generates EPUB3-compliant XHTML chapter files from transcript JSON data.
 * 
 * Architecture:
 * - Transcript JSON is the single source of truth
 * - Each fragment in transcript becomes an XHTML element with matching ID
 * - Fragment IDs must match SMIL references exactly
 * - Text content comes from transcript (edited text)
 * 
 * XHTML Structure:
 * <html>
 *   <head>...</head>
 *   <body>
 *     <p id="fragmentId">text content</p>
 *     <p id="fragmentId2">more text</p>
 *   </body>
 * </html>
 */

/**
 * Generate XHTML content from transcript JSON
 * 
 * @param {Object} transcript - Transcript JSON data
 * @param {Object} options - Generation options
 * @returns {string} XHTML content
 */
export function generateXHTMLFromTranscript(transcript, options = {}) {
  const {
    title = `Page ${transcript.pageNumber}`,
    cssHref = 'styles.css',
    includeMediaOverlayCSS = true
  } = options;

  if (!transcript || !transcript.fragments || transcript.fragments.length === 0) {
    throw new Error('Transcript must have fragments array');
  }

  // Generate body content from fragments
  const bodyContent = transcript.fragments
    .map(fragment => {
      // Determine HTML element based on fragment type
      const elementTag = getElementTagForFragment(fragment);
      
      // Escape HTML entities in text
      const escapedText = escapeHtml(fragment.text);

      // Build element with ID and optional classes
      const classes = [
        'epub-media-overlay-active', // For SMIL highlighting
        `fragment-type-${fragment.type}`
      ].join(' ');

      return `    <${elementTag} id="${fragment.id}" class="${classes}">${escapedText}</${elementTag}>`;
    })
    .join('\n');

  // Media overlay CSS for highlighting
  const mediaOverlayCSS = includeMediaOverlayCSS ? `
    /* EPUB3 Media Overlay Active Class */
    .epub-media-overlay-active,
    .-epub-media-overlay-active {
      background-color: #ffff00;
      color: #000000;
    }
  ` : '';

  // Build complete XHTML document
  const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" type="text/css" href="${cssHref}"/>
    <style type="text/css">
      body {
        font-family: serif;
        line-height: 1.6;
        margin: 1em;
        padding: 1em;
      }
      p {
        margin: 0.5em 0;
      }
      ${mediaOverlayCSS}
    </style>
  </head>
  <body>
${bodyContent}
  </body>
</html>`;

  return xhtmlContent;
}

/**
 * Determine HTML element tag based on fragment type
 */
function getElementTagForFragment(fragment) {
  switch (fragment.type) {
    case 'word':
      return 'span'; // Words are inline
    case 'sentence':
      return 'p'; // Sentences are paragraphs
    case 'paragraph':
      return 'p'; // Paragraphs are paragraphs
    default:
      return 'p'; // Default to paragraph
  }
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate XHTML file and save to disk
 * 
 * @param {Object} transcript - Transcript JSON data
 * @param {string} outputDir - Directory to save XHTML file
 * @param {Object} options - Generation options
 * @returns {Promise<string>} Path to saved XHTML file
 */
export async function generateAndSaveXHTML(transcript, outputDir, options = {}) {
  const fs = await import('fs/promises');
  const path = await import('path');

  const xhtmlContent = generateXHTMLFromTranscript(transcript, options);
  const xhtmlFileName = `page_${transcript.pageNumber}.xhtml`;
  const xhtmlPath = path.join(outputDir, xhtmlFileName);

  await fs.writeFile(xhtmlPath, xhtmlContent, 'utf8');

  console.log(`[XHTMLGenerator] Generated XHTML file: ${xhtmlFileName} with ${transcript.fragments.length} fragments`);

  return {
    path: xhtmlPath,
    fileName: xhtmlFileName
  };
}

/**
 * Generate XHTML with semantic structure preserved
 * 
 * This version attempts to preserve semantic structure (headings, lists, etc.)
 * based on fragment IDs and text patterns.
 * 
 * @param {Object} transcript - Transcript JSON data
 * @param {Object} options - Generation options
 * @returns {string} XHTML content with semantic structure
 */
export function generateSemanticXHTMLFromTranscript(transcript, options = {}) {
  const {
    title = `Page ${transcript.pageNumber}`,
    cssHref = 'styles.css',
    includeMediaOverlayCSS = true
  } = options;

  if (!transcript || !transcript.fragments || transcript.fragments.length === 0) {
    throw new Error('Transcript must have fragments array');
  }

  // Group fragments by semantic type (if detectable from ID patterns)
  const bodyElements = [];
  let currentParagraph = null;

  transcript.fragments.forEach(fragment => {
    const elementTag = getSemanticElementTag(fragment);
    const escapedText = escapeHtml(fragment.text);
    const classes = [
      'epub-media-overlay-active',
      `fragment-type-${fragment.type}`
    ].join(' ');

    if (elementTag === 'p' && fragment.type === 'sentence') {
      // Group sentences into paragraphs
      if (!currentParagraph) {
        currentParagraph = {
          id: fragment.id,
          sentences: [fragment],
          text: fragment.text
        };
      } else {
        // Add to current paragraph
        currentParagraph.sentences.push(fragment);
        currentParagraph.text += ' ' + fragment.text;
      }
    } else {
      // Close current paragraph if exists
      if (currentParagraph) {
        const paraId = currentParagraph.id;
        const paraText = escapeHtml(currentParagraph.text);
        bodyElements.push(`    <p id="${paraId}" class="${classes}">${paraText}</p>`);
        currentParagraph = null;
      }

      // Add standalone element
      bodyElements.push(`    <${elementTag} id="${fragment.id}" class="${classes}">${escapedText}</${elementTag}>`);
    }
  });

  // Close any remaining paragraph
  if (currentParagraph) {
    const paraId = currentParagraph.id;
    const paraText = escapeHtml(currentParagraph.text);
    bodyElements.push(`    <p id="${paraId}" class="epub-media-overlay-active fragment-type-sentence">${paraText}</p>`);
  }

  const mediaOverlayCSS = includeMediaOverlayCSS ? `
    /* EPUB3 Media Overlay Active Class */
    .epub-media-overlay-active,
    .-epub-media-overlay-active {
      background-color: #ffff00;
      color: #000000;
    }
  ` : '';

  const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" type="text/css" href="${cssHref}"/>
    <style type="text/css">
      body {
        font-family: serif;
        line-height: 1.6;
        margin: 1em;
        padding: 1em;
      }
      p {
        margin: 0.5em 0;
      }
      h1, h2, h3, h4, h5, h6 {
        margin: 1em 0 0.5em 0;
      }
      ${mediaOverlayCSS}
    </style>
  </head>
  <body>
${bodyElements.join('\n')}
  </body>
</html>`;

  return xhtmlContent;
}

/**
 * Determine semantic HTML element based on fragment ID patterns
 */
function getSemanticElementTag(fragment) {
  const id = fragment.id || '';

  // Check for heading patterns
  if (id.includes('_h1') || id.includes('heading1')) {
    return 'h1';
  }
  if (id.includes('_h2') || id.includes('heading2')) {
    return 'h2';
  }
  if (id.includes('_h3') || id.includes('heading3')) {
    return 'h3';
  }
  if (id.includes('_h4') || id.includes('heading4')) {
    return 'h4';
  }

  // Check for list patterns
  if (id.includes('_li') || id.includes('listitem')) {
    return 'li';
  }

  // Default based on fragment type
  return getElementTagForFragment(fragment);
}



