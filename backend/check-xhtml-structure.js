import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const epubOutputDir = path.join(__dirname, 'epub_output');

async function checkXhtmlStructure(jobId) {
  try {
    const epubPath = path.join(epubOutputDir, `converted_${jobId}.epub`);
    
    // Check if EPUB exists
    try {
      await fs.access(epubPath);
    } catch {
      console.error(`EPUB file not found: ${epubPath}`);
      return;
    }
    
    console.log(`\n=== Checking XHTML Structure for Job ${jobId} ===\n`);
    console.log(`EPUB file: ${epubPath}\n`);
    
    // Read EPUB
    const epubData = await fs.readFile(epubPath);
    const zip = await JSZip.loadAsync(epubData);
    
    // Find all XHTML files
    const xhtmlFiles = Object.keys(zip.files).filter(name => 
      name.endsWith('.xhtml') && !name.includes('nav.xhtml')
    );
    
    console.log(`Found ${xhtmlFiles.length} XHTML files\n`);
    
    // Analyze each XHTML file
    for (const fileName of xhtmlFiles.sort()) {
      const file = zip.file(fileName);
      if (!file) continue;
      
      const content = await file.async('string');
      const pageNumber = fileName.match(/page[_\s]*(\d+)/i)?.[1] || 'unknown';
      
      console.log(`\n--- ${fileName} (Page ${pageNumber}) ---`);
      
      // Extract all IDs
      const idMatches = content.match(/id="([^"]+)"/g) || [];
      const ids = idMatches.map(m => m.replace(/id="([^"]+)"/, '$1'));
      
      console.log(`Total IDs found: ${ids.length}`);
      
      if (ids.length === 0) {
        console.log('⚠️  NO IDs FOUND - This page has no hierarchical structure!');
        continue;
      }
      
      // Analyze ID patterns
      const wordLevel = ids.filter(id => id.includes('_w') && id.match(/[a-z]+\d+_s\d+_w\d+$/));
      const sentenceLevel = ids.filter(id => id.includes('_s') && !id.includes('_w') && id.match(/[a-z]+\d+_s\d+$/));
      const paragraphLevel = ids.filter(id => id.match(/[a-z]+\d+$/) && !id.includes('_s') && !id.includes('_w'));
      const headerLevel = ids.filter(id => id.includes('_h') && !id.includes('_s'));
      const otherLevel = ids.filter(id => !wordLevel.includes(id) && !sentenceLevel.includes(id) && !paragraphLevel.includes(id) && !headerLevel.includes(id));
      
      console.log(`  Word-level IDs: ${wordLevel.length} (e.g., ${wordLevel.slice(0, 3).join(', ') || 'none'})`);
      console.log(`  Sentence-level IDs: ${sentenceLevel.length} (e.g., ${sentenceLevel.slice(0, 3).join(', ') || 'none'})`);
      console.log(`  Paragraph-level IDs: ${paragraphLevel.length} (e.g., ${paragraphLevel.slice(0, 3).join(', ') || 'none'})`);
      console.log(`  Header-level IDs: ${headerLevel.length} (e.g., ${headerLevel.slice(0, 3).join(', ') || 'none'})`);
      console.log(`  Other IDs: ${otherLevel.length} (e.g., ${otherLevel.slice(0, 3).join(', ') || 'none'})`);
      
      // Check for hierarchical structure
      const hasHierarchy = wordLevel.length > 0 && sentenceLevel.length > 0 && paragraphLevel.length > 0;
      
      if (hasHierarchy) {
        console.log(`  ✅ HAS HIERARCHICAL STRUCTURE (words → sentences → paragraphs)`);
      } else if (sentenceLevel.length > 0 && paragraphLevel.length > 0) {
        console.log(`  ⚠️  PARTIAL HIERARCHY (sentences → paragraphs, but no words)`);
      } else if (paragraphLevel.length > 0) {
        console.log(`  ⚠️  FLAT STRUCTURE (only paragraph-level IDs, no sentences/words)`);
      } else {
        console.log(`  ❌ NO HIERARCHICAL STRUCTURE DETECTED`);
      }
      
      // Check for nested structure in actual HTML
      const hasNestedSpans = content.includes('sync-sentence') || content.includes('sync-word');
      if (hasNestedSpans) {
        console.log(`  ✅ Has nested span structure (sync-sentence/sync-word classes)`);
      }
      
      // Sample of actual structure
      if (ids.length > 0) {
        console.log(`  Sample IDs (first 10): ${ids.slice(0, 10).join(', ')}`);
      }
      
      // Check what granularity levels are available
      const availableGranularities = [];
      if (wordLevel.length > 0) availableGranularities.push('word');
      if (sentenceLevel.length > 0) availableGranularities.push('sentence');
      if (paragraphLevel.length > 0) availableGranularities.push('paragraph');
      
      if (availableGranularities.length > 0) {
        console.log(`  Available granularities: ${availableGranularities.join(', ')}`);
      }
      
      // Show a sample of the actual HTML structure
      if (content.includes('<p') || content.includes('<span')) {
        const sampleMatch = content.match(/<p[^>]*id="[^"]*"[^>]*>[\s\S]{0,500}/);
        if (sampleMatch) {
          const sample = sampleMatch[0].substring(0, 200).replace(/\s+/g, ' ');
          console.log(`  Sample HTML structure: ${sample}...`);
        }
      }
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Total XHTML files analyzed: ${xhtmlFiles.length}`);
    
  } catch (error) {
    console.error('Error checking XHTML structure:', error);
  }
}

// Get job ID from command line or use default
const jobId = process.argv[2] || '69';
checkXhtmlStructure(jobId);

