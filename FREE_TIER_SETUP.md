# Free Tier AI Providers Setup Guide

## Currently Configured Free Providers

### 1. Gemini (Google) - PRIMARY ✅
- **Status**: Enabled
- **Free Tier**: 10 requests/minute for `gemini-2.5-flash`
- **API Key**: Already configured in `application.properties`
- **Priority**: 1 (tried first)
- **Get API Key**: https://aistudio.google.com/app/apikey

### 2. Tesseract OCR - FALLBACK ✅
- **Status**: Enabled
- **Free Tier**: Unlimited (runs locally)
- **Priority**: 99 (last resort)
- **No API Key Needed**: Completely free and local

### 3. Azure AI Vision - OPTIONAL
- **Status**: Disabled (can enable if you have Azure account)
- **Free Tier**: 5,000 transactions/month
- **Requires**: Free Azure account
- **Setup**: See below

## Current Configuration

Your system is configured to use:
1. **Gemini** (primary) - 10 requests/minute free
2. **Tesseract** (fallback) - Unlimited, local OCR

This means:
- ✅ Gemini will be tried first for better accuracy
- ✅ If Gemini hits quota (10/min), Tesseract automatically takes over
- ✅ No paid services enabled
- ✅ No API costs

## How It Works

```
Request → Try Gemini (10/min limit)
    ↓ (if quota exceeded)
    ↓ Try Tesseract (unlimited)
    ↓ (always works)
    ✅ Success
```

## Optional: Add Azure AI Vision (Free Tier)

If you want another free cloud provider:

1. **Create Free Azure Account**
   - Go to: https://azure.microsoft.com/free/
   - Sign up (requires credit card but won't charge for free tier)

2. **Create Computer Vision Resource**
   - Go to Azure Portal
   - Create new resource → "Computer Vision"
   - Choose "Free F0" tier
   - Copy endpoint and key

3. **Update Configuration**
   ```properties
   ai.provider.azure.enabled=true
   ai.provider.azure.endpoint=https://YOUR_RESOURCE_NAME.cognitiveservices.azure.com
   ai.provider.azure.key=YOUR_AZURE_KEY_HERE
   ```

4. **Priority Order Will Be**:
   - Gemini (10/min)
   - Azure (5,000/month)
   - Tesseract (unlimited)

## Free Tier Limits Summary

| Provider | Free Tier Limit | Your Status |
|----------|----------------|-------------|
| Gemini | 10 requests/minute | ✅ Enabled |
| Azure | 5,000 transactions/month | ⚠️ Disabled (optional) |
| Tesseract | Unlimited | ✅ Enabled |
| OpenAI | Paid only | ❌ Disabled |

## Tips for Free Tier Usage

1. **Rate Limiting**: The system automatically handles Gemini's 10/min limit by falling back to Tesseract

2. **Best Results**: 
   - Gemini for accuracy (when within quota)
   - Tesseract for reliability (always available)

3. **Monitor Usage**: Check logs to see which provider is being used:
   - `✅ AI provider extracted` = Gemini or Azure
   - `Tesseract extracted` = Using local OCR

4. **If You Need More**:
   - Wait for quota reset (usually per minute)
   - Enable Azure for additional 5,000/month
   - Use Tesseract for unlimited local processing

## No Action Required

Your current setup is optimal for free tier usage:
- ✅ Gemini enabled (best accuracy)
- ✅ Tesseract enabled (unlimited fallback)
- ✅ Automatic fallback when quota exceeded
- ✅ No paid services

Just restart your application and it will work!

