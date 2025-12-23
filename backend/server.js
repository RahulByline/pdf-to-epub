import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import userRoutes from './src/routes/userRoutes.js';
import pdfRoutes from './src/routes/pdfRoutes.js';
import conversionRoutes from './src/routes/conversionRoutes.js';
import aiConfigRoutes from './src/routes/aiConfigRoutes.js';
import audioSyncRoutes from './src/routes/audioSyncRoutes.js';
import jobPagesRoutes from './src/routes/jobPagesRoutes.js';
import transcriptRoutes from './src/routes/transcriptRoutes.js';

// Import middleware
import { errorHandler } from './src/middlewares/errorHandler.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8081;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/epub_output', express.static(path.join(__dirname, 'epub_output')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/pdfs', pdfRoutes);
app.use('/api/conversions', conversionRoutes);
app.use('/api/ai', aiConfigRoutes);
app.use('/api/audio-sync', audioSyncRoutes);
app.use('/api/jobs', jobPagesRoutes);
app.use('/api/transcripts', transcriptRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle server errors gracefully
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use!`);
    console.error(`Please either:`);
    console.error(`1. Stop the process using port ${PORT}`);
    console.error(`2. Change the PORT in .env file`);
    console.error(`\nTo find and kill the process:`);
    console.error(`  Windows: netstat -ano | findstr :${PORT}`);
    console.error(`  Then: taskkill /PID <PID> /F`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

export default app;

