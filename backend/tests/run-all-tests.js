import { testChapterDetection } from './test-chapter-detection.js';
import { testChapterConfig } from './test-chapter-config.js';
import { testApiEndpoints } from './test-api-endpoints.js';

/**
 * Run All Chapter Segregation Tests
 * Run with: node backend/tests/run-all-tests.js
 */

async function runAllTests() {
  console.log('🚀 Running All Chapter Segregation Tests');
  console.log('========================================\n');
  
  const startTime = Date.now();
  let passedTests = 0;
  let totalTests = 3;
  
  try {
    // Test 1: Chapter Detection Service
    console.log('🔬 Running Chapter Detection Tests...\n');
    await testChapterDetection();
    passedTests++;
    console.log('✅ Chapter Detection Tests: PASSED\n');
  } catch (error) {
    console.error('❌ Chapter Detection Tests: FAILED');
    console.error(error.message);
    console.log();
  }
  
  try {
    // Test 2: Chapter Configuration Service
    console.log('🔬 Running Chapter Configuration Tests...\n');
    await testChapterConfig();
    passedTests++;
    console.log('✅ Chapter Configuration Tests: PASSED\n');
  } catch (error) {
    console.error('❌ Chapter Configuration Tests: FAILED');
    console.error(error.message);
    console.log();
  }
  
  try {
    // Test 3: API Endpoints
    console.log('🔬 Running API Endpoint Tests...\n');
    await testApiEndpoints();
    passedTests++;
    console.log('✅ API Endpoint Tests: PASSED\n');
  } catch (error) {
    console.error('❌ API Endpoint Tests: FAILED');
    console.error(error.message);
    console.log();
  }
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Summary
  console.log('📊 Test Summary');
  console.log('===============');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log(`Total Duration: ${duration}ms`);
  console.log();
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed successfully!');
    console.log('✅ Chapter segregation system is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please check the errors above.');
    console.log('💡 Common issues:');
    console.log('   - Backend server not running (for API tests)');
    console.log('   - Missing environment variables (GEMINI_API_KEY for AI tests)');
    console.log('   - Database connection issues');
    console.log('   - Missing dependencies');
  }
  
  console.log();
  console.log('📋 Next Steps:');
  console.log('1. Fix any failing tests');
  console.log('2. Test with real PDF files');
  console.log('3. Test the frontend ChapterManager component');
  console.log('4. Test the complete conversion pipeline');
  
  process.exit(passedTests === totalTests ? 0 : 1);
}

// Run all tests
runAllTests();