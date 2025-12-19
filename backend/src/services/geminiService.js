import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { RateLimiterService } from './rateLimiterService.js';
import { RequestQueueService } from './requestQueueService.js';
import { CircuitBreakerService } from './circuitBreakerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

/**
 * Service for interacting with Google Gemini AI
 */
export class GeminiService {
  static _client = null;

  /**
   * Sanitize XHTML to fix common issues like duplicate attributes
   * @param {string} xhtml - XHTML content
   * @returns {string} - Sanitized XHTML
   */
  static sanitizeXhtml(xhtml) {
    if (!xhtml || typeof xhtml !== 'string') return xhtml;
    
    // Fix duplicate class attributes: <div class="foo" class="bar"> -> <div class="foo bar">
    // This regex finds tags with duplicate class attributes
    xhtml = xhtml.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)class="([^"]*)"([^>]*?)class="([^"]*)"([^>]*)>/gi, 
      (match, tagName, before, class1, middle, class2, after) => {
        // Merge the classes
        const mergedClasses = `${class1} ${class2}`.trim();
        // Remove any duplicate class attributes from middle/after sections
        let cleanMiddle = middle.replace(/\s*class="[^"]*"\s*/gi, ' ');
        let cleanAfter = after.replace(/\s*class="[^"]*"\s*/gi, ' ');
        return `<${tagName} ${before}class="${mergedClasses}"${cleanMiddle}${cleanAfter}>`;
      }
    );
    
    // Run again in case there were more than 2 class attributes
    xhtml = xhtml.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)class="([^"]*)"([^>]*?)class="([^"]*)"([^>]*)>/gi, 
      (match, tagName, before, class1, middle, class2, after) => {
        const mergedClasses = `${class1} ${class2}`.trim();
        let cleanMiddle = middle.replace(/\s*class="[^"]*"\s*/gi, ' ');
        let cleanAfter = after.replace(/\s*class="[^"]*"\s*/gi, ' ');
        return `<${tagName} ${before}class="${mergedClasses}"${cleanMiddle}${cleanAfter}>`;
      }
    );
    
    // Fix duplicate id attributes (keep only the first one)
    xhtml = xhtml.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)id="([^"]*)"([^>]*?)id="[^"]*"([^>]*)>/gi, 
      (match, tagName, before, id, middle, after) => {
        // Remove duplicate id attributes from middle/after
        let cleanMiddle = middle.replace(/\s*id="[^"]*"\s*/gi, ' ');
        let cleanAfter = after.replace(/\s*id="[^"]*"\s*/gi, ' ');
        return `<${tagName} ${before}id="${id}"${cleanMiddle}${cleanAfter}>`;
      }
    );
    
    // Fix duplicate style attributes (merge them)
    xhtml = xhtml.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)style="([^"]*)"([^>]*?)style="([^"]*)"([^>]*)>/gi, 
      (match, tagName, before, style1, middle, style2, after) => {
        // Merge styles, ensuring proper semicolon separation
        let mergedStyles = style1.trim();
        if (mergedStyles && !mergedStyles.endsWith(';')) mergedStyles += ';';
        mergedStyles += ' ' + style2.trim();
        let cleanMiddle = middle.replace(/\s*style="[^"]*"\s*/gi, ' ');
        let cleanAfter = after.replace(/\s*style="[^"]*"\s*/gi, ' ');
        return `<${tagName} ${before}style="${mergedStyles}"${cleanMiddle}${cleanAfter}>`;
      }
    );
    
    // Clean up multiple spaces
    xhtml = xhtml.replace(/\s+>/g, '>');
    xhtml = xhtml.replace(/<(\w+)\s+/g, '<$1 ');
    
    return xhtml;
  }

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

  // Cache for late responses (responses that arrive after timeout)
  static lateResponseCache = new Map();
  static LATE_RESPONSE_GRACE_PERIOD = 30000; // 30 seconds grace period
  static LATE_RESPONSE_CACHE_TTL = 300000; // 5 minutes TTL for cached responses

  /**
   * Generate a cache key for a page conversion
   */
  static getCacheKey(imagePath, pageNumber) {
    return `${imagePath}:${pageNumber}`;
  }

  /**
   * Store a late response in the cache
   */
  static storeLateResponse(cacheKey, response) {
    this.lateResponseCache.set(cacheKey, {
      response,
      timestamp: Date.now()
    });
    console.log(`[LateResponseCache] Stored late response for ${cacheKey}`);
    
    // Clean up old entries
    this.cleanupLateResponseCache();
  }

  /**
   * Get a late response from the cache if available and not expired
   */
  static getLateResponse(cacheKey) {
    const cached = this.lateResponseCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.LATE_RESPONSE_CACHE_TTL) {
        console.log(`[LateResponseCache] Retrieved cached response for ${cacheKey} (age: ${Math.round(age/1000)}s)`);
        this.lateResponseCache.delete(cacheKey); // Remove after use
        return cached.response;
      } else {
        // Expired, remove it
        this.lateResponseCache.delete(cacheKey);
      }
    }
    return null;
  }

  /**
   * Clean up expired entries from the late response cache
   */
  static cleanupLateResponseCache() {
    const now = Date.now();
    for (const [key, value] of this.lateResponseCache.entries()) {
      if (now - value.timestamp > this.LATE_RESPONSE_CACHE_TTL) {
        this.lateResponseCache.delete(key);
      }
    }
  }

  /**
   * Process raw response from Gemini API and extract XHTML
   * This is extracted to a separate method for reuse in late response capture
   * @param {string} rawResponse - Raw response text from Gemini
   * @param {number} pageNumber - Page number for logging
   * @returns {{xhtml: string, css: string, pageNumber: number}|null}
   */
  static processRawResponse(rawResponse, pageNumber) {
    if (!rawResponse) return null;

    try {
      let responseContent = rawResponse.trim();
      
      // Remove markdown code blocks if present (handle various formats)
      // Match: ```xml, ```html, ```xhtml, ```, or just ``` with optional language
      const codeBlockPatterns = [
        /```(?:xml|html|xhtml)?\s*\n?([\s\S]*?)\n?```/g,  // Standard markdown code blocks
        /```\s*\n?([\s\S]*?)\n?```/g,  // Generic code blocks
        /`([^`]+)`/g  // Inline code (less likely but possible)
      ];
      
      for (const pattern of codeBlockPatterns) {
        const matches = responseContent.match(pattern);
        if (matches && matches.length > 0) {
          // Extract content from the first (largest) code block
          const codeBlockMatch = responseContent.match(/```(?:xml|html|xhtml)?\s*\n?([\s\S]*?)\n?```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            responseContent = codeBlockMatch[1].trim();
            console.log(`[Page ${pageNumber}] Removed markdown code block wrapper`);
            break;
          }
        }
      }
      
      // Also check for leading/trailing markdown markers and remove them
      responseContent = responseContent.replace(/^```(?:xml|html|xhtml)?\s*\n?/i, '');
      responseContent = responseContent.replace(/\n?```\s*$/i, '');
      responseContent = responseContent.trim();
      
      // Method 1: Direct DOCTYPE to </html> extraction (most reliable)
      const doctypeIdx = responseContent.indexOf('<!DOCTYPE');
      const htmlEndIdx = responseContent.lastIndexOf('</html>');
      
      if (doctypeIdx !== -1 && htmlEndIdx !== -1 && htmlEndIdx > doctypeIdx) {
        let xhtml = responseContent.substring(doctypeIdx, htmlEndIdx + '</html>'.length).trim();
        
        // Unescape any JSON-escaped characters
        xhtml = xhtml.replace(/\\\\/g, '\\');
        xhtml = xhtml.replace(/\\"/g, '"');
        xhtml = xhtml.replace(/\\'/g, "'");
        xhtml = xhtml.replace(/\\n/g, '\n');
        xhtml = xhtml.replace(/\\r/g, '\r');
        xhtml = xhtml.replace(/\\t/g, '\t');
        
        // Normalize DOCTYPE
        const correctDoctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
        xhtml = xhtml.replace(/<!DOCTYPE\s+html[^>]*>/i, correctDoctype);
        
        // Sanitize XHTML
        xhtml = this.sanitizeXhtml(xhtml);
        
        return {
          xhtml,
          css: '',
          pageNumber
        };
      }
      
      // Method 2: Legacy JSON format support
      if (responseContent.startsWith('{') || responseContent.includes('"xhtml"')) {
        try {
          const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && parsed.xhtml) {
              let xhtml = parsed.xhtml;
              xhtml = xhtml.replace(/\\n/g, '\n');
              xhtml = xhtml.replace(/\\r/g, '\r');
              xhtml = xhtml.replace(/\\t/g, '\t');
              xhtml = xhtml.replace(/\\"/g, '"');
              xhtml = xhtml.replace(/\\'/g, "'");
              xhtml = xhtml.replace(/\\\\/g, '\\');
              xhtml = this.sanitizeXhtml(xhtml);
              
              return {
                xhtml,
                css: parsed.css || '',
                pageNumber
              };
            }
          }
        } catch (jsonErr) {
          // Try extracting XHTML from malformed JSON
          const jsonDoctypeIdx = responseContent.indexOf('<!DOCTYPE');
          const jsonHtmlEndIdx = responseContent.lastIndexOf('</html>');
          
          if (jsonDoctypeIdx !== -1 && jsonHtmlEndIdx !== -1 && jsonHtmlEndIdx > jsonDoctypeIdx) {
            let xhtml = responseContent.substring(jsonDoctypeIdx, jsonHtmlEndIdx + '</html>'.length);
            xhtml = xhtml.replace(/\\\\/g, '\\');
            xhtml = xhtml.replace(/\\"/g, '"');
            xhtml = xhtml.replace(/\\'/g, "'");
            xhtml = xhtml.replace(/\\n/g, '\n');
            xhtml = xhtml.replace(/\\r/g, '\r');
            xhtml = xhtml.replace(/\\t/g, '\t');
            
            const correctDoctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
            xhtml = xhtml.replace(/<!DOCTYPE\s+html[^>]*>/i, correctDoctype);
            xhtml = this.sanitizeXhtml(xhtml);
            
            return {
              xhtml,
              css: '',
              pageNumber
            };
          }
        }
      }
      
      // Method 3: Try <html> to </html> if no DOCTYPE found
      const htmlStartIdx = responseContent.indexOf('<html');
      const htmlEnd2Idx = responseContent.lastIndexOf('</html>');
      
      if (htmlStartIdx !== -1 && htmlEnd2Idx !== -1 && htmlEnd2Idx > htmlStartIdx) {
        let xhtml = responseContent.substring(htmlStartIdx, htmlEnd2Idx + '</html>'.length).trim();
        const correctDoctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n';
        xhtml = correctDoctype + xhtml;
        xhtml = this.sanitizeXhtml(xhtml);
        
        return {
          xhtml,
          css: '',
          pageNumber
        };
      }
      
      return null;
    } catch (err) {
      console.error(`[Page ${pageNumber}] Error processing raw response:`, err.message);
      return null;
    }
  }

  /**
   * Convert a PNG image of a PDF page to XHTML 1.0 Strict markup and CSS
   * @param {string} imagePath - Path to the PNG image file
   * @param {number} pageNumber - Page number
   * @returns {Promise<{xhtml: string, css: string}|null>} XHTML and CSS or null if failed
   */
  static async convertPngToXhtml(imagePath, pageNumber) {
    const client = this.getClient();
    if (!client) {
      return null;
    }

    const cacheKey = this.getCacheKey(imagePath, pageNumber);

    // Check for late response from previous timeout
    const cachedResponse = this.getLateResponse(cacheKey);
    if (cachedResponse) {
      console.log(`[Page ${pageNumber}] Using cached late response from previous attempt`);
      return cachedResponse;
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      console.warn(`[Page ${pageNumber}] Circuit breaker is OPEN, skipping XHTML conversion`);
      return null;
    }

    // Wrap entire operation in a timeout
    const overallTimeout = 120000; // 120 seconds max for entire operation
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Overall timeout after 90s')), overallTimeout)
    );

    const operationPromise = RequestQueueService.enqueue('Gemini', async () => {
      // Pre-request rate limit check with retry logic
      let retries = 0;
      const maxRetries = 5;
      const maxTotalWait = 20000;
      let totalWaitTime = 0;
      
      let acquired = false;
      while (!acquired && retries < maxRetries && totalWaitTime < maxTotalWait) {
        acquired = RateLimiterService.acquire('Gemini');
        if (!acquired) {
          const waitTime = RateLimiterService.getTimeUntilNextToken('Gemini');
          if (waitTime > 0 && waitTime < 10000 && (totalWaitTime + waitTime) < maxTotalWait) {
            const actualWait = Math.min(waitTime + 200, maxTotalWait - totalWaitTime);
            console.log(`[Page ${pageNumber}] Waiting ${Math.round(actualWait/1000)}s for rate limit...`);
            await new Promise(resolve => setTimeout(resolve, actualWait));
            totalWaitTime += actualWait;
            retries++;
          } else {
            if (totalWaitTime >= maxTotalWait) {
              console.warn(`[Page ${pageNumber}] Max wait time (20s) exceeded, skipping XHTML conversion`);
            } else {
              console.warn(`[Page ${pageNumber}] Rate limit wait time too long (${Math.round(waitTime/1000)}s), skipping`);
            }
            return null;
          }
        }
      }
      
      if (!acquired) {
        console.warn(`[Page ${pageNumber}] Rate limit retries exhausted, skipping XHTML conversion`);
        return null;
      }

      try {
        console.log(`[Page ${pageNumber}] Reading PNG image for XHTML conversion...`);
        const imageBuffer = await fs.readFile(imagePath);
        
        const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
        const model = client.getGenerativeModel({ model: modelName });

        const prompt = `Analyze the provided image of the worksheet page(s) and generate complete XHTML with ALL CSS embedded inside.

        **THIS IS PAGE ${pageNumber}** - Use this page number in ALL element IDs to ensure global uniqueness.

        **LAYOUT DECISION:**
        1) **TWO-COLUMN (Multi-Page Split):** Use ONLY if the image shows a visible divider line or two distinct page numbers. Use .container with two .page children.
        2) **SINGLE-COLUMN (Default):** Standard single worksheet. Use a single .page element.

        **AUDIO SYNC REQUIREMENTS (MANDATORY) - HIERARCHICAL NESTED STRUCTURE FOR ALL ELEMENTS:**
        - **CRITICAL: ALL text elements must use NESTED hierarchical structure to support word/sentence/paragraph granularity**
        - **STRUCTURE: Parent Element → Sentences → Words (nested hierarchy)**
        - **ID FORMAT: page${pageNumber}_[type][number]_[subtype][number]...**
        
        **HIERARCHICAL STRUCTURE (MANDATORY FOR ALL TEXT ELEMENTS):**
        - **Paragraphs**: <p id="page${pageNumber}_p1" class="paragraph-block" data-read-aloud="true">
          - Inside paragraphs, NEST sentences: <span class="sync-sentence" id="page${pageNumber}_p1_s1" data-read-aloud="true">
          - Inside sentences, NEST words: <span class="sync-word" id="page${pageNumber}_p1_s1_w1" data-read-aloud="true">word</span>
        
        - **Headers (h1-h6)**: <h1 id="page${pageNumber}_h1" data-read-aloud="true">
          - Inside headers, NEST sentences: <span class="sync-sentence" id="page${pageNumber}_h1_s1" data-read-aloud="true">
          - Inside sentences, NEST words: <span class="sync-word" id="page${pageNumber}_h1_s1_w1" data-read-aloud="true">word</span>
        
        - **List Items (li)**: <li id="page${pageNumber}_li1" data-read-aloud="true">
          - Inside list items, NEST sentences: <span class="sync-sentence" id="page${pageNumber}_li1_s1" data-read-aloud="true">
          - Inside sentences, NEST words: <span class="sync-word" id="page${pageNumber}_li1_s1_w1" data-read-aloud="true">word</span>
        
        - **Table Cells (td, th)**: <td id="page${pageNumber}_td1" data-read-aloud="true">
          - Inside table cells, NEST sentences: <span class="sync-sentence" id="page${pageNumber}_td1_s1" data-read-aloud="true">
          - Inside sentences, NEST words: <span class="sync-word" id="page${pageNumber}_td1_s1_w1" data-read-aloud="true">word</span>
        
        - **Headers/Footers**: <header id="page${pageNumber}_header1" data-read-aloud="true">
          - Inside headers/footers, NEST sentences: <span class="sync-sentence" id="page${pageNumber}_header1_s1" data-read-aloud="true">
          - Inside sentences, NEST words: <span class="sync-word" id="page${pageNumber}_header1_s1_w1" data-read-aloud="true">word</span>
        
        - **Divs, Sections, Articles**: <div id="page${pageNumber}_div1" data-read-aloud="true">
          - Inside divs/sections/articles, NEST sentences: <span class="sync-sentence" id="page${pageNumber}_div1_s1" data-read-aloud="true">
          - Inside sentences, NEST words: <span class="sync-word" id="page${pageNumber}_div1_s1_w1" data-read-aloud="true">word</span>
        
        - **This nested structure allows CSS highlighting to work at element, sentence, or word level for ALL elements**
        
        **EXAMPLE STRUCTURE (REQUIRED FORMAT):**
        <p id="page${pageNumber}_p1" class="paragraph-block" data-read-aloud="true">
          <span class="sync-sentence" id="page${pageNumber}_p1_s1" data-read-aloud="true">
            <span class="sync-word" id="page${pageNumber}_p1_s1_w1">If</span>
            <span class="sync-word" id="page${pageNumber}_p1_s1_w2">you</span>
            <span class="sync-word" id="page${pageNumber}_p1_s1_w3">were</span>
            <span class="sync-word" id="page${pageNumber}_p1_s1_w4">a</span>
            <span class="sync-word" id="page${pageNumber}_p1_s1_w5">horse.</span>
          </span>
          <span class="sync-sentence" id="page${pageNumber}_p1_s2" data-read-aloud="true">
            <span class="sync-word" id="page${pageNumber}_p1_s2_w1">You</span>
            <span class="sync-word" id="page${pageNumber}_p1_s2_w2">would</span>
            <span class="sync-word" id="page${pageNumber}_p1_s2_w3">gallop.</span>
          </span>
        </p>
        
        **ID NUMBERING RULES (ALL ELEMENTS FOLLOW HIERARCHY):**
          * Headers: page${pageNumber}_h1, page${pageNumber}_h2, page${pageNumber}_h3 (sequential, regardless of h1-h6 level)
            - Sentences in headers: page${pageNumber}_h{N}_s{N} (e.g., page${pageNumber}_h1_s1, page${pageNumber}_h1_s2)
            - Words in header sentences: page${pageNumber}_h{N}_s{N}_w{N} (e.g., page${pageNumber}_h1_s1_w1, page${pageNumber}_h1_s1_w2)
          * Paragraphs: page${pageNumber}_p1, page${pageNumber}_p2, page${pageNumber}_p3, etc.
            - Sentences in paragraphs: page${pageNumber}_p{N}_s{N} (e.g., page${pageNumber}_p1_s1, page${pageNumber}_p1_s2, page${pageNumber}_p2_s1)
            - Words in paragraph sentences: page${pageNumber}_p{N}_s{N}_w{N} (e.g., page${pageNumber}_p1_s1_w1, page${pageNumber}_p1_s1_w2)
          * List Items: page${pageNumber}_li1, page${pageNumber}_li2, etc.
            - Sentences in list items: page${pageNumber}_li{N}_s{N} (e.g., page${pageNumber}_li1_s1, page${pageNumber}_li1_s2)
            - Words in list item sentences: page${pageNumber}_li{N}_s{N}_w{N} (e.g., page${pageNumber}_li1_s1_w1, page${pageNumber}_li1_s1_w2)
          * Table Cells: page${pageNumber}_td1, page${pageNumber}_td2, etc.
            - Sentences in table cells: page${pageNumber}_td{N}_s{N} (e.g., page${pageNumber}_td1_s1, page${pageNumber}_td1_s2)
            - Words in table cell sentences: page${pageNumber}_td{N}_s{N}_w{N} (e.g., page${pageNumber}_td1_s1_w1, page${pageNumber}_td1_s1_w2)
          * Headers/Footers: page${pageNumber}_header1, page${pageNumber}_footer1, etc.
            - Sentences in headers/footers: page${pageNumber}_header{N}_s{N} (e.g., page${pageNumber}_header1_s1)
            - Words in header/footer sentences: page${pageNumber}_header{N}_s{N}_w{N} (e.g., page${pageNumber}_header1_s1_w1)
          * Divs/Sections: page${pageNumber}_div1, page${pageNumber}_section1, etc.
            - Sentences in divs/sections: page${pageNumber}_div{N}_s{N} (e.g., page${pageNumber}_div1_s1)
            - Words in div/section sentences: page${pageNumber}_div{N}_s{N}_w{N} (e.g., page${pageNumber}_div1_s1_w1)
          * **ALWAYS nest: words inside sentences, sentences inside parent elements (p, h1-h6, li, td, th, header, footer, div, section, etc.)**
          * Be consistent: same element types use same numbering pattern across all pages
        - **NO TEXT ELEMENT SHOULD BE WITHOUT AN ID** - Every piece of text must be wrapped in an element with a unique ID
        - **Even if text appears multiple times (duplicates), each occurrence must have a unique ID**
        - **Page numbers, headers, footers, titles, captions, labels - ALL must have unique IDs**

        **XHTML 1.0 STRICT REQUIREMENTS:**
        - DOCTYPE: <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
        - All tags lowercase, properly nested, self-closing tags end with />
        - Use relative units (em, rem, %, vw, vh) - NO px units for layout
        - Represent graphics as <div> placeholders with title attributes

        **CSS REQUIREMENTS - CRITICAL:**
        - ALL CSS MUST be inside a <style type="text/css"> tag within <head>
        - Include: .-epub-media-overlay-active { background-color: #ffff00; }
        - Preserve text hierarchy (h1, h2, h3)
        - Use flexbox for layouts

        **OUTPUT FORMAT - CRITICAL:**
        Return ONLY the raw XHTML content. 
        - Do NOT wrap in JSON
        - Do NOT use markdown code blocks (no triple backticks with xml/html/xhtml)
        - Do NOT use any markdown formatting
        - Start directly with <!DOCTYPE and end with </html>
        - Return pure XHTML only, nothing else

        Example structure for PAGE ${pageNumber} (showing HIERARCHICAL NESTED structure for ALL elements):
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
          <title>Page Title</title>
          <style type="text/css">
            /* ALL CSS goes here - do not put CSS anywhere else */
            body { margin: 0; padding: 0; }
            .-epub-media-overlay-active { background-color: #ffff00; }
            .paragraph-block { margin: 1em 0; }
            .sync-sentence { display: inline; }
            .sync-word { display: inline; }
          </style>
        </head>
        <body>
          <div class="page">
            <!-- Header with NESTED sentences and words -->
            <header id="page${pageNumber}_header1" data-read-aloud="true">
              <h1 id="page${pageNumber}_h1" data-read-aloud="true">
                <span class="sync-sentence" id="page${pageNumber}_h1_s1" data-read-aloud="true">
                  <span class="sync-word" id="page${pageNumber}_h1_s1_w1">Chapter</span>
                  <span class="sync-word" id="page${pageNumber}_h1_s1_w2">Title</span>
                </span>
              </h1>
            </header>
            <!-- Paragraphs with NESTED sentences and words -->
            <p id="page${pageNumber}_p1" class="paragraph-block" data-read-aloud="true">
              <span class="sync-sentence" id="page${pageNumber}_p1_s1" data-read-aloud="true">
                <span class="sync-word" id="page${pageNumber}_p1_s1_w1">If</span>
                <span class="sync-word" id="page${pageNumber}_p1_s1_w2">you</span>
                <span class="sync-word" id="page${pageNumber}_p1_s1_w3">were</span>
                <span class="sync-word" id="page${pageNumber}_p1_s1_w4">a</span>
                <span class="sync-word" id="page${pageNumber}_p1_s1_w5">horse.</span>
              </span>
              <span class="sync-sentence" id="page${pageNumber}_p1_s2" data-read-aloud="true">
                <span class="sync-word" id="page${pageNumber}_p1_s2_w1">You</span>
                <span class="sync-word" id="page${pageNumber}_p1_s2_w2">would</span>
                <span class="sync-word" id="page${pageNumber}_p1_s2_w3">gallop.</span>
              </span>
            </p>
            <!-- List items with NESTED sentences and words -->
            <ul>
              <li id="page${pageNumber}_li1" data-read-aloud="true">
                <span class="sync-sentence" id="page${pageNumber}_li1_s1" data-read-aloud="true">
                  <span class="sync-word" id="page${pageNumber}_li1_s1_w1">First</span>
                  <span class="sync-word" id="page${pageNumber}_li1_s1_w2">item.</span>
                </span>
              </li>
              <li id="page${pageNumber}_li2" data-read-aloud="true">
                <span class="sync-sentence" id="page${pageNumber}_li2_s1" data-read-aloud="true">
                  <span class="sync-word" id="page${pageNumber}_li2_s1_w1">Second</span>
                  <span class="sync-word" id="page${pageNumber}_li2_s1_w2">item.</span>
                </span>
              </li>
            </ul>
            <!-- Table cells with NESTED sentences and words -->
            <table>
              <tr>
                <td id="page${pageNumber}_td1" data-read-aloud="true">
                  <span class="sync-sentence" id="page${pageNumber}_td1_s1" data-read-aloud="true">
                    <span class="sync-word" id="page${pageNumber}_td1_s1_w1">Cell</span>
                    <span class="sync-word" id="page${pageNumber}_td1_s1_w2">content.</span>
                  </span>
                </td>
              </tr>
            </table>
            <!-- Footer with NESTED sentences and words -->
            <footer id="page${pageNumber}_footer1" data-read-aloud="true">
              <span class="sync-sentence" id="page${pageNumber}_footer1_s1" data-read-aloud="true">
                <span class="sync-word" id="page${pageNumber}_footer1_s1_w1">Page</span>
                <span class="sync-word" id="page${pageNumber}_footer1_s1_w2">${pageNumber}</span>
              </span>
            </footer>
          </div>
        </body>
        </html>
`;

                console.log(`[Page ${pageNumber}] Calling Gemini API for XHTML conversion...`);
        
        const maxApiAttempts = 2;
        let attempt = 0;
        let result = null;
        let lastError = null;
        let pendingApiCall = null; // Track pending API call for late response capture

        while (attempt < maxApiAttempts && !result) {
          attempt++;
          const apiTimeout = 90000; // 90 seconds
          let timeoutId;
          
          const apiTimeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('API call timeout after 90s')), apiTimeout);
          });

          const apiCallPromise = model.generateContent([
            { text: prompt },
            {
              inlineData: {
                data: imageBuffer.toString('base64'),
                mimeType: 'image/png'
              }
            }
          ]);

          // Store reference to track late responses
          pendingApiCall = apiCallPromise;

          try {
            result = await Promise.race([apiCallPromise, apiTimeoutPromise]);
            clearTimeout(timeoutId); // Clear timeout on success
            pendingApiCall = null;
          } catch (apiErr) {
            clearTimeout(timeoutId);
            lastError = apiErr;
            const isTimeout = apiErr?.message?.includes('timeout');
            
            if (isTimeout) {
              // LATE RESPONSE CAPTURE: Let the API call continue in background
              // and store the result if it arrives within grace period
              const captureKey = GeminiService.getCacheKey(imagePath, pageNumber);
              console.warn(`[Page ${pageNumber}] API call timed out (attempt ${attempt}/${maxApiAttempts}), starting late response capture...`);
              
              // Start background capture (don't await)
              pendingApiCall.then(async (lateResult) => {
                try {
                  console.log(`[Page ${pageNumber}] Late response received! Processing...`);
                  const lateResponse = await lateResult.response;
                  const lateRawResponse = lateResponse.text() || '';
                  
                  // Process the late response
                  const processedResult = GeminiService.processRawResponse(lateRawResponse, pageNumber);
                  if (processedResult) {
                    GeminiService.storeLateResponse(captureKey, processedResult);
                    console.log(`[Page ${pageNumber}] Late response cached successfully (${processedResult.xhtml.length} chars)`);
                  }
                } catch (lateErr) {
                  console.warn(`[Page ${pageNumber}] Late response processing failed:`, lateErr.message);
                }
              }).catch(lateErr => {
                console.warn(`[Page ${pageNumber}] Late response capture failed:`, lateErr.message);
              });
              
              pendingApiCall = null;
              
              if (attempt < maxApiAttempts) {
                console.log(`[Page ${pageNumber}] Retrying after timeout...`);
                await new Promise(res => setTimeout(res, 2000));
                continue;
              }
            }
            throw apiErr;
          }
        }

        console.log(`[Page ${pageNumber}] Received response from Gemini API...`);
        
        const response = await result.response;
        const rawResponse = response.text() || '';
        
        // Record success
        CircuitBreakerService.recordSuccess('Gemini');
        
        // Process the response using the shared method
        console.log(`[Page ${pageNumber}] Raw response preview (first 500 chars):`, rawResponse.substring(0, 500));
        
        const processedResult = GeminiService.processRawResponse(rawResponse, pageNumber);
        
        if (processedResult) {
          console.log(`[Page ${pageNumber}] Successfully extracted XHTML (${processedResult.xhtml.length} chars)`);
          return processedResult;
        }
        
        console.warn(`[Page ${pageNumber}] Response missing XHTML content. Raw (first 500 chars): ${rawResponse.substring(0, 500)}`);
        return null;
      } catch (error) {
        const is429 = error?.status === 429 || error?.statusCode === 429;
        const isTimeout = error?.message?.includes('timeout');
        
        if (is429) {
          CircuitBreakerService.recordFailure('Gemini', true);
          console.warn(`[Page ${pageNumber}] 429 error during XHTML conversion`);
        } else if (isTimeout) {
          console.warn(`[Page ${pageNumber}] API call timed out, skipping`);
          CircuitBreakerService.recordFailure('Gemini', false);
        } else {
          console.error(`[Page ${pageNumber}] Error converting PNG to XHTML:`, error.message);
          CircuitBreakerService.recordFailure('Gemini', false);
        }
        return null;
      }
    }, 1); // High priority for XHTML conversion

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } catch (error) {
      if (error?.message?.includes('Overall timeout')) {
        console.error(`[Page ${pageNumber}] Overall operation timed out after 90s, skipping`);
        CircuitBreakerService.recordFailure('Gemini', false);
      }
      return null;
    }
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
   * HYBRID ALIGNMENT: Reconcile book blocks with audio transcript using semantic matching
   * This is the "brain" of the hybrid sync - it identifies which book segments are actually in the audio
   * 
   * @param {Array} bookBlocks - Array of {id: string, text: string} objects from XHTML
   * @param {Object} whisperData - Transcript data with segments: [{start: number, end: number, text: string}]
   * @returns {Promise<Array>} Array of {id: string, status: 'SYNCED'|'SKIPPED', start?: number, end?: number}
   */
  static async reconcileAlignment(bookBlocks, whisperData) {
    try {
      const client = this.getClient();
      // Use the same model as the rest of the codebase
      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ model: modelName });

      // Format transcript segments for Gemini (with Aeneas timestamps as reference)
      const transcriptSegments = whisperData.segments?.map(s => ({
        text: s.text || s,
        start: s.start,
        end: s.end
      })) || [];

      // Create full transcript text for context
      const fullTranscript = whisperData.text || transcriptSegments.map(s => s.text || s).join(' ');

      // Add segment indices to help with matching (with Aeneas timestamps for reference)
      const transcriptSegmentsWithIndex = transcriptSegments.map((seg, idx) => ({
        index: idx,
        text: (seg.text || seg).trim(),
        start: seg.start, // Aeneas timestamp (for reference)
        end: seg.end      // Aeneas timestamp (for reference)
      }));

      // Add position indices to book blocks for positional matching
      const bookBlocksWithPosition = bookBlocks.map((b, idx) => ({
        position: idx,
        id: b.id,
        text: b.text.trim()
      }));

      const prompt = `
I am an AI audio-sync specialist. 

INPUT:
1. BOOK BLOCKS: A list of IDs and text from the EPUB file (in reading order, with position indices).
2. TRANSCRIPT SEGMENTS: A timestamped transcript of what was actually spoken (in chronological order, with index numbers). Each segment has Aeneas timestamps (start/end) showing where it appears in the audio.

CRITICAL MATCHING RULES:
1. POSITIONAL MATCHING IS PRIMARY: Book block at position N should match transcript segment at index N (accounting for skipped blocks).
2. For duplicate text (e.g., "If You Were a Horse" appears in TOC at position 2 and Chapter at position 8):
   - The TOC version (position 2) should match transcript segment with index ~2 (early in audio, ~12s)
   - The Chapter version (position 8) should match transcript segment with index ~8 (later in audio, ~45s)
   - Use the position index to determine which occurrence is correct
3. USE AENEAS TIMESTAMPS: Each transcript segment has Aeneas timestamps (start/end) showing where it appears in the audio.
   - When you match a book block to a transcript segment, USE THE EXACT Aeneas timestamps from that segment
   - Do NOT estimate or approximate - use the exact start/end times from the matched transcript segment
4. If a block's text appears in multiple transcript segments, choose the one closest to the expected position.
5. Status "SYNCED" = block is spoken and timestamps are provided.
6. Status "SKIPPED" = block is NOT in transcript at all (TOC, page numbers, headers, footers, navigation).

MATCHING ALGORITHM:
For each book block at position P:
1. Find all transcript segments that contain the block's text (normalized: lowercase, trimmed)
2. If multiple matches exist, choose the segment whose index is closest to P (the block's position)
3. Use the EXACT start/end timestamps from the matched transcript segment (from Aeneas)
4. Track which segments have been used to avoid double-matching

EXAMPLE:
- Book block at position 2: "If You Were a Horse" (from TOC) → Match to transcript segment at index 2 with Aeneas timestamps [11.96s-18.00s] → Use 11.96s-18.00s
- Book block at position 8: "If You Were a Horse" (from Chapter) → Match to transcript segment at index 8 with Aeneas timestamps [45.00s-48.84s] → Use 45.00s-48.84s

REQUIRED OUTPUT FORMAT:
- EVERY block must have either:
  - {"id": "...", "status": "SYNCED", "start": X.XX, "end": Y.YY} (if found in transcript)
  - {"id": "...", "status": "SKIPPED"} (if NOT found in transcript at all)

BOOK BLOCKS (in reading order with positions): ${JSON.stringify(bookBlocksWithPosition, null, 2)}

TRANSCRIPT SEGMENTS (chronological, with Aeneas timestamps and indices): ${JSON.stringify(transcriptSegmentsWithIndex, null, 2)}

CRITICAL: Each transcript segment has Aeneas timestamps (start/end) showing where it appears in the audio.
When you match a book block to a transcript segment, USE THE EXACT Aeneas timestamps from that segment.
Do NOT estimate - use the exact start/end times from the matched transcript segment.

OUTPUT ONLY VALID JSON ARRAY (no markdown, no explanation):
[
  {"id": "toc_1", "status": "SKIPPED"},
  {"id": "page3_p1_s1", "status": "SYNCED", "start": 0.0, "end": 4.5},
  {"id": "page4_p1_s1", "status": "SYNCED", "start": 7.2, "end": 10.8}
]
`;

      console.log('[GeminiService] Starting semantic alignment reconciliation...');
      const result = await this.generateWithBackoff(model, prompt, 1);
      
      if (!result) {
        throw new Error('Gemini API call failed or was rate limited');
      }

      const response = await result.response;
      const responseText = response.text();
      
      // DEBUG: Log the raw response
      console.log('[GeminiService] Raw Gemini response (first 500 chars):', responseText.substring(0, 500));
      console.log('[GeminiService] Raw Gemini response length:', responseText.length);
      
      // Extract JSON from response (handle markdown code blocks)
      let jsonString = responseText;
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       responseText.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        jsonString = jsonMatch[1] || jsonMatch[0];
        console.log('[GeminiService] Extracted JSON (first 500 chars):', jsonString.substring(0, 500));
      } else {
        console.warn('[GeminiService] No JSON pattern found in response, using full response text');
      }

      let alignmentMap;
      try {
        alignmentMap = JSON.parse(jsonString.trim());
        console.log('[GeminiService] Successfully parsed JSON, items:', alignmentMap.length);
        console.log('[GeminiService] First 3 items:', alignmentMap.slice(0, 3));
      } catch (parseError) {
        console.error('[GeminiService] JSON parse error:', parseError.message);
        console.error('[GeminiService] JSON string that failed:', jsonString.substring(0, 1000));
        throw new Error(`Failed to parse Gemini response as JSON: ${parseError.message}`);
      }
      
      // Validate alignment map structure
      if (!Array.isArray(alignmentMap)) {
        console.error('[GeminiService] Alignment map is not an array:', typeof alignmentMap);
        throw new Error('Gemini returned invalid format: expected array, got ' + typeof alignmentMap);
      }
      
      const syncedCount = alignmentMap.filter(a => a.status === 'SYNCED').length;
      const skippedCount = alignmentMap.filter(a => a.status === 'SKIPPED').length;
      console.log(`[GeminiService] Semantic alignment complete: ${syncedCount} synced, ${skippedCount} skipped`);
      
      // Log items with timestamps
      const itemsWithTimestamps = alignmentMap.filter(a => a.status === 'SYNCED' && a.start !== undefined && a.end !== undefined);
      console.log(`[GeminiService] Items with timestamps: ${itemsWithTimestamps.length}`);
      if (itemsWithTimestamps.length > 0) {
        console.log('[GeminiService] First 3 items with timestamps:', itemsWithTimestamps.slice(0, 3));
      }
      
      return alignmentMap;
    } catch (error) {
      console.error('[GeminiService] Error in reconcileAlignment:', error);
      throw error;
    }
  }

  /**
   * Reconcile alignment from XHTML content directly (no transcript needed)
   * Gemini analyzes the FULL audio file and matches XHTML elements to timestamps
   * 
   * @param {string} xhtmlContent - Full XHTML content for the page
   * @param {number} totalAudioDuration - Total audio duration (in seconds)
   * @param {string} audioFilePath - Path to the FULL audio file to attach to Gemini
   * @param {string} granularity - Granularity level ('sentence', 'word', etc.)
   * @returns {Promise<Array>} Array of {id: string, status: 'SYNCED'|'SKIPPED', start?: number, end?: number}
   */
  static async reconcileAlignmentFromXhtml(xhtmlContent, totalAudioDuration, audioFilePath, granularity = 'sentence') {
    try {
      const client = this.getClient();
      if (!client) {
        throw new Error('Gemini client not available');
      }

      // Check if audio file exists
      if (!audioFilePath) {
        throw new Error('Audio file path is required');
      }

      try {
        await fs.access(audioFilePath);
        const stats = await fs.stat(audioFilePath);
        if (stats.size === 0) {
          throw new Error(`Audio file is empty: ${audioFilePath}`);
        }
        console.log(`[GeminiService] Audio file verified: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
      } catch (err) {
        throw new Error(`Audio file not found or invalid: ${audioFilePath} - ${err.message}`);
      }

      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ model: modelName });

      console.log(`[GeminiService] Starting XHTML-based alignment with FULL audio file...`);
      console.log(`[GeminiService] Reading full audio file: ${audioFilePath}`);
      console.log(`[GeminiService] Audio duration: ${totalAudioDuration.toFixed(2)}s`);
      console.log(`[GeminiService] Granularity: ${granularity}`);
      
      // Read the FULL audio file (no segmentation)
      let audioBuffer;
      let audioMimeType = 'audio/mpeg';
      
      audioBuffer = await fs.readFile(audioFilePath);
      console.log(`[GeminiService] Using full audio file: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      
      const audioExtension = audioFilePath.toLowerCase().split('.').pop();
      if (audioExtension === 'wav') {
        audioMimeType = 'audio/wav';
      } else if (audioExtension === 'mp3') {
        audioMimeType = 'audio/mpeg';
      } else if (audioExtension === 'm4a' || audioExtension === 'mp4') {
        audioMimeType = 'audio/mp4';
      } else if (audioExtension === 'ogg') {
        audioMimeType = 'audio/ogg';
      }

      // Extract text blocks from XHTML for reference (but send full XHTML to Gemini)
      // Disable default exclusions to include headers, duplicates, TOC, etc.
      const { aeneasService } = await import('./aeneasService.js');
      const { idMap } = aeneasService.extractTextFragments(xhtmlContent, granularity, {
        excludeIds: [],
        excludePatterns: [],
        disableDefaultExclusions: true // Include headers, duplicates, TOC, etc.
      });
      
      // Filter blocks to only include those matching the specified granularity
      // Headers, footers, and other non-granularity elements are ALWAYS excluded
      const filteredBlocks = idMap.filter(m => {
        const id = m.id;
        const type = m.type || 'paragraph';
        
        // ALWAYS exclude headers, footers, and header elements regardless of granularity
        const isHeader = id.includes('_h') || id.match(/^page\d+_h\d+$/);
        const isFooter = id.includes('footer') || id.includes('_footer');
        const isHeaderElement = id.includes('header') || id.includes('_header');
        if (isHeader || isFooter || isHeaderElement) {
          return false; // Always exclude headers/footers
        }
        
        // For sentence granularity: only include sentence-level elements (p{N}_s{N})
        if (granularity === 'sentence') {
          // Must have sentence pattern: p{N}_s{N} (not p{N}_s{N}_w{N})
          const hasSentencePattern = id.includes('_s') && !id.includes('_w');
          // Must match sentence type or pattern
          return (type === 'sentence' || hasSentencePattern) && !id.includes('_w');
        }
        
        // For word granularity: only include word-level elements (p{N}_s{N}_w{N})
        if (granularity === 'word') {
          // Must have word pattern: p{N}_s{N}_w{N}
          const hasWordPattern = id.includes('_w');
          // Must match word type or pattern
          return type === 'word' || hasWordPattern;
        }
        
        // For paragraph granularity: only include paragraph-level elements (p{N})
        if (granularity === 'paragraph') {
          // Must have paragraph pattern: p{N} (but not p{N}_s{N} or p{N}_s{N}_w{N})
          const hasParagraphPattern = id.includes('_p') && !id.includes('_s') && !id.includes('_w');
          // Must match paragraph type or pattern
          return (type === 'paragraph' || hasParagraphPattern) && !id.includes('_s');
        }
        
        // Default: exclude all (shouldn't reach here with valid granularity)
        return false;
      });
      
      const bookBlocks = filteredBlocks.map(m => ({ id: m.id, text: m.text }));
      
      if (bookBlocks.length === 0) {
        console.log(`[GeminiService] ⚠️ WARNING: No ${granularity}-level blocks found in XHTML after filtering`);
        console.log(`[GeminiService] Total blocks before filtering: ${idMap.length}`);
        return [];
      }
      
      console.log(`[GeminiService] Found ${bookBlocks.length} ${granularity}-level blocks (filtered from ${idMap.length} total blocks)`);
      console.log(`[GeminiService] Granularity: ${granularity} - Only ${granularity}-level elements will be synced`);
      
      // Log first few blocks as sample
      if (bookBlocks.length > 0) {
        console.log(`[GeminiService] Sample blocks (first 5):`);
        bookBlocks.slice(0, 5).forEach((b, idx) => {
          console.log(`  ${idx + 1}. ${b.id}: "${b.text.substring(0, 50)}${b.text.length > 50 ? '...' : ''}"`);
        });
      }
      
      const prompt = `
You are an expert audio transcription and timestamp alignment specialist. Your task is to listen to the FULL attached audio file and match XHTML elements to precise timestamps.

**MANDATORY REQUIREMENT: SYNC ALL ${granularity.toUpperCase()}-LEVEL ELEMENTS**
- **GRANULARITY: ${granularity}** - You MUST only sync elements at the ${granularity} level
- **CRITICAL: Only sync elements matching ${granularity} granularity:**
  ${granularity === 'sentence' ? 
    '* Sentence-level elements: IDs with pattern p{N}_s{N} (e.g., page1_p1_s1, page1_p2_s1)' :
    granularity === 'word' ?
    '* Word-level elements: IDs with pattern p{N}_s{N}_w{N} (e.g., page1_p1_s1_w1, page1_p1_s1_w2)' :
    '* Paragraph-level elements: IDs with pattern p{N} (e.g., page1_p1, page1_p2)'
  }
- **DO NOT sync headers, footers, or other elements** unless they match the ${granularity} pattern
- **DO NOT sync elements at different granularity levels** (e.g., if ${granularity} is "sentence", don't sync word-level or paragraph-only elements)
- You MUST provide timestamps for EVERY ${granularity}-level element that has an ID in the XHTML
- NO ${granularity}-level element should be skipped unless it's completely empty with no text content
- When in doubt, ALWAYS SYNC it - include all ${granularity}-level elements

CRITICAL: You will receive:
1. FULL XHTML CONTENT: The complete XHTML markup for one page of an EPUB book
2. FULL AUDIO FILE: The complete audio narration (duration: ${totalAudioDuration.toFixed(2)} seconds)
3. TEXT BLOCKS REFERENCE: A list of text blocks extracted from the XHTML with their IDs

Your job is to:
- Parse the XHTML to identify ALL elements with IDs (especially those with data-read-aloud attributes or matching the block IDs)
- Listen to the FULL audio file
- Match EACH XHTML element/text block to when it's spoken in the audio
- Provide ABSOLUTE timestamps (from 0.0s to ${totalAudioDuration.toFixed(2)}s) for ALL text elements

CRITICAL INSTRUCTIONS FOR ACCURATE TIMESTAMPS:

1. ANALYZE THE XHTML:
   - The XHTML contains structured content with IDs (e.g., id="page3_p1_s1", id="page4_p2_s1")
   - Look for elements with IDs that match the block IDs provided
   - Elements may have data-read-aloud="true" attributes indicating they should be spoken
   - Parse the XHTML structure to understand reading order and content hierarchy

2. LISTEN TO THE FULL AUDIO:
   - The FULL audio file is attached (${totalAudioDuration.toFixed(2)} seconds total)
   - Listen carefully from start to finish
   - Identify where each XHTML element's text content is spoken
   - Timestamps are ABSOLUTE (0.0s = start of full audio, ${totalAudioDuration.toFixed(2)}s = end)

3. MATCHING XHTML ELEMENTS TO AUDIO (BE THOROUGH):
   - Match XHTML element text content to what you hear in the audio
   - Account for slight variations (e.g., "If You Were a Horse" vs "If you were a horse")
   - Match based on actual spoken words, not just text similarity
   - Use FUZZY MATCHING: Match similar words/phrases even if not exact
   - Match PARTIAL TEXT: If only part of an element is spoken, still provide timestamps
   - Match KEYWORDS: If key words from an element are heard, match it
   - Consider reading order: Elements earlier in XHTML should appear earlier in audio

4. TIMESTAMP ACCURACY REQUIREMENTS (CRITICAL - NO OVERLAPS, INCLUDE NATURAL PAUSES):
   - START time: The exact moment (in full audio) when the first word of the element begins to be spoken
   - END time: **CRITICAL - Include natural pauses**: The moment when the last word finishes PLUS the natural pause/silence that follows in the audio
     * For sentences ending with period/exclamation/question: Include 0.3-0.5s of silence after the last word
     * For other blocks: Include 0.2-0.3s of silence after the last word
     * Listen for the natural pause in the audio - don't cut off abruptly
   - **DO NOT end timestamps exactly when speech ends - extend to include the natural pause/silence that follows**
   - Do NOT use estimates - ONLY use what you actually hear in the audio (including pauses)
   - Timestamps must be within audio duration: 0.0s to ${totalAudioDuration.toFixed(2)}s
   - Timestamps must be precise to 2 decimal places (e.g., 7.36, 18.58, 28.06)
   - **CRITICAL: Each block MUST have UNIQUE, NON-OVERLAPPING timestamps**
   - **NO OVERLAPS: The end time of one block MUST be less than the start time of the next block (leave at least 0.05s gap)**
   - **SEQUENTIAL ORDER: Blocks should appear in reading order with timestamps that don't overlap**
   - **SMOOTH TRANSITIONS: End times should include natural pauses to prevent abrupt cuts**

5. SYNC ALL ${granularity.toUpperCase()}-LEVEL ELEMENTS (CRITICAL - RESPECT GRANULARITY):
   - **GRANULARITY CONSTRAINT: You are syncing at ${granularity} level ONLY**
   - **MANDATORY RULE: Sync ALL ${granularity}-level elements that appear in the XHTML**
   - **EVERY ${granularity}-level element with an ID in the XHTML MUST be synced**
   - **${granularity === 'sentence' ? 
     'Elements to sync: Only sentence-level elements (IDs with pattern p{N}_s{N}, e.g., page1_p1_s1)' :
     granularity === 'word' ?
     'Elements to sync: Only word-level elements (IDs with pattern p{N}_s{N}_w{N}, e.g., page1_p1_s1_w1)' :
     'Elements to sync: Only paragraph-level elements (IDs with pattern p{N}, e.g., page1_p1)'
   }**
   - **DO NOT sync:**
     * Headers, footers, or other non-${granularity} elements (unless they match the ${granularity} pattern)
     * Elements at different granularity levels (e.g., if ${granularity} is "sentence", don't sync word-level or paragraph-only elements)
     * Elements that don't match the ${granularity} ID pattern
   - **DO NOT SKIP ANY ${granularity}-LEVEL ELEMENT** unless it's completely empty with no text content
   - **When in doubt, ALWAYS SYNC it** - it's better to have timestamps for all ${granularity}-level elements than to miss content
   - **ONLY mark as SKIPPED if:**
     * The element is completely empty (no text content at all)
     * OR the element doesn't match the ${granularity} pattern (shouldn't happen if filtering is correct)
   - **SYNC ALL ${granularity.toUpperCase()}-LEVEL ELEMENTS:**
     * If an element matches the ${granularity} pattern and has text content, it MUST be synced
     * If you're not 100% certain it's not spoken, SYNC it
     * If the text appears in the audio (even partially or with variations), SYNC it
     * If similar words are heard, SYNC it

6. OUTPUT FORMAT:
   - For each block ID, provide: {"id": "block_id", "status": "SYNCED", "start": X.XX, "end": Y.YY}
   - OR: {"id": "block_id", "status": "SKIPPED"} if not spoken
   - All timestamps in seconds (ABSOLUTE, from start of full audio), with 2 decimal places
   - Start time must be less than end time
   - End time of one block should typically be close to start time of next block (allowing for brief pauses)

INPUT DATA:
- Full audio duration: ${totalAudioDuration.toFixed(2)} seconds
- Granularity: ${granularity}
- Number of blocks to align: ${bookBlocks.length}

XHTML CONTENT (full markup):
${xhtmlContent.substring(0, 5000)}${xhtmlContent.length > 5000 ? '\n... (truncated, full XHTML provided in context)' : ''}

TEXT BLOCKS REFERENCE (extracted from XHTML with IDs):
${JSON.stringify(bookBlocks.map((b, idx) => ({ position: idx, id: b.id, text: b.text.trim().substring(0, 200) })), null, 2)}

FULL AUDIO FILE: The complete audio narration is attached. Listen to the entire audio and match each XHTML element to its spoken timestamps.

OUTPUT: Return ONLY a valid JSON array with timestamps. No markdown, no explanations, no code blocks. Just the JSON array:
[
  {"id": "page3_p2_s1", "status": "SYNCED", "start": 7.36, "end": 8.66},
  {"id": "page4_p1_s1", "status": "SYNCED", "start": 15.05, "end": 18.58},
  {"id": "page5_p4_s1", "status": "SYNCED", "start": 18.56, "end": 20.99}
]
`;
      
      // Use RequestQueueService and RateLimiterService for rate limiting
      const result = await RequestQueueService.enqueue('Gemini', async () => {
        // Pre-request rate limit check
        if (!RateLimiterService.acquire('Gemini')) {
          const waitTime = RateLimiterService.getTimeUntilNextToken('Gemini');
          if (waitTime > 0) {
            console.log(`[GeminiService] Waiting ${Math.round(waitTime/1000)}s for rate limit token...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            if (!RateLimiterService.acquire('Gemini')) {
              throw new Error('Rate limit exceeded after wait');
            }
          } else {
            throw new Error('Rate limit exceeded');
          }
        }

        try {
          // Check circuit breaker
          if (!CircuitBreakerService.canMakeRequest('Gemini')) {
            throw new Error('Circuit breaker is OPEN');
          }

          // Call Gemini with both text prompt and audio file
          const apiResult = await model.generateContent([
            { text: prompt },
            {
              inlineData: {
                data: audioBuffer.toString('base64'),
                mimeType: audioMimeType
              }
            }
          ]);
          
          CircuitBreakerService.recordSuccess('Gemini');
          return apiResult;
        } catch (error) {
          const is429 = error?.status === 429 || error?.statusCode === 429;
          if (is429) {
            CircuitBreakerService.recordFailure('Gemini', true);
          } else {
            CircuitBreakerService.recordFailure('Gemini', false);
          }
          throw error;
        }
      }, 1); // High priority
      
      if (!result) {
        throw new Error('Gemini API call failed or was rate limited');
      }

      const response = await result.response;
      const responseText = response.text();
      
      // Extract JSON from response
      let jsonString = responseText;
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       responseText.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        jsonString = jsonMatch[1] || jsonMatch[0];
      }

      let alignmentMap;
      try {
        alignmentMap = JSON.parse(jsonString.trim());
        console.log(`[GeminiService] Successfully parsed JSON, items: ${alignmentMap.length}`);
      } catch (parseError) {
        console.error('[GeminiService] JSON parse error:', parseError.message);
        console.error('[GeminiService] Raw response (first 1000 chars):', responseText.substring(0, 1000));
        throw new Error(`Failed to parse Gemini response as JSON: ${parseError.message}`);
      }
      
      if (!Array.isArray(alignmentMap)) {
        throw new Error('Gemini returned invalid format: expected array, got ' + typeof alignmentMap);
      }
      
      // Validate and log timestamps
      const syncedItems = alignmentMap.filter(a => a.status === 'SYNCED');
      const skippedCount = alignmentMap.filter(a => a.status === 'SKIPPED').length;
      
      // Log skipped blocks for debugging
      if (skippedCount > 0) {
        const skippedBlocks = alignmentMap.filter(a => a.status === 'SKIPPED');
        console.log(`[GeminiService] ⚠️ ${skippedCount} blocks marked as SKIPPED:`);
        skippedBlocks.forEach(item => {
          const block = bookBlocks.find(b => b.id === item.id);
          const textPreview = block?.text?.substring(0, 50).replace(/\n/g, ' ') || 'N/A';
          console.log(`  - ${item.id}: "${textPreview}..."`);
        });
      }
      
      let validTimestamps = 0;
      let invalidTimestamps = 0;
      const timestampWarnings = [];
      const correctedAlignmentMap = [];
      
      // First pass: validate and collect all valid timestamps
      const validItems = [];
      for (const item of alignmentMap) {
        if (item.status === 'SKIPPED') {
          correctedAlignmentMap.push(item);
          continue;
        }
        
        if (item.start === undefined || item.end === undefined) {
          invalidTimestamps++;
          timestampWarnings.push(`Block ${item.id}: Missing timestamps - marking as SKIPPED`);
          correctedAlignmentMap.push({ ...item, status: 'SKIPPED' });
          continue;
        }
        
        let start = Number(item.start);
        let end = Number(item.end);
        
        // Validate timestamp ranges
        if (isNaN(start) || isNaN(end)) {
          invalidTimestamps++;
          timestampWarnings.push(`Block ${item.id}: Invalid timestamp values (start: ${item.start}, end: ${item.end}) - marking as SKIPPED`);
          correctedAlignmentMap.push({ ...item, status: 'SKIPPED' });
          continue;
        }
        
        if (start >= end) {
          invalidTimestamps++;
          timestampWarnings.push(`Block ${item.id}: Start time (${start}s) >= End time (${end}s) - marking as SKIPPED`);
          correctedAlignmentMap.push({ ...item, status: 'SKIPPED' });
          continue;
        }
        
        // Check if timestamps are within total audio duration
        if (start < 0 || end > totalAudioDuration) {
          invalidTimestamps++;
          timestampWarnings.push(`Block ${item.id}: Timestamps (${start.toFixed(2)}s-${end.toFixed(2)}s) outside audio duration (0s-${totalAudioDuration.toFixed(2)}s) - marking as SKIPPED`);
          correctedAlignmentMap.push({ ...item, status: 'SKIPPED' });
          continue;
        }
        
        validItems.push({ ...item, start, end });
      }
      
      // Second pass: Sort by start time and resolve overlaps
      validItems.sort((a, b) => a.start - b.start);
      
      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        let start = item.start;
        let end = item.end;
        
        // Check for overlap with previous item
        if (i > 0) {
          const prevItem = validItems[i - 1];
          const prevEnd = prevItem.end;
          
          if (start < prevEnd) {
            // Overlap detected - adjust this item's start time
            const overlap = prevEnd - start;
            const minGap = 0.2; // Minimum 200ms gap between blocks for natural pause
            start = prevEnd + minGap;
            
            // If adjusting start makes end invalid, adjust end too
            if (end <= start) {
              const originalDuration = end - item.start;
              end = start + Math.max(originalDuration, 0.1); // At least 100ms duration
            }
            
            console.warn(`[GeminiService] ⚠️ Overlap detected for ${item.id}: adjusted start from ${item.start.toFixed(2)}s to ${start.toFixed(2)}s (overlap: ${overlap.toFixed(2)}s, added ${minGap.toFixed(2)}s gap)`);
            timestampWarnings.push(`Block ${item.id}: Overlap with previous block - adjusted start from ${item.start.toFixed(2)}s to ${start.toFixed(2)}s`);
          } else if (start - prevEnd < 0.2) {
            // Even if no overlap, ensure minimum gap for natural pause
            const currentGap = start - prevEnd;
            const minGap = 0.2; // Minimum 200ms gap
            if (currentGap < minGap) {
              const gapNeeded = minGap - currentGap;
              start = prevEnd + minGap;
              // Extend end time to maintain original duration
              end = start + (item.end - item.start);
              console.log(`[GeminiService] Added ${gapNeeded.toFixed(2)}s gap before ${item.id}: start adjusted from ${item.start.toFixed(2)}s to ${start.toFixed(2)}s for natural pause`);
            }
          }
        }
        
        // Check for overlap with next item
        if (i < validItems.length - 1) {
          const nextItem = validItems[i + 1];
          const nextStart = nextItem.start;
          
          if (end > nextStart) {
            // Overlap detected - adjust this item's end time
            const overlap = end - nextStart;
            const minGap = 0.2; // Minimum 200ms gap for natural pause
            end = nextStart - minGap;
            
            // Ensure minimum duration
            if (end <= start) {
              end = start + 0.1; // At least 100ms duration
            }
            
            console.warn(`[GeminiService] ⚠️ Overlap detected for ${item.id}: adjusted end from ${item.end.toFixed(2)}s to ${end.toFixed(2)}s (overlap: ${overlap.toFixed(2)}s, added ${minGap.toFixed(2)}s gap)`);
            timestampWarnings.push(`Block ${item.id}: Overlap with next block - adjusted end from ${item.end.toFixed(2)}s to ${end.toFixed(2)}s`);
          } else if (nextStart - end < 0.2) {
            // Even if no overlap, ensure minimum gap for natural pause
            const currentGap = nextStart - end;
            const minGap = 0.2; // Minimum 200ms gap
            if (currentGap < minGap) {
              const gapNeeded = minGap - currentGap;
              end = nextStart - minGap;
              // Ensure minimum duration
              if (end <= start) {
                end = start + 0.1;
              }
              console.log(`[GeminiService] Added ${gapNeeded.toFixed(2)}s gap after ${item.id}: end adjusted from ${item.end.toFixed(2)}s to ${end.toFixed(2)}s for natural pause`);
            }
          }
        }
        
        // Final validation after adjustments
        if (start >= end || isNaN(start) || isNaN(end)) {
          invalidTimestamps++;
          timestampWarnings.push(`Block ${item.id}: Invalid timestamps after overlap resolution (${start.toFixed(2)}s-${end.toFixed(2)}s) - marking as SKIPPED`);
          correctedAlignmentMap.push({ ...item, status: 'SKIPPED' });
          continue;
        }
        
        // Update validItems array with adjusted timestamps for next iteration
        validItems[i].start = start;
        validItems[i].end = end;
        
        // Add to corrected map
        correctedAlignmentMap.push({
          ...item,
          start: parseFloat(start.toFixed(2)),
          end: parseFloat(end.toFixed(2))
        });
        
        validTimestamps++;
      }
      
      if (timestampWarnings.length > 0) {
        console.warn(`[GeminiService] Timestamp validation warnings (${timestampWarnings.length}):`);
        timestampWarnings.slice(0, 5).forEach(w => console.warn(`  - ${w}`));
        if (timestampWarnings.length > 5) {
          console.warn(`  ... and ${timestampWarnings.length - 5} more warnings`);
        }
      }
      
      const finalSyncedCount = correctedAlignmentMap.filter(a => a.status === 'SYNCED').length;
      const finalSkippedCount = correctedAlignmentMap.filter(a => a.status === 'SKIPPED').length;
      const skipPercentage = bookBlocks.length > 0 ? (finalSkippedCount / bookBlocks.length) * 100 : 0;
      
      console.log(`[GeminiService] XHTML alignment complete: ${finalSyncedCount} synced (${validTimestamps} valid, ${invalidTimestamps} invalid/rejected), ${finalSkippedCount} skipped`);
      
      // Warn if too many blocks are skipped (more than 30% of blocks)
      if (skipPercentage > 30 && bookBlocks.length > 2) {
        console.warn(`[GeminiService] ⚠️ WARNING: ${skipPercentage.toFixed(1)}% of blocks were skipped (${finalSkippedCount}/${bookBlocks.length}). This might indicate:`);
        console.warn(`  - Audio segment might not contain all the content`);
        console.warn(`  - Text blocks might not match what's spoken in audio`);
        console.warn(`  - Consider checking if audio file matches the EPUB content`);
      }
      
      // Log first few timestamps for debugging
      const validSyncedItems = correctedAlignmentMap.filter(a => a.status === 'SYNCED');
      if (validSyncedItems.length > 0) {
        console.log(`[GeminiService] Sample timestamps (first 3, absolute):`);
        validSyncedItems.slice(0, 3).forEach(item => {
          const block = bookBlocks.find(b => b.id === item.id);
          const textPreview = block ? block.text.substring(0, 40) : 'N/A';
          console.log(`  - ${item.id}: "${textPreview}..." → ${item.start.toFixed(2)}s - ${item.end.toFixed(2)}s`);
        });
      }
      
      // Final validation: Check for any remaining overlaps (shouldn't happen, but double-check)
      const finalSyncedItems = correctedAlignmentMap.filter(a => a.status === 'SYNCED');
      finalSyncedItems.sort((a, b) => a.start - b.start);
      for (let i = 1; i < finalSyncedItems.length; i++) {
        const prev = finalSyncedItems[i - 1];
        const curr = finalSyncedItems[i];
        if (curr.start < prev.end) {
          console.error(`[GeminiService] ⚠️ CRITICAL: Overlap still exists after resolution: ${prev.id} (${prev.end.toFixed(2)}s) overlaps with ${curr.id} (${curr.start.toFixed(2)}s)`);
          // Force fix: adjust current start to be after previous end
          curr.start = prev.end + 0.05;
          if (curr.end <= curr.start) {
            curr.end = curr.start + 0.1; // Minimum duration
          }
          console.log(`[GeminiService] Fixed overlap: ${curr.id} adjusted to ${curr.start.toFixed(2)}s - ${curr.end.toFixed(2)}s`);
        }
      }
      
      // Log final timestamp summary
      if (finalSyncedItems.length > 0) {
        console.log(`[GeminiService] ✅ Final timestamp validation: ${finalSyncedItems.length} blocks with unique, non-overlapping timestamps`);
        console.log(`[GeminiService] Timestamp range: ${finalSyncedItems[0].start.toFixed(2)}s - ${finalSyncedItems[finalSyncedItems.length - 1].end.toFixed(2)}s`);
      }
      
      return correctedAlignmentMap;
    } catch (error) {
      console.error('[GeminiService] Error in reconcileAlignmentFromXhtml:', error);
      throw error;
    }
  }
}

