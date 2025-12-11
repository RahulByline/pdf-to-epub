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
            charCount: pageText.length
          });
        }
      }

      if (pages.length === 0) {
        return null;
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
}

