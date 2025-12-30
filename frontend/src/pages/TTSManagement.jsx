import React, { useState, useEffect } from 'react';
import { 
  HiOutlineVolumeUp, 
  HiOutlineCog, 
  HiOutlinePlay, 
  HiOutlinePause,
  HiOutlineStop,
  HiOutlineTrash,
  HiOutlineSave,
  HiOutlineRefresh,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineClock,
  HiOutlineDocument,
  HiOutlineInformationCircle
} from 'react-icons/hi';
import { ttsManagementService } from '../services/ttsManagementService';
import api from '../services/api';
import './TTSManagement.css';

const TTSManagement = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // TTS Configuration
  const [config, setConfig] = useState({
    provider: 'gemini', // 'gemini', 'google', 'azure', etc.
    voice: 'standard',
    gender: 'NEUTRAL', // 'MALE', 'FEMALE', 'NEUTRAL'
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
    language: 'en-US',
    enableRestrictions: true,
    skipTOC: true,
    skipPageNumbers: true,
    skipHeaders: true,
    skipFooters: true,
    maxLength: 5000, // Max characters per request
    rateLimit: 100, // Requests per minute
  });

  // Restrictions and Conditions
  const [restrictions, setRestrictions] = useState({
    minTextLength: 10,
    maxTextLength: 5000,
    allowedLanguages: ['en-US', 'en-GB'],
    blockedPatterns: ['TOC', 'Table of Contents', 'Page \\d+'],
    requiredPatterns: [],
    skipEmptyText: true,
    skipWhitespaceOnly: true,
    validateBeforeGeneration: true,
  });

  // Generation History
  const [history, setHistory] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);

  // Available voices
  const [voices, setVoices] = useState([]);

  // Test text input
  const [testText, setTestText] = useState('This is a test of the TTS system.');
  const [testAudioUrl, setTestAudioUrl] = useState(null);

  useEffect(() => {
    loadConfig();
    loadVoices();
    loadHistory();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const savedConfig = await ttsManagementService.getConfig();
      if (savedConfig) {
        setConfig({ ...config, ...savedConfig });
      }
    } catch (err) {
      console.error('Error loading config:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadVoices = async () => {
    try {
      const voicesData = await ttsManagementService.getVoices();
      setVoices(voicesData);
    } catch (err) {
      console.error('Error loading voices:', err);
    }
  };

  const loadHistory = async () => {
    try {
      const historyData = await ttsManagementService.getHistory();
      setHistory(historyData);
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setLoading(true);
      setError('');
      await ttsManagementService.saveConfig(config);
      setSuccess('Configuration saved successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to save configuration: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRestrictions = async () => {
    try {
      setLoading(true);
      setError('');
      await ttsManagementService.saveRestrictions(restrictions);
      setSuccess('Restrictions saved successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to save restrictions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestTTS = async () => {
    try {
      if (!testText || !testText.trim()) {
        setError('Please enter some text to test');
        return;
      }

      setGenerating(true);
      setError('');
      setSuccess('');
      setTestAudioUrl(null);
      setProgress('Generating audio for your text...');
      
      // Use the text from the input field
      const result = await ttsManagementService.testGeneration(testText.trim(), config, restrictions);
      
      if (result.success) {
        // Build detailed success message with configuration info
        let successMsg = 'TTS audio generated successfully!';
        if (result.config) {
          successMsg += `\n\nConfiguration Summary:\n`;
          successMsg += `- Provider: ${result.config.provider}\n`;
          successMsg += `- Voice: ${result.config.voice}\n`;
          successMsg += `- Voice Tone: ${result.config.gender || 'NEUTRAL'}\n`;
          successMsg += `- Language: ${result.config.language}\n`;
          successMsg += `- Speed: ${result.config.speed}x\n`;
          successMsg += `- Restrictions: ${result.config.restrictionsEnabled ? 'Enabled' : 'Disabled'}\n`;
          successMsg += `- Audio Size: ${result.config.audioSize}`;
        }
        
        // Show warnings if any
        if (result.validation?.warnings?.length > 0) {
          successMsg += `\n\nWarnings:\n${result.validation.warnings.join('\n')}`;
        }
        
        setSuccess(successMsg);
        
        // Set audio URL for playback - construct full URL
        if (result.audioUrl) {
          // Convert relative URL to absolute URL
          // API base URL is like "http://localhost:8082/api"
          // Static files are at "http://localhost:8082/uploads" (no /api prefix)
          const apiBaseUrl = api.defaults.baseURL || 'http://localhost:8082/api';
          const backendBaseUrl = apiBaseUrl.replace('/api', '');
          const fullAudioUrl = result.audioUrl.startsWith('http') 
            ? result.audioUrl 
            : `${backendBaseUrl}${result.audioUrl}`;
          setTestAudioUrl(fullAudioUrl);
          console.log('Test audio URL:', fullAudioUrl);
        }
      } else {
        let errorMsg = 'TTS generation failed: ' + result.error;
        if (result.validation) {
          if (result.validation.errors?.length > 0) {
            errorMsg += '\n\nErrors:\n' + result.validation.errors.join('\n');
          }
          if (result.validation.warnings?.length > 0) {
            errorMsg += '\n\nWarnings:\n' + result.validation.warnings.join('\n');
          }
        }
        setError(errorMsg);
      }
    } catch (err) {
      setError('Test failed: ' + err.message);
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const handleGenerateForJob = async (jobId) => {
    if (!window.confirm('Generate TTS audio for this conversion job?')) {
      return;
    }

    try {
      setGenerating(true);
      setError('');
      setProgress('Generating TTS audio...');
      
      const result = await ttsManagementService.generateForJob(jobId, config, restrictions);
      
      if (result.success) {
        setSuccess(`TTS audio generated successfully for job ${jobId}!`);
        loadHistory();
      } else {
        setError('Generation failed: ' + result.error);
      }
    } catch (err) {
      setError('Generation failed: ' + err.message);
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  return (
    <div className="tts-management">
      <div className="tts-management-header">
        <h1>
          <HiOutlineVolumeUp className="header-icon" />
          TTS Management System
        </h1>
        <p className="subtitle">Manage Text-to-Speech generation with Gemini AI</p>
      </div>

      {error && (
        <div className="alert alert-error">
          <HiOutlineXCircle />
          {error}
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <HiOutlineCheckCircle />
          {success}
        </div>
      )}

      {progress && (
        <div className="alert alert-info">
          <HiOutlineClock />
          {progress}
        </div>
      )}

      <div className="tts-management-grid">
        {/* Configuration Panel */}
        <div className="tts-panel">
          <div className="panel-header">
            <HiOutlineCog className="panel-icon" />
            <h2>TTS Configuration</h2>
          </div>
          
          <div className="panel-content">
            <div className="form-group">
              <label>Provider</label>
              <select 
                value={config.provider} 
                onChange={(e) => setConfig({ ...config, provider: e.target.value })}
              >
                <option value="gemini">Gemini AI</option>
                <option value="google">Google Cloud TTS</option>
                <option value="azure">Azure Cognitive Services</option>
              </select>
            </div>

            <div className="form-group">
              <label>Voice</label>
              <select 
                value={config.voice} 
                onChange={(e) => setConfig({ ...config, voice: e.target.value })}
              >
                {voices.map(v => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Voice Tone</label>
              <select 
                value={config.gender} 
                onChange={(e) => setConfig({ ...config, gender: e.target.value })}
              >
                <option value="MALE">Male Voice</option>
                <option value="FEMALE">Female Voice</option>
                <option value="NEUTRAL">Neutral Voice</option>
              </select>
              <small className="form-text">
                Select the gender/tone of the voice (Male, Female, or Neutral)
              </small>
            </div>

            <div className="form-group">
              <label>Speed: {config.speed}x</label>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.1" 
                value={config.speed}
                onChange={(e) => setConfig({ ...config, speed: parseFloat(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>Pitch: {config.pitch}</label>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.1" 
                value={config.pitch}
                onChange={(e) => setConfig({ ...config, pitch: parseFloat(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>Language</label>
              <select 
                value={config.language} 
                onChange={(e) => setConfig({ ...config, language: e.target.value })}
              >
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="es-ES">Spanish</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
              </select>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input 
                  type="checkbox" 
                  checked={config.skipTOC}
                  onChange={(e) => setConfig({ ...config, skipTOC: e.target.checked })}
                />
                Skip Table of Contents
              </label>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input 
                  type="checkbox" 
                  checked={config.skipPageNumbers}
                  onChange={(e) => setConfig({ ...config, skipPageNumbers: e.target.checked })}
                />
                Skip Page Numbers
              </label>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input 
                  type="checkbox" 
                  checked={config.skipHeaders}
                  onChange={(e) => setConfig({ ...config, skipHeaders: e.target.checked })}
                />
                Skip Headers
              </label>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input 
                  type="checkbox" 
                  checked={config.skipFooters}
                  onChange={(e) => setConfig({ ...config, skipFooters: e.target.checked })}
                />
                Skip Footers
              </label>
            </div>

            <button 
              onClick={handleSaveConfig} 
              disabled={loading}
              className="btn btn-primary"
            >
              <HiOutlineSave />
              Save Configuration
            </button>
          </div>
        </div>

        {/* Restrictions Panel */}
        <div className="tts-panel">
          <div className="panel-header">
            <HiOutlineInformationCircle className="panel-icon" />
            <h2>Restrictions & Conditions</h2>
          </div>
          
          <div className="panel-content">
            <div className="form-group">
              <label>Min Text Length</label>
              <input 
                type="number" 
                min="1" 
                value={restrictions.minTextLength}
                onChange={(e) => setRestrictions({ ...restrictions, minTextLength: parseInt(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>Max Text Length</label>
              <input 
                type="number" 
                min="100" 
                max="10000" 
                value={restrictions.maxTextLength}
                onChange={(e) => setRestrictions({ ...restrictions, maxTextLength: parseInt(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>Blocked Patterns (one per line)</label>
              <textarea 
                rows="4"
                value={restrictions.blockedPatterns.join('\n')}
                onChange={(e) => setRestrictions({ 
                  ...restrictions, 
                  blockedPatterns: e.target.value.split('\n').filter(p => p.trim()) 
                })}
                placeholder="TOC&#10;Table of Contents&#10;Page \d+"
              />
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input 
                  type="checkbox" 
                  checked={restrictions.skipEmptyText}
                  onChange={(e) => setRestrictions({ ...restrictions, skipEmptyText: e.target.checked })}
                />
                Skip Empty Text
              </label>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input 
                  type="checkbox" 
                  checked={restrictions.skipWhitespaceOnly}
                  onChange={(e) => setRestrictions({ ...restrictions, skipWhitespaceOnly: e.target.checked })}
                />
                Skip Whitespace Only
              </label>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input 
                  type="checkbox" 
                  checked={restrictions.validateBeforeGeneration}
                  onChange={(e) => setRestrictions({ ...restrictions, validateBeforeGeneration: e.target.checked })}
                />
                Validate Before Generation
              </label>
            </div>

            <button 
              onClick={handleSaveRestrictions} 
              disabled={loading}
              className="btn btn-primary"
            >
              <HiOutlineSave />
              Save Restrictions
            </button>
          </div>
        </div>

        {/* Actions Panel */}
        <div className="tts-panel">
          <div className="panel-header">
            <HiOutlinePlay className="panel-icon" />
            <h2>Actions</h2>
          </div>
          
          <div className="panel-content">
            <div className="form-group">
              <label htmlFor="test-text">Test Text</label>
              <textarea
                id="test-text"
                className="form-control"
                rows="4"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="Type or paste text here to test TTS generation..."
                disabled={generating}
              />
              <small className="form-text">
                Enter any text to generate audio and test your TTS configuration
              </small>
            </div>

            <button 
              onClick={handleTestTTS} 
              disabled={generating || !testText?.trim()}
              className="btn btn-secondary"
            >
              <HiOutlinePlay />
              {generating ? 'Generating Audio...' : 'Test TTS Generation'}
            </button>

            {testAudioUrl && (
              <div className="audio-player-container" style={{ marginTop: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Generated Audio:
                </label>
                <audio 
                  controls 
                  src={testAudioUrl}
                  style={{ width: '100%' }}
                  onError={(e) => {
                    console.error('Audio loading error:', e);
                    setError('Failed to load audio file. Please check the console for details.');
                  }}
                  onLoadedData={() => {
                    console.log('Audio loaded successfully:', testAudioUrl);
                  }}
                >
                  Your browser does not support the audio element.
                </audio>
                <small style={{ display: 'block', marginTop: '0.5rem', color: '#6b7280', fontSize: '0.85rem' }}>
                  Audio URL: {testAudioUrl}
                </small>
              </div>
            )}

            <div className="info-box">
              <HiOutlineInformationCircle />
              <p>Type any text above and click the button to generate audio and test your TTS configuration.</p>
            </div>
          </div>
        </div>

        {/* Generation History */}
        <div className="tts-panel tts-panel-full">
          <div className="panel-header">
            <HiOutlineDocument className="panel-icon" />
            <h2>Generation History</h2>
            <button 
              onClick={loadHistory} 
              className="btn-icon"
              title="Refresh"
            >
              <HiOutlineRefresh />
            </button>
          </div>
          
          <div className="panel-content">
            {history.length === 0 ? (
              <p className="empty-state">No generation history yet.</p>
            ) : (
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Voice</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(item => (
                    <tr key={item.id}>
                      <td>{item.jobId}</td>
                      <td>
                        <span className={`status-badge status-${item.status}`}>
                          {item.status}
                        </span>
                      </td>
                      <td>{item.provider}</td>
                      <td>{item.voice}</td>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                      <td>
                        <button 
                          onClick={() => handleGenerateForJob(item.jobId)}
                          disabled={generating}
                          className="btn-icon"
                          title="Regenerate"
                        >
                          <HiOutlineRefresh />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TTSManagement;

