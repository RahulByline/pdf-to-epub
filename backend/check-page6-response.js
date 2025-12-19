import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeminiService } from './src/services/geminiService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkPage6Response() {
  const jobId = 73;
  const pageNumber = 6;
  
  const imagePath = path.join(__dirname, 'html_intermediate', `job_${jobId}_png`, `page_${pageNumber}.png`);
  const xhtmlPath = path.join(__dirname, 'html_intermediate', `job_${jobId}_html`, `page_${pageNumber}.xhtml`);
  
  console.log(`\n=== Checking Page 6 Response for Job ${jobId} ===\n`);
  
  // Check if image exists
  try {
    const imageStats = await fs.stat(imagePath);
    console.log(`✅ Image file exists: ${imagePath} (${(imageStats.size / 1024).toFixed(2)} KB)`);
  } catch (err) {
    console.error(`❌ Image file NOT found: ${imagePath}`);
    console.error(`   Error: ${err.message}`);
    return;
  }
  
  // Check if XHTML exists
  try {
    const xhtmlStats = await fs.stat(xhtmlPath);
    console.log(`✅ XHTML file exists: ${xhtmlPath} (${(xhtmlStats.size / 1024).toFixed(2)} KB)`);
    const xhtmlContent = await fs.readFile(xhtmlPath, 'utf8');
    console.log(`   XHTML preview (first 500 chars):\n${xhtmlContent.substring(0, 500)}...\n`);
  } catch (err) {
    console.error(`❌ XHTML file NOT found: ${xhtmlPath}`);
    console.error(`   This means Gemini conversion failed or returned null\n`);
    
    // Try to convert it now to see what happens
    console.log(`\n=== Attempting to convert Page 6 now ===\n`);
    try {
      const result = await GeminiService.convertPngToXhtml(imagePath, pageNumber);
      
      if (result && result.xhtml) {
        console.log(`✅ Conversion successful!`);
        console.log(`   XHTML length: ${result.xhtml.length} chars`);
        console.log(`   CSS length: ${result.css?.length || 0} chars`);
        console.log(`   XHTML preview (first 500 chars):\n${result.xhtml.substring(0, 500)}...\n`);
        
        // Save it
        await fs.writeFile(xhtmlPath, result.xhtml, 'utf8');
        console.log(`✅ Saved XHTML to: ${xhtmlPath}`);
      } else {
        console.error(`❌ Conversion returned null or invalid result`);
        console.error(`   Result:`, result);
      }
    } catch (convertError) {
      console.error(`❌ Conversion failed with error:`);
      console.error(`   ${convertError.message}`);
      console.error(`   Stack: ${convertError.stack}`);
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Image: ${imagePath}`);
  console.log(`XHTML: ${xhtmlPath}`);
}

checkPage6Response().catch(console.error);

