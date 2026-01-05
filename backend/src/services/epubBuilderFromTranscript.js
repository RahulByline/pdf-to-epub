/**
 * EPUB Builder from Transcript
 * 
 * Builds complete EPUB3 packages using transcript JSON as the single source of truth.
 * 
 * Architecture:
 * 1. Load transcripts for all pages/chapters
 * 2. Generate XHTML files from transcripts
 * 3. Generate SMIL files from transcripts
 * 4. Build OPF manifest with media overlay references
 * 5. Package EPUB3 file
 * 
 * CRITICAL: All content (XHTML, SMIL) is generated from transcript JSON.
 * No hard-coded timings or text content exists outside transcripts.
 */

import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { TranscriptModel } from '../models/Transcript.js';
import { generateSMILFromTranscript } from './smilGenerator.js';
import { generateXHTMLFromTranscript } from './xhtmlGenerator.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class EpubBuilderFromTranscript {
  constructor(jobId, outputDir) {
    this.jobId = jobId;
    this.outputDir = outputDir;
    this.tempEpubDir = path.join(outputDir, `temp_epub_transcript_${jobId}`);
    this.transcripts = {};
    this.xhtmlFiles = [];
    this.smilFiles = [];
    this.audioFileName = null;
  }

  /**
   * Main build function
   * 
   * @param {Object} options - Build options
   * @returns {Promise<string>} Path to generated EPUB file
   */
  async build(options = {}) {
    const {
      title = 'Untitled',
      author = 'Unknown',
      language = 'en',
      audioFileName = null
    } = options;

    try {
      console.log(`[EpubBuilder] Building EPUB from transcripts for job ${this.jobId}`);

      // Step 1: Load all transcripts
      await this.loadTranscripts();

      if (Object.keys(this.transcripts).length === 0) {
        throw new Error('No transcripts found for this job');
      }

      // Step 2: Create EPUB directory structure
      await this.createDirectoryStructure();

      // Step 3: Determine audio file name
      this.audioFileName = audioFileName || this.detectAudioFileName();

      // Step 4: Generate XHTML files from transcripts
      await this.generateXHTMLFiles();

      // Step 5: Generate SMIL files from transcripts
      await this.generateSMILFiles();

      // Step 6: Copy audio file (if exists)
      await this.copyAudioFile();

      // Step 7: Generate CSS
      await this.generateCSS();

      // Step 8: Generate OPF manifest
      await this.generateOPF(title, author, language);

      // Step 9: Generate navigation document
      await this.generateNav(title);

      // Step 10: Generate container.xml
      await this.generateContainer();

      // Step 11: Package EPUB
      const epubPath = await this.packageEpub();

      // Step 12: Cleanup
      await this.cleanup();

      console.log(`[EpubBuilder] EPUB built successfully: ${epubPath}`);

      return epubPath;
    } catch (error) {
      console.error('[EpubBuilder] Error building EPUB:', error);
      await this.cleanup().catch(() => {});
      throw error;
    }
  }

  /**
   * Load all transcripts for this job
   */
  async loadTranscripts() {
    this.transcripts = await TranscriptModel.loadAllTranscripts(this.jobId);
    console.log(`[EpubBuilder] Loaded ${Object.keys(this.transcripts).length} transcripts`);
  }

  /**
   * Detect audio file name from first transcript
   */
  detectAudioFileName() {
    const firstTranscript = Object.values(this.transcripts)[0];
    if (firstTranscript && firstTranscript.audioFilePath) {
      return path.basename(firstTranscript.audioFilePath);
    }
    return null;
  }

  /**
   * Create EPUB3 directory structure
   */
  async createDirectoryStructure() {
    const dirs = [
      path.join(this.tempEpubDir, 'META-INF'),
      path.join(this.tempEpubDir, 'OEBPS'),
      path.join(this.tempEpubDir, 'OEBPS', 'audio')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Generate XHTML files from transcripts
   */
  async generateXHTMLFiles() {
    const oebpsDir = path.join(this.tempEpubDir, 'OEBPS');

    for (const [pageNumber, transcript] of Object.entries(this.transcripts)) {
      const pageNum = parseInt(pageNumber);
      const xhtmlFileName = `page_${pageNum}.xhtml`;

      // Generate XHTML content from transcript
      const xhtmlContent = generateXHTMLFromTranscript(transcript, {
        title: `Page ${pageNum}`,
        cssHref: 'styles.css',
        includeMediaOverlayCSS: true
      });

      // Save XHTML file
      const xhtmlPath = path.join(oebpsDir, xhtmlFileName);
      await fs.writeFile(xhtmlPath, xhtmlContent, 'utf8');

      this.xhtmlFiles.push({
        pageNumber: pageNum,
        fileName: xhtmlFileName,
        id: `page-${pageNum}`
      });

      console.log(`[EpubBuilder] Generated XHTML: ${xhtmlFileName} (${transcript.fragments.length} fragments)`);
    }
  }

  /**
   * Generate SMIL files from transcripts
   */
  async generateSMILFiles() {
    const oebpsDir = path.join(this.tempEpubDir, 'OEBPS');

    if (!this.audioFileName) {
      console.warn('[EpubBuilder] No audio file, skipping SMIL generation');
      return;
    }

    for (const [pageNumber, transcript] of Object.entries(this.transcripts)) {
      const pageNum = parseInt(pageNumber);
      const xhtmlFileName = `page_${pageNum}.xhtml`;
      const smilFileName = `page_${pageNum}.smil`;

      // Generate SMIL content from transcript
      const smilContent = generateSMILFromTranscript(
        transcript,
        xhtmlFileName,
        `audio/${this.audioFileName}`, // Audio path relative to OEBPS
        {}
      );

      // Save SMIL file
      const smilPath = path.join(oebpsDir, smilFileName);
      await fs.writeFile(smilPath, smilContent, 'utf8');

      this.smilFiles.push({
        pageNumber: pageNum,
        fileName: smilFileName,
        id: `smil-page-${pageNum}`,
        xhtmlId: `page-${pageNum}`
      });

      console.log(`[EpubBuilder] Generated SMIL: ${smilFileName} (${transcript.fragments.length} fragments)`);
    }
  }

  /**
   * Copy audio file to EPUB
   */
  async copyAudioFile() {
    if (!this.audioFileName) {
      return;
    }

    const firstTranscript = Object.values(this.transcripts)[0];
    if (!firstTranscript || !firstTranscript.audioFilePath) {
      console.warn('[EpubBuilder] Audio file path not found in transcript');
      return;
    }

    try {
      const sourcePath = firstTranscript.audioFilePath;
      const audioDir = path.join(this.tempEpubDir, 'OEBPS', 'audio');
      const destPath = path.join(audioDir, this.audioFileName);

      await fs.copyFile(sourcePath, destPath);
      console.log(`[EpubBuilder] Copied audio file: ${this.audioFileName}`);
    } catch (error) {
      console.error(`[EpubBuilder] Failed to copy audio file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate CSS file
   */
  async generateCSS() {
    const cssContent = `/* EPUB3 Styles */
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

/* Media Overlay Active Class */
.epub-media-overlay-active,
.-epub-media-overlay-active {
  background-color: #ffff00;
  color: #000000;
}

.epub-media-overlay-playing,
.-epub-media-overlay-playing {
  background-color: #ffcc00;
  color: #000000;
}
`;

    const cssPath = path.join(this.tempEpubDir, 'OEBPS', 'styles.css');
    await fs.writeFile(cssPath, cssContent, 'utf8');
  }

  /**
   * Generate OPF manifest
   */
  async generateOPF(title, author, language) {
    const oebpsDir = path.join(this.tempEpubDir, 'OEBPS');

    // Build manifest items
    const manifestItems = [];
    const spineItems = [];

    // Add XHTML files
    for (const xhtmlFile of this.xhtmlFiles) {
      const smilFile = this.smilFiles.find(s => s.pageNumber === xhtmlFile.pageNumber);
      const mediaOverlayAttr = smilFile ? ` media-overlay="${smilFile.id}"` : '';

      manifestItems.push(
        `<item id="${xhtmlFile.id}" href="${xhtmlFile.fileName}" media-type="application/xhtml+xml"${mediaOverlayAttr}/>`
      );

      const spineMediaOverlay = smilFile ? ` media-overlay="${smilFile.id}"` : '';
      spineItems.push(`<itemref idref="${xhtmlFile.id}"${spineMediaOverlay}/>`);
    }

    // Add SMIL files
    for (const smilFile of this.smilFiles) {
      manifestItems.push(
        `<item id="${smilFile.id}" href="${smilFile.fileName}" media-type="application/smil+xml"/>`
      );
    }

    // Add CSS
    manifestItems.push(
      '<item id="styles" href="styles.css" media-type="text/css"/>'
    );

    // Add audio file
    if (this.audioFileName) {
      manifestItems.push(
        `<item id="audio" href="audio/${this.audioFileName}" media-type="audio/mpeg"/>`
      );
    }

    // Calculate total duration
    const totalDuration = this.calculateTotalDuration();

    // Build OPF content
    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">urn:uuid:${this.jobId}</dc:identifier>
    <dc:title>${this.escapeXml(title)}</dc:title>
    <dc:creator>${this.escapeXml(author)}</dc:creator>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    ${totalDuration > 0 ? `<meta property="media:duration">${totalDuration.toFixed(3)}s</meta>` : ''}
    <meta property="media:active-class">-epub-media-overlay-active</meta>
    <meta property="media:playback-active-class">-epub-media-overlay-playing</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="nav">
    ${spineItems.join('\n    ')}
  </spine>
</package>`;

    const opfPath = path.join(oebpsDir, 'content.opf');
    await fs.writeFile(opfPath, opfContent, 'utf8');
  }

  /**
   * Generate navigation document
   */
  async generateNav(title) {
    const navItems = this.xhtmlFiles.map(xhtmlFile => 
      `    <li><a href="${xhtmlFile.fileName}">Page ${xhtmlFile.pageNumber}</a></li>`
    ).join('\n');

    const navContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="UTF-8"/>
    <title>${this.escapeXml(title)}</title>
  </head>
  <body>
    <nav epub:type="toc">
      <h1>Table of Contents</h1>
      <ol>
${navItems}
      </ol>
    </nav>
  </body>
</html>`;

    const navPath = path.join(this.tempEpubDir, 'OEBPS', 'nav.xhtml');
    await fs.writeFile(navPath, navContent, 'utf8');

    // Add nav to manifest (will be added in OPF generation)
  }

  /**
   * Generate container.xml
   */
  async generateContainer() {
    const containerContent = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    const containerPath = path.join(this.tempEpubDir, 'META-INF', 'container.xml');
    await fs.writeFile(containerPath, containerContent, 'utf8');
  }

  /**
   * Package EPUB file
   */
  async packageEpub() {
    const zip = new JSZip();

    // Add mimetype (must be first, uncompressed)
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    // Add all files from temp directory
    await this.addDirectoryToZip(zip, this.tempEpubDir, '');

    // Generate EPUB file
    const epubFileName = `converted_transcript_${this.jobId}.epub`;
    const epubPath = path.join(this.outputDir, epubFileName);

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    await fs.writeFile(epubPath, buffer);

    return epubPath;
  }

  /**
   * Recursively add directory to ZIP
   */
  async addDirectoryToZip(zip, dirPath, zipPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const zipEntryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await this.addDirectoryToZip(zip, fullPath, zipEntryPath);
      } else {
        const content = await fs.readFile(fullPath);
        zip.file(zipEntryPath, content);
      }
    }
  }

  /**
   * Calculate total audio duration from all transcripts
   */
  calculateTotalDuration() {
    let totalDuration = 0;

    for (const transcript of Object.values(this.transcripts)) {
      if (transcript.fragments && transcript.fragments.length > 0) {
        const lastFragment = transcript.fragments[transcript.fragments.length - 1];
        const pageDuration = lastFragment.endTime || 0;
        totalDuration = Math.max(totalDuration, pageDuration);
      }
    }

    return totalDuration;
  }

  /**
   * Escape XML special characters
   */
  escapeXml(text) {
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
   * Cleanup temp directory
   */
  async cleanup() {
    try {
      await fs.rm(this.tempEpubDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('[EpubBuilder] Cleanup warning:', error.message);
    }
  }
}






