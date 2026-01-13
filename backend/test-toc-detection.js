// Test script for Table of Contents detection
// Run with: node test-toc-detection.js

import { TextBasedConversionPipeline } from './src/services/textBasedConversionPipeline.js';

// Test data - simulate pages with TOC and regular content
const testPages = [
  {
    pageNumber: 1,
    text: `Table of Contents

Chapter 1. Introduction...........3
Chapter 2. Background Information.7
Chapter 3. Methodology...........15
Chapter 4. Results...............25
Chapter 5. Conclusion...........35

Appendix A........................45`
  },
  {
    pageNumber: 2,
    text: `Contents

1. Introduction.....................1
2. Literature Review...............5
3. Research Methodology...........12
4. Data Analysis..................20
5. Findings.......................28
6. Discussion.....................35
7. Conclusion.....................42

References........................50`
  },
  {
    pageNumber: 3,
    text: `This is a regular content page with normal text.
It contains paragraphs and regular content that should not be detected as a table of contents.
This page has multiple sentences and regular text flow.`
  },
  {
    pageNumber: 4,
    text: `1. First item in a numbered list
2. Second item in a numbered list
3. Third item in a numbered list
4. Fourth item in a numbered list
5. Fifth item in a numbered list

This page has many numbered items and might be detected as TOC.`
  },
  {
    pageNumber: 5,
    text: `Chapter 1: Getting Started

This chapter introduces the basic concepts and provides an overview of the system.
We will cover the fundamental principles and establish the groundwork for understanding the advanced topics.`
  }
];

console.log('🧪 Testing Table of Contents Detection\n');
console.log('='.repeat(50));

try {
  const tocPages = TextBasedConversionPipeline.detectTableOfContentsPages(testPages);

  console.log(`✅ Detection completed!`);
  console.log(`📊 Found ${tocPages.length} TOC page(s): ${tocPages.length > 0 ? tocPages.join(', ') : 'None'}`);

  console.log('\n📋 Analysis of each page:');
  console.log('-'.repeat(30));

  testPages.forEach(page => {
    const isToc = tocPages.includes(page.pageNumber);
    const status = isToc ? '📖 TOC' : '📄 Content';
    const preview = page.text.substring(0, 100).replace(/\n/g, ' ') + '...';

    console.log(`Page ${page.pageNumber}: ${status}`);
    console.log(`  Preview: ${preview}`);
    console.log();
  });

  console.log('🎉 Test completed successfully!');
  console.log('\n💡 Expected results: Pages 1, 2, and 4 should be detected as TOC pages.');

} catch (error) {
  console.error('❌ Test failed:', error.message);
  console.error(error.stack);
}