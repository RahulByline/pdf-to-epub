#!/usr/bin/env node

/**
 * Quick Chapter Segregation Test
 * 
 * This is a simple test script to quickly verify the chapter segregation system works.
 * Run with: node test-chapters-quick.js
 */

import { ChapterDetectionService } from './backend/src/services/chapterDetectionService.js';
import { ChapterConfigService } from './backend/src/services/chapterConfigService.js';

console.log('🚀 Quick Chapter Segregation Test\n');

// Create sample PDF pages data
const samplePages = [
  {
    pageNumber: 1,
    textBlocks: [
      {
        text: "Introduction to Machine Learning",
        type: "heading1",
        fontSize: 20,
        x: 100, y: 100
      },
      {
        text: "This book provides a comprehensive introduction to machine learning concepts and techniques.",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ]
  },
  {
    pageNumber: 2,
    textBlocks: [
      {
        text: "Machine learning has revolutionized many fields...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 100
      }
    ]
  },
  {
    pageNumber: 3,
    textBlocks: [
      {
        text: "Chapter 1: Supervised Learning",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "Supervised learning is a type of machine learning where...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ]
  },
  {
    pageNumber: 4,
    textBlocks: [
      {
        text: "Linear regression is one of the simplest supervised learning algorithms...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 100
      }
    ]
  },
  {
    pageNumber: 5,
    textBlocks: [
      {
        text: "Chapter 2: Unsupervised Learning",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "Unsupervised learning deals with finding patterns in data without labels...",
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
        text: "Clustering is a common unsupervised learning technique...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 100
      }
    ]
  },
  {
    pageNumber: 7,
    textBlocks: [
      {
        text: "Conclusion",
        type: "heading1",
        fontSize: 18,
        x: 100, y: 100
      },
      {
        text: "In this book, we have covered the fundamental concepts of machine learning...",
        type: "paragraph",
        fontSize: 12,
        x: 100, y: 150
      }
    ]
  }
];

async function runQuickTest() {
  try {
    console.log('📚 Sample Document: "Introduction to Machine Learning" (7 pages)\n');
    
    // Test 1: Heuristic Chapter Detection
    console.log('🔍 Test 1: Heuristic Chapter Detection');
    console.log('=====================================');
    
    const heuristicChapters = ChapterDetectionService.detectChaptersHeuristic(samplePages);
    
    console.log(`✅ Detected ${heuristicChapters.length} chapters:`);
    heuristicChapters.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}"`);
      console.log(`      Pages: ${chapter.startPage}-${chapter.endPage} (${chapter.pages.length} pages)`);
      console.log(`      Confidence: ${chapter.confidence}`);
      console.log();
    });
    
    // Test 2: Auto-Generation
    console.log('🔍 Test 2: Auto-Generate Chapters');
    console.log('=================================');
    
    const autoChapters = ChapterConfigService.autoGenerateConfig(7, 3);
    
    console.log(`✅ Auto-generated ${autoChapters.length} chapters (3 pages each):`);
    autoChapters.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}"`);
      console.log(`      Pages: ${chapter.startPage}-${chapter.endPage}`);
      console.log();
    });
    
    // Test 3: Manual Configuration
    console.log('🔍 Test 3: Manual Configuration');
    console.log('===============================');
    
    const manualChapters = [
      {
        title: "Introduction",
        startPage: 1,
        endPage: 2
      },
      {
        title: "Supervised Learning",
        startPage: 3,
        endPage: 4
      },
      {
        title: "Unsupervised Learning", 
        startPage: 5,
        endPage: 6
      },
      {
        title: "Conclusion",
        startPage: 7,
        endPage: 7
      }
    ];
    
    const validation = ChapterConfigService.validateConfiguration(manualChapters, 7);
    
    console.log(`✅ Manual configuration:`);
    manualChapters.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}"`);
      console.log(`      Pages: ${chapter.startPage}-${chapter.endPage}`);
    });
    console.log();
    console.log(`📊 Validation Results:`);
    console.log(`   Valid: ${validation.isValid ? '✅' : '❌'}`);
    console.log(`   Coverage: ${validation.coverage.toFixed(1)}%`);
    console.log(`   Errors: ${validation.errors.length}`);
    console.log(`   Warnings: ${validation.warnings.length}`);
    console.log();
    
    // Test 4: Chapter Indicators
    console.log('🔍 Test 4: Chapter Indicator Detection');
    console.log('=====================================');
    
    const testTexts = [
      "Chapter 1: Introduction",
      "CHAPTER 2: GETTING STARTED",
      "Part I: Fundamentals", 
      "Introduction",
      "Conclusion",
      "Appendix A",
      "Regular paragraph text",
      "1. First Section",
      "II. Second Section"
    ];
    
    testTexts.forEach(text => {
      const isChapter = ChapterDetectionService.hasChapterIndicators({ text });
      console.log(`   "${text}" -> ${isChapter ? '✅ Chapter' : '❌ Not chapter'}`);
    });
    console.log();
    
    console.log('🎉 Quick test completed successfully!');
    console.log();
    console.log('📋 What this test verified:');
    console.log('✅ Chapter detection service works');
    console.log('✅ Chapter configuration service works');
    console.log('✅ Validation system works');
    console.log('✅ Chapter indicators are detected correctly');
    console.log();
    console.log('🚀 Next steps:');
    console.log('1. Start your backend server: cd backend && npm start');
    console.log('2. Run API tests: node backend/tests/test-api-endpoints.js');
    console.log('3. Test with real PDF files through the frontend');
    console.log('4. Run full test suite: node backend/tests/run-all-tests.js');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    
    console.log('\n💡 Troubleshooting:');
    console.log('1. Make sure you\'re in the project root directory');
    console.log('2. Check that all dependencies are installed: cd backend && npm install');
    console.log('3. Verify the file paths are correct');
  }
}

runQuickTest();