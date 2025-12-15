/**
 * PDF.js Helper Utility
 * Provides consistent PDF.js library access
 */
let pdfjsLibCache = null;

export async function getPdfjsLib() {
  if (pdfjsLibCache) {
    return pdfjsLibCache;
  }
  
  try {
    // Import pdfjs-dist legacy build (works better in Node.js)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    // Set worker path if needed
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    }
    
    pdfjsLibCache = pdfjsLib;
    return pdfjsLib;
  } catch (error) {
    console.error('[PDF.js Helper] Error loading pdfjs-dist:', error);
    throw new Error('Failed to load PDF.js library');
  }
}

