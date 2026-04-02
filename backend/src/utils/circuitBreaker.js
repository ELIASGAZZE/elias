const logger = require('../config/logger')

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name
    this.failureThreshold = options.failureThreshold || 5
    this.resetTimeout = options.resetTimeout || 60000 // 1 min
    this.state = 'CLOSED'
    this.failures = 0
    this.lastFailure = null
    this.nextAttempt = null
  }

  async exec(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error(`Circuit breaker [${this.name}] is OPEN — skipping request`)
      }
      this.state = 'HALF_OPEN'
      logger.info(`[CircuitBreaker:${this.name}] HALF_OPEN — testing`)
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      this.onFailure()
      throw err
    }
  }

  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      logger.info(`[CircuitBreaker:${this.name}] CLOSED — recovered`)
    }
    this.failures = 0
    this.state = 'CLOSED'
  }

  onFailure() {
    this.failures++
    this.lastFailure = Date.now()
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN'
      this.nextAttempt = Date.now() + this.resetTimeout
      logger.warn(`[CircuitBreaker:${this.name}] OPEN after ${this.failures} failures — retry in ${this.resetTimeout / 1000}s`)
    }
  }

  isOpen() {
    return this.state === 'OPEN' && Date.now() < this.nextAttempt
  }
}

// Singleton instances for each external service
const breakers = {
  centum: new CircuitBreaker('centum', { failureThreshold: 5, resetTimeout: 60000 }),
  afip: new CircuitBreaker('afip', { failureThreshold: 3, resetTimeout: 120000 }),
  mercadopago: new CircuitBreaker('mercadopago', { failureThreshold: 5, resetTimeout: 60000 }),
}

module.exports = { CircuitBreaker, breakers }
