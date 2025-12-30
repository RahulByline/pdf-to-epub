# TTS Audio Generation Flow - Complete Text Source Trace

## Overview
This document explains exactly where the TTS system fetches text from to generate audio.

---

## Complete Flow: From XHTML to Audio

### **Step 1: Frontend - Parse XHTML Elements**
**Location:** `frontend/src/pages/SyncStudio.jsx` - `parseXhtmlElements()` function

**What happens:**
1. Loads EPUB sections (XHTML files) from the backend
2. Parses each XHTML section using `DOMParser`
3. **Extracts text from XHTML in this priority order:**

   **Priority 1: Paragraph-level extraction**
   - Looks for elements with class `paragraph-block` (e.g., `<p class="paragraph-block">`)
   - Gets the **full text content** of the entire paragraph (includes all nested words/sentences)
   - Example: Extracts `"Have you ever wished you were a horse?"` from:
     ```xhtml
     <p id="page4_p1" class="paragraph-block" data-read-aloud="true">
       <span class="sync-sentence" id="page4_p1_s1">
         <span class="sync-word" id="page4_p1_s1_w1">Have</span>
         <span class="sync-word" id="page4_p1_s1_w2">you</span>
         ...
       </span>
     </p>
     ```
   - Uses the paragraph's ID (`page4_p1`) as the block identifier

   **Priority 2: Fallback to sentence-level**
   - If no paragraph-block found, extracts elements with `data-read-aloud="true"`
   - Skips word-level elements (`sync-word` class or IDs containing `_w`)
   - Only processes sentence-level or paragraph-level elements

4. Filters out unspoken content (TOC, headers, footers, page numbers, etc.)
5. Stores parsed elements in `parsedElements` state

**Key Code:**
```javascript
// Priority 1: Extract paragraph-level elements
const paragraphElements = doc.querySelectorAll('.paragraph-block, [class*="paragraph-block"], p.paragraph-block');

if (paragraphElements.length > 0) {
  paragraphElements.forEach((paragraphEl) => {
    const id = paragraphEl.getAttribute('id') || '';
    const text = paragraphEl.textContent?.trim() || ''; // Full paragraph text
    // ... filters and adds to elements array
  });
}
```

---

### **Step 2: Frontend - Filter and Prepare Text Blocks**
**Location:** `frontend/src/pages/SyncStudio.jsx` - `handleGenerateAudio()` function

**What happens:**
1. Filters `parsedElements` to:
   - Only include sentence/paragraph types (exclude word types)
   - Exclude TOC pages
   - Exclude unspoken content patterns
   - Remove duplicates

2. Groups small fragments (words) into sentences if needed
3. Creates `textBlocks` array with structure:
   ```javascript
   textBlocks = [
     {
       id: "page4_p1",           // Paragraph ID from XHTML
       pageNumber: 4,
       text: "Have you ever wished you were a horse?"  // Full paragraph text
     },
     // ... more blocks
   ]
   ```

4. Sends `textBlocks` to backend via API call:
   ```javascript
   await audioSyncService.generateAudio(
     pdfId,
     jobId,
     voiceToUse,
     textBlocks,      // ← Text blocks from XHTML parsing
     ttsOptions       // ← TTS configuration (voice, gender, speed, etc.)
   );
   ```

---

### **Step 3: Backend API - Receive Text Blocks**
**Location:** `backend/src/routes/audioSyncRoutes.js` - `POST /api/audio-sync/generate`

**What happens:**
1. Receives `textBlocks` array from frontend
2. **If textBlocks provided:** Uses them directly (this is the normal flow)
3. **If textBlocks NOT provided (fallback):** Extracts from EPUB/PDF:
   - Tries `AudioSyncService.extractTextFromEpub(jobId)` first
   - Falls back to `AudioSyncService.extractTextFromPdf(pdfId)` if EPUB fails

4. Maps textBlocks to textChunks format:
   ```javascript
   textChunks = textBlocks.map((block) => ({
     id: block.id,              // e.g., "page4_p1"
     pageNumber: block.pageNumber,
     text: block.text,          // e.g., "Have you ever wished you were a horse?"
     sectionId: block.sectionId,
     sectionTitle: block.sectionTitle
   }));
   ```

5. Calls `AudioSyncService.generateCompleteAudio()` with textChunks

---

### **Step 4: Backend Service - Generate Audio for Each Text Chunk**
**Location:** `backend/src/services/audioSyncService.js` - `generateCompleteAudio()` function

**What happens:**
1. Loops through each text chunk
2. For each chunk, calls `generateAudioForText()`:
   ```javascript
   for (const chunk of textChunks) {
     const audio = await this.generateAudioForText(
       chunk.text,        // ← The actual text: "Have you ever wished you were a horse?"
       voice,
       pdfId,
       chunk.id,         // ← Block ID: "page4_p1"
       ttsOptions        // ← TTS config (gender, speed, language, etc.)
     );
   }
   ```

---

### **Step 5: Backend Service - Generate TTS Audio**
**Location:** `backend/src/services/audioSyncService.js` - `generateAudioForText()` function

**What happens:**
1. Receives the text string (e.g., `"Have you ever wished you were a horse?"`)
2. Extracts TTS options:
   - `language` from `ttsOptions.language` (default: 'en')
   - `speed` from `ttsOptions.speed` (default: 1.0)
   - `gender` from `ttsOptions.gender` (default: 'NEUTRAL')
   - `voice` from parameter

3. **Calls TtsService.generateAudio():**
   ```javascript
   const audioBuffer = await TtsService.generateAudio(text, {
     voice: voice,
     language: language,
     speed: speed,
     gender: gender
   });
   ```

4. Writes audio buffer to file: `audio_${pdfId}_${chunkId}_${uuid}.mp3`

---

### **Step 6: TTS Service - Synthesize Speech**
**Location:** `backend/src/services/TtsService.js` - `generateAudio()` function

**What happens:**
1. Receives text string and options
2. Creates temporary file path
3. Maps options to voice config:
   ```javascript
   const voiceConfig = {
     languageCode: options.language || 'en-US',
     name: options.voice || undefined,
     ssmlGender: options.gender || 'NEUTRAL'  // MALE, FEMALE, or NEUTRAL
   };
   ```

4. **Calls synthesizePageAudio():**
   ```javascript
   const result = await this.synthesizePageAudio({
     text: text,                    // ← The text to synthesize
     audioOutPath: tempAudioPath,
     voice: voiceConfig
   });
   ```

5. Returns audio buffer (MP3 file data)

---

### **Step 7: TTS Service - Actual TTS Synthesis**
**Location:** `backend/src/services/TtsService.js` - `synthesizePageAudio()` function

**What happens:**
1. Uses Google Cloud Text-to-Speech API (if credentials available)
   - Sends text to Google Cloud TTS
   - Gets audio with word-level timings
   - Returns audio buffer

2. **OR** uses free gTTS library (fallback if no Google credentials)
   - Uses `gtts` npm package
   - Generates audio file
   - Returns audio buffer

---

## Summary: Text Source Flow

```
XHTML File (page_4.xhtml)
    ↓
parseXhtmlElements() - Extracts paragraph text
    ↓
handleGenerateAudio() - Filters and prepares textBlocks
    ↓
API POST /api/audio-sync/generate - Receives textBlocks
    ↓
generateCompleteAudio() - Loops through chunks
    ↓
generateAudioForText() - Gets text string
    ↓
TtsService.generateAudio() - Maps to voice config
    ↓
synthesizePageAudio() - Calls Google Cloud TTS or gTTS
    ↓
Audio File Generated (MP3)
```

## Key Points

1. **Text Source:** XHTML files (EPUB sections) parsed in the frontend
2. **Extraction Method:** Paragraph-level extraction (class="paragraph-block")
3. **Text Format:** Full paragraph text, not individual words
4. **TTS Engine:** Google Cloud TTS (primary) or gTTS (fallback)
5. **Configuration:** Uses TTS Management settings (voice, gender, speed, language)

## Example Flow for Your XHTML

**Input XHTML:**
```xhtml
<p id="page4_p1" class="paragraph-block" data-read-aloud="true">
  <span class="sync-sentence" id="page4_p1_s1">
    <span class="sync-word" id="page4_p1_s1_w1">Have</span>
    <span class="sync-word" id="page4_p1_s1_w2">you</span>
    <span class="sync-word" id="page4_p1_s1_w3">ever</span>
    <span class="sync-word" id="page4_p1_s1_w4">wished</span>
    <span class="sync-word" id="page4_p1_s1_w5">you</span>
    <span class="sync-word" id="page4_p1_s1_w6">were</span>
    <span class="sync-word" id="page4_p1_s1_w7">a</span>
    <span class="sync-word" id="page4_p1_s1_w8">horse?</span>
  </span>
</p>
```

**Extracted Text Block:**
```javascript
{
  id: "page4_p1",
  pageNumber: 4,
  text: "Have you ever wished you were a horse?"
}
```

**TTS Generation:**
- Text sent to TTS: `"Have you ever wished you were a horse?"`
- Voice config: Based on TTS Management settings
- Audio generated: Complete sentence as one audio segment

