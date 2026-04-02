// Logger centralizado con Pino
const pino = require('pino')

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  base: { pid: false },
  timestamp: pino.stdTimeFunctions.isoTime,
})

module.exports = logger
