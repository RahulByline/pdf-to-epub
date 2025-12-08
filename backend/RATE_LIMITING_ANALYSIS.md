# Rate Limiting & 429 Error Prevention Analysis

## Current Implementation

### ✅ What We Have
1. **Token Bucket Rate Limiter**
   - 10 requests per minute
   - 600 requests per hour
   - 6 seconds minimum interval
   - Pre-request checks

2. **429 Error Handling**
   - Graceful fallback (returns null)
   - Exponential backoff
   - Server retry delay parsing

3. **Pre-request Rate Limit Checks**
   - Applied to all Gemini API calls

## Issues & Gaps

### 🔴 Critical Issues

1. **Concurrent Job Processing**
   - Multiple conversion jobs can run simultaneously
   - Each job makes 2-3 API calls (extraction + structuring)
   - No coordination between jobs
   - **Risk**: 3 concurrent jobs = 6-9 simultaneous API calls → 429 errors

2. **No Request Queue**
   - Requests are rejected immediately if rate limited
   - No queuing system to wait and retry
   - **Risk**: Legitimate requests fail when temporarily rate limited

3. **No Circuit Breaker**
   - Continues making requests even after multiple 429s
   - No automatic pause when API is clearly overloaded
   - **Risk**: Wastes quota and increases 429 frequency

4. **Fixed Rate Limits**
   - Hardcoded to 10/min, 600/hour
   - Doesn't adapt to actual API responses
   - **Risk**: May be too aggressive or too lenient

### 🟡 Medium Priority Issues

5. **No Request Prioritization**
   - All requests treated equally
   - User-initiated vs background jobs same priority
   - **Risk**: Important requests blocked by low-priority ones

6. **No Caching**
   - Same PDF processed multiple times
   - No caching of extraction/structuring results
   - **Risk**: Unnecessary API calls

7. **No Request Batching**
   - Each page processed separately (if implemented)
   - Could batch multiple pages in one request
   - **Risk**: More API calls than necessary

8. **No Adaptive Rate Limiting**
   - Doesn't learn from 429 responses
   - Doesn't adjust limits based on success rate
   - **Risk**: Suboptimal rate limit settings

## Recommended Solutions

### Priority 1: Request Queue System
**Impact**: High | **Effort**: Medium

- Implement a queue for API requests
- When rate limited, queue the request instead of rejecting
- Process queue with rate limiter
- **Benefit**: Prevents request loss, better resource utilization

### Priority 2: Job Concurrency Control
**Impact**: High | **Effort**: Low

- Limit concurrent conversion jobs
- Use semaphore pattern (max 2-3 concurrent jobs)
- **Benefit**: Prevents API overload from concurrent jobs

### Priority 3: Circuit Breaker Pattern
**Impact**: Medium | **Effort**: Medium

- Track consecutive 429 errors
- Open circuit after threshold (e.g., 5 consecutive 429s)
- Auto-close after cooldown period
- **Benefit**: Prevents wasted requests when API is down

### Priority 4: Request Prioritization
**Impact**: Medium | **Effort**: Medium

- Priority levels: HIGH (user-initiated), MEDIUM (scheduled), LOW (background)
- Process high-priority requests first
- **Benefit**: Better user experience

### Priority 5: Result Caching
**Impact**: Low | **Effort**: High

- Cache extraction results by PDF hash
- Cache structuring results by content hash
- **Benefit**: Reduces API calls for duplicate content

### Priority 6: Adaptive Rate Limiting
**Impact**: Low | **Effort**: High

- Monitor 429 frequency
- Adjust rate limits dynamically
- Learn optimal request intervals
- **Benefit**: Optimizes API usage

## Implementation Plan

### Phase 1: Critical Fixes (Immediate)
1. ✅ Request Queue System
2. ✅ Job Concurrency Control
3. ✅ Circuit Breaker

### Phase 2: Optimizations (Short-term)
4. Request Prioritization
5. Better logging and monitoring

### Phase 3: Advanced Features (Long-term)
6. Result Caching
7. Adaptive Rate Limiting

## Metrics to Monitor

1. **429 Error Rate**: Should be < 1%
2. **Request Success Rate**: Should be > 95%
3. **Average Request Wait Time**: Should be < 10s
4. **Queue Length**: Should be < 10 requests
5. **Circuit Breaker Opens**: Should be < 1 per hour

