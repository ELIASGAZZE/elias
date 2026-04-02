// Cache en memoria simple con TTL
const logger = require('./logger')

class SimpleCache {
  constructor(defaultTTL = 5 * 60 * 1000) { // 5 min por defecto
    this._store = new Map()
    this._defaultTTL = defaultTTL

    // Limpieza periódica cada 10 minutos
    setInterval(() => this._cleanup(), 10 * 60 * 1000).unref()
  }

  get(key) {
    const entry = this._store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key, value, ttl) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this._defaultTTL),
    })
  }

  del(key) {
    this._store.delete(key)
  }

  clear() {
    this._store.clear()
  }

  _cleanup() {
    const now = Date.now()
    let cleaned = 0
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) {
        this._store.delete(key)
        cleaned++
      }
    }
    if (cleaned > 0) logger.debug({ cleaned }, '[Cache] Limpieza periódica')
  }
}

// Singleton para toda la app
const appCache = new SimpleCache()

module.exports = { SimpleCache, appCache }
