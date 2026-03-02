// Rutas para gestión de pedidos de delivery
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { sincronizarPedidosVenta } = require('../services/syncPedidosVenta')

// GET /api/delivery
// Lista pedidos delivery con paginación (operario ve solo su sucursal)
router.get('/', verificarAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 15), 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    const { estado, sucursal_id, busqueda } = req.query

    let query = supabase
      .from('pedidos_delivery')
      .select(`
        id, estado, estado_centum, numero_documento, observaciones, direccion_entrega, fecha_entrega, created_at,
        clientes(id, razon_social, direccion, telefono),
        perfiles(id, nombre),
        sucursales(id, nombre),
        items_delivery(id)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    // Operario solo ve pedidos de su sucursal
    if (req.perfil.rol !== 'admin') {
      query = query.eq('sucursal_id', req.perfil.sucursal_id)
    } else if (sucursal_id) {
      query = query.eq('sucursal_id', sucursal_id)
    }

    if (estado) query = query.eq('estado', estado)

    // Búsqueda: traer todo y filtrar post-query (para buscar en joins)
    if (busqueda && busqueda.trim()) {
      const { data: allData, error: allError } = await query
      if (allError) throw allError

      const terminos = busqueda.toLowerCase().trim().split(/\s+/)
      const filtrados = (allData || []).filter(p => {
        const texto = [
          p.clientes?.razon_social,
          p.clientes?.direccion,
          p.clientes?.telefono,
          p.direccion_entrega,
          p.observaciones,
          p.sucursales?.nombre,
          p.perfiles?.nombre,
          p.estado,
          p.numero_documento,
        ].filter(Boolean).join(' ').toLowerCase()
        return terminos.every(t => texto.includes(t))
      })

      const paginados = filtrados.slice(from, to + 1)
      return res.json({ pedidos: paginados, total: filtrados.length })
    }

    query = query.range(from, to)
    const { data, error, count } = await query
    if (error) throw error

    res.json({ pedidos: data, total: count })
  } catch (err) {
    console.error('Error al obtener pedidos delivery:', err)
    res.status(500).json({ error: 'Error al obtener pedidos delivery' })
  }
})

// GET /api/delivery/:id
// Detalle con items + cliente
router.get('/:id', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos_delivery')
      .select(`
        id, estado, estado_centum, numero_documento, fecha_entrega, observaciones, direccion_entrega, created_at, usuario_id, sucursal_id, id_pedido_centum,
        clientes(id, razon_social, cuit, direccion, localidad, telefono),
        perfiles(id, nombre),
        sucursales(id, nombre),
        items_delivery(id, cantidad, precio, observaciones, articulos(id, codigo, nombre))
      `)
      .eq('id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Pedido delivery no encontrado' })
    }

    // Operario solo ve pedidos de su sucursal
    if (req.perfil.rol !== 'admin' && data.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a este pedido' })
    }

    res.json(data)
  } catch (err) {
    console.error('Error al obtener pedido delivery:', err)
    res.status(500).json({ error: 'Error al obtener pedido delivery' })
  }
})

// POST /api/delivery/sincronizar
// Admin: trigger manual de sincronización de pedidos desde Centum
router.post('/sincronizar', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const resultado = await sincronizarPedidosVenta('manual')
    res.json({
      mensaje: `Sincronización completada: ${resultado.nuevos} nuevos, ${resultado.actualizados} actualizados, ${resultado.cancelados || 0} cancelados`,
      ...resultado,
    })
  } catch (err) {
    console.error('Error al sincronizar pedidos:', err)
    res.status(500).json({ error: 'Error al sincronizar pedidos de venta: ' + err.message })
  }
})

// PUT /api/delivery/:id/estado
// Admin: cambiar estado
router.put('/:id/estado', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { estado } = req.body
    const estadosValidos = ['pendiente_pago', 'pagado', 'entregado', 'cancelado']

    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` })
    }

    const { data, error } = await supabase
      .from('pedidos_delivery')
      .update({ estado })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al actualizar estado:', err)
    res.status(500).json({ error: 'Error al actualizar estado del pedido' })
  }
})

module.exports = router
