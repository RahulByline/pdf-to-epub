import { parentPort, workerData } from 'worker_threads';
import mammoth from 'mammoth';
import fs from 'fs/promises';

/**
 * Worker thread for processing Word documents with mammoth
 * This prevents blocking the main event loop during CPU-intensive conversion
 */
async function processWordDocument() {
  try {
    const { docxFilePath, options } = workerData;
    
    // Read the file
    const fileBuffer = await fs.readFile(docxFilePath);
    
    // Convert DOCX to HTML using mammoth
    // This runs in a separate thread, so it won't block the main event loop
    const result = await mammoth.convertToHtml(
      { buffer: fileBuffer },
      options || {
        includeDefaultStyleMap: true,
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh",
          "r[style-name='Strong'] => strong",
          "r[style-name='Emphasis'] => em"
        ],
        preserveEmptyParagraphs: true,
        convertImage: mammoth.images.imgElement((image) => {
          return image.read("base64").then((imageBuffer) => {
            const imgAttrs = {
              src: `data:${image.contentType};base64,${imageBuffer.toString("base64")}`,
              alt: image.altText || ''
            };
            
            if (image.width) {
              imgAttrs.width = image.width;
            }
            if (image.height) {
              imgAttrs.height = image.height;
            }
            
            const styleParts = [];
            if (image.width) styleParts.push(`width: ${image.width}px`);
            if (image.height) styleParts.push(`height: ${image.height}px`);
            if (image.style) {
              styleParts.push(image.style);
            }
            
            if (styleParts.length > 0) {
              imgAttrs.style = styleParts.join('; ');
            }
            
            return imgAttrs;
          });
        })
      }
    );
    
    // Send result back to main thread
    parentPort.postMessage({
      success: true,
      html: result.value,
      messages: result.messages || []
    });
  } catch (error) {
    // Send error back to main thread
    parentPort.postMessage({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}

// Start processing when worker receives data
processWordDocument();

