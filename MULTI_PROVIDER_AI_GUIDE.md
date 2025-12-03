# Multi-Provider AI Service Guide

## Overview

The application now supports multiple AI providers with automatic fallback. If one provider fails or hits quota limits, the system automatically tries the next provider in priority order.

## Supported Providers

1. **Gemini (Google)** - Priority 1 (Primary)
   - Vision API for OCR text extraction
   - Text correction capabilities
   - Free tier: 10 requests/minute (gemini-2.5-flash)

2. **Azure AI Vision** - Priority 2 (Fallback)
   - OCR and text extraction
   - Free tier: 5,000 transactions/month
   - Requires Azure subscription

3. **OpenAI GPT-4 Vision** - Priority 3 (Fallback)
   - Vision API for OCR
   - Text correction capabilities
   - Requires paid API key

4. **Tesseract OCR** - Priority 99 (Last Resort)
   - Local, free OCR
   - No API limits
   - Lower accuracy than cloud services

## Configuration

Edit `src/main/resources/application.properties`:

```properties
# Gemini Provider (Primary)
ai.provider.gemini.enabled=true
ai.provider.gemini.priority=1

# Azure AI Vision Provider
ai.provider.azure.enabled=false
ai.provider.azure.endpoint=https://YOUR_RESOURCE_NAME.cognitiveservices.azure.com
ai.provider.azure.key=YOUR_AZURE_KEY_HERE
ai.provider.azure.priority=2

# OpenAI Provider
ai.provider.openai.enabled=false
ai.provider.openai.api.key=YOUR_OPENAI_KEY_HERE
ai.provider.openai.model=gpt-4o
ai.provider.openai.priority=3

# Tesseract Provider (Always available as fallback)
ai.provider.tesseract.enabled=true
ai.provider.tesseract.priority=99

# Multi-Provider Settings
ai.provider.fallback.enabled=true
ai.provider.fallback.log.enabled=true
```

## How It Works

1. **Priority-based Selection**: Providers are tried in order of priority (lower number = tried first)

2. **Automatic Fallback**: If a provider fails, times out, or hits quota limits, the next provider is automatically tried

3. **Seamless Integration**: The existing code doesn't need to change - it just uses `MultiProviderAiService` instead of individual providers

## Usage Example

The system automatically uses providers when:
- Extracting text from images (OCR)
- Correcting OCR errors in text

No code changes needed - just configure providers in `application.properties`.

## Adding New Providers

To add a new provider:

1. Create a class implementing `AiProvider` interface
2. Annotate with `@Component`
3. Configure in `application.properties`
4. Set priority (lower = higher priority)

Example:
```java
@Component
public class MyAiProvider implements AiProvider {
    // Implement interface methods
}
```

## Benefits

✅ **No Single Point of Failure**: If one provider is down, others are used
✅ **Quota Management**: Automatically switches when quota is exceeded
✅ **Cost Optimization**: Use free tiers first, paid services as fallback
✅ **Flexibility**: Easy to add/remove providers
✅ **Transparency**: Logs show which provider was used

## Monitoring

Check logs for:
- `🤖 Multi-Provider AI Service initialized` - Shows all configured providers
- `✅ Fallback provider X succeeded` - Indicates fallback was used
- Provider connection test results on startup

## Troubleshooting

**No providers working?**
- Check that at least one provider is enabled
- Verify API keys are correct
- Check provider-specific configuration

**Always using fallback?**
- Check primary provider logs for errors
- Verify API keys and quotas
- Check network connectivity

**Tesseract not working?**
- Verify Tesseract is installed
- Check `tesseract.datapath` configuration
- Ensure language packs are installed

