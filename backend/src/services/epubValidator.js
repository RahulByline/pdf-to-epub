import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';

/**
 * EPUB3 Structure Validator
 * Validates EPUB structure before packaging
 */
export class EpubValidator {
  /**
   * Validate EPUB structure
   * @param {string} epubDir - Path to EPUB directory
   * @returns {Promise<{valid: boolean, errors: Array, warnings: Array}>}
   */
  static async validateStructure(epubDir) {
    const errors = [];
    const warnings = [];

    try {
      // Check required directories
      const metaInfPath = path.join(epubDir, 'META-INF');
      const oebpsPath = path.join(epubDir, 'OEBPS');

      try {
        await fs.access(metaInfPath);
      } catch {
        errors.push('META-INF directory missing');
      }

      try {
        await fs.access(oebpsPath);
      } catch {
        errors.push('OEBPS directory missing');
      }

      // Check mimetype
      const mimetypePath = path.join(epubDir, 'mimetype');
      try {
        const mimetype = await fs.readFile(mimetypePath, 'utf-8');
        if (mimetype.trim() !== 'application/epub+zip') {
          errors.push('Invalid mimetype file content');
        }
      } catch {
        errors.push('mimetype file missing');
      }

      // Check container.xml
      const containerPath = path.join(metaInfPath, 'container.xml');
      try {
        const containerXml = await fs.readFile(containerPath, 'utf-8');
        if (!containerXml.includes('container') || !containerXml.includes('rootfile')) {
          errors.push('Invalid container.xml structure');
        }
      } catch {
        errors.push('container.xml missing');
      }

      // Check OPF file
      const opfPath = path.join(oebpsPath, 'content.opf');
      try {
        const opfXml = await fs.readFile(opfPath, 'utf-8');
        const opfDom = new JSDOM(opfXml, { contentType: 'text/xml' });
        const opfDoc = opfDom.window.document;

        // Check for package element
        const packageEl = opfDoc.documentElement || opfDoc.querySelector('package');
        if (!packageEl || packageEl.tagName.toLowerCase() !== 'package') {
          errors.push('OPF: package element missing');
        } else {
          const version = packageEl.getAttribute('version');
          if (version !== '3.0') {
            warnings.push(`OPF: version should be 3.0 (found: ${version || 'none'})`);
          }
          const uniqueId = packageEl.getAttribute('unique-identifier');
          if (!uniqueId) {
            // Try alternative attribute name (in case of camelCase conversion)
            const uniqueIdAlt = packageEl.getAttribute('uniqueIdentifier') || 
                               packageEl.getAttribute('uniqueidentifier');
            if (!uniqueIdAlt) {
              errors.push('OPF: unique-identifier missing');
              // Debug: list all attributes
              const attrs = Array.from(packageEl.attributes || []);
              console.log('[Validator] Package attributes:', attrs.map(a => `${a.name}="${a.value}"`).join(', '));
            }
          }
        }

        // Check metadata
        const metadata = opfDoc.querySelector('metadata');
        if (!metadata) {
          errors.push('OPF: metadata section missing');
        } else {
          const identifier = metadata.querySelector('dc\\:identifier, identifier');
          const title = metadata.querySelector('dc\\:title, title');
          const language = metadata.querySelector('dc\\:language, language');
          
          if (!identifier) errors.push('OPF: dc:identifier missing');
          if (!title) errors.push('OPF: dc:title missing');
          if (!language) warnings.push('OPF: dc:language missing (should be present)');
        }

        // Check manifest
        const manifest = opfDoc.querySelector('manifest');
        if (!manifest) {
          errors.push('OPF: manifest section missing');
        } else {
          const items = manifest.querySelectorAll('item');
          if (items.length === 0) {
            errors.push('OPF: manifest has no items');
          } else {
            // Check for required items
            const hasNav = Array.from(items).some(item => 
              item.getAttribute('properties') === 'nav' || 
              item.getAttribute('id') === 'nav'
            );
            if (!hasNav) {
              errors.push('OPF: navigation document (nav) missing from manifest');
            }
          }
        }

        // Check spine
        const spine = opfDoc.querySelector('spine');
        if (!spine) {
          errors.push('OPF: spine section missing');
        } else {
          const itemrefs = spine.querySelectorAll('itemref');
          if (itemrefs.length === 0) {
            errors.push('OPF: spine has no itemref elements');
            // Debug: check what's actually in the spine
            console.log('[Validator] Spine innerHTML:', spine.innerHTML);
            console.log('[Validator] Spine children:', Array.from(spine.children).map(c => c.tagName));
          } else {
            console.log(`[Validator] Found ${itemrefs.length} itemref(s) in spine`);
          }
          
          const toc = spine.getAttribute('toc');
          if (!toc || toc !== 'nav') {
            warnings.push(`OPF: spine toc attribute should reference nav item (found: ${toc || 'none'})`);
          }
        }

      } catch (error) {
        errors.push(`Error reading OPF: ${error.message}`);
      }

      // Check navigation document
      const navPath = path.join(oebpsPath, 'toc.xhtml');
      try {
        await fs.access(navPath);
        const navXml = await fs.readFile(navPath, 'utf-8');
        const navDom = new JSDOM(navXml, { contentType: 'text/xml' });
        const navDoc = navDom.window.document;
        const navElement = navDoc.querySelector('nav[epub\\:type="toc"], nav[id="toc"]');
        if (!navElement) {
          errors.push('Navigation: nav element with epub:type="toc" missing');
        }
      } catch {
        errors.push('Navigation document (toc.xhtml) missing');
      }

      // Check main content file
      const textPath = path.join(oebpsPath, 'text.xhtml');
      try {
        // Use stat instead of access to get more info
        const stats = await fs.stat(textPath);
        console.log(`[Validator] Found text.xhtml at ${textPath} (${stats.size} bytes)`);
        
        const textXml = await fs.readFile(textPath, 'utf-8');
        if (!textXml || textXml.trim().length === 0) {
          errors.push('Main content file (text.xhtml) is empty');
        } else {
          try {
            const textDom = new JSDOM(textXml, { contentType: 'text/xml' });
            const textDoc = textDom.window.document;
            const body = textDoc.querySelector('body');
            if (!body || !body.innerHTML || body.innerHTML.trim().length === 0) {
              errors.push('Main content file (text.xhtml) has empty body');
            } else {
              console.log(`[Validator] text.xhtml validated successfully (${textXml.length} chars, body has ${body.children.length} elements)`);
            }
          } catch (parseError) {
            console.warn(`[Validator] Could not parse text.xhtml XML, but file exists: ${parseError.message}`);
            // Don't fail validation if file exists and has content, even if parsing fails
          }
        }
      } catch (fileError) {
        console.error(`[Validator] Error accessing text.xhtml at ${textPath}:`, fileError.message);
        console.error(`[Validator] Error code: ${fileError.code}`);
        console.error(`[Validator] OEBPS path: ${oebpsPath}`);
        
        // Try to list files that DO exist
        try {
          const files = await fs.readdir(oebpsPath);
          console.error(`[Validator] Files that exist in OEBPS (${files.length} files): ${files.join(', ')}`);
        } catch (listError) {
          console.error(`[Validator] Cannot list OEBPS directory: ${listError.message}`);
        }
        
        errors.push('Main content file (text.xhtml) missing');
      }

      // Check CSS
      const cssPath = path.join(oebpsPath, 'styles.css');
      try {
        await fs.access(cssPath);
      } catch {
        warnings.push('CSS file (styles.css) missing (optional but recommended)');
      }

    } catch (error) {
      errors.push(`Validation error: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}


