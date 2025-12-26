import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { getEpubOutputDir } from '../config/fileStorage.js';
import { JSDOM } from 'jsdom';

/**
 * EPUB Service
 * Extracts and parses content from generated EPUB files
 */
export class EpubService {
  /**
   * Sanitize XHTML content to fix common XML parsing issues
   * @param {string} xhtmlContent - Raw XHTML content
   * @returns {string} - Sanitized XHTML content
   */
  static sanitizeXhtml(xhtmlContent) {
    if (!xhtmlContent || typeof xhtmlContent !== 'string') {
      return xhtmlContent;
    }
    
    // Remove BOM and leading whitespace that might cause "text data outside of root node" errors
    let sanitized = xhtmlContent.trim();
    
    // Handle double-escaped backslashes first (\\\\ -> \)
    sanitized = sanitized.replace(/\\\\/g, '\\');
    
    // Fix escaped quotes (e.g., \" should be ", but handle both single and double escapes)
    sanitized = sanitized.replace(/\\"/g, '"');
    sanitized = sanitized.replace(/\\'/g, "'");
    
    // Fix escaped newlines and other escape sequences
    sanitized = sanitized.replace(/\\n/g, '\n');
    sanitized = sanitized.replace(/\\r/g, '\r');
    sanitized = sanitized.replace(/\\t/g, '\t');
    
    // Remove any content before DOCTYPE (common issue causing "text data outside of root node")
    const doctypeMatch = sanitized.match(/<!DOCTYPE\s+html[^>]*>/i);
    if (doctypeMatch && doctypeMatch.index > 0) {
      // There's content before DOCTYPE, remove it
      sanitized = sanitized.substring(doctypeMatch.index);
    }
    
    // Normalize DOCTYPE declaration - replace entire DOCTYPE with correct one
    const correctDoctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
    
    // Find DOCTYPE start
    const doctypeStart = sanitized.indexOf('<!DOCTYPE');
    if (doctypeStart !== -1) {
      // Find the next > character (this should be the end of DOCTYPE)
      // We'll look for the first > after <!DOCTYPE, up to 200 chars (DOCTYPE shouldn't be longer)
      const searchEnd = Math.min(doctypeStart + 200, sanitized.length);
      const doctypeSection = sanitized.substring(doctypeStart, searchEnd);
      const doctypeEndMatch = doctypeSection.match(/>/);
      
      if (doctypeEndMatch) {
        const doctypeEnd = doctypeStart + doctypeEndMatch.index + 1;
        // Replace the entire DOCTYPE with the correct one
        sanitized = sanitized.substring(0, doctypeStart) + correctDoctype + sanitized.substring(doctypeEnd);
      } else {
        // If we can't find the end, try regex replacement as fallback
        sanitized = sanitized.replace(/<!DOCTYPE[^>]*>/i, correctDoctype);
      }
    }
    
    // Fix meta tags to be self-closing (XHTML requirement)
    // Convert <meta ...> to <meta .../> for all meta tags that aren't already self-closing
    sanitized = sanitized.replace(/<meta([^>]*?)>/gi, (match, attrs) => {
      // Check if already self-closing (ends with /> or has /> before the closing >)
      if (match.includes('/>') || attrs.trim().endsWith('/')) {
        return match; // Already self-closing
      }
      // Add / before the closing >
      return `<meta${attrs}/>`;
    });
    
    // Fix img tags to be self-closing (XHTML requirement)
    // Convert <img ...> to <img .../> for all img tags that aren't already self-closing
    sanitized = sanitized.replace(/<img([^>]*?)>/gi, (match, attrs) => {
      // Check if already self-closing (ends with /> or has /> before the closing >)
      if (match.includes('/>') || attrs.trim().endsWith('/')) {
        return match; // Already self-closing
      }
      // Add / before the closing >
      return `<img${attrs}/>`;
    });
    
    // Fix br tags to be self-closing (XHTML requirement)
    // Convert <br> or <br ...> to <br /> or <br .../> for all br tags that aren't already self-closing
    sanitized = sanitized.replace(/<br\s*([^>]*?)>/gi, (match, attrs) => {
      // Check if already self-closing (ends with /> or has /> before the closing >)
      if (match.includes('/>') || attrs.trim().endsWith('/')) {
        return match; // Already self-closing
      }
      // Add / before the closing >, or just <br /> if no attributes
      if (!attrs || attrs.trim() === '') {
        return '<br />';
      }
      return `<br ${attrs.trim()}/>`;
    });
    
    // Fix hr tags to be self-closing (XHTML requirement)
    // Convert <hr> or <hr ...> to <hr /> or <hr .../> for all hr tags that aren't already self-closing
    sanitized = sanitized.replace(/<hr\s*([^>]*?)>/gi, (match, attrs) => {
      // Check if already self-closing (ends with /> or has /> before the closing >)
      if (match.includes('/>') || attrs.trim().endsWith('/')) {
        return match; // Already self-closing
      }
      // Add / before the closing >, or just <hr /> if no attributes
      if (!attrs || attrs.trim() === '') {
        return '<hr />';
      }
      return `<hr ${attrs.trim()}/>`;
    });
    
    // Fix common DOCTYPE URL typo
    sanitized = sanitized.replace(
      /http:\/\/www\.w3\.org\/TR\/xhtml\/DTD\/xhtml1-strict\.dtd/gi,
      'http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd'
    );
    
    // Escape bare ampersands that are not part of an entity (but avoid double-escaping)
    sanitized = sanitized.replace(/&(?!#?[a-zA-Z0-9]+;)(?![#][0-9]+;)/g, '&amp;');
    
    // Fix undefined entities (common ones that might appear)
    sanitized = sanitized.replace(/&nbsp;/g, '&#160;');
    sanitized = sanitized.replace(/&copy;/g, '&#169;');
    sanitized = sanitized.replace(/&reg;/g, '&#174;');
    sanitized = sanitized.replace(/&trade;/g, '&#8482;');
    sanitized = sanitized.replace(/&mdash;/g, '&#8212;');
    sanitized = sanitized.replace(/&ndash;/g, '&#8211;');
    sanitized = sanitized.replace(/&hellip;/g, '&#8230;');
    
    // Ensure the document starts with DOCTYPE (add if missing)
    if (!sanitized.trim().startsWith('<!DOCTYPE')) {
      sanitized = correctDoctype + '\n' + sanitized;
    }
    
    // Ensure there's a newline after DOCTYPE before <html> tag
    // This fixes "Start tag expected" errors
    sanitized = sanitized.replace(
      /(<!DOCTYPE[^>]+>)([^\n<])/,
      '$1\n$2'
    );
    
    // Ensure <html> tag comes right after DOCTYPE (with optional whitespace)
    sanitized = sanitized.replace(
      /<!DOCTYPE[^>]+>\s*<html/,
      correctDoctype + '\n<html'
    );
    
    // Fix duplicate class attributes: <div class="foo" class="bar"> -> <div class="foo bar">
    sanitized = sanitized.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)class="([^"]*)"([^>]*?)class="([^"]*)"([^>]*)>/gi, 
      (match, tagName, before, class1, middle, class2, after) => {
        const mergedClasses = `${class1} ${class2}`.trim();
        let cleanMiddle = middle.replace(/\s*class="[^"]*"\s*/gi, ' ');
        let cleanAfter = after.replace(/\s*class="[^"]*"\s*/gi, ' ');
        return `<${tagName} ${before}class="${mergedClasses}"${cleanMiddle}${cleanAfter}>`;
      }
    );
    
    // Run again in case there were more than 2 class attributes
    sanitized = sanitized.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)class="([^"]*)"([^>]*?)class="([^"]*)"([^>]*)>/gi, 
      (match, tagName, before, class1, middle, class2, after) => {
        const mergedClasses = `${class1} ${class2}`.trim();
        let cleanMiddle = middle.replace(/\s*class="[^"]*"\s*/gi, ' ');
        let cleanAfter = after.replace(/\s*class="[^"]*"\s*/gi, ' ');
        return `<${tagName} ${before}class="${mergedClasses}"${cleanMiddle}${cleanAfter}>`;
      }
    );
    
    // Fix duplicate id attributes (keep only the first one)
    sanitized = sanitized.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)id="([^"]*)"([^>]*?)id="[^"]*"([^>]*)>/gi, 
      (match, tagName, before, id, middle, after) => {
        let cleanMiddle = middle.replace(/\s*id="[^"]*"\s*/gi, ' ');
        let cleanAfter = after.replace(/\s*id="[^"]*"\s*/gi, ' ');
        return `<${tagName} ${before}id="${id}"${cleanMiddle}${cleanAfter}>`;
      }
    );
    
    // Clean up multiple spaces in tags
    sanitized = sanitized.replace(/\s+>/g, '>');
    sanitized = sanitized.replace(/<(\w+)\s+/g, '<$1 ');
    
    return sanitized;
  }

  /**
   * Extract EPUB sections/chapters from the actual EPUB file
   * @param {number} jobId - Conversion job ID
   * @returns {Promise<Array>} - Array of section objects
   */
  static async getEpubSections(jobId) {
    const epubOutputDir = getEpubOutputDir();
    
    // Try multiple possible EPUB file names
    const possibleNames = [
      `epub_${jobId}.epub`,
      `converted_${jobId}.epub`,
      `job_${jobId}.epub`
    ];
    
    let epubFilePath = null;
    const checkedPaths = [];
    
    // First, try default output directory with common filename patterns
    for (const fileName of possibleNames) {
      const filePath = path.join(epubOutputDir, fileName);
      checkedPaths.push(filePath);
      try {
        await fs.access(filePath);
        epubFilePath = filePath;
        console.log(`[EPUB Service] Found EPUB file at: ${filePath}`);
        break;
      } catch {
        continue;
      }
    }
    
    // Also check if job has epubFilePath stored
    if (!epubFilePath) {
      try {
        const { ConversionJobModel } = await import('../models/ConversionJob.js');
        const job = await ConversionJobModel.findById(jobId);
        if (job && job.epub_file_path) {
          // Try the stored path as-is
          checkedPaths.push(job.epub_file_path);
          try {
            await fs.access(job.epub_file_path);
            epubFilePath = job.epub_file_path;
            console.log(`[EPUB Service] Found EPUB file at stored path: ${epubFilePath}`);
          } catch {
            // File path in DB but doesn't exist - try extracting filename and checking default dir
            const storedFileName = path.basename(job.epub_file_path);
            const fallbackPath = path.join(epubOutputDir, storedFileName);
            checkedPaths.push(fallbackPath);
            try {
              await fs.access(fallbackPath);
              epubFilePath = fallbackPath;
              console.log(`[EPUB Service] Found EPUB file at fallback path: ${epubFilePath}`);
            } catch {
              // File not found at fallback path either
            }
          }
        }
      } catch (error) {
        console.warn('[EPUB Service] Could not check job epub_file_path:', error.message);
      }
    }
    
    if (!epubFilePath) {
      const errorMsg = `EPUB file not found for job: ${jobId}. Checked paths: ${checkedPaths.join(', ')}. Output directory: ${epubOutputDir}`;
      console.error(`[EPUB Service] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    try {
      console.log(`[EPUB Service] Reading EPUB file from: ${epubFilePath}`);
      
      // Read and parse EPUB file
      const epubData = await fs.readFile(epubFilePath);
      const zip = await JSZip.loadAsync(epubData);
      
      console.log(`[EPUB Service] EPUB loaded, checking for OPF file...`);
      
      // Try multiple possible OPF file paths
      let opfFile = zip.file('OEBPS/content.opf') || 
                    zip.file('content.opf');
      
      if (!opfFile) {
        // Try to find any OPF file
        const opfFiles = Object.keys(zip.files).filter(name => name.endsWith('.opf'));
        console.log(`[EPUB Service] OPF file not found at expected location. Found OPF files:`, opfFiles.slice(0, 10));
        if (opfFiles.length > 0) {
          opfFile = zip.file(opfFiles[0]);
        }
      }
      
      if (!opfFile) {
        throw new Error('OPF file not found in EPUB');
      }
      
      console.log(`[EPUB Service] OPF file found: ${opfFile.name}`);
      
      const opfContent = await opfFile.async('string');
      const opfDom = new JSDOM(opfContent, { contentType: 'application/xml' });
      const opfDoc = opfDom.window.document;
      
      // Extract manifest items
      const manifestItems = {};
      const manifest = opfDoc.querySelector('manifest');
      
      if (manifest) {
        const items = manifest.querySelectorAll('item');
        console.log(`[EPUB Service] Found ${items.length} items in manifest`);
        
        items.forEach(item => {
          const id = item.getAttribute('id');
          const href = item.getAttribute('href');
          const mediaType = item.getAttribute('media-type');
          
          // Handle both application/xhtml+xml and text/html media types, or files ending in .xhtml/.html
          if (id && href && (
            mediaType === 'application/xhtml+xml' || 
            mediaType === 'text/html' || 
            href.endsWith('.xhtml') || 
            href.endsWith('.html')
          )) {
            // Normalize href path based on OPF file location
            let normalizedHref = href;
            const opfDir = opfFile.name.substring(0, opfFile.name.lastIndexOf('/'));
            
            if (opfDir && !normalizedHref.startsWith(opfDir) && !normalizedHref.startsWith('/')) {
              normalizedHref = `${opfDir}/${normalizedHref}`;
            } else if (!normalizedHref.startsWith('OEBPS/') && !normalizedHref.startsWith('/')) {
              normalizedHref = `OEBPS/${normalizedHref}`;
            }
            
            manifestItems[id] = {
              id,
              href: normalizedHref,
              mediaType: mediaType || 'application/xhtml+xml'
            };
            
            console.log(`[EPUB Service] Manifest item: ${id} -> ${normalizedHref}`);
          }
        });
      }
      
      console.log(`[EPUB Service] Extracted ${Object.keys(manifestItems).length} XHTML manifest items`);
      
      // Extract spine order
      const spine = opfDoc.querySelector('spine');
      const sections = [];
      
      if (spine) {
        const itemrefs = spine.querySelectorAll('itemref');
        let sectionIndex = 1;
        
        for (const itemref of itemrefs) {
          const idref = itemref.getAttribute('idref');
          const manifestItem = manifestItems[idref];
          
          if (manifestItem) {
            try {
              // Read XHTML file from EPUB
              let xhtmlFile = zip.file(manifestItem.href);
              
              // Try alternative paths if not found
              if (!xhtmlFile) {
                // Try without OEBPS prefix
                const altHref = manifestItem.href.replace(/^OEBPS\//, '');
                xhtmlFile = zip.file(altHref);
              }
              
              // Try to find by filename only
              if (!xhtmlFile) {
                const fileName = manifestItem.href.split('/').pop();
                xhtmlFile = Object.keys(zip.files).find(name => 
                  name.endsWith(fileName) && zip.file(name)
                ) ? zip.file(Object.keys(zip.files).find(name => name.endsWith(fileName))) : null;
              }
              
              if (xhtmlFile) {
                console.log(`[EPUB Service] Reading XHTML file: ${xhtmlFile.name}`);
                let xhtmlContent = await xhtmlFile.async('string');
                
                // Sanitize XHTML before parsing to fix malformed DOCTYPEs and entities
                xhtmlContent = EpubService.sanitizeXhtml(xhtmlContent);
                
                // Parse XHTML to extract title - try XHTML first, fallback to HTML if it fails
                let xhtmlDom, xhtmlDoc;
                try {
                  xhtmlDom = new JSDOM(xhtmlContent, { contentType: 'application/xhtml+xml' });
                  xhtmlDoc = xhtmlDom.window.document;
                } catch (parseError) {
                  console.warn(`[EPUB Service] XHTML parsing failed for ${xhtmlFile.name}, trying HTML fallback:`, parseError.message);
                  // Fallback to HTML parsing (more lenient)
                  try {
                    xhtmlDom = new JSDOM(xhtmlContent, { contentType: 'text/html' });
                    xhtmlDoc = xhtmlDom.window.document;
                  } catch (htmlError) {
                    console.error(`[EPUB Service] Both XHTML and HTML parsing failed for ${xhtmlFile.name}:`, htmlError.message);
                    throw htmlError;
                  }
                }
                
                // Try to find title from various sources
                let title = `Chapter ${sectionIndex}`;
                const titleElement = xhtmlDoc.querySelector('title');
                if (titleElement) {
                  title = titleElement.textContent || title;
                }
                
                const h1 = xhtmlDoc.querySelector('h1');
                if (h1) {
                  title = h1.textContent || title;
                }
                
                const section = xhtmlDoc.querySelector('section[epub\\:type="chapter"]');
                if (section) {
                  const sectionH1 = section.querySelector('h1');
                  if (sectionH1) {
                    title = sectionH1.textContent || title;
                  }
                }
                
                sections.push({
                  id: idref,
                  title: title.trim(),
                  href: manifestItem.href,
                  xhtml: xhtmlContent
                });
                
                console.log(`[EPUB Service] Added section: ${idref} - "${title.trim()}"`);
                sectionIndex++;
              } else {
                console.warn(`[EPUB Service] XHTML file not found: ${manifestItem.href}`);
              }
            } catch (error) {
              console.error(`[EPUB Service] Error reading section ${idref}:`, error);
            }
          }
        }
      }
      
      // If no sections found via spine, try to find all XHTML files
      if (sections.length === 0) {
        const xhtmlFiles = Object.keys(zip.files).filter(name => 
          name.endsWith('.xhtml') && name.includes('OEBPS')
        );
        
        for (let i = 0; i < xhtmlFiles.length; i++) {
          const fileName = xhtmlFiles[i];
          try {
            const xhtmlFile = zip.file(fileName);
            if (xhtmlFile) {
              let xhtmlContent = await xhtmlFile.async('string');
              
              // Sanitize XHTML before parsing to fix malformed DOCTYPEs and entities
              xhtmlContent = EpubService.sanitizeXhtml(xhtmlContent);
              
              // Parse XHTML - try XHTML first, fallback to HTML if it fails
              let xhtmlDom, xhtmlDoc;
              try {
                xhtmlDom = new JSDOM(xhtmlContent, { contentType: 'application/xhtml+xml' });
                xhtmlDoc = xhtmlDom.window.document;
              } catch (parseError) {
                console.warn(`[EPUB Service] XHTML parsing failed for ${fileName}, trying HTML fallback:`, parseError.message);
                // Fallback to HTML parsing (more lenient)
                try {
                  xhtmlDom = new JSDOM(xhtmlContent, { contentType: 'text/html' });
                  xhtmlDoc = xhtmlDom.window.document;
                } catch (htmlError) {
                  console.error(`[EPUB Service] Both XHTML and HTML parsing failed for ${fileName}:`, htmlError.message);
                  throw htmlError;
                }
              }
              
              let title = `Chapter ${i + 1}`;
              const titleElement = xhtmlDoc.querySelector('title');
              if (titleElement) {
                title = titleElement.textContent || title;
              }
              
              const h1 = xhtmlDoc.querySelector('h1');
              if (h1) {
                title = h1.textContent || title;
              }
              
              sections.push({
                id: `section_${i + 1}`,
                title: title.trim(),
                href: fileName,
                xhtml: xhtmlContent
              });
            }
          } catch (error) {
            console.warn(`[EPUB Service] Error reading XHTML file ${fileName}:`, error.message);
          }
        }
      }
      
      if (sections.length === 0) {
        throw new Error('No sections found in EPUB file');
      }
      
      console.log(`[EPUB Service] Successfully extracted ${sections.length} sections from EPUB`);
      return sections;
    } catch (error) {
      console.error('[EPUB Service] Error parsing EPUB:', error);
      console.error('[EPUB Service] Stack trace:', error.stack);
      throw new Error('Failed to parse EPUB file: ' + error.message);
    }
  }

  /**
   * Extract text content from EPUB (plain text version)
   * @param {number} jobId - Conversion job ID
   * @returns {Promise<Array>} - Array of text content objects
   */
  static async getEpubTextContent(jobId) {
    const sections = await this.getEpubSections(jobId);
    
    return sections.map(section => {
      // Sanitize XHTML before parsing (in case it wasn't sanitized earlier)
      const sanitizedXhtml = EpubService.sanitizeXhtml(section.xhtml);
      
      // Extract plain text from XHTML - try XHTML first, fallback to HTML if it fails
      let dom, doc;
      try {
        dom = new JSDOM(sanitizedXhtml, { contentType: 'application/xhtml+xml' });
        doc = dom.window.document;
      } catch (parseError) {
        // Fallback to HTML parsing (more lenient)
        dom = new JSDOM(sanitizedXhtml, { contentType: 'text/html' });
        doc = dom.window.document;
      }
      const body = doc.body;
      
      // Remove script and style elements
      const scripts = body.querySelectorAll('script, style');
      scripts.forEach(el => el.remove());
      
      const text = body.textContent || body.innerText || '';
      
      return {
        sectionId: section.id,
        title: section.title,
        text: text.trim(),
        xhtml: section.xhtml
      };
    });
  }

  /**
   * Get CSS file from EPUB
   * @param {number} jobId - Conversion job ID
   * @returns {Promise<string>} - CSS content
   */
  static async getEpubCss(jobId) {
    const epubOutputDir = getEpubOutputDir();
    
    // Try multiple possible EPUB file names
    const possibleNames = [
      `epub_${jobId}.epub`,
      `converted_${jobId}.epub`,
      `job_${jobId}.epub`
    ];
    
    let epubFilePath = null;
    for (const fileName of possibleNames) {
      const filePath = path.join(epubOutputDir, fileName);
      try {
        await fs.access(filePath);
        epubFilePath = filePath;
        break;
      } catch {
        continue;
      }
    }
    
    if (!epubFilePath) {
      try {
        const { ConversionJobModel } = await import('../models/ConversionJob.js');
        const job = await ConversionJobModel.findById(jobId);
        if (job && job.epub_file_path) {
          try {
            await fs.access(job.epub_file_path);
            epubFilePath = job.epub_file_path;
          } catch {
            // File path in DB but doesn't exist
          }
        }
      } catch (error) {
        console.warn('[EPUB Service] Could not check job epub_file_path:', error.message);
      }
    }
    
    if (!epubFilePath) {
      throw new Error('EPUB file not found for job: ' + jobId);
    }
    
    try {
      const epubData = await fs.readFile(epubFilePath);
      const zip = await JSZip.loadAsync(epubData);
      
      // Find CSS file
      const cssFile = zip.file('OEBPS/styles.css') || 
                      zip.file('styles.css') ||
                      Object.keys(zip.files).find(name => name.endsWith('styles.css') && zip.file(name));
      
      if (cssFile) {
        return await cssFile.async('string');
      }
      
      return '/* No CSS found in EPUB */';
    } catch (error) {
      console.error('[EPUB Service] Error reading CSS:', error);
      throw new Error('Failed to read CSS from EPUB: ' + error.message);
    }
  }
  
  /**
   * Get image file from EPUB
   * @param {number} jobId - Conversion job ID
   * @param {string} imageName - Image file name
   * @returns {Promise<Buffer>} - Image data
   */
  static async getEpubImage(jobId, imageName) {
    const epubOutputDir = getEpubOutputDir();
    
    // Try multiple possible EPUB file names
    const possibleNames = [
      `epub_${jobId}.epub`,
      `converted_${jobId}.epub`,
      `job_${jobId}.epub`
    ];
    
    let epubFilePath = null;
    for (const fileName of possibleNames) {
      const filePath = path.join(epubOutputDir, fileName);
      try {
        await fs.access(filePath);
        epubFilePath = filePath;
        break;
      } catch {
        continue;
      }
    }
    
    if (!epubFilePath) {
      try {
        const { ConversionJobModel } = await import('../models/ConversionJob.js');
        const job = await ConversionJobModel.findById(jobId);
        if (job && job.epub_file_path) {
          try {
            await fs.access(job.epub_file_path);
            epubFilePath = job.epub_file_path;
          } catch {
            // File path in DB but doesn't exist
          }
        }
      } catch (error) {
        console.warn('[EPUB Service] Could not check job epub_file_path:', error.message);
      }
    }
    
    if (!epubFilePath) {
      throw new Error('EPUB file not found for job: ' + jobId);
    }
    
    try {
      const epubData = await fs.readFile(epubFilePath);
      const zip = await JSZip.loadAsync(epubData);
      
      // Try multiple possible image paths
      const imagePaths = [
        `OEBPS/${imageName}`,
        `OEBPS/images/${imageName}`,
        `images/${imageName}`,
        imageName
      ];
      
      for (const imagePath of imagePaths) {
        const imageFile = zip.file(imagePath);
        if (imageFile) {
          return await imageFile.async('nodebuffer');
        }
      }
      
      throw new Error(`Image ${imageName} not found in EPUB`);
    } catch (error) {
      console.error('[EPUB Service] Error reading image:', error);
      throw new Error('Failed to read image from EPUB: ' + error.message);
    }
  }

  /**
   * Get XHTML content for a specific section
   * @param {number} jobId - Conversion job ID
   * @param {string} sectionId - Section ID (can be string like "page1" or numeric ID)
   * @returns {Promise<string>} - XHTML content
   */
  static async getSectionXhtml(jobId, sectionId) {
    try {
      const sections = await this.getEpubSections(jobId);
      
      console.log(`[EPUB Service] Looking for section ${sectionId} in ${sections.length} sections`);
      console.log(`[EPUB Service] Available section IDs:`, sections.map(s => s.id));
      
      // Try multiple matching strategies
      let section = sections.find(s => 
        s.id === sectionId || 
        s.id === String(sectionId) ||
        s.id === `section_${sectionId}` ||
        String(s.id) === String(sectionId)
      );
      
      // If still not found, try to parse as number and match by index
      if (!section && !isNaN(parseInt(sectionId))) {
        const index = parseInt(sectionId) - 1;
        if (index >= 0 && index < sections.length) {
          section = sections[index];
        }
      }
      
      // If sectionId is like "page1", try to extract the number
      if (!section && sectionId.toLowerCase().startsWith('page')) {
        const pageNum = parseInt(sectionId.replace(/^page/i, ''));
        if (!isNaN(pageNum)) {
          section = sections.find(s => {
            // Try to match by title containing page number
            return s.title && s.title.toLowerCase().includes(`page ${pageNum}`);
          }) || sections[pageNum - 1];
        }
      }
      
      if (!section) {
        throw new Error(`Section "${sectionId}" not found. Available sections: ${sections.map(s => s.id).join(', ')}`);
      }
      
      console.log(`[EPUB Service] Found section: ${section.id} - ${section.title}`);
      return section.xhtml;
    } catch (error) {
      console.error(`[EPUB Service] Error in getSectionXhtml:`, error);
      throw error;
    }
  }
}
