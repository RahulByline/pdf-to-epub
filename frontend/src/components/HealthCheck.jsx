import React, { useState, useEffect } from 'react';
import api, { API_BASE_URL } from '../services/api';

const HealthCheck = ({ showDetails = false }) => {
  const [backendStatus, setBackendStatus] = useState('checking');
  const [databaseStatus, setDatabaseStatus] = useState('checking');
  const [apiUrl, setApiUrl] = useState('');

  useEffect(() => {
    setApiUrl(API_BASE_URL);
    checkHealth();
  }, []);

  const checkHealth = async () => {
    try {
      // Check backend health
      console.log('Checking backend health...');
      const response = await api.get('/health');
      console.log('Health check response:', response.data);

      if (response.data.status === 'OK') {
        setBackendStatus('healthy');
        setDatabaseStatus('healthy');
      } else if (response.data.status === 'SERVICE_UNAVAILABLE') {
        setBackendStatus('healthy'); // API is responding but DB might be down
        setDatabaseStatus('unhealthy');
      } else {
        setBackendStatus('unhealthy');
        setDatabaseStatus('unhealthy');
      }
    } catch (error) {
      console.error('Health check failed:', error);
      console.error('API Base URL being used:', window.location.href.includes('localhost') ? 'Development (localhost)' : 'Production');

      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      } else if (error.request) {
        console.error('No response received - network error');
      }

      setBackendStatus('unhealthy');
      setDatabaseStatus('unhealthy');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return '#4caf50';
      case 'unhealthy': return '#f44336';
      case 'checking': return '#ff9800';
      default: return '#9e9e9e';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'healthy': return 'Healthy';
      case 'unhealthy': return 'Unhealthy';
      case 'checking': return 'Checking...';
      default: return 'Unknown';
    }
  };

  if (!showDetails) {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 8px',
        borderRadius: '4px',
        backgroundColor: backendStatus === 'healthy' ? '#e8f5e9' : '#ffebee',
        border: `1px solid ${backendStatus === 'healthy' ? '#4caf50' : '#f44336'}`
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: getStatusColor(backendStatus)
        }} />
        <span style={{
          fontSize: '12px',
          fontWeight: '500',
          color: backendStatus === 'healthy' ? '#2e7d32' : '#c62828'
        }}>
          Backend: {getStatusText(backendStatus)}
        </span>
      </div>
    );
  }

  return (
    <div style={{
      padding: '16px',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      backgroundColor: '#fafafa'
    }}>
      <h4 style={{ margin: '0 0 8px 0', color: '#424242' }}>System Health</h4>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
        API: {apiUrl}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(backendStatus)
          }} />
          <span style={{ fontSize: '14px' }}>
            Backend API: {getStatusText(backendStatus)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(databaseStatus)
          }} />
          <span style={{ fontSize: '14px' }}>
            Database: {getStatusText(databaseStatus)}
          </span>
        </div>
      </div>

      <button
        onClick={checkHealth}
        style={{
          marginTop: '12px',
          padding: '6px 12px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: '#fff',
          cursor: 'pointer',
          fontSize: '12px'
        }}
      >
        Refresh Status
      </button>
    </div>
  );
};

export default HealthCheck;