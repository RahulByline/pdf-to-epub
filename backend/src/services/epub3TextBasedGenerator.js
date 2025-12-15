import fs from 'fs/promises';
import path from 'path';
import { create } from 'xmlbuilder2';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { SemanticXhtmlGenerator } from './semanticXhtmlGenerator.js';
import { EpubValidator } from './epubValidator.js';

/**
 * EPUB3 Text-Based Generator
 * Creates EPUB3 with real XHTML text (NOT images)
 * Supports text selection, tracing, and audio synchronization
 */
export class Epub3TextBasedGenerator {
  constructor(outputDir, jobId) {
    this.outputDir = outputDir;
    this.jobId = jobId;
    this.tempEpubDir = path.join(outputDir, `temp_epub_text_${jobId}`);
    this.pages = [];
    this.audioMappings = [];
    this.metadata = {
      title: 'Untitled Document',
      author: 'Unknown',
      language: 'en',
      identifier: `urn:uuid:${uuidv4()}`
    };
  }
  
  /**
   * Generate EPUB3 package
   * @param {Array} structuredPages - Pages with classified text blocks
   * @param {string} audioFilePath - Path to audio file (optional)
   * @param {Array} audioMappings - Audio mappings for SMIL
   * @returns {Promise<string>} - Path to generated EPUB file
   */
  async generate(structuredPages, audioFilePath = null, audioMappings = []) {
    try {
      // Create directory structure
      await this.createDirectoryStructure();
      
      // Generate XHTML pages
      const xhtmlGenerator = new SemanticXhtmlGenerator();
      const oebpsDir = path.join(this.tempEpubDir, 'OEBPS');
      
      // Pass PDF file path for image extraction
      this.pages = await xhtmlGenerator.generatePages(structuredPages, oebpsDir, {
        pdfFilePath: structuredPages[0]?.pdfFilePath || null,
        useAI: true
      });
      
      // Generate CSS (preserves PDF styling)
      await xhtmlGenerator.generateCSS(oebpsDir);
      
      // Copy audio file if provided
      let audioFileName = null;
      if (audioFilePath) {
        audioFileName = await this.copyAudioFile(audioFilePath);
      }
      
      // Store audio mappings
      this.audioMappings = audioMappings;
      
      // Generate SMIL if audio exists
      if (audioFileName && audioMappings.length > 0) {
        await this.generateSMIL(audioFileName);
      }
      
      // Generate navigation document
      await this.generateNAV();
      
      // Generate OPF manifest
      await this.generateOPF(audioFileName);
      
      // Generate container.xml
      await this.generateContainer();
      
      // Create mimetype file
      await this.createMimetype();
      
      // Validate EPUB structure
      const validation = await EpubValidator.validateStructure(this.tempEpubDir);
      if (!validation.valid) {
        console.error('[EPUB3] Validation errors:', validation.errors);
        throw new Error(`EPUB structure validation failed: ${validation.errors.join('; ')}`);
      }
      
      // Package EPUB
      const epubPath = await this.packageEpub();
      
      // Cleanup
      await this.cleanup();
      
      return epubPath;
    } catch (error) {
      console.error('Error generating EPUB3:', error);
      await this.cleanup().catch(() => {});
      throw error;
    }
  }
  
  /**
   * Create EPUB3 directory structure
   */
  async createDirectoryStructure() {
    const dirs = [
      this.tempEpubDir,
      path.join(this.tempEpubDir, 'META-INF'),
      path.join(this.tempEpubDir, 'OEBPS')
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }
  
  /**
   * Copy audio file to EPUB structure
   */
  async copyAudioFile(audioPath) {
    const audioExt = path.extname(audioPath);
    const audioFileName = `audio${audioExt}`;
    const destPath = path.join(this.tempEpubDir, 'OEBPS', audioFileName);
    await fs.copyFile(audioPath, destPath);
    return audioFileName;
  }
  
  /**
   * Generate SMIL file for media overlays
   */
  async generateSMIL(audioFileName) {
    if (!this.audioMappings || this.audioMappings.length === 0) {
      return; // No mappings, skip SMIL
    }
    
    const root = create({ version: '1.0', encoding: 'UTF-8' });
    const smil = root.ele('smil', {
      xmlns: 'http://www.w3.org/ns/SMIL',
      version: '3.0'
    });
    const body = smil.ele('body');
    const seq = body.ele('seq', {
      'epub:textref': this.pages[0]?.href || 'chapter_1.xhtml'
    });
    
    // Create <par> elements for each mapping
    this.audioMappings.forEach((mapping) => {
      const par = seq.ele('par', { id: `par_${mapping.textId}` });
      par.ele('text', { src: `${mapping.href || this.pages[0]?.href || 'chapter_1.xhtml'}#${mapping.textId}` });
      par.ele('audio', {
        src: audioFileName,
        clipBegin: mapping.start || '0:00:00.000',
        clipEnd: mapping.end || '0:00:01.000'
      });
    });
    
    const smilXML = root.end({ prettyPrint: true });
    const smilPath = path.join(this.tempEpubDir, 'OEBPS', 'overlay.smil');
    await fs.writeFile(smilPath, smilXML, 'utf-8');
    console.log(`[EPUB3] Generated SMIL file with ${this.audioMappings.length} mappings`);
  }
  
  /**
   * Generate navigation document (NAV)
   */
  async generateNAV() {
    const dom = new (await import('jsdom')).JSDOM('<!DOCTYPE html>', {
      contentType: 'application/xhtml+xml'
    });
    const doc = dom.window.document;
    
    const html = doc.createElement('html');
    html.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    html.setAttribute('xmlns:epub', 'http://www.idpf.org/2007/ops');
    doc.appendChild(html);
    
    const head = doc.createElement('head');
    html.appendChild(head);
    
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'UTF-8');
    head.appendChild(meta);
    
    const title = doc.createElement('title');
    title.textContent = this.metadata.title;
    head.appendChild(title);
    
    const body = doc.createElement('body');
    html.appendChild(body);
    
    const nav = doc.createElement('nav');
    nav.setAttribute('epub:type', 'toc');
    nav.setAttribute('id', 'toc');
    body.appendChild(nav);
    
    const h1 = doc.createElement('h1');
    h1.textContent = 'Table of Contents';
    nav.appendChild(h1);
    
    const ol = doc.createElement('ol');
    nav.appendChild(ol);
    
    this.pages.forEach(page => {
      const li = doc.createElement('li');
      const a = doc.createElement('a');
      a.setAttribute('href', page.href);
      a.textContent = page.title;
      li.appendChild(a);
      ol.appendChild(li);
    });
    
    const navXML = `<?xml version="1.0" encoding="UTF-8"?>\n${doc.documentElement.outerHTML}`;
    const navPath = path.join(this.tempEpubDir, 'OEBPS', 'nav.xhtml');
    await fs.writeFile(navPath, navXML, 'utf-8');
  }
  
  /**
   * Generate OPF manifest
   */
  async generateOPF(audioFileName = null) {
    const root = create({ version: '1.0', encoding: 'UTF-8' });
    const packageEl = root.ele('package', {
      xmlns: 'http://www.idpf.org/2007/opf',
      version: '3.0',
      'unique-identifier': 'book-id'
    });
    
    // Metadata
    const metadata = packageEl.ele('metadata', {
      'xmlns:dc': 'http://purl.org/dc/elements/1.1/'
    });
    metadata.ele('dc:identifier', { id: 'book-id' }).text(this.metadata.identifier);
    metadata.ele('dc:title').text(this.metadata.title);
    metadata.ele('dc:language').text(this.metadata.language);
    metadata.ele('dc:creator').text(this.metadata.author);
    metadata.ele('meta', { property: 'dcterms:modified' }).text(new Date().toISOString());
    
    // Manifest
    const manifest = packageEl.ele('manifest');
    
    // Add XHTML pages
    this.pages.forEach(page => {
      manifest.ele('item', {
        id: page.id,
        href: page.href,
        'media-type': 'application/xhtml+xml',
        properties: audioFileName && this.audioMappings.length > 0 ? 'media:overlay' : undefined
      });
    });
    
    // Add NAV
    manifest.ele('item', {
      id: 'nav',
      href: 'nav.xhtml',
      'media-type': 'application/xhtml+xml',
      properties: 'nav'
    });
    
    // Add CSS
    manifest.ele('item', {
      id: 'css',
      href: 'styles.css',
      'media-type': 'text/css'
    });
    
    // Add audio if exists
    if (audioFileName) {
      manifest.ele('item', {
        id: 'audio',
        href: audioFileName,
        'media-type': 'audio/mpeg'
      });
      
      // Add SMIL if mappings exist
      if (this.audioMappings.length > 0) {
        manifest.ele('item', {
          id: 'overlay',
          href: 'overlay.smil',
          'media-type': 'application/smil+xml'
        });
      }
    }
    
    // Spine
    const spine = packageEl.ele('spine', { toc: 'nav' });
    this.pages.forEach(page => {
      spine.ele('itemref', { idref: page.id });
    });
    
    const opfXML = root.end({ prettyPrint: true });
    const opfPath = path.join(this.tempEpubDir, 'OEBPS', 'content.opf');
    await fs.writeFile(opfPath, opfXML, 'utf-8');
  }
  
  /**
   * Generate container.xml
   */
  async generateContainer() {
    const container = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('container', {
        version: '1.0',
        xmlns: 'urn:oasis:names:tc:opendocument:xmlns:container'
      })
      .ele('rootfiles')
      .ele('rootfile', {
        'full-path': 'OEBPS/content.opf',
        'media-type': 'application/oebps-package+xml'
      })
      .up()
      .up();
    
    const containerXML = container.end({ prettyPrint: true });
    const containerPath = path.join(this.tempEpubDir, 'META-INF', 'container.xml');
    await fs.writeFile(containerPath, containerXML, 'utf-8');
  }
  
  /**
   * Create mimetype file
   */
  async createMimetype() {
    const mimetypePath = path.join(this.tempEpubDir, 'mimetype');
    await fs.writeFile(mimetypePath, 'application/epub+zip', 'utf-8');
  }
  
  /**
   * Package EPUB file
   */
  async packageEpub() {
    const epubFileName = `epub_${this.jobId}.epub`;
    const epubPath = path.join(this.outputDir, epubFileName);
    
    return new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(epubPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      output.on('close', () => {
        console.log(`[EPUB3] Packaged EPUB: ${epubPath} (${archive.pointer()} bytes)`);
        resolve(epubPath);
      });
      
      archive.on('error', reject);
      archive.pipe(output);
      
      // Add mimetype first (uncompressed)
      archive.file(path.join(this.tempEpubDir, 'mimetype'), { name: 'mimetype', store: true });
      
      // Add all other files
      archive.directory(path.join(this.tempEpubDir, 'META-INF'), 'META-INF');
      archive.directory(path.join(this.tempEpubDir, 'OEBPS'), 'OEBPS');
      
      archive.finalize();
    });
  }
  
  /**
   * Cleanup temporary directory
   */
  async cleanup() {
    try {
      await fs.rm(this.tempEpubDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('[EPUB3] Error cleaning up temp directory:', error.message);
    }
  }
  
  /**
   * Set metadata
   */
  setMetadata(metadata) {
    this.metadata = { ...this.metadata, ...metadata };
  }
}

