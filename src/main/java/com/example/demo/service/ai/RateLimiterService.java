package com.example.demo.service.ai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Rate limiter service to prevent exceeding free tier quotas
 * Implements token bucket algorithm for rate limiting
 */
@Service
public class RateLimiterService {
    
    private static final Logger logger = LoggerFactory.getLogger(RateLimiterService.class);
    
    @Value("${ai.rate-limit.enabled:true}")
    private boolean enabled;
    
    @Value("${ai.rate-limit.requests-per-minute:10}")
    private int requestsPerMinute;
    
    @Value("${ai.rate-limit.requests-per-hour:600}")
    private int requestsPerHour;
    
    // Token bucket per provider
    private final ConcurrentHashMap<String, TokenBucket> buckets = new ConcurrentHashMap<>();
    
    /**
     * Check if request is allowed and wait if necessary
     * 
     * @param providerName Name of the provider (e.g., "Gemini")
     * @return true if request can proceed, false if should skip
     */
    public boolean acquire(String providerName) {
        if (!enabled) {
            return true; // Rate limiting disabled
        }
        
        TokenBucket bucket = buckets.computeIfAbsent(providerName, 
            k -> new TokenBucket(requestsPerMinute, requestsPerHour));
        
        return bucket.acquire();
    }
    
    /**
     * Get wait time until next request is allowed
     */
    public long getWaitTimeMs(String providerName) {
        if (!enabled) {
            return 0;
        }
        
        TokenBucket bucket = buckets.get(providerName);
        if (bucket == null) {
            return 0;
        }
        
        return bucket.getWaitTimeMs();
    }
    
    /**
     * Check if request would be allowed (without consuming tokens)
     */
    public boolean wouldAllow(String providerName) {
        if (!enabled) {
            return true;
        }
        
        TokenBucket bucket = buckets.get(providerName);
        if (bucket == null) {
            return true;
        }
        
        return bucket.wouldAllow();
    }
    
    /**
     * Token bucket implementation
     */
    private static class TokenBucket {
        private final int maxTokensPerMinute;
        private final int maxTokensPerHour;
        private final AtomicInteger tokensPerMinute;
        private final AtomicInteger tokensPerHour;
        private final AtomicLong lastMinuteReset;
        private final AtomicLong lastHourReset;
        
        // Minimum time between requests (in milliseconds)
        private final long minIntervalMs;
        
        private final AtomicLong lastRequestTime;
        
        public TokenBucket(int requestsPerMinute, int requestsPerHour) {
            this.maxTokensPerMinute = requestsPerMinute;
            this.maxTokensPerHour = requestsPerHour;
            this.tokensPerMinute = new AtomicInteger(requestsPerMinute);
            this.tokensPerHour = new AtomicInteger(requestsPerHour);
            this.lastMinuteReset = new AtomicLong(System.currentTimeMillis());
            this.lastHourReset = new AtomicLong(System.currentTimeMillis());
            this.minIntervalMs = 60000L / requestsPerMinute; // Minimum 6 seconds between requests for 10/min
            this.lastRequestTime = new AtomicLong(0);
        }
        
        public synchronized boolean acquire() {
            long now = System.currentTimeMillis();
            
            // Reset tokens if minute has passed
            if (now - lastMinuteReset.get() >= 60000) {
                tokensPerMinute.set(maxTokensPerMinute);
                lastMinuteReset.set(now);
            }
            
            // Reset tokens if hour has passed
            if (now - lastHourReset.get() >= 3600000) {
                tokensPerHour.set(maxTokensPerHour);
                lastHourReset.set(now);
            }
            
            // Check if we have tokens available
            if (tokensPerMinute.get() <= 0 || tokensPerHour.get() <= 0) {
                logger.debug("Rate limit exceeded - tokens: {}/min, {}/hour", 
                           tokensPerMinute.get(), tokensPerHour.get());
                return false;
            }
            
            // Check minimum interval
            long timeSinceLastRequest = now - lastRequestTime.get();
            if (timeSinceLastRequest < minIntervalMs) {
                long waitTime = minIntervalMs - timeSinceLastRequest;
                logger.debug("Rate limiting: waiting {}ms before next request", waitTime);
                try {
                    Thread.sleep(waitTime);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
            
            // Consume tokens
            tokensPerMinute.decrementAndGet();
            tokensPerHour.decrementAndGet();
            lastRequestTime.set(System.currentTimeMillis());
            
            return true;
        }
        
        public synchronized long getWaitTimeMs() {
            long now = System.currentTimeMillis();
            
            // Check minute bucket
            if (tokensPerMinute.get() <= 0) {
                long timeSinceReset = now - lastMinuteReset.get();
                if (timeSinceReset < 60000) {
                    return 60000 - timeSinceReset;
                }
            }
            
            // Check hour bucket
            if (tokensPerHour.get() <= 0) {
                long timeSinceReset = now - lastHourReset.get();
                if (timeSinceReset < 3600000) {
                    return 3600000 - timeSinceReset;
                }
            }
            
            // Check minimum interval
            long timeSinceLastRequest = now - lastRequestTime.get();
            if (timeSinceLastRequest < minIntervalMs) {
                return minIntervalMs - timeSinceLastRequest;
            }
            
            return 0;
        }
        
        public synchronized boolean wouldAllow() {
            long now = System.currentTimeMillis();
            
            // Reset tokens if minute has passed
            if (now - lastMinuteReset.get() >= 60000) {
                return true; // Would reset, so allowed
            }
            
            // Reset tokens if hour has passed
            if (now - lastHourReset.get() >= 3600000) {
                return true; // Would reset, so allowed
            }
            
            // Check if we have tokens available (without consuming)
            return tokensPerMinute.get() > 0 && tokensPerHour.get() > 0;
        }
    }
}

