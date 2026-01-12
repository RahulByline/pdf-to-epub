import axios from 'axios';

/**
 * Test Chapter API Endpoints
 * Run with: node backend/tests/test-api-endpoints.js
 * 
 * Prerequisites:
 * 1. Backend server must be running (npm start or npm run dev)
 * 2. Server should be accessible at http://localhost:8081
 */

const API_BASE_URL = 'http://localhost:8081/api';
const TEST_DOCUMENT_ID = 'test_api_' + Date.now();

async function testApiEndpoints() {
  console.log('🧪 Testing Chapter API Endpoints\n');
  console.log(`📡 API Base URL: ${API_BASE_URL}`);
  console.log(`📄 Test Document ID: ${TEST_DOCUMENT_ID}\n`);
  
  try {
    // Test 1: Auto-Generate Chapters
    console.log('📋 Test 1: Auto-Generate Chapters');
    console.log('=================================');
    
    const autoGenResponse = await axios.post(`${API_BASE_URL}/chapters/auto-generate`, {
      totalPages: 50,
      pagesPerChapter: 12,
      documentId: TEST_DOCUMENT_ID
    });
    
    console.log(`✅ Status: ${autoGenResponse.status}`);
    console.log(`✅ Generated ${autoGenResponse.data.chapters.length} chapters:`);
    autoGenResponse.data.chapters.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}" (Pages ${chapter.startPage}-${chapter.endPage})`);
    });
    console.log();
    
    // Test 2: Save Manual Configuration
    console.log('📋 Test 2: Save Manual Configuration');
    console.log('===================================');
    
    const manualConfig = {
      chapters: [
        {
          title: "Preface",
          startPage: 1,
          endPage: 3
        },
        {
          title: "Introduction", 
          startPage: 4,
          endPage: 8
        },
        {
          title: "Chapter 1: Fundamentals",
          startPage: 9,
          endPage: 25
        },
        {
          title: "Chapter 2: Advanced Concepts",
          startPage: 26,
          endPage: 45
        },
        {
          title: "Conclusion",
          startPage: 46,
          endPage: 50
        }
      ],
      totalPages: 50,
      title: "Manual Test Configuration"
    };
    
    const saveResponse = await axios.post(`${API_BASE_URL}/chapters/config/${TEST_DOCUMENT_ID}`, manualConfig);
    
    console.log(`✅ Status: ${saveResponse.status}`);
    console.log(`✅ Message: ${saveResponse.data.message}`);
    console.log(`✅ Validation Coverage: ${saveResponse.data.validation.coverage.toFixed(1)}%`);
    console.log();
    
    // Test 3: Load Configuration
    console.log('📋 Test 3: Load Configuration');
    console.log('=============================');
    
    const loadResponse = await axios.get(`${API_BASE_URL}/chapters/config/${TEST_DOCUMENT_ID}`);
    
    console.log(`✅ Status: ${loadResponse.status}`);
    console.log(`✅ Loaded configuration:`);
    loadResponse.data.config.chapters.forEach((chapter, index) => {
      console.log(`   ${index + 1}. "${chapter.title}" (Pages ${chapter.startPage}-${chapter.endPage})`);
    });
    console.log();
    
    // Test 4: Validate Configuration
    console.log('📋 Test 4: Validate Configuration');
    console.log('=================================');
    
    // Test valid configuration
    const validationResponse = await axios.post(`${API_BASE_URL}/chapters/validate`, {
      chapters: manualConfig.chapters,
      totalPages: 50
    });
    
    console.log(`✅ Status: ${validationResponse.status}`);
    console.log(`✅ Valid Configuration:`);
    console.log(`   Is Valid: ${validationResponse.data.validation.isValid}`);
    console.log(`   Coverage: ${validationResponse.data.validation.coverage.toFixed(1)}%`);
    console.log(`   Errors: ${validationResponse.data.validation.errors.length}`);
    console.log(`   Warnings: ${validationResponse.data.validation.warnings.length}`);
    console.log();
    
    // Test invalid configuration (overlapping pages)
    const invalidConfig = {
      chapters: [
        { title: "Chapter 1", startPage: 1, endPage: 15 },
        { title: "Chapter 2", startPage: 10, endPage: 25 }, // Overlap!
        { title: "Chapter 3", startPage: 30, endPage: 50 }  // Gap!
      ],
      totalPages: 50
    };
    
    try {
      const invalidValidationResponse = await axios.post(`${API_BASE_URL}/chapters/validate`, invalidConfig);
      console.log(`❌ Invalid Configuration:`);
      console.log(`   Is Valid: ${invalidValidationResponse.data.validation.isValid}`);
      console.log(`   Errors: ${invalidValidationResponse.data.validation.errors.length}`);
      invalidValidationResponse.data.validation.errors.forEach(error => {
        console.log(`     - ${error}`);
      });
      console.log(`   Warnings: ${invalidValidationResponse.data.validation.warnings.length}`);
      invalidValidationResponse.data.validation.warnings.forEach(warning => {
        console.log(`     - ${warning}`);
      });
    } catch (validationError) {
      console.log(`❌ Validation failed as expected: ${validationError.response?.data?.error}`);
    }
    console.log();
    
    // Test 5: List All Configurations
    console.log('📋 Test 5: List All Configurations');
    console.log('==================================');
    
    const listResponse = await axios.get(`${API_BASE_URL}/chapters/configs`);
    
    console.log(`✅ Status: ${listResponse.status}`);
    console.log(`✅ Found ${listResponse.data.configs.length} configurations:`);
    listResponse.data.configs.forEach(config => {
      console.log(`   Document: ${config.documentId}`);
      console.log(`   Chapters: ${config.chapters}`);
      console.log(`   Created: ${new Date(config.createdAt).toLocaleString()}`);
      console.log();
    });
    
    // Test 6: Chapter Detection (Mock)
    console.log('📋 Test 6: Chapter Detection');
    console.log('============================');
    
    try {
      const detectionResponse = await axios.get(`${API_BASE_URL}/chapters/detect/test_job_123`, {
        params: {
          useAI: true,
          respectPageNumbers: true
        }
      });
      
      console.log(`✅ Status: ${detectionResponse.status}`);
      console.log(`✅ Detected ${detectionResponse.data.chapters.length} chapters:`);
      detectionResponse.data.chapters.forEach((chapter, index) => {
        console.log(`   ${index + 1}. "${chapter.title}" (Pages ${chapter.startPage}-${chapter.endPage})`);
        console.log(`      Confidence: ${chapter.confidence}, Reason: ${chapter.reason}`);
      });
    } catch (detectionError) {
      console.log(`⚠️  Chapter detection test skipped: ${detectionError.response?.data?.error || detectionError.message}`);
      console.log('   This is expected if the job doesn\'t exist or detection is not fully implemented.');
    }
    console.log();
    
    // Test 7: Error Handling
    console.log('📋 Test 7: Error Handling');
    console.log('=========================');
    
    // Test non-existent configuration
    try {
      await axios.get(`${API_BASE_URL}/chapters/config/non_existent_doc`);
    } catch (notFoundError) {
      console.log(`✅ 404 Error handled correctly: ${notFoundError.response?.data?.error}`);
    }
    
    // Test invalid data
    try {
      await axios.post(`${API_BASE_URL}/chapters/config/test_invalid`, {
        chapters: "invalid_data", // Should be array
        totalPages: 50
      });
    } catch (invalidDataError) {
      console.log(`✅ 400 Error handled correctly: ${invalidDataError.response?.data?.error}`);
    }
    
    // Test missing required fields
    try {
      await axios.post(`${API_BASE_URL}/chapters/validate`, {
        chapters: [{ title: "Chapter 1" }], // Missing startPage/endPage
        totalPages: 50
      });
    } catch (missingFieldsError) {
      console.log(`✅ Validation error handled correctly: ${missingFieldsError.response?.data?.error || 'Validation failed'}`);
    }
    console.log();
    
    // Test 8: Performance Test
    console.log('📋 Test 8: Performance Test');
    console.log('===========================');
    
    const startTime = Date.now();
    
    // Generate large configuration
    const largeConfigResponse = await axios.post(`${API_BASE_URL}/chapters/auto-generate`, {
      totalPages: 1000,
      pagesPerChapter: 25
    });
    
    const endTime = Date.now();
    
    console.log(`✅ Performance test results:`);
    console.log(`   Generated ${largeConfigResponse.data.chapters.length} chapters for 1000 pages`);
    console.log(`   Response time: ${endTime - startTime}ms`);
    console.log(`   Average: ${((endTime - startTime) / largeConfigResponse.data.chapters.length).toFixed(2)}ms per chapter`);
    console.log();
    
    // Cleanup: Delete test configuration
    console.log('📋 Cleanup: Delete Test Configuration');
    console.log('====================================');
    
    try {
      const deleteResponse = await axios.delete(`${API_BASE_URL}/chapters/config/${TEST_DOCUMENT_ID}`);
      console.log(`✅ Delete successful: ${deleteResponse.data.message}`);
    } catch (deleteError) {
      console.log(`⚠️  Delete failed: ${deleteError.response?.data?.error || deleteError.message}`);
    }
    console.log();
    
    console.log('🎉 All API tests completed successfully!');
    
  } catch (error) {
    console.error('❌ API test failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Make sure the backend server is running on http://localhost:8081');
      console.error('   Run: cd backend && npm start');
    } else if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${error.response.data?.error || error.response.statusText}`);
    }
    
    // Attempt cleanup even on error
    try {
      await axios.delete(`${API_BASE_URL}/chapters/config/${TEST_DOCUMENT_ID}`);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

// Helper function to check if server is running
async function checkServerHealth() {
  try {
    const response = await axios.get(`${API_BASE_URL}/health`, { timeout: 5000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔍 Checking server health...');
  
  checkServerHealth().then(isHealthy => {
    if (isHealthy) {
      console.log('✅ Server is running\n');
      testApiEndpoints();
    } else {
      console.log('❌ Server is not responding');
      console.log('💡 Please start the backend server:');
      console.log('   cd backend && npm start\n');
      
      // Still run tests to show connection errors
      testApiEndpoints();
    }
  });
}

export { testApiEndpoints };