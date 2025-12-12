# Rate Limiter Configuration Guide

## Overview
The rate limiter has been updated to be configurable via environment variables, allowing you to match your actual Gemini API quota limits.

## Environment Variables

Add these to your `.env` file to customize rate limiting:

```env
# Gemini API Rate Limiting
# Requests per minute (default: 50)
GEMINI_RATE_LIMIT_PER_MINUTE=50

# Requests per hour (default: 3000)
GEMINI_RATE_LIMIT_PER_HOUR=3000

# Minimum interval between requests in milliseconds (default: 1000 = 1 second)
GEMINI_MIN_INTERVAL_MS=1000
```

## Default Settings

Based on your API key test results (20 requests in 3 seconds without errors), the defaults are set to:
- **50 requests per minute** (conservative, can be increased)
- **3000 requests per hour** (conservative, can be increased)
- **1 second minimum interval** between requests

## Recommended Settings by Tier

### Free Tier (Basic)
```env
GEMINI_RATE_LIMIT_PER_MINUTE=15
GEMINI_RATE_LIMIT_PER_HOUR=1500
GEMINI_MIN_INTERVAL_MS=4000
```

### Paid Tier (Standard)
```env
GEMINI_RATE_LIMIT_PER_MINUTE=50
GEMINI_RATE_LIMIT_PER_HOUR=3000
GEMINI_MIN_INTERVAL_MS=1000
```

### Paid Tier (High Volume)
```env
GEMINI_RATE_LIMIT_PER_MINUTE=100
GEMINI_RATE_LIMIT_PER_HOUR=10000
GEMINI_MIN_INTERVAL_MS=500
```

## How to Find Your Exact Quota

1. **Google Cloud Console - Quotas:**
   - Go to: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
   - Look for "Requests per minute" and "Requests per day/hour"

2. **Billing Dashboard:**
   - Go to: https://console.cloud.google.com/billing
   - Check your current plan and limits

3. **API Usage Dashboard:**
   - Go to: https://console.cloud.google.com/apis/dashboard
   - View real-time usage and limits

## Testing Your Settings

After updating your `.env` file, restart the backend server. The rate limiter will log its configuration on startup:

```
[RateLimiter] Initialized for Gemini:
  - Requests per minute: 50
  - Requests per hour: 3000
  - Min interval: 1000ms
```

## Adjusting Based on 429 Errors

If you still get 429 errors:
1. **Reduce** `GEMINI_RATE_LIMIT_PER_MINUTE` (e.g., from 50 to 30)
2. **Increase** `GEMINI_MIN_INTERVAL_MS` (e.g., from 1000 to 2000)
3. **Check** your actual quota in Google Cloud Console

If you never get 429 errors and want faster processing:
1. **Increase** `GEMINI_RATE_LIMIT_PER_MINUTE` (e.g., from 50 to 100)
2. **Decrease** `GEMINI_MIN_INTERVAL_MS` (e.g., from 1000 to 500)
3. **Monitor** for 429 errors and adjust accordingly

## Notes

- The rate limiter uses a token bucket algorithm
- Tokens refill automatically based on time passed
- The minimum interval prevents burst requests
- Hourly limit prevents exceeding daily quotas
- Settings take effect after server restart

