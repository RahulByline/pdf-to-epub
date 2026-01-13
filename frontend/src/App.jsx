import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
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
import TtsManagement from './pages/TtsManagement';
import EpubImageEditorPage from './pages/EpubImageEditorPage';
import ChapterSelector from './pages/ChapterSelector';
import ApiDebugger from './components/ApiDebugger';

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="pdfs" element={<PdfList />} />
          <Route path="chapter-plan/:pdfId" element={<ChapterSelector />} />
          <Route path="pdfs/upload" element={<PdfUpload />} />
          <Route path="conversions" element={<Conversions />} />
          <Route path="sync-studio/:jobId" element={<SyncStudio />} />
          <Route path="audio-script/:jobId" element={<AudioScript />} />
          <Route path="media-overlay-sync/:jobId/:pageNumber" element={<MediaOverlaySyncEditor />} />
          <Route path="epub-image-editor/:jobId" element={<EpubImageEditorPage />} />
          <Route path="ai-config" element={<AiConfig />} />
          <Route path="tts-management" element={<TtsManagement />} />
          <Route path="api-debugger" element={<ApiDebugger />} />
        </Route>
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;

