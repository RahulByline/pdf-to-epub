import { AiConfigurationModel } from '../models/AiConfiguration.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * AI-powered PDF processing service
 * Uses configured AI (Gemini) for intelligent text extraction and image classification
 */
export class AiPdfService {
  /**
   * Get AI configuration
   */
  static async getAiConfig() {
    const { AiConfigService } = await import('./aiConfigService.js');
    const config = await AiConfigService.getActiveConfiguration();
    if (!config || !config.apiKey) {
      throw new Error('AI configuration not found. Please configure AI settings first.');
    }
    return {
      api_key: config.apiKey,
      model_name: config.modelName,
      is_active: config.isActive,
      description: config.description
    };
  }

  /**
   * Call Gemini API for text extraction and analysis
   */
  static async callGeminiApi(apiKey, modelName, prompt, imageBase64 = null) {
    // Use native fetch if available (Node 18+), otherwise use node-fetch
    let fetchFn;
    try {
      if (typeof fetch !== 'undefined') {
        fetchFn = fetch;
      } else {
        const nodeFetch = await import('node-fetch');
        fetchFn = nodeFetch.default;
      }
    } catch (e) {
      // Fallback to node-fetch if native fetch not available
      const nodeFetch = await import('node-fetch');
      fetchFn = nodeFetch.default;
    }
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const requestBody = {
      contents: [{
        parts: [
          { text: prompt }
        ]
      }]
    };

    // Add image if provided
    if (imageBase64) {
      requestBody.contents[0].parts.push({
        inline_data: {
          mime_type: 'image/png',
          data: imageBase64
        }
      });
    }

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response from Gemini API');
      }

      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error('Gemini API call failed:', error);
      throw new Error(`Failed to call Gemini API: ${error.message}`);
    }
  }

  /**
   * Extract text from PDF page with layout preservation using AI
   */
  static async extractTextFromPage(pdfFilePath, pageNumber, options = {}) {
    try {
      // Try to get AI config, but don't fail if not available
      let config;
      try {
        config = await this.getAiConfig();
      } catch (configError) {
        console.warn(`[AI Service] AI config not available, using fallback: ${configError.message}`);
        // Use fallback immediately if AI is not configured
        const pdfParse = (await import('pdf-parse')).default;
        const fs = (await import('fs/promises')).default;
        const pdfBuffer = await fs.readFile(pdfFilePath);
        const pdfData = await pdfParse(pdfBuffer);
        const lines = pdfData.text.split('\n');
        const linesPerPage = Math.ceil(lines.length / pdfData.numpages);
        const startLine = (pageNumber - 1) * linesPerPage;
        const endLine = Math.min(pageNumber * linesPerPage, lines.length);
        const pageText = lines.slice(startLine, endLine).join('\n');
        return this.fallbackStructure(pageText);
      }
      
      // For now, use pdf-parse to get text, then use AI to structure it
      // In production, you might want to render PDF page to image and send to vision model
      const pdfParse = (await import('pdf-parse')).default;
      const pdfBuffer = await fs.readFile(pdfFilePath);
      const pdfData = await pdfParse(pdfBuffer);
      
      // Split by pages (approximate)
      const lines = pdfData.text.split('\n');
      const linesPerPage = Math.ceil(lines.length / pdfData.numpages);
      const startLine = (pageNumber - 1) * linesPerPage;
      const endLine = Math.min(pageNumber * linesPerPage, lines.length);
      const pageText = lines.slice(startLine, endLine).join('\n');
      
      // Use AI to analyze structure and extract headers, paragraphs, etc.
      const prompt = `Analyze the following text from PDF page ${pageNumber}. Extract and structure it as JSON with:
1. Headers (with level 1-6)
2. Paragraphs (with text content)
3. Lists (ordered/unordered)
4. Tables (if any)
5. Preserve reading order
6. For each text element, provide word-level positions if possible

Return JSON in this format:
{
  "headers": [{"level": 1, "text": "...", "position": "top"}],
  "paragraphs": [{"text": "...", "words": [{"word": "...", "position": {...}}]}],
  "lists": [{"type": "ordered|unordered", "items": [...]}],
  "tables": [...]
}

Text to analyze:
${pageText.substring(0, 8000)}`;

      try {
        const aiResponse = await this.callGeminiApi(
          config.api_key,
          config.model_name || 'gemini-pro',
          prompt
        );
        
        // Try to parse JSON from AI response
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        
        // Fallback: return structured text without AI if parsing fails
        return this.fallbackStructure(pageText);
      } catch (aiError) {
        console.warn('AI extraction failed, using fallback:', aiError.message);
        return this.fallbackStructure(pageText);
      }
    } catch (error) {
      console.error('Error extracting text from page:', error);
      throw error;
    }
  }

  /**
   * Fallback structure extraction without AI
   */
  static fallbackStructure(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const paragraphs = [];
    const headers = [];
    
    let currentParagraph = '';
    
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      
      // Detect headers (all caps, short lines, etc.)
      if (trimmed.length < 100 && 
          (trimmed === trimmed.toUpperCase() || 
           /^[A-Z][^.!?]{0,80}$/.test(trimmed))) {
        if (currentParagraph) {
          paragraphs.push({ text: currentParagraph });
          currentParagraph = '';
        }
        headers.push({
          level: trimmed.length < 50 ? 1 : 2,
          text: trimmed
        });
      } else {
        if (currentParagraph) {
          currentParagraph += ' ' + trimmed;
        } else {
          currentParagraph = trimmed;
        }
      }
    });
    
    if (currentParagraph) {
      paragraphs.push({ text: currentParagraph });
    }
    
    return {
      headers,
      paragraphs,
      lists: [],
      tables: []
    };
  }

  /**
   * Classify image using AI vision model
   */
  static async classifyImage(imageBase64, imageFileName) {
    try {
      const config = await this.getAiConfig();
      
      // Use vision model for image classification
      const visionModel = config.model_name.includes('vision') || config.model_name.includes('flash') 
        ? config.model_name 
        : 'gemini-pro-vision';
      
      const prompt = `Analyze this image and classify it into one of these categories:
- figure: Charts, graphs, illustrations, diagrams, photos
- table: Data tables, comparison tables
- diagram: Flowcharts, technical diagrams, schematics
- other: Everything else

Also describe what the image contains briefly (1-2 sentences).

Return JSON format:
{
  "category": "figure|table|diagram|other",
  "description": "...",
  "confidence": 0.0-1.0
}`;

      const aiResponse = await this.callGeminiApi(
        config.api_key,
        visionModel,
        prompt,
        imageBase64
      );
      
      // Parse JSON response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          category: result.category || 'other',
          description: result.description || '',
          confidence: result.confidence || 0.8
        };
      }
      
      // Fallback classification based on filename
      return {
        category: this.fallbackClassify(imageFileName),
        description: 'Image classification using fallback method',
        confidence: 0.5
      };
    } catch (error) {
      console.warn('AI image classification failed:', error.message);
      return {
        category: this.fallbackClassify(imageFileName),
        description: 'Classification failed, using fallback',
        confidence: 0.3
      };
    }
  }

  /**
   * Fallback image classification based on filename
   */
  static fallbackClassify(fileName) {
    const lowerName = fileName.toLowerCase();
    if (lowerName.includes('table') || lowerName.includes('tab_')) {
      return 'table';
    }
    if (lowerName.includes('diagram') || lowerName.includes('fig_')) {
      return 'diagram';
    }
    if (lowerName.includes('chart') || lowerName.includes('graph')) {
      return 'figure';
    }
    return 'other';
  }

  /**
   * Extract images from PDF and classify them
   * Note: This is a placeholder - in production, use pdf-lib or pdfjs-dist to extract images
   */
  static async extractAndClassifyImages(pdfFilePath) {
    // TODO: Implement actual image extraction using pdf-lib or pdfjs-dist
    // For now, return empty array
    return [];
  }
}

