// Tareas programadas (cron jobs)
const cron = require('node-cron')
const https = require('https')
const { sincronizarERP, sincronizarStock } = require('../services/syncERP')
const { syncClientesRecientes, retrySyncCentum } = require('../services/centumClientes')
const { analizarBatch } = require('../services/patronesIA')
const { registrarLlamada } = require('../services/apiLogger')

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

  // Sync incremental de clientes: cada 5 minutos, últimas 2 horas
  cron.schedule('*/5 * * * *', async () => {
    try {
      const resultado = await syncClientesRecientes(2)
      if (resultado.nuevos > 0 || resultado.actualizados > 0) {
        console.log(`[SyncClientes] ${resultado.nuevos} nuevos, ${resultado.actualizados} actualizados desde Centum BI`)
      }
    } catch (err) {
      console.error('[SyncClientes] Error:', err.message)
    }
  })

  // Retry clientes sin id_centum: cada 5 minutos (offset 2 min para no chocar con sync)
  cron.schedule('2-57/5 * * * *', async () => {
    try {
      const resultado = await retrySyncCentum()
      if (resultado.reintentados > 0) {
        console.log(`[RetryCentum] ${resultado.exitosos}/${resultado.reintentados} clientes sincronizados a Centum (${resultado.fallidos} fallidos)`)
      }
    } catch (err) {
      console.error('[RetryCentum] Error:', err.message)
    }
  })

  // Análisis batch nocturno: todos los días a las 08:00 UTC (05:00 Argentina)
  // Analiza los cierres del día anterior
  cron.schedule('0 8 * * *', async () => {
    const ayer = new Date()
    ayer.setDate(ayer.getDate() - 1)
    const fechaAyer = ayer.toISOString().split('T')[0]
    console.log(`[CRON ${new Date().toISOString()}] Iniciando análisis batch para ${fechaAyer}...`)

    const inicioBatch = Date.now()
    try {
      const resultado = await analizarBatch(fechaAyer)
      console.log(`[CRON] Batch completado: ${resultado.total} cierres, ${resultado.con_diferencia} con diferencia, puntaje promedio: ${resultado.puntaje_promedio || 'N/A'}`)
      registrarLlamada({
        servicio: 'batch_ia', endpoint: `analizarBatch(${fechaAyer})`, metodo: 'BATCH',
        estado: 'ok', duracion_ms: Date.now() - inicioBatch,
        items_procesados: resultado.total, origen: 'cron',
      })
    } catch (err) {
      console.error('[CRON] Error en análisis batch:', err.message)
      registrarLlamada({
        servicio: 'batch_ia', endpoint: `analizarBatch(${fechaAyer})`, metodo: 'BATCH',
        estado: 'error', duracion_ms: Date.now() - inicioBatch,
        error_mensaje: err.message, origen: 'cron',
      })
    }
  })

  console.log('[CRON] Sincronización ERP programada: 06:00 UTC (03:00 Argentina) diariamente')
  console.log('[CRON] Sincronización stock depósito programada: cada hora en punto')
  console.log('[CRON] Keep-alive programado: cada 14 minutos')
  console.log('[CRON] Sync clientes incremental: cada 5 minutos (últimas 2h)')
  console.log('[CRON] Retry clientes pendientes Centum: cada 5 minutos')
  console.log('[CRON] Análisis batch IA: 08:00 UTC (05:00 Argentina) diariamente')
}

module.exports = { iniciarCronJobs }
