# Transcript-Based EPUB3 System

## Quick Start

### 1. Initialize Transcript from Existing Data

```bash
POST /api/transcripts/job/:jobId/initialize
{
  "pageNumber": 1,
  "audioFilePath": "/path/to/audio.mp3"
}
```

### 2. Edit Text

```bash
PUT /api/transcripts/job/:jobId/page/:pageNumber/fragment/:fragmentId
{
  "text": "Edited text here"
}
```

### 3. Re-run Aeneas Alignment

```bash
POST /api/transcripts/job/:jobId/page/:pageNumber/realign
{
  "language": "eng",
  "granularity": "sentence"
}
```

### 4. Build EPUB

```bash
POST /api/transcripts/job/:jobId/build-epub
{
  "title": "My Book",
  "author": "Author Name",
  "language": "en"
}
```

## Key Features

- ✅ **Editable Text**: User can edit transcript text
- ✅ **Single Source of Truth**: Transcript JSON is the only source
- ✅ **Aeneas Integration**: Re-runs alignment after text editing
- ✅ **SMIL Generation**: Generates EPUB3-compliant SMIL from transcript
- ✅ **XHTML Generation**: Generates EPUB3-compliant XHTML from transcript
- ✅ **EPUB Building**: Complete EPUB3 package from transcripts

## File Locations

- **Transcripts**: `backend/transcripts/job_{jobId}/chapter_{pageNumber}.json`
- **Text Files**: `backend/transcripts/job_{jobId}/chapter_{pageNumber}.txt`
- **Generated EPUB**: `backend/epub_output/converted_transcript_{jobId}.epub`

## Architecture

See `ARCHITECTURE.md` for detailed architecture documentation.

## Examples

See `EXAMPLES.md` for complete usage examples.

## API Reference

### GET /api/transcripts/job/:jobId
Get all transcripts for a job (summary)

### GET /api/transcripts/job/:jobId/page/:pageNumber
Get transcript for editing

### PUT /api/transcripts/job/:jobId/page/:pageNumber/fragment/:fragmentId
Update text for a single fragment

### PUT /api/transcripts/job/:jobId/page/:pageNumber/fragments
Batch update multiple fragment texts

### POST /api/transcripts/job/:jobId/page/:pageNumber/realign
Re-run aeneas alignment with edited text

### POST /api/transcripts/job/:jobId/initialize
Initialize transcript from existing sync data

### POST /api/transcripts/job/:jobId/build-epub
Build EPUB3 package from transcripts







