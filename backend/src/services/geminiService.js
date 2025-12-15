import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import { RateLimiterService } from './rateLimiterService.js';
import { RequestQueueService } from './requestQueueService.js';
import { CircuitBreakerService } from './circuitBreakerService.js';

dotenv.config();

/**
 * Service for interacting with Google Gemini AI
 */
export class GeminiService {
  static _client = null;

  static parseRetryDelayMs(errorDetails) {
    if (!Array.isArray(errorDetails)) return null;
    for (const d of errorDetails) {
      if (d && d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && typeof d.retryDelay === 'string') {
        // retryDelay format like "17s" or "16.5s" or "59.483809411s"
        const match = d.retryDelay.match(/([\d.]+)s/);
        if (match) {
          const seconds = Number(match[1]);
          if (!Number.isNaN(seconds)) {
            // Add 10% buffer and convert to milliseconds
            return Math.max(1000, Math.floor(seconds * 1100));
          }
        }
      }
    }
    return null;
  }

  static async generateWithBackoff(model, content, priority = 2) {
    // Check circuit breaker first
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      console.warn('⚠️ Gemini API circuit breaker is OPEN, skipping request');
      return null;
    }

    // Use request queue instead of immediate rejection
    return await RequestQueueService.enqueue('Gemini', async () => {
      // Pre-request rate limit check
      if (!RateLimiterService.acquire('Gemini')) {
        const waitTime = RateLimiterService.getTimeUntilNextToken('Gemini');
        // Wait for token to become available
        if (waitTime > 0) {
          console.debug(`Rate limit: Waiting ${Math.round(waitTime/1000)}s for token`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          // Try again after waiting
          if (!RateLimiterService.acquire('Gemini')) {
            console.warn('⚠️ Gemini API rate limit exceeded after wait, skipping request');
            return null;
          }
        } else {
          console.warn('⚠️ Gemini API rate limit exceeded, skipping request');
          return null;
        }
      }

      let delayMs = 2000; // start with 2s
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await model.generateContent(content);
          // Record success in circuit breaker
          CircuitBreakerService.recordSuccess('Gemini');
          return result;
        } catch (error) {
          const is429 = error?.status === 429 || error?.statusCode === 429;
          
          // Record failure in circuit breaker (only for 429)
          if (is429) {
            CircuitBreakerService.recordFailure('Gemini', true);
          }
          
          // Explicit 429 handling - graceful fallback
          if (is429) {
            console.warn('⚠️ Gemini API rate limit exceeded (429), falling back to alternative');
            return null; // Return null to trigger fallback behavior
          }
          
          // Check if quota is completely exhausted (limit: 0)
          const quotaExhausted = error?.message?.includes('limit: 0') || 
                                 error?.errorDetails?.some(d => 
                                   d?.violations?.some(v => v?.quotaId?.includes('PerDay'))
                                 );
          
          if (quotaExhausted) {
            console.warn('⚠️ Gemini quota completely exhausted (daily limit reached). Skipping AI processing.');
            return null; // Return null to trigger fallback behavior
          }
          
          // For non-429 errors, retry if attempts remain
          const shouldRetry = attempt < maxAttempts;
          if (!shouldRetry) {
            // Log error but don't throw - allow fallback
            console.warn(`Gemini API error (attempt ${attempt}/${maxAttempts}):`, error.message);
            return null;
          }

          // Try to honor server-provided retry delay if present
          const serverDelay = this.parseRetryDelayMs(error?.errorDetails);
          const sleepMs = serverDelay ?? delayMs;
          console.warn(`Gemini error, backing off for ${Math.round(sleepMs/1000)}s (attempt ${attempt}/${maxAttempts})`);
          await new Promise(res => setTimeout(res, sleepMs));
          delayMs *= 2; // exponential backoff
        }
      }
      // Should not reach here, but return null for safety
      return null;
    }, priority);
  }

  static getClient() {
    if (!this._client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn('GEMINI_API_KEY not set in environment variables');
        return null;
      }
      // SDK version 0.24.1 defaults to v1beta API
      // API URL: https://generativelanguage.googleapis.com/v1beta/models
      // Works with models like gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-flash-latest
      this._client = new GoogleGenerativeAI(apiKey);
    }
    return this._client;
  }

  /**
   * Extract text directly from a PDF using Gemini (vision models).
   * Falls back to returning null if anything fails.
   * @param {string} pdfFilePath
   * @returns {Promise<{pages: Array<{pageNumber:number,text:string}>, totalPages:number}>|null}
   */
  static async extractTextFromPdf(pdfFilePath) {
    const client = this.getClient();
    if (!client) {
      return null;
    }

    // Pre-request rate limit check
    if (!RateLimiterService.acquire('Gemini')) {
      console.debug('Rate limit exceeded for Gemini API call (extraction), skipping');
      return null; // Will trigger fallback behavior
    }

    try {
      const pdfBuffer = await fs.readFile(pdfFilePath);
      // Default to gemini-2.5-flash (v1beta API)
      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ model: modelName });

      // Ask Gemini to emit clear page separators we can split on.
      const prompt = `Extract all readable text from this PDF.
Return plain text only. Separate pages using the exact marker:
---PAGE {number}---
Do not skip pages; include empty pages as "---PAGE {n}---" followed by nothing if blank.
IMPORTANT: Do NOT include page numbers (like "Page 1", "Page 2") as part of the content text. Only use the ---PAGE {number}--- markers to separate pages.`;

      let result;
      try {
        result = await model.generateContent([
          { text: prompt },
          {
            inlineData: {
              data: pdfBuffer.toString('base64'),
              mimeType: 'application/pdf'
            }
          }
        ]);
      } catch (error) {
        // Explicit 429 handling - graceful fallback
        if (error?.status === 429 || error?.statusCode === 429) {
          console.warn('⚠️ Gemini API rate limit exceeded (429) during extraction, falling back to local parser');
          return null; // Will trigger fallback behavior
        }
        throw error; // Re-throw other errors
      }

      const response = await result.response;
      const text = response.text() || '';

      // Parse pages from the AI response.
      const pageChunks = text.split(/---PAGE\s+(\d+)---/i).slice(1); // [num, text, num, text...]
      const pages = [];
      for (let i = 0; i < pageChunks.length; i += 2) {
        const pageNumber = Number(pageChunks[i]);
        const pageText = (pageChunks[i + 1] || '').trim();
        if (!Number.isNaN(pageNumber)) {
          pages.push({
            pageNumber,
            text: pageText,
            textBlocks: [],
            charCount: pageText.length,
            width: 612,
            height: 792
          });
        }
      }

      if (pages.length === 0) {
        return null;
      }

      // Optional: generate textBlocks with bounding boxes to mirror pdfjs format
      // This uses AI positioning heuristics; if you have exact page sizes, set them later.
      try {
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          const pageWidth = p.width || 612;
          const pageHeight = p.height || 792;
          const blocks = await this.createTextBlocksFromText(
            p.text || '',
            p.pageNumber,
            pageWidth,
            pageHeight
          );
          p.textBlocks = blocks || [];
          p.charCount = p.text?.length || 0;
          p.width = pageWidth;
          p.height = pageHeight;
        }
      } catch (blockErr) {
        console.warn('Could not create text blocks with bounding boxes from Gemini PDF extraction:', blockErr.message);
      }

      return {
        pages,
        totalPages: pages.length,
        metadata: {}
      };
    } catch (error) {
      // Handle 429 errors gracefully - already logged in generateWithBackoff
      if (error?.status === 429 || error?.statusCode === 429) {
        console.warn('⚠️ Gemini API rate limit exceeded (429) during extraction, falling back to local parser');
        return null;
      }
      console.error('Gemini PDF text extraction failed:', error);
      return null;
    }
  }

  /**
   * Structure and enhance PDF text content using Gemini
   * @param {Array} pages - Array of page objects with text
   * @param {Object} options - Options for processing
   * @returns {Promise<Object>} Structured content with chapters/sections
   */
  static async structureContent(pages, options = {}) {
    const client = this.getClient();
    if (!client) {
      console.warn('Gemini API not available, returning original content');
      return { pages, chapters: null };
    }

    try {
      // Use separate model for structuring (more reliable, less likely to be overloaded)
      // Default to gemini-2.5-flash (v1beta API)
      const modelName = process.env.GEMINI_STRUCTURING_MODEL 
        || process.env.GEMINI_API_MODEL 
        || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ 
        model: modelName 
      });

      // Combine all text
      const fullText = pages.map(p => `Page ${p.pageNumber}:\n${p.text}`).join('\n\n');
      
      const prompt = `You are an expert at analyzing document structure. Analyze the following PDF content and identify:
1. Document title
2. Chapters and sections (with their titles and page ranges)
3. Table of contents structure
4. Main content organization

Return your analysis in JSON format with this structure:
{
  "title": "Document Title",
  "chapters": [
    {
      "title": "Chapter Title",
      "startPage": 1,
      "endPage": 5,
      "sections": [
        {
          "title": "Section Title",
          "startPage": 1,
          "endPage": 3
        }
      ]
    }
  ],
  "summary": "Brief document summary"
}

PDF Content:
${fullText.substring(0, 50000)}`; // Limit to avoid token limits

      // Use high priority for structuring (important for conversion quality)
      const result = await this.generateWithBackoff(model, prompt, 1);
      
      // Handle rate limiting or 429 errors (returns null)
      if (!result) {
        console.warn('⚠️ Gemini API rate limit exceeded (429) or unavailable, using default structure');
        return { pages, chapters: null };
      }
      
      const response = await result.response;
      const text = response.text();
      
      // Try to parse JSON from response
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : text;
        const structured = JSON.parse(jsonStr.trim());
        
        return {
          pages,
          structured,
          enhanced: true
        };
      } catch (parseError) {
        console.warn('Could not parse Gemini response as JSON:', parseError);
        return { pages, chapters: null, rawResponse: text };
      }
    } catch (error) {
      // Exclude 429 from general error handling - already handled in generateWithBackoff
      if (error?.status !== 429 && error?.statusCode !== 429) {
        console.error('Error using Gemini API:', error);
      }
      return { pages, chapters: null, error: error.message };
    }
  }

  /**
   * Clean and enhance text content
   * @param {string} text - Text to clean
   * @returns {Promise<string>} Cleaned text
   */
  static async cleanText(text) {
    const client = this.getClient();
    if (!client) {
      return text;
    }

    try {
      // Use separate model for text cleaning (can be different from extraction/structuring)
      // Default to gemini-2.5-flash (v1beta API)
      const modelName = process.env.GEMINI_STRUCTURING_MODEL 
        || process.env.GEMINI_API_MODEL 
        || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ 
        model: modelName 
      });

      const prompt = `Clean and format the following text for EPUB publication. 
Fix formatting issues, remove extra whitespace, ensure proper paragraph breaks.
Return only the cleaned text without explanations.

Text:
${text.substring(0, 10000)}`;

      const result = await this.generateWithBackoff(model, prompt);
      
      // Handle rate limiting or 429 errors (returns null)
      if (!result) {
        console.warn('⚠️ Gemini API rate limit exceeded (429) during text cleaning, using original text');
        return text; // Return original if rate limited
      }
      
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      // Exclude 429 from general error handling - already handled in generateWithBackoff
      if (error?.status !== 429 && error?.statusCode !== 429) {
        console.error('Error cleaning text with Gemini:', error);
      }
      return text; // Return original if error
    }
  }

  /**
   * Extract text from a rendered page image using Gemini Vision API
   * @param {string} imagePath - Path to the page image file
   * @param {number} pageNumber - Page number
   * @returns {Promise<string|null>} Extracted text or null if failed
   */
  static async extractTextFromImage(imagePath, pageNumber) {
    const client = this.getClient();
    if (!client) {
      return null;
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      console.warn(`[Page ${pageNumber}] Circuit breaker is OPEN, skipping image text extraction`);
      return null;
    }

    // Wrap entire operation in a timeout to prevent hanging
    const overallTimeout = 60000; // 60 seconds max for entire operation
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Overall timeout after 60s')), overallTimeout)
    );

    const operationPromise = RequestQueueService.enqueue('Gemini', async () => {
      // Pre-request rate limit check with retry logic
      let retries = 0;
      const maxRetries = 5; // Reduced to 5 retries
      const maxTotalWait = 20000; // Max 20 seconds total wait (reduced from 30s)
      let totalWaitTime = 0;
      
      // Try to acquire token, with retry logic
      let acquired = false;
      while (!acquired && retries < maxRetries && totalWaitTime < maxTotalWait) {
        acquired = RateLimiterService.acquire('Gemini');
        if (!acquired) {
          const waitTime = RateLimiterService.getTimeUntilNextToken('Gemini');
          if (waitTime > 0 && waitTime < 10000 && (totalWaitTime + waitTime) < maxTotalWait) { // Wait up to 10s per iteration, 20s total
            const actualWait = Math.min(waitTime + 200, maxTotalWait - totalWaitTime); // Add 200ms buffer, respect max
            console.log(`[Page ${pageNumber}] Waiting ${Math.round(actualWait/1000)}s for rate limit...`);
            await new Promise(resolve => setTimeout(resolve, actualWait));
            totalWaitTime += actualWait;
            retries++;
          } else {
            if (totalWaitTime >= maxTotalWait) {
              console.warn(`[Page ${pageNumber}] Max wait time (20s) exceeded, skipping image text extraction`);
            } else {
              console.warn(`[Page ${pageNumber}] Rate limit wait time too long (${Math.round(waitTime/1000)}s), skipping`);
            }
            return null;
          }
        }
      }
      
      if (!acquired) {
        console.warn(`[Page ${pageNumber}] Rate limit retries exhausted (${retries} retries, ${Math.round(totalWaitTime/1000)}s waited), skipping image text extraction`);
        return null;
      }

      try {
        console.log(`[Page ${pageNumber}] Reading image file...`);
        const imageBuffer = await fs.readFile(imagePath);
        
        const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
        const model = client.getGenerativeModel({ model: modelName });

        const prompt = `Extract all readable text from this PDF page image. 
Return only the text content, preserving line breaks and paragraph structure.
Do not add any explanations or formatting markers.`;

        console.log(`[Page ${pageNumber}] Calling Gemini Vision API...`);
        
        // Add timeout wrapper (25 seconds max for API call)
        const apiTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API call timeout after 25s')), 25000)
        );

        const apiCallPromise = model.generateContent([
          { text: prompt },
          {
            inlineData: {
              data: imageBuffer.toString('base64'),
              mimeType: 'image/png'
            }
          }
        ]);

        const result = await Promise.race([apiCallPromise, apiTimeoutPromise]);
        console.log(`[Page ${pageNumber}] Received response from Gemini API...`);
        
        const response = await result.response;
        const extractedText = response.text() || '';
        
        // Record success
        CircuitBreakerService.recordSuccess('Gemini');
        
        console.log(`[Page ${pageNumber}] Successfully extracted ${extractedText.length} characters`);
        return extractedText.trim();
      } catch (error) {
        const is429 = error?.status === 429 || error?.statusCode === 429;
        const isTimeout = error?.message?.includes('timeout');
        
        if (is429) {
          CircuitBreakerService.recordFailure('Gemini', true);
          console.warn(`[Page ${pageNumber}] 429 error during image text extraction`);
        } else if (isTimeout) {
          console.warn(`[Page ${pageNumber}] API call timed out, skipping`);
          CircuitBreakerService.recordFailure('Gemini', false);
        } else {
          console.error(`[Page ${pageNumber}] Error extracting text from image:`, error.message);
          CircuitBreakerService.recordFailure('Gemini', false);
        }
        return null;
      }
    }, 2);

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } catch (error) {
      if (error?.message?.includes('Overall timeout')) {
        console.error(`[Page ${pageNumber}] Overall operation timed out after 60s, skipping`);
        CircuitBreakerService.recordFailure('Gemini', false);
      }
      return null;
    }
  }

  /**
   * Extract text AND bounding-boxed textBlocks from an image (page render).
   * Returns { text, textBlocks } with boundingBox in PDF-style coordinates:
   * { x, y, width, height, pageNumber }, where y is from bottom.
   * If width/height are provided (page points), they are used to normalize.
   */
  static async extractTextBlocksFromImage(imagePath, pageNumber, pageWidthPoints = 612, pageHeightPoints = 792) {
    // First, attempt to get true geometry from vision with a JSON bbox response
    const visionBlocks = await this.extractTextBlocksWithGeometryFromImage(
      imagePath,
      pageNumber,
      pageWidthPoints,
      pageHeightPoints
    );
    if (visionBlocks && visionBlocks.text && visionBlocks.textBlocks?.length) {
      return visionBlocks;
    }

    // Fallback: plain text + heuristic blocks
    const text = await this.extractTextFromImage(imagePath, pageNumber);
    if (!text) {
      return { text: null, textBlocks: [] };
    }
    const blocks = await this.createTextBlocksFromText(
      text,
      pageNumber,
      pageWidthPoints,
      pageHeightPoints
    );
    return { text, textBlocks: blocks || [] };
  }

  /**
   * Vision call that asks Gemini to return bounding boxes with geometry.
   * Expected JSON array:
   * [
   *  {"text":"Hello","x":0.12,"y":0.15,"width":0.3,"height":0.05,"fontSize":14,"isBold":false,"isItalic":false}
   * ]
   * x,y,width,height are normalized 0..1 from top-left. Converted to PDF points with y-from-bottom.
   */
  static async extractTextBlocksWithGeometryFromImage(imagePath, pageNumber, pageWidthPoints = 612, pageHeightPoints = 792) {
    const client = this.getClient();
    if (!client) return null;

    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      console.warn(`[Page ${pageNumber}] Circuit breaker OPEN, skipping geometry extraction`);
      return null;
    }

    // Rate limit check
    if (!RateLimiterService.acquire('Gemini')) {
      console.warn(`[Page ${pageNumber}] Rate limited, skipping geometry extraction`);
      return null;
    }

    try {
      const imageBuffer = await fs.readFile(imagePath);
      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ model: modelName });

      const prompt = `You are OCR. Return text blocks with bounding boxes as pure JSON array.
Use normalized coordinates 0..1 from TOP-LEFT of the image.
Fields: text (string), x, y, width, height (numbers), fontSize (number, optional), isBold (bool), isItalic (bool).
No markdown, no code fences, ONLY JSON array. Example:
[
 {"text":"Hello","x":0.1,"y":0.2,"width":0.3,"height":0.05,"fontSize":14,"isBold":false,"isItalic":false}
]`;

      // 25s API timeout
      const apiTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('API call timeout after 25s')), 25000)
      );
      const apiCallPromise = model.generateContent([
        { text: prompt },
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: 'image/png'
          }
        }
      ]);

      const result = await Promise.race([apiCallPromise, apiTimeoutPromise]);
      const response = await result.response;
      const raw = response.text() || '';

      let jsonStr = raw.trim();
      const match = jsonStr.match(/```json\n([\s\S]*?)```/i) || jsonStr.match(/```\n([\s\S]*?)```/i);
      if (match) {
        jsonStr = match[1].trim();
      }

      let blocks = [];
      try {
        blocks = JSON.parse(jsonStr);
      } catch (e) {
        console.warn(`[Page ${pageNumber}] Could not parse Gemini geometry JSON: ${e.message}`);
        return null;
      }

      if (!Array.isArray(blocks)) {
        console.warn(`[Page ${pageNumber}] Gemini geometry response is not an array`);
        return null;
      }

      // Normalize to pdfjs-style boundingBox (y from bottom)
      const converted = blocks
        .filter(b => b.text && typeof b.x === 'number' && typeof b.y === 'number' && typeof b.width === 'number' && typeof b.height === 'number')
        .map((b, idx) => {
          const xNorm = Math.max(0, Math.min(1, b.x));
          const yNorm = Math.max(0, Math.min(1, b.y));
          const wNorm = Math.max(0, Math.min(1, b.width));
          const hNorm = Math.max(0, Math.min(1, b.height));

          const xPt = xNorm * pageWidthPoints;
          const yTopPt = yNorm * pageHeightPoints;
          const widthPt = wNorm * pageWidthPoints;
          const heightPt = hNorm * pageHeightPoints;
          const yBottomPt = pageHeightPoints - (yTopPt + heightPt); // convert top-down to bottom-up

          return {
            id: `vision_block_${pageNumber}_${idx}`,
            text: b.text || '',
            type: 'paragraph',
            level: null,
            boundingBox: {
              x: xPt,
              y: yBottomPt,
              width: widthPt,
              height: heightPt,
              pageNumber
            },
            fontSize: b.fontSize || undefined,
            fontName: 'Arial',
            isBold: !!b.isBold,
            isItalic: !!b.isItalic,
            textColor: '#000000',
            textAlign: 'left',
            readingOrder: idx
          };
        });

      if (!converted.length) {
        console.warn(`[Page ${pageNumber}] Gemini geometry returned zero valid blocks`);
        return null;
      }

      CircuitBreakerService.recordSuccess('Gemini');
      const combinedText = converted.map(b => b.text).join(' ');
      return { text: combinedText, textBlocks: converted };
    } catch (error) {
      const is429 = error?.status === 429 || error?.statusCode === 429;
      const isTimeout = error?.message?.includes('timeout');
      if (is429) {
        CircuitBreakerService.recordFailure('Gemini', true);
        console.warn(`[Page ${pageNumber}] 429 during geometry extraction`);
      } else if (isTimeout) {
        CircuitBreakerService.recordFailure('Gemini', false);
        console.warn(`[Page ${pageNumber}] Geometry extraction timed out`);
      } else {
        CircuitBreakerService.recordFailure('Gemini', false);
        console.warn(`[Page ${pageNumber}] Geometry extraction error: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Correct and clean extracted text using AI
   * @param {string} text - Raw extracted text
   * @param {number} pageNumber - Page number for context
   * @returns {Promise<string>} Corrected text
   */
  static async correctExtractedText(text, pageNumber) {
    if (!text || text.trim().length === 0) {
      return text;
    }

    const client = this.getClient();
    if (!client) {
      return text;
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      console.warn(`[Page ${pageNumber}] Circuit breaker is OPEN, skipping text correction`);
      return text; // Return original text
    }

    // Wrap entire operation in a timeout to prevent hanging
    const overallTimeout = 45000; // 45 seconds max for entire correction operation
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Correction overall timeout after 45s')), overallTimeout)
    );

    const operationPromise = RequestQueueService.enqueue('Gemini', async () => {
      // Pre-request rate limit check with retry logic
      let retries = 0;
      const maxRetries = 5; // Reduced to 5 retries
      const maxTotalWait = 20000; // Max 20 seconds total wait (reduced from 30s)
      let totalWaitTime = 0;
      
      // Try to acquire token, with retry logic
      let acquired = false;
      while (!acquired && retries < maxRetries && totalWaitTime < maxTotalWait) {
        acquired = RateLimiterService.acquire('Gemini');
        if (!acquired) {
          const waitTime = RateLimiterService.getTimeUntilNextToken('Gemini');
          if (waitTime > 0 && waitTime < 10000 && (totalWaitTime + waitTime) < maxTotalWait) { // Wait up to 10s per iteration, 20s total
            const actualWait = Math.min(waitTime + 200, maxTotalWait - totalWaitTime); // Add 200ms buffer, respect max
            console.log(`[Page ${pageNumber}] Waiting ${Math.round(actualWait/1000)}s for rate limit (correction)...`);
            await new Promise(resolve => setTimeout(resolve, actualWait));
            totalWaitTime += actualWait;
            retries++;
          } else {
            if (totalWaitTime >= maxTotalWait) {
              console.warn(`[Page ${pageNumber}] Max wait time (20s) exceeded, using original text`);
            } else {
              console.warn(`[Page ${pageNumber}] Rate limit wait time too long (${Math.round(waitTime/1000)}s), using original text`);
            }
            return text; // Return original text
          }
        }
      }
      
      if (!acquired) {
        console.warn(`[Page ${pageNumber}] Rate limit retries exhausted (${retries} retries, ${Math.round(totalWaitTime/1000)}s waited), using original text`);
        return text; // Return original text
      }

      try {
        const modelName = process.env.GEMINI_STRUCTURING_MODEL 
          || process.env.GEMINI_API_MODEL 
          || 'gemini-2.5-flash';
        const model = client.getGenerativeModel({ model: modelName });

        const prompt = `Correct and clean the following text extracted from a PDF page. 
Fix OCR errors, spelling mistakes, formatting issues, and ensure proper paragraph breaks.
Preserve the original meaning and structure.
Return only the corrected text without explanations.

Text to correct:
${text.substring(0, 10000)}`; // Limit to avoid token limits

        console.log(`[Page ${pageNumber}] Calling Gemini API for text correction...`);
        const result = await this.generateWithBackoff(model, prompt, 1);
        
        if (!result) {
          console.warn(`[Page ${pageNumber}] Text correction failed, using original text`);
          return text;
        }

        console.log(`[Page ${pageNumber}] Received correction response from Gemini API...`);
        const response = await result.response;
        const correctedText = response.text().trim();
        
        // Record success
        CircuitBreakerService.recordSuccess('Gemini');
        
        console.log(`[Page ${pageNumber}] Successfully corrected text (${correctedText.length} chars)`);
        return correctedText || text; // Fallback to original if empty
      } catch (error) {
        const is429 = error?.status === 429 || error?.statusCode === 429;
        if (is429) {
          CircuitBreakerService.recordFailure('Gemini', true);
          console.warn(`[Page ${pageNumber}] 429 error during text correction`);
        } else {
          console.error(`[Page ${pageNumber}] Error correcting text:`, error.message);
          CircuitBreakerService.recordFailure('Gemini', false);
        }
        return text; // Return original text on error
      }
    }, 1);

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } catch (error) {
      if (error?.message?.includes('Correction overall timeout')) {
        console.error(`[Page ${pageNumber}] Correction operation timed out after 45s, using original text`);
        CircuitBreakerService.recordFailure('Gemini', false);
      }
      return text; // Return original text on timeout
    }
  }

  /**
   * Create structured text blocks from plain text using AI
   * Analyzes text and creates blocks with positions, types, and hierarchy
   * @param {string} text - Plain text content
   * @param {number} pageNumber - Page number
   * @param {number} pageWidth - Page width in points
   * @param {number} pageHeight - Page height in points
   * @returns {Promise<Array>} Array of text block objects
   */
  static async createTextBlocksFromText(text, pageNumber, pageWidth = 612, pageHeight = 792) {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const client = this.getClient();
    if (!client) {
      // Fallback: create simple blocks without AI
      return this.createSimpleTextBlocks(text, pageNumber, pageWidth, pageHeight);
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      console.warn(`[Page ${pageNumber}] Circuit breaker is OPEN, using simple text blocks`);
      return this.createSimpleTextBlocks(text, pageNumber, pageWidth, pageHeight);
    }

    // Wrap in timeout
    const overallTimeout = 60000; // 60 seconds max (increased from 30s to handle complex pages)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Text block creation timeout after 60s')), overallTimeout)
    );

    const operationPromise = RequestQueueService.enqueue('Gemini', async () => {
      // Pre-request rate limit check
      let retries = 0;
      const maxRetries = 3;
      const maxTotalWait = 10000; // 10 seconds max wait
      let totalWaitTime = 0;
      
      let acquired = false;
      while (!acquired && retries < maxRetries && totalWaitTime < maxTotalWait) {
        acquired = RateLimiterService.acquire('Gemini');
        if (!acquired) {
          const waitTime = RateLimiterService.getTimeUntilNextToken('Gemini');
          if (waitTime > 0 && waitTime < 5000 && (totalWaitTime + waitTime) < maxTotalWait) {
            await new Promise(resolve => setTimeout(resolve, Math.min(waitTime + 100, maxTotalWait - totalWaitTime)));
            totalWaitTime += waitTime + 100;
            retries++;
          } else {
            break;
          }
        }
      }
      
      if (!acquired) {
        console.warn(`[Page ${pageNumber}] Rate limited, using simple text blocks`);
        return this.createSimpleTextBlocks(text, pageNumber, pageWidth, pageHeight);
      }

      try {
        const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
        const model = client.getGenerativeModel({ model: modelName });

        const prompt = `Analyze the following text from a PDF page and create structured text blocks with positions.

Text to analyze:
${text.substring(0, 15000)}

Page dimensions: ${pageWidth}pt wide × ${pageHeight}pt tall

Return a JSON array of text blocks. Each block should have:
- "text": the text content
- "type": "heading", "paragraph", or "list-item"
- "level": 1-6 for headings, null for others
- "x": left position in points (0 to ${pageWidth})
- "y": top position in points (0 to ${pageHeight}, measured from top)
- "width": width in points
- "height": estimated height in points
- "fontSize": estimated font size in points (optional)

Position blocks logically:
- Headings at the top, larger font
- Paragraphs below headings
- Maintain reading order (top to bottom, left to right)
- Distribute content across the page height

Return ONLY valid JSON array, no markdown, no explanations:
[
  {
    "text": "Chapter Title",
    "type": "heading",
    "level": 1,
    "x": 50,
    "y": 50,
    "width": ${pageWidth - 100},
    "height": 30,
    "fontSize": 18
  },
  {
    "text": "Paragraph text here...",
    "type": "paragraph",
    "level": null,
    "x": 50,
    "y": 100,
    "width": ${pageWidth - 100},
    "height": 60,
    "fontSize": 12
  }
]`;

        console.log(`[Page ${pageNumber}] Calling AI to create structured text blocks...`);
        
        const apiTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API call timeout after 20s')), 20000)
        );

        const apiCallPromise = model.generateContent(prompt);
        const result = await Promise.race([apiCallPromise, apiTimeoutPromise]);
        
        const response = await result.response;
        const responseText = response.text();
        
        // Parse JSON from response
        let blocks = [];
        try {
          // Extract JSON from markdown code blocks if present
          const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                           responseText.match(/```\n([\s\S]*?)\n```/) ||
                           responseText.match(/\[[\s\S]*\]/);
          
          const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
          blocks = JSON.parse(jsonStr.trim());
          
          // Validate and convert to text block format
          if (!Array.isArray(blocks)) {
            throw new Error('Response is not an array');
          }
          
          // Convert to text block format
          blocks = blocks.map((block, index) => {
            // Convert Y from top to bottom (PDF coordinate system)
            const yFromTop = block.y || 0;
            const yFromBottom = pageHeight - yFromTop - (block.height || 20);
            
          const fontSize = Math.max(block.fontSize || 18, 16);

            return {
              id: `ai_block_${pageNumber}_${index}`,
              text: block.text || '',
              type: block.type || 'paragraph',
              level: block.level || null,
              boundingBox: {
                x: block.x || 50,
                y: Math.max(0, yFromBottom), // Y from bottom in PDF coordinates
                width: block.width || (pageWidth - 100),
                height: block.height || 20,
                pageNumber: pageNumber
              },
            fontSize,
              fontName: 'Arial', // Default
              isBold: block.type === 'heading' || false,
              isItalic: false,
              readingOrder: index
            };
          });
          
          // Filter out empty blocks
          blocks = blocks.filter(b => b.text && b.text.trim().length > 0);
          
          console.log(`[Page ${pageNumber}] AI created ${blocks.length} structured text blocks`);
          CircuitBreakerService.recordSuccess('Gemini');
          
          return blocks;
        } catch (parseError) {
          console.warn(`[Page ${pageNumber}] Failed to parse AI response as JSON:`, parseError.message);
          console.warn(`[Page ${pageNumber}] Response was:`, responseText.substring(0, 200));
          CircuitBreakerService.recordFailure('Gemini', false);
          // Fallback to simple blocks
          return this.createSimpleTextBlocks(text, pageNumber, pageWidth, pageHeight);
        }
      } catch (error) {
        const is429 = error?.status === 429 || error?.statusCode === 429;
        const isTimeout = error?.message?.includes('timeout');
        
        if (is429) {
          CircuitBreakerService.recordFailure('Gemini', true);
          console.warn(`[Page ${pageNumber}] 429 error during text block creation`);
        } else if (isTimeout) {
          console.warn(`[Page ${pageNumber}] Text block creation timed out`);
          CircuitBreakerService.recordFailure('Gemini', false);
        } else {
          console.error(`[Page ${pageNumber}] Error creating text blocks:`, error.message);
          CircuitBreakerService.recordFailure('Gemini', false);
        }
        
        // Fallback to simple blocks
        return this.createSimpleTextBlocks(text, pageNumber, pageWidth, pageHeight);
      }
    }, 2);

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } catch (error) {
      if (error?.message?.includes('timeout')) {
        console.error(`[Page ${pageNumber}] Text block creation timed out, using simple blocks`);
        CircuitBreakerService.recordFailure('Gemini', false);
      }
      return this.createSimpleTextBlocks(text, pageNumber, pageWidth, pageHeight);
    }
  }

  /**
   * Create simple text blocks as fallback (without AI)
   * @param {string} text - Plain text content
   * @param {number} pageNumber - Page number
   * @param {number} pageWidth - Page width in points
   * @param {number} pageHeight - Page height in points
   * @returns {Array} Array of simple text block objects
   */
  static createSimpleTextBlocks(text, pageNumber, pageWidth = 612, pageHeight = 792) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    if (paragraphs.length === 0 && text.trim().length > 0) {
      // Single block with all text
      paragraphs.push(text.trim());
    }
    
    return paragraphs.map((paragraph, index) => {
      // Detect if this might be a heading (short, all caps, or starts with number)
      let type = 'paragraph';
      let level = null;
      const trimmed = paragraph.trim();
      if (trimmed.length < 100) {
        if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) {
          type = 'heading';
          level = 2;
        } else if (trimmed.match(/^(Chapter|Section|Part)\s+\d+/i)) {
          type = 'heading';
          level = 1;
        } else if (trimmed.match(/^\d+\.\s+[A-Z]/)) {
          type = 'heading';
          level = 2;
        }
      }
      
      return {
        id: `simple_block_${pageNumber}_${index}`,
        text: trimmed,
        type: type,
        level: level,
        // Mark as simple so we can render in flow layout (no absolute positioning)
        isSimple: true,
        boundingBox: null,
        fontSize: type === 'heading' ? 24 : 22,
        fontName: 'Arial',
        isBold: type === 'heading',
        isItalic: false,
        readingOrder: index
      };
    });
  }

  /**
   * Generate table of contents from structured content
   * @param {Object} structuredContent - Structured content from structureContent
   * @returns {Promise<Array>} Table of contents items
   */
  static async generateTOC(structuredContent) {
    if (!structuredContent?.structured?.chapters) {
      return [];
    }

    const toc = [];
    structuredContent.structured.chapters.forEach((chapter, idx) => {
      toc.push({
        level: 1,
        title: chapter.title,
        page: chapter.startPage,
        id: `chapter-${idx + 1}`
      });

      if (chapter.sections) {
        chapter.sections.forEach((section, sidx) => {
          toc.push({
            level: 2,
            title: section.title,
            page: section.startPage,
            id: `chapter-${idx + 1}-section-${sidx + 1}`
          });
        });
      }
    });

    return toc;
  }

  /**
   * Extract HTML directly from Word document using AI
   * Sends the Word document file directly to Gemini for extraction and conversion
   * @param {string} docxFilePath - Path to the Word document file
   * @param {Object} options - Options for extraction
   * @returns {Promise<Object>} Object with pages array containing HTML and text blocks
   */
  static async extractHtmlFromWordDocument(docxFilePath, options = {}) {
    const client = this.getClient();
    if (!client) {
      throw new Error('Gemini API not available');
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      throw new Error('Gemini API circuit breaker is OPEN');
    }

    try {
      console.log(`[Gemini] Reading Word document file: ${docxFilePath}`);
      const fileBuffer = await fs.readFile(docxFilePath);
      const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);
      console.log(`[Gemini] Word document size: ${fileSizeMB} MB`);

      // Check file size limit (Gemini has ~20MB limit for file uploads)
      if (fileBuffer.length > 20 * 1024 * 1024) {
        throw new Error(`Word document is too large (${fileSizeMB} MB). Maximum size is 20 MB.`);
      }

      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      console.log(`[Gemini] Using model: ${modelName}`);
      const model = client.getGenerativeModel({ model: modelName });

      console.log(`[Gemini] Uploading Word document to Gemini for HTML extraction...`);
      
      // Note: Gemini API may not support Word documents directly via inlineData
      // We'll try it, but it may fail and fall back to mammoth
      const fileData = {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      };

      const prompt = `You are an expert at extracting and converting Word documents to HTML/XHTML while preserving EXACT visual appearance, formatting, layout, structure, fonts, colors, images, styles, positions, and alignment.

**CRITICAL REQUIREMENTS - Preserve EVERYTHING EXACTLY AS IT APPEARS:**

1. **EXACT VISUAL APPEARANCE - PIXEL PERFECT**:
   - The output HTML must look IDENTICAL to the original Word document when rendered
   - Every element must be positioned EXACTLY where it appears in the document
   - Preserve exact pixel positions using position: absolute with precise left, top, width, height values
   - Calculate positions from the document's coordinate system (top-left origin)
   - Preserve all spacing, margins, padding, borders EXACTLY as shown
   - Maintain relative positioning between elements to match the original layout

2. **EXACT STRUCTURE & LAYOUT**:
   - Preserve document structure exactly: headers, paragraphs, lists, tables, sections
   - Use semantic HTML: h1-h6 for headings, p for paragraphs, ul/ol/li for lists
   - Preserve table structures (table, thead, tbody, tr, td, th) with EXACT styling and dimensions
   - Preserve table cell widths, heights, borders, padding, alignment
   - Use div containers for complex layouts with exact positioning
   - Split content into pages based on page breaks (---PAGE BREAK--- markers)
   - Preserve page margins, headers, footers exactly

3. **EXACT FONTS - PRESERVE EVERY DETAIL**:
   - Preserve font-family EXACTLY as specified (e.g., 'Arial', 'Times New Roman', 'Calibri', 'Verdana')
   - Preserve font-size EXACTLY in pixels (px) or points (pt) - use the exact size from the document
   - Preserve font-weight EXACTLY: bold, normal, or numeric values (100-900)
   - Preserve font-style EXACTLY: italic, normal, oblique
   - Preserve text-decoration EXACTLY: underline, none, line-through, overline
   - Preserve font-variant: small-caps, normal
   - Preserve letter-spacing, word-spacing EXACTLY
   - Preserve line-height EXACTLY (e.g., 1.5, 1.2, or specific pixel values)

4. **EXACT COLORS - MATCH EVERY COLOR**:
   - Preserve text colors EXACTLY using color: #hex (e.g., #FF0000, #000000, #333333)
   - Preserve background colors EXACTLY using background-color: #hex
   - Preserve border colors EXACTLY using border-color: #hex
   - Preserve highlight colors if present
   - Use EXACT color values from the document - do not approximate or change colors
   - Preserve transparency/opacity if present (rgba values)

5. **EXACT IMAGES - PRESERVE EVERYTHING**:
   - Extract ALL images and include as base64 data URIs: src="data:image/png;base64,..."
   - Preserve EXACT image positions (left, top coordinates in pixels)
   - Preserve EXACT image sizes (width, height in pixels)
   - Preserve image styling: borders, padding, margins, alignment
   - Preserve image aspect ratios exactly
   - Include alt text for accessibility
   - Preserve image wrapping (text around images) if present
   - Preserve image rotation if present

6. **EXACT STYLES & ALIGNMENT - EVERY DETAIL**:
   - Use inline styles for ALL formatting - do not use CSS classes
   - Preserve text-align EXACTLY: left, center, right, justify
   - Preserve vertical-align EXACTLY: top, middle, bottom, baseline
   - Preserve line-height EXACTLY (specific values, not approximations)
   - Preserve letter-spacing EXACTLY (specific pixel or em values)
   - Preserve word-spacing EXACTLY
   - Preserve borders EXACTLY: width, style, color for all sides
   - Preserve padding EXACTLY: top, right, bottom, left (specific pixel values)
   - Preserve margins EXACTLY: top, right, bottom, left (specific pixel values)
   - Preserve box-shadow if present
   - Preserve text-shadow if present
   - Preserve white-space handling (pre, nowrap, normal)

7. **EXACT POSITIONING - PIXEL PERFECT**:
   - Use position: absolute for elements that need exact placement
   - Calculate EXACT pixel coordinates from the document
   - Preserve z-index for layering (elements on top of others)
   - Preserve float properties if present (left, right, none)
   - Preserve clear properties if present
   - Preserve transform properties if present (rotation, scaling)

8. **EXACT TEXT CONTENT**:
   - Preserve ALL text exactly as it appears - do not modify, summarize, or change text
   - Preserve special characters, symbols, emojis exactly
   - Preserve whitespace and line breaks where important
   - Preserve text formatting within paragraphs (bold, italic, underline within text)
   - Preserve hyperlinks with exact URLs and display text

**Output Format:**
- Return a JSON object with this structure:
{
  "pages": [
    {
      "pageNumber": 1,
      "html": "<div class=\"word-content\" style=\"position: relative; width: 792px; height: 612px; background: white;\"><h1 style=\"position: absolute; left: 72px; top: 72px; font-family: 'Arial'; font-size: 24px; font-weight: bold; color: #000000; text-align: left;\">Title</h1><p style=\"position: absolute; left: 72px; top: 120px; width: 648px; font-family: 'Times New Roman'; font-size: 12px; color: #333333; line-height: 1.5; text-align: justify;\">Content...</p><img src=\"data:image/png;base64,...\" style=\"position: absolute; left: 200px; top: 300px; width: 200px; height: 150px;\" alt=\"Description\"/></div>",
      "text": "All text content on this page",
      "textBlocks": [
        {
          "id": "block_1_0",
          "text": "Text content",
          "type": "paragraph",
          "readingOrder": 0
        }
      ]
    }
  ],
  "totalPages": 1,
  "metadata": {
    "title": "Document Title",
    "language": "en"
  }
}

**CRITICAL OUTPUT REQUIREMENTS:**
- Each page's HTML must be valid XHTML (all tags closed, attributes quoted)
- Use ONLY inline styles - NEVER use CSS classes or external stylesheets
- Every element MUST have explicit positioning and styling
- Use position: absolute with EXACT pixel coordinates (left, top, width, height)
- Preserve EXACT font sizes, colors, spacing, alignment
- Include ALL images as base64 data URIs with EXACT positions and sizes
- Split the document into pages based on page breaks
- Extract text blocks for each page for TTS functionality
- The rendered HTML must look IDENTICAL to the original Word document

**Example of exact preservation:**
- If text is at position (72px, 144px) in the document, use: style="position: absolute; left: 72px; top: 144px; ..."
- If font is 'Arial' 14pt bold red, use: style="font-family: 'Arial'; font-size: 14pt; font-weight: bold; color: #FF0000; ..."
- If image is 200x150px at (300px, 400px), use: <img style="position: absolute; left: 300px; top: 400px; width: 200px; height: 150px; ..."/>

Analyze the Word document VERY CAREFULLY and extract HTML that preserves EVERYTHING EXACTLY as it appears - pixel positions, fonts, colors, sizes, spacing, images, structure, layout, alignment. The output must be visually IDENTICAL to the original document.`;

      console.log(`[Gemini] Calling Gemini API for Word document HTML extraction (this may take 30-90 seconds)...`);
      const startTime = Date.now();
      
      // Add timeout wrapper (180 seconds max for full document processing)
      const timeoutMs = 180000; // 3 minutes
      const apiCall = this.generateWithBackoff(model, [
        { text: prompt },
        fileData
      ], options.priority || 1);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs/1000}s`)), timeoutMs);
      });
      
      const result = await Promise.race([apiCall, timeoutPromise]);
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Gemini] API call completed in ${elapsedTime}s`);

      if (!result) {
        throw new Error('Gemini API call failed or was rate limited');
      }

      console.log(`[Gemini] Processing response...`);
      const response = await result.response;
      let responseText = response.text() || '';
      console.log(`[Gemini] Received ${(responseText.length / 1024).toFixed(2)} KB of response`);

      // Try to parse JSON from response
      let extractedData;
      try {
        // Remove markdown code blocks if present
        responseText = responseText
          .replace(/```json\n?/gi, '')
          .replace(/```\n?/g, '')
          .trim();
        
        extractedData = JSON.parse(responseText);
      } catch (parseError) {
        console.warn('[Gemini] Could not parse JSON response, trying to extract HTML directly...');
        // Fallback: treat entire response as HTML for page 1
        extractedData = {
          pages: [{
            pageNumber: 1,
            html: responseText,
            text: responseText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
            textBlocks: []
          }],
          totalPages: 1,
          metadata: { title: 'Extracted Document', language: 'en' }
        };
      }

      // Extract text blocks from HTML if not provided
      if (extractedData.pages) {
        for (const page of extractedData.pages) {
          if (!page.textBlocks || page.textBlocks.length === 0) {
            page.textBlocks = this.extractTextBlocksFromHtml(page.html || '', page.pageNumber);
          }
          if (!page.text) {
            page.text = page.textBlocks.map(b => b.text).join(' ').trim();
          }
        }
      }

      return {
        pages: extractedData.pages || [],
        totalPages: extractedData.totalPages || extractedData.pages?.length || 1,
        metadata: extractedData.metadata || { title: 'Extracted Document', language: 'en' },
        allText: extractedData.pages?.map(p => p.text).join('\n\n') || ''
      };
    } catch (error) {
      console.error(`[Gemini] Error extracting HTML from Word document:`, error);
      throw error;
    }
  }

  /**
   * Convert Word document page HTML to enhanced HTML/XHTML with full formatting preservation
   * Uses Gemini to enhance and format the HTML directly (faster than image-based conversion)
   * @param {string} pageHtml - HTML content for the page
   * @param {number} pageNumber - Page number
   * @param {Object} options - Options for HTML generation
   * @returns {Promise<Object>} Object with html, textBlocks, and metadata
   */
  static async convertWordPageHtmlToEnhancedHtml(pageHtml, pageNumber, options = {}) {
    const client = this.getClient();
    if (!client) {
      throw new Error('Gemini API not available');
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      throw new Error('Gemini API circuit breaker is OPEN');
    }

    try {
      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      console.log(`[Gemini] Using model: ${modelName} for page ${pageNumber}`);
      const model = client.getGenerativeModel({ model: modelName });
      
      console.log(`[Gemini] Preparing HTML enhancement request for page ${pageNumber}...`);
      const htmlSizeKB = (pageHtml.length / 1024).toFixed(0);
      console.log(`[Gemini] HTML size: ${htmlSizeKB} KB`);

      const prompt = `You are an expert at enhancing Word document HTML to XHTML while preserving EXACT visual appearance, formatting, layout, structure, fonts, colors, images, styles, positions, and alignment. The output must look IDENTICAL to the original.

**CRITICAL REQUIREMENTS - Preserve EVERYTHING EXACTLY AS IT APPEARS:**

1. **EXACT VISUAL APPEARANCE - PIXEL PERFECT**:
   - The output HTML must look IDENTICAL to the original when rendered
   - Every element must be positioned EXACTLY where it appears
   - Preserve exact pixel positions using position: absolute with precise left, top, width, height values
   - Preserve all spacing, margins, padding, borders EXACTLY as shown
   - Maintain relative positioning between elements to match the original layout

2. **EXACT STRUCTURE & LAYOUT**:
   - Preserve document structure exactly: headers, paragraphs, lists, tables, sections
   - Use semantic HTML: h1-h6 for headings, p for paragraphs, ul/ol/li for lists
   - Preserve table structures (table, thead, tbody, tr, td, th) with EXACT styling and dimensions
   - Preserve table cell widths, heights, borders, padding, alignment
   - Use div containers for complex layouts with exact positioning

3. **EXACT FONTS - PRESERVE EVERY DETAIL**:
   - Preserve font-family EXACTLY as specified (e.g., 'Arial', 'Times New Roman', 'Calibri', 'Verdana')
   - Preserve font-size EXACTLY in pixels (px) or points (pt) - use the exact size
   - Preserve font-weight EXACTLY: bold, normal, or numeric values (100-900)
   - Preserve font-style EXACTLY: italic, normal, oblique
   - Preserve text-decoration EXACTLY: underline, none, line-through, overline
   - Preserve font-variant: small-caps, normal
   - Preserve letter-spacing, word-spacing EXACTLY
   - Preserve line-height EXACTLY (e.g., 1.5, 1.2, or specific pixel values)

4. **EXACT COLORS - MATCH EVERY COLOR**:
   - Preserve text colors EXACTLY using color: #hex (e.g., #FF0000, #000000, #333333)
   - Preserve background colors EXACTLY using background-color: #hex
   - Preserve border colors EXACTLY using border-color: #hex
   - Preserve highlight colors if present
   - Use EXACT color values - do not approximate or change colors
   - Preserve transparency/opacity if present (rgba values)

5. **EXACT IMAGES - PRESERVE EVERYTHING**:
   - Preserve ALL images as base64 data URIs: src="data:image/png;base64,..."
   - Preserve EXACT image positions (left, top coordinates in pixels)
   - Preserve EXACT image sizes (width, height in pixels)
   - Preserve image styling: borders, padding, margins, alignment
   - Preserve image aspect ratios exactly
   - Include alt text for accessibility
   - Preserve image wrapping (text around images) if present
   - Preserve image rotation if present

6. **EXACT STYLES & ALIGNMENT - EVERY DETAIL**:
   - Use inline styles for ALL formatting - do not use CSS classes
   - Preserve text-align EXACTLY: left, center, right, justify
   - Preserve vertical-align EXACTLY: top, middle, bottom, baseline
   - Preserve line-height EXACTLY (specific values, not approximations)
   - Preserve letter-spacing EXACTLY (specific pixel or em values)
   - Preserve word-spacing EXACTLY
   - Preserve borders EXACTLY: width, style, color for all sides
   - Preserve padding EXACTLY: top, right, bottom, left (specific pixel values)
   - Preserve margins EXACTLY: top, right, bottom, left (specific pixel values)
   - Preserve box-shadow if present
   - Preserve text-shadow if present
   - Preserve white-space handling (pre, nowrap, normal)

7. **EXACT POSITIONING - PIXEL PERFECT**:
   - Use position: absolute for elements that need exact placement
   - Calculate EXACT pixel coordinates from the document
   - Preserve z-index for layering (elements on top of others)
   - Preserve float properties if present (left, right, none)
   - Preserve clear properties if present
   - Preserve transform properties if present (rotation, scaling)

8. **EXACT TEXT CONTENT**:
   - Preserve ALL text exactly as it appears - do not modify, summarize, or change text
   - Preserve special characters, symbols, emojis exactly
   - Preserve whitespace and line breaks where important
   - Preserve text formatting within paragraphs (bold, italic, underline within text)
   - Preserve hyperlinks with exact URLs and display text

**Input HTML:**
${pageHtml}

**Output Format:**
- Return ONLY the XHTML body content (no <html>, <head>, <body> tags)
- Start with a container div: <div class="word-content" style="position: relative; width: [width]px; height: [height]px; background: white;">
- Use valid XHTML (all tags must be closed, attributes quoted)
- Use ONLY inline styles - NEVER use CSS classes or external stylesheets
- Every element MUST have explicit positioning and styling
- Use position: absolute with EXACT pixel coordinates (left, top, width, height)
- Preserve EXACT font sizes, colors, spacing, alignment
- Include ALL images as base64 data URIs with EXACT positions and sizes
- The rendered HTML must look IDENTICAL to the original

**Example of exact preservation:**
- If text is at position (72px, 144px), use: style="position: absolute; left: 72px; top: 144px; ..."
- If font is 'Arial' 14pt bold red, use: style="font-family: 'Arial'; font-size: 14pt; font-weight: bold; color: #FF0000; ..."
- If image is 200x150px at (300px, 400px), use: <img style="position: absolute; left: 300px; top: 400px; width: 200px; height: 150px; ..."/>

Analyze the HTML VERY CAREFULLY and generate enhanced XHTML that preserves EVERYTHING EXACTLY as it appears - pixel positions, fonts, colors, sizes, spacing, images, structure, layout, alignment. The output must be visually IDENTICAL to the original.`;

      console.log(`[Gemini] Calling Gemini API for page ${pageNumber} HTML enhancement (this may take 10-30 seconds)...`);
      const startTime = Date.now();
      
      // Add timeout wrapper (60 seconds max for HTML processing - faster than images)
      const timeoutMs = 60000; // 1 minute
      const apiCall = this.generateWithBackoff(model, [
        { text: prompt }
      ], options.priority || 1);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs/1000}s`)), timeoutMs);
      });
      
      const result = await Promise.race([apiCall, timeoutPromise]);
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Gemini] API call completed for page ${pageNumber} in ${elapsedTime}s`);

      if (!result) {
        throw new Error('Gemini API call failed or was rate limited');
      }

      console.log(`[Gemini] Processing response for page ${pageNumber}...`);
      const response = await result.response;
      let htmlContent = response.text() || '';
      console.log(`[Gemini] Received ${(htmlContent.length / 1024).toFixed(2)} KB of HTML for page ${pageNumber}`);

      // Clean up the response - remove markdown code blocks if present
      htmlContent = htmlContent
        .replace(/```html\n?/gi, '')
        .replace(/```xhtml\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

      // Extract text blocks from the HTML for TTS
      const textBlocks = this.extractTextBlocksFromHtml(htmlContent, pageNumber);

      return {
        html: htmlContent,
        textBlocks: textBlocks,
        pageNumber: pageNumber,
        width: options.width || 792,
        height: options.height || 612
      };
    } catch (error) {
      console.error(`[Gemini] Error converting Word page ${pageNumber} HTML to enhanced HTML:`, error);
      throw error;
    }
  }

  /**
   * Convert Word document page image to HTML/XHTML with full formatting preservation
   * Uses Gemini vision to analyze the page and generate perfectly formatted HTML
   * @param {string} imagePath - Path to the page image
   * @param {number} pageNumber - Page number
   * @param {Object} options - Options for HTML generation
   * @returns {Promise<Object>} Object with html, textBlocks, and metadata
   */
  static async convertWordPageImageToHtml(imagePath, pageNumber, options = {}) {
    const client = this.getClient();
    if (!client) {
      throw new Error('Gemini API not available');
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      throw new Error('Gemini API circuit breaker is OPEN');
    }

    try {
      console.log(`[Gemini] Reading image file for page ${pageNumber}...`);
      const imageBuffer = await fs.readFile(imagePath);
      const imageSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
      const imageSizeKB = (imageBuffer.length / 1024).toFixed(0);
      console.log(`[Gemini] Image size: ${imageSizeMB} MB (${imageSizeKB} KB)`);
      
      // Check if image is too large (Gemini has ~20MB limit for base64)
      if (imageBuffer.length > 15 * 1024 * 1024) { // 15MB warning
        console.warn(`[Gemini] Warning: Image is large (${imageSizeMB} MB). This may cause slow responses.`);
      }
      
      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      console.log(`[Gemini] Using model: ${modelName}`);
      const model = client.getGenerativeModel({ model: modelName });
      
      console.log(`[Gemini] Preparing API request for page ${pageNumber}...`);
      console.log(`[Gemini] Encoding image to base64...`);
      const base64Start = Date.now();
      const base64Image = imageBuffer.toString('base64');
      const base64Time = ((Date.now() - base64Start) / 1000).toFixed(2);
      const base64SizeKB = (base64Image.length / 1024).toFixed(0);
      console.log(`[Gemini] Base64 encoding completed in ${base64Time}s (size: ${base64SizeKB} KB)`);

      const prompt = `You are an expert at converting Word document pages to HTML/XHTML while preserving EXACT formatting, layout, structure, fonts, colors, images, styles, positions, and alignment.

**CRITICAL REQUIREMENTS - Preserve EVERYTHING:**

1. **Layout & Positioning**: 
   - Exact pixel positioning using position: absolute with left, top, width, height
   - Preserve all spacing, margins, padding exactly as shown
   - Maintain relative positioning between elements

2. **Structure**: 
   - Use semantic HTML: h1-h6 for headings, p for paragraphs, ul/ol/li for lists
   - Preserve table structures (table, thead, tbody, tr, td, th) with exact styling
   - Use div containers for complex layouts

3. **Fonts**: 
   - Preserve font-family exactly (e.g., 'Arial', 'Times New Roman', 'Calibri')
   - Preserve font-size in pixels (px) or points (pt)
   - Preserve font-weight: bold, normal, or numeric values (100-900)
   - Preserve font-style: italic, normal
   - Preserve text-decoration: underline, none, etc.

4. **Colors**: 
   - Preserve text colors using color: #hex (e.g., #FF0000, #000000)
   - Preserve background colors using background-color: #hex
   - Preserve border colors using border-color: #hex
   - Use exact color values as shown in the image

5. **Images**: 
   - Extract images and include as base64 data URIs: src="data:image/png;base64,..."
   - Preserve exact image positions, sizes, and styling
   - Include alt text for accessibility

6. **Styles & Alignment**: 
   - Use inline styles for ALL formatting
   - Preserve text-align: left, center, right, justify
   - Preserve vertical-align where applicable
   - Preserve line-height, letter-spacing, word-spacing
   - Preserve borders, padding, margins exactly

7. **Positioning**: 
   - Use position: absolute for elements that need exact placement
   - Calculate pixel coordinates from the image (left, top values)
   - Preserve z-index for layering

**Output Format:**
- Return ONLY the XHTML body content (no <html>, <head>, <body> tags)
- Start with a container div: <div class="word-content" style="position: relative; width: [width]px; height: [height]px; background: white;">
- Use valid XHTML (all tags must be closed, attributes quoted)
- Preserve ALL inline styles - do not use CSS classes
- Ensure all text is extracted and properly structured

**Example:**
<div class="word-content" style="position: relative; width: 1654px; height: 2339px; background: white;">
  <h1 style="position: absolute; left: 144px; top: 144px; font-family: 'Arial Black'; font-size: 32px; font-weight: bold; color: #FF0000; text-align: left;">Chapter Title</h1>
  <p style="position: absolute; left: 144px; top: 240px; width: 1366px; font-family: 'Times New Roman'; font-size: 14px; color: #000000; line-height: 1.6; text-align: justify;">Paragraph text with exact formatting...</p>
  <img src="data:image/png;base64,iVBORw0KG..." style="position: absolute; left: 400px; top: 600px; width: 400px; height: 300px;" alt="Image description"/>
</div>

Analyze the image carefully and generate XHTML that matches it EXACTLY.`;

      console.log(`[Gemini] Calling Gemini API for page ${pageNumber} (this may take 30-120 seconds for large images)...`);
      const startTime = Date.now();
      
      // Add timeout wrapper (120 seconds max)
      const timeoutMs = 120000; // 2 minutes
      const apiCall = this.generateWithBackoff(model, [
        { text: prompt },
        {
          inlineData: {
            data: base64Image,
            mimeType: 'image/png'
          }
        }
      ], options.priority || 1);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs/1000}s`)), timeoutMs);
      });
      
      const result = await Promise.race([apiCall, timeoutPromise]);
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Gemini] API call completed for page ${pageNumber} in ${elapsedTime}s`);

      if (!result) {
        throw new Error('Gemini API call failed or was rate limited');
      }

      console.log(`[Gemini] Processing response for page ${pageNumber}...`);
      const response = await result.response;
      let htmlContent = response.text() || '';
      console.log(`[Gemini] Received ${(htmlContent.length / 1024).toFixed(2)} KB of HTML for page ${pageNumber}`);

      // Clean up the response - remove markdown code blocks if present
      htmlContent = htmlContent
        .replace(/```html\n?/gi, '')
        .replace(/```xhtml\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

      // Extract text blocks from the HTML for TTS
      const textBlocks = this.extractTextBlocksFromHtml(htmlContent, pageNumber);

      return {
        html: htmlContent,
        textBlocks: textBlocks,
        pageNumber: pageNumber,
        width: options.width || 792,
        height: options.height || 612
      };
    } catch (error) {
      console.error(`[Gemini] Error converting Word page ${pageNumber} to HTML:`, error);
      throw error;
    }
  }

  /**
   * Extract text blocks from HTML content for TTS
   * @param {string} htmlContent - HTML content
   * @param {number} pageNumber - Page number
   * @returns {Array} Array of text blocks
   */
  static extractTextBlocksFromHtml(htmlContent, pageNumber) {
    // Simple extraction - get all text from paragraphs, headings, etc.
    // This is a basic implementation; can be enhanced
    const blocks = [];
    const textRegex = /<(p|h[1-6]|li|td|th)[^>]*>(.*?)<\/\1>/gi;
    let match;
    let blockIndex = 0;

    while ((match = textRegex.exec(htmlContent)) !== null) {
      const tag = match[1].toLowerCase();
      const content = match[2];
      const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      if (text.length > 0) {
        blocks.push({
          id: `block_${pageNumber}_${blockIndex}`,
          text: text,
          type: tag.startsWith('h') ? 'heading' : 'paragraph',
          readingOrder: blockIndex
        });
        blockIndex++;
      }
    }

    return blocks;
  }
}

