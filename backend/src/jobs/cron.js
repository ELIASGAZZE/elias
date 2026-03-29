// Tareas programadas (cron jobs)
const cron = require('node-cron')
const https = require('https')
const { sincronizarERP, sincronizarStock, sincronizarStockMultiSucursal, sincronizarImagenesPresencia } = require('../services/syncERP')
const { syncClientesRecientes, retrySyncCentum, syncClientesFaltantes } = require('../services/centumClientes')
const { retrySyncVentasCentum, retrySyncCAE, retryEmailsPendientes } = require('../services/centumVentasPOS')
const { analizarBatch } = require('../services/patronesIA')
const { registrarLlamada } = require('../services/apiLogger')

// Lock simple para evitar ejecución paralela de crons en múltiples instancias
const cronLocks = {}
async function withLock(name, fn) {
  if (cronLocks[name]) {
    console.log(`[CRON] ${name} ya está corriendo, saltando...`)
    return null
  }
  cronLocks[name] = true
  try {
    return await fn()
  } finally {
    cronLocks[name] = false
  }
}

async function iniciarCronJobs() {
  // ============ STARTUP DELAY: prevenir race condition durante deploys ============
  // Render puede correr instancia vieja y nueva simultáneamente durante ~30-60s.
  // Este delay asegura que la instancia vieja termine antes de que la nueva arranque crons.
  const STARTUP_DELAY_MS = 45000 // 45 segundos
  console.log(`[CRON] Esperando ${STARTUP_DELAY_MS/1000}s antes de iniciar crons (anti-race deploy)...`)
  await new Promise(r => setTimeout(r, STARTUP_DELAY_MS))
  console.log('[CRON] Delay completado, iniciando cron jobs...')

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
    await withLock('syncClientes', async () => {
      try {
        const resultado = await syncClientesRecientes(2)
        if (resultado.nuevos > 0 || resultado.actualizados > 0) {
          console.log(`[SyncClientes] ${resultado.nuevos} nuevos, ${resultado.actualizados} actualizados desde Centum BI`)
        }
      } catch (err) {
        console.error('[SyncClientes] Error:', err.message)
      }
    })
  })

  // Retry clientes sin id_centum: cada 5 minutos (offset 2 min para no chocar con sync)
  cron.schedule('2-57/5 * * * *', async () => {
    await withLock('retryCentum', async () => {
      try {
        const resultado = await retrySyncCentum()
        if (resultado.reintentados > 0) {
          console.log(`[RetryCentum] ${resultado.exitosos}/${resultado.reintentados} clientes sincronizados a Centum (${resultado.fallidos} fallidos)`)
        }
      } catch (err) {
        console.error('[RetryCentum] Error:', err.message)
      }
    })
  })

  // Full scan clientes faltantes: cada hora (minuto 30, para no chocar con stock)
  cron.schedule('30 * * * *', async () => {
    await withLock('syncFaltantes', async () => {
      try {
        const resultado = await syncClientesFaltantes()
        if (resultado.insertados > 0) {
          console.log(`[SyncFaltantes] ${resultado.insertados} clientes faltantes importados de Centum BI`)
        }
      } catch (err) {
        console.error('[SyncFaltantes] Error:', err.message)
      }
    })
  })

  // Retry ventas pendientes de Centum: cada 3 minutos (cola secuencial con lock)
  // Frecuencia baja intencional: prioridad seguridad > velocidad (anti-duplicación)
  cron.schedule('*/3 * * * *', async () => {
    await withLock('syncVentasCentum', async () => {
      try {
        const resultado = await retrySyncVentasCentum()
        if (resultado.reintentadas > 0) {
          console.log(`[RetryCentumVentas] ${resultado.exitosas}/${resultado.reintentadas} ventas sincronizadas a Centum (${resultado.fallidas} fallidas)`)
        }
      } catch (err) {
        console.error('[RetryCentumVentas] Error:', err.message)
      }
    })
  })

  // Retry CAE + envío email automático: cada 5 minutos (offset 4 min)
  cron.schedule('4-59/5 * * * *', async () => {
    try {
      const resultado = await retrySyncCAE()
      if (resultado.revisadas > 0) {
        console.log(`[RetryCAE] ${resultado.conCAE}/${resultado.revisadas} ventas obtuvieron CAE (+ email automático si aplica)`)
      }
    } catch (err) {
      console.error('[RetryCAE] Error:', err.message)
    }
  })

  // Retry emails pendientes: cada 10 minutos (offset 7 min, para no chocar con CAE)
  cron.schedule('7-57/10 * * * *', async () => {
    await withLock('retryEmails', async () => {
      try {
        const resultado = await retryEmailsPendientes()
        if (resultado.pendientes > 0) {
          console.log(`[RetryEmails] ${resultado.enviados}/${resultado.pendientes} emails enviados (${resultado.sinEmail} sin email cliente, ${resultado.fallidos} fallidos)`)
        }
      } catch (err) {
        console.error('[RetryEmails] Error:', err.message)
      }
    })
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

  // Stock multi-sucursal para consulta POS: cada 30 minutos
  cron.schedule('*/30 * * * *', async () => {
    try {
      const resultado = await sincronizarStockMultiSucursal('cron')
      console.log(`[StockMulti] ${resultado.mensaje}`)
    } catch (err) {
      console.error('[StockMulti] Error:', err.message)
    }
  })

  // Presencia de imágenes: una vez al día a las 06:10 UTC
  cron.schedule('10 6 * * *', async () => {
    try {
      const resultado = await sincronizarImagenesPresencia('cron')
      console.log(`[SyncImágenes] ${resultado.mensaje}`)
    } catch (err) {
      console.error('[SyncImágenes] Error:', err.message)
    }
  })

  console.log('[CRON] Sincronización ERP programada: 06:00 UTC (03:00 Argentina) diariamente')
  console.log('[CRON] Sincronización stock depósito programada: cada hora en punto')
  console.log('[CRON] Keep-alive programado: cada 14 minutos')
  console.log('[CRON] Sync clientes incremental: cada 5 minutos (últimas 2h)')
  console.log('[CRON] Retry clientes pendientes Centum: cada 5 minutos')
  console.log('[CRON] Full scan clientes faltantes: cada hora (minuto 30)')
  console.log('[CRON] Retry ventas pendientes Centum: cada 3 minutos (cola secuencial, anti-duplicación)')
  console.log('[CRON] Retry CAE + email automático: cada 5 minutos (offset 4)')
  console.log('[CRON] Retry emails pendientes: cada 10 minutos (offset 7)')
  console.log('[CRON] Stock multi-sucursal: cada 30 minutos')
  console.log('[CRON] Presencia imágenes: 06:10 UTC diariamente')
  console.log('[CRON] Análisis batch IA: 08:00 UTC (05:00 Argentina) diariamente')
}

module.exports = { iniciarCronJobs }
