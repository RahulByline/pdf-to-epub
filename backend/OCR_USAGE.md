# Tesseract OCR Integration - Usage Guide

## Overview

Tesseract OCR has been integrated for text extraction from scanned PDFs or image-based PDFs. It works by:
1. Rendering PDF pages as images (300 DPI)
2. Running OCR on each page image
3. Extracting text with bounding box coordinates

## Installation

The package is already added to `package.json`. Install dependencies:

```bash
cd pdf-to-epub/backend
npm install
```

**Note:** Tesseract.js downloads language data automatically on first use. The first run may take longer.

## Configuration

Add these to your `.env` file:

```env
# Enable OCR extraction (default: false)
USE_OCR_EXTRACTION=true

# OCR Language (default: 'eng' for English)
# Multiple languages: 'eng+fra' (English + French)
# See: https://tesseract-ocr.github.io/tessdoc/Data-Files.html
OCR_LANGUAGE=eng

# OCR Page Segmentation Mode (default: 6)
# 6 = Uniform block of text
# See: https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html#page-segmentation-method
OCR_PSM=6

# DPI for rendering pages before OCR (default: 300)
OCR_DPI=300
```

## Text Extraction Priority

The system tries extraction methods in this order:

1. **Gemini AI** (if `GEMINI_TEXT_EXTRACTION=true`)
   - Best for complex PDFs
   - Requires API key
   - May have rate limits

2. **Tesseract OCR** (if `USE_OCR_EXTRACTION=true`)
   - Best for scanned PDFs
   - Works offline
   - Slower but accurate

3. **pdfjs-dist** (default fallback)
   - Fast for text-based PDFs
   - Works offline
   - May miss text in images

## Usage Examples

### Example 1: Basic OCR Extraction

```javascript
import { OcrService } from './src/services/ocrService.js';

// Extract text from PDF using OCR
const textData = await OcrService.extractTextFromPdf('scanned-document.pdf', {
  lang: 'eng',
  psm: 6,
  dpi: 300
});

console.log(`Extracted ${textData.totalPages} pages`);
console.log(`Average confidence: ${textData.metadata.averageConfidence}%`);
```

### Example 2: Extract from Rendered Images

```javascript
import { OcrService } from './src/services/ocrService.js';
import { PdfExtractionService } from './src/services/pdfExtractionService.js';

// First render pages as images
const imagesDir = './temp_images';
const pageImagesData = await PdfExtractionService.renderPagesAsImages('document.pdf', imagesDir);

// Then extract text using OCR
const textData = await OcrService.extractTextFromPdfPages('document.pdf', imagesDir, {
  lang: 'eng',
  psm: 6,
  getBoundingBoxes: true
});
```

### Example 3: Extract from Single Image

```javascript
import { OcrService } from './src/services/ocrService.js';

const result = await OcrService.extractTextFromImage('page.png', {
  lang: 'eng',
  psm: 6,
  getBoundingBoxes: true
});

console.log('Text:', result.text);
console.log('Confidence:', result.confidence);
console.log('Words:', result.words.length);
```

## OCR Page Segmentation Modes (PSM)

| Mode | Description | Best For |
|------|-------------|----------|
| 0 | Orientation and script detection only | Auto-detection |
| 1 | Automatic page segmentation with OSD | Mixed content |
| 3 | Fully automatic page segmentation | Most documents |
| 6 | Uniform block of text | Single column text |
| 11 | Sparse text | Sparse text |
| 12 | Single text line | Single line |

**Default:** 6 (uniform block of text)

## Supported Languages

Common languages:
- `eng` - English
- `fra` - French
- `spa` - Spanish
- `deu` - German
- `chi_sim` - Chinese (Simplified)
- `jpn` - Japanese

**Multiple languages:** `eng+fra` (English + French)

**Check available languages:**
```javascript
const languages = await OcrService.getAvailableLanguages();
console.log('Available:', languages);
```

## Performance Tips

1. **DPI Settings:**
   - 300 DPI: Good balance (default)
   - 600 DPI: Higher accuracy, slower
   - 150 DPI: Faster, lower accuracy

2. **PSM Mode:**
   - Use mode 6 for single-column text
   - Use mode 3 for complex layouts
   - Use mode 11 for sparse text

3. **Language:**
   - Specify exact language for better accuracy
   - Use multiple languages only if needed (slower)

## Integration with Conversion Service

The OCR service is automatically integrated into the conversion workflow:

```javascript
// In conversionService.js, the extraction priority is:
// 1. Gemini AI (if enabled)
// 2. Tesseract OCR (if enabled)
// 3. pdfjs-dist (default)
```

## When to Use OCR

**Use OCR when:**
- ✅ PDF is scanned (image-based)
- ✅ Text is embedded in images
- ✅ pdfjs-dist fails to extract text
- ✅ You need offline text extraction

**Don't use OCR when:**
- ❌ PDF has selectable text (use pdfjs-dist)
- ❌ Speed is critical (OCR is slower)
- ❌ PDF is text-based (pdfjs-dist is faster)

## Troubleshooting

### Issue: Low OCR confidence

**Solution:**
- Increase DPI: `OCR_DPI=600`
- Try different PSM: `OCR_PSM=3`
- Pre-process images (enhance contrast)

### Issue: OCR is slow

**Solution:**
- Reduce DPI: `OCR_DPI=200`
- Use single language instead of multiple
- Process pages in parallel (future enhancement)

### Issue: Wrong language detected

**Solution:**
- Set correct language: `OCR_LANGUAGE=fra`
- Check available languages first

## Cleanup

The OCR worker is automatically cleaned up, but you can manually terminate:

```javascript
await OcrService.terminateWorker();
```

## Example Output

```javascript
{
  pages: [
    {
      pageNumber: 1,
      text: "Extracted text from page...",
      textBlocks: [
        {
          id: "ocr_block_1_0",
          text: "word",
          boundingBox: { x: 100, y: 200, width: 50, height: 20 },
          confidence: 95.5
        }
      ],
      charCount: 1234,
      confidence: 92.3,
      width: 612,
      height: 792
    }
  ],
  totalPages: 16,
  metadata: {
    extractionMethod: "OCR",
    ocrEngine: "Tesseract.js",
    language: "eng",
    averageConfidence: 91.5
  }
}
```

## Next Steps

1. Install dependencies: `npm install`
2. Set `USE_OCR_EXTRACTION=true` in `.env`
3. Configure language: `OCR_LANGUAGE=eng`
4. Test with a scanned PDF

The OCR service will automatically be used when enabled!

