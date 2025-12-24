/**
 * Helper function to inject an image into XHTML by replacing a placeholder div
 * @param {string} xhtml - The XHTML content
 * @param {string} targetId - The ID of the placeholder div to replace
 * @param {string} imageSrc - The source path for the image (e.g., "../images/page1_img1.png")
 * @param {number} imageWidth - Optional width for the image
 * @param {number} imageHeight - Optional height for the image
 * @returns {string} - Modified XHTML with image tag replacing the placeholder
 */
/**
 * Inject image as background image (for PDF background images with text overlay)
 * @param {string} xhtml - The XHTML content
 * @param {string} targetId - The ID of the container to add background to
 * @param {string} imageSrc - The source path for the image
 * @param {string} description - Optional description for accessibility
 * @returns {string} - Modified XHTML with background image
 */
export function injectBackgroundImageIntoXhtml(xhtml, targetId, imageSrc, description = null) {
  console.log(`[injectBackgroundImageIntoXhtml] Starting injection for container: ${targetId}, image: ${imageSrc}`);
  
  let parser = new DOMParser();
  let doc = parser.parseFromString(xhtml, 'text/html');
  
  let parserError = doc.querySelector('parsererror');
  if (parserError) {
    console.warn('[injectBackgroundImageIntoXhtml] text/html parsing failed, trying application/xml');
    doc = parser.parseFromString(xhtml, 'application/xml');
    parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.warn('[injectBackgroundImageIntoXhtml] application/xml also failed, falling back to regex');
      return injectBackgroundImageIntoXhtmlRegex(xhtml, targetId, imageSrc, description);
    }
  }
  
  // Find the target container
  let container = doc.getElementById(targetId);
  if (!container) {
    container = doc.querySelector(`#${targetId}`) || doc.querySelector(`[id="${targetId}"]`);
  }
  
  if (!container) {
    const body = doc.body || doc.documentElement;
    if (body) {
      container = body.querySelector(`#${targetId}`) || body.querySelector(`[id="${targetId}"]`);
    }
  }
  
  if (!container) {
    console.error(`[injectBackgroundImageIntoXhtml] Container with ID "${targetId}" not found`);
    return injectBackgroundImageIntoXhtmlRegex(xhtml, targetId, imageSrc, description);
  }
  
  // If the container is a placeholder div, we might want to use its parent as the background container
  // This allows text to be on top of the background
  const isPlaceholder = container.classList.contains('image-placeholder') || 
                        container.classList.contains('image-drop-zone');
  
  // If it's a placeholder, try to find a suitable parent container
  // Otherwise, use the container itself
  let backgroundContainer = container;
  if (isPlaceholder && container.parentElement) {
    // Check if parent is a suitable container (div, section, article, etc.)
    const parentTag = container.parentElement.tagName.toLowerCase();
    if (['div', 'section', 'article', 'main', 'body'].includes(parentTag)) {
      backgroundContainer = container.parentElement;
      console.log(`[injectBackgroundImageIntoXhtml] Using parent container: ${parentTag}, id: ${backgroundContainer.id || 'no-id'}`);
    }
  }
  
  console.log(`[injectBackgroundImageIntoXhtml] Found container: ${backgroundContainer.tagName}, id: ${backgroundContainer.id || 'no-id'}`);
  
  // Get existing style or create new
  const existingStyle = backgroundContainer.getAttribute('style') || '';
  const existingClasses = backgroundContainer.getAttribute('class') || '';
  
  // Create background image style with proper sizing
  // Use cover to fill the container while maintaining aspect ratio
  const backgroundImageStyle = `background-image: url("${imageSrc}"); background-size: cover; background-position: center; background-repeat: no-repeat; background-attachment: local; position: relative; min-height: 200px;`;
  
  // Combine with existing styles (don't override position if it's already set)
  let newStyle = existingStyle;
  if (!newStyle.includes('background-image')) {
    newStyle = newStyle ? `${newStyle} ${backgroundImageStyle}` : backgroundImageStyle;
  } else {
    // Replace existing background-image
    newStyle = newStyle.replace(/background-image:\s*url\([^)]+\)/gi, `background-image: url("${imageSrc}")`);
    if (!newStyle.includes('background-size')) {
      newStyle += ' background-size: cover; background-position: center; background-repeat: no-repeat;';
    }
  }
  
  backgroundContainer.setAttribute('style', newStyle);
  
  // Add background-image class for styling
  const newClasses = existingClasses 
    ? `${existingClasses} has-background-image`
    : 'has-background-image';
  backgroundContainer.setAttribute('class', newClasses);
  
  // Add aria-label for accessibility if description provided
  if (description) {
    backgroundContainer.setAttribute('aria-label', description);
    backgroundContainer.setAttribute('title', description);
  }
  
  // If we used a parent container, remove the placeholder div (it's no longer needed)
  if (isPlaceholder && backgroundContainer !== container) {
    // Move any text content from placeholder to parent before removing
    const textContent = container.textContent || '';
    if (textContent.trim()) {
      const textNode = doc.createTextNode(textContent);
      backgroundContainer.appendChild(textNode);
    }
    // Remove the placeholder
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
  
  // Ensure text content appears on top (z-index)
  const textContentStyle = 'position: relative; z-index: 2; background-color: rgba(255, 255, 255, 0.85); padding: 0.25em 0.5em; margin: 0.25em 0; border-radius: 2px; display: inline-block;';
  const children = backgroundContainer.querySelectorAll('p, span, div:not(.has-background-image), h1, h2, h3, h4, h5, h6, li, td, th');
  children.forEach(child => {
    // Skip if it's the placeholder we're about to remove
    if (child === container) return;
    const childStyle = child.getAttribute('style') || '';
    if (!childStyle.includes('z-index')) {
      child.setAttribute('style', `${childStyle} ${textContentStyle}`);
    }
  });
  
  // Serialize back
  const serializer = new XMLSerializer();
  let result;
  
  if (doc.documentElement && doc.documentElement.tagName === 'HTML') {
    const htmlElement = doc.documentElement;
    const bodyContent = doc.body ? doc.body.innerHTML : '';
    const headContent = doc.head ? doc.head.innerHTML : '';
    
    const doctypeMatch = xhtml.match(/<!DOCTYPE[^>]*>/i);
    const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
    const xmlnsMatch = xhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
    const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';
    
    result = `${doctype}\n<html xmlns="${xmlns}">\n`;
    if (headContent) {
      result += `<head>\n${headContent}\n</head>\n`;
    }
    result += `<body>\n${bodyContent}\n</body>\n</html>`;
  } else {
    result = serializer.serializeToString(doc);
    if (xhtml.includes('<!DOCTYPE') && !result.includes('<!DOCTYPE')) {
      const doctypeMatch = xhtml.match(/<!DOCTYPE[^>]*>/i);
      if (doctypeMatch) {
        result = `${doctypeMatch[0]}\n${result}`;
      }
    }
  }
  
  console.log('[injectBackgroundImageIntoXhtml] Successfully injected background image');
  return result;
}

/**
 * Regex fallback for background image injection
 */
function injectBackgroundImageIntoXhtmlRegex(xhtml, targetId, imageSrc, description = null) {
  const containerPattern = new RegExp(
    `(<div[^>]*id=["']${targetId}["'][^>]*)(style=["']([^"']*)["'])?([^>]*>)`,
    'i'
  );
  
  const match = xhtml.match(containerPattern);
  if (!match) {
    console.warn(`Could not find container with ID "${targetId}"`);
    return xhtml;
  }
  
  const existingStyle = match[3] || '';
  const backgroundImageStyle = `background-image: url("${imageSrc}"); background-size: cover; background-position: center; background-repeat: no-repeat; position: relative;`;
  const newStyle = existingStyle 
    ? `style="${existingStyle} ${backgroundImageStyle}"`
    : `style="${backgroundImageStyle}"`;
  
  let replacement = match[1] + ' ' + newStyle;
  if (description) {
    replacement += ` aria-label="${description.replace(/"/g, '&quot;')}" title="${description.replace(/"/g, '&quot;')}"`;
  }
  replacement += ' class="has-background-image"';
  replacement += match[4];
  
  return xhtml.replace(containerPattern, replacement);
}

export function injectImageIntoXhtml(xhtml, targetId, imageSrc, imageWidth = null, imageHeight = null, description = null, isBackground = false) {
  console.log(`[injectImageIntoXhtml] Starting injection for placeholder: ${targetId}, image: ${imageSrc}, isBackground: ${isBackground}`);
  
  // If it's a background image, use the background image function
  if (isBackground) {
    return injectBackgroundImageIntoXhtml(xhtml, targetId, imageSrc, description);
  }
  
  // Create a temporary DOM parser
  // Try 'text/html' first (more lenient), fallback to 'application/xml' if needed
  let parser = new DOMParser();
  let doc = parser.parseFromString(xhtml, 'text/html');
  
  // Handle parsing errors - try application/xml if text/html fails
  let parserError = doc.querySelector('parsererror');
  if (parserError) {
    console.warn('[injectImageIntoXhtml] text/html parsing failed, trying application/xml:', parserError.textContent);
    doc = parser.parseFromString(xhtml, 'application/xml');
    parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.warn('[injectImageIntoXhtml] application/xml also failed, falling back to regex:', parserError.textContent);
      // Fallback to regex-based replacement
      return injectImageIntoXhtmlRegex(xhtml, targetId, imageSrc, imageWidth, imageHeight);
    }
  }
  
  // Find the placeholder div by ID
  // Try getElementById first
  let placeholder = doc.getElementById(targetId);
  
  // If not found, try querySelector (works better with namespaces)
  if (!placeholder) {
    placeholder = doc.querySelector(`#${targetId}`);
  }
  
  // If still not found, try without namespace
  if (!placeholder) {
    placeholder = doc.querySelector(`[id="${targetId}"]`);
  }
  
  // If still not found, try in body or documentElement
  if (!placeholder) {
    const body = doc.body || doc.documentElement;
    if (body) {
      placeholder = body.querySelector(`#${targetId}`) || body.querySelector(`[id="${targetId}"]`);
    }
  }
  
  if (!placeholder) {
    console.error(`[injectImageIntoXhtml] Placeholder with ID "${targetId}" not found in XHTML`);
    console.log('[injectImageIntoXhtml] Available IDs:', Array.from(doc.querySelectorAll('[id]')).map(el => el.id));
    // Fallback to regex
    return injectImageIntoXhtmlRegex(xhtml, targetId, imageSrc, imageWidth, imageHeight);
  }
  
  console.log(`[injectImageIntoXhtml] Found placeholder: ${placeholder.tagName}, id: ${placeholder.id}, classes: ${placeholder.className}`);
  
  // Check if it's already an img tag
  if (placeholder.tagName.toLowerCase() === 'img') {
    console.log('[injectImageIntoXhtml] Placeholder is already an img tag, updating src');
    // Update existing img tag
    placeholder.setAttribute('src', imageSrc);
    if (imageWidth) placeholder.setAttribute('width', imageWidth);
    if (imageHeight) placeholder.setAttribute('height', imageHeight);
    placeholder.setAttribute('style', 'max-width: 100%; height: auto; display: block;');
  } else {
    console.log('[injectImageIntoXhtml] Creating new img tag to replace placeholder div');
    // Create new img element
    const img = doc.createElement('img');
    img.setAttribute('id', targetId);
    img.setAttribute('src', imageSrc);
    
    // Get alt text from description, title, alt attribute, or use a default
    const altText = description || placeholder.getAttribute('title') || placeholder.getAttribute('alt') || 'Image';
    img.setAttribute('alt', altText);
    if (description) {
      img.setAttribute('title', description);
    }
    img.setAttribute('style', 'max-width: 100%; height: auto; display: block;');
    
    if (imageWidth) img.setAttribute('width', imageWidth);
    if (imageHeight) img.setAttribute('height', imageHeight);
    
    // Copy any classes from the placeholder (except placeholder classes)
    if (placeholder.className) {
      const cleanedClasses = placeholder.className
        .replace('image-placeholder', '')
        .replace('image-drop-zone', '')
        .trim();
      if (cleanedClasses) {
        img.setAttribute('class', cleanedClasses);
      }
    }
    
    // Remove any text content from the placeholder before replacing
    // This ensures no text nodes remain
    while (placeholder.firstChild) {
      placeholder.removeChild(placeholder.firstChild);
    }
    
    // Replace the placeholder with the img tag
    if (placeholder.parentNode) {
      placeholder.parentNode.replaceChild(img, placeholder);
      console.log('[injectImageIntoXhtml] Successfully replaced placeholder with img tag');
    } else {
      console.error('[injectImageIntoXhtml] Placeholder has no parent node, cannot replace');
      return xhtml;
    }
  }
  
  // Serialize back to string
  // Use XMLSerializer for XHTML
  const serializer = new XMLSerializer();
  let result;
  
  // Check if we parsed as HTML (text/html) or XML (application/xml)
  if (doc.documentElement && doc.documentElement.tagName === 'HTML') {
    // HTML5 parser - need to reconstruct XHTML structure
    const htmlElement = doc.documentElement;
    const bodyContent = doc.body ? doc.body.innerHTML : '';
    
    // Extract head content if it exists
    const headContent = doc.head ? doc.head.innerHTML : '';
    
    // Preserve DOCTYPE from original
    const doctypeMatch = xhtml.match(/<!DOCTYPE[^>]*>/i);
    const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
    
    // Reconstruct XHTML structure
    // Get the namespace from original if present
    const xmlnsMatch = xhtml.match(/<html[^>]*xmlns=["']([^"']+)["']/i);
    const xmlns = xmlnsMatch ? xmlnsMatch[1] : 'http://www.w3.org/1999/xhtml';
    
    // Build XHTML string
    result = `${doctype}\n<html xmlns="${xmlns}">\n`;
    if (headContent) {
      result += `<head>\n${headContent}\n</head>\n`;
    }
    result += `<body>\n${bodyContent}\n</body>\n</html>`;
  } else {
    // XML parser - serialize the whole document
    result = serializer.serializeToString(doc);
    
    // Ensure DOCTYPE is preserved
    if (xhtml.includes('<!DOCTYPE') && !result.includes('<!DOCTYPE')) {
      const doctypeMatch = xhtml.match(/<!DOCTYPE[^>]*>/i);
      if (doctypeMatch) {
        result = `${doctypeMatch[0]}\n${result}`;
      }
    }
  }
  
  // CRITICAL: Fix img tags to be self-closing (XHTML requirement)
  // HTML5 parser's innerHTML might output <img> instead of <img/>
  result = result.replace(/<img([^>]*?)>/gi, (match, attrs) => {
    // Check if already self-closing (ends with /> or has /> before the closing >)
    if (match.includes('/>') || attrs.trim().endsWith('/')) {
      return match; // Already self-closing
    }
    // Add / before the closing >
    return `<img${attrs}/>`;
  });
  
  console.log('[injectImageIntoXhtml] Successfully injected image, result length:', result.length);
  console.log('[injectImageIntoXhtml] Result contains image src:', result.includes(imageSrc));
  return result;
}

/**
 * Fallback regex-based replacement for when DOM parsing fails
 */
function injectImageIntoXhtmlRegex(xhtml, targetId, imageSrc, imageWidth, imageHeight, description = null) {
  // Pattern to match the placeholder div
  const placeholderPattern = new RegExp(
    `(<div[^>]*id=["']${targetId}["'][^>]*class=["'][^"]*image-placeholder[^"]*["'][^>]*>)([^<]*</div>)`,
    'i'
  );
  
  const match = xhtml.match(placeholderPattern);
  if (!match) {
    // Try without class requirement
    const loosePattern = new RegExp(`(<div[^>]*id=["']${targetId}["'][^>]*>)([^<]*</div>)`, 'i');
    const looseMatch = xhtml.match(loosePattern);
    if (!looseMatch) {
      console.warn(`Could not find placeholder div with ID "${targetId}"`);
      return xhtml;
    }
  }
  
  // Extract title/alt from the placeholder, or use description
  const fullMatch = match ? match[0] : xhtml.match(new RegExp(`<div[^>]*id=["']${targetId}["'][^>]*>.*?</div>`, 'is'))[0];
  const titleMatch = fullMatch.match(/title=["']([^"']*)["']/i);
  const altText = description || (titleMatch ? titleMatch[1] : 'Image');
  
  // Build img tag
  let imgTag = `<img id="${targetId}" src="${imageSrc}" alt="${altText.replace(/"/g, '&quot;')}" style="max-width: 100%; height: auto; display: block;"`;
  if (description) {
    imgTag += ` title="${description.replace(/"/g, '&quot;')}"`;
  }
  if (imageWidth) imgTag += ` width="${imageWidth}"`;
  if (imageHeight) imgTag += ` height="${imageHeight}"`;
  imgTag += '/>';
  
  // Replace the placeholder
  return xhtml.replace(placeholderPattern, imgTag);
}

/**
 * Extract all placeholder divs from XHTML
 * @param {string} xhtml - The XHTML content
 * @returns {Array} - Array of {id, element, position} objects
 */
export function extractPlaceholders(xhtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtml, 'application/xml');
  
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    // Fallback to regex extraction
    return extractPlaceholdersRegex(xhtml);
  }
  
  const placeholders = [];
  const placeholderElements = doc.querySelectorAll('.image-placeholder, .image-drop-zone');
  
  placeholderElements.forEach((el, index) => {
    const id = el.id || `placeholder_${index}`;
    placeholders.push({
      id,
      element: el,
      title: el.getAttribute('title') || el.getAttribute('alt') || '',
      className: el.className || ''
    });
  });
  
  return placeholders;
}

/**
 * Fallback regex-based placeholder extraction
 */
function extractPlaceholdersRegex(xhtml) {
  const placeholders = [];
  const pattern = /<div[^>]*class=["'][^"]*(?:image-placeholder|image-drop-zone)[^"]*["'][^>]*id=["']([^"']+)["'][^>]*>/gi;
  let match;
  
  while ((match = pattern.exec(xhtml)) !== null) {
    const id = match[1];
    const fullTag = match[0];
    const titleMatch = fullTag.match(/title=["']([^"']*)["']/i);
    
    placeholders.push({
      id,
      title: titleMatch ? titleMatch[1] : '',
      className: fullTag.match(/class=["']([^"']*)["']/i)?.[1] || ''
    });
  }
  
  return placeholders;
}

/**
 * Apply reflowable CSS reset to XHTML
 * @param {string} xhtml - The XHTML content
 * @returns {string} - XHTML with reflowable CSS applied
 */
export function applyReflowableCss(xhtml) {
  // Remove fixed-layout styles and make it reflowable
  let modified = xhtml;
  
  // Replace fixed viewport with responsive
  modified = modified.replace(
    /<meta\s+name=["']viewport["'][^>]*>/gi,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>'
  );
  
  // Add or update style tag with reflowable CSS
  const reflowableStyles = `
    /* Reflowable EPUB Styles */
    body {
      margin: 0;
      padding: 1em;
      font-family: serif;
      max-width: 100%;
      overflow-x: hidden;
    }
    
    .page, .container {
      position: relative !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      min-height: auto !important;
      display: block !important;
      flex-direction: column !important;
    }
    
    img {
      max-width: 100% !important;
      height: auto !important;
      display: block !important;
      margin: 1em auto !important;
    }
    
    .image-placeholder, .image-drop-zone {
      min-height: 100px;
      border: 2px dashed #ccc;
      background-color: #f9f9f9;
      margin: 1em 0;
      padding: 1em;
      text-align: center;
      color: #999;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .image-placeholder:hover, .image-drop-zone:hover {
      border-color: #4CAF50;
      background-color: #f0f8f0;
    }
    
    .image-placeholder.drag-over, .image-drop-zone.drag-over {
      border-color: #2196F3;
      background-color: #e3f2fd;
    }
    
    /* Background Image Styles */
    .has-background-image {
      position: relative !important;
      min-height: 200px;
      background-size: cover !important;
      background-position: center !important;
      background-repeat: no-repeat !important;
    }
    
    .has-background-image > * {
      position: relative;
      z-index: 1;
    }
    
    .has-background-image p,
    .has-background-image span,
    .has-background-image div,
    .has-background-image h1,
    .has-background-image h2,
    .has-background-image h3,
    .has-background-image h4,
    .has-background-image h5,
    .has-background-image h6,
    .has-background-image li,
    .has-background-image td,
    .has-background-image th {
      position: relative;
      z-index: 2;
      background-color: rgba(255, 255, 255, 0.85);
      padding: 0.25em 0.5em;
      margin: 0.25em 0;
      border-radius: 2px;
    }
  `;
  
  // Check if style tag exists
  if (modified.includes('<style')) {
    // Append to existing style tag
    modified = modified.replace(
      /(<style[^>]*>)/i,
      `$1${reflowableStyles}`
    );
  } else {
    // Add new style tag in head
    if (modified.includes('</head>')) {
      modified = modified.replace('</head>', `<style type="text/css">${reflowableStyles}</style></head>`);
    } else if (modified.includes('<body>')) {
      modified = modified.replace('<body>', `<head><style type="text/css">${reflowableStyles}</style></head><body>`);
    }
  }
  
  return modified;
}

