# Migration Guide: Sync Data → Transcript System

## Overview

This guide explains how to migrate from the existing audio sync system to the new transcript-based system.

## Migration Steps

### Step 1: Identify Jobs to Migrate

List all conversion jobs that have audio sync data:

```sql
SELECT DISTINCT conversion_job_id 
FROM audio_syncs 
WHERE start_time IS NOT NULL 
  AND end_time IS NOT NULL;
```

### Step 2: Initialize Transcripts

For each job and page, initialize transcript from sync data:

```bash
# For each jobId and pageNumber
POST /api/transcripts/job/{jobId}/initialize
{
  "pageNumber": 1,
  "audioFilePath": "/path/to/audio.mp3"
}
```

**What this does:**
1. Fetches all audio sync records for the job/page
2. Converts sync records to transcript fragments
3. Creates `chapter_{pageNumber}.json` file
4. Preserves all IDs, text, and timings

### Step 3: Verify Transcripts

Check that transcripts were created:

```bash
GET /api/transcripts/job/{jobId}
```

Should return summaries for all pages.

### Step 4: Test Text Editing

Edit a fragment to verify the system works:

```bash
PUT /api/transcripts/job/{jobId}/page/1/fragment/{fragmentId}
{
  "text": "Test edited text"
}
```

### Step 5: Test Realignment

Re-run aeneas to verify alignment works:

```bash
POST /api/transcripts/job/{jobId}/page/1/realign
{
  "language": "eng",
  "granularity": "sentence"
}
```

### Step 6: Test EPUB Generation

Build EPUB from transcripts:

```bash
POST /api/transcripts/job/{jobId}/build-epub
{
  "title": "Test Book",
  "author": "Test Author",
  "language": "en"
}
```

## Migration Script

Here's a Node.js script to automate migration:

```javascript
import { TranscriptService } from './services/transcriptService.js';
import { AudioSyncService } from './services/audioSyncService.js';

async function migrateJobToTranscripts(jobId) {
  console.log(`Migrating job ${jobId} to transcript system...`);

  // Get all sync data
  const syncData = await AudioSyncService.getAudioSyncsByJobId(jobId);
  
  if (syncData.length === 0) {
    console.log(`No sync data found for job ${jobId}`);
    return;
  }

  // Group by page number
  const pages = {};
  syncData.forEach(sync => {
    const pageNum = sync.pageNumber || 1;
    if (!pages[pageNum]) {
      pages[pageNum] = [];
    }
    pages[pageNum].push(sync);
  });

  // Get audio file path (from first sync record)
  const audioFilePath = syncData[0]?.audioFilePath || null;

  // Initialize transcript for each page
  for (const [pageNumber, pageSyncs] of Object.entries(pages)) {
    try {
      const transcript = await TranscriptService.initializeFromSyncData(
        jobId,
        parseInt(pageNumber),
        syncData,
        audioFilePath
      );
      console.log(`✓ Initialized transcript for page ${pageNumber} (${transcript.fragments.length} fragments)`);
    } catch (error) {
      console.error(`✗ Failed to initialize transcript for page ${pageNumber}:`, error.message);
    }
  }

  console.log(`Migration complete for job ${jobId}`);
}

// Usage
// migrateJobToTranscripts(123);
```

## Verification Checklist

After migration, verify:

- [ ] Transcript JSON files exist for all pages
- [ ] Fragment IDs match original sync block IDs
- [ ] Text content matches original sync custom_text or text
- [ ] Timings match original sync start_time/end_time
- [ ] Text editing works
- [ ] Realignment works
- [ ] EPUB generation works
- [ ] Generated EPUB has correct SMIL references
- [ ] Generated EPUB has correct XHTML IDs

## Rollback Plan

If migration fails:

1. Transcript files are stored in `backend/transcripts/job_{jobId}/`
2. Original sync data remains in database (not deleted)
3. Delete transcript directory to rollback:
   ```bash
   rm -rf backend/transcripts/job_{jobId}
   ```

## Post-Migration

After successful migration:

1. **Update Frontend**: Modify UI to use transcript API endpoints
2. **Update Workflows**: Change EPUB generation to use transcript builder
3. **Monitor**: Watch for any issues with transcript-based generation
4. **Archive**: Keep old sync data for reference (optional)

## Differences from Old System

| Old System | New System |
|------------|------------|
| Text in database (custom_text) | Text in transcript JSON |
| Timings in database | Timings in transcript JSON |
| SMIL generated from sync data | SMIL generated from transcript |
| XHTML generated from sync data | XHTML generated from transcript |
| Edit → Update database → Regenerate | Edit → Update transcript → Realign → Regenerate |

## Benefits

1. **Single Source of Truth**: Transcript JSON is the only source
2. **Version Control**: Transcript files can be version controlled
3. **Offline Editing**: Transcripts can be edited offline
4. **Cleaner Architecture**: Clear separation of concerns
5. **Easier Debugging**: Transcript files are human-readable


