# Transcript-Based EPUB3 Architecture

## Overview

This document describes the transcript-based architecture for EPUB3 generation with editable text and aeneas forced alignment.

## Core Principles

1. **Transcript JSON is the Single Source of Truth**
   - All text content comes from transcript JSON
   - All timing data comes from aeneas alignment (stored in transcript)
   - XHTML and SMIL are generated FROM transcript, never edited directly

2. **Text Editing Flow**
   - User edits text in transcript JSON
   - Edited text is saved to transcript JSON
   - aeneas is re-run with edited text
   - Transcript is updated with new timings
   - XHTML/SMIL/EPUB are regenerated from updated transcript

3. **No Hard-Coded Timings**
   - All timing data originates from aeneas output
   - Timings are stored in transcript JSON
   - SMIL and XHTML generators read timings from transcript

4. **Stable Fragment IDs**
   - Fragment IDs remain constant across regenerations
   - IDs link XHTML elements to SMIL references
   - IDs are preserved when text is edited

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER EDITS TEXT                          │
│              (via API or UI)                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              TRANSCRIPT JSON (Single Source)               │
│  {                                                           │
│    jobId: 123,                                               │
│    pageNumber: 1,                                            │
│    fragments: [                                              │
│      { id: "page1_p1_s1", text: "hello",                    │
│        startTime: 0.0, endTime: 1.5 },                       │
│      { id: "page1_p1_s2", text: "world",                    │
│        startTime: 1.5, endTime: 2.8 }                       │
│    ]                                                         │
│  }                                                           │
└─────┬───────────────────────────────────────────────────────┘
      │
      ├─────────────────┬──────────────────┬─────────────────┐
      │                 │                  │                 │
      ▼                 ▼                  ▼                 ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
│   AENEAS    │  │  XHTML GEN   │  │  SMIL GEN    │  │  EPUB BUILD │
│  ALIGNMENT  │  │  (from       │  │  (from       │  │  (from      │
│  (audio +   │  │  transcript) │  │  transcript) │  │  transcripts)│
│  text.txt)  │  │              │  │              │  │             │
└─────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬───────┘
      │                 │                  │                 │
      │                 │                  │                 │
      ▼                 ▼                  ▼                 ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
│  Updated    │  │  page_1.xhtml│  │  page_1.smil │  │  book.epub  │
│  Transcript │  │  (with IDs)  │  │  (with refs) │  │  (complete) │
│  (timings)  │  │              │  │              │  │             │
└─────────────┘  └──────────────┘  └──────────────┘  └─────────────┘
```

## File Structure

```
backend/
├── transcripts/              # Transcript storage
│   └── job_{jobId}/
│       ├── chapter_1.json   # Transcript JSON
│       ├── chapter_1.txt    # Plain text for aeneas
│       ├── chapter_2.json
│       └── chapter_2.txt
│
├── src/
│   ├── models/
│   │   └── Transcript.js    # Transcript model (file I/O)
│   │
│   ├── services/
│   │   ├── transcriptService.js      # Transcript CRUD & realignment
│   │   ├── smilGenerator.js          # SMIL from transcript
│   │   ├── xhtmlGenerator.js         # XHTML from transcript
│   │   └── epubBuilderFromTranscript.js  # EPUB from transcripts
│   │
│   └── routes/
│       └── transcriptRoutes.js       # API endpoints
```

## Transcript JSON Schema

```json
{
  "jobId": 123,
  "pageNumber": 1,
  "audioFilePath": "/path/to/audio.mp3",
  "fragments": [
    {
      "id": "page1_p1_s1",
      "text": "Hello world. This is a sentence.",
      "startTime": 0.000,
      "endTime": 2.345,
      "type": "sentence"
    },
    {
      "id": "page1_p1_s1_w1",
      "text": "Hello",
      "startTime": 0.000,
      "endTime": 0.500,
      "type": "word"
    }
  ],
  "metadata": {
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "lastAlignedAt": "2024-01-01T00:00:00.000Z",
    "aeneasVersion": "1.7.3",
    "language": "eng",
    "alignmentMethod": "aeneas",
    "textEdited": true
  }
}
```

## Workflow

### 1. Initialize Transcript

```javascript
// From existing sync data
POST /api/transcripts/job/123/initialize
{
  "pageNumber": 1,
  "audioFilePath": "/path/to/audio.mp3"
}
```

### 2. Edit Text

```javascript
// Update single fragment
PUT /api/transcripts/job/123/page/1/fragment/page1_p1_s1
{
  "text": "Hello world! This is edited text."
}

// Batch update
PUT /api/transcripts/job/123/page/1/fragments
{
  "updates": [
    { "id": "page1_p1_s1", "text": "New text 1" },
    { "id": "page1_p1_s2", "text": "New text 2" }
  ]
}
```

### 3. Re-run Aeneas Alignment

```javascript
POST /api/transcripts/job/123/page/1/realign
{
  "language": "eng",
  "granularity": "sentence"
}
```

This will:
1. Load transcript JSON
2. Generate `chapter_1.txt` from edited text
3. Run aeneas: `aeneas audio.mp3 chapter_1.txt → alignment.json`
4. Update transcript with new timings
5. Save updated transcript

### 4. Generate EPUB

```javascript
POST /api/transcripts/job/123/build-epub
{
  "title": "My Book",
  "author": "Author Name",
  "language": "en",
  "audioFileName": "audio.mp3"
}
```

This will:
1. Load all transcripts
2. Generate XHTML files from transcripts
3. Generate SMIL files from transcripts
4. Build OPF manifest
5. Package EPUB3 file

## Key Components

### TranscriptModel

- File-based storage (JSON files)
- Schema validation
- Text file generation for aeneas
- CRUD operations

### TranscriptService

- Initialize from sync data
- Update fragment text
- Re-run aeneas alignment
- Get transcript for editing

### SMIL Generator

- Generates EPUB3-compliant SMIL from transcript
- Each fragment → `<par>` element
- Fragment IDs match XHTML IDs

### XHTML Generator

- Generates EPUB3-compliant XHTML from transcript
- Each fragment → HTML element with matching ID
- Text content from transcript

### EPUB Builder

- Builds complete EPUB3 package
- Uses transcripts as single source
- Generates all files from transcripts

## API Endpoints

### Transcript Management

- `GET /api/transcripts/job/:jobId` - List all transcripts
- `GET /api/transcripts/job/:jobId/page/:pageNumber` - Get transcript
- `PUT /api/transcripts/job/:jobId/page/:pageNumber/fragment/:fragmentId` - Update text
- `PUT /api/transcripts/job/:jobId/page/:pageNumber/fragments` - Batch update
- `POST /api/transcripts/job/:jobId/page/:pageNumber/realign` - Re-run aeneas
- `POST /api/transcripts/job/:jobId/initialize` - Initialize from sync data
- `POST /api/transcripts/job/:jobId/build-epub` - Build EPUB

## Example Usage

See `EXAMPLES.md` for complete examples.

## Migration Guide

To migrate existing sync data to transcripts:

1. Call `POST /api/transcripts/job/:jobId/initialize` for each page
2. Transcripts are created from existing audio sync records
3. Future edits use transcript API
4. EPUB generation uses transcripts instead of sync data







