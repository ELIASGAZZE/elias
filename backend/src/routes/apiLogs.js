// Rutas para consultar logs de APIs externas
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { SERVICE_REGISTRY } = require('../config/serviceRegistry')

// GET /api/api-logs
// Admin: devuelve los últimos 100 logs ordenados por fecha descendente
router.get('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('api_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener api_logs:', err)
    res.status(500).json({ error: 'Error al obtener logs' })
  }
})

// GET /api/api-logs/health
// Admin: estado de salud de todos los servicios registrados
router.get('/health', verificarAuth, soloAdmin, async (req, res) => {
  try {
    // Buscar últimos logs de cada servicio registrado en paralelo
    const servicioNames = SERVICE_REGISTRY.map(s => s.servicioLog)
    const { data: logs, error } = await supabase
      .from('api_logs')
      .select('servicio, estado, created_at, items_procesados, error_mensaje')
      .in('servicio', servicioNames)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw error

    const ahora = Date.now()

    const servicios = SERVICE_REGISTRY.map(svc => {
      const logsServicio = (logs || []).filter(l => l.servicio === svc.servicioLog)
      const ultimoOk = logsServicio.find(l => l.estado === 'ok' || l.estado === 'ok_existente')
      const ultimoError = logsServicio.find(l => l.estado === 'error')
      const ultimo = logsServicio[0] || null

      let estado = 'sin_datos'

      if (ultimo) {
        const msDesdeUltimo = ahora - new Date(ultimo.created_at).getTime()
        const minDesdeUltimo = msDesdeUltimo / 60000

        // Si el último log fue error y es más reciente que el último OK
        if (ultimoError && (!ultimoOk || new Date(ultimoError.created_at) > new Date(ultimoOk.created_at))) {
          estado = 'error'
        } else if (svc.tipo === 'on-demand') {
          // On-demand: solo importa si el último fue ok o error
          estado = ultimoOk ? 'ok' : 'sin_datos'
        } else if (svc.umbralCritico && minDesdeUltimo > svc.umbralCritico) {
          estado = 'critico'
        } else if (svc.umbralWarning && minDesdeUltimo > svc.umbralWarning) {
          estado = 'warning'
        } else {
          estado = 'ok'
        }
      }

      return {
        id: svc.id,
        nombre: svc.nombre,
        descripcion: svc.descripcion,
        tipo: svc.tipo,
        estado,
        ultimoLog: ultimo ? {
          fecha: ultimo.created_at,
          estado: ultimo.estado,
          items: ultimo.items_procesados,
          error: ultimo.error_mensaje,
        } : null,
        ultimoOk: ultimoOk ? {
          fecha: ultimoOk.created_at,
          items: ultimoOk.items_procesados,
        } : null,
        endpointManual: svc.endpointManual,
        metodoManual: svc.metodoManual,
      }
    })

    const alertas = {
      criticos: servicios.filter(s => s.estado === 'critico').length,
      errores: servicios.filter(s => s.estado === 'error').length,
      warnings: servicios.filter(s => s.estado === 'warning').length,
    }

    res.json({ servicios, alertas })
  } catch (err) {
    console.error('Error al obtener health:', err)
    res.status(500).json({ error: 'Error al obtener estado de salud' })
  }
})

// GET /api/api-logs/errores-recientes
// Admin: devuelve cantidad de errores en las últimas 24hs (para badge de notificación)
router.get('/errores-recientes', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const hace24hs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { count, error } = await supabase
      .from('api_logs')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'error')
      .gte('created_at', hace24hs)

    if (error) throw error
    res.json({ cantidad: count || 0 })
  } catch (err) {
    console.error('Error al obtener errores recientes:', err)
    res.status(500).json({ error: 'Error al obtener errores' })
  }
})

// POST /api/api-logs/sync/clientes-bi
// Admin: fuerza sync incremental de clientes desde BI
router.post('/sync/clientes-bi', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { syncClientesRecientes } = require('../services/centumClientes')
    const resultado = await syncClientesRecientes(2)
    res.json({ ok: true, ...resultado })
  } catch (err) {
    console.error('Error en sync clientes BI manual:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/api-logs/sync/clientes-retry
// Admin: fuerza retry de clientes pendientes
router.post('/sync/clientes-retry', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { retrySyncCentum } = require('../services/centumClientes')
    const resultado = await retrySyncCentum()
    res.json({ ok: true, ...resultado })
  } catch (err) {
    console.error('Error en retry clientes manual:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/api-logs/sync/clientes-faltantes
// Admin: full scan — importa clientes de Centum que no existen localmente
router.post('/sync/clientes-faltantes', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { syncClientesFaltantes } = require('../services/centumClientes')
    const resultado = await syncClientesFaltantes()
    res.json({ ok: true, ...resultado })
  } catch (err) {
    console.error('Error en sync clientes faltantes manual:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
