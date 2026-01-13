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
    
    // Fix br tags to be self-closing (XHTML requirement)
    // Convert <br> or <br ...> to <br /> or <br .../> for all br tags that aren't already self-closing
    xhtml = xhtml.replace(/<br\s*([^>]*?)>/gi, (match, attrs) => {
      // Check if already self-closing (ends with /> or has /> before the closing >)
      if (match.includes('/>') || attrs.trim().endsWith('/')) {
        return match; // Already self-closing
      }
      // Add / before the closing >, or just <br /> if no attributes
      if (!attrs || attrs.trim() === '') {
        return '<br />';
      }
      return `<br ${attrs.trim()}/>`;
    });
    
    // Fix hr tags to be self-closing (XHTML requirement)
    // Convert <hr> or <hr ...> to <hr /> or <hr .../> for all hr tags that aren't already self-closing
    xhtml = xhtml.replace(/<hr\s*([^>]*?)>/gi, (match, attrs) => {
      // Check if already self-closing (ends with /> or has /> before the closing >)
      if (match.includes('/>') || attrs.trim().endsWith('/')) {
        return match; // Already self-closing
      }
      // Add / before the closing >, or just <hr /> if no attributes
      if (!attrs || attrs.trim() === '') {
        return '<hr />';
      }
      return `<hr ${attrs.trim()}/>`;
    });
    
    // Fix truncated attributes (attributes missing closing quotes)
    // Pattern: attribute="value without closing quote, followed by < or end of tag
    // This handles cases like: id="page3_p10_s1</span> -> id="page3_p10_s1"></span>
    xhtml = xhtml.replace(/(\w+)="([^"]*?)(?=<[^>]*>|$)/g, (match, attrName, attrValue, offset, string) => {
      // Check if this is actually a truncated attribute (not a complete one)
      // If the next character after the match is < and not >, it's truncated
      const nextChar = string[offset + match.length];
      if (nextChar === '<') {
        // This is a truncated attribute, close it
        return `${attrName}="${attrValue}"`;
      }
      return match; // Keep as is
    });
    
    // More aggressive fix: find attributes that are followed by < without closing quote
    // Pattern: <tag ... attr="value<... where < is not part of the attribute value
    xhtml = xhtml.replace(/(\w+)="([^"]*?)(?=<\/?[a-zA-Z])/g, (match, attrName, attrValue) => {
      // If attrValue doesn't end with quote and next is a tag, it's truncated
      if (!attrValue.includes('"') && !match.endsWith('"')) {
        return `${attrName}="${attrValue}"`;
      }
      return match;
    });
    
    // Fix attributes that are cut off mid-value (most common case)
    // Find patterns like: id="page3_p10_s1</span> and fix to: id="page3_p10_s1"></span>
    xhtml = xhtml.replace(/(\w+)="([^"]*?)(?=<)/g, (match, attrName, attrValue) => {
      // If the match doesn't end with a quote and is followed by <, it's truncated
      if (!match.endsWith('"')) {
        return `${attrName}="${attrValue}"`;
      }
      return match;
    });
    
    // Fix CSS attribute selectors with quotes in <style> tags
    // In XHTML, CSS attribute selectors like [class*="value"] can cause XML parsing errors
    // We need to escape the quotes or use CDATA sections, but simpler: replace with single quotes
    xhtml = xhtml.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, cssContent) => {
      // Replace double quotes in CSS attribute selectors with single quotes
      // Pattern: [attr*="value"] -> [attr*='value']
      // This is safer for XHTML parsing
      // Match patterns like: [class*="value"], [id="value"], [data-*="value"]
      let fixedCss = cssContent;
      
      // Find all CSS attribute selectors with double quotes and replace with single quotes
      // Pattern: [anything="value"] -> [anything='value']
      // Use a simple, direct approach: find ="[anything]" inside [...] brackets
      // This regex matches: [ followed by any chars, then =", then value, then ", then any chars, then ]
      fixedCss = fixedCss.replace(/\[([^\]]*?)=["]([^"]*?)["]([^\]]*?)\]/g, (fullMatch, before, value, after) => {
        // Replace double quotes with single quotes
        // Handle cases like: [class*="value"], [id="value"], [data-attr="value"]
        return `[${before}='${value}'${after}]`;
      });
      
      // If the above didn't catch it (e.g., due to whitespace), try a more permissive pattern
      // Match: [ ... = "value" ... ] with optional whitespace
      if (fixedCss.includes('="')) {
        fixedCss = fixedCss.replace(/\[([^\]]*?)\s*=\s*["]([^"]*?)["]\s*([^\]]*?)\]/g, (fullMatch, before, value, after) => {
          return `[${before.trim()}='${value}'${after.trim()}]`;
        });
      }
      
      // Final safety check: if there are still any ="[value]" patterns in brackets, fix them
      // This catches edge cases where the pattern might be split across lines or have unusual formatting
      if (fixedCss.includes('="') && fixedCss.includes('[')) {
        // Find any remaining ="[value]" inside [...]
        fixedCss = fixedCss.replace(/(\[[^\]]*?)=["]([^"]*?)["]([^\]]*?\])/g, (fullMatch, before, value, after) => {
          return `${before}='${value}'${after}`;
        });
      }
      
      return match.replace(cssContent, fixedCss);
    });
    
    // Also fix unclosed style tags (if style tag is missing closing tag)
    // This can happen if the response is truncated
    if (xhtml.includes('<style') && !xhtml.includes('</style>')) {
      // Find the last <style> tag and add closing tag before </head> or at end
      const styleMatch = xhtml.match(/<style[^>]*>([\s\S]*)$/i);
      if (styleMatch) {
        const headCloseIdx = xhtml.indexOf('</head>');
        if (headCloseIdx !== -1) {
          xhtml = xhtml.substring(0, headCloseIdx) + '</style>' + xhtml.substring(headCloseIdx);
        } else {
          // No </head>, add before </html> or at end
          const htmlCloseIdx = xhtml.indexOf('</html>');
          if (htmlCloseIdx !== -1) {
            xhtml = xhtml.substring(0, htmlCloseIdx) + '</style></head>' + xhtml.substring(htmlCloseIdx);
          } else {
            xhtml = xhtml + '</style>';
          }
        }
      }
    }
    
    // Clean up multiple spaces
    xhtml = xhtml.replace(/\s+>/g, '>');
    xhtml = xhtml.replace(/<(\w+)\s+/g, '<$1 ');
    
    // Remove epub:type attributes if xmlns:epub is not declared (prevents XML namespace errors)
    // Check if xmlns:epub is declared in the document
    const hasEpubNamespace = xhtml.includes('xmlns:epub=');
    if (!hasEpubNamespace) {
      // Remove all epub:type attributes
      xhtml = xhtml.replace(/\s+epub:type="[^"]*"/gi, '');
    }
    
    return xhtml;
  }

  static replaceImgTagsWithPlaceholders(xhtml) {
    return xhtml.replace(/<img\b([^>]*)\/?>/gi, (match, attrs) => {
      const attrMap = {};
      let attrMatch;
      const attrRegex = /([a-zA-Z0-9_-]+)=["']([^"']*)["']/g;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        attrMap[attrMatch[1].toLowerCase()] = attrMatch[2];
      }

      const title = attrMap.alt || attrMap.title || 'Image placeholder';
      const id = attrMap.id ? `id="${attrMap.id}"` : '';
      const style = attrMap.style ? `style="${attrMap.style}"` : '';
      const dataAttrs = [];
      
      if (attrMap.src) {
        dataAttrs.push(`data-original-src="${attrMap.src}"`);
      }
      if (attrMap.width) {
        dataAttrs.push(`data-original-width="${attrMap.width}"`);
      }
      if (attrMap.height) {
        dataAttrs.push(`data-original-height="${attrMap.height}"`);
      }

      // Preserve existing classes, but ensure image-drop-zone is present
      let classes = attrMap.class || '';
      if (!classes.includes('image-drop-zone') && !classes.includes('image-placeholder')) {
        classes = classes ? `${classes} image-drop-zone` : 'image-drop-zone';
      }

      return `<div class="${classes}" ${id} title="${title}" ${style} ${dataAttrs.join(' ')}></div>`;
    });
  }
  
  /**
   * Fix truncated attributes in HTML/XHTML content
   * Handles cases where attributes are cut off mid-value, like: id="page3_p10_s1</span>
   * Also handles attributes with no value: id</p> -> id=""
   * @param {string} content - HTML/XHTML content
   * @returns {string} Content with truncated attributes fixed
   */
  static fixTruncatedAttributes(content) {
    if (!content || typeof content !== 'string') return content;
    
    // Pattern 1: Fix attributes with no value followed by closing tag: id</p> -> id=""
    // Example: <span class="sync-sentence" id</p> -> <span class="sync-sentence" id=""></span>
    // This handles the case where an attribute is declared but has no value
    // Direct pattern match: whitespace + attribute name + </tag (no = sign, no value)
    // This is a very specific pattern that indicates a truncated attribute
    content = content.replace(/(\s+)(id|class|data-read-aloud|style|title|alt|src|href|data-[a-zA-Z0-9_-]+)(\s*)(<\/[a-zA-Z][a-zA-Z0-9]*>)/gi, (match, whitespace1, attrName, whitespace2, closingTag, offset, string) => {
      // Verify we're inside a tag by checking backwards for the opening <
      const before = string.substring(Math.max(0, offset - 500), offset);
      const lastOpenTag = before.lastIndexOf('<');
      const lastCloseTag = before.lastIndexOf('>');
      
      // If we're inside a tag (last < is after last >)
      if (lastOpenTag > lastCloseTag) {
        // Get everything from the opening tag to our match
        const tagStart = lastOpenTag;
        const tagContent = string.substring(tagStart, offset);
        
        // Check if this attribute name appears with an = sign (meaning it already has a value)
        // We look for: whitespace + attrName + whitespace* + =
        // Escape special regex characters in attrName
        const escapedAttrName = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrWithValuePattern = new RegExp(`\\s+${escapedAttrName}\\s*=`, 'i');
        
        // If the attribute doesn't have a value (no = sign after it), add empty value
        if (!attrWithValuePattern.test(tagContent)) {
          // This is a truncated attribute with no value, add empty value
          console.log(`[fixTruncatedAttributes] Fixed attribute with no value: ${attrName} -> ${attrName}=""`);
          return `${whitespace1}${attrName}=""${whitespace2}${closingTag}`;
        }
      }
      return match;
    });
    
    // Pattern 2: Find attributes that are followed by </tag> without closing quote
    // Example: id="page3_p10_s1</span> -> id="page3_p10_s1"></span>
    // This is the most common truncation pattern we see
    // Match: attribute="value</tag where value doesn't end with quote
    content = content.replace(/(\w+)=(["'])([^"']*?)<\/([a-zA-Z][a-zA-Z0-9]*>)/g, (match, attrName, quote, attrValue, closingTag) => {
      // The match captures: attrName="attrValue</tag
      // If attrValue doesn't end with quote (which it shouldn't in this pattern),
      // we need to add the closing quote before </
      return `${attrName}=${quote}${attrValue}${quote}</${closingTag}`;
    });
    
    // Pattern 3: Find attributes followed by <tag (opening tag) without closing quote
    // Example: id="page3_p10_s1<span -> id="page3_p10_s1"><span
    content = content.replace(/(\w+)=(["'])([^"']*?)<([a-zA-Z][a-zA-Z0-9]*\s)/g, (match, attrName, quote, attrValue, tagName) => {
      // Similar to above, but for opening tags
      return `${attrName}=${quote}${attrValue}${quote}<${tagName} `;
    });
    
    // Pattern 4: Find attributes at end of content or before whitespace + <
    // This handles edge cases
    content = content.replace(/(\w+)=(["'])([^"']*?)(?=\s*<)/g, (match, attrName, quote, attrValue, offset, string) => {
      // Check if match ends with quote
      if (match.endsWith(quote)) {
        return match; // Already complete
      }
      // Check what comes after
      const after = string.substring(offset + match.length);
      if (after.trim().startsWith('<')) {
        // Truncated attribute before a tag
        return `${attrName}=${quote}${attrValue}${quote}`;
      }
      return match;
    });
    
    // Pattern 5: More specific fix for attributes with no value before closing tags
    // Example: <span id</p> -> <span id=""></span>
    // This is a more targeted approach for the exact error we're seeing
    content = content.replace(/(\s+)(\w+)(?=\s*<\/[a-zA-Z][a-zA-Z0-9]*>)/g, (match, whitespace, attrName, offset, string) => {
      // Check if we're inside a tag by looking backwards
      const before = string.substring(Math.max(0, offset - 100), offset);
      const lastOpenTag = before.lastIndexOf('<');
      const lastCloseTag = before.lastIndexOf('>');
      
      // If we're inside a tag (last < is after last >)
      if (lastOpenTag > lastCloseTag) {
        const tagContent = before.substring(lastOpenTag + 1);
        // Check if this looks like an attribute (common attribute names)
        const commonAttrs = ['id', 'class', 'data-read-aloud', 'style', 'title', 'alt', 'src', 'href'];
        if (commonAttrs.includes(attrName.toLowerCase())) {
          // This is likely an attribute, add empty value
          return `${whitespace}${attrName}=""`;
        }
      }
      return match;
    });
    
    return content;
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

  /**
   * Generate content using Gemini with built-in rate limits and retries
   * @param {string} prompt - Prompt text
   * @param {Object} options - Optional settings (modelName, priority)
   * @returns {Promise<string>} - Response text
   */
  static async generateContent(prompt, options = {}) {
    try {
      const client = this.getClient();
      if (!client) {
        console.warn('[GeminiService] Client not configured (missing GEMINI_API_KEY)');
        return '';
      }

      const modelName = options.modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ model: modelName });
      const response = await this.generateWithBackoff(model, prompt, options.priority);
      if (!response) return '';

      if (response?.response?.text) {
        return await response.response.text();
      }

      if (typeof response === 'string') {
        return response;
      }

      if (response?.candidates && response.candidates.length > 0) {
        return response.candidates[0]?.content?.text || '';
      }

      return '';
    } catch (error) {
      console.warn('[GeminiService] generateContent error:', error.message);
      return '';
    }
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
   * Close unclosed HTML tags in truncated content
   * Uses a simple stack-based approach to track and close open tags
   * @param {string} content - HTML content that may have unclosed tags
   * @returns {string} Content with unclosed tags closed
   */
  static closeUnclosedTags(content) {
    // Self-closing tags that don't need closing
    const selfClosingTags = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
    
    // Find body content (between <body> and </body> or end of content)
    const bodyStartMatch = content.match(/<body[^>]*>/i);
    if (!bodyStartMatch) {
      return content; // No body tag, can't fix
    }
    
    const bodyStartIdx = bodyStartMatch.index;
    const bodyTagEndIdx = bodyStartMatch.index + bodyStartMatch[0].length;
    const bodyEndMatch = content.substring(bodyStartIdx).match(/<\/body>/i);
    const bodyEndIdx = bodyEndMatch ? bodyStartIdx + bodyEndMatch.index : -1;
    
    // Extract body inner content (between <body> and </body> or end)
    const bodyInnerStart = bodyTagEndIdx;
    const bodyInnerEnd = bodyEndIdx !== -1 ? bodyEndIdx : content.length;
    const bodyInnerContent = content.substring(bodyInnerStart, bodyInnerEnd);
    
    // Stack to track open tags
    const tagStack = [];
    const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    let match;
    
    // Reset regex lastIndex
    tagPattern.lastIndex = 0;
    
    // Find all tags and their positions
    while ((match = tagPattern.exec(bodyInnerContent)) !== null) {
      const isClosing = match[0].startsWith('</');
      const tagName = match[1].toLowerCase();
      
      // Check if it's a self-closing tag (ends with />)
      const isSelfClosing = match[0].endsWith('/>');
      
      if (!isClosing && !selfClosingTags.has(tagName) && !isSelfClosing) {
        // Opening tag - push to stack
        tagStack.push({ name: tagName });
      } else if (isClosing) {
        // Closing tag - pop matching opening tag from stack
        for (let i = tagStack.length - 1; i >= 0; i--) {
          if (tagStack[i].name === tagName) {
            tagStack.splice(i, 1);
            break;
          }
        }
      }
    }
    
    // If there are unclosed tags, close them in reverse order
    if (tagStack.length > 0) {
      let closingTags = '';
      for (let i = tagStack.length - 1; i >= 0; i--) {
        closingTags += `</${tagStack[i].name}>`;
      }
      
      // Insert closing tags before </body> or at the end of body content
      if (bodyEndIdx !== -1) {
        // Insert before </body>
        return content.substring(0, bodyEndIdx) + closingTags + content.substring(bodyEndIdx);
      } else {
        // No </body> tag yet, add closing tags at the end of body content
        return content.substring(0, bodyInnerEnd) + closingTags + content.substring(bodyInnerEnd);
      }
    }
    
    return content;
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
      
      // Check if response might be truncated (no closing </html> tag)
      const mightBeTruncated = doctypeIdx !== -1 && htmlEndIdx === -1;
      if (mightBeTruncated) {
        console.warn(`[Page ${pageNumber}] WARNING: Response appears truncated - missing </html> tag. Response length: ${responseContent.length}`);
        console.warn(`[Page ${pageNumber}] Last 500 chars of response:`, responseContent.substring(Math.max(0, responseContent.length - 500)));
        // Try to extract what we have and add closing tags
        let xhtml = responseContent.substring(doctypeIdx).trim();
        
        // Check what we have and add missing closing tags
        const hasBody = xhtml.includes('<body') || xhtml.includes('<body>');
        const hasBodyClose = xhtml.includes('</body>');
        const hasHtml = xhtml.includes('<html');
        
        // First, fix truncated attributes
        xhtml = this.fixTruncatedAttributes(xhtml);
        
        // Then, close any unclosed tags in the body content
        if (hasBody) {
          xhtml = this.closeUnclosedTags(xhtml);
        }
        
        // Ensure we have closing body tag if we have opening body tag
        if (hasBody && !hasBodyClose) {
              xhtml += '\n</body>';
        } else if (!hasBody && !hasBodyClose) {
          // No body tag at all - might be truncated before body starts
          // Try to add body tag before closing html
          // But first check if we have head closing tag
          if (xhtml.includes('</head>')) {
            // Has head, so add body after head
            const headCloseIdx = xhtml.lastIndexOf('</head>');
            xhtml = xhtml.substring(0, headCloseIdx + '</head>'.length) + '\n<body>\n</body>' + xhtml.substring(headCloseIdx + '</head>'.length);
          } else if (hasHtml) {
            // Has html tag but no head close, might be in head section
            // Add minimal structure: close head, add body, then close body
            xhtml += '\n</head>\n<body>\n</body>';
          }
        }
        
        // Always add closing html tag
        if (!xhtml.includes('</html>')) {
            xhtml += '\n</html>';
            console.warn(`[Page ${pageNumber}] Attempting to fix truncated response by adding closing tags`);
          }
        
        // Process the fixed truncated XHTML the same way as non-truncated
        if (xhtml.includes('</html>')) {
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
          
          console.log(`[Page ${pageNumber}] Successfully fixed truncated response (${xhtml.length} chars)`);
          return {
            xhtml,
            css: '',
            pageNumber
          };
        }
      } else if (doctypeIdx !== -1 && htmlEndIdx !== -1 && htmlEndIdx > doctypeIdx) {
        let xhtml = responseContent.substring(doctypeIdx, htmlEndIdx + '</html>'.length).trim();
        
        // Fix truncated attributes first
        xhtml = this.fixTruncatedAttributes(xhtml);
        
        // Close any unclosed tags even if response has </html> tag
        // (response might be truncated mid-tag but still have closing html tag)
        if (xhtml.includes('<body')) {
          xhtml = this.closeUnclosedTags(xhtml);
        }
        
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
   * Convert multiple PNG images (chapter pages) to a single XHTML document
   * @param {Array} pageImages - Array of page image objects [{path, pageNumber}, ...]
   * @param {string} chapterTitle - Title for the chapter
   * @param {number} chapterNumber - Chapter number
   * @param {Object} extractedImagesMap - Map of pageNumber -> extracted images array
   * @param {string} pageType - Page type: 'regular', 'cover', 'toc', or 'back'
   * @returns {Promise<{xhtml: string, css: string}|null>} XHTML and CSS or null if failed
   */
  static async convertChapterPngsToXhtml(pageImages, chapterTitle, chapterNumber, extractedImagesMap = {}, pageType = 'regular') {
    const client = this.getClient();
    if (!client) {
      return null;
    }

    // Check circuit breaker
    if (!CircuitBreakerService.canMakeRequest('Gemini')) {
      console.warn(`[Chapter ${chapterNumber}] Circuit breaker is OPEN, skipping XHTML conversion`);
      return null;
    }

    // Wrap entire operation in a timeout
    // Increased timeout for chapter processing (multiple pages = more processing time)
    const overallTimeout = 420000; // 420 seconds (7 minutes) for chapter processing
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Overall timeout after ${overallTimeout/1000}s`)), overallTimeout)
    );

    const operationPromise = RequestQueueService.enqueue('Gemini', async () => {
      // Rate limiting - more generous for chapter processing
      let retries = 0;
      const maxRetries = 8;
      const maxTotalWait = 60000; // 60 seconds max wait for rate limiting (chapters need more time)
      let totalWaitTime = 0;
      
      let acquired = false;
      while (!acquired && retries < maxRetries && totalWaitTime < maxTotalWait) {
        acquired = RateLimiterService.acquire('Gemini');
        if (!acquired) {
          const waitTime = RateLimiterService.getTimeUntilNextToken('Gemini');
          if (waitTime > 0 && waitTime < 10000 && (totalWaitTime + waitTime) < maxTotalWait) {
            const actualWait = Math.min(waitTime + 200, maxTotalWait - totalWaitTime);
            console.log(`[Chapter ${chapterNumber}] Waiting ${Math.round(actualWait/1000)}s for rate limit...`);
            await new Promise(resolve => setTimeout(resolve, actualWait));
            totalWaitTime += actualWait;
            retries++;
          } else {
            console.warn(`[Chapter ${chapterNumber}] Rate limit wait time too long, skipping`);
            return null;
          }
        }
      }
      
      if (!acquired) {
        console.warn(`[Chapter ${chapterNumber}] Rate limit retries exhausted, skipping XHTML conversion`);
        return null;
      }

      try {
        console.log(`[Chapter ${chapterNumber}] Processing ${pageImages.length} pages: ${pageImages.map(p => p.pageNumber).join(', ')}`);
        console.log(`[Chapter ${chapterNumber}] Timeout set to ${overallTimeout/1000}s, max output tokens: 65536`);
        
        // Read all page images
        const imageParts = [];
        for (const pageImg of pageImages) {
          const imageBuffer = await fs.readFile(pageImg.path);
          imageParts.push({
            inlineData: {
              data: imageBuffer.toString('base64'),
              mimeType: 'image/png'
            }
          });
        }
        console.log(`[Chapter ${chapterNumber}] Loaded ${imageParts.length} page images for processing`);


        // Collect all extracted images for all pages in this chapter
        const allExtractedImages = [];
        for (const pageImg of pageImages) {
          const extractedImages = extractedImagesMap[pageImg.pageNumber] || [];
          for (const img of extractedImages) {
            try {
              if (img.path && await fs.access(img.path).then(() => true).catch(() => false)) {
                const imgBuffer = await fs.readFile(img.path);
                allExtractedImages.push({
                  buffer: imgBuffer,
                  mimeType: img.mimeType || `image/${img.format || 'png'}`,
                  fileName: img.fileName || `image_${img.index || 'unknown'}.${img.format || 'png'}`,
                  width: img.width,
                  height: img.height,
                  pageNumber: pageImg.pageNumber
                });
              }
            } catch (imgError) {
              console.warn(`[Chapter ${chapterNumber}] Could not load extracted image:`, imgError.message);
            }
          }
        }

        // Add extracted images to imageParts
        for (const img of allExtractedImages) {
          imageParts.push({
            inlineData: {
              data: img.buffer.toString('base64'),
              mimeType: img.mimeType
            }
          });
        }

        const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
        const generationConfig = {
          maxOutputTokens: 65536, // Very high limit for multi-page chapter processing (max for gemini-2.5-flash)
          temperature: 0.1,
        };
        const model = client.getGenerativeModel({ 
          model: modelName,
          generationConfig: generationConfig
        });

        const pageList = pageImages.map(p => `Page ${p.pageNumber}`).join(', ');
        const imageFileList = allExtractedImages.map((img, idx) => 
          `  ${idx + 1}. ${img.fileName} (from page ${img.pageNumber}, ${img.width}x${img.height}px)`
        ).join('\n');

        // Build page type instructions
        // Per requirement: treat TOC same as cover/back (single full-page placeholder, not structured extraction)
        let pageTypeInstructions = '';
        if (pageType === 'cover' || pageType === 'back' || pageType === 'toc') {
          const isCover = pageType === 'cover';
          const isBack = pageType === 'back';
          const isToc = pageType === 'toc';
          const specialLabel = isCover ? 'COVER PAGE' : isBack ? 'BACK COVER' : 'TABLE OF CONTENTS (TOC) PAGE';
          const specialDesc = isCover ? 'cover' : isBack ? 'back cover' : 'TOC';
          const placeholderIdSuffix = isCover ? 'cover_img' : isBack ? 'back_img' : 'toc_img';
          const placeholderTitle = isCover
            ? 'Front cover image'
            : isBack
              ? 'Back cover image'
              : 'Table of Contents page image';
          const placeholderPerPage = pageImages.map(p => 
            `  - Page ${p.pageNumber}: <div class="image-drop-zone" id="chapter${chapterNumber}_page${p.pageNumber}_${placeholderIdSuffix}" title="${placeholderTitle}" style="width: 100%; min-height: 100vh; background: transparent; border: none;"></div>`
          ).join('\n');

          pageTypeInstructions = `
**⭐ SPECIAL PAGE TYPE: ${specialLabel}**
This is a ${specialDesc} page. Create a VERY SIMPLE layout with:
- **Create one placeholder per page listed below:** 
${placeholderPerPage}
- Keep the layout extremely simple - just the placeholder div
- The user will manually insert the final image in the editor`;
        } else {
          pageTypeInstructions = `
**PAGE TYPE: REGULAR CHAPTER**
This is a regular chapter with standard content. Follow all standard conversion rules.`;
        }

        const promptHeader = `You are converting a chapter from a PDF document to EPUB format. Analyze the provided ${pageImages.length} image(s) and generate a SINGLE, complete XHTML document.

**🚫 CRITICAL RULE - READ FIRST:**
**NEVER create <img> tags with src attributes. You MUST create ONLY empty <div> placeholders with class="image-drop-zone" for ALL images. NO <img src="..."> tags allowed!**

**CHAPTER INFORMATION:**
- Chapter Title: ${chapterTitle}
- Chapter Number: ${chapterNumber}
- Pages in this chapter: ${pageList}
- Total pages: ${pageImages.length}
${pageTypeInstructions}

**CRITICAL OUTPUT REQUIREMENTS - MUST BE COMPLETE:**
- You MUST return the ENTIRE XHTML document from <!DOCTYPE to </html> - DO NOT truncate mid-tag or mid-attribute
- ALL attributes MUST have values - NEVER write incomplete attributes like id="value"
- If you cannot complete the entire document, prioritize completing all opening tags and attributes before closing tags
- Create ONE unified XHTML document containing ALL content from ALL ${pageImages.length} page images
- Ensure every opening tag has a matching closing tag
- Every attribute must have a value in quotes: id="value", class="value", NOT id or class
- The output MUST be valid XHTML 1.0 Strict that can be parsed by an XML parser
- **PRIORITY ORDER if output is limited:**
  1. Complete all attribute values (id="", class="", etc.) - NEVER leave attributes incomplete
  2. Close all opened tags properly
  3. Ensure </body> and </html> closing tags are present
  4. Then add content as space allows

**EPUB 3 REFLOWABLE STRATEGY (CRITICAL - CANVAS MAPPING):**
1) **THE PAGE IS A CANVAS:** Treat the entire page as a coordinate-based canvas.
2) **ABSOLUTE POSITIONING FOR EVERYTHING:** To match the PDF's visual fidelity, you MUST use position: absolute with percentage (%) units for:
   - ALL Image Placeholders (.image-drop-zone)
   - ALL Text Blocks (.draggable-text-block)
   - ALL Decorative UI elements (banners, boxes, shapes)
3) **OVERLAYING IS REQUIRED:** If text or a banner appears "on top" of an image in the PDF (like a title box over a sky or a caption over a photo), you MUST position the image first (lower z-index) and then position the text/banner at the same coordinates (higher z-index).
4) **NO STANDARD FLOW (MANDATORY):** Do NOT let elements just "flow" one after another. If you do, they will stack vertically and not overlap. Use top and left for every single block to place it exactly where it is in the PDF.
   - **SAME VERTICAL START:** If two elements (like a background image and an overlay) start at the same vertical position, they MUST share the same top percentage (e.g., both top: 0%).
   - **TRUE OVERLAPPING:** If a smaller image or text box is "on top" of a larger image, its top and left coordinates MUST place it within the bounds of the larger image, and it MUST have a higher z-index.
5) **BACKGROUND DETECTION:** If an image fills the background or covers the top half of the page while other elements sit inside its area, treat it as the base layer (z-index: 1) and place overlays on top (z-index: 5 or higher).
6) Recreate the visual "look and feel" (colors, typography, spacing, **exact widths**) using CSS.
7) Use background colors, border-radius, and padding on div wrappers to replicate banners, buttons, and colored sections. **DO NOT default to 100% width; match the visual width in the PDF.** For example, a green pill-shaped title banner should have width: 40%; border-radius: 50px; position: absolute; top: 5%; left: 5%;.

**IMAGE HANDLING & ASSET FITTING (CRITICAL - MANDATORY CLASSES):**

1) **FOR EVERY illustration, icon, logo, photo, graphic, or visual element in the PDF, you MUST create an empty div with ONE of these classes:
   - class="image-drop-zone" (preferred for main images)
   - class="image-placeholder" (alternative, also acceptable)

2) **ID FORMAT:** id="chapter${chapterNumber}_page{pageNum}_img{N}"
   - Use consistent naming: prefer chapter${chapterNumber}_page{pageNum}_img{N} for images
   - Example: id="chapter1_page1_img1", id="chapter1_page2_img1", etc.

3) **TITLE ATTRIBUTE:** ALWAYS include a detailed description of the image for the user.
   - Example: title="A brown horse with its mouth wide open, showing its teeth, against a blue sky"

4) **PRECISE POSITIONING & LAYERING (CRITICAL - MATCH PDF EXACTLY):**
   - **Observe the EXACT position and layering** of each element.
   - **OVERLAPPING ELEMENTS (MANDATORY):** If one image or box is on top of another, you MUST use z-index and absolute coordinates to recreate that overlap exactly. 
   - **NO SIDE-BY-SIDE SPLITTING:** If an image appears to continue BEHIND a text box or banner, DO NOT create two separate image placeholders side-by-side. Instead, create ONE large image placeholder that covers the entire area (including the area behind the text/banner) and use z-index to place the text/banner on top.
   - **BACKGROUND DECORATIONS:** Look for background textures, shadows, or decorative background images behind the main content. Create these using additional div layers with absolute positioning and appropriate z-index.
   - Use inline styles with position, top, left, width, height to match the PDF layout precisely. Use % units for all dimensions and positions.
   - Example: style="position: absolute; top: 10%; left: 5%; width: 40%; height: 30%; z-index: 5;"
   - **For images cut to each other:** Position them with precise coordinates so they touch or overlap exactly as they do in the PDF.
   - **Multiple images stacked:** Each gets its own positioned placeholder with appropriate z-index to maintain the visual stack. Background images should usually be z-index: 1, and overlays z-index: 2 or higher.
   - **TEXT OVERLAYS:** Ensure text blocks that sit on top of images have a higher z-index (draggable-text-block defaults to 10) than the image placeholders.

5) **PLACEHOLDER STYLING (CRITICAL - INVISIBLE PLACEHOLDERS):**
   - **NO borders** - placeholders should be invisible/transparent
   - **NO background color** - use background: transparent
   - Use aspect-ratio or explicit height to reserve space
   - Example: style="background: transparent; border: none; aspect-ratio: 16/9;"

6) **IMAGE ROTATION & TRANSFORMATION (CRITICAL):**
   - **CAREFULLY OBSERVE** if images in the PDF are rotated, tilted, or skewed
   - Add CSS transform to the inline style
   - Example: style="transform: rotate(-5deg); position: absolute; top: 10%; left: 5%;"
   - Combine positioning and rotation in the same style attribute

7) **CRITICAL:** NEVER create a div for an image without adding class="image-drop-zone" or class="image-placeholder". 
   - If you create a div with a title describing an image, it MUST have one of these classes.
   - Empty divs with image descriptions but no class will NOT work in the editor.

8) **ABSOLUTELY FORBIDDEN - MOST CRITICAL RULE - NO <IMG> TAGS ALLOWED:**
   - **NEVER create any <img> tag with src attribute under ANY circumstance**
   - **DO NOT write <img src="images/..." /> or <img src="..." /> - THIS IS 100% FORBIDDEN**
   - **You MUST create ONLY empty div elements with class="image-drop-zone" or class="image-placeholder"**
   - **EVERY single image, photo, graphic, icon, logo MUST be an empty div placeholder, NOT an <img> tag**
   - **NO EXCEPTIONS - Even if you detect images in the PNG, you MUST create ONLY div placeholders, NEVER <img> tags**
   - **WRONG (FORBIDDEN):** <img src="images/horse.jpg" alt="Horse" />
   - **CORRECT (REQUIRED):** <div class="image-drop-zone" id="page1_img1" title="Horse image" style="width: 80%; aspect-ratio: 16/9; background: transparent; border: none;"></div>

**LAYOUT DECISION:**
1) **TWO-COLUMN (Multi-Page Split):** Use ONLY if the image shows a visible divider line or two distinct page numbers. Use .container with two .page children.
2) **SINGLE-COLUMN (Default):** Standard single worksheet. Use a single .page element.

**AUDIO SYNC REQUIREMENTS (MANDATORY) - HIERARCHICAL NESTED STRUCTURE FOR ALL ELEMENTS:**
- **CRITICAL: ALL text elements must use NESTED hierarchical structure to support word/sentence/paragraph granularity**
- **STRUCTURE: Parent Element → Sentences → Words (nested hierarchy)**
- **ID FORMAT: chapter${chapterNumber}_page{pageNum}_{type}{number}_{subtype}{number}...**

**VISUAL STYLING & COLOR SAMPLING:**

1) **Colors:** Identify the specific hex colors in the PDF (e.g., the red in the TIME logo, the tan/brown background of horse sections, the blue TOC border). Apply these to 'background-color' or 'color' in CSS.

2) **Typography:** Identify if text is Serif or Sans-Serif and apply globally.

3) **Borders:** Recreate decorative borders (like the TOC box on page 3) using CSS 'border' and 'border-radius'.

**HIERARCHICAL STRUCTURE (MANDATORY FOR ALL TEXT ELEMENTS):**
- **Paragraphs**: <p id="chapter${chapterNumber}_page{pageNum}_p1" class="paragraph-block" data-read-aloud="true">
  - Inside paragraphs, NEST sentences: <span class="sync-sentence" id="chapter${chapterNumber}_page{pageNum}_p1_s1" data-read-aloud="true">
  - Inside sentences, NEST words: <span class="sync-word" id="chapter${chapterNumber}_page{pageNum}_p1_s1_w1" data-read-aloud="true">word</span>

- **Headers (h1-h6)**: <h1 id="chapter${chapterNumber}_h1" data-read-aloud="true">
  - Inside headers, NEST sentences: <span class="sync-sentence" id="chapter${chapterNumber}_h1_s1" data-read-aloud="true">
  - Inside sentences, NEST words: <span class="sync-word" id="chapter${chapterNumber}_h1_s1_w1" data-read-aloud="true">word</span>

- **List Items (li)**: <li id="chapter${chapterNumber}_page{pageNum}_li1" data-read-aloud="true">
  - Inside list items, NEST sentences: <span class="sync-sentence" id="chapter${chapterNumber}_page{pageNum}_li1_s1" data-read-aloud="true">
  - Inside sentences, NEST words: <span class="sync-word" id="chapter${chapterNumber}_page{pageNum}_li1_s1_w1" data-read-aloud="true">word</span>

- **Table Cells (td, th)**: <td id="chapter${chapterNumber}_page{pageNum}_td1" data-read-aloud="true">
  - Inside table cells, NEST sentences: <span class="sync-sentence" id="chapter${chapterNumber}_page{pageNum}_td1_s1" data-read-aloud="true">
  - Inside sentences, NEST words: <span class="sync-word" id="chapter${chapterNumber}_page{pageNum}_td1_s1_w1" data-read-aloud="true">word</span>

- **Headers/Footers**: <header id="chapter${chapterNumber}_page{pageNum}_header1" data-read-aloud="true">
  - Inside headers/footers, NEST sentences: <span class="sync-sentence" id="chapter${chapterNumber}_page{pageNum}_header1_s1" data-read-aloud="true">
  - Inside sentences, NEST words: <span class="sync-word" id="chapter${chapterNumber}_page{pageNum}_header1_s1_w1" data-read-aloud="true">word</span>

- **Divs, Sections, Articles**: <div id="chapter${chapterNumber}_page{pageNum}_div1" data-read-aloud="true">
  - Inside divs/sections/articles, NEST sentences: <span class="sync-sentence" id="chapter${chapterNumber}_page{pageNum}_div1_s1" data-read-aloud="true">
  - Inside sentences, NEST words: <span class="sync-word" id="chapter${chapterNumber}_page{pageNum}_div1_s1_w1" data-read-aloud="true">word</span>

- **This nested structure allows CSS highlighting to work at element, sentence, or word level for ALL elements**

**EXAMPLE STRUCTURE (REQUIRED FORMAT):**
<p id="chapter${chapterNumber}_page1_p1" class="paragraph-block" data-read-aloud="true">
  <span class="sync-sentence" id="chapter${chapterNumber}_page1_p1_s1" data-read-aloud="true">
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w1">If</span>
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w2">you</span>
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w3">were</span>
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w4">a</span>
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w5">horse.</span>
  </span>
  <span class="sync-sentence" id="chapter${chapterNumber}_page1_p1_s2" data-read-aloud="true">
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s2_w1">You</span>
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s2_w2">would</span>
    <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s2_w3">gallop.</span>
  </span>
</p>

**ID NUMBERING RULES (ALL ELEMENTS FOLLOW HIERARCHY):**
  * Headers: chapter${chapterNumber}_h1, chapter${chapterNumber}_h2, chapter${chapterNumber}_h3 (sequential, regardless of h1-h6 level)
    - Sentences in headers: chapter${chapterNumber}_h{N}_s{N} (e.g., chapter${chapterNumber}_h1_s1, chapter${chapterNumber}_h1_s2)
    - Words in header sentences: chapter${chapterNumber}_h{N}_s{N}_w{N} (e.g., chapter${chapterNumber}_h1_s1_w1, chapter${chapterNumber}_h1_s1_w2)
  * Paragraphs: chapter${chapterNumber}_page{pageNum}_p1, chapter${chapterNumber}_page{pageNum}_p2, etc.
    - Sentences in paragraphs: chapter${chapterNumber}_page{pageNum}_p{N}_s{N} (e.g., chapter${chapterNumber}_page1_p1_s1, chapter${chapterNumber}_page1_p1_s2)
    - Words in paragraph sentences: chapter${chapterNumber}_page{pageNum}_p{N}_s{N}_w{N}
  * List Items: chapter${chapterNumber}_page{pageNum}_li1, chapter${chapterNumber}_page{pageNum}_li2, etc.
    - Sentences in list items: chapter${chapterNumber}_page{pageNum}_li{N}_s{N}
    - Words in list item sentences: chapter${chapterNumber}_page{pageNum}_li{N}_s{N}_w{N}
  * Table Cells: chapter${chapterNumber}_page{pageNum}_td1, chapter${chapterNumber}_page{pageNum}_td2, etc.
    - Sentences in table cells: chapter${chapterNumber}_page{pageNum}_td{N}_s{N}
    - Words in table cell sentences: chapter${chapterNumber}_page{pageNum}_td{N}_s{N}_w{N}
  * Headers/Footers: chapter${chapterNumber}_page{pageNum}_header1, chapter${chapterNumber}_page{pageNum}_footer1, etc.
    - Sentences in headers/footers: chapter${chapterNumber}_page{pageNum}_header{N}_s{N}
    - Words in header/footer sentences: chapter${chapterNumber}_page{pageNum}_header{N}_s{N}_w{N}
  * Divs/Sections: chapter${chapterNumber}_page{pageNum}_div1, chapter${chapterNumber}_page{pageNum}_section1, etc.
    - Sentences in divs/sections: chapter${chapterNumber}_page{pageNum}_div{N}_s{N}
    - Words in div/section sentences: chapter${chapterNumber}_page{pageNum}_div{N}_s{N}_w{N}
  * **ALWAYS nest: words inside sentences, sentences inside parent elements (p, h1-h6, li, td, th, header, footer, div, section, etc.)**
  * Be consistent: same element types use same numbering pattern across all pages
- **NO TEXT ELEMENT SHOULD BE WITHOUT AN ID** - Every piece of text must be wrapped in an element with a unique ID
- **Even if text appears multiple times (duplicates), each occurrence must have a unique ID**
- **Page numbers, headers, footers, titles, captions, labels - ALL must have unique IDs**

**BACKROUND & CANVAS LOGIC (CRITICAL):**
1) **The Page Container:** Use <div class="page" style="position: relative; width: 100%; min-height: 100vh;"> as the parent for everything.
2) **Everything is Absolute:** Every child inside .page MUST have position: absolute;.
3) **Layering Order:**
   - **Background/Main Images:** z-index: 1. Example: A large image of horses that fills the page.
   - **Decorative Banners/Boxes:** z-index: 5. Example: The green "If You Were a Horse" pill-shaped box.
   - **Text Blocks:** z-index: 10. Example: The actual text inside the banners or floating on the image.
4) **Coordinate Mapping:** Use top, left, width, and height in % for every element to match the PDF's visual layout precisely.
5) **Example of Overlay:**
   [Example omitted for simplicity in search_replace, but I will include the code blocks if needed]


**REMINDER - ALL IMAGE PLACEHOLDERS MUST HAVE CLASSES:**
- Every <div> that represents an image, illustration, icon, logo, or graphic MUST have either:
  - class="image-drop-zone" OR
  - class="image-placeholder"
- Do NOT create image divs without these classes. They will not be detected by the editor.

**VISUAL ACCURACY:**
- Replicate the layout of the PDF exactly by using percentage-based positioning.
- If text is inside a colored box (like the red "TIME" banner), apply that 'background-color' directly to the draggable-text-block.

**CSS REQUIREMENTS (EMBEDDED):**
- .page { position: relative; width: 100%; min-height: 100vh; display: block; }
- .canvas-background { 
    position: absolute; 
    top: 0; left: 0; width: 100%; height: 100%; 
    z-index: 1; 
  }
- .draggable-text-block { 
    position: absolute; 
    z-index: 10; 
    cursor: move; 
    padding: 0.5em;
  }
- .image-drop-zone { 
    width: 100%; height: 100%; 
    background: #f0f0f0; 
    display: flex; align-items: center; justify-content: center; 
  }

**XHTML 1.0 STRICT REQUIREMENTS:**
- DOCTYPE: <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
- All tags lowercase, properly nested, self-closing tags end with />
- Use relative units (em, rem, %, vw, vh) - NO px units for layout
- Represent ALL graphics as <div> placeholders with class="image-drop-zone" or class="image-placeholder" - NEVER use <img> tags
- **CRITICAL: ALL attributes MUST have values in quotes - id="value", class="value", style="value" - NEVER id, class, or style without quotes**
- **CRITICAL: If an attribute value is empty, use empty quotes: id="" NOT id**
- **CRITICAL: Complete ALL attributes before closing any tag - incomplete attributes cause XML parsing errors**

**CSS REQUIREMENTS - CRITICAL:**
- ALL CSS MUST be inside a <style type="text/css"> tag within <head>
- Include: .-epub-media-overlay-active { background-color: #ffff00; }
- Preserve text hierarchy (h1, h2, h3)
- Use flexbox for layouts
- CSS: Embedded in <head>. Include 

 - .image-drop-zone, .image-placeholder { 
    background: transparent;
    border: none;
    display: block;
    position: relative;
  }

- .image-drop-zone img, .image-placeholder img { 
    width: 100%; 
    height: 100%; 
    object-fit: contain; 
  }

**CRITICAL REMINDER:** When you create ANY div that represents an image (illustration, photo, icon, logo, graphic), you MUST add class="image-drop-zone" or class="image-placeholder" to it. Do not create image divs without these classes.

- Use relative units (em, rem, %) for all text and spacing.

**OUTPUT FORMAT - CRITICAL:**
Return ONLY the raw XHTML content. 
- Do NOT wrap in JSON
- Do NOT use markdown code blocks (no triple backticks with xml/html/xhtml)
- Do NOT use any markdown formatting
- Start directly with <!DOCTYPE and end with </html>
- Return pure XHTML only, nothing else
- **MANDATORY: Complete ALL attributes with values before closing any tag**
- **MANDATORY: If output is truncated, prioritize completing attributes and closing tags over adding new content**
- **Example of CORRECT: <span class="sync-sentence" id="chapter1_page1_p1_s1"></span>**
- **Example of WRONG: <span class="sync-sentence" id</span> (missing value)**

Example structure for CHAPTER ${chapterNumber} (showing HIERARCHICAL NESTED structure for ALL elements):
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${chapterTitle}</title>
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
    <header id="chapter${chapterNumber}_header1" data-read-aloud="true">
      <h1 id="chapter${chapterNumber}_h1" data-read-aloud="true">
        <span class="sync-sentence" id="chapter${chapterNumber}_h1_s1" data-read-aloud="true">
          <span class="sync-word" id="chapter${chapterNumber}_h1_s1_w1">Chapter</span>
          <span class="sync-word" id="chapter${chapterNumber}_h1_s1_w2">Title</span>
        </span>
      </h1>
    </header>
    <!-- Paragraphs with NESTED sentences and words -->
    <p id="chapter${chapterNumber}_page1_p1" class="paragraph-block" data-read-aloud="true">
      <span class="sync-sentence" id="chapter${chapterNumber}_page1_p1_s1" data-read-aloud="true">
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w1">If</span>
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w2">you</span>
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w3">were</span>
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w4">a</span>
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s1_w5">horse.</span>
      </span>
      <span class="sync-sentence" id="chapter${chapterNumber}_page1_p1_s2" data-read-aloud="true">
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s2_w1">You</span>
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s2_w2">would</span>
        <span class="sync-word" id="chapter${chapterNumber}_page1_p1_s2_w3">gallop.</span>
      </span>
    </p>
    <!-- List items with NESTED sentences and words -->
    <ul>
      <li id="chapter${chapterNumber}_page1_li1" data-read-aloud="true">
        <span class="sync-sentence" id="chapter${chapterNumber}_page1_li1_s1" data-read-aloud="true">
          <span class="sync-word" id="chapter${chapterNumber}_page1_li1_s1_w1">First</span>
          <span class="sync-word" id="chapter${chapterNumber}_page1_li1_s1_w2">item.</span>
        </span>
      </li>
      <li id="chapter${chapterNumber}_page1_li2" data-read-aloud="true">
        <span class="sync-sentence" id="chapter${chapterNumber}_page1_li2_s1" data-read-aloud="true">
          <span class="sync-word" id="chapter${chapterNumber}_page1_li2_s1_w1">Second</span>
          <span class="sync-word" id="chapter${chapterNumber}_page1_li2_s1_w2">item.</span>
        </span>
      </li>
    </ul>
    <!-- Table cells with NESTED sentences and words -->
    <table>
      <tr>
        <td id="chapter${chapterNumber}_page1_td1" data-read-aloud="true">
          <span class="sync-sentence" id="chapter${chapterNumber}_page1_td1_s1" data-read-aloud="true">
            <span class="sync-word" id="chapter${chapterNumber}_page1_td1_s1_w1">Cell</span>
            <span class="sync-word" id="chapter${chapterNumber}_page1_td1_s1_w2">content.</span>
          </span>
        </td>
      </tr>
    </table>
    <!-- Image placeholders - positioned to match PDF layout -->
    <!-- Example: Overlapping images with precise positioning -->
    <div style="position: relative; width: 100%; height: 500px;">
      <!-- Background image -->
      <div id="chapter${chapterNumber}_page1_img1" class="image-drop-zone" 
           title="Background landscape" 
           style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; background: transparent; border: none;"></div>
      <!-- Foreground image overlapping -->
      <div id="chapter${chapterNumber}_page1_img2" class="image-placeholder" 
           title="Horse in foreground, slightly tilted" 
           style="position: absolute; top: 20%; left: 30%; width: 40%; height: 60%; z-index: 2; background: transparent; border: none; transform: rotate(-5deg);"></div>
    </div>
    <!-- Footer with NESTED sentences and words -->
    <footer id="chapter${chapterNumber}_page1_footer1" data-read-aloud="true">
      <span class="sync-sentence" id="chapter${chapterNumber}_page1_footer1_s1" data-read-aloud="true">
        <span class="sync-word" id="chapter${chapterNumber}_page1_footer1_s1_w1">Page</span>
        <span class="sync-word" id="chapter${chapterNumber}_page1_footer1_s1_w2">1</span>
      </span>
    </footer>
  </div>
</body>
</html>

**IMPORTANT REMINDERS:**
- Create a cohesive flow - this is one continuous chapter combining ${pageImages.length} pages
- Every text element MUST have the nested word/sentence structure with unique IDs
- Every image MUST have class="image-drop-zone" or class="image-placeholder"
- Use position: absolute with % units for image placeholders to match PDF positioning
- Image placeholders should be transparent with no borders (background: transparent; border: none;)
- For overlapping images, use z-index to control stacking
- Preserve colors, fonts, and visual hierarchy from the original pages`;

        const isSpecialPage = pageType === 'cover' || pageType === 'back' || pageType === 'toc';
        const promptSplitMarker = '**CRITICAL OUTPUT REQUIREMENTS - MUST BE COMPLETE:**';
        const generalIndex = promptHeader.indexOf(promptSplitMarker);
        const promptLead = generalIndex >= 0 ? promptHeader.slice(0, generalIndex).trim() : promptHeader;
        const placeholderIdSuffix = pageType === 'cover' ? 'cover_img' : pageType === 'back' ? 'back_img' : 'toc_img';
        const placeholderTitle = pageType === 'cover'
          ? 'Front cover image'
          : pageType === 'back'
            ? 'Back cover image'
            : 'Table of Contents page image';

        const specialPromptBody = `
**CRITICAL OUTPUT REQUIREMENTS - SPECIAL:** 
- Return only the DOCTYPE/html structure that wraps the placeholder div.
- Include a single <div class="page"> wrapper containing the placeholder.
- DO NOT add paragraphs, lists, headings, tables, or TOC entries beyond an optional short caption.
- The placeholder must use the id and title specified above and span the full viewport.
- Keep CSS minimal (basic body reset and placeholder sizing).
**DOCUMENT STRUCTURE EXAMPLE:**
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${chapterTitle}</title>
  <style type="text/css">
    body { margin: 0; padding: 0; font-family: serif; }
    .page { position: relative; width: 100%; min-height: 100vh; }
    .image-drop-zone { width: 100%; min-height: 100vh; background: transparent; border: none; }
  </style>
</head>
<body>
  <div class="page">
    <div class="image-drop-zone" id="chapter${chapterNumber}_page{pageNum}_${placeholderIdSuffix}" title="${placeholderTitle}"></div>
  </div>
</body>
</html>`;

        let prompt = promptHeader;
        if (isSpecialPage && generalIndex >= 0) {
          prompt = `${promptLead}\n\n${specialPromptBody}`;
        }

        console.log(`[Chapter ${chapterNumber}] Calling Gemini API with ${imageParts.length} images and detailed prompt...`);
        console.log(`[Chapter ${chapterNumber}] This may take several minutes for ${pageImages.length} pages. Please wait...`);
        
        const result = await model.generateContent([
          { text: prompt },
          ...imageParts
        ]);

        console.log(`[Chapter ${chapterNumber}] Received response from Gemini API, processing...`);
        const response = result.response;
        let text = response.text();

        if (!text || text.trim().length === 0) {
          console.error(`[Chapter ${chapterNumber}] Empty response from Gemini API`);
          CircuitBreakerService.recordFailure('Gemini');
          return null;
        }

        // Clean up the response
        text = text.trim();
        // Remove markdown code blocks - handle various formats
        text = text.replace(/^```\w*\s*\n?/i, '').replace(/\n?```\s*$/i, '');
        text = text.trim();

        // Sanitize XHTML
        text = this.sanitizeXhtml(text);
        text = this.replaceImgTagsWithPlaceholders(text);

        // Split xhtml and css (css is embedded in xhtml already)
        const xhtml = text;
        const css = ''; // CSS is embedded in the XHTML

        console.log(`[Chapter ${chapterNumber}] Successfully generated XHTML (${xhtml.length} chars) for ${pageImages.length} pages`);
        CircuitBreakerService.recordSuccess('Gemini');

        return { xhtml, css };

      } catch (error) {
        console.error(`[Chapter ${chapterNumber}] Error during XHTML conversion:`, error.message);
        CircuitBreakerService.recordFailure('Gemini');
        return null;
      }
    });

    try {
      const result = await Promise.race([operationPromise, timeoutPromise]);
      return result;
    } catch (error) {
      if (error.message.includes('timeout')) {
        console.error(`[Chapter ${chapterNumber}] Operation timed out after ${overallTimeout/1000}s processing ${pageImages.length} pages`);
        console.error(`[Chapter ${chapterNumber}] Consider: 1) Processing fewer pages per chapter, or 2) API may be experiencing high load`);
      } else {
        console.error(`[Chapter ${chapterNumber}] Error:`, error.message);
      }
      CircuitBreakerService.recordFailure('Gemini');
      return null;
    }
  }

  /**
   * Convert PNG image(s) of PDF page(s) to XHTML 1.0 Strict markup and CSS
   * @param {string|Array} imagePath - Path to PNG image file OR array of {path, pageNumber} objects for multiple pages
   * @param {number|string} pageNumber - Page number OR chapter title if multiple pages
   * @param {Array|Object} extractedImages - Extracted images array (single page) OR map of {pageNumber: images[]} (multiple pages)
   * @returns {Promise<{xhtml: string, css: string}|null>} XHTML and CSS or null if failed
   */
  static async convertPngToXhtml(imagePath, pageNumber, extractedImages = []) {
    // Handle multiple pages (chapter-based processing)
    if (Array.isArray(imagePath)) {
      const pageImages = imagePath;
      const chapterTitle = typeof pageNumber === 'string' ? pageNumber : `Chapter ${pageNumber}`;
      const chapterNumber = typeof pageNumber === 'number' ? pageNumber : 1;
      const extractedImagesMap = extractedImages;
      
      return this.convertChapterPngsToXhtml(pageImages, chapterTitle, chapterNumber, extractedImagesMap);
    }
    
    // Single page processing (original behavior)
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
      // Track pending API call promise at function scope so timeout handler can access it
      let pendingApiCallPromise = null;
      
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
        
        // Read extracted images if provided
        const extractedImageBuffers = [];
        if (extractedImages && extractedImages.length > 0) {
          console.log(`[Page ${pageNumber}] Including ${extractedImages.length} extracted image(s) from PDF...`);
          for (const img of extractedImages) {
            try {
              if (img.path && await fs.access(img.path).then(() => true).catch(() => false)) {
                const imgBuffer = await fs.readFile(img.path);
                extractedImageBuffers.push({
                  buffer: imgBuffer,
                  mimeType: img.mimeType || `image/${img.format || 'png'}`,
                  fileName: img.fileName || `image_${img.index || 'unknown'}.${img.format || 'png'}`,
                  width: img.width,
                  height: img.height
                });
                console.log(`[Page ${pageNumber}] Loaded extracted image: ${img.fileName} (${img.width}x${img.height}px)`);
              } else if (img.buffer) {
                // Image buffer already provided
                extractedImageBuffers.push({
                  buffer: img.buffer,
                  mimeType: img.mimeType || `image/${img.format || 'png'}`,
                  fileName: img.fileName || `image_${img.index || 'unknown'}.${img.format || 'png'}`,
                  width: img.width,
                  height: img.height
                });
              }
            } catch (imgError) {
              console.warn(`[Page ${pageNumber}] Could not load extracted image ${img.fileName || img.path}:`, imgError.message);
            }
          }
        }
        
        const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
        // Configure generation settings with higher output token limit for long pages
        // gemini-2.5-flash supports up to 8192 output tokens, but we can try 16384 for newer models
        // If the model doesn't support it, it will fall back to its maximum
        const generationConfig = {
          maxOutputTokens: 16384, // Increased to handle complex pages with many images and reduce truncation
          temperature: 0.1, // Lower temperature for more consistent XHTML generation
        };
        const model = client.getGenerativeModel({ 
          model: modelName,
          generationConfig: generationConfig
        });

        // Build prompt with image instructions if extracted images are provided
        const imageFileList = extractedImageBuffers.map((img, idx) => 
          `  ${idx + 1}. ${img.fileName} (${img.width}x${img.height}px, ${img.mimeType})`
        ).join('\n');
        
        

        const prompt = `Analyze the provided image(s) of the worksheet page(s) and generate complete, valid XHTML with ALL CSS embedded inside.

**🚫 CRITICAL RULE - READ FIRST:**
**NEVER create <img> tags with src attributes. You MUST create ONLY empty <div> placeholders with class="image-drop-zone" for ALL images. NO <img src="..."> tags allowed!**

**CRITICAL OUTPUT REQUIREMENTS - MUST BE COMPLETE:**
- You MUST return the ENTIRE XHTML document from <!DOCTYPE to </html> - DO NOT truncate mid-tag or mid-attribute
- ALL attributes MUST have values - NEVER write incomplete attributes like id="value"
- If you cannot complete the entire document, prioritize completing all opening tags and attributes before closing tags
- Ensure every opening tag has a matching closing tag
- Every attribute must have a value in quotes: id="value", class="value", NOT id or class
- The output MUST be valid XHTML 1.0 Strict that can be parsed by an XML parser
- **PRIORITY ORDER if output is limited:**
  1. Complete all attribute values (id="", class="", etc.) - NEVER leave attributes incomplete
  2. Close all opened tags properly
  3. Ensure </body> and </html> closing tags are present
  4. Then add content as space allows

        **THIS IS PAGE ${pageNumber}** - Use this page number in ALL element IDs to ensure global uniqueness.

        
 **EPUB 3 REFLOWABLE STRATEGY (CRITICAL - CANVAS MAPPING):**
1) **THE PAGE IS A CANVAS:** Treat the entire page as a coordinate-based canvas.
2) **ABSOLUTE POSITIONING FOR EVERYTHING:** To match the PDF's visual fidelity, you MUST use position: absolute with percentage (%) units for:
   - ALL Image Placeholders (.image-drop-zone)
   - ALL Text Blocks (.draggable-text-block)
   - ALL Decorative UI elements (banners, boxes, shapes)
3) **OVERLAYING IS REQUIRED:** If text or a banner appears "on top" of an image in the PDF (like a title box over a sky or a caption over a photo), you MUST position the image first (lower z-index) and then position the text/banner at the same coordinates (higher z-index).
4) **NO STANDARD FLOW:** Do NOT let elements just "flow" one after another. If you do, they will stack vertically and not overlap. Use top and left for every single block to place it exactly where it is in the PDF.
5) **MATCH BACKGROUNDS:** If a page has a large background image, create a full-page placeholder first, then place everything else on top of it using absolute coordinates.
6) Recreate the visual "look and feel" (colors, typography, spacing, exact widths) using CSS.
7) Use background colors, border-radius, and padding on div wrappers to replicate banners, buttons, and colored sections. DO NOT default to 100% width; match the visual width in the PDF. For example, a green pill-shaped title banner should have width: 40%; border-radius: 50px; position: absolute; top: 5%; left: 5%;.
7) Use background colors, border-radius, and padding on div wrappers to replicate banners, buttons, and colored sections. **DO NOT default to 100% width; match the visual width in the PDF.** For example, a green pill-shaped title banner should have width: 40%; border-radius: 50px; position: absolute; top: 5%; left: 5%;.




        **IMAGE HANDLING & ASSET FITTING (CRITICAL - MANDATORY CLASSES):**

1) **FOR EVERY illustration, icon, logo, photo, graphic, or visual element in the PDF, you MUST create an empty <div> with ONE of these classes:**
   - class="image-drop-zone" (preferred for main images)
   - class="image-placeholder" (alternative, also acceptable)

2) **ID FORMAT:** id="page${pageNumber}_dropzone_[N]" OR id="page${pageNumber}_img[N]" OR id="page${pageNumber}_div[N]"
   - Use consistent naming: prefer page${pageNumber}_img[N] for images
   - Example: id="page1_img1", id="page1_img2", etc.

3) **TITLE ATTRIBUTE:** ALWAYS include a detailed description of the image for the user.
   - Example: title="A brown horse with its mouth wide open, showing its teeth, against a blue sky"

4) **PRECISE POSITIONING & LAYERING (CRITICAL - MATCH PDF EXACTLY):**
   - **Observe the EXACT position and layering** of each element.
   - **OVERLAPPING ELEMENTS (MANDATORY):** If one image or box is on top of another, you MUST use z-index and absolute coordinates to recreate that overlap exactly. 
   - **NO SIDE-BY-SIDE SPLITTING:** If an image appears to continue BEHIND a text box or banner, DO NOT create two separate image placeholders side-by-side. Instead, create ONE large image placeholder that covers the entire area (including the area behind the text/banner) and use z-index to place the text/banner on top.
   - **BACKGROUND DECORATIONS:** Look for background textures, shadows, or decorative background images behind the main content. Create these using additional div layers with absolute positioning and appropriate z-index.
   - Use inline styles with position, top, left, width, height to match the PDF layout precisely. Use % units for all dimensions and positions.
   - Example: style="position: absolute; top: 10%; left: 5%; width: 40%; height: 30%; z-index: 5;"
   - **For images cut to each other:** Position them with precise coordinates so they touch or overlap exactly as they do in the PDF.
   - **Multiple images stacked:** Each gets its own positioned placeholder with appropriate z-index to maintain the visual stack. Background images should usually be z-index: 1, and overlays z-index: 2 or higher.
   - **TEXT OVERLAYS:** Ensure text blocks that sit on top of images have a higher z-index (draggable-text-block defaults to 10) than the image placeholders.

5) **PLACEHOLDER STYLING (CRITICAL - INVISIBLE PLACEHOLDERS):**
   - **NO borders** - placeholders should be invisible/transparent
   - **NO background color** - use background: transparent
   - Use aspect-ratio or explicit height to reserve space
   - Example: style="background: transparent; border: none; aspect-ratio: 16/9;"

6) **IMAGE ROTATION & TRANSFORMATION (CRITICAL):**
   - **CAREFULLY OBSERVE** if images in the PDF are rotated, tilted, or skewed
   - Add CSS transform to the inline style
   - Example: style="transform: rotate(-5deg); position: absolute; top: 10%; left: 5%;"
   - Combine positioning and rotation in the same style attribute

7) **CRITICAL:** NEVER create a div for an image without adding class="image-drop-zone" or class="image-placeholder". 
   - If you create a div with a title describing an image, it MUST have one of these classes.
   - Empty divs with image descriptions but no class will NOT work in the editor.

8) **ABSOLUTELY FORBIDDEN - MOST CRITICAL RULE - NO <IMG> TAGS ALLOWED:**
   - **NEVER create any <img> tag with src attribute under ANY circumstance**
   - **DO NOT write <img src="images/..." /> or <img src="..." /> - THIS IS 100% FORBIDDEN**
   - **You MUST create ONLY empty div elements with class="image-drop-zone" or class="image-placeholder"**
   - **EVERY single image, photo, graphic, icon, logo MUST be an empty div placeholder, NOT an <img> tag**
   - **NO EXCEPTIONS - Even if you detect images in the PNG, you MUST create ONLY div placeholders, NEVER <img> tags**
   - **WRONG (FORBIDDEN):** <img src="images/horse.jpg" alt="Horse" />
   - **CORRECT (REQUIRED):** <div class="image-drop-zone" id="page1_img1" title="Horse image" style="width: 80%; aspect-ratio: 16/9; background: transparent; border: none;"></div>




        **LAYOUT DECISION:**
        1) **TWO-COLUMN (Multi-Page Split):** Use ONLY if the image shows a visible divider line or two distinct page numbers. Use .container with two .page children.
        2) **SINGLE-COLUMN (Default):** Standard single worksheet. Use a single .page element.

        **AUDIO SYNC REQUIREMENTS (MANDATORY) - HIERARCHICAL NESTED STRUCTURE FOR ALL ELEMENTS:**
        - **CRITICAL: ALL text elements must use NESTED hierarchical structure to support word/sentence/paragraph granularity**
        - **STRUCTURE: Parent Element → Sentences → Words (nested hierarchy)**
        - **ID FORMAT: page${pageNumber}_[type][number]_[subtype][number]...**

        **VISUAL STYLING & COLOR SAMPLING:**

        1) **Colors:** Identify the specific hex colors in the PDF (e.g., the red in the TIME logo, the tan/brown background of horse sections, the blue TOC border). Apply these to 'background-color' or 'color' in CSS.

        2) **Typography:** Identify if text is Serif or Sans-Serif and apply globally.

        3) **Borders:** Recreate decorative borders (like the TOC box on page 3) using CSS 'border' and 'border-radius'.



       



        
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

        **BACKROUND & CANVAS LOGIC (CRITICAL):**
1) **The Background:** For the primary visual or background texture, use a <div class="canvas-background" id="page${pageNumber}_bg">. 
2) **Layered Images:** You can place multiple <div class="image-drop-zone"> elements inside or outside the background div. Use absolute positioning and z-index to stack them.
   - **MANDATORY:** If one image overlaps another, they MUST have different z-index values.
   - **MANDATORY:** Decorative boxes and text banners should always have a higher z-index than the images they sit on.
3) **The Text Layer:** All text must be treated as "overlays." Wrap text blocks in:
   <div class="draggable-text-block" style="top: [N]%; left: [N]%; width: [N]%; z-index: 10;">
     [Standard Nested Audio-Sync Structure: Parent > Sentence > Word]
   </div>

**REMINDER - ALL IMAGE PLACEHOLDERS MUST HAVE CLASSES:**
- Every <div> that represents an image, illustration, icon, logo, or graphic MUST have either:
  - class="image-drop-zone" OR
  - class="image-placeholder"
- Do NOT create image divs without these classes. They will not be detected by the editor.

**VISUAL ACCURACY:**
- Replicate the layout of the PDF exactly by using percentage-based positioning.
- If text is inside a colored box (like the red "TIME" banner), apply that 'background-color' directly to the draggable-text-block.

**CSS REQUIREMENTS (EMBEDDED):**
- .page { position: relative; width: 100%; min-height: 100vh; display: block; }
- .canvas-background { 
    position: absolute; 
    top: 0; left: 0; width: 100%; height: 100%; 
    z-index: 1; 
  }
- .draggable-text-block { 
    position: absolute; 
    z-index: 10; 
    cursor: move; 
    padding: 0.5em;
  }
- .image-drop-zone { 
    width: 100%; height: 100%; 
    background: #f0f0f0; 
    display: flex; align-items: center; justify-content: center; 
  }


        **XHTML 1.0 STRICT REQUIREMENTS:**
        - DOCTYPE: <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
        - All tags lowercase, properly nested, self-closing tags end with />
        - Use relative units (em, rem, %, vw, vh) - NO px units for layout
        - Represent ALL graphics as <div> placeholders with class="image-drop-zone" or class="image-placeholder" - NEVER use <img> tags
        - **CRITICAL: ALL attributes MUST have values in quotes - id="value", class="value", style="value" - NEVER id, class, or style without quotes**
        - **CRITICAL: If an attribute value is empty, use empty quotes: id="" NOT id**
        - **CRITICAL: Complete ALL attributes before closing any tag - incomplete attributes cause XML parsing errors**

        **CSS REQUIREMENTS - CRITICAL:**
        - ALL CSS MUST be inside a <style type="text/css"> tag within <head>
        - Include: .-epub-media-overlay-active { background-color: #ffff00; }
        - Preserve text hierarchy (h1, h2, h3)
        - Use flexbox for layouts
        - CSS: Embedded in <head>. Include 

         - .image-drop-zone, .image-placeholder { 
            background: transparent;
            border: none;
            display: block;
            position: relative;
          }

        - .image-drop-zone img, .image-placeholder img { 
            width: 100%; 
            height: 100%; 
            object-fit: contain; 
          }

**CRITICAL REMINDER:** When you create ANY div that represents an image (illustration, photo, icon, logo, graphic), you MUST add class="image-drop-zone" or class="image-placeholder" to it. Do not create image divs without these classes.

- Use relative units (em, rem, %) for all text and spacing.





        **OUTPUT FORMAT - CRITICAL:**
        Return ONLY the raw XHTML content. 
        - Do NOT wrap in JSON
        - Do NOT use markdown code blocks (no triple backticks with xml/html/xhtml)
        - Do NOT use any markdown formatting
        - Start directly with <!DOCTYPE and end with </html>
        - Return pure XHTML only, nothing else
        - **MANDATORY: Complete ALL attributes with values before closing any tag**
        - **MANDATORY: If output is truncated, prioritize completing attributes and closing tags over adding new content**
        - **Example of CORRECT: <span class="sync-sentence" id="page1_p1_s1"></span>**
        - **Example of WRONG: <span class="sync-sentence" id</span> (missing value)**

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
            <!-- Image placeholders - positioned to match PDF layout -->
            <!-- Example: Overlapping images with precise positioning -->
            <div style="position: relative; width: 100%; height: 500px;">
              <!-- Background image -->
              <div id="page${pageNumber}_img1" class="image-drop-zone" 
                   title="Background landscape" 
                   style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; background: transparent; border: none;"></div>
              <!-- Foreground image overlapping -->
              <div id="page${pageNumber}_img2" class="image-placeholder" 
                   title="Horse in foreground, slightly tilted" 
                   style="position: absolute; top: 20%; left: 30%; width: 40%; height: 60%; z-index: 2; background: transparent; border: none; transform: rotate(-5deg);"></div>
            </div>
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

          // Build content array with main page image and extracted images
          const contentArray = [
            { text: prompt },
            {
              inlineData: {
                data: imageBuffer.toString('base64'),
                mimeType: 'image/png'
              }
            }
          ];
          
          // Add extracted images to the content array
          for (const extractedImg of extractedImageBuffers) {
            contentArray.push({
              inlineData: {
                data: extractedImg.buffer.toString('base64'),
                mimeType: extractedImg.mimeType
              }
            });
          }
          
          const apiCallPromise = model.generateContent(contentArray);

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
              
              // Start background capture and track the processing promise
              pendingApiCallPromise = pendingApiCall.then(async (lateResult) => {
                try {
                  console.log(`[Page ${pageNumber}] Late response received! Processing...`);
                  const lateResponse = await lateResult.response;
                  const lateRawResponse = lateResponse.text() || '';
                  
                  // Process the late response
                  const processedResult = GeminiService.processRawResponse(lateRawResponse, pageNumber);
                  if (processedResult) {
                    GeminiService.storeLateResponse(captureKey, processedResult);
                    console.log(`[Page ${pageNumber}] Late response cached successfully (${processedResult.xhtml.length} chars)`);
                    return processedResult; // Return the result so we can await it
                  }
                  return null;
                } catch (lateErr) {
                  console.warn(`[Page ${pageNumber}] Late response processing failed:`, lateErr.message);
                  return null;
                }
              }).catch(lateErr => {
                console.warn(`[Page ${pageNumber}] Late response capture failed:`, lateErr.message);
                return null;
              });
              
              // Don't set pendingApiCall to null - we need to track it for the timeout handler
              
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
          // Store the result in case of timeout race condition
          const cacheKey = GeminiService.getCacheKey(imagePath, pageNumber);
          GeminiService.storeLateResponse(cacheKey, processedResult);
          return processedResult;
        }
        
        console.warn(`[Page ${pageNumber}] Response missing XHTML content. Raw (first 500 chars): ${rawResponse.substring(0, 500)}`);
        
        // Check for late response before returning null - wait a bit for it to arrive
        const cacheKey = GeminiService.getCacheKey(imagePath, pageNumber);
        console.log(`[Page ${pageNumber}] Waiting up to 30s for late response (response was empty/malformed)...`);
        for (let waitAttempt = 0; waitAttempt < 30; waitAttempt++) {
          await new Promise(res => setTimeout(res, 1000));
          const lateResponse = GeminiService.getLateResponse(cacheKey);
          if (lateResponse) {
            console.log(`[Page ${pageNumber}] Late response arrived after ${waitAttempt + 1}s, using it`);
            return lateResponse;
          }
        }
        
        // Final check before giving up
        const finalLateResponse = GeminiService.getLateResponse(cacheKey);
        if (finalLateResponse) {
          console.log(`[Page ${pageNumber}] Using cached late response instead`);
          return finalLateResponse;
        }
        
        return null;
      } catch (error) {
        const is429 = error?.status === 429 || error?.statusCode === 429;
        const isTimeout = error?.message?.includes('timeout');
        
        if (is429) {
          CircuitBreakerService.recordFailure('Gemini', true);
          console.warn(`[Page ${pageNumber}] 429 error during XHTML conversion`);
        } else if (isTimeout) {
          console.warn(`[Page ${pageNumber}] API call timed out, checking for late response...`);
          
          // Check for late response before giving up
          const cacheKey = GeminiService.getCacheKey(imagePath, pageNumber);
          const lateResponse = GeminiService.getLateResponse(cacheKey);
          if (lateResponse) {
            console.log(`[Page ${pageNumber}] Found late response in cache, using it`);
            return lateResponse;
          }
          
          // Wait longer for late response to arrive (within grace period)
          // Late responses can take 30+ seconds after timeout, so wait up to 30 seconds
          console.log(`[Page ${pageNumber}] Waiting up to 30s for late response...`);
          for (let waitAttempt = 0; waitAttempt < 30; waitAttempt++) {
            await new Promise(res => setTimeout(res, 1000));
            const lateResponse = GeminiService.getLateResponse(cacheKey);
            if (lateResponse) {
              console.log(`[Page ${pageNumber}] Late response arrived after ${waitAttempt + 1}s, using it`);
              return lateResponse;
            }
          }
          
          console.warn(`[Page ${pageNumber}] No late response received, skipping`);
          CircuitBreakerService.recordFailure('Gemini', false);
        } else {
          console.error(`[Page ${pageNumber}] Error converting PNG to XHTML:`, error.message);
          CircuitBreakerService.recordFailure('Gemini', false);
        }
        return null;
      }
    }, 1); // High priority for XHTML conversion

    // Track if we got a successful result before timeout
    let successfulResult = null;
    
    // Wrap operationPromise to capture successful results
    const wrappedOperationPromise = operationPromise.then(result => {
      successfulResult = result;
      return result;
    }).catch(err => {
      throw err;
    });
    
    try {
      return await Promise.race([wrappedOperationPromise, timeoutPromise]);
    } catch (error) {
      if (error?.message?.includes('Overall timeout')) {
        console.error(`[Page ${pageNumber}] Overall operation timed out after 120s, checking for late response...`);
        
        // CRITICAL FIX: Check if operation actually completed successfully before timeout
        // This handles race condition where response was processed but timeout occurred
        if (successfulResult) {
          console.log(`[Page ${pageNumber}] Found successful result before timeout, using it despite timeout`);
          return successfulResult;
        }
        
        // Check for late response before giving up
        const cacheKey = GeminiService.getCacheKey(imagePath, pageNumber);
        let lateResponse = GeminiService.getLateResponse(cacheKey);
        if (lateResponse) {
          console.log(`[Page ${pageNumber}] Found late response in cache after overall timeout, using it`);
          return lateResponse;
        }
        
        // CRITICAL FIX: Wait up to 60 seconds for late response to be processed and cached
        // The late response processing happens asynchronously in the background
        // It will store the result in the cache when processing completes
        console.log(`[Page ${pageNumber}] Waiting up to 60s for late response to be processed and cached...`);
        
        // Wait up to 60 seconds, checking every second for the late response
        for (let waitAttempt = 0; waitAttempt < 60; waitAttempt++) {
          await new Promise(res => setTimeout(res, 1000));
          
          // Check the cache - the late response processing should have stored it by now
          lateResponse = GeminiService.getLateResponse(cacheKey);
          if (lateResponse) {
            console.log(`[Page ${pageNumber}] Late response found in cache after ${waitAttempt + 1}s wait, using it`);
            return lateResponse;
          }
          
          // Log progress every 10 seconds
          if ((waitAttempt + 1) % 10 === 0) {
            console.log(`[Page ${pageNumber}] Still waiting for late response... (${waitAttempt + 1}s elapsed)`);
          }
        }
        
        // Final check after 60 seconds
        const finalLateResponse = GeminiService.getLateResponse(cacheKey);
        if (finalLateResponse) {
          console.log(`[Page ${pageNumber}] Found late response in cache after 60s wait, using it`);
          return finalLateResponse;
        }
        
        console.error(`[Page ${pageNumber}] Overall operation timed out after 120s, no late response received after 60s wait, skipping`);
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
   * Extract Table of Contents from a page image using Gemini AI
   * @param {string} imagePath - Path to the PNG image file
   * @param {number} pageNumber - Page number for logging
   * @returns {Promise<Object|null>} - TOC mapping {chapterTitle: startPage} or null
   */
  static async extractTableOfContents(imagePath, pageNumber) {
    const client = this.getClient();
    if (!client) {
      console.warn('Gemini API not available for TOC extraction');
      return null;
    }

    // Pre-request rate limit check
    if (!RateLimiterService.acquire('Gemini')) {
      console.debug(`[Page ${pageNumber}] Rate limit exceeded for TOC extraction, skipping`);
      return null;
    }

    try {
      console.log(`[Page ${pageNumber}] Analyzing page for Table of Contents...`);
      
      const imageBuffer = await fs.readFile(imagePath);
      const modelName = process.env.GEMINI_API_MODEL || 'gemini-2.5-flash';
      const model = client.getGenerativeModel({ model: modelName });

      const prompt = `Analyze this image to determine if it contains a Table of Contents (TOC).

**CRITICAL INSTRUCTIONS:**
1. Look for typical TOC indicators:
   - Title like "Table of Contents", "Contents", "Index"
   - List of chapter/section titles with page numbers
   - Dotted lines connecting titles to page numbers
   - Sequential page numbering

2. If this IS a Table of Contents page:
   - Extract ONLY the chapter/section titles and their corresponding START page numbers
   - Return a JSON object mapping chapter titles to page numbers
   - Use the EXACT chapter titles as they appear
   - Use the page numbers where each chapter STARTS

3. If this is NOT a Table of Contents page:
   - Return exactly: null

**EXAMPLES:**

Example TOC content:
"Introduction ........................ 3
Chapter 1: Getting Started .......... 7
Chapter 2: Advanced Topics .......... 15
Conclusion .......................... 25"

Correct response:
{
  "Introduction": 3,
  "Chapter 1: Getting Started": 7,
  "Chapter 2: Advanced Topics": 15,
  "Conclusion": 25
}

**OUTPUT REQUIREMENTS:**
- Return ONLY valid JSON or the word "null"
- Do NOT include any explanations, markdown, or other text
- Do NOT use code blocks (no \`\`\`)
- Chapter titles should be clean (remove dots, extra spaces)
- Page numbers must be integers

If this page does not contain a clear Table of Contents, return: null`;

      const response = await this.generateWithBackoff(model, [
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: 'image/png'
          }
        },
        { text: prompt }
      ], 2);

      if (!response) {
        console.log(`[Page ${pageNumber}] No response from Gemini for TOC extraction`);
        return null;
      }

      const responseText = response.trim();
      console.log(`[Page ${pageNumber}] TOC extraction response:`, responseText);

      // Handle null response
      if (responseText.toLowerCase() === 'null') {
        console.log(`[Page ${pageNumber}] Page does not contain a Table of Contents`);
        return null;
      }

      // Try to parse JSON response
      try {
        const tocMapping = JSON.parse(responseText);
        
        // Validate the response structure
        if (typeof tocMapping === 'object' && tocMapping !== null) {
          const validMapping = {};
          let hasValidEntries = false;
          
          for (const [title, pageNum] of Object.entries(tocMapping)) {
            if (typeof title === 'string' && title.trim() && 
                (typeof pageNum === 'number' || !isNaN(parseInt(pageNum)))) {
              validMapping[title.trim()] = parseInt(pageNum);
              hasValidEntries = true;
            }
          }
          
          if (hasValidEntries) {
            console.log(`[Page ${pageNumber}] Successfully extracted TOC with ${Object.keys(validMapping).length} entries`);
            return validMapping;
          }
        }
        
        console.log(`[Page ${pageNumber}] Invalid TOC structure in response`);
        return null;
        
      } catch (parseError) {
        console.log(`[Page ${pageNumber}] Failed to parse TOC JSON response:`, parseError.message);
        return null;
      }

    } catch (error) {
      console.error(`[Page ${pageNumber}] TOC extraction failed:`, error.message);
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
      
      // Log all found IDs for debugging
      if (idMap.length > 0) {
        console.log(`[GeminiService] Found ${idMap.length} total elements in XHTML`);
        const sampleIds = idMap.slice(0, 10).map(m => m.id);
        console.log(`[GeminiService] Sample IDs found: ${sampleIds.join(', ')}`);
        
        // Analyze ID patterns
        const hasWordLevel = idMap.some(m => m.id.includes('_w'));
        const hasSentenceLevel = idMap.some(m => m.id.includes('_s') && !m.id.includes('_w'));
        const hasParagraphLevel = idMap.some(m => m.id.match(/_p\d+$/) && !m.id.includes('_s'));
        console.log(`[GeminiService] ID pattern analysis: word-level=${hasWordLevel}, sentence-level=${hasSentenceLevel}, paragraph-level=${hasParagraphLevel}`);
      }
      
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
        
        // For sentence granularity: include sentence-level elements (p{N}_s{N}, h{N}_s{N}, li{N}_s{N}, etc.)
        if (granularity === 'sentence') {
          // Must have sentence pattern: [type]{N}_s{N} (not [type]{N}_s{N}_w{N})
          // Supports all element types: p, h, li, td, th, header, footer, div, etc.
          const hasSentencePattern = id.match(/[a-z]+\d+_s\d+$/) || (id.includes('_s') && !id.includes('_w'));
          // Must match sentence type or pattern
          return (type === 'sentence' || hasSentencePattern) && !id.includes('_w');
        }
        
        // For word granularity: include word-level elements (p{N}_s{N}_w{N}, h{N}_s{N}_w{N}, etc.)
        if (granularity === 'word') {
          // Must have word pattern: [type]{N}_s{N}_w{N}
          // Supports all element types
          const hasWordPattern = id.match(/[a-z]+\d+_s\d+_w\d+$/) || id.includes('_w');
          // Must match word type or pattern
          return type === 'word' || hasWordPattern;
        }
        
        // For paragraph granularity: include paragraph-level elements (p{N}, h{N}, li{N}, etc.)
        if (granularity === 'paragraph') {
          // Must have element pattern: [type]{N} (but not [type]{N}_s{N} or [type]{N}_s{N}_w{N})
          // Supports all element types: p, h, li, td, th, div, etc.
          const hasElementPattern = id.match(/[a-z]+\d+$/) && !id.includes('_s') && !id.includes('_w');
          // Must match paragraph/element type or pattern
          return (type === 'paragraph' || hasElementPattern) && !id.includes('_s');
        }
        
        // Default: exclude all (shouldn't reach here with valid granularity)
        return false;
      });
      
      const bookBlocks = filteredBlocks.map(m => ({ id: m.id, text: m.text }));
      
      if (bookBlocks.length === 0) {
        console.log(`[GeminiService] ⚠️ WARNING: No ${granularity}-level blocks found in XHTML after filtering`);
        console.log(`[GeminiService] Total blocks before filtering: ${idMap.length}`);
        console.log(`[GeminiService] Requested granularity: ${granularity}`);
        
        // If no blocks match the granularity, try to find what granularity levels ARE available
        const availableLevels = [];
        if (idMap.some(m => m.id.includes('_w'))) availableLevels.push('word');
        if (idMap.some(m => m.id.includes('_s') && !m.id.includes('_w'))) availableLevels.push('sentence');
        if (idMap.some(m => m.id.match(/[a-z]+\d+$/) && !m.id.includes('_s'))) availableLevels.push('paragraph');
        
        if (availableLevels.length > 0) {
          console.log(`[GeminiService] ⚠️ Available granularity levels in XHTML: ${availableLevels.join(', ')}`);
          console.log(`[GeminiService] ⚠️ Consider regenerating EPUB with hierarchical structure or using granularity: ${availableLevels[0]}`);
        } else {
          console.log(`[GeminiService] ⚠️ No hierarchical structure found in XHTML. Elements may need IDs assigned.`);
        }
        
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

