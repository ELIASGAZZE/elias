// Rutas para gestión de pedidos de delivery
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/delivery
// Lista pedidos delivery con paginación (operario ve solo su sucursal)
router.get('/', verificarAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 15
    const from = (page - 1) * limit
    const to = from + limit - 1
    const { estado, sucursal_id, busqueda } = req.query

    let query = supabase
      .from('pedidos_delivery')
      .select(`
        id, estado, observaciones, direccion_entrega, created_at,
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
        id, estado, observaciones, direccion_entrega, created_at, usuario_id, sucursal_id,
        clientes(id, razon_social, cuit, direccion, localidad, telefono),
        perfiles(id, nombre),
        sucursales(id, nombre),
        items_delivery(id, cantidad, observaciones, articulos(id, codigo, nombre))
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

// POST /api/delivery
// Crear pedido delivery (cliente_id + items[])
router.post('/', verificarAuth, async (req, res) => {
  try {
    const { cliente_id, items, sucursal_id, direccion_entrega, observaciones } = req.body

    if (!cliente_id) {
      return res.status(400).json({ error: 'El cliente es requerido' })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido debe tener al menos un artículo' })
    }

    // Validar items
    for (const item of items) {
      if (!item.articulo_id || !item.cantidad || item.cantidad <= 0) {
        return res.status(400).json({ error: 'Cada item debe tener articulo_id y cantidad mayor a 0' })
      }
    }

    // Determinar sucursal
    const sucId = req.perfil.rol === 'admin' && sucursal_id
      ? sucursal_id
      : req.perfil.sucursal_id

    if (!sucId) {
      return res.status(400).json({ error: 'La sucursal es requerida' })
    }

    // Verificar que el cliente existe
    const { data: cliente, error: errCliente } = await supabase
      .from('clientes')
      .select('id, direccion')
      .eq('id', cliente_id)
      .single()

    if (errCliente || !cliente) {
      return res.status(400).json({ error: 'Cliente no encontrado' })
    }

    // Crear pedido
    const { data: pedido, error: errorPedido } = await supabase
      .from('pedidos_delivery')
      .insert({
        cliente_id,
        usuario_id: req.perfil.id,
        sucursal_id: sucId,
        estado: 'pendiente',
        direccion_entrega: direccion_entrega?.trim() || cliente.direccion || null,
        observaciones: observaciones?.trim() || null,
      })
      .select()
      .single()

    if (errorPedido) throw errorPedido

    // Insertar items
    const itemsConPedidoId = items.map(item => ({
      pedido_id: pedido.id,
      articulo_id: item.articulo_id,
      cantidad: item.cantidad,
      observaciones: item.observaciones?.trim() || null,
    }))

    const { error: errorItems } = await supabase
      .from('items_delivery')
      .insert(itemsConPedidoId)

    if (errorItems) throw errorItems

    res.status(201).json({ mensaje: 'Pedido delivery creado correctamente', pedido_id: pedido.id })
  } catch (err) {
    console.error('Error al crear pedido delivery:', err)
    res.status(500).json({ error: 'Error al crear pedido delivery' })
  }
})

// PUT /api/delivery/:id/estado
// Admin: cambiar estado
router.put('/:id/estado', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { estado } = req.body
    const estadosValidos = ['pendiente', 'en_preparacion', 'en_camino', 'entregado', 'cancelado']

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

// DELETE /api/delivery/:id
// Admin: eliminar pedido (items se eliminan por CASCADE)
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('pedidos_delivery')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ mensaje: 'Pedido delivery eliminado correctamente' })
  } catch (err) {
    console.error('Error al eliminar pedido delivery:', err)
    res.status(500).json({ error: 'Error al eliminar pedido delivery' })
  }
})

module.exports = router
