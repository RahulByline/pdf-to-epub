import React, { useEffect, useState } from 'react';
import { aiConfigService } from '../services/aiConfigService';

const AiConfig = () => {
  const [config, setConfig] = useState({
    apiKey: '',
    modelName: 'gemini-pro',
    isActive: false,
    description: ''
  });
  const [availableModels, setAvailableModels] = useState([]);
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
        setConfig(currentConfig);
      }
      setAvailableModels(models);
      setStatus(aiStatus);
    } catch (err) {
      console.error('Error loading config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await aiConfigService.saveConfig(config);
      setSuccess('Configuration saved successfully!');
      await loadConfig();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      await aiConfigService.testConnection(config.apiKey, config.modelName);
      setSuccess('Connection test successful!');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Connection test failed');
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

      <div className="card">
        <div style={{ marginBottom: '20px' }}>
          <strong>Status: </strong>
          <span className={status.enabled ? 'badge badge-success' : 'badge badge-danger'}>
            {status.enabled ? 'Enabled' : 'Disabled'}
          </span>
          {status.model && <span style={{ marginLeft: '10px' }}>Model: {status.model}</span>}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>API Key *</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="Enter your Gemini API key"
              required
            />
            <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
              Get your API key from https://aistudio.google.com/app/apikey
            </small>
          </div>

          <div className="form-group">
            <label>Model Name *</label>
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
            <textarea
              value={config.description || ''}
              onChange={(e) => setConfig({ ...config, description: e.target.value })}
              rows="3"
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



