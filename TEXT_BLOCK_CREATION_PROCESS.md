# How Text Blocks Are Created

## Overview
Text blocks are created from PDF pages through a multi-step process that extracts individual characters, groups them into logical blocks, and enriches them with metadata.

## Step-by-Step Process

### Step 1: Extract Individual Text Positions
**Location:** `TextExtractionService.extractTextBlocksWithPositioning()`

Uses `PositionAwareTextStripper` (custom PDFBox stripper) to extract:
- Each character/word with its exact position
- X, Y coordinates (PDF coordinate system: Y=0 at bottom)
- Width, Height of each text element
- Font information (name, size, bold, italic)

```java
PositionAwareTextStripper stripper = new PositionAwareTextStripper();
stripper.setSortByPosition(true);
List<TextPositionInfo> textPositions = stripper.getTextPositions();
```

**TextPositionInfo contains:**
- `text`: The actual character/word
- `x, y`: Position coordinates (Y from bottom of page)
- `width, height`: Dimensions
- `fontSize, fontName`: Font details
- `isBold, isItalic`: Style flags

---

### Step 2: Group Text Positions into Blocks
**Location:** `TextExtractionService.groupTextPositions()`

Groups individual text positions into logical blocks based on:
- **Proximity**: Text close together vertically/horizontally
- **Line height**: Calculates average line height to determine grouping thresholds
- **Alignment**: Text with similar X coordinates (same column)

**Grouping Algorithm:**
1. **Sort positions** by Y (top to bottom), then X (left to right)
2. **Calculate thresholds:**
   - `verticalThreshold = lineHeight * 2.0` (lines within 2x line height = same block)
   - `horizontalThreshold = max(50, lineHeight * 3)` (characters within threshold = same line)
   - `maxLineGap = lineHeight * 0.8` (max gap for same line)

3. **Group logic:**
   - If text is on **same line**: `verticalDistance < maxLineGap && horizontalDistance < horizontalThreshold`
   - If text is in **same block**: `sameLine OR (verticalDistance < verticalThreshold && similar X alignment)`

4. **Track bounding box:**
   - `minX, maxX`: Left and right boundaries
   - `minY, maxY`: Bottom and top boundaries (Y from bottom)

**TextPositionGroup contains:**
- `positions`: List of TextPositionInfo in this group
- `text`: Combined text string
- `minX, maxX, minY, maxY`: Bounding box coordinates

---

### Step 3: Convert Groups to TextBlocks
**Location:** `TextExtractionService.extractTextBlocksWithPositioning()` (lines 324-437)

For each `TextPositionGroup`, creates a `TextBlock`:

#### 3.1 Basic Text Block Creation
```java
TextBlock block = new TextBlock();
block.setId("block_" + pageIndex + "_" + blockOrder++);
block.setText(correctedText);
block.setReadingOrder(blockOrder);
```

#### 3.2 AI Text Correction (Optional)
Uses Gemini AI to clean and correct text:
- Removes OCR artifacts
- Fixes missing/incorrect letters
- Normalizes spacing and punctuation
- Preserves proper names and technical terms

```java
if (geminiService != null && geminiService.isEnabled()) {
    correctedText = geminiService.generate(prompt);
}
```

#### 3.3 Determine Block Type
Uses AI (Gemini) or regex patterns to determine block type:
- `HEADING` (H1, H2, H3, etc.)
- `PARAGRAPH`
- `LIST_ITEM`, `LIST_ORDERED`, `LIST_UNORDERED`
- `CAPTION`, `FOOTNOTE`, `SIDEBAR`
- `QUESTION`, `EXERCISE`, `ANSWER`
- `EXAMPLE`, `NOTE`, `TIP`, `WARNING`
- `GLOSSARY_TERM`, `LEARNING_OBJECTIVE`

```java
TextBlock.BlockType blockType = determineBlockTypeWithGemini(correctedText, pageIndex + 1);
if (blockType == null) {
    blockType = determineBlockType(correctedText); // Regex fallback
}
```

#### 3.4 Set Font Information
Extracts from first position in group:
```java
TextPositionInfo firstPos = group.positions.get(0);
block.setFontName(firstPos.fontName);
block.setFontSize(firstPos.fontSize);
block.setIsBold(firstPos.isBold);
block.setIsItalic(firstPos.isItalic);
```

#### 3.5 Create Bounding Box
Calculates bounding box from group coordinates:
```java
BoundingBox bbox = new BoundingBox();
bbox.setX(group.minX);           // Left edge
bbox.setY(group.minY);           // Bottom Y (from bottom of page)
bbox.setWidth(group.maxX - group.minX);   // Width
bbox.setHeight(group.maxY - group.minY);   // Height
bbox.setPageNumber(pageIndex + 1);
block.setBoundingBox(bbox);
```

**Important:** 
- `minY` = bottom-most Y coordinate (from bottom of page)
- `maxY` = top-most Y coordinate (from bottom of page)
- `bbox.getY()` = `minY` (bottom coordinate)
- Height = `maxY - minY`

#### 3.6 Text Segmentation
Segments text into words, sentences, and phrases for audio sync:
```java
TextSegmentationService.TextSegmentation segmentation = 
    textSegmentationService.segmentText(correctedText, block.getId());
block.setWords(segmentation.words);
block.setSentences(segmentation.sentences);
block.setPhrases(segmentation.phrases);
```

---

## Visual Flow Diagram

```
PDF Page
    │
    ├─► PositionAwareTextStripper
    │   └─► Extract individual text positions
    │       ├─► Character "H" at (x=100, y=700, width=10, height=12)
    │       ├─► Character "e" at (x=110, y=700, width=8, height=12)
    │       ├─► Character "l" at (x=118, y=700, width=5, height=12)
    │       └─► ... (hundreds of positions)
    │
    ├─► groupTextPositions()
    │   └─► Group positions by proximity
    │       ├─► Group 1: "Hello World" (positions 0-10)
    │       ├─► Group 2: "This is a paragraph..." (positions 11-50)
    │       └─► Group 3: "Chapter 1" (positions 51-55)
    │
    ├─► For each Group:
    │   ├─► AI Text Correction (Gemini)
    │   ├─► Determine Block Type (AI or Regex)
    │   ├─► Extract Font Info
    │   ├─► Calculate Bounding Box
    │   └─► Text Segmentation
    │
    └─► TextBlock[] (Final Output)
        ├─► Block 1: {text: "Hello World", type: HEADING, bbox: {...}, ...}
        ├─► Block 2: {text: "This is a paragraph...", type: PARAGRAPH, bbox: {...}, ...}
        └─► Block 3: {text: "Chapter 1", type: HEADING, bbox: {...}, ...}
```

---

## Key Data Structures

### TextPositionInfo
```java
class TextPositionInfo {
    String text;        // Single character or word
    double x, y;       // Position (Y from bottom)
    double width, height;
    double fontSize;
    String fontName;
    boolean isBold, isItalic;
}
```

### TextPositionGroup
```java
class TextPositionGroup {
    List<TextPositionInfo> positions;
    StringBuilder text;              // Combined text
    double minX, maxX;               // Horizontal bounds
    double minY, maxY;               // Vertical bounds (Y from bottom)
}
```

### TextBlock (Final Output)
```java
class TextBlock {
    String id;                       // "block_0_1"
    String text;                      // Corrected text
    BlockType type;                   // HEADING, PARAGRAPH, etc.
    Integer level;                   // Heading level (1, 2, 3...)
    BoundingBox boundingBox;         // Position and size
    String fontName;
    Double fontSize;
    Boolean isBold, isItalic;
    Integer readingOrder;
    Double confidence;
    
    // Segmentation for audio sync
    List<String> words;
    List<String> sentences;
    List<String> phrases;
    Integer wordCount, sentenceCount, phraseCount;
}
```

---

## Coordinate System Notes

**PDF Coordinate System:**
- Origin (0,0) at **bottom-left** corner
- Y increases **upward**
- `getYDirAdj()` returns Y coordinate from bottom

**Text Block Bounding Box:**
- `bbox.getY()` = `minY` = **bottom** Y coordinate (from bottom of page)
- `bbox.getHeight()` = `maxY - minY` = actual height
- To convert to HTML (top-left origin): `htmlTop = pageHeight - (minY + height)`

**Example:**
- PDF page height: 792 points
- Text block: minY=100, maxY=120 (from bottom)
- Height = 20 points
- HTML top position = 792 - (100 + 20) = 672 points from top

---

## Fallback: Plain Text Extraction

If position extraction fails or loses too much text:
```java
extractTextBlocksFromPlainText(plainText, pageIndex, mediaBox)
```

This method:
1. Splits plain text by paragraphs
2. Estimates positions (top to bottom)
3. Creates TextBlocks without precise coordinates

---

## Example: Creating a Text Block

**Input PDF Page:**
```
    Chapter 1: Introduction
    This is the first paragraph of the chapter.
    It contains multiple sentences.
```

**Step 1: Extract Positions**
- "C" at (50, 750, 10, 12)
- "h" at (60, 750, 8, 12)
- "a" at (68, 750, 8, 12)
- ... (continues for all characters)

**Step 2: Group Positions**
- Group 1: "Chapter 1: Introduction" (all positions with Y ≈ 750)
- Group 2: "This is the first paragraph..." (all positions with Y ≈ 730)
- Group 3: "It contains multiple sentences." (all positions with Y ≈ 710)

**Step 3: Create TextBlocks**
- Block 1:
  - text: "Chapter 1: Introduction"
  - type: HEADING
  - level: 1
  - bbox: {x: 50, y: 738, width: 200, height: 12}
  - fontSize: 16, isBold: true

- Block 2:
  - text: "This is the first paragraph of the chapter."
  - type: PARAGRAPH
  - bbox: {x: 50, y: 710, width: 500, height: 20}
  - fontSize: 12, isBold: false

---

## Summary

Text blocks are created through:
1. **Extraction**: Get individual character positions from PDF
2. **Grouping**: Combine nearby characters into logical blocks
3. **Enrichment**: Add type, font info, bounding box, segmentation
4. **Correction**: Use AI to clean and correct text
5. **Output**: Final TextBlock objects ready for EPUB generation

The process ensures accurate positioning, proper text grouping, and rich metadata for EPUB generation and audio synchronization.

