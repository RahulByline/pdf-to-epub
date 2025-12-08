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
Do not skip pages; include empty pages as "---PAGE {n}---" followed by nothing if blank.`;

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

