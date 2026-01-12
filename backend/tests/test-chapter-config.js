import { ChapterConfigService } from '../src/services/chapterConfigService.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Test Chapter Configuration Service
 * Run with: node backend/tests/test-chapter-config.js
 */

async function testChapterConfig() {
  console.log('🧪 Testing Chapter Configuration Service\n');
  
  const testDocumentId = 'test_doc_' + Date.now();
  
  try {
    // Test 1: Auto-Generation
    console.log('📋 Test 1: Auto-Generate Chapters');
    console.log('=================================');
    
    const autoConfig = ChapterConfigService.autoGenerateConfig(50, 10);
    console.log(`✅ Generated ${autoConfig.length} chapters for 50 pages (10 pages each):`);
    autoConfig.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}" (Pages ${chapter.startPage}-${chapter.endPage})`);
    });
    console.log();
    
    // Test 2: Save and Load Configuration
    console.log('📋 Test 2: Save and Load Configuration');
    console.log('=====================================');
    
    const testConfig = [
      {
        title: "Introduction",
        startPage: 1,
        endPage: 5
      },
      {
        title: "Chapter 1: Getting Started",
        startPage: 6,
        endPage: 20
      },
      {
        title: "Chapter 2: Advanced Topics",
        startPage: 21,
        endPage: 35
      },
      {
        title: "Conclusion",
        startPage: 36,
        endPage: 40
      }
    ];
    
    // Save configuration
    await ChapterConfigService.saveChapterConfig(testDocumentId, testConfig);
    console.log(`✅ Saved configuration for document: ${testDocumentId}`);
    
    // Load configuration
    const loadedConfig = await ChapterConfigService.loadChapterConfig(testDocumentId);
    console.log(`✅ Loaded configuration:`);
    loadedConfig.chapters.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}" (Pages ${chapter.startPage}-${chapter.endPage})`);
    });
    console.log();
    
    // Test 3: Validation
    console.log('📋 Test 3: Configuration Validation');
    console.log('===================================');
    
    // Valid configuration
    const validConfig = [
      { title: "Chapter 1", startPage: 1, endPage: 10 },
      { title: "Chapter 2", startPage: 11, endPage: 20 },
      { title: "Chapter 3", startPage: 21, endPage: 30 }
    ];
    
    const validValidation = ChapterConfigService.validateConfiguration(validConfig, 30);
    console.log(`✅ Valid configuration validation:`);
    console.log(`   Is Valid: ${validValidation.isValid}`);
    console.log(`   Coverage: ${validValidation.coverage.toFixed(1)}%`);
    console.log(`   Errors: ${validValidation.errors.length}`);
    console.log(`   Warnings: ${validValidation.warnings.length}`);
    console.log();
    
    // Invalid configuration (overlapping pages)
    const invalidConfig = [
      { title: "Chapter 1", startPage: 1, endPage: 15 },
      { title: "Chapter 2", startPage: 10, endPage: 25 }, // Overlap!
      { title: "Chapter 3", startPage: 26, endPage: 30 }
    ];
    
    const invalidValidation = ChapterConfigService.validateConfiguration(invalidConfig, 30);
    console.log(`❌ Invalid configuration validation:`);
    console.log(`   Is Valid: ${invalidValidation.isValid}`);
    console.log(`   Coverage: ${invalidValidation.coverage.toFixed(1)}%`);
    console.log(`   Errors: ${invalidValidation.errors.length}`);
    invalidValidation.errors.forEach(error => {
      console.log(`     - ${error}`);
    });
    console.log();
    
    // Test 4: Different Configuration Formats
    console.log('📋 Test 4: Configuration Formats');
    console.log('================================');
    
    // Page ranges format
    const pageRangeConfig = ChapterConfigService.createConfigFromPageRanges([
      { title: "Introduction", pageRange: "1-5" },
      { title: "Main Content", pageRange: "6-25" },
      { title: "Appendix", pageRange: "26-30" }
    ]);
    
    console.log(`✅ Page range format:`);
    pageRangeConfig.forEach(chapter => {
      console.log(`   "${chapter.title}" -> ${chapter.pageRange}`);
    });
    console.log();
    
    // Page numbers format
    const pageNumberConfig = ChapterConfigService.createConfigFromPageNumbers([
      { title: "Preface", pages: [1, 2, 3] },
      { title: "Chapter 1", pages: [4, 5, 6, 7, 8, 9, 10] },
      { title: "Chapter 2", pages: [11, 12, 13, 14, 15] }
    ]);
    
    console.log(`✅ Page numbers format:`);
    pageNumberConfig.forEach(chapter => {
      console.log(`   "${chapter.title}" -> Pages: ${chapter.pages.join(', ')}`);
    });
    console.log();
    
    // Test 5: Apply Manual Configuration
    console.log('📋 Test 5: Apply Manual Configuration');
    console.log('====================================');
    
    // Create mock pages
    const mockPages = Array.from({ length: 40 }, (_, i) => ({
      pageNumber: i + 1,
      textBlocks: [
        {
          text: `Page ${i + 1} content`,
          type: "paragraph",
          fontSize: 12
        }
      ]
    }));
    
    const appliedChapters = await ChapterConfigService.applyManualConfiguration(mockPages, testDocumentId);
    
    if (appliedChapters) {
      console.log(`✅ Applied manual configuration:`);
      appliedChapters.forEach((chapter, index) => {
        console.log(`   ${index + 1}. "${chapter.title}" (${chapter.pages.length} pages)`);
        console.log(`      Pages: ${chapter.startPage}-${chapter.endPage}`);
        console.log(`      Confidence: ${chapter.confidence}`);
      });
    } else {
      console.log(`❌ No manual configuration found for ${testDocumentId}`);
    }
    console.log();
    
    // Test 6: List All Configurations
    console.log('📋 Test 6: List All Configurations');
    console.log('==================================');
    
    const allConfigs = await ChapterConfigService.getAllConfigurations();
    console.log(`✅ Found ${allConfigs.length} saved configurations:`);
    allConfigs.forEach(config => {
      console.log(`   Document: ${config.documentId}`);
      console.log(`   Chapters: ${config.chapters}`);
      console.log(`   Created: ${config.createdAt}`);
      console.log();
    });
    
    // Test 7: Performance Test
    console.log('📋 Test 7: Performance Test');
    console.log('===========================');
    
    const startTime = Date.now();
    
    // Generate large configuration
    const largeConfig = ChapterConfigService.autoGenerateConfig(1000, 25);
    
    // Validate large configuration
    const largeValidation = ChapterConfigService.validateConfiguration(largeConfig, 1000);
    
    const endTime = Date.now();
    
    console.log(`✅ Performance test results:`);
    console.log(`   Generated ${largeConfig.length} chapters for 1000 pages`);
    console.log(`   Validation time: ${endTime - startTime}ms`);
    console.log(`   Is valid: ${largeValidation.isValid}`);
    console.log(`   Coverage: ${largeValidation.coverage.toFixed(1)}%`);
    console.log();
    
    // Cleanup: Delete test configuration
    console.log('📋 Cleanup: Delete Test Configuration');
    console.log('====================================');
    
    const deleteSuccess = await ChapterConfigService.deleteConfiguration(testDocumentId);
    console.log(`${deleteSuccess ? '✅' : '❌'} Delete test configuration: ${deleteSuccess ? 'Success' : 'Failed'}`);
    console.log();
    
    console.log('🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    
    // Cleanup on error
    try {
      await ChapterConfigService.deleteConfiguration(testDocumentId);
    } catch (cleanupError) {
      console.error('Failed to cleanup test configuration:', cleanupError.message);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testChapterConfig();
}

export { testChapterConfig };