// Rutas para el módulo de Auditoría POS
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// POST /api/auditoria/cancelacion
// Registra una venta cancelada
router.post('/cancelacion', verificarAuth, async (req, res) => {
  try {
    const { motivo, items, subtotal, total, cliente_nombre, caja_id, sucursal_id, cierre_id } = req.body
    if (!motivo) return res.status(400).json({ error: 'Motivo requerido' })

    const { error } = await supabase.from('ventas_pos_canceladas').insert({
      cajero_id: req.usuario.id,
      cajero_nombre: req.perfil?.nombre || 'Desconocido',
      sucursal_id,
      caja_id,
      motivo,
      items: items || [],
      subtotal: subtotal || 0,
      total: total || 0,
      cliente_nombre: cliente_nombre || null,
      cierre_id: cierre_id || null,
    })

    if (error) {
      // Si la tabla no existe, logueamos pero no rompemos el flujo
      console.warn('[Auditoria] No se pudo registrar cancelación (tabla puede no existir):', error.message)
      return res.json({ ok: true, warning: 'No se pudo persistir' })
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[Auditoria] Error al registrar cancelación:', err.message)
    res.json({ ok: true, warning: 'Error interno' })
  }
})

// Helper para queries seguras (devuelve [] si la tabla no existe)
async function safeQuery(query) {
  const { data, error } = await query
  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
      return [] // tabla no existe
    }
    throw error
  }
  return data || []
}

// GET /api/auditoria/dashboard
// Datos agregados para el dashboard de auditoría
router.get('/dashboard', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { desde, hasta } = req.query
    if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' })

    // Traer todo en paralelo (tolerante a tablas faltantes)
    const [ventas, cancelaciones, eliminaciones, cierres] = await Promise.all([
      safeQuery(
        supabase
          .from('ventas_pos')
          .select('id, cajero_id, sucursal_id, caja_id, items, subtotal, descuento_total, total, pagos, promociones_aplicadas, created_at, cajero:perfiles!cajero_id(nombre)')
          .gte('created_at', desde)
          .lte('created_at', hasta)
          .order('created_at', { ascending: false })
      ),
      safeQuery(
        supabase
          .from('ventas_pos_canceladas')
          .select('*')
          .gte('created_at', desde)
          .lte('created_at', hasta)
          .order('created_at', { ascending: false })
      ),
      safeQuery(
        supabase
          .from('pos_eliminaciones_log')
          .select('*')
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('fecha', { ascending: false })
      ),
      safeQuery(
        supabase
          .from('cierres_pos')
          .select('*, caja:cajas(nombre), cajero:perfiles!cajero_id(nombre), empleado:empleados!empleado_id(id, nombre)')
          .gte('created_at', desde)
          .lte('created_at', hasta)
          .order('created_at', { ascending: false })
      ),
    ])

    // Enriquecer ventas con nombre de empleado via cierres_pos
    // Mapear caja_id + rango de cierre → empleado
    const cierresPorCaja = {}
    cierres.forEach(c => {
      if (!c.empleado?.nombre) return
      const key = c.caja_id
      if (!cierresPorCaja[key]) cierresPorCaja[key] = []
      cierresPorCaja[key].push({
        apertura: c.apertura_at,
        cierre: c.cierre_at || new Date().toISOString(),
        empleado_nombre: c.empleado.nombre,
        empleado_id: c.empleado.id,
      })
    })

    // Mapear cierre_id → empleado para lookup directo
    const empleadoPorCierre = {}
    cierres.forEach(c => {
      if (c.empleado?.nombre) {
        empleadoPorCierre[c.id] = { nombre: c.empleado.nombre, id: c.empleado.id }
      }
    })

    ventas.forEach(v => {
      const sesiones = cierresPorCaja[v.caja_id] || []
      const sesion = sesiones.find(s => v.created_at >= s.apertura && v.created_at <= s.cierre)
      v.empleado_nombre = sesion?.empleado_nombre || v.cajero?.nombre || 'Sin asignar'
      v.empleado_id = sesion?.empleado_id || v.cajero_id
    })

    // Enriquecer cancelaciones con nombre de empleado
    cancelaciones.forEach(c => {
      if (c.cierre_id && empleadoPorCierre[c.cierre_id]) {
        c.empleado_nombre = empleadoPorCierre[c.cierre_id].nombre
        c.empleado_id = empleadoPorCierre[c.cierre_id].id
      } else if (c.caja_id) {
        const sesiones = cierresPorCaja[c.caja_id] || []
        const sesion = sesiones.find(s => c.created_at >= s.apertura && c.created_at <= s.cierre)
        c.empleado_nombre = sesion?.empleado_nombre || c.cajero_nombre || 'Sin asignar'
        c.empleado_id = sesion?.empleado_id || c.cajero_id
      } else {
        c.empleado_nombre = c.cajero_nombre || 'Sin asignar'
        c.empleado_id = c.cajero_id
      }
    })

    // Enriquecer eliminaciones con nombre de empleado
    eliminaciones.forEach(e => {
      if (e.cierre_id && empleadoPorCierre[e.cierre_id]) {
        e.empleado_nombre = empleadoPorCierre[e.cierre_id].nombre
        e.empleado_id = empleadoPorCierre[e.cierre_id].id
      } else {
        e.empleado_nombre = e.usuario_nombre || 'Sin asignar'
        e.empleado_id = e.usuario_id
      }
    })

    res.json({ ventas, cancelaciones, eliminaciones, cierres })
  } catch (err) {
    console.error('[Auditoria] Error dashboard:', err.message)
    res.status(500).json({ error: 'Error al obtener datos de auditoría' })
  }
})

module.exports = router
