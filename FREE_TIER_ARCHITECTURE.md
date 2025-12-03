# Free Tier Friendly Architecture

## Overview

This architecture is optimized for free tier usage, minimizing AI API calls while maintaining quality.

## Architecture by Step

| Step | Engine | Ratio | Implementation |
|------|--------|-------|----------------|
| **OCR** | Tesseract/PDFBox | Local | ✅ No AI calls - uses local OCR |
| **Cleanup** | Gemini 1.5 Flash | 1 call/page | ✅ Merged with structure tagging |
| **Structure Tagging** | Gemini 1.5 Flash | Merged with cleanup | ✅ Combined in single call |
| **Sentence Segmentation** | OpenNLP | Local | ✅ No AI calls - local NLP |
| **Audio Transformation** | Gemini 1.5 Flash | 1 call/page OR batch/chapter | ✅ Configurable batching |
| **Alt Text** | Gemini Vision Flash | Images only | ✅ Only for images |
| **SMIL Generation** | Local | 0 AI calls | ✅ Pure local processing |

## Implementation Details

### 1. OCR (Tesseract/PDFBox)
- **Service**: `OcrService`
- **Configuration**: `ocr.use-ai-providers=false`
- **Status**: ✅ Local only, no AI calls
- **Fallback**: Tesseract always available

### 2. Cleanup + Structure Tagging (Merged)
- **Service**: `FreeTierCleanupAndTaggingService`
- **Model**: `gemini-1.5-flash`
- **Ratio**: 1 API call per page
- **Configuration**: `ai.free-tier.cleanup.enabled=true`
- **What it does**:
  - Fixes OCR errors
  - Normalizes punctuation
  - Determines HTML structure tags (h1-h6, p, li, etc.)
  - All in ONE API call per page

### 3. Sentence Segmentation (OpenNLP)
- **Service**: `OpenNlpSentenceSegmentationService`
- **Status**: ✅ Local, no AI calls
- **Fallback**: Regex-based if OpenNLP not available
- **Dependency**: Apache OpenNLP (added to pom.xml)

### 4. Audio-Friendly Transformation
- **Service**: `AudioFriendlyTransformationService`
- **Model**: `gemini-1.5-flash`
- **Modes**:
  - **Page mode**: 1 call per page
  - **Batch mode**: 1 call per chapter (default, more efficient)
- **Configuration**: 
  - `ai.free-tier.audio-transformation.enabled=true`
  - `ai.free-tier.audio-transformation.batch-mode=true`

### 5. Alt Text Generation
- **Service**: `AccessibilityService` (updated)
- **Model**: `gemini-1.5-flash` (Vision)
- **Usage**: Only for images
- **Configuration**: `ai.free-tier.alt-text.enabled=true`

### 6. SMIL Generation
- **Service**: Local processing (no AI)
- **Status**: ✅ Pure local, 0 AI calls
- **Implementation**: Direct XML generation

## API Call Summary

### Per Document (16 pages example):
- **Cleanup + Tagging**: 16 calls (1 per page)
- **Audio Transformation**: 16 calls (page mode) OR ~3-5 calls (batch mode)
- **Alt Text**: ~2-5 calls (only for images)
- **Total**: ~20-37 calls per document

### Free Tier Limits:
- **Gemini 1.5 Flash**: 10 requests/minute (free tier)
- **With batching**: Can process ~2-3 documents per minute
- **Fallback**: Tesseract for OCR (unlimited)

## Configuration

All settings in `application.properties`:

```properties
# Use Gemini 1.5 Flash (better free tier limits)
gemini.api.model=gemini-1.5-flash

# Disable AI for OCR (use local only)
ocr.use-ai-providers=false

# Enable free tier optimizations
ai.free-tier.cleanup.enabled=true
ai.free-tier.audio-transformation.enabled=true
ai.free-tier.audio-transformation.batch-mode=true
ai.free-tier.alt-text.enabled=true
```

## Benefits

✅ **Minimized API Calls**: Merged operations reduce calls
✅ **Local Processing**: OCR and sentence segmentation are local
✅ **Smart Batching**: Audio transformation batches by chapter
✅ **Free Tier Friendly**: Works within 10 requests/minute limit
✅ **Automatic Fallback**: Tesseract always available

## Migration Notes

1. **OCR**: Now uses only Tesseract/PDFBox (no AI)
2. **Sentence Segmentation**: Switched from Gemini to OpenNLP
3. **Cleanup + Tagging**: Merged into single service (1 call/page)
4. **SMIL**: Already local, no changes needed

## Next Steps

1. Restart application
2. Test with a sample document
3. Monitor API usage in logs
4. Adjust batch mode if needed

