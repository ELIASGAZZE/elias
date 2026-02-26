// Tareas programadas (cron jobs)
const cron = require('node-cron')
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

  console.log('[CRON] Sincronización ERP programada: 06:00 UTC (03:00 Argentina) diariamente')
  console.log('[CRON] Sincronización stock depósito programada: cada hora en punto')
}

module.exports = { iniciarCronJobs }
