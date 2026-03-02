// Tareas programadas (cron jobs)
const cron = require('node-cron')
const https = require('https')
const { sincronizarERP, sincronizarStock } = require('../services/syncERP')
const { sincronizarPedidosVenta } = require('../services/syncPedidosVenta')

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

  // Sync continuo de pedidos de venta desde Centum (loop con 15s de pausa)
  async function loopSyncPedidos() {
    // Esperar 30s antes de la primera sync para que el servidor termine de arrancar
    await new Promise(r => setTimeout(r, 30000))
    console.log('[SyncPedidos] Loop de sincronización iniciado')

    while (true) {
      try {
        const resultado = await sincronizarPedidosVenta('cron')
        if (resultado.nuevos > 0 || resultado.errores > 0) {
          console.log(`[SyncPedidos] ${resultado.nuevos} nuevos, ${resultado.actualizados} actualizados, ${resultado.errores} errores`)
        }
      } catch (err) {
        console.error('[SyncPedidos] Error:', err.message)
      }
      await new Promise(r => setTimeout(r, 15000))
    }
  }
  loopSyncPedidos()

  console.log('[CRON] Sincronización ERP programada: 06:00 UTC (03:00 Argentina) diariamente')
  console.log('[CRON] Sincronización stock depósito programada: cada hora en punto')
  console.log('[CRON] Keep-alive programado: cada 14 minutos')
  console.log('[CRON] Sync pedidos de venta: loop continuo (cada 15s)')
}

module.exports = { iniciarCronJobs }
