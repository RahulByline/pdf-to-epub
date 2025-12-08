/**
 * Rate Limiter Service using Token Bucket Algorithm
 * Limits requests per provider to avoid 429 errors
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
      this.limiters.set(provider, {
        // Token bucket: 10 requests per minute
        tokensPerMinute: 10,
        tokensPerHour: 600,
        currentTokens: 10,
        lastRefill: Date.now(),
        lastRequest: 0,
        minInterval: 6000, // 6 seconds between requests (for 10/min)
        // Hourly tracking
        hourlyRequests: [],
        hourlyLimit: 600
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
      // Refill tokens: 10 per minute
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

