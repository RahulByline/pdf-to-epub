# Transcript System - Quick Reference

## Transcript JSON Schema

```json
{
  "jobId": 123,
  "pageNumber": 1,
  "audioFilePath": "/path/to/audio.mp3",
  "fragments": [
    {
      "id": "page1_p1_s1",           // Stable ID (must match XHTML/SMIL)
      "text": "Hello world",          // Editable text content
      "startTime": 0.000,             // Audio start (from aeneas)
      "endTime": 2.345,               // Audio end (from aeneas)
      "type": "sentence"              // "sentence" | "word" | "paragraph"
    }
  ],
  "metadata": {
    "createdAt": "ISO_DATE",
    "updatedAt": "ISO_DATE",
    "lastAlignedAt": "ISO_DATE",
    "aeneasVersion": "1.7.3",
    "language": "eng",
    "alignmentMethod": "aeneas",
    "textEdited": true
  }
}
```

## API Endpoints Quick Reference

### Get Transcript
```bash
GET /api/transcripts/job/:jobId/page/:pageNumber
```

### Edit Text
```bash
PUT /api/transcripts/job/:jobId/page/:pageNumber/fragment/:fragmentId
Body: { "text": "new text" }
```

### Batch Edit
```bash
PUT /api/transcripts/job/:jobId/page/:pageNumber/fragments
Body: { "updates": [{ "id": "id1", "text": "text1" }] }
```

### Re-align
```bash
POST /api/transcripts/job/:jobId/page/:pageNumber/realign
Body: { "language": "eng", "granularity": "sentence" }
```

### Build EPUB
```bash
POST /api/transcripts/job/:jobId/build-epub
Body: { "title": "Title", "author": "Author", "language": "en" }
```

## Code Examples

### Load Transcript
```javascript
import { TranscriptModel } from './models/Transcript.js';

const transcript = await TranscriptModel.loadTranscript(123, 1);
```

### Update Text
```javascript
import { TranscriptService } from './services/transcriptService.js';

await TranscriptService.updateFragmentText(123, 1, 'page1_p1_s1', 'New text');
```

### Re-align
```javascript
const updated = await TranscriptService.realignTranscript(123, 1, {
  language: 'eng',
  granularity: 'sentence'
});
```

### Generate SMIL
```javascript
import { generateSMILFromTranscript } from './services/smilGenerator.js';

const smil = generateSMILFromTranscript(transcript, 'page_1.xhtml', 'audio.mp3');
```

### Generate XHTML
```javascript
import { generateXHTMLFromTranscript } from './services/xhtmlGenerator.js';

const xhtml = generateXHTMLFromTranscript(transcript, {
  title: 'Page 1',
  cssHref: 'styles.css'
});
```

### Build EPUB
```javascript
import { EpubBuilderFromTranscript } from './services/epubBuilderFromTranscript.js';

const builder = new EpubBuilderFromTranscript(123, './output');
const epubPath = await builder.build({
  title: 'My Book',
  author: 'Author',
  language: 'en'
});
```

## File Locations

- **Transcripts**: `backend/transcripts/job_{jobId}/chapter_{pageNumber}.json`
- **Text Files**: `backend/transcripts/job_{jobId}/chapter_{pageNumber}.txt`
- **Generated EPUB**: `backend/epub_output/converted_transcript_{jobId}.epub`

## Key Rules

1. ✅ **DO**: Edit text in transcript JSON
2. ✅ **DO**: Re-run aeneas after editing
3. ✅ **DO**: Generate XHTML/SMIL from transcript
4. ❌ **DON'T**: Edit SMIL files directly
5. ❌ **DON'T**: Edit XHTML files directly
6. ❌ **DON'T**: Hard-code timings anywhere
7. ❌ **DON'T**: Generate text independently of transcript

## Fragment ID Format

- **Sentence**: `page1_p1_s1` (page1, paragraph1, sentence1)
- **Word**: `page1_p1_s1_w1` (page1, paragraph1, sentence1, word1)
- **Paragraph**: `page1_p1` (page1, paragraph1)

**CRITICAL**: IDs must be stable across regenerations!

## Aeneas Execution

Internally executed as:
```bash
python -m aeneas.tools.execute_task \
  "audio.mp3" \
  "chapter_1.txt" \
  "task_language=eng|is_text_type=plain|os_task_file_format=json" \
  "output.json"
```

Output format:
```json
{
  "fragments": [
    {
      "begin": "0.000",
      "end": "2.345",
      "lines": ["Hello world"],
      "id": "f001"
    }
  ]
}
```

## SMIL Format

```xml
<par>
  <text src="page_1.xhtml#fragmentId"/>
  <audio src="audio/audio.mp3" clipBegin="0.000s" clipEnd="2.345s"/>
</par>
```

## XHTML Format

```xml
<p id="fragmentId" class="epub-media-overlay-active">text content</p>
```

## Troubleshooting

**Problem**: Transcript not found
- **Solution**: Initialize transcript first: `POST /api/transcripts/job/:jobId/initialize`

**Problem**: Aeneas alignment fails
- **Solution**: Check audio file exists, aeneas installed, text file valid

**Problem**: SMIL references don't match XHTML IDs
- **Solution**: Ensure fragment IDs are stable and match exactly

**Problem**: EPUB doesn't play audio
- **Solution**: Check audio file copied, SMIL references correct, OPF manifest correct


