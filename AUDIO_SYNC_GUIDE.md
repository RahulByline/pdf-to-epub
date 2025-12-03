# How to Sync Text with Audio - User Guide

## Overview
The Audio Sync feature allows you to synchronize text blocks from your EPUB with specific time segments in an audio file. This creates a read-along experience where text highlights as the audio plays.

## Step-by-Step Guide

### 1. **Access the Audio Sync Interface**

1. Go to **Conversions** page
2. Find a completed conversion job
3. Click the **"Audio Sync"** button
4. This opens the Audio Sync Editor at `/audio-sync/{jobId}`

### 2. **Understanding the Interface**

The interface has **three main sections**:

#### **Left Panel: PDF Canvas**
- Shows the PDF page image as background
- Text blocks are overlaid on the image (highlighted boxes)
- Click on a text block to select it

#### **Right Panel: XHTML Preview**
- Shows all text blocks extracted from the EPUB
- Each block shows:
  - HTML tag (e.g., `p`, `h1`, `div`)
  - Text content
  - Sync status (if synced, shows time range)
- Click on a block to select it

#### **Bottom Panel: Audio Waveform**
- Visual representation of the audio file
- Shows audio duration
- Play/pause controls
- Segment boundaries (start/end markers for each text block)

### 3. **How to Sync Text with Audio**

#### **Method 1: Manual Sync (Recommended)**

1. **Select a Text Block**
   - Click on a text block in either the PDF Canvas or XHTML Preview
   - The block will be highlighted

2. **Play the Audio**
   - Click the play button in the Audio Waveform panel
   - Listen to the audio

3. **Mark Start Time**
   - When the audio reaches the start of the selected text block:
     - Click the **"Mark Start"** button (or press a keyboard shortcut)
     - OR click on the waveform at the desired start position
   - This sets the `startTime` for that text block

4. **Mark End Time**
   - When the audio reaches the end of the selected text block:
     - Click the **"Mark End"** button (or press a keyboard shortcut)
     - OR click on the waveform at the desired end position
   - This sets the `endTime` for that text block

5. **Repeat for All Blocks**
   - Select the next text block
   - Mark its start and end times
   - Continue until all blocks are synced

#### **Method 2: Drag Boundaries on Waveform**

1. **Select a Text Block**
   - Click on a text block to select it

2. **Find the Segment on Waveform**
   - The waveform shows segment boundaries for synced blocks
   - If not synced yet, the segment will be at position 0

3. **Drag the Boundaries**
   - Drag the **left boundary** (start marker) to set start time
   - Drag the **right boundary** (end marker) to set end time
   - The audio will jump to that position when you drag

#### **Method 3: Automatic Sync (AI-Powered)**

1. **Click "Re-run Alignment"**
   - This uses AI to automatically align text with audio
   - Works best when you have:
     - Clean text (AI-corrected)
     - Good quality audio
     - Clear pronunciation

2. **Review and Adjust**
   - After automatic sync, review each block
   - Manually adjust any incorrect timings

### 4. **Saving Your Sync Data**

1. **Click "Save All Changes"**
   - This saves all sync timings to the database
   - Creates/updates `AudioSync` records for each text block

2. **What Gets Saved:**
   - `blockId`: Unique ID of the text block
   - `pageNumber`: Page number
   - `startTime`: Start time in seconds (e.g., 5.5)
   - `endTime`: End time in seconds (e.g., 8.2)
   - `pdfDocumentId`: PDF document ID
   - `conversionJobId`: Conversion job ID

### 5. **How Sync Data is Used**

Once saved, the sync data is used to:

1. **Generate SMIL Files**
   - Creates `.smil` files for EPUB 3 Media Overlays
   - Maps text blocks to audio segments

2. **Update EPUB**
   - Links SMIL files in `content.opf`
   - Updates XHTML files with sync IDs
   - Enables read-along in EPUB readers

3. **Playback Experience**
   - When user plays audio in EPUB reader
   - Text highlights as audio plays
   - Synchronized word-by-word or block-by-block

## Technical Details

### Audio Sync Data Structure

```json
{
  "id": 1234,
  "pdfDocumentId": 27,
  "conversionJobId": 71,
  "pageNumber": 9,
  "blockId": "p-1-3",
  "startTime": 45.5,
  "endTime": 48.2,
  "audioFilePath": "/path/to/audio.mp3"
}
```

### SMIL File Format

```xml
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <par>
      <text src="page_9.xhtml#p-1-3"/>
      <audio src="../audio/audio.mp3" clipBegin="45.5s" clipEnd="48.2s"/>
    </par>
  </body>
</smil>
```

## Tips for Best Results

1. **Start with Automatic Sync**
   - Use "Re-run Alignment" first
   - Then manually fine-tune

2. **Work Page by Page**
   - Sync one page at a time
   - Save frequently

3. **Use Keyboard Shortcuts** (if implemented)
   - Space: Play/Pause
   - S: Mark Start
   - E: Mark End

4. **Check Audio Quality**
   - Ensure audio is clear
   - No background noise
   - Consistent volume

5. **Review Sync Accuracy**
   - Play audio and watch text highlighting
   - Adjust boundaries if needed

## Troubleshooting

### Text Block Not Highlighting
- Check if sync data is saved
- Verify blockId matches
- Check SMIL file generation

### Audio Not Playing
- Verify audio file path
- Check audio format (MP3, M4A supported)
- Ensure audio is uploaded with PDF

### Sync Times Incorrect
- Use "Re-run Alignment" to recalculate
- Manually adjust boundaries
- Check audio file duration

## API Endpoints

- `GET /api/audio-sync/job/{jobId}/xhtml-pages` - Get XHTML pages with text blocks
- `GET /api/audio-sync/pdf/{pdfId}/job/{jobId}` - Get existing syncs
- `POST /api/audio-sync` - Create new sync
- `PUT /api/audio-sync/{id}` - Update existing sync
- `POST /api/audio-sync/job/{jobId}/realign` - Re-run AI alignment
- `POST /api/audio-sync/job/{jobId}/edit-log` - Log edits for training

