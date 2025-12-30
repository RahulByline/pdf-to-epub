import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import PdfList from './pages/PdfList';
import PdfUpload from './pages/PdfUpload';
import Conversions from './pages/Conversions';
import SyncStudio from './pages/SyncStudio';
import MediaOverlaySyncEditor from './pages/MediaOverlaySyncEditor';
import AudioScript from './pages/AudioScript';
import AiConfig from './pages/AiConfig';
import EpubImageEditorPage from './pages/EpubImageEditorPage';
import TTSManagement from './pages/TTSManagement';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="pdfs" element={<PdfList />} />
          <Route path="pdfs/upload" element={<PdfUpload />} />
          <Route path="conversions" element={<Conversions />} />
          <Route path="sync-studio/:jobId" element={<SyncStudio />} />
          <Route path="audio-script/:jobId" element={<AudioScript />} />
          <Route path="media-overlay-sync/:jobId/:pageNumber" element={<MediaOverlaySyncEditor />} />
          <Route path="epub-image-editor/:jobId" element={<EpubImageEditorPage />} />
          <Route path="ai-config" element={<AiConfig />} />
          <Route path="tts-management" element={<TTSManagement />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;

