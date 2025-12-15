import React, { useEffect, useState } from 'react';
import { aiConfigService } from '../services/aiConfigService';

const AiConfig = () => {
  const [config, setConfig] = useState({
    id: null,
    apiKey: '',
    modelName: 'gemini-pro',
    isActive: false,
    description: '',
    updatedAt: null
  });
  const [originalApiKey, setOriginalApiKey] = useState(''); // Track if API key was masked
  const [availableModels, setAvailableModels] = useState([]);
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testDetails, setTestDetails] = useState(null);

  // Helper function to detect if API key is masked
  const isMaskedApiKey = (key) => {
    return key && (key.includes('****') || key.length < 20);
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const [currentConfig, models, aiStatus] = await Promise.all([
        aiConfigService.getCurrentConfig(),
        aiConfigService.getAvailableModels(),
        aiConfigService.getStatus()
      ]);

      if (currentConfig) {
        // Check if API key is masked
        const apiKeyIsMasked = isMaskedApiKey(currentConfig.apiKey);
        setConfig({
          id: currentConfig.id || null,
          apiKey: apiKeyIsMasked ? '' : currentConfig.apiKey, // Clear masked keys
          modelName: currentConfig.modelName || 'gemini-pro',
          isActive: currentConfig.isActive !== undefined ? currentConfig.isActive : true,
          description: currentConfig.description || '',
          updatedAt: currentConfig.updatedAt || null
        });
        // Store original masked key to detect if user changed it
        setOriginalApiKey(apiKeyIsMasked ? currentConfig.apiKey : '');
      }
      setAvailableModels(models);
      setStatus(aiStatus);
    } catch (err) {
      console.error('Error loading config:', err);
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    setTestDetails(null);

    try {
      // Prepare config to send - only include API key if it's new (not masked and different)
      const configToSave = {
        id: config.id,
        modelName: config.modelName,
        isActive: config.isActive,
        description: config.description
      };

      // Only include API key if:
      // 1. It's provided and not empty
      // 2. It's not masked (doesn't contain ****)
      // 3. It's different from the original masked key
      if (config.apiKey && config.apiKey.trim().length > 0 && !isMaskedApiKey(config.apiKey)) {
        if (config.apiKey !== originalApiKey) {
          configToSave.apiKey = config.apiKey.trim();
        }
      }

      const savedConfig = await aiConfigService.saveConfig(configToSave);
      setSuccess('Configuration saved successfully! All settings have been stored.');
      
      // Reload config to show updated values (API key will be masked)
      await loadConfig();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setError('');
    setSuccess('');
    setTestDetails(null);
    
    // Check if API key is provided
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      if (!originalApiKey) {
        setError('Please enter an API key to test the connection');
        return;
      }
      // If there's an original masked key, we can't test without a new key
      setError('Please enter a new API key to test the connection');
      return;
    }

    // Check if API key is masked
    if (isMaskedApiKey(config.apiKey)) {
      setError('Please enter a valid API key (not masked) to test the connection');
      return;
    }

    try {
      const result = await aiConfigService.testConnection(config.apiKey, config.modelName);
      setSuccess(result.summary || 'Connection test successful!');
      if (result.details) {
        setTestDetails(result.details);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Connection test failed');
      setTestDetails(null);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="container">
      <h1>AI Configuration</h1>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      
      {testDetails && (
        <div className="card" style={{ marginTop: '20px', backgroundColor: '#f0f9ff', border: '1px solid #0ea5e9' }}>
          <h3 style={{ marginTop: '0', color: '#0369a1' }}>Test Configuration Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
            <div>
              <strong style={{ color: '#64748b' }}>Status:</strong>
              <div style={{ color: '#059669', fontWeight: 'bold', marginTop: '5px' }}>
                ✓ {testDetails.status === 'connected' ? 'Connected' : testDetails.status}
              </div>
            </div>
            <div>
              <strong style={{ color: '#64748b' }}>Model:</strong>
              <div style={{ marginTop: '5px' }}>{testDetails.model}</div>
            </div>
            <div>
              <strong style={{ color: '#64748b' }}>API Key:</strong>
              <div style={{ marginTop: '5px', fontFamily: 'monospace' }}>{testDetails.apiKey}</div>
            </div>
            <div>
              <strong style={{ color: '#64748b' }}>Response Time:</strong>
              <div style={{ marginTop: '5px', color: '#059669' }}>{testDetails.responseTime}</div>
            </div>
            <div>
              <strong style={{ color: '#64748b' }}>Response Received:</strong>
              <div style={{ marginTop: '5px', color: '#059669' }}>✓ {testDetails.responseReceived}</div>
            </div>
            <div>
              <strong style={{ color: '#64748b' }}>Tested At:</strong>
              <div style={{ marginTop: '5px', fontSize: '0.9em' }}>
                {new Date(testDetails.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #dee2e6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
            <div>
              <strong>Status: </strong>
              <span className={status.enabled ? 'badge badge-success' : 'badge badge-danger'}>
                {status.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {status.model && (
              <div>
                <strong>Model: </strong>
                <span style={{ color: '#495057', fontWeight: '500' }}>{status.model}</span>
              </div>
            )}
            {config.id && (
              <div style={{ marginLeft: 'auto', fontSize: '0.9em', color: '#6c757d' }}>
                ✓ Configuration Saved
                {config.updatedAt && (
                  <div style={{ fontSize: '0.85em', marginTop: '4px', color: '#868e96' }}>
                    Last updated: {new Date(config.updatedAt).toLocaleString()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>API Key {originalApiKey ? '(leave blank to keep current)' : '*'}</label>
            {originalApiKey && (
              <div style={{ 
                padding: '8px 12px', 
                backgroundColor: '#e7f5e7', 
                border: '1px solid #c3e6c3', 
                borderRadius: '4px', 
                marginBottom: '8px',
                fontSize: '0.9em',
                color: '#155724'
              }}>
                ✓ API Key is saved and configured: {originalApiKey}
              </div>
            )}
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder={originalApiKey ? "Enter new API key or leave blank to keep current" : "Enter your Gemini API key"}
              required={!originalApiKey}
            />
            <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
              {originalApiKey ? (
                <>Current API key is configured and saved. Enter a new key only if you want to change it.<br /></>
              ) : null}
              Get your API key from https://aistudio.google.com/app/apikey
            </small>
          </div>

          <div className="form-group">
            <label>Model Name *</label>
            {config.id && config.modelName && (
              <div style={{ 
                padding: '6px 10px', 
                backgroundColor: '#f0f9ff', 
                border: '1px solid #bae6fd', 
                borderRadius: '4px', 
                marginBottom: '8px',
                fontSize: '0.85em',
                color: '#0369a1',
                display: 'inline-block'
              }}>
                Current saved: {config.modelName}
              </div>
            )}
            <select
              value={config.modelName}
              onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
              required
            >
              {availableModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={config.isActive}
                onChange={(e) => setConfig({ ...config, isActive: e.target.checked })}
                style={{ width: 'auto', marginRight: '10px' }}
              />
              Active
            </label>
          </div>

          <div className="form-group">
            <label>Description</label>
            {config.id && config.description && (
              <div style={{ 
                padding: '6px 10px', 
                backgroundColor: '#f0f9ff', 
                border: '1px solid #bae6fd', 
                borderRadius: '4px', 
                marginBottom: '8px',
                fontSize: '0.85em',
                color: '#0369a1'
              }}>
                Current saved description shown below
              </div>
            )}
            <textarea
              value={config.description || ''}
              onChange={(e) => setConfig({ ...config, description: e.target.value })}
              rows="3"
              placeholder="Enter a description for this configuration"
            />
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button
              type="button"
              onClick={handleTest}
              className="btn btn-success"
            >
              Test Connection
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AiConfig;




