/**
 * Job Concurrency Control Service
 * Limits concurrent conversion jobs to prevent API overload
 */
export class JobConcurrencyService {
  static maxConcurrent = parseInt(process.env.MAX_CONCURRENT_JOBS || '2', 10);
  static runningJobs = new Set();
  static waitingJobs = [];

  /**
   * Acquire a slot for a job
   * @param {number} jobId - Job ID
   * @returns {Promise<void>} Resolves when slot is acquired
   */
  static async acquire(jobId) {
    // If we have available slots, acquire immediately
    if (this.runningJobs.size < this.maxConcurrent) {
      this.runningJobs.add(jobId);
      console.log(`[Job ${jobId}] Acquired concurrency slot (${this.runningJobs.size}/${this.maxConcurrent} running)`);
      return;
    }

    // Otherwise, wait in queue
    console.log(`[Job ${jobId}] Waiting for concurrency slot (${this.runningJobs.size}/${this.maxConcurrent} running, ${this.waitingJobs.length} waiting)`);
    return new Promise((resolve) => {
      this.waitingJobs.push({ jobId, resolve });
    });
  }

  /**
   * Release a slot for a job
   * @param {number} jobId - Job ID
   */
  static release(jobId) {
    if (this.runningJobs.has(jobId)) {
      this.runningJobs.delete(jobId);
      console.log(`[Job ${jobId}] Released concurrency slot (${this.runningJobs.size}/${this.maxConcurrent} running)`);
      
      // Process next waiting job
      if (this.waitingJobs.length > 0) {
        const next = this.waitingJobs.shift();
        this.runningJobs.add(next.jobId);
        console.log(`[Job ${next.jobId}] Acquired concurrency slot from queue`);
        next.resolve();
      }
    }
  }

  /**
   * Get current concurrency stats
   * @returns {Object} Stats object
   */
  static getStats() {
    return {
      running: this.runningJobs.size,
      maxConcurrent: this.maxConcurrent,
      waiting: this.waitingJobs.length,
      runningJobIds: Array.from(this.runningJobs)
    };
  }
}

