# How EPUB Players Read Your EPUB File

## Overview

EPUB players (like Thorium, Readium, Adobe Digital Editions) read EPUB files through a structured process that follows EPUB3 standards. Here's how your EPUB file is processed:

## 1. **Reading Order (Spine)**

The **spine** in `content.opf` defines the reading order:

```xml
<spine toc="nav">
  <itemref idref="page1"/>
  <itemref idref="page2"/>
  <itemref idref="page3"/>
  ...
</spine>
```

**How it works:**
- Player reads files in spine order (page1.xhtml → page2.xhtml → page3.xhtml)
- Each `<itemref>` points to an XHTML file
- If media overlay exists, it's referenced: `<itemref idref="page1" media-overlay="smil-page1"/>`

## 2. **XHTML Content Structure**

Each page XHTML file contains:

```xml
<body class="fixed-layout-page">
  <div class="page-container">
    <img src="image/page_1.png" alt="" aria-hidden="true"/>
    <div class="text-content" role="article">
      <h1 id="h1_1_1">If You Were a Horse</h1>
      <p id="p_1_1">Have you ever wished you were a horse?</p>
      <p id="p_1_2">Horses are beautiful animals...</p>
    </div>
  </div>
</body>
```

**Key elements:**
- **IDs on text elements**: Required for SMIL synchronization (`id="p_1_1"`)
- **Semantic HTML**: `<h1>`, `<p>`, `<li>` help TTS understand structure
- **ARIA attributes**: `role="article"`, `aria-label` provide context
- **Hidden images**: `aria-hidden="true"` prevents TTS from reading image descriptions

## 3. **Text-to-Speech (TTS) Reading Process**

### Without Audio (TTS Mode):
1. **Player opens first XHTML file** from spine
2. **Extracts text content** from semantic elements:
   - Headings: `<h1>`, `<h2>`, `<h3>`, etc.
   - Paragraphs: `<p>`
   - Lists: `<li>` within `<ul>` or `<ol>`
   - Other text: `<span>`, `<div>` with text
3. **Reads in DOM order** (top to bottom, left to right)
4. **Respects reading order** attribute if present
5. **Skips hidden elements**: `aria-hidden="true"`, `display:none`
6. **Announces structure**: "Heading level 1", "List with 3 items"

### Reading Order Priority:
1. **Explicit reading order**: `readingOrder` attribute on elements
2. **DOM order**: Natural HTML flow
3. **Semantic structure**: Headings before paragraphs, lists as units

## 4. **Audio Playback with SMIL (Media Overlay)**

When audio file exists, SMIL files synchronize audio with text:

### SMIL File Structure (`page_1.smil`):
```xml
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <seq>
      <par id="par-1-1">
        <text src="page_1.xhtml#h1_1_1"/>
        <audio src="audio/narration.mp3" clipBegin="0:00:00.000" clipEnd="0:00:02.500"/>
      </par>
      <par id="par-1-2">
        <text src="page_1.xhtml#p_1_1"/>
        <audio src="audio/narration.mp3" clipBegin="0:00:02.500" clipEnd="0:00:05.000"/>
      </par>
    </seq>
  </body>
</smil>
```

### How Player Uses SMIL:
1. **Player loads SMIL file** referenced in spine: `media-overlay="smil-page1"`
2. **For each `<par>` element**:
   - Finds XHTML element by ID: `page_1.xhtml#p_1_1`
   - Plays audio segment: `clipBegin` to `clipEnd`
   - **Applies CSS class**: `-epub-media-overlay-active` to highlight text
3. **Sequential playback**: `<seq>` ensures order (par-1-1 → par-1-2 → par-1-3)
4. **Text highlighting**: CSS class makes text visible during audio playback

## 5. **Content.OPF Configuration**

The package file (`content.opf`) configures reading:

```xml
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata>
    <!-- Media overlay configuration -->
    <meta property="media:active-class">-epub-media-overlay-active</meta>
    <meta property="media:duration">0:15:30.000</meta>
  </metadata>
  
  <manifest>
    <item id="page1" href="page_1.xhtml" media-type="application/xhtml+xml"/>
    <item id="smil-page1" href="page_1.smil" media-type="application/smil+xml"/>
    <item id="audio" href="audio/narration.mp3" media-type="audio/mpeg"/>
    <item id="css" href="css/fixed-layout.css" media-type="text/css"/>
  </manifest>
  
  <spine toc="nav">
    <itemref idref="page1" media-overlay="smil-page1"/>
    <itemref idref="page2" media-overlay="smil-page2"/>
  </spine>
</package>
```

## 6. **What Gets Read**

### ✅ **Read by TTS:**
- Text in `<h1>` through `<h6>` (headings)
- Text in `<p>` (paragraphs)
- Text in `<li>` (list items)
- Text in `<span>` and `<div>` with text content
- Alt text from images: `<img alt="description">`
- ARIA labels: `aria-label="Page 1 content"`

### ❌ **Skipped by TTS:**
- Elements with `aria-hidden="true"` (decorative images)
- Elements with `display:none` or `visibility:hidden`
- Empty elements
- Scripts and styles
- Headers/footers marked for exclusion

## 7. **Reading Flow Example**

**Page 1 Reading Order:**
```
1. <h1 id="h1_1_1">If You Were a Horse</h1>
   → TTS: "Heading level 1: If You Were a Horse"
   
2. <p id="p_1_1">Have you ever wished you were a horse?</p>
   → TTS: "Have you ever wished you were a horse?"
   
3. <p id="p_1_2">Horses are beautiful animals...</p>
   → TTS: "Horses are beautiful animals..."
```

**With Audio (SMIL):**
```
1. Audio plays 0:00:00-0:00:02.5 → Highlights <h1 id="h1_1_1">
2. Audio plays 0:00:02.5-0:00:05.0 → Highlights <p id="p_1_1">
3. Audio plays 0:00:05.0-0:00:08.0 → Highlights <p id="p_1_2">
```

## 8. **Key Requirements for Proper Reading**

### ✅ **Must Have:**
1. **Unique IDs** on all text elements (for SMIL sync)
2. **Semantic HTML** (`<h1>`, `<p>`, `<li>`, not just `<div>`)
3. **Reading order** attributes or proper DOM order
4. **SMIL files** with correct ID references
5. **Media overlay** references in spine
6. **CSS class** for highlighting: `-epub-media-overlay-active`

### ⚠️ **Best Practices:**
- Use proper heading hierarchy (h1 → h2 → h3)
- Group related content in semantic containers
- Mark decorative elements as `aria-hidden="true"`
- Provide alt text for meaningful images
- Use `role` attributes for clarity

## 9. **How Your System Ensures Proper Reading**

1. **Reading Order**: Blocks sorted by `readingOrder` attribute
2. **Semantic Tags**: Proper HTML tags (h1, p, li) based on content type
3. **ID Generation**: All text elements get unique IDs
4. **SMIL Sync**: Audio segments mapped to text element IDs
5. **Spine Order**: Pages added to spine in correct sequence
6. **Media Overlay**: SMIL files linked to XHTML pages
7. **CSS Highlighting**: Active class applied during audio playback

## 10. **Debugging Reading Issues**

If text isn't being read correctly:

1. **Check IDs**: Ensure all text elements have IDs matching SMIL references
2. **Verify Spine**: Check `content.opf` spine order
3. **Test SMIL**: Validate SMIL file references match XHTML IDs
4. **Check CSS**: Ensure highlighting class is defined
5. **Validate XHTML**: Ensure proper semantic structure
6. **Review Reading Order**: Check `readingOrder` attributes

## Summary

Your EPUB player reads content by:
1. Following the **spine order** in `content.opf`
2. Extracting **text from semantic HTML elements** in XHTML files
3. Using **SMIL files** to synchronize audio with text (if available)
4. Applying **CSS highlighting** during audio playback
5. Respecting **reading order** and **ARIA attributes** for accessibility

The system ensures proper reading by generating semantic HTML, unique IDs, SMIL synchronization, and proper EPUB3 structure.

