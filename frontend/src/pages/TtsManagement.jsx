import React, { useEffect, useState } from 'react';
import { ttsConfigService } from '../services/ttsConfigService';
import './TtsManagement.css';

const TtsManagement = () => {
  const [config, setConfig] = useState({
    id: null,
    credentialsPath: '',
    languageCode: 'en-US',
    voiceName: '',
    ssmlGender: 'NEUTRAL',
    audioEncoding: 'MP3',
    speakingRate: 1.0,
    pitch: 0.0,
    volumeGainDb: 0.0,
    useFreeTts: false,
    pageRestrictions: {
      include: '',
      exclude: ''
    },
    exclusionPrompt: '',
    isActive: false,
    description: '',
    updatedAt: null
  });
  const [originalCredentialsPath, setOriginalCredentialsPath] = useState('');
  const [availableLanguages, setAvailableLanguages] = useState([]);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [availableEncodings, setAvailableEncodings] = useState([]);
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testDetails, setTestDetails] = useState(null);
  const [detectingPages, setDetectingPages] = useState(false);
  const [detectionResult, setDetectionResult] = useState(null);

  // Helper function to detect if credentials path is masked
  const isMaskedPath = (path) => {
    return path && (path.includes('****') || path.length < 10);
  };

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (config.languageCode) {
      loadVoices(config.languageCode);
    }
  }, [config.languageCode]);

  const loadConfig = async () => {
    try {
      const [currentConfig, languages, encodings, ttsStatus] = await Promise.all([
        ttsConfigService.getCurrentConfig(),
        ttsConfigService.getAvailableLanguages(),
        ttsConfigService.getAvailableAudioEncodings(),
        ttsConfigService.getStatus()
      ]);

      setAvailableLanguages(languages || []);
      setAvailableEncodings(encodings || []);

      if (currentConfig) {
        // Check if credentials path is masked
        const pathIsMasked = isMaskedPath(currentConfig.credentialsPath);
        setConfig({
          id: currentConfig.id || null,
          credentialsPath: pathIsMasked ? '' : currentConfig.credentialsPath,
          languageCode: currentConfig.languageCode || 'en-US',
          voiceName: currentConfig.voiceName || '',
          ssmlGender: currentConfig.ssmlGender || 'NEUTRAL',
          audioEncoding: currentConfig.audioEncoding || 'MP3',
          speakingRate: currentConfig.speakingRate !== undefined ? currentConfig.speakingRate : 1.0,
          pitch: currentConfig.pitch !== undefined ? currentConfig.pitch : 0.0,
          volumeGainDb: currentConfig.volumeGainDb !== undefined ? currentConfig.volumeGainDb : 0.0,
          useFreeTts: currentConfig.useFreeTts !== undefined ? currentConfig.useFreeTts : false,
          pageRestrictions: currentConfig.pageRestrictions || { include: '', exclude: '' },
          exclusionPrompt: currentConfig.exclusionPrompt || '',
          isActive: currentConfig.isActive !== undefined ? currentConfig.isActive : true,
          description: currentConfig.description || '',
          updatedAt: currentConfig.updatedAt || null
        });
        setOriginalCredentialsPath(pathIsMasked ? currentConfig.credentialsPath : '');
      }
      setStatus(ttsStatus);
    } catch (err) {
      console.error('Error loading config:', err);
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const loadVoices = async (languageCode) => {
    try {
      const voices = await ttsConfigService.getAvailableVoices(languageCode);
      setAvailableVoices(voices);
    } catch (err) {
      console.error('Error loading voices:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    setTestDetails(null);

    try {
      // Prepare page restrictions
      const pageRestrictions = {};
      if (config.pageRestrictions.include && config.pageRestrictions.include.trim()) {
        pageRestrictions.include = config.pageRestrictions.include.trim();
      }
      if (config.pageRestrictions.exclude && config.pageRestrictions.exclude.trim()) {
        pageRestrictions.exclude = config.pageRestrictions.exclude.trim();
      }

      const configToSave = {
        id: config.id,
        languageCode: config.languageCode,
        voiceName: config.voiceName || null,
        ssmlGender: config.ssmlGender,
        audioEncoding: config.audioEncoding,
        speakingRate: config.speakingRate,
        pitch: config.pitch,
        volumeGainDb: config.volumeGainDb,
        useFreeTts: config.useFreeTts,
        pageRestrictions: Object.keys(pageRestrictions).length > 0 ? pageRestrictions : null,
        exclusionPrompt: config.exclusionPrompt || null,
        isActive: config.isActive,
        description: config.description
      };

      // Only include credentials path if it's new (not masked and different)
      if (config.credentialsPath && config.credentialsPath.trim().length > 0 && !isMaskedPath(config.credentialsPath)) {
        if (config.credentialsPath !== originalCredentialsPath) {
          configToSave.credentialsPath = config.credentialsPath.trim();
        }
      } else if (config.useFreeTts) {
        // If using free TTS, don't require credentials
        configToSave.credentialsPath = null;
      }

      const savedConfig = await ttsConfigService.saveConfig(configToSave);
      setSuccess('Configuration saved successfully! All settings have been stored.');
      
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
    
    try {
      const credentialsPath = config.useFreeTts ? null : 
        (config.credentialsPath && config.credentialsPath.trim().length > 0 && !isMaskedPath(config.credentialsPath) 
          ? config.credentialsPath.trim() 
          : (originalCredentialsPath && !isMaskedPath(originalCredentialsPath) ? originalCredentialsPath : null));

      const result = await ttsConfigService.testConnection(
        credentialsPath,
        config.languageCode,
        config.voiceName || null,
        config.ssmlGender
      );
      setSuccess(result.summary || 'Connection test successful!');
      if (result.details) {
        setTestDetails(result.details);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Connection test failed');
      setTestDetails(null);
    }
  };

  const handleDetectPages = async () => {
    if (!config.exclusionPrompt || !config.exclusionPrompt.trim()) {
      setError('Please enter an exclusion prompt to describe which pages should be excluded');
      return;
    }

    setDetectingPages(true);
    setError('');
    setSuccess('');
    setDetectionResult(null);

    try {
      // Prepare page restrictions
      const pageRestrictions = {};
      if (config.pageRestrictions.include && config.pageRestrictions.include.trim()) {
        pageRestrictions.include = config.pageRestrictions.include.trim();
      }
      if (config.pageRestrictions.exclude && config.pageRestrictions.exclude.trim()) {
        pageRestrictions.exclude = config.pageRestrictions.exclude.trim();
      }

      // Save the exclusion prompt along with current configuration
      const configToSave = {
        id: config.id,
        languageCode: config.languageCode,
        voiceName: config.voiceName || null,
        ssmlGender: config.ssmlGender,
        audioEncoding: config.audioEncoding,
        speakingRate: config.speakingRate,
        pitch: config.pitch,
        volumeGainDb: config.volumeGainDb,
        useFreeTts: config.useFreeTts,
        pageRestrictions: Object.keys(pageRestrictions).length > 0 ? pageRestrictions : null,
        exclusionPrompt: config.exclusionPrompt.trim(),
        isActive: config.isActive,
        description: config.description
      };

      // Only include credentials path if it's new (not masked and different)
      if (config.credentialsPath && config.credentialsPath.trim().length > 0 && !isMaskedPath(config.credentialsPath)) {
        if (config.credentialsPath !== originalCredentialsPath) {
          configToSave.credentialsPath = config.credentialsPath.trim();
        }
      } else if (config.useFreeTts) {
        // If using free TTS, don't require credentials
        configToSave.credentialsPath = null;
      }

      const savedConfig = await ttsConfigService.saveConfig(configToSave);
      setSuccess('Exclusion prompt saved successfully! Pages matching your description will be automatically detected and excluded during TTS generation.');
      
      // Reload config to show updated values
      await loadConfig();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save exclusion prompt');
      setDetectionResult(null);
    } finally {
      setDetectingPages(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="container">
      <h1>TTS Management</h1>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      
      {testDetails && (
        <div className="card" style={{ marginTop: '20px', backgroundColor: '#f0f9ff', border: '1px solid #0ea5e9' }}>
          <h3 style={{ marginTop: '0', color: '#0369a1' }}>Test Configuration Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
            <div>
              <strong style={{ color: '#64748b' }}>Status:</strong>
              <div style={{ color: '#059669', fontWeight: 'bold', marginTop: '5px' }}>
                ✓ {testDetails.status === 'connected' || testDetails.status === 'free-tts' ? 'Connected' : testDetails.status}
              </div>
            </div>
            {testDetails.languageCode && (
              <div>
                <strong style={{ color: '#64748b' }}>Language:</strong>
                <div style={{ marginTop: '5px' }}>{testDetails.languageCode}</div>
              </div>
            )}
            {testDetails.voiceName && (
              <div>
                <strong style={{ color: '#64748b' }}>Voice:</strong>
                <div style={{ marginTop: '5px' }}>{testDetails.voiceName}</div>
              </div>
            )}
            {testDetails.audioSize && (
              <div>
                <strong style={{ color: '#64748b' }}>Audio Size:</strong>
                <div style={{ marginTop: '5px', color: '#059669' }}>{testDetails.audioSize}</div>
              </div>
            )}
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
            {status.clientStatus && (
              <div>
                <strong>Client: </strong>
                <span style={{ color: '#495057', fontWeight: '500' }}>
                  {status.clientStatus === 'google-cloud' ? 'Google Cloud TTS' : 
                   status.clientStatus === 'free-tts' ? 'Free gTTS' : 
                   status.clientStatus}
                </span>
              </div>
            )}
            {status.languageCode && (
              <div>
                <strong>Language: </strong>
                <span style={{ color: '#495057', fontWeight: '500' }}>{status.languageCode}</span>
              </div>
            )}
            {config.id && (
              <div style={{ marginLeft: 'auto', fontSize: '0.9em', color: '#6c757d' }}>
                ✓ Configuration Saved
                {config.exclusionPrompt && config.exclusionPrompt.trim() && (
                  <div style={{ fontSize: '0.85em', marginTop: '4px', color: '#0c5460', fontWeight: '500' }}>
                    ✓ Exclusion Prompt: Active
                  </div>
                )}
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
            <label>
              <input
                type="checkbox"
                checked={config.useFreeTts}
                onChange={(e) => setConfig({ ...config, useFreeTts: e.target.checked })}
                style={{ width: 'auto', marginRight: '10px' }}
              />
              Use Free TTS (gTTS - No credentials required)
            </label>
            <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
              When enabled, uses free gTTS service. No Google Cloud credentials needed, but word-level timing won't be available.
            </small>
          </div>

          {!config.useFreeTts && (
            <div className="form-group">
              <label>Google Cloud Credentials Path {originalCredentialsPath ? '(leave blank to keep current)' : ''}</label>
              {originalCredentialsPath && (
                <div style={{ 
                  padding: '8px 12px', 
                  backgroundColor: '#e7f5e7', 
                  border: '1px solid #c3e6c3', 
                  borderRadius: '4px', 
                  marginBottom: '8px',
                  fontSize: '0.9em',
                  color: '#155724'
                }}>
                  ✓ Credentials path is saved: {originalCredentialsPath}
                </div>
              )}
              <input
                type="text"
                value={config.credentialsPath}
                onChange={(e) => setConfig({ ...config, credentialsPath: e.target.value })}
                placeholder={originalCredentialsPath ? "Enter new path or leave blank to keep current" : "Path to Google Cloud service account JSON file"}
              />
              <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                {originalCredentialsPath ? (
                  <>Current credentials path is configured and saved. Enter a new path only if you want to change it.<br /></>
                ) : null}
                Path to your Google Cloud service account JSON file. Get credentials from Google Cloud Console.
              </small>
            </div>
          )}

          <div className="form-group">
            <label>Language Code *</label>
            <select
              value={config.languageCode}
              onChange={(e) => setConfig({ ...config, languageCode: e.target.value, voiceName: '' })}
              required
            >
              {availableLanguages.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.name} ({lang.code})</option>
              ))}
            </select>
          </div>

          {!config.useFreeTts && (
            <>
              <div className="form-group">
                <label>Voice Name</label>
                <select
                  value={config.voiceName}
                  onChange={(e) => setConfig({ ...config, voiceName: e.target.value })}
                >
                  <option value="">Default (Auto-select)</option>
                  {availableVoices.map(voice => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} ({voice.gender}) - {voice.description}
                    </option>
                  ))}
                </select>
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  Leave empty to use default voice for the selected language
                </small>
              </div>

              <div className="form-group">
                <label>SSML Gender *</label>
                <select
                  value={config.ssmlGender}
                  onChange={(e) => setConfig({ ...config, ssmlGender: e.target.value })}
                  required
                >
                  <option value="NEUTRAL">Neutral</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              </div>

              <div className="form-group">
                <label>Audio Encoding *</label>
                <select
                  value={config.audioEncoding}
                  onChange={(e) => setConfig({ ...config, audioEncoding: e.target.value })}
                  required
                >
                  {availableEncodings.map(enc => (
                    <option key={enc.value} value={enc.value}>{enc.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Speaking Rate: {config.speakingRate.toFixed(2)}x</label>
                <input
                  type="range"
                  min="0.25"
                  max="4.0"
                  step="0.1"
                  value={config.speakingRate}
                  onChange={(e) => setConfig({ ...config, speakingRate: parseFloat(e.target.value) })}
                />
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  Speed of speech (0.25x to 4.0x). Default is 1.0x (normal speed).
                </small>
              </div>

              <div className="form-group">
                <label>Pitch: {config.pitch > 0 ? '+' : ''}{config.pitch.toFixed(1)} semitones</label>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="0.1"
                  value={config.pitch}
                  onChange={(e) => setConfig({ ...config, pitch: parseFloat(e.target.value) })}
                />
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  Pitch adjustment in semitones (-20 to +20). Default is 0.0 (no change).
                </small>
              </div>

              <div className="form-group">
                <label>Volume Gain: {config.volumeGainDb > 0 ? '+' : ''}{config.volumeGainDb.toFixed(1)} dB</label>
                <input
                  type="range"
                  min="-96"
                  max="16"
                  step="0.1"
                  value={config.volumeGainDb}
                  onChange={(e) => setConfig({ ...config, volumeGainDb: parseFloat(e.target.value) })}
                />
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  Volume gain in decibels (-96 to +16). Default is 0.0 (no change).
                </small>
              </div>
            </>
          )}

          <div className="form-group" style={{ marginTop: '30px', paddingTop: '20px', borderTop: '2px solid #e0e0e0' }}>
            <h3 style={{ marginTop: '0', marginBottom: '16px', color: '#1976d2', fontSize: '18px' }}>Page Restrictions</h3>
            <p style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
              Control which pages should have TTS audio generated. Leave empty to process all pages.
            </p>
            
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label>Include Pages (Optional)</label>
              <input
                type="text"
                value={config.pageRestrictions.include}
                onChange={(e) => setConfig({ 
                  ...config, 
                  pageRestrictions: { 
                    ...config.pageRestrictions, 
                    include: e.target.value 
                  } 
                })}
                placeholder="e.g., 1-10, 15, 20-25"
              />
              <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                Specify pages to include. Use ranges (e.g., "1-10") or individual pages (e.g., "1, 3, 5"). 
                If specified, only these pages will have TTS generated. Examples: "1-10", "1, 3, 5", "1-5, 10-15"
              </small>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label>Exclude Pages (Optional)</label>
              <input
                type="text"
                value={config.pageRestrictions.exclude}
                onChange={(e) => setConfig({ 
                  ...config, 
                  pageRestrictions: { 
                    ...config.pageRestrictions, 
                    exclude: e.target.value 
                  } 
                })}
                placeholder="e.g., 1, 5, 10"
              />
              <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                Specify pages to exclude from TTS generation. Use ranges (e.g., "1-5") or individual pages (e.g., "1, 5, 10"). 
                These pages will be skipped even if they're in the include list. Examples: "1, 5, 10", "1-5", "1-3, 10-12"
              </small>
            </div>

            <div style={{ 
              padding: '12px', 
              backgroundColor: '#f0f9ff', 
              border: '1px solid #bae6fd', 
              borderRadius: '6px',
              fontSize: '13px',
              color: '#0369a1',
              marginBottom: '20px'
            }}>
              <strong>How it works:</strong>
              <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                <li>If <strong>Include</strong> is specified, only those pages will be processed</li>
                <li>If <strong>Exclude</strong> is specified, those pages will be skipped</li>
                <li>If both are specified, pages in Include but not in Exclude will be processed</li>
                <li>If both are empty, all pages will be processed</li>
              </ul>
            </div>

            <div className="form-group" style={{ marginBottom: '20px', padding: '20px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px' }}>
              <label style={{ fontWeight: '600', color: '#856404', marginBottom: '10px', display: 'block' }}>
                AI-Powered Page Detection (Exclusion Prompt)
              </label>
              <textarea
                value={config.exclusionPrompt}
                onChange={(e) => setConfig({ ...config, exclusionPrompt: e.target.value })}
                rows="4"
                placeholder="e.g., Table of contents pages, index pages, blank pages, cover pages, pages with only images and no text"
                style={{ width: '100%', padding: '12px', border: '1px solid #ffc107', borderRadius: '6px', fontSize: '14px', marginBottom: '10px' }}
              />
              <small style={{ color: '#856404', marginTop: '5px', display: 'block', marginBottom: '10px' }}>
                Describe which types of pages should be automatically excluded from TTS generation. 
                AI will analyze your document during conversion/extraction and automatically detect and exclude pages matching your description.
                <br /><br />
                <strong>Examples:</strong>
                <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                  <li>"Table of contents pages"</li>
                  <li>"Index pages and blank pages"</li>
                  <li>"Cover pages and pages with only images"</li>
                  <li>"Pages containing only headers, footers, or page numbers"</li>
                </ul>
              </small>
              <button
                type="button"
                onClick={handleDetectPages}
                className="btn btn-success"
                disabled={detectingPages || !config.exclusionPrompt || !config.exclusionPrompt.trim()}
                style={{ marginTop: '10px' }}
              >
                {detectingPages ? 'Detecting...' : 'Save Exclusion Prompt'}
              </button>
              {config.exclusionPrompt && config.exclusionPrompt.trim() && (
                <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#d1ecf1', border: '1px solid #bee5eb', borderRadius: '4px', fontSize: '13px', color: '#0c5460' }}>
                  <strong>✓ Exclusion prompt {config.id ? 'saved' : 'ready to save'}.</strong> Pages matching your description will be automatically detected and excluded during TTS generation.
                  {config.id && config.updatedAt && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#0a5460' }}>
                      Last saved: {new Date(config.updatedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>
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

export default TtsManagement;

