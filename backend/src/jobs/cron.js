// Tareas programadas (cron jobs)
const cron = require('node-cron')
const https = require('https')
const { sincronizarERP, sincronizarStock } = require('../services/syncERP')

function iniciarCronJobs() {
  // Sincronización ERP: todos los días a las 06:00 UTC (03:00 Argentina)
  cron.schedule('0 6 * * *', async () => {
    const inicio = new Date().toISOString()
    console.log(`[CRON ${inicio}] Iniciando sincronización ERP automática...`)

    try {
      const resultado = await sincronizarERP('cron')
      console.log(`[CRON ${new Date().toISOString()}] Sync ERP completada: ${resultado.mensaje}`)
    } catch (err) {
      console.error(`[CRON ${new Date().toISOString()}] Error en sync ERP:`, err.message)
    }
  })

  // Sincronización stock depósito central: cada hora en punto
  cron.schedule('0 * * * *', async () => {
    const inicio = new Date().toISOString()
    console.log(`[CRON ${inicio}] Iniciando sincronización de stock depósito...`)

    try {
      const resultado = await sincronizarStock(false, 'cron')
      console.log(`[CRON ${new Date().toISOString()}] Sync stock completada: ${resultado.mensaje}`)
    } catch (err) {
      console.error(`[CRON ${new Date().toISOString()}] Error en sync stock:`, err.message)
    }
  })

  // Keep-alive: ping cada 14 minutos para que Render no duerma el servidor
  const BACKEND_URL = process.env.BACKEND_URL || 'https://padano-backend.onrender.com'
  cron.schedule('*/14 * * * *', () => {
    https.get(`${BACKEND_URL}/health`, (res) => {
      console.log(`[KEEP-ALIVE] Ping OK (${res.statusCode})`)
    }).on('error', (err) => {
      console.error('[KEEP-ALIVE] Ping falló:', err.message)
    })
  })

  console.log('[CRON] Sincronización ERP programada: 06:00 UTC (03:00 Argentina) diariamente')
  console.log('[CRON] Sincronización stock depósito programada: cada hora en punto')
  console.log('[CRON] Keep-alive programado: cada 14 minutos')
}

module.exports = { iniciarCronJobs }
