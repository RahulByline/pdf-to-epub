import { ChapterDetectionService } from '../src/services/chapterDetectionService.js';
import { AiConfigService } from '../src/services/aiConfigService.js';

/**
 * Test Chapter Detection Service
 * Run with: node backend/tests/test-chapter-detection.js
 */

// Mock pages data for testing
const createMockPages = () => [
  {
    pageNumber: 1,
    textBlocks: [
      {
        text: "Table of Contents",
        type: "heading1",
        fontSize: 16,
        x: 100, y: 100,
        width: 200, height: 20
      },
      {
        text: "1. Introduction ........................ 3",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 2,
    textBlocks: [
      {
        text: "Preface",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "This book provides a comprehensive guide...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 3,
    textBlocks: [
      {
        text: "Introduction",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "Welcome to this comprehensive guide. In this introduction, we will cover the basic concepts...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 4,
    textBlocks: [
      {
        text: "More introduction content continues here...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 100
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 5,
    textBlocks: [
      {
        text: "Chapter 1: Getting Started",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "In this chapter, we will learn the fundamentals...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 6,
    textBlocks: [
      {
        text: "Continuing with the basics of getting started...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 100
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 7,
    textBlocks: [
      {
        text: "Chapter 2: Advanced Topics",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "Now we move on to more advanced concepts...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 8,
    textBlocks: [
      {
        text: "Advanced topics continued...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 100
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 9,
    textBlocks: [
      {
        text: "Conclusion",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "In conclusion, we have covered...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ],
    width: 612,
    height: 792
  },
  {
    pageNumber: 10,
    textBlocks: [
      {
        text: "Final thoughts and summary...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 100
      }
    ],
    width: 612,
    height: 792
  }
];

async function testChapterDetection() {
  console.log('🧪 Testing Chapter Detection Service\n');
  
  const mockPages = createMockPages();
  
  try {
    // Test 1: Heuristic Detection (fallback method)
    console.log('📋 Test 1: Heuristic Chapter Detection');
    console.log('=====================================');
    
    const heuristicChapters = ChapterDetectionService.detectChaptersHeuristic(mockPages, {
      respectPageNumbers: true
    });
    
    console.log(`✅ Detected ${heuristicChapters.length} chapters using heuristic method:`);
    heuristicChapters.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}" (Pages ${chapter.startPage}-${chapter.endPage}) - Confidence: ${chapter.confidence}`);
    });
    console.log();
    
    // Test 2: AI Detection (if API key is available)
    console.log('📋 Test 2: AI Chapter Detection');
    console.log('===============================');
    
    try {
      const aiChapters = await ChapterDetectionService.detectChapters(mockPages, {
        useAI: true,
        respectPageNumbers: true
      });
      
      console.log(`✅ Detected ${aiChapters.length} chapters using AI method:`);
      aiChapters.forEach((chapter, index) => {
        console.log(`   ${index + 1}. "${chapter.title}" (Pages ${chapter.startPage}-${chapter.endPage}) - Confidence: ${chapter.confidence}`);
        console.log(`      Reason: ${chapter.reason}`);
      });
    } catch (aiError) {
      console.log(`⚠️  AI detection failed: ${aiError.message}`);
      console.log('   This is expected if no AI API key is configured.');
    }
    console.log();
    
    // Test 3: Chapter Indicator Detection
    console.log('📋 Test 3: Chapter Indicator Detection');
    console.log('=====================================');
    
    const testTexts = [
      "Chapter 1: Introduction",
      "CHAPTER 2: GETTING STARTED", 
      "Part I: Fundamentals",
      "Section 3.1: Overview",
      "Introduction",
      "Conclusion",
      "Appendix A",
      "Bibliography",
      "1. First Chapter",
      "II. Second Chapter",
      "Regular paragraph text"
    ];
    
    testTexts.forEach(text => {
      const hasIndicator = ChapterDetectionService.hasChapterIndicators({ text });
      console.log(`   "${text}" -> ${hasIndicator ? '✅ Chapter indicator' : '❌ Not a chapter'}`);
    });
    console.log();
    
    // Test 4: Major Heading Detection
    console.log('📋 Test 4: Major Heading Detection');
    console.log('==================================');
    
    const testBlocks = [
      { text: "Large Heading", fontSize: 24, type: "heading1" },
      { text: "Medium Heading", fontSize: 16, type: "heading2" },
      { text: "Small Text", fontSize: 12, type: "paragraph" },
      { text: "Title at Top", fontSize: 14, y: 50, type: "paragraph" }
    ];
    
    const mockPage = { height: 792, textBlocks: testBlocks };
    
    testBlocks.forEach(block => {
      const isMajor = ChapterDetectionService.isMajorHeading(block, mockPage);
      console.log(`   "${block.text}" (${block.fontSize}px, ${block.type}) -> ${isMajor ? '✅ Major heading' : '❌ Not major'}`);
    });
    console.log();
    
    // Test 5: Performance Test
    console.log('📋 Test 5: Performance Test');
    console.log('===========================');
    
    const startTime = Date.now();
    const largeMockPages = Array.from({ length: 100 }, (_, i) => ({
      pageNumber: i + 1,
      textBlocks: [
        {
          text: i % 10 === 0 ? `Chapter ${Math.floor(i/10) + 1}` : `Page ${i + 1} content`,
          type: i % 10 === 0 ? "heading1" : "paragraph",
          fontSize: i % 10 === 0 ? 18 : 12,
          x: 100, y: 100
        }
      ],
      width: 612,
      height: 792
    }));
    
    const performanceChapters = ChapterDetectionService.detectChaptersHeuristic(largeMockPages);
    const endTime = Date.now();
    
    console.log(`✅ Processed ${largeMockPages.length} pages in ${endTime - startTime}ms`);
    console.log(`   Detected ${performanceChapters.length} chapters`);
    console.log(`   Average: ${((endTime - startTime) / largeMockPages.length).toFixed(2)}ms per page`);
    console.log();
    
    console.log('🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testChapterDetection();
}

export { testChapterDetection };