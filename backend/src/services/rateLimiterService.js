/**
 * Rate Limiter Service using Token Bucket Algorithm
 * Limits requests per provider to avoid 429 errors
 * 
 * Configurable via environment variables:
 * - GEMINI_RATE_LIMIT_PER_MINUTE: Requests per minute (default: 50)
 * - GEMINI_RATE_LIMIT_PER_HOUR: Requests per hour (default: 3000)
 * - GEMINI_MIN_INTERVAL_MS: Minimum interval between requests in ms (default: 1000 = 1s)
 */
export class RateLimiterService {
  static limiters = new Map();

  /**
   * Get or create a rate limiter for a provider
   * @param {string} provider - Provider name (e.g., "Gemini")
   * @returns {Object} Rate limiter instance
   */
  static getLimiter(provider = 'Gemini') {
    if (!this.limiters.has(provider)) {
      // Get configurable limits from environment variables
      const tokensPerMinute = parseInt(process.env.GEMINI_RATE_LIMIT_PER_MINUTE || '50', 10);
      const tokensPerHour = parseInt(process.env.GEMINI_RATE_LIMIT_PER_HOUR || '3000', 10);
      const minInterval = parseInt(process.env.GEMINI_MIN_INTERVAL_MS || '1000', 10); // 1 second default
      
      // Calculate minInterval from tokensPerMinute if not explicitly set
      const calculatedMinInterval = Math.max(100, Math.floor(60000 / tokensPerMinute));
      const actualMinInterval = minInterval >= 100 ? minInterval : calculatedMinInterval;
      
      console.log(`[RateLimiter] Initialized for ${provider}:`);
      console.log(`  - Requests per minute: ${tokensPerMinute}`);
      console.log(`  - Requests per hour: ${tokensPerHour}`);
      console.log(`  - Min interval: ${actualMinInterval}ms`);
      
      this.limiters.set(provider, {
        // Token bucket: configurable requests per minute
        tokensPerMinute: tokensPerMinute,
        tokensPerHour: tokensPerHour,
        currentTokens: tokensPerMinute, // Start with full bucket
        lastRefill: Date.now(),
        lastRequest: 0,
        minInterval: actualMinInterval, // Configurable minimum interval
        // Hourly tracking
        hourlyRequests: [],
        hourlyLimit: tokensPerHour
      });
    }
    return this.limiters.get(provider);
  }

  /**
   * Check if a request can be made (acquire a token)
   * @param {string} provider - Provider name
   * @returns {boolean} True if request can be made, false if rate limited
   */
  static acquire(provider = 'Gemini') {
    const limiter = this.getLimiter(provider);
    const now = Date.now();

    // Refill tokens based on time passed
    this.refillTokens(limiter, now);

    // Check minimum interval between requests
    const timeSinceLastRequest = now - limiter.lastRequest;
    if (timeSinceLastRequest < limiter.minInterval) {
      const waitTime = limiter.minInterval - timeSinceLastRequest;
      console.debug(`Rate limit: Minimum interval not met. Wait ${Math.round(waitTime/1000)}s`);
      return false;
    }

    // Check hourly limit
    this.cleanHourlyRequests(limiter, now);
    if (limiter.hourlyRequests.length >= limiter.hourlyLimit) {
      console.debug(`Rate limit: Hourly limit (${limiter.hourlyLimit}) exceeded`);
      return false;
    }

    // Check if we have tokens available
    if (limiter.currentTokens <= 0) {
      console.debug(`Rate limit: No tokens available. Tokens will refill in ${Math.round((60000 - (now - limiter.lastRefill)) / 1000)}s`);
      return false;
    }

    // Acquire token
    limiter.currentTokens--;
    limiter.lastRequest = now;
    limiter.hourlyRequests.push(now);

    return true;
  }

  /**
   * Refill tokens based on time passed
   * @param {Object} limiter - Limiter instance
   * @param {number} now - Current timestamp
   */
  static refillTokens(limiter, now) {
    const timePassed = now - limiter.lastRefill;
    const minutesPassed = timePassed / 60000;

    if (minutesPassed >= 1) {
      // Refill tokens based on configured tokensPerMinute
      const tokensToAdd = Math.floor(minutesPassed * limiter.tokensPerMinute);
      limiter.currentTokens = Math.min(
        limiter.tokensPerMinute,
        limiter.currentTokens + tokensToAdd
      );
      limiter.lastRefill = now;
    }
  }

  /**
   * Clean hourly requests older than 1 hour
   * @param {Object} limiter - Limiter instance
   * @param {number} now - Current timestamp
   */
  static cleanHourlyRequests(limiter, now) {
    const oneHourAgo = now - 3600000;
    limiter.hourlyRequests = limiter.hourlyRequests.filter(
      timestamp => timestamp > oneHourAgo
    );
  }

  /**
   * Get remaining tokens for a provider
   * @param {string} provider - Provider name
   * @returns {number} Remaining tokens
   */
  static getRemainingTokens(provider = 'Gemini') {
    const limiter = this.getLimiter(provider);
    const now = Date.now();
    this.refillTokens(limiter, now);
    return limiter.currentTokens;
  }

  /**
   * Get time until next token is available
   * @param {string} provider - Provider name
   * @returns {number} Milliseconds until next token
   */
  static getTimeUntilNextToken(provider = 'Gemini') {
    const limiter = this.getLimiter(provider);
    const now = Date.now();
    const timeSinceLastRefill = now - limiter.lastRefill;
    const timeUntilRefill = 60000 - timeSinceLastRefill;

    if (limiter.currentTokens > 0) {
      const timeSinceLastRequest = now - limiter.lastRequest;
      const timeUntilMinInterval = Math.max(0, limiter.minInterval - timeSinceLastRequest);
      return Math.min(timeUntilRefill, timeUntilMinInterval);
    }

    return Math.max(0, timeUntilRefill);
  }

  /**
   * Reset limiter for a provider (for testing)
   * @param {string} provider - Provider name
   */
  static reset(provider = 'Gemini') {
    this.limiters.delete(provider);
  }
}

