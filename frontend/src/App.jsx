import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import PdfList from './pages/PdfList';
import PdfUpload from './pages/PdfUpload';
import Conversions from './pages/Conversions';
import AudioSync from './pages/AudioSync';
import AiConfig from './pages/AiConfig';

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
          <Route path="audio-sync/:jobId" element={<AudioSync />} />
          <Route path="ai-config" element={<AiConfig />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;

