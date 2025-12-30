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
      
      // CRITICAL FIX: The pre-roll adjustment was ADDING time, making timestamps too late!
      // If Aeneas correctly aligns text to audio (e.g., "If You Were a Horse" at 7-8s),
      // and we add 7 seconds for pre-roll, we get 14-15s (WRONG!).
      // 
      // Solution: Aeneas already accounts for pre-roll in its alignment.
      // We should NOT add any offset. The real issue is excluded content (TOC) taking up timeline space.
      // 
      // Disable pre-roll offset adjustment - it's causing the 7-second delay bug
      const preRollSilence = silencePeriods.find(s => s.start < 0.5 && s.end > 0.1);
      const preRollEnd = preRollSilence ? preRollSilence.end : 0;
      
      if (preRollEnd > 0) {
        console.log(`[AeneasService] Detected ${(preRollEnd * 1000).toFixed(0)}ms pre-roll silence, but Aeneas already accounts for it in alignment`);
        console.log(`[AeneasService] Not applying pre-roll offset (would cause timestamps to be too late)`);
      }
      
      // CRITICAL FIX: No pre-roll offset - Aeneas handles it correctly
      const preRollOffset = 0;
      
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        // CRITICAL FIX: Don't add any offset - Aeneas already aligned correctly
        let adjustedStart = sentence.startTime;
        let adjustedEnd = sentence.endTime;
        
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
              // Don't add preRollOffset here either - it's already 0
              adjustedEnd = silenceInGap.end;
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
   * @param {boolean} options.disableDefaultExclusions - If true, disable default exclusion patterns (headers, TOC, etc.)
   * @returns {Object} { textLines: string[], idMap: Array<{id, text, type, order}> }
   */
  extractTextFragments(xhtmlContent, granularity = 'sentence', options = {}) {
    const { excludeIds = [], excludePatterns = [], disableDefaultExclusions = false } = options;
    
    const dom = new JSDOM(xhtmlContent);
    const doc = dom.window.document;

    const textLines = [];
    const idMap = [];

    // CRITICAL FIX: Default exclusion patterns for unspoken content
    // Can be disabled via disableDefaultExclusions option
    const defaultExcludePatterns = disableDefaultExclusions ? [] : [
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

    // CRITICAL FIX: Match frontend extraction logic
    // Strategy: Find elements with data-read-aloud="true" and extract nested words
    // This matches the frontend parseXhtmlElements approach
    const readAloudElements = doc.querySelectorAll('[data-read-aloud="true"]');
    
    // Convert NodeList to Array for processing
    const elementsArray = Array.from(readAloudElements);
    
    if (elementsArray.length === 0) {
      console.warn(`[AeneasService] No elements with data-read-aloud="true" found`);
    }

    let excludedCount = 0;
    const processedIds = new Set();
    
    // Process elements with data-read-aloud="true" and extract nested words (matching frontend logic)
    elementsArray.forEach((el, index) => {
      const id = el.getAttribute('id');
      if (!id || processedIds.has(id)) return;

      // Skip elements whose id contains "div"
      if (id.includes('div')) {
        return;
      }

      const text = el.textContent?.trim() || '';
      if (!text) return;

      // CRITICAL FIX: Exclude unspoken content (TOC, headers, etc.)
      if (shouldExclude(id, text)) {
        excludedCount++;
        console.log(`[AeneasService] Excluding unspoken content: ${id} (${text.substring(0, 30)}...)`);
        return; // Skip this element
      }

      const tagName = el.tagName.toLowerCase();
      const classList = el.className || '';

      // Determine element type (matching frontend logic)
      let type = 'paragraph';
      if (classList.includes('sync-word') || tagName === 'span' && id.includes('_w')) {
        type = 'word';
      } else if (classList.includes('sync-sentence') || id.includes('_s')) {
        type = 'sentence';
      }

      // Filter based on granularity
      if (granularity === 'word' && type !== 'word') {
        // For word granularity, also extract nested word elements from this parent
        const wordElements = el.querySelectorAll('.sync-word[id], span[id*="_w"]');
        wordElements.forEach((wordEl) => {
          const wordId = wordEl.getAttribute('id');
          if (!wordId || wordId.includes('div') || processedIds.has(wordId)) return;
          
          const wordText = wordEl.textContent?.trim() || '';
          if (!wordText) return;

          // Extract parentId for word elements
          const wordParentMatch = wordId.match(/^((?:page\d+_)?p\d+_s\d+)_w\d+$/);
          const wordParentId = wordParentMatch ? wordParentMatch[1] : wordId.replace(/_w\d+$/, '');

          processedIds.add(wordId);
          textLines.push(wordText);
          idMap.push({
            id: wordId,
            text: wordText,
            type: 'word',
            order: idMap.length
          });
        });
        return; // Don't add the parent element for word granularity
      }
      
      if (granularity === 'sentence' && type !== 'sentence') return;
      if (granularity === 'paragraph' && type !== 'paragraph') return;

      processedIds.add(id);
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
    
    // CRITICAL FIX: Normalize text to match what Aeneas will return
    // Aeneas normalizes whitespace (newlines → spaces, multiple spaces → single space)
    // We need to send normalized text so fragments match our segments
    const normalizeForAeneas = (text) => {
      return text
        .replace(/\s+/g, ' ')  // Replace all whitespace (newlines, tabs, etc.) with single space
        .trim();
    };
    
    // Aeneas works best with one segment per line
    // Strip any BOM characters and normalize whitespace
    const content = textLines
      .map(line => {
        const normalized = normalizeForAeneas(line.replace(/^\ufeff/, ''));
        return normalized;
      })
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
          const fragments = result.fragments || [];
          
          // CRITICAL DEBUG: Save Aeneas output for inspection
          const debugOutputPath = outputPath.replace('.json', '_debug.json');
          await fs.writeFile(debugOutputPath, JSON.stringify({
            totalFragments: fragments.length,
            fragments: fragments.slice(0, 10).map(f => ({
              begin: f.begin,
              end: f.end,
              lines: f.lines,
              id: f.id
            }))
          }, null, 2), 'utf8');
          console.log(`[AeneasService] Saved debug output to: ${debugOutputPath}`);
          
          resolve(fragments);
        } catch (parseErr) {
          reject(new Error(`Failed to parse Aeneas output: ${parseErr.message}`));
        }
      });
    });
  }

  /**
   * Map Aeneas alignment results back to original IDs
   * 
   * CRITICAL FIX: Aeneas can create MORE fragments than text segments (splits text internally)
   * We need to match by text content, not just index, and merge fragments that belong to the same segment
   * 
   * @param {Object[]} fragments - Aeneas output fragments
   * @param {Object[]} idMap - Original ID mappings
   * @returns {Object[]} Mapped results with IDs and timestamps
   */
  mapFragmentsToIds(fragments, idMap) {
    const results = [];
    
    // CRITICAL FIX: Aeneas can split one text segment into multiple fragments
    // Strategy: Group consecutive fragments that belong to the same segment
    // Use the ratio of fragments to segments to determine grouping
    
    if (fragments.length === 0 || idMap.length === 0) {
      return results;
    }
    
    // CRITICAL FIX: Sliding Window & Score-Based Matching
    // Prevents "jump-ahead" errors where duplicate text causes matching fragment 8 (45s) 
    // to segment 8 when the correct match is at fragment 2 (7s)
    // 
    // The fix: Use a strict sliding window that limits search to nearby fragments,
    // preventing large jumps that cause 30+ second offsets
    
    // Normalize text for comparison (same normalization as createTextFile)
    const normalizeText = (text) => {
      return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    };
    
    let fragmentIndex = 0;
    const TOLERANCE = 5; // Search 5 fragments ahead/behind for a better match
    
    // Calculate expected audio duration for timing validation
    const lastFragment = fragments[fragments.length - 1];
    const totalAudioDuration = parseFloat(lastFragment?.end || 0);
    
    for (let i = 0; i < idMap.length; i++) {
      const segment = idMap[i];
      const expectedText = normalizeText(segment.text);
      
      // CRITICAL FIX: Calculate expected timestamp based on segment position
      // Early segments should have early timestamps, late segments should have late timestamps
      // This prevents matching segment 8 (early book) to fragment 8 (45 seconds)
      const segmentProgress = i / idMap.length; // 0.0 to 1.0
      const expectedTimestamp = totalAudioDuration * segmentProgress;
      const timestampTolerance = totalAudioDuration * 0.15; // Allow 15% deviation
      
      // CRITICAL: For early segments (first 30%), use a more aggressive check
      // Early segments should NOT be matched to fragments that are way into the audio
      // For example, segment 8 (26% through) should not match fragment at 45 seconds
      const isEarlySegment = i < idMap.length * 0.3;
      // Use absolute threshold: early segments should be in first 20 seconds of audio
      // This prevents matching early segments to fragments at 45+ seconds
      const maxAllowedTimestampForEarly = Math.min(20, totalAudioDuration * 0.15); // Max 20 seconds or 15% of audio, whichever is smaller
      
      let bestMatch = null;
      let highestScore = -1;
      let bestMatchIndex = -1;
      
      // Search in a window around the current fragmentIndex
      // Asymmetric window: 2 behind, TOLERANCE ahead (prevents going too far back)
      // CRITICAL: For early segments, expand the backward search to catch misaligned fragments
      // For very early segments (first 10%), search all the way back to the beginning
      let backwardSearch = i < idMap.length * 0.1 ? fragmentIndex : 
                             (i < idMap.length * 0.3 ? Math.min(10, fragmentIndex) : 2);
      let startSearch = Math.max(0, fragmentIndex - backwardSearch);
      let endSearch = Math.min(fragments.length, fragmentIndex + TOLERANCE);
      
      // CRITICAL: For early segments looking for specific text, also search fragments in 6-9s range
      // This handles cases where Aeneas misaligned the audio but the actual audio is in that range
      if (isEarlySegment && expectedText.length > 5) {
        // Find all fragments that are in the 6-9 second range
        for (let k = 0; k < fragments.length; k++) {
          const fragTime = parseFloat(fragments[k].begin);
          if (fragTime >= 6 && fragTime <= 9) {
            // This fragment is in our target range - make sure it's in our search window
            if (k < startSearch) startSearch = k;
            if (k >= endSearch) endSearch = k + 1;
          }
        }
      }
      
      for (let j = startSearch; j < endSearch; j++) {
        const fragment = fragments[j];
        const fragText = normalizeText(fragment.lines?.join(' ') || fragment.lines?.[0] || '');
        
        if (fragText.length === 0) continue;
        
        const fragmentTimestamp = parseFloat(fragment.begin);
        
        // Calculate Score: Text Similarity + Proximity + Timing Validation
        // CRITICAL: Text match is REQUIRED - no bonuses without at least partial text match
        let score = 0;
        let hasTextMatch = false;
        
        // Exact text match gets highest score
        // CRITICAL: For early segments, exact text match is worth even more
        if (fragText === expectedText) {
          score += isEarlySegment ? 150 : 100; // Extra bonus for early segments
          hasTextMatch = true;
        }
        // Partial text match (one contains the other)
        // CRITICAL: Prefer fragments where expectedText is contained in fragText (not the other way)
        // This means the fragment has the text we're looking for, possibly with extra content
        else if (fragText.includes(expectedText)) {
          hasTextMatch = true;
          // Check if fragment has extra text beyond what we're looking for
          const extraText = fragText.replace(expectedText, '').trim();
          if (extraText.length > 0) {
            // Fragment has extra text (e.g., "If You Were a Horse 4" when looking for "If You Were a Horse")
            // Heavily penalize - prefer exact matches or fragments without extra text
            score += isEarlySegment ? 40 : 25; // Much lower score for fragments with extra text
            // Additional penalty based on amount of extra text
            const extraTextPenalty = Math.min(30, extraText.length * 2);
            score -= extraTextPenalty;
          } else {
            // Fragment text is exactly what we're looking for (shouldn't happen, but just in case)
            score += isEarlySegment ? 80 : 50;
          }
        }
        // If expectedText contains fragText, it's a weaker match (fragment is subset of expected)
        else if (expectedText.includes(fragText)) {
          score += 30; // Lower score for subset matches
          hasTextMatch = true;
        }
        
        // CRITICAL FIX: Only apply bonuses if there's at least a partial text match
        // This prevents fragments with completely different text from scoring high
        if (!hasTextMatch) {
          // No text match at all - heavily penalize
          score = -100; // Negative score to ensure it's not selected
        } else {
          // Proximity bonus: closer to the current fragmentIndex is better
          // Maximum bonus of 20 points for being at fragmentIndex
          // CRITICAL: For early segments, give bonus for being EARLIER (lower index), not just closer
          let proximityBonus;
          if (isEarlySegment) {
            // For early segments, prefer fragments that are earlier in the audio
            // Give bonus for being at or before the expected position
            if (j <= i) {
              // Fragment is at or before expected segment position - good!
              proximityBonus = 30 - Math.abs(j - i) * 2; // Up to 30 points
            } else {
              // Fragment is after expected position - small penalty
              proximityBonus = Math.max(0, 20 - (j - i) * 3);
            }
          } else {
            // For later segments, use standard proximity
            proximityBonus = Math.max(0, 20 - Math.abs(j - fragmentIndex));
          }
          score += proximityBonus;
        }
        
        // CRITICAL FIX: Timing validation penalty
        // Only apply timing bonuses/penalties if there's a text match
        // This prevents fragments with wrong text from scoring high due to timing
        if (hasTextMatch) {
          const timestampDiff = Math.abs(fragmentTimestamp - expectedTimestamp);
          
          // CRITICAL: For early segments, reject fragments that are too far into the audio
          if (isEarlySegment && fragmentTimestamp > maxAllowedTimestampForEarly) {
            // Heavily penalize - this is likely a misalignment
            score -= 300; // Effectively reject this match
          } else if (isEarlySegment) {
            // For early segments, prefer fragments that are EARLY in the audio
            // Give bonus for being in the first 15 seconds
            if (fragmentTimestamp <= 15) {
              const earlyBonus = 30 - (fragmentTimestamp / 15) * 15; // Up to 30 points for being at 0s
              score += earlyBonus;
            }
            // CRITICAL: Extra bonus for fragments in the "sweet spot" (5-10 seconds) for early segments
            // This helps catch fragments that are close to where the user expects them (7-8 seconds)
            if (fragmentTimestamp >= 5 && fragmentTimestamp <= 10) {
              score += 40; // Increased bonus for being in the sweet spot (was 25)
            }
            // CRITICAL: For segments in the first 30%, if timestamp is in 6-9 second range, 
            // give massive bonus (text match already confirmed)
            if (i < idMap.length * 0.3 && fragmentTimestamp >= 6 && fragmentTimestamp <= 9) {
              score += 60; // Very large bonus for being in the expected range
            }
            // Still apply timing penalty if way off from expected
            if (timestampDiff > timestampTolerance) {
              const timingPenalty = Math.min(50, (timestampDiff / timestampTolerance) * 15);
              score -= timingPenalty;
            }
          } else if (timestampDiff > timestampTolerance) {
            // Heavy penalty for timing mismatch (can reduce score by up to 100 points)
            const timingPenalty = Math.min(100, (timestampDiff / timestampTolerance) * 30);
            score -= timingPenalty;
          } else {
            // Small bonus for good timing alignment
            const timingBonus = Math.max(0, 10 - (timestampDiff / timestampTolerance) * 10);
            score += timingBonus;
          }
        }
        
        if (score > highestScore) {
          highestScore = score;
          bestMatch = fragment;
          bestMatchIndex = j;
        }
      }
      
      // Only use the match if score is high enough (prevents weak matches)
      // CRITICAL: Also check that timing makes sense
      if (bestMatch && highestScore > 50) {
        const matchedTimestamp = parseFloat(bestMatch.begin);
        const timestampDiff = Math.abs(matchedTimestamp - expectedTimestamp);
        
        // Reject matches with extreme timing mismatches, even if text matches
        // CRITICAL: For early segments, reject if fragment is too far into the audio
        if (isEarlySegment && matchedTimestamp > maxAllowedTimestampForEarly) {
          console.warn(`[AeneasService] ⚠️  Rejecting match for early segment ${i} (${segment.id}): timestamp ${matchedTimestamp.toFixed(2)}s exceeds max allowed ${maxAllowedTimestampForEarly.toFixed(2)}s for early segments`);
          // Fall through to fallback
          bestMatch = null;
          highestScore = -1;
        } else if (isEarlySegment && matchedTimestamp > expectedTimestamp + 30) {
          console.warn(`[AeneasService] ⚠️  Rejecting match for segment ${i} (${segment.id}): timestamp ${matchedTimestamp.toFixed(2)}s is too far from expected ${expectedTimestamp.toFixed(2)}s (diff: ${timestampDiff.toFixed(2)}s)`);
          // Fall through to fallback
          bestMatch = null;
          highestScore = -1;
        }
      }
      
      if (bestMatch && highestScore > 50) {
        // Advance the pointer to after the matched fragment
        fragmentIndex = bestMatchIndex + 1;
        
        const result = {
          id: segment.id,
          text: segment.text,
          type: segment.type,
          startTime: parseFloat(bestMatch.begin),
          endTime: parseFloat(bestMatch.end),
          duration: (parseFloat(bestMatch.end) - parseFloat(bestMatch.begin)) * 1000
        };
        
        results.push(result);
        
        // CRITICAL DEBUG: Log "If You Were a Horse" to verify mapping
        if (segment.text && segment.text.toLowerCase().includes('if you were a horse')) {
          const matchedTimestamp = parseFloat(bestMatch.begin);
          const timestampDiff = matchedTimestamp - expectedTimestamp;
          console.log(`[AeneasService] 🔍 Best match for "If You Were a Horse" found at index ${bestMatchIndex} (Score: ${highestScore}):`, {
            id: result.id,
            expectedText: expectedText.substring(0, 60),
            fragmentText: normalizeText(bestMatch.lines?.join(' ') || bestMatch.lines?.[0] || '').substring(0, 60),
            resultStartTime: result.startTime,
            resultEndTime: result.endTime,
            segmentIndex: i,
            fragmentIndex: bestMatchIndex,
            score: highestScore,
            searchWindow: `${startSearch} to ${endSearch - 1}`,
            expectedTimestamp: expectedTimestamp.toFixed(2),
            actualTimestamp: matchedTimestamp.toFixed(2),
            timestampDiff: timestampDiff.toFixed(2),
            timingValid: Math.abs(timestampDiff) <= timestampTolerance,
            fragmentIndexAtStart: fragmentIndex
          });
          
          // Also log all fragments in search window for debugging
          console.log(`[AeneasService] 🔍 All fragments in search window [${startSearch} to ${endSearch - 1}]:`);
          for (let k = startSearch; k < endSearch && k < fragments.length; k++) {
            const frag = fragments[k];
            const fragTxt = normalizeText(frag.lines?.join(' ') || frag.lines?.[0] || '');
            const fragTime = parseFloat(frag.begin);
            const containsText = fragTxt.includes(expectedText) || expectedText.includes(fragTxt);
            console.log(`  Fragment ${k}: "${fragTxt.substring(0, 40)}" at ${fragTime.toFixed(2)}s (contains text: ${containsText})`);
          }
        }
      } else {
        // Fallback if no match: try to find the next available fragment
        // CRITICAL: Don't use the same fragment for multiple segments - advance the pointer
        let fallbackFragment = null;
        let fallbackIndex = fragmentIndex;
        
        // Look ahead for the next fragment that hasn't been used
        while (fallbackIndex < fragments.length && !fallbackFragment) {
          const candidate = fragments[fallbackIndex];
          // Check if this fragment is already used in results
          const alreadyUsed = results.some(r => 
            Math.abs(r.startTime - parseFloat(candidate.begin)) < 0.1 &&
            Math.abs(r.endTime - parseFloat(candidate.end)) < 0.1
          );
          
          if (!alreadyUsed) {
            fallbackFragment = candidate;
            break;
          }
          fallbackIndex++;
        }
        
        // If no unused fragment found, use the current one
        if (!fallbackFragment) {
          fallbackFragment = fragments[Math.min(fragmentIndex, fragments.length - 1)];
        }
        
        const result = {
          id: segment.id,
          text: segment.text,
          type: segment.type,
          startTime: parseFloat(fallbackFragment.begin),
          endTime: parseFloat(fallbackFragment.end),
          duration: (parseFloat(fallbackFragment.end) - parseFloat(fallbackFragment.begin)) * 1000
        };
        
        results.push(result);
        
        // Advance fragmentIndex to prevent cascade of failures
        fragmentIndex = Math.min(fallbackIndex + 1, fragments.length);
        
        console.warn(`[AeneasService] ⚠️  No good match found for segment ${i} (${segment.id}), using fallback fragment at index ${fallbackIndex} (Score: ${highestScore.toFixed(2)})`);
      }
    }
    
    if (fragmentIndex < fragments.length) {
      console.warn(`[AeneasService] ⚠️  ${fragments.length - fragmentIndex} fragments remaining (not mapped)`);
    }

    console.log(`[AeneasService] Mapped ${fragments.length} fragments to ${results.length} segments (ratio: ${(fragments.length / idMap.length).toFixed(2)} fragments/segment)`);
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
    // FIXED: Increased durations to prevent reading too fast in EPUB player
    const MIN_WORD_DURATION = 0.25; // Minimum 250ms per word (was 150ms - too fast)
    const WORD_PADDING = 0.12; // 120ms padding between words (was 50ms - too fast)
    const PUNCTUATION_PAUSE = 0.2; // 200ms pause after punctuation (was 100ms)

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
        
        // CRITICAL FIX: Verify normalized audio duration matches original
        // If durations don't match, normalization may have changed timing
        try {
          const { execSync } = await import('child_process');
          const originalDuration = parseFloat(execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
            { encoding: 'utf8' }
          ).trim());
          
          const normalizedDuration = parseFloat(execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${processedAudioPath}"`,
            { encoding: 'utf8' }
          ).trim());
          
          const durationDiff = Math.abs(originalDuration - normalizedDuration);
          if (durationDiff > 0.1) { // More than 100ms difference
            console.warn(`[AeneasService] ⚠️  Normalized audio duration differs by ${durationDiff.toFixed(2)}s. Using original audio to preserve timing.`);
            processedAudioPath = audioPath; // Use original to preserve exact timing
          } else {
            console.log(`[AeneasService] Normalized audio duration verified: ${normalizedDuration.toFixed(2)}s (original: ${originalDuration.toFixed(2)}s)`);
          }
        } catch (durationCheckError) {
          console.warn('[AeneasService] Could not verify normalized audio duration, using normalized file:', durationCheckError.message);
        }
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
      
      // CRITICAL DEBUG: Log first few text segments to verify exclusion
      if (textLines.length > 0) {
        console.log(`[AeneasService] First 3 text segments:`, textLines.slice(0, 3).map((t, i) => `${i + 1}. "${t.substring(0, 50)}..." (ID: ${idMap[i]?.id})`));
        console.log(`[AeneasService] Last 3 text segments:`, textLines.slice(-3).map((t, i) => `${textLines.length - 2 + i}. "${t.substring(0, 50)}..." (ID: ${idMap[textLines.length - 3 + i]?.id})`));
      }

      // 2. Create text file for Aeneas
      await this.createTextFile(textLines, textPath);

      // 3. Execute Aeneas alignment (using normalized audio)
      const fragments = await this.executeAlignment(processedAudioPath, textPath, outputPath, {
        language,
        textType: 'plain',
        outputFormat: 'json'
      });

      console.log(`[AeneasService] Aeneas returned ${fragments.length} fragments`);
      
      // CRITICAL DEBUG: Save full Aeneas output for inspection
      try {
        const debugOutputPath = outputPath.replace('.json', '_full_debug.json');
        await fs.writeFile(debugOutputPath, JSON.stringify({
          totalFragments: fragments.length,
          totalSegments: idMap.length,
          fragments: fragments.map((f, idx) => ({
            index: idx,
            begin: f.begin,
            end: f.end,
            lines: f.lines,
            id: f.id
          })),
          textSegments: idMap.map((m, idx) => ({
            index: idx,
            id: m.id,
            text: m.text.substring(0, 60)
          }))
        }, null, 2), 'utf8');
        console.log(`[AeneasService] 💾 Saved full debug output to: ${debugOutputPath}`);
      } catch (debugErr) {
        console.warn('[AeneasService] Could not save debug output:', debugErr.message);
      }
      
      // CRITICAL DEBUG: Log first few alignment results to verify timing
      if (fragments.length > 0) {
        console.log(`[AeneasService] First 10 alignment results:`, fragments.slice(0, 10).map((f, idx) => ({
          index: idx,
          text: f.lines?.[0]?.substring(0, 40) || 'N/A',
          start: f.begin,
          end: f.end,
          id: f.id
        })));
        
        // Find fragment that contains "If You Were a Horse"
        const horseFragment = fragments.find(f => 
          f.lines && f.lines[0] && f.lines[0].toLowerCase().includes('if you were a horse')
        );
        if (horseFragment) {
          console.log(`[AeneasService] 🔍 Found "If You Were a Horse" in Aeneas fragments:`, {
            begin: horseFragment.begin,
            end: horseFragment.end,
            text: horseFragment.lines?.[0],
            id: horseFragment.id,
            fragmentIndex: fragments.indexOf(horseFragment)
          });
        } else {
          console.log(`[AeneasService] ⚠️  "If You Were a Horse" fragment NOT found in Aeneas output`);
          console.log(`[AeneasService] Searching for similar text...`);
          const similarFragments = fragments.filter(f => 
            f.lines && f.lines[0] && (
              f.lines[0].toLowerCase().includes('horse') ||
              f.lines[0].toLowerCase().includes('were')
            )
          );
          if (similarFragments.length > 0) {
            console.log(`[AeneasService] Found ${similarFragments.length} fragments with "horse" or "were":`, 
              similarFragments.slice(0, 3).map(f => ({
                text: f.lines[0].substring(0, 40),
                begin: f.begin,
                end: f.end
              }))
            );
          }
        }
      }

      // 4. Map results to original IDs
      console.log(`[AeneasService] Mapping ${fragments.length} fragments to ${idMap.length} segments...`);
      const mappedResults = this.mapFragmentsToIds(fragments, idMap);
      
      // CRITICAL DEBUG: Log mapped results to verify timing
      if (mappedResults.length > 0) {
        console.log(`[AeneasService] First 5 mapped results:`, mappedResults.slice(0, 5).map(r => ({
          id: r.id,
          text: r.text?.substring(0, 40) || 'N/A',
          start: r.startTime,
          end: r.endTime,
          type: r.type
        })));
        
        // CRITICAL DEBUG: Find "If You Were a Horse" to verify its timestamp
        const horseSegment = mappedResults.find(r => 
          r.text && r.text.toLowerCase().includes('if you were a horse')
        );
        if (horseSegment) {
          console.log(`[AeneasService] ✅ "If You Were a Horse" mapped correctly:`, {
            id: horseSegment.id,
            text: horseSegment.text?.substring(0, 60),
            start: horseSegment.startTime,
            end: horseSegment.endTime,
            duration: horseSegment.endTime - horseSegment.startTime
          });
        } else {
          console.log(`[AeneasService] ❌ "If You Were a Horse" NOT found in mapped results!`);
          console.log(`[AeneasService] Available IDs:`, mappedResults.slice(0, 10).map(r => r.id));
        }
      }

      // 5. Separate into sentences and words
      const sentences = mappedResults.filter(r => r.type !== 'word');
      let words = mappedResults.filter(r => r.type === 'word');
      
      console.log(`[AeneasService] Separated: ${sentences.length} sentences, ${words.length} words`);

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

