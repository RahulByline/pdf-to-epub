# Transcript System Examples

## Example 1: Complete Workflow

### Step 1: Initialize Transcript from Existing Data

```bash
curl -X POST http://localhost:8081/api/transcripts/job/123/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "pageNumber": 1,
    "audioFilePath": "/path/to/audio.mp3"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Transcript initialized successfully",
    "transcript": {
      "jobId": 123,
      "pageNumber": 1,
      "audioFilePath": "/path/to/audio.mp3",
      "fragments": [
        {
          "id": "page1_p1_s1",
          "text": "Hello world",
          "startTime": 0.0,
          "endTime": 1.5,
          "type": "sentence"
        }
      ]
    }
  }
}
```

### Step 2: Edit Text

```bash
curl -X PUT http://localhost:8081/api/transcripts/job/123/page/1/fragment/page1_p1_s1 \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world! This is edited text."
  }'
```

### Step 3: Re-run Aeneas Alignment

```bash
curl -X POST http://localhost:8081/api/transcripts/job/123/page/1/realign \
  -H "Content-Type: application/json" \
  -d '{
    "language": "eng",
    "granularity": "sentence"
  }'
```

**What happens:**
1. Transcript JSON is loaded
2. `chapter_1.txt` is generated from edited text:
   ```
   Hello world! This is edited text.
   ```
3. Aeneas runs: `aeneas audio.mp3 chapter_1.txt → alignment.json`
4. Transcript is updated with new timings:
   ```json
   {
     "id": "page1_p1_s1",
     "text": "Hello world! This is edited text.",
     "startTime": 0.000,  // Updated from aeneas
     "endTime": 2.100     // Updated from aeneas
   }
   ```

### Step 4: Build EPUB

```bash
curl -X POST http://localhost:8081/api/transcripts/job/123/build-epub \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Book",
    "author": "Author Name",
    "language": "en"
  }'
```

## Example 2: Transcript JSON File

**File:** `backend/transcripts/job_123/chapter_1.json`

```json
{
  "jobId": 123,
  "pageNumber": 1,
  "audioFilePath": "/uploads/audio/job_123_audio.mp3",
  "fragments": [
    {
      "id": "page1_p1_s1",
      "text": "Hello world! This is edited text.",
      "startTime": 0.000,
      "endTime": 2.100,
      "type": "sentence"
    },
    {
      "id": "page1_p1_s2",
      "text": "This is the second sentence.",
      "startTime": 2.100,
      "endTime": 4.500,
      "type": "sentence"
    },
    {
      "id": "page1_p1_s1_w1",
      "text": "Hello",
      "startTime": 0.000,
      "endTime": 0.500,
      "type": "word"
    },
    {
      "id": "page1_p1_s1_w2",
      "text": "world!",
      "startTime": 0.500,
      "endTime": 1.200,
      "type": "word"
    }
  ],
  "metadata": {
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T12:00:00.000Z",
    "lastAlignedAt": "2024-01-01T12:00:00.000Z",
    "aeneasVersion": "1.7.3",
    "language": "eng",
    "alignmentMethod": "aeneas",
    "textEdited": true
  }
}
```

## Example 3: Generated SMIL File

**File:** `OEBPS/page_1.smil`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/2001/SMIL20/" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <head>
    <meta name="dtb:uid" content="urn:uuid:123-page-1"/>
    <meta name="dtb:totalElapsedTime" content="4.500"/>
    <meta name="dtb:audioClock" content="UTC"/>
  </head>
  <body>
    <seq>
      <par>
        <text src="page_1.xhtml#page1_p1_s1"/>
        <audio src="audio/audio.mp3" clipBegin="0.000s" clipEnd="2.100s"/>
      </par>
      <par>
        <text src="page_1.xhtml#page1_p1_s2"/>
        <audio src="audio/audio.mp3" clipBegin="2.100s" clipEnd="4.500s"/>
      </par>
    </seq>
  </body>
</smil>
```

## Example 4: Generated XHTML File

**File:** `OEBPS/page_1.xhtml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Page 1</title>
    <link rel="stylesheet" type="text/css" href="styles.css"/>
    <style type="text/css">
      body {
        font-family: serif;
        line-height: 1.6;
        margin: 1em;
        padding: 1em;
      }
      .epub-media-overlay-active {
        background-color: #ffff00;
        color: #000000;
      }
    </style>
  </head>
  <body>
    <p id="page1_p1_s1" class="epub-media-overlay-active fragment-type-sentence">Hello world! This is edited text.</p>
    <p id="page1_p1_s2" class="epub-media-overlay-active fragment-type-sentence">This is the second sentence.</p>
  </body>
</html>
```

## Example 5: Plain Text File for Aeneas

**File:** `backend/transcripts/job_123/chapter_1.txt`

```
Hello world! This is edited text.
This is the second sentence.
```

**Note:** This file is generated automatically from transcript JSON when realigning.

## Example 6: Batch Text Update

```bash
curl -X PUT http://localhost:8081/api/transcripts/job/123/page/1/fragments \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      {
        "id": "page1_p1_s1",
        "text": "Hello world! This is edited text."
      },
      {
        "id": "page1_p1_s2",
        "text": "This is the second sentence, also edited."
      }
    ]
  }'
```

## Example 7: Node.js Integration

```javascript
import { TranscriptService } from './services/transcriptService.js';
import { EpubBuilderFromTranscript } from './services/epubBuilderFromTranscript.js';

// Initialize transcript
const transcript = await TranscriptService.initializeFromSyncData(
  123,  // jobId
  1,    // pageNumber
  syncData,
  '/path/to/audio.mp3'
);

// Edit text
await TranscriptService.updateFragmentText(
  123,
  1,
  'page1_p1_s1',
  'Hello world! This is edited text.'
);

// Re-align
const updatedTranscript = await TranscriptService.realignTranscript(123, 1, {
  language: 'eng',
  granularity: 'sentence'
});

// Build EPUB
const builder = new EpubBuilderFromTranscript(123, './output');
const epubPath = await builder.build({
  title: 'My Book',
  author: 'Author Name',
  language: 'en'
});
```

## Example 8: Python Aeneas Execution

The system uses aeneas via Node.js child_process, but here's what happens internally:

```python
# This is executed by aeneasService.executeAlignment()
from aeneas.tools.execute_task import ExecuteTask

config_string = "task_language=eng|is_text_type=plain|os_task_file_format=json"
ExecuteTask.main(
    arguments=[
        "/path/to/audio.mp3",
        "/path/to/chapter_1.txt",
        config_string,
        "/path/to/output.json"
    ]
)
```

**Output JSON:**
```json
{
  "fragments": [
    {
      "begin": "0.000",
      "end": "2.100",
      "lines": ["Hello world! This is edited text."],
      "id": "f001"
    },
    {
      "begin": "2.100",
      "end": "4.500",
      "lines": ["This is the second sentence."],
      "id": "f002"
    }
  ]
}
```

This output is then mapped back to transcript fragments by index.







