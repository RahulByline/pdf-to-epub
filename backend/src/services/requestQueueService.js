/**
 * Request Queue Service
 * Queues API requests when rate limited instead of rejecting them
 */
export class RequestQueueService {
  static queues = new Map();
  static processing = new Map();
  static maxConcurrent = 1; // Process one request at a time per provider

  /**
   * Get or create a queue for a provider
   * @param {string} provider - Provider name (e.g., "Gemini")
   * @returns {Array} Request queue
   */
  static getQueue(provider = 'Gemini') {
    if (!this.queues.has(provider)) {
      this.queues.set(provider, []);
      this.processing.set(provider, false);
    }
    return this.queues.get(provider);
  }

  /**
   * Add a request to the queue
   * @param {string} provider - Provider name
   * @param {Function} requestFn - Async function that makes the API request
   * @param {number} priority - Priority level (1=high, 2=medium, 3=low)
   * @returns {Promise} Promise that resolves when request completes
   */
  static async enqueue(provider, requestFn, priority = 2) {
    return new Promise((resolve, reject) => {
      const queue = this.getQueue(provider);
      queue.push({
        requestFn,
        priority,
        resolve,
        reject,
        timestamp: Date.now()
      });

      // Sort by priority (lower number = higher priority)
      queue.sort((a, b) => a.priority - b.priority);

      // Start processing if not already processing
      this.processQueue(provider);
    });
  }

  /**
   * Process the queue for a provider
   * @param {string} provider - Provider name
   */
  static async processQueue(provider) {
    const queue = this.getQueue(provider);
    const isProcessing = this.processing.get(provider);

    // Don't process if already processing or queue is empty
    if (isProcessing || queue.length === 0) {
      return;
    }

    this.processing.set(provider, true);

    while (queue.length > 0) {
      const item = queue.shift();

      try {
        const result = await item.requestFn();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }

      // Small delay between requests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing.set(provider, false);
  }

  /**
   * Get queue length for a provider
   * @param {string} provider - Provider name
   * @returns {number} Queue length
   */
  static getQueueLength(provider = 'Gemini') {
    const queue = this.getQueue(provider);
    return queue.length;
  }

  /**
   * Clear queue for a provider
   * @param {string} provider - Provider name
   */
  static clearQueue(provider = 'Gemini') {
    const queue = this.getQueue(provider);
    queue.forEach(item => {
      item.reject(new Error('Queue cleared'));
    });
    queue.length = 0;
  }
}

