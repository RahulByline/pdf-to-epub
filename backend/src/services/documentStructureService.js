import { GeminiService } from './geminiService.js';
import { AiConfigService } from './aiConfigService.js';

/**
 * Document Structure Service
 * Classifies content into semantic elements (headings, paragraphs, images, etc.)
 * Uses AI for intelligent classification while preserving original structure
 */
export class DocumentStructureService {
  /**
   * Analyze and classify document structure
   * @param {Array} pages - Array of pages with text blocks
   * @param {Object} options - Analysis options
   * @returns {Promise<{pages: Array, structure: Object}>}
   */
  static async analyzeStructure(pages, options = {}) {
    try {
      const aiConfig = await AiConfigService.getCurrentConfiguration();
      const useAI = options.useAI !== false && aiConfig && aiConfig.apiKey;
      
      if (useAI) {
        return await this.analyzeStructureWithAI(pages, aiConfig);
      } else {
        return await this.analyzeStructureHeuristic(pages);
      }
    } catch (error) {
      console.warn('[Document Structure] AI analysis failed, using heuristic:', error.message);
      return await this.analyzeStructureHeuristic(pages);
    }
  }
  
  /**
   * Analyze structure using AI (Gemini)
   */
  static async analyzeStructureWithAI(pages, aiConfig) {
    // Prepare context for AI
    const pagesSummary = pages.map((page, idx) => ({
      pageNumber: page.pageNumber || idx + 1,
      textBlocks: page.textBlocks?.map(block => ({
        text: block.text?.substring(0, 200) || '',
        fontSize: block.fontSize || 12,
        fontName: block.fontName || '',
        y: block.y || 0
      })) || []
    }));
    
    const prompt = `Analyze this document structure and classify each text block into semantic elements.

Document Pages:
${JSON.stringify(pagesSummary, null, 2)}

For each text block, classify it as one of:
- "title" - Main document title (usually largest, first page, centered)
- "heading1" - Major chapter/section heading (h1)
- "heading2" - Subsection heading (h2)
- "heading3" - Sub-subsection heading (h3)
- "paragraph" - Regular paragraph text
- "header" - Page header (repeated text at top)
- "footer" - Page footer (repeated text at bottom)
- "caption" - Image or figure caption
- "list_item" - List item
- "other" - Other content

Return JSON in this format:
{
  "pages": [
    {
      "pageNumber": 1,
      "blocks": [
        {
          "index": 0,
          "type": "title",
          "level": 0,
          "confidence": 0.95
        },
        {
          "index": 1,
          "type": "paragraph",
          "level": 0,
          "confidence": 0.9
        }
      ]
    }
  ],
  "metadata": {
    "hasTitle": true,
    "hasChapters": false,
    "structureType": "article|book|report|other"
  }
}

Return ONLY the JSON, no other text.`;

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(aiConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: aiConfig.modelName });
      
      const aiResponse = await GeminiService.generateWithBackoff(model, prompt);
      
      if (aiResponse && aiResponse.response) {
        const responseText = await aiResponse.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const classified = JSON.parse(jsonMatch[0]);
          
          // Apply classifications to pages
          const structuredPages = pages.map((page, pageIdx) => {
            const pageClassification = classified.pages?.find(p => 
              p.pageNumber === (page.pageNumber || pageIdx + 1)
            );
            
            if (pageClassification && page.textBlocks) {
              page.textBlocks = page.textBlocks.map((block, blockIdx) => {
                const classification = pageClassification.blocks?.find(b => 
                  b.index === blockIdx
                );
                
                if (classification) {
                  return {
                    ...block,
                    type: classification.type,
                    level: classification.level || 0,
                    confidence: classification.confidence || 0.8
                  };
                }
                return { ...block, type: 'paragraph', level: 0 };
              });
            }
            
            return page;
          });
          
          return {
            pages: structuredPages,
            structure: classified.metadata || {},
            method: 'AI'
          };
        }
      }
    } catch (aiError) {
      console.warn('[Document Structure] AI classification failed:', aiError.message);
    }
    
    // Fallback to heuristic
    return await this.analyzeStructureHeuristic(pages);
  }
  
  /**
   * Analyze structure using heuristics (font size, position, repetition)
   */
  static analyzeStructureHeuristic(pages) {
    const structuredPages = pages.map(page => {
      if (!page.textBlocks || page.textBlocks.length === 0) {
        return page;
      }
      
      // Calculate font size statistics
      const fontSizes = page.textBlocks.map(b => b.fontSize || 12).filter(Boolean);
      const avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;
      const maxFontSize = Math.max(...fontSizes);
      const minFontSize = Math.min(...fontSizes);
      
      // Classify blocks
      const classifiedBlocks = page.textBlocks.map((block, idx) => {
        const fontSize = block.fontSize || 12;
        const y = block.y || 0;
        const text = block.text || '';
        const isFirstBlock = idx === 0;
        const isLastBlock = idx === page.textBlocks.length - 1;
        
        let type = 'paragraph';
        let level = 0;
        
        // Title detection (first page, large font, centered-ish)
        if (page.pageNumber === 1 && isFirstBlock && fontSize > avgFontSize * 1.5) {
          type = 'title';
        }
        // Heading detection (larger font, different from paragraph)
        else if (fontSize > avgFontSize * 1.2) {
          if (fontSize > avgFontSize * 1.8) {
            type = 'heading1';
            level = 1;
          } else if (fontSize > avgFontSize * 1.4) {
            type = 'heading2';
            level = 2;
          } else {
            type = 'heading3';
            level = 3;
          }
        }
        // Header/footer detection (top or bottom of page, repeated patterns)
        else if (y > (page.height || 800) * 0.9 || y < (page.height || 800) * 0.1) {
          if (text.length < 100) { // Short text at edges
            type = y > (page.height || 800) * 0.9 ? 'footer' : 'header';
          }
        }
        // List item detection (starts with bullet/number)
        else if (/^[\u2022\u2023\u25E6\u2043\u2219\-\*]\s|^\d+[\.\)]\s/.test(text.trim())) {
          type = 'list_item';
        }
        
        return {
          ...block,
          type,
          level
        };
      });
      
      return {
        ...page,
        textBlocks: classifiedBlocks
      };
    });
    
    return {
      pages: structuredPages,
      structure: {
        hasTitle: structuredPages[0]?.textBlocks?.[0]?.type === 'title',
        hasChapters: structuredPages.some(p => 
          p.textBlocks?.some(b => b.type?.startsWith('heading'))
        ),
        structureType: 'document'
      },
      method: 'heuristic'
    };
  }
  
  /**
   * Extract images from document structure
   * Identifies images, figures, tables, banners
   */
  static extractImages(pages, pdfFilePath) {
    // This would integrate with image extraction service
    // For now, return empty array - images handled separately
    return {
      figures: [],
      tables: [],
      banners: [],
      others: []
    };
  }
}


