# Testing Chapter Segregation System

This guide provides step-by-step instructions for testing the chapter segregation functionality.

## Quick Start (Recommended)

### 1. Quick Test (No Server Required)
```bash
# Run the quick test to verify basic functionality
node test-chapters-quick.js
```

This will test:
- ✅ Chapter detection algorithms
- ✅ Configuration validation
- ✅ Auto-generation
- ✅ Chapter indicator recognition

### 2. Start Backend Server
```bash
cd backend
npm install  # Install dependencies if not done
npm start    # or npm run dev for development mode
```

### 3. Test API Endpoints
```bash
# Test the REST API endpoints
node backend/tests/test-api-endpoints.js
```

### 4. Run Full Test Suite
```bash
# Run all tests together
node backend/tests/run-all-tests.js
```

## Detailed Testing Instructions

### Prerequisites

1. **Backend Setup**
   ```bash
   cd backend
   npm install
   ```

2. **Environment Variables**
   Add to your `.env` file:
   ```bash
   # AI Configuration (for chapter detection)
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_API_ENABLED=true
   GEMINI_API_MODEL=gemini-2.5-flash

   # Chapter Detection Settings
   USE_AI_CHAPTER_DETECTION=true
   DEFAULT_PAGES_PER_CHAPTER=10
   MAX_CHAPTERS_PER_DOCUMENT=50
   MIN_PAGES_PER_CHAPTER=1
   ```

3. **Database Setup**
   Ensure your MySQL database is running and configured.

## Test Methods

### Method 1: Unit Testing

#### Test Chapter Detection Service
```bash
node backend/tests/test-chapter-detection.js
```

**What it tests:**
- Heuristic chapter detection
- AI-powered detection (if API key available)
- Chapter indicator recognition
- Major heading detection
- Performance with large documents

#### Test Chapter Config Service
```bash
node backend/tests/test-chapter-config.js
```

**What it tests:**
- Auto-generation of chapters
- Save/load configurations
- Validation system
- Different configuration formats
- Manual configuration application

### Method 2: API Testing

#### Start the Backend Server
```bash
cd backend
npm start
# Server will run on http://localhost:8081
```

#### Test API Endpoints
```bash
node backend/tests/test-api-endpoints.js
```

**What it tests:**
- Auto-generate chapters endpoint
- Save/load configuration endpoints
- Validation endpoint
- Error handling
- Performance

#### Manual API Testing
Use curl, Postman, or any HTTP client:

```bash
# 1. Test chapter detection
curl -X GET "http://localhost:8081/api/chapters/detect/test_job_123?useAI=true"

# 2. Test auto-generation
curl -X POST "http://localhost:8081/api/chapters/auto-generate" \
  -H "Content-Type: application/json" \
  -d '{"totalPages": 50, "pagesPerChapter": 10}'

# 3. Test manual configuration
curl -X POST "http://localhost:8081/api/chapters/config/test_doc_123" \
  -H "Content-Type: application/json" \
  -d '{
    "chapters": [
      {"title": "Introduction", "startPage": 1, "endPage": 5},
      {"title": "Chapter 1", "startPage": 6, "endPage": 20}
    ],
    "totalPages": 50
  }'

# 4. Test configuration retrieval
curl -X GET "http://localhost:8081/api/chapters/config/test_doc_123"
```

### Method 3: Integration Testing

Test the complete conversion pipeline with chapter detection:

#### Upload a PDF and Test Conversion
1. Upload a PDF through the frontend
2. Start conversion with chapter detection enabled
3. Check the generated EPUB structure

### Method 4: Frontend Testing

#### Test the ChapterManager Component
1. Start the frontend development server
2. Navigate to a conversion job page
3. Test the ChapterManager component functionality

## Expected Test Results

### Quick Test Output
```
🚀 Quick Chapter Segregation Test

📚 Sample Document: "Introduction to Machine Learning" (7 pages)

🔍 Test 1: Heuristic Chapter Detection
=====================================
✅ Detected 4 chapters:
   1. "Introduction to Machine Learning"
      Pages: 1-2 (2 pages)
      Confidence: 0.8

   2. "Chapter 1: Supervised Learning"
      Pages: 3-4 (2 pages)
      Confidence: 0.8

   3. "Chapter 2: Unsupervised Learning"
      Pages: 5-6 (2 pages)
      Confidence: 0.8

   4. "Conclusion"
      Pages: 7-7 (1 pages)
      Confidence: 0.8

🎉 Quick test completed successfully!
```

### API Test Output
```
🧪 Testing Chapter API Endpoints

📋 Test 1: Auto-Generate Chapters
=================================
✅ Status: 200
✅ Generated 5 chapters:
   1. "Chapter 1" (Pages 1-12)
   2. "Chapter 2" (Pages 13-24)
   3. "Chapter 3" (Pages 25-36)
   4. "Chapter 4" (Pages 37-48)
   5. "Chapter 5" (Pages 49-50)

🎉 All API tests completed successfully!
```

## Detailed Test Scenarios

### Scenario 1: AI Chapter Detection

**Test Case**: PDF with clear chapter headings
```javascript
// Mock data for testing
const testPages = [
  {
    pageNumber: 1,
    textBlocks: [
      {
        text: "Introduction",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "This is the introduction content...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ]
  },
  {
    pageNumber: 6,
    textBlocks: [
      {
        text: "Chapter 1: Getting Started",
        type: "heading1", 
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "This chapter covers the basics...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ]
  }
];
```

**Expected Result**: 
- 2 chapters detected
- Chapter 1: "Introduction" (pages 1-5)
- Chapter 2: "Chapter 1: Getting Started" (pages 6-end)

### Scenario 2: Manual Configuration

**Test Case**: Override AI detection with manual settings
```javascript
const manualConfig = [
  {
    title: "Preface",
    startPage: 1,
    endPage: 3
  },
  {
    title: "Part I: Fundamentals", 
    startPage: 4,
    endPage: 20
  },
  {
    title: "Part II: Advanced Topics",
    startPage: 21,
    endPage: 40
  }
];
```

**Expected Result**:
- Manual configuration takes precedence
- 3 chapters as specified
- All pages covered without overlaps

### Scenario 3: Auto-Generation

**Test Case**: Generate chapters for a 100-page document
```javascript
const config = {
  totalPages: 100,
  pagesPerChapter: 15
};
```

**Expected Result**:
- 7 chapters (6 full chapters + 1 partial)
- Chapter 1: pages 1-15
- Chapter 2: pages 16-30
- ...
- Chapter 7: pages 91-100

### Scenario 4: Validation Testing

**Test Case**: Invalid chapter configuration
```javascript
const invalidConfig = [
  {
    title: "Chapter 1",
    startPage: 1,
    endPage: 10
  },
  {
    title: "Chapter 2", 
    startPage: 8, // Overlap with Chapter 1
    endPage: 20
  }
];
```

**Expected Result**:
- Validation fails
- Error message about page overlap
- Suggests corrections

## Test Files

### Create Test Files

#### 1. Unit Test for Chapter Detection