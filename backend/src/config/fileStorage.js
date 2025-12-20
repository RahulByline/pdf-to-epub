import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '../../');

// Ensure directories exist
export const ensureDirectories = async () => {
  const uploadDir = path.join(rootDir, process.env.UPLOAD_DIR || 'uploads');
  const epubOutputDir = path.join(rootDir, process.env.EPUB_OUTPUT_DIR || 'epub_output');
  const htmlIntermediateDir = path.join(rootDir, process.env.HTML_INTERMEDIATE_DIR || 'html_intermediate');
  const ttsOutputDir = path.join(rootDir, process.env.TTS_OUTPUT_DIR || 'uploads/tts_audio');

  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(epubOutputDir, { recursive: true });
    await fs.mkdir(htmlIntermediateDir, { recursive: true });
    await fs.mkdir(ttsOutputDir, { recursive: true });
  } catch (error) {
    console.error('Error creating directories:', error);
  }
};

export const getUploadDir = () => {
  return path.join(rootDir, process.env.UPLOAD_DIR || 'uploads');
};

export const getEpubOutputDir = () => {
  return path.join(rootDir, process.env.EPUB_OUTPUT_DIR || 'epub_output');
};

export const getHtmlIntermediateDir = () => {
  return path.join(rootDir, process.env.HTML_INTERMEDIATE_DIR || 'html_intermediate');
};

export const getTtsOutputDir = () => {
  return path.join(rootDir, process.env.TTS_OUTPUT_DIR || 'uploads/tts_audio');
};





