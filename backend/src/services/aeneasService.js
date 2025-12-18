/**
 * Aeneas Forced Alignment Service
 * 
 * This service provides automated audio-text synchronization using the Aeneas
 * forced aligner. It processes XHTML and MP3 files to generate precise
 * millisecond-level timestamps for each text segment.
 * 
 * Architecture:
 * 1. Text Normalization: Strips XHTML and creates a clean text file
 * 2. Acoustic Modeling: Aeneas "listens" to audio and breaks it into phonemes
 * 3. Mapping: Matches text to phonemes and calculates timestamps
 * 4. Database Injection: Returns timestamps linked to your IDs (page1_p1_s1_w1 or legacy p1_s1_w1)
 * 
 * Dependencies:
 * - Aeneas must be installed: pip install aeneas
 * - FFmpeg must be installed for audio processing
 */

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AeneasService {
  constructor() {
    this.tempDir = path.join(__dirname, '../../temp/aeneas');
    this.ensureTempDir();
  }

  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (err) {
      console.error('[AeneasService] Failed to create temp directory:', err);
    }
  }

  /**
   * Check if Aeneas is installed and available
   * ISSUE #3 FIX: Better logging when Aeneas is not found
   */
  async checkAeneasInstalled() {
    const pythonCommands = ['py -3.9', 'python', 'python3', 'py'];
    
    for (const cmd of pythonCommands) {
      const isAvailable = await new Promise((resolve) => {
        // Use --version which returns exit code 0, or check for specific output
        exec(`${cmd} -m aeneas.tools.execute_task --version`, { timeout: 15000 }, (error, stdout, stderr) => {
          // Check if output contains aeneas version info (even if exit code is non-zero)
          const output = (stdout || '') + (stderr || '');
          const hasAeneas = output.toLowerCase().includes('aeneas') || 
                           output.includes('execute_task') ||
                           output.includes('Alberto Pettarin');
          resolve(hasAeneas);
        });
      });
      
      if (isAvailable) {
        this.pythonCmd = cmd;
        console.log(`[AeneasService] ✅ Found Aeneas with: ${cmd}`);
        return true;
      }
    }
    
    // ISSUE #3 FIX: Clear warning when Aeneas is not found
    console.error('[AeneasService] ❌ AENEAS NOT FOUND - Falling back to linear spread');
    console.error('[AeneasService] ⚠️  Linear spread is less accurate and may cause sync drift');
    console.error('[AeneasService] 📝 To install Aeneas:');
    console.error('[AeneasService]    1. Install Python 3.9+: https://www.python.org/downloads/');
    console.error('[AeneasService]    2. Install dependencies: pip install numpy aeneas');
    console.error('[AeneasService]    3. Install eSpeak NG: https://github.com/espeak-ng/espeak-ng');
    console.error('[AeneasService]    4. Install FFmpeg: https://ffmpeg.org/download.html');
    return false;
  }
  
  /**
   * ISSUE #2 FIX: Detect and adjust for ElevenLabs pause artifacts
   * 
   * Professional TTS voices (like ElevenLabs) often include:
   * - Pre-roll silence (150-300ms at start)
   * - Extended pauses between sentences (200-500ms)
   * 
   * This function detects these pauses and adjusts timestamps accordingly
   * 
   * @param {Object[]} sentences - Sentence alignment results
   * @param {string} audioPath - Path to audio file
   * @param {boolean} enabled - Whether to detect pauses
   * @returns {Promise<Object[]>} Adjusted sentence timings
   */
  async adjustForElevenLabsPauses(sentences, audioPath, enabled = true) {
    if (!enabled || sentences.length === 0) {
      return sentences;
    }
    
    try {
      // Detect silence periods (especially at start and between sentences)
      const silencePeriods = await this.detectSilencePeriods(audioPath, -35, 0.1); // Lower threshold for ElevenLabs
      
      if (silencePeriods.length === 0) {
        return sentences;
      }
      
      console.log(`[AeneasService] Detected ${silencePeriods.length} silence periods (ElevenLabs pause detection)`);
      
      const adjustedSentences = [];
      
      // Check for pre-roll silence (silence at the very start)
      const preRollSilence = silencePeriods.find(s => s.start < 0.5 && s.end > 0.1);
      const preRollOffset = preRollSilence ? preRollSilence.end : 0;
      
      if (preRollOffset > 0) {
        console.log(`[AeneasService] Detected ${(preRollOffset * 1000).toFixed(0)}ms pre-roll silence, adjusting timestamps`);
      }
      
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        let adjustedStart = sentence.startTime + preRollOffset;
        let adjustedEnd = sentence.endTime + preRollOffset;
        
        // Check for pause between this sentence and the next
        if (i < sentences.length - 1) {
          const nextSentence = sentences[i + 1];
          const gap = nextSentence.startTime - sentence.endTime;
          
          // If there's a gap, check if there's silence in that gap
          if (gap > 0.1) {
            const silenceInGap = silencePeriods.find(s => 
              s.start >= sentence.endTime && 
              s.end <= nextSentence.startTime &&
              (s.end - s.start) >= 0.15 // At least 150ms of silence
            );
            
            if (silenceInGap) {
              // Adjust end time to end of silence (more natural pause)
              adjustedEnd = silenceInGap.end + preRollOffset;
              console.log(`[AeneasService] Adjusted sentence ${i + 1} end time for pause: ${(silenceInGap.end - sentence.endTime) * 1000}ms`);
            }
          }
        }
        
        adjustedSentences.push({
          ...sentence,
          startTime: parseFloat(adjustedStart.toFixed(3)),
          endTime: parseFloat(adjustedEnd.toFixed(3))
        });
      }
      
      return adjustedSentences;
      
    } catch (error) {
      console.warn('[AeneasService] ElevenLabs pause detection failed:', error.message);
      return sentences; // Return original if detection fails
    }
  }

  /**
   * Get the Python command (python or python3 or py -3.9)
   */
  async getPythonCommand() {
    if (this.pythonCmd) {
      return this.pythonCmd;
    }
    
    const pythonCommands = ['py -3.9', 'python', 'python3', 'py'];
    
    for (const cmd of pythonCommands) {
      const works = await new Promise((resolve) => {
        exec(`${cmd} -c "import aeneas; print('OK')"`, { timeout: 15000 }, (error, stdout) => {
          // Check if import succeeded by looking for our OK marker
          resolve(stdout && stdout.includes('OK'));
        });
      });
      
      if (works) {
        this.pythonCmd = cmd;
        console.log(`[AeneasService] Using Python command: ${cmd}`);
        return cmd;
      }
    }
    
    // Fallback
    return 'py -3.9';
  }

  /**
   * Extract text and ID mappings from XHTML content
   * 
   * CRITICAL FIX: Filters out unspoken content (TOC, headers, etc.) to prevent sync drift
   * 
   * ISSUE #5 FIX: Improved ID pattern matching to support multiple formats
   * Supports:
   * - New format: page1_p1_s1, page1_p1_s1_w1
   * - Legacy format: p1_s1, p1_s1_w1
   * - Alternative formats: p1, paragraph1, sentence1, word1
   * 
   * @param {string} xhtmlContent - The XHTML content to parse
   * @param {string} granularity - Level of extraction: 'word', 'sentence', or 'paragraph'
   * @param {Object} options - Additional options
   * @param {Array<string>} options.excludeIds - Array of IDs to exclude from sync
   * @param {Array<string>} options.excludePatterns - Array of regex patterns to exclude
   * @returns {Object} { textLines: string[], idMap: Array<{id, text, type, order}> }
   */
  extractTextFragments(xhtmlContent, granularity = 'sentence', options = {}) {
    const { excludeIds = [], excludePatterns = [] } = options;
    
    const dom = new JSDOM(xhtmlContent);
    const doc = dom.window.document;

    const textLines = [];
    const idMap = [];

    // CRITICAL FIX: Default exclusion patterns for unspoken content
    const defaultExcludePatterns = [
      /toc/i,                    // Table of Contents
      /table-of-contents/i,      // Table of Contents (hyphenated)
      /contents/i,                // Contents page
      /chapter-index/i,          // Chapter index
      /chapter-idx/i,            // Chapter index (abbreviated)
      /^nav/i,                    // Navigation elements
      /^header/i,                 // Headers
      /^footer/i,                 // Footers
      /^sidebar/i,                // Sidebars
      /^menu/i,                   // Menus
      /page-number/i,            // Page numbers
      /page-num/i,                // Page numbers (abbreviated)
      /^skip/i,                   // Skip links
      /^metadata/i                // Metadata
    ];
    
    // Combine default and user-provided exclusion patterns
    const allExcludePatterns = [...defaultExcludePatterns, ...excludePatterns];

    // Helper function to check if an element should be excluded
    const shouldExclude = (id, text) => {
      if (!id) return true; // Exclude elements without IDs
      
      // Check against explicit exclusion list
      if (excludeIds.includes(id)) {
        return true;
      }
      
      // Check against exclusion patterns
      for (const pattern of allExcludePatterns) {
        if (pattern.test(id) || pattern.test(text)) {
          return true;
        }
      }
      
      // Check for data-should-sync="false" attribute
      const element = doc.getElementById(id);
      if (element && element.getAttribute('data-should-sync') === 'false') {
        return true;
      }
      
      // Check for data-read-aloud="false" attribute (explicit exclusion)
      if (element && element.getAttribute('data-read-aloud') === 'false') {
        return true;
      }
      
      return false;
    };

    // ISSUE #5 FIX: Multiple strategies to find syncable elements
    // Strategy 1: data-read-aloud="true" attribute
    let readAloudElements = doc.querySelectorAll('[data-read-aloud="true"]');
    
    // Strategy 2: If no data-read-aloud, try ID patterns
    if (readAloudElements.length === 0) {
      // Try to find elements with known ID patterns
      const idPatterns = [
        '[id*="_w"]', // Words
        '[id*="_s"]', // Sentences
        '[id*="p"]', // Paragraphs
        '[id^="page"]', // Page-prefixed IDs
        '.sync-word', // CSS classes
        '.sync-sentence',
        '.sync-paragraph'
      ];
      
      for (const pattern of idPatterns) {
        const elements = doc.querySelectorAll(pattern);
        if (elements.length > 0) {
          readAloudElements = elements;
          console.log(`[AeneasService] Found ${elements.length} elements using pattern: ${pattern}`);
          break;
        }
      }
    }

    let excludedCount = 0;
    
    readAloudElements.forEach((el, index) => {
      const id = el.getAttribute('id');
      if (!id) return;

      const text = el.textContent?.trim() || '';
      if (!text) return;

      // CRITICAL FIX: Exclude unspoken content (TOC, headers, etc.)
      if (shouldExclude(id, text)) {
        excludedCount++;
        console.log(`[AeneasService] Excluding unspoken content: ${id} (${text.substring(0, 30)}...)`);
        return; // Skip this element
      }

      // ISSUE #5 FIX: Improved type detection with multiple patterns
      let type = 'paragraph';
      
      // Check for word pattern (most specific first)
      if (id.includes('_w') || id.match(/w\d+$/i) || el.classList.contains('sync-word')) {
        type = 'word';
      } 
      // Check for sentence pattern
      else if (id.includes('_s') || id.match(/s\d+$/i) || el.classList.contains('sync-sentence')) {
        type = 'sentence';
      }
      // Check for paragraph pattern
      else if (id.match(/^p\d+/i) || id.match(/paragraph/i) || el.classList.contains('sync-paragraph')) {
        type = 'paragraph';
      }

      // Filter based on granularity
      if (granularity === 'word' && type !== 'word') return;
      if (granularity === 'sentence' && (type === 'word' || type === 'paragraph')) return;
      if (granularity === 'paragraph' && type !== 'paragraph') return;

      textLines.push(text);
      idMap.push({
        id,
        text,
        type,
        order: index
      });
    });

    if (excludedCount > 0) {
      console.log(`[AeneasService] Excluded ${excludedCount} unspoken elements (TOC, headers, etc.)`);
    }

    if (textLines.length === 0) {
      console.warn(`[AeneasService] No ${granularity}-level elements found in XHTML. Check ID patterns.`);
    } else {
      console.log(`[AeneasService] Extracted ${textLines.length} syncable ${granularity} segments (excluded ${excludedCount} unspoken)`);
    }

    return { textLines, idMap };
  }

  /**
   * Create a plain text file for Aeneas input
   * Each line = one segment to align
   * 
   * IMPORTANT: Must NOT include BOM (Byte Order Mark) as Aeneas/espeak can't handle it!
   * 
   * @param {string[]} textLines - Array of text segments
   * @param {string} outputPath - Path to write the text file
   */
  async createTextFile(textLines, outputPath) {
    // Ensure temp directory exists before writing
    await fs.mkdir(this.tempDir, { recursive: true });
    
    // Aeneas works best with one segment per line
    // Strip any BOM characters that might exist in the text
    const content = textLines
      .map(line => line.replace(/^\ufeff/, '').trim())  // Remove BOM from each line
      .join('\n')
      .replace(/^\ufeff/, '');  // Remove BOM from start of file
    
    // Write without BOM (Node.js utf8 doesn't add BOM by default)
    await fs.writeFile(outputPath, content, { encoding: 'utf8' });
    
    // Verify file was created
    try {
      const stats = await fs.stat(outputPath);
      console.log(`[AeneasService] Created text file with ${textLines.length} segments (${stats.size} bytes)`);
    } catch (e) {
      console.error(`[AeneasService] Failed to verify text file: ${e.message}`);
    }
    
    return outputPath;
  }

  /**
   * Execute Aeneas forced alignment
   * 
   * Aeneas Configuration Parameters:
   * - task_language: Language code (eng, fra, deu, etc.)
   * - is_text_type: plain, parsed, unparsed, mplain, munparsed
   * - os_task_file_format: json, smil, srt, txt, xml
   * 
   * @param {string} audioPath - Path to audio file (MP3, WAV, etc.)
   * @param {string} textPath - Path to text file
   * @param {string} outputPath - Path to write JSON output
   * @param {Object} options - Additional configuration
   * @returns {Promise<Object[]>} Array of aligned fragments
   */
  async executeAlignment(audioPath, textPath, outputPath, options = {}) {
    const {
      language = 'eng',
      textType = 'plain',
      outputFormat = 'json'
    } = options;

    const pythonCmd = await this.getPythonCommand();

    // Build Aeneas configuration string
    const config = [
      `task_language=${language}`,
      `is_text_type=${textType}`,
      `os_task_file_format=${outputFormat}`
    ].join('|');

    // Build the command
    const cmd = `${pythonCmd} -m aeneas.tools.execute_task "${audioPath}" "${textPath}" "${config}" "${outputPath}"`;

    console.log(`[AeneasService] Executing: ${cmd}`);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      // Set UTF-8 encoding and espeak-ng PATH for Aeneas (Windows fix)
      const espeakPath = 'C:\\Program Files\\eSpeak NG';
      const currentPath = process.env.PATH || process.env.Path || '';
      
      const execOptions = { 
        maxBuffer: 50 * 1024 * 1024,
        env: { 
          ...process.env, 
          PATH: `${espeakPath};${currentPath}`,
          Path: `${espeakPath};${currentPath}`,
          PYTHONIOENCODING: 'UTF-8',
          PYTHONUTF8: '1'
        }
      };

      exec(cmd, execOptions, async (error, stdout, stderr) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[AeneasService] Alignment completed in ${elapsed}s`);

        if (stderr) {
          // ISSUE #4 FIX: Log stderr but don't fail on warnings
          const stderrLower = stderr.toLowerCase();
          if (stderrLower.includes('error') || stderrLower.includes('failed')) {
            console.error('[AeneasService] stderr (error):', stderr);
          } else {
            console.log('[AeneasService] stderr (info):', stderr);
          }
        }

        if (error) {
          // ISSUE #4 FIX: Better error messages with actionable guidance
          console.error('[AeneasService] Aeneas execution failed:', error.message);
          console.error('[AeneasService] stderr:', stderr);
          
          // Check for common issues
          let errorMessage = `Aeneas alignment failed: ${stderr || error.message}`;
          
          if (stderr && stderr.includes('espeak')) {
            errorMessage += '\n\nPossible fix: Ensure eSpeak NG is installed at C:\\Program Files\\eSpeak NG';
          } else if (stderr && stderr.includes('ffmpeg')) {
            errorMessage += '\n\nPossible fix: Ensure FFmpeg is installed and in PATH';
          } else if (stderr && stderr.includes('python')) {
            errorMessage += '\n\nPossible fix: Ensure Python 3.9+ is installed and aeneas is installed (pip install aeneas)';
          }
          
          return reject(new Error(errorMessage));
        }

        try {
          const resultContent = await fs.readFile(outputPath, 'utf8');
          const result = JSON.parse(resultContent);
          resolve(result.fragments || []);
        } catch (parseErr) {
          reject(new Error(`Failed to parse Aeneas output: ${parseErr.message}`));
        }
      });
    });
  }

  /**
   * Map Aeneas alignment results back to original IDs
   * 
   * Aeneas returns fragments in order, so we map them back to our idMap
   * 
   * @param {Object[]} fragments - Aeneas output fragments
   * @param {Object[]} idMap - Original ID mappings
   * @returns {Object[]} Mapped results with IDs and timestamps
   */
  mapFragmentsToIds(fragments, idMap) {
    const results = [];

    for (let i = 0; i < fragments.length && i < idMap.length; i++) {
      const fragment = fragments[i];
      const mapping = idMap[i];

      results.push({
        id: mapping.id,
        text: mapping.text,
        type: mapping.type,
        startTime: parseFloat(fragment.begin),
        endTime: parseFloat(fragment.end),
        // Duration in milliseconds
        duration: (parseFloat(fragment.end) - parseFloat(fragment.begin)) * 1000
      });
    }

    return results;
  }

  /**
   * Auto-propagate word timings from sentence timings
   * 
   * ISSUE #3 FIX: Improved word timing with padding and better character weighting
   * - Adds small buffer between words to account for natural pauses
   * - Uses weighted character count (shorter words get minimum duration)
   * - Accounts for punctuation pauses
   * 
   * @param {Object[]} sentenceResults - Sentence-level alignment results
   * @param {string} xhtmlContent - Original XHTML to find word elements
   * @returns {Object[]} Word-level timings
   */
  propagateWordTimings(sentenceResults, xhtmlContent) {
    const dom = new JSDOM(xhtmlContent);
    const doc = dom.window.document;

    const wordResults = [];
    
    // ISSUE #3 FIX: Configuration for word timing
    const MIN_WORD_DURATION = 0.15; // Minimum 150ms per word
    const WORD_PADDING = 0.05; // 50ms padding between words
    const PUNCTUATION_PAUSE = 0.1; // 100ms pause after punctuation

    for (const sentence of sentenceResults) {
      const sentenceEl = doc.getElementById(sentence.id);
      if (!sentenceEl) continue;

      // Find word elements within this sentence
      const wordElements = sentenceEl.querySelectorAll('.sync-word, [id*="_w"]');
      if (wordElements.length === 0) continue;

      // ISSUE #3 FIX: Calculate weighted character count
      // Shorter words (like "a", "the") get a minimum weight to prevent them from being too fast
      const words = Array.from(wordElements).map(el => {
        const text = el.textContent?.trim() || '';
        const charCount = text.length;
        
        // Weight calculation: minimum weight for short words
        let weight = charCount;
        if (charCount <= 2) {
          weight = Math.max(charCount, 1.5); // Minimum weight for very short words
        } else if (charCount <= 4) {
          weight = charCount * 1.2; // Slight boost for medium words
        }
        
        // Check for punctuation (adds pause time)
        const hasPunctuation = /[.,!?;:]/.test(text);
        
        return {
          id: el.getAttribute('id'),
          text: text,
          charCount: charCount,
          weight: weight,
          hasPunctuation: hasPunctuation
        };
      });

      const totalWeight = words.reduce((sum, w) => sum + w.weight, 0);
      if (totalWeight === 0) continue;

      const sentenceDuration = sentence.endTime - sentence.startTime;
      
      // ISSUE #3 FIX: Reserve time for padding and punctuation pauses
      const totalPadding = (words.length - 1) * WORD_PADDING;
      const punctuationPauses = words.filter(w => w.hasPunctuation).length * PUNCTUATION_PAUSE;
      const usableDuration = sentenceDuration - totalPadding - punctuationPauses;
      
      if (usableDuration <= 0) {
        // Fallback: if padding would exceed duration, use original method
        let currentTime = sentence.startTime;
        for (const word of words) {
          const ratio = word.charCount / words.reduce((sum, w) => sum + w.charCount, 0);
          const wordDuration = Math.max(sentenceDuration * ratio, MIN_WORD_DURATION);
          const wordEnd = currentTime + wordDuration;
          
          wordResults.push({
            id: word.id,
            parentId: sentence.id,
            text: word.text,
            type: 'word',
            startTime: parseFloat(currentTime.toFixed(3)),
            endTime: parseFloat(wordEnd.toFixed(3)),
            duration: wordDuration * 1000
          });
          
          currentTime = wordEnd;
        }
        continue;
      }
      
      let currentTime = sentence.startTime;

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const ratio = word.weight / totalWeight;
        const wordDuration = Math.max(usableDuration * ratio, MIN_WORD_DURATION);
        const wordEnd = currentTime + wordDuration;

        wordResults.push({
          id: word.id,
          parentId: sentence.id,
          text: word.text,
          type: 'word',
          startTime: parseFloat(currentTime.toFixed(3)),
          endTime: parseFloat(wordEnd.toFixed(3)),
          duration: wordDuration * 1000
        });

        // ISSUE #3 FIX: Add padding after word (except last word)
        if (i < words.length - 1) {
          currentTime = wordEnd + WORD_PADDING;
          // Add extra pause for punctuation
          if (word.hasPunctuation) {
            currentTime += PUNCTUATION_PAUSE;
          }
        } else {
          currentTime = wordEnd;
        }
      }
    }

    return wordResults;
  }

  /**
   * ISSUE #1 FIX: Normalize audio to CBR WAV format
   * 
   * Converts VBR MP3 (like ElevenLabs) to CBR WAV to fix HTML5 audio timing drift
   * 
   * @param {string} inputPath - Path to input audio file
   * @param {string} outputPath - Path to output normalized WAV file
   * @returns {Promise<string>} Path to normalized audio file
   */
  async normalizeAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      // Convert to CBR WAV: PCM 16-bit, mono, 16kHz (optimal for Aeneas)
      // This fixes VBR timing issues in HTML5 audio
      const cmd = `ffmpeg -i "${inputPath}" -codec:a pcm_s16le -ac 1 -ar 16000 -y "${outputPath}"`;
      
      console.log(`[AeneasService] Normalizing audio: ${inputPath} -> ${outputPath}`);
      
      exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.error('[AeneasService] Audio normalization failed:', error.message);
          // If normalization fails, use original file (better than crashing)
          console.warn('[AeneasService] Using original audio file (may have timing drift)');
          resolve(inputPath);
          return;
        }
        
        console.log('[AeneasService] Audio normalized successfully');
        resolve(outputPath);
      });
    });
  }

  /**
   * Main Auto-Sync function
   * 
   * This is the "Kitaboo-style" forced alignment pipeline:
   * 1. Normalize audio (VBR -> CBR WAV) - ISSUE #1 FIX
   * 2. Extract text from XHTML
   * 3. Run Aeneas alignment
   * 4. Map results to IDs
   * 5. Optionally propagate word timings
   * 6. Detect and account for ElevenLabs pauses - ISSUE #2 FIX
   * 
   * @param {string} audioPath - Path to audio file
   * @param {string} xhtmlContent - XHTML content to sync
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} { sentences: [...], words: [...] }
   */
  async autoSync(audioPath, xhtmlContent, options = {}) {
    const {
      language = 'eng',
      granularity = 'sentence',
      propagateWords = true,
      jobId = null
    } = options;

    const sessionId = uuidv4().slice(0, 8);
    const textPath = path.join(this.tempDir, `text_${sessionId}.txt`);
    const outputPath = path.join(this.tempDir, `output_${sessionId}.json`);
    
    // ISSUE #1 FIX: Normalize audio to CBR WAV before processing
    const normalizedAudioPath = path.join(this.tempDir, `normalized_${sessionId}.wav`);
    let processedAudioPath = audioPath;
    
    try {
      // Check if audio needs normalization (MP3, M4A, etc.)
      const audioExt = path.extname(audioPath).toLowerCase();
      if (audioExt !== '.wav') {
        processedAudioPath = await this.normalizeAudio(audioPath, normalizedAudioPath);
      } else {
        console.log('[AeneasService] Audio is already WAV format, skipping normalization');
      }
    } catch (normalizeError) {
      console.warn('[AeneasService] Audio normalization failed, using original:', normalizeError.message);
      processedAudioPath = audioPath;
    }

    console.log(`[AeneasService] Starting auto-sync for job ${jobId}`);
    console.log(`[AeneasService] Audio: ${processedAudioPath}`);
    console.log(`[AeneasService] Granularity: ${granularity}`);

    try {
      // 1. Extract text fragments (with exclusion support)
      const { textLines, idMap } = this.extractTextFragments(xhtmlContent, granularity, {
        excludeIds: options.excludeIds || [],
        excludePatterns: options.excludePatterns || []
      });
      
      if (textLines.length === 0) {
        throw new Error('No syncable text elements found in XHTML. All content may be excluded (TOC, headers, etc.)');
      }

      console.log(`[AeneasService] Extracted ${textLines.length} ${granularity} segments`);

      // 2. Create text file for Aeneas
      await this.createTextFile(textLines, textPath);

      // 3. Execute Aeneas alignment (using normalized audio)
      const fragments = await this.executeAlignment(processedAudioPath, textPath, outputPath, {
        language,
        textType: 'plain',
        outputFormat: 'json'
      });

      console.log(`[AeneasService] Aeneas returned ${fragments.length} fragments`);

      // 4. Map results to original IDs
      const mappedResults = this.mapFragmentsToIds(fragments, idMap);

      // 5. Separate into sentences and words
      const sentences = mappedResults.filter(r => r.type !== 'word');
      let words = mappedResults.filter(r => r.type === 'word');

      // 6. Auto-propagate word timings if requested
      if (propagateWords && granularity === 'sentence' && sentences.length > 0) {
        const propagatedWords = this.propagateWordTimings(sentences, xhtmlContent);
        words = propagatedWords;
        console.log(`[AeneasService] Propagated ${words.length} word timings`);
      }

      // ISSUE #2 FIX: Apply zero-crossing refinement if requested
      // (Optional - can be enabled via options)
      if (options.refineWithZeroCrossing !== false) {
        try {
          const refined = await this.refineWithZeroCrossing(
            { sentences, words, stats: {} },
            processedAudioPath, // Use normalized audio
            options.zeroCrossingWindow || 200
          );
          return {
            sentences: refined.sentences,
            words: refined.words,
            stats: {
              totalSentences: refined.sentences.length,
              totalWords: refined.words.length,
              totalDuration: sentences.length > 0 
                ? sentences[sentences.length - 1].endTime - sentences[0].startTime 
                : 0,
              refined: true
            }
          };
        } catch (refineError) {
          console.warn('[AeneasService] Zero-crossing refinement failed, using original results:', refineError.message);
          // Continue with unrefined results
        }
      }

      // ISSUE #2 FIX: Detect and account for ElevenLabs pause artifacts
      // Professional TTS voices often have 150-300ms pre-roll silence
      const adjustedSentences = await this.adjustForElevenLabsPauses(
        sentences,
        processedAudioPath,
        options.detectPauses !== false // Enable by default
      );
      
      // Use adjusted sentences if pauses were detected
      const finalSentences = adjustedSentences.length > 0 ? adjustedSentences : sentences;

      // Cleanup temp files
      try {
        await fs.unlink(textPath);
        await fs.unlink(outputPath);
        // Cleanup normalized audio if it was created
        if (processedAudioPath !== audioPath && processedAudioPath === normalizedAudioPath) {
          await fs.unlink(normalizedAudioPath).catch(() => {});
        }
      } catch (cleanupErr) {
        console.warn('[AeneasService] Cleanup warning:', cleanupErr.message);
      }

      console.log(`[AeneasService] Auto-sync complete: ${finalSentences.length} sentences, ${words.length} words`);

      return {
        sentences: finalSentences,
        words,
        stats: {
          totalSentences: finalSentences.length,
          totalWords: words.length,
          totalDuration: finalSentences.length > 0 
            ? finalSentences[finalSentences.length - 1].endTime - finalSentences[0].startTime 
            : 0
        }
      };

      console.log(`[AeneasService] Auto-sync complete: ${finalSentences.length} sentences, ${words.length} words`);

      return {
        sentences: finalSentences,
        words,
        stats: {
          totalSentences: finalSentences.length,
          totalWords: words.length,
          totalDuration: finalSentences.length > 0 
            ? finalSentences[finalSentences.length - 1].endTime - finalSentences[0].startTime 
            : 0
        }
      };

    } catch (error) {
      console.error('[AeneasService] Auto-sync failed:', error);
      
      // Cleanup on error
      try {
        await fs.unlink(textPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
      } catch (e) {}

      throw error;
    }
  }

  /**
   * Batch process multiple pages
   * 
   * This is the "300-page book in 15 minutes" feature
   * 
   * @param {string} audioPath - Path to combined audio file
   * @param {Object[]} pages - Array of { pageNumber, xhtmlContent }
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} Combined results for all pages
   */
  async batchAutoSync(audioPath, pages, options = {}) {
    console.log(`[AeneasService] Starting batch auto-sync for ${pages.length} pages`);

    // Combine all XHTML into one document for alignment
    const combinedXhtml = pages
      .map(p => p.xhtmlContent)
      .join('\n<!-- PAGE_BREAK -->\n');

    const result = await this.autoSync(audioPath, combinedXhtml, options);

    // Split results back into pages
    const pageResults = {};
    
    for (const sentence of result.sentences) {
      // Determine page from ID pattern
      // Supports both: "page1_p1_s1" (new) and "p1_s1" (legacy)
      let pageNumber = 1;
      const newPageMatch = sentence.id.match(/^page(\d+)_/);
      const legacyPageMatch = sentence.id.match(/^p(\d+)/);
      if (newPageMatch) {
        pageNumber = parseInt(newPageMatch[1]);
      } else if (legacyPageMatch) {
        pageNumber = parseInt(legacyPageMatch[1]);
      }
      
      if (!pageResults[pageNumber]) {
        pageResults[pageNumber] = { sentences: [], words: [] };
      }
      pageResults[pageNumber].sentences.push(sentence);
    }

    for (const word of result.words) {
      // Determine page from ID pattern (supports both new and legacy formats)
      let pageNumber = 1;
      const newPageMatch = word.id.match(/^page(\d+)_/);
      const legacyPageMatch = word.id.match(/^p(\d+)/);
      if (newPageMatch) {
        pageNumber = parseInt(newPageMatch[1]);
      } else if (legacyPageMatch) {
        pageNumber = parseInt(legacyPageMatch[1]);
      }
      
      if (!pageResults[pageNumber]) {
        pageResults[pageNumber] = { sentences: [], words: [] };
      }
      pageResults[pageNumber].words.push(word);
    }

    return {
      pages: pageResults,
      stats: result.stats
    };
  }

  /**
   * Fallback: Semi-automated "Linear Spread" sync
   * 
   * ISSUE #1 FIX: Improved linear spread with better warnings and pause detection
   * CRITICAL FIX: Respects exclusion list to prevent syncing unspoken content
   * 
   * If Aeneas is not available, this uses a simpler algorithm:
   * 1. User provides start and end timestamps
   * 2. System spreads timestamps based on character count with pause detection
   * 3. Excludes unspoken content (TOC, headers, etc.) to prevent sync drift
   * 
   * WARNING: This method is less accurate than Aeneas and may drift out of sync
   * if the audio has long silences or varying reading speeds.
   * 
   * @param {string} xhtmlContent - XHTML content
   * @param {number} startTime - Start timestamp in seconds
   * @param {number} endTime - End timestamp in seconds
   * @param {Object} options - Configuration options
   * @param {Array<string>} options.excludeIds - Array of IDs to exclude from sync
   * @returns {Object} { sentences: [...], words: [...] }
   */
  linearSpreadSync(xhtmlContent, startTime, endTime, options = {}) {
    const { granularity = 'sentence', propagateWords = true, excludeIds = [] } = options;

    // ISSUE #1 FIX: Log warning about linear spread limitations
    console.warn('[AeneasService] ⚠️  Using LINEAR SPREAD fallback (less accurate than Aeneas)');
    console.warn('[AeneasService] ⚠️  Linear spread does not account for:');
    console.warn('[AeneasService]    - Natural pauses in speech');
    console.warn('[AeneasService]    - Varying reading speeds');
    console.warn('[AeneasService]    - Audio intro/outro silences');
    console.warn('[AeneasService]    - Emphasis and prosody');
    console.warn('[AeneasService] ⚠️  For best results, install Aeneas: pip install aeneas');

    // CRITICAL FIX: Extract fragments with exclusion support
    const { textLines, idMap } = this.extractTextFragments(xhtmlContent, granularity, {
      excludeIds: excludeIds,
      excludePatterns: [] // Use default patterns from extractTextFragments
    });

    if (textLines.length === 0) {
      console.error('[AeneasService] No text fragments found for linear spread');
      return { sentences: [], words: [] };
    }

    // ISSUE #1 FIX: Improved character-based calculation with pause detection
    // Account for punctuation (adds natural pauses)
    const totalChars = textLines.reduce((sum, line, idx) => {
      const text = line;
      const punctuationCount = (text.match(/[.,!?;:]/g) || []).length;
      // Punctuation adds "weight" to account for pauses
      return sum + text.length + (punctuationCount * 2);
    }, 0);
    
    const totalDuration = endTime - startTime;
    
    // ISSUE #1 FIX: Reserve time for pauses (5% of total duration)
    const pauseReserve = totalDuration * 0.05;
    const usableDuration = totalDuration - pauseReserve;
    
    if (usableDuration <= 0) {
      console.error('[AeneasService] Invalid duration for linear spread');
      return { sentences: [], words: [] };
    }

    let currentTime = startTime;
    const sentences = [];

    for (let i = 0; i < idMap.length; i++) {
      const mapping = idMap[i];
      const text = mapping.text;
      const punctuationCount = (text.match(/[.,!?;:]/g) || []).length;
      
      // ISSUE #1 FIX: Weighted character ratio (punctuation adds weight)
      const weightedChars = text.length + (punctuationCount * 2);
      const charRatio = weightedChars / totalChars;
      const segmentDuration = usableDuration * charRatio;
      
      // ISSUE #1 FIX: Minimum duration per segment (prevents too-short segments)
      const minDuration = 0.3; // 300ms minimum
      const actualDuration = Math.max(segmentDuration, minDuration);
      
      const segmentEnd = currentTime + actualDuration;

      sentences.push({
        id: mapping.id,
        text: mapping.text,
        type: mapping.type,
        startTime: parseFloat(currentTime.toFixed(3)),
        endTime: parseFloat(segmentEnd.toFixed(3)),
        duration: actualDuration * 1000
      });

      // ISSUE #1 FIX: Add small pause after segment (except last)
      if (i < idMap.length - 1) {
        const pauseTime = punctuationCount > 0 ? 0.15 : 0.05; // Longer pause after punctuation
        currentTime = segmentEnd + pauseTime;
      } else {
        currentTime = segmentEnd;
      }
    }

    // Propagate words if requested
    let words = [];
    if (propagateWords) {
      words = this.propagateWordTimings(sentences, xhtmlContent);
    }

    console.log(`[AeneasService] Linear spread: ${sentences.length} sentences, ${words.length} words`);
    console.warn('[AeneasService] ⚠️  Linear spread results may require manual adjustment');

    return {
      sentences,
      words,
      stats: {
        totalSentences: sentences.length,
        totalWords: words.length,
        totalDuration,
        method: 'linear_spread',
        warning: 'Results may be less accurate than Aeneas forced alignment'
      }
    };
  }

  /**
   * Zero-crossing snap refinement
   * 
   * ISSUE #2 FIX: Implement actual audio analysis using ffprobe
   * Detects silence gaps in audio and snaps timestamps to nearest silence
   * 
   * @param {Object} syncResults - Results from autoSync or linearSpread
   * @param {string} audioPath - Path to audio file
   * @param {number} windowMs - Search window in milliseconds (default 200ms)
   * @returns {Promise<Object>} Refined sync results
   */
  async refineWithZeroCrossing(syncResults, audioPath, windowMs = 200) {
    console.log('[AeneasService] Starting zero-crossing refinement...');
    
    try {
      // Use ffprobe to detect silence in audio
      // ffprobe -f lavfi -i "amovie=audio.mp3,astats=metadata=1:reset=1" -show_entries frame=pkt_pts_time:frame_tags=lavfi.astats.Overall.RMS_level -of json
      // This detects RMS (Root Mean Square) levels - low RMS = silence
      
      const silenceThreshold = -40; // dB threshold for silence (adjustable)
      const minSilenceDuration = 0.05; // Minimum 50ms of silence to count
      
      // Get silence periods using ffprobe
      const silencePeriods = await this.detectSilencePeriods(audioPath, silenceThreshold, minSilenceDuration);
      
      if (silencePeriods.length === 0) {
        console.log('[AeneasService] No silence periods detected, skipping refinement');
        return syncResults;
      }
      
      console.log(`[AeneasService] Found ${silencePeriods.length} silence periods`);
      
      // Refine sentence timings
      const refinedSentences = syncResults.sentences.map(sentence => {
        const refined = this.snapToNearestSilence(
          sentence.startTime,
          sentence.endTime,
          silencePeriods,
          windowMs / 1000 // Convert to seconds
        );
        
        return {
          ...sentence,
          startTime: refined.startTime,
          endTime: refined.endTime
        };
      });
      
      // Refine word timings
      const refinedWords = syncResults.words.map(word => {
        const refined = this.snapToNearestSilence(
          word.startTime,
          word.endTime,
          silencePeriods,
          windowMs / 1000
        );
        
        return {
          ...word,
          startTime: refined.startTime,
          endTime: refined.endTime
        };
      });
      
      console.log(`[AeneasService] Refined ${refinedSentences.length} sentences and ${refinedWords.length} words`);
      
      return {
        sentences: refinedSentences,
        words: refinedWords,
        stats: syncResults.stats
      };
      
    } catch (error) {
      console.error('[AeneasService] Zero-crossing refinement failed:', error.message);
      console.log('[AeneasService] Returning unrefined results');
      // Return original results if refinement fails
      return syncResults;
    }
  }
  
  /**
   * ISSUE #2 FIX: Detect silence periods in audio using ffprobe
   * 
   * @param {string} audioPath - Path to audio file
   * @param {number} threshold - RMS threshold in dB (negative value, e.g., -40)
   * @param {number} minDuration - Minimum silence duration in seconds
   * @returns {Promise<Array>} Array of { start, end } silence periods
   */
  async detectSilencePeriods(audioPath, threshold = -40, minDuration = 0.05) {
    return new Promise((resolve, reject) => {
      // Use ffmpeg's silencedetect filter
      // ffmpeg -i audio.mp3 -af silencedetect=noise=-40dB:duration=0.05 -f null -
      const cmd = `ffmpeg -i "${audioPath}" -af silencedetect=noise=${threshold}dB:duration=${minDuration} -f null - 2>&1`;
      
      exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && !stderr.includes('silence_start') && !stderr.includes('silence_end')) {
          console.warn('[AeneasService] FFmpeg silence detection warning:', error.message);
        }
        
        const output = (stdout || '') + (stderr || '');
        const silencePeriods = [];
        
        // Parse ffmpeg silencedetect output
        // Format: silence_start: 1.234 | silence_end: 2.345 | silence_duration: 1.111
        const silenceStartRegex = /silence_start:\s*([\d.]+)/g;
        const silenceEndRegex = /silence_end:\s*([\d.]+)/g;
        
        const starts = [];
        const ends = [];
        
        let match;
        while ((match = silenceStartRegex.exec(output)) !== null) {
          starts.push(parseFloat(match[1]));
        }
        while ((match = silenceEndRegex.exec(output)) !== null) {
          ends.push(parseFloat(match[1]));
        }
        
        // Pair up start and end times
        for (let i = 0; i < starts.length; i++) {
          const end = ends[i] || starts[i] + minDuration; // Fallback if end not found
          silencePeriods.push({
            start: starts[i],
            end: end
          });
        }
        
        resolve(silencePeriods);
      });
    });
  }
  
  /**
   * ISSUE #2 FIX: Snap timestamp to nearest silence period
   * 
   * @param {number} startTime - Original start time
   * @param {number} endTime - Original end time
   * @param {Array} silencePeriods - Array of { start, end } silence periods
   * @param {number} window - Search window in seconds
   * @returns {Object} { startTime, endTime } refined timestamps
   */
  snapToNearestSilence(startTime, endTime, silencePeriods, window = 0.2) {
    let refinedStart = startTime;
    let refinedEnd = endTime;
    
    // Find nearest silence before start time
    const beforeStart = silencePeriods
      .filter(s => s.end <= startTime && s.end >= startTime - window)
      .sort((a, b) => Math.abs(startTime - b.end) - Math.abs(startTime - a.end));
    
    if (beforeStart.length > 0) {
      // Snap to end of silence period (start of speech)
      refinedStart = beforeStart[0].end;
    }
    
    // Find nearest silence after end time
    const afterEnd = silencePeriods
      .filter(s => s.start >= endTime && s.start <= endTime + window)
      .sort((a, b) => Math.abs(a.start - endTime) - Math.abs(b.start - endTime));
    
    if (afterEnd.length > 0) {
      // Snap to start of silence period (end of speech)
      refinedEnd = afterEnd[0].start;
    }
    
    // Ensure endTime > startTime
    if (refinedEnd <= refinedStart) {
      refinedEnd = refinedStart + 0.1; // Minimum 100ms duration
    }
    
    return {
      startTime: parseFloat(refinedStart.toFixed(3)),
      endTime: parseFloat(refinedEnd.toFixed(3))
    };
  }
}

// Export singleton instance
const aeneasService = new AeneasService();

export {
  AeneasService,
  aeneasService
};

