import React, { useState } from 'react';
import api, { API_BASE_URL } from '../services/api';
import { pdfService } from '../services/pdfService';
import { conversionService } from '../services/conversionService';

const ApiDebugger = () => {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  const testEndpoint = async (endpointName, testFunction) => {
    setLoading(prev => ({ ...prev, [endpointName]: true }));
    setResults(prev => ({ ...prev, [endpointName]: { status: 'testing', timestamp: new Date().toISOString() } }));

    try {
      console.log(`Testing ${endpointName}...`);
      const startTime = Date.now();
      const result = await testFunction();
      const endTime = Date.now();

      const responseData = {
        status: 'success',
        timestamp: new Date().toISOString(),
        duration: `${endTime - startTime}ms`,
        data: result,
        dataType: Array.isArray(result) ? 'array' : typeof result,
        dataLength: Array.isArray(result) ? result.length : 'N/A'
      };

      console.log(`${endpointName} success:`, responseData);
      setResults(prev => ({ ...prev, [endpointName]: responseData }));

    } catch (error) {
      console.error(`${endpointName} failed:`, error);

      const errorData = {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: {
          message: error.message,
          name: error.name,
          code: error.code,
          stack: error.stack
        },
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        } : null,
        request: error.request ? {
          url: error.request.responseURL,
          method: error.request.method,
          timeout: error.request.timeout
        } : null
      };

      setResults(prev => ({ ...prev, [endpointName]: errorData }));
    } finally {
      setLoading(prev => ({ ...prev, [endpointName]: false }));
    }
  };

  const testAllEndpoints = async () => {
    // Test basic connectivity
    await testEndpoint('health', () => api.get('/health'));

    // Test PDFs endpoints
    await testEndpoint('pdfs-getAll', () => pdfService.getAllPdfs());
    await testEndpoint('pdfs-raw', () => api.get('/pdfs'));

    // Test conversion endpoints
    await testEndpoint('conversions-completed', () => conversionService.getConversionsByStatus('COMPLETED'));
    await testEndpoint('conversions-in-progress', () => conversionService.getConversionsByStatus('IN_PROGRESS'));
    await testEndpoint('conversions-failed', () => conversionService.getConversionsByStatus('FAILED'));
  };

  const renderResult = (endpointName) => {
    const result = results[endpointName];
    const isLoading = loading[endpointName];

    if (!result && !isLoading) return null;

    return (
      <div key={endpointName} style={{
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
        backgroundColor: isLoading ? '#f9f9f9' : result?.status === 'success' ? '#f0f8f0' : '#fff0f0'
      }}>
        <h3 style={{ margin: '0 0 8px 0', color: isLoading ? '#666' : result?.status === 'success' ? '#2d7d2d' : '#d32f2f' }}>
          {endpointName}
          {isLoading && <span style={{ marginLeft: '8px', fontSize: '14px' }}>⏳</span>}
          {result?.status === 'success' && <span style={{ marginLeft: '8px', fontSize: '14px' }}>✅</span>}
          {result?.status === 'error' && <span style={{ marginLeft: '8px', fontSize: '14px' }}>❌</span>}
        </h3>

        {result && (
          <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>
            <div><strong>Status:</strong> {result.status}</div>
            <div><strong>Timestamp:</strong> {result.timestamp}</div>
            {result.duration && <div><strong>Duration:</strong> {result.duration}</div>}
            {result.dataType && <div><strong>Data Type:</strong> {result.dataType}</div>}
            {result.dataLength && <div><strong>Data Length:</strong> {result.dataLength}</div>}

            {result.error && (
              <div style={{ marginTop: '8px' }}>
                <strong>Error Details:</strong>
                <pre style={{
                  backgroundColor: '#f5f5f5',
                  padding: '8px',
                  borderRadius: '4px',
                  overflow: 'auto',
                  maxHeight: '200px',
                  fontSize: '11px'
                }}>
                  {JSON.stringify(result.error, null, 2)}
                </pre>
              </div>
            )}

            {result.response && (
              <div style={{ marginTop: '8px' }}>
                <strong>Response Details:</strong>
                <pre style={{
                  backgroundColor: '#f5f5f5',
                  padding: '8px',
                  borderRadius: '4px',
                  overflow: 'auto',
                  maxHeight: '200px',
                  fontSize: '11px'
                }}>
                  {JSON.stringify(result.response, null, 2)}
                </pre>
              </div>
            )}

            {result.request && (
              <div style={{ marginTop: '8px' }}>
                <strong>Request Details:</strong>
                <pre style={{
                  backgroundColor: '#f5f5f5',
                  padding: '8px',
                  borderRadius: '4px',
                  overflow: 'auto',
                  maxHeight: '100px',
                  fontSize: '11px'
                }}>
                  {JSON.stringify(result.request, null, 2)}
                </pre>
              </div>
            )}

            {result.data && (
              <div style={{ marginTop: '8px' }}>
                <strong>Response Data:</strong>
                <pre style={{
                  backgroundColor: '#f5f5f5',
                  padding: '8px',
                  borderRadius: '4px',
                  overflow: 'auto',
                  maxHeight: '200px',
                  fontSize: '11px'
                }}>
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>API Debugger - PDF Endpoints</h1>
      <p>This tool helps debug API connectivity issues, especially for the /pdfs endpoint causing the dashboard error.</p>

      <div style={{
        backgroundColor: '#e3f2fd',
        padding: '16px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #2196f3'
      }}>
        <h3 style={{ margin: '0 0 8px 0', color: '#0d47a1' }}>Current Configuration</h3>
        <div style={{ fontSize: '14px' }}>
          <div><strong>API Base URL:</strong> {API_BASE_URL}</div>
          <div><strong>Environment:</strong> {import.meta.env.DEV ? 'Development' : 'Production'}</div>
          <div><strong>Domain:</strong> {window.location.hostname}</div>
          <div><strong>Protocol:</strong> {window.location.protocol}</div>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={testAllEndpoints}
          style={{
            padding: '12px 24px',
            backgroundColor: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
            marginRight: '12px'
          }}
          disabled={Object.values(loading).some(Boolean)}
        >
          {Object.values(loading).some(Boolean) ? 'Testing...' : 'Test All Endpoints'}
        </button>

        <button
          onClick={() => testEndpoint('pdfs-getAll', () => pdfService.getAllPdfs())}
          style={{
            padding: '12px 24px',
            backgroundColor: '#4caf50',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
            marginRight: '12px'
          }}
          disabled={loading['pdfs-getAll']}
        >
          {loading['pdfs-getAll'] ? 'Testing...' : 'Test PDFs Only'}
        </button>

        <button
          onClick={() => setResults({})}
          style={{
            padding: '12px 24px',
            backgroundColor: '#757575',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          Clear Results
        </button>
      </div>

      <div>
        <h2>Test Results</h2>
        {Object.keys(results).length === 0 && !Object.values(loading).some(Boolean) && (
          <p style={{ color: '#666', fontStyle: 'italic' }}>
            Click "Test All Endpoints" to begin debugging
          </p>
        )}

        {renderResult('health')}
        {renderResult('pdfs-getAll')}
        {renderResult('pdfs-raw')}
        {renderResult('conversions-completed')}
        {renderResult('conversions-in-progress')}
        {renderResult('conversions-failed')}
      </div>

      <div style={{
        marginTop: '40px',
        padding: '16px',
        backgroundColor: '#fff3cd',
        border: '1px solid #ffeaa7',
        borderRadius: '8px'
      }}>
        <h3 style={{ margin: '0 0 8px 0', color: '#856404' }}>Debugging Tips</h3>
        <ul style={{ margin: 0, paddingLeft: '20px', color: '#856404' }}>
          <li>Check the browser Network tab for actual HTTP requests</li>
          <li>Look for CORS errors in the Console tab</li>
          <li>Verify the API server is running and accessible</li>
          <li>Check if the API endpoints return the expected data structure</li>
          <li>Look for authentication issues (missing tokens)</li>
        </ul>
      </div>
    </div>
  );
};

export default ApiDebugger;