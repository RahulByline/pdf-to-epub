/**
 * Circuit Breaker Service
 * Prevents making requests when API is clearly overloaded
 */
export class CircuitBreakerService {
  static breakers = new Map();

  /**
   * Circuit states
   */
  static STATES = {
    CLOSED: 'CLOSED',    // Normal operation
    OPEN: 'OPEN',        // Circuit is open, reject requests
    HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
  };

  /**
   * Get or create a circuit breaker for a provider
   * @param {string} provider - Provider name (e.g., "Gemini")
   * @returns {Object} Circuit breaker instance
   */
  static getBreaker(provider = 'Gemini') {
    if (!this.breakers.has(provider)) {
      this.breakers.set(provider, {
        state: this.STATES.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        // Configuration
        failureThreshold: 5,        // Open after 5 consecutive failures
        successThreshold: 2,         // Close after 2 consecutive successes
        timeout: 60000,              // 60 seconds before attempting half-open
        halfOpenMaxAttempts: 3       // Max attempts in half-open state
      });
    }
    return this.breakers.get(provider);
  }

  /**
   * Check if request should be allowed
   * @param {string} provider - Provider name
   * @returns {boolean} True if request should be allowed
   */
  static canMakeRequest(provider = 'Gemini') {
    const breaker = this.getBreaker(provider);
    const now = Date.now();

    // Check if we should transition from OPEN to HALF_OPEN
    if (breaker.state === this.STATES.OPEN) {
      if (breaker.nextAttemptTime && now >= breaker.nextAttemptTime) {
        breaker.state = this.STATES.HALF_OPEN;
        breaker.successCount = 0;
        console.log(`[Circuit Breaker] ${provider}: Transitioning to HALF_OPEN state`);
      } else {
        const waitTime = Math.ceil((breaker.nextAttemptTime - now) / 1000);
        console.warn(`[Circuit Breaker] ${provider}: Circuit is OPEN. Wait ${waitTime}s before retry`);
        return false;
      }
    }

    // Check if we should transition from HALF_OPEN to CLOSED
    if (breaker.state === this.STATES.HALF_OPEN) {
      if (breaker.successCount >= breaker.successThreshold) {
        breaker.state = this.STATES.CLOSED;
        breaker.failureCount = 0;
        console.log(`[Circuit Breaker] ${provider}: Circuit CLOSED - service recovered`);
      } else if (breaker.failureCount >= breaker.halfOpenMaxAttempts) {
        breaker.state = this.STATES.OPEN;
        breaker.nextAttemptTime = now + breaker.timeout;
        console.warn(`[Circuit Breaker] ${provider}: Circuit OPEN - service still failing`);
        return false;
      }
    }

    return true;
  }

  /**
   * Record a successful request
   * @param {string} provider - Provider name
   */
  static recordSuccess(provider = 'Gemini') {
    const breaker = this.getBreaker(provider);
    
    if (breaker.state === this.STATES.HALF_OPEN) {
      breaker.successCount++;
    } else if (breaker.state === this.STATES.CLOSED) {
      breaker.failureCount = 0; // Reset failure count on success
    }
  }

  /**
   * Record a failed request (429 or other errors)
   * @param {string} provider - Provider name
   * @param {boolean} is429 - Whether the error was a 429
   */
  static recordFailure(provider = 'Gemini', is429 = false) {
    const breaker = this.getBreaker(provider);
    const now = Date.now();

    breaker.failureCount++;
    breaker.lastFailureTime = now;

    // Only count 429 errors as failures for circuit breaker
    // Other errors might be transient and not indicate API overload
    if (is429) {
      if (breaker.state === this.STATES.CLOSED && breaker.failureCount >= breaker.failureThreshold) {
        breaker.state = this.STATES.OPEN;
        breaker.nextAttemptTime = now + breaker.timeout;
        console.warn(`[Circuit Breaker] ${provider}: Circuit OPENED after ${breaker.failureCount} consecutive 429 errors`);
      } else if (breaker.state === this.STATES.HALF_OPEN) {
        // If we get a failure in half-open, go back to open
        breaker.state = this.STATES.OPEN;
        breaker.nextAttemptTime = now + breaker.timeout;
        console.warn(`[Circuit Breaker] ${provider}: Circuit OPENED - service still failing`);
      }
    }
  }

  /**
   * Get current state
   * @param {string} provider - Provider name
   * @returns {string} Current state
   */
  static getState(provider = 'Gemini') {
    const breaker = this.getBreaker(provider);
    return breaker.state;
  }

  /**
   * Reset circuit breaker (for testing)
   * @param {string} provider - Provider name
   */
  static reset(provider = 'Gemini') {
    const breaker = this.getBreaker(provider);
    breaker.state = this.STATES.CLOSED;
    breaker.failureCount = 0;
    breaker.successCount = 0;
    breaker.lastFailureTime = null;
    breaker.nextAttemptTime = null;
  }
}

