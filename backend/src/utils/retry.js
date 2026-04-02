const logger = require('../config/logger')

/**
 * Retry a function with exponential backoff and jitter.
 * @param {Function} fn - async function to retry
 * @param {Object} opts
 * @param {number} opts.maxRetries - max retry attempts (default 3)
 * @param {number} opts.baseDelay - base delay in ms (default 1000)
 * @param {number} opts.maxDelay - max delay cap in ms (default 60000)
 * @param {string} opts.label - label for logging
 */
async function retryWithBackoff(fn, opts = {}) {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 60000, label = 'operation' } = opts
  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === maxRetries) break
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      const jitter = delay * (0.5 + Math.random() * 0.5) // 50-100% of delay
      logger.warn(`[Retry:${label}] Attempt ${attempt + 1}/${maxRetries} failed: ${err.message}. Retrying in ${Math.round(jitter / 1000)}s`)
      await new Promise(r => setTimeout(r, jitter))
    }
  }
  throw lastError
}

/**
 * Calculate cooldown with exponential backoff and jitter for state-machine retries.
 * Used when retries happen across cron cycles (not within a single call).
 * @param {number} attempt - current attempt number (1-based)
 * @param {Object} opts
 * @param {number} opts.baseDelay - base delay in ms (default 5 * 60 * 1000 = 5 min)
 * @param {number} opts.maxDelay - max delay cap in ms (default 60 * 60 * 1000 = 1 hour)
 * @returns {number} cooldown in ms with jitter applied
 */
function cooldownWithBackoff(attempt, opts = {}) {
  const { baseDelay = 5 * 60 * 1000, maxDelay = 60 * 60 * 1000 } = opts
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
  const jitter = delay * (0.5 + Math.random() * 0.5) // 50-100% of delay
  return Math.round(jitter)
}

module.exports = { retryWithBackoff, cooldownWithBackoff }
