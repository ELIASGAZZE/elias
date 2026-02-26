// Rutas para gestión de pedidos
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/pedidos
// Todos los usuarios ven todos los pedidos, con filtros opcionales
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { sucursal_id, estado, fecha_desde, fecha_hasta, usuario_id } = req.query

    let query = supabase
      .from('pedidos')
      .select(`
        id, fecha, estado, created_at,
        sucursales(id, nombre),
        perfiles(id, nombre),
        items_pedido(cantidad, articulos(id, codigo, nombre))
      `)
      .order('created_at', { ascending: false })

    // Filtros opcionales
    if (sucursal_id) query = query.eq('sucursal_id', sucursal_id)
    if (estado) query = query.eq('estado', estado)
    if (usuario_id) query = query.eq('usuario_id', usuario_id)
    if (fecha_desde) query = query.gte('fecha', fecha_desde)
    if (fecha_hasta) query = query.lte('fecha', fecha_hasta)

    const { data, error } = await query
    if (error) throw error

    res.json(data)
  } catch (err) {
    console.error('Error al obtener pedidos:', err)
    res.status(500).json({ error: 'Error al obtener pedidos' })
  }
})

// GET /api/pedidos/:id
// Ver detalle de un pedido específico
router.get('/:id', verificarAuth, async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await supabase
      .from('pedidos')
      .select(`
        id, fecha, estado, created_at, usuario_id,
        sucursales(id, nombre),
        perfiles(id, nombre),
        items_pedido(cantidad, articulos(id, codigo, nombre))
      `)
      .eq('id', id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }

    // El operario solo puede ver sus propios pedidos
    if (req.perfil.rol !== 'admin' && data.usuario_id !== req.perfil.id) {
      return res.status(403).json({ error: 'No tenés acceso a este pedido' })
    }

    res.json(data)
  } catch (err) {
    console.error('Error al obtener pedido:', err)
    res.status(500).json({ error: 'Error al obtener pedido' })
  }
})

// POST /api/pedidos
// Operario crea un nuevo pedido
router.post('/', verificarAuth, async (req, res) => {
  try {
    const { items, sucursal_id } = req.body // items: [{ articulo_id, cantidad }]

    if (!sucursal_id) {
      return res.status(400).json({ error: 'La sucursal es requerida' })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido debe tener al menos un artículo' })
    }

    // Validamos cada item
    for (const item of items) {
      if (!item.articulo_id || !item.cantidad || item.cantidad <= 0) {
        return res.status(400).json({ error: 'Cada item debe tener articulo_id y cantidad mayor a 0' })
      }
    }

    // Creamos el pedido
    const { data: pedido, error: errorPedido } = await supabase
      .from('pedidos')
      .insert({
        sucursal_id,
        usuario_id: req.perfil.id,
        fecha: new Date().toISOString().split('T')[0], // solo la fecha YYYY-MM-DD
        estado: 'pendiente',
      })
      .select()
      .single()

    if (errorPedido) throw errorPedido

    // Insertamos los items del pedido
    const itemsConPedidoId = items.map(item => ({
      pedido_id: pedido.id,
      articulo_id: item.articulo_id,
      cantidad: item.cantidad,
    }))

    const { error: errorItems } = await supabase
      .from('items_pedido')
      .insert(itemsConPedidoId)

    if (errorItems) throw errorItems

    res.status(201).json({ mensaje: 'Pedido creado correctamente', pedido_id: pedido.id })
  } catch (err) {
    console.error('Error al crear pedido:', err)
    res.status(500).json({ error: 'Error al crear pedido' })
  }
})

// PUT /api/pedidos/:id/estado
// Admin: cambia el estado de un pedido
router.put('/:id/estado', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { estado } = req.body

    const estadosValidos = ['pendiente', 'confirmado', 'entregado', 'cancelado']
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` })
    }

    const { data, error } = await supabase
      .from('pedidos')
      .update({ estado })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al actualizar estado:', err)
    res.status(500).json({ error: 'Error al actualizar estado del pedido' })
  }
})

// PUT /api/pedidos/:id
// Admin: modifica los items de un pedido
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { items, estado } = req.body

    // Actualizamos el estado si viene
    if (estado) {
      const estadosValidos = ['pendiente', 'confirmado', 'entregado', 'cancelado']
      if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' })
      }
      await supabase.from('pedidos').update({ estado }).eq('id', id)
    }

    // Si vienen items, reemplazamos todos los items del pedido
    if (Array.isArray(items)) {
      // Eliminamos los items actuales
      await supabase.from('items_pedido').delete().eq('pedido_id', id)

      // Insertamos los nuevos
      if (items.length > 0) {
        const nuevosItems = items.map(item => ({
          pedido_id: id,
          articulo_id: item.articulo_id,
          cantidad: item.cantidad,
        }))
        await supabase.from('items_pedido').insert(nuevosItems)
      }
    }

    res.json({ mensaje: 'Pedido actualizado correctamente' })
  } catch (err) {
    console.error('Error al modificar pedido:', err)
    res.status(500).json({ error: 'Error al modificar pedido' })
  }
})

// DELETE /api/pedidos/:id
// Admin: elimina un pedido
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    // Los items se eliminan automáticamente por el CASCADE en la base de datos
    const { error } = await supabase
      .from('pedidos')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Pedido eliminado correctamente' })
  } catch (err) {
    console.error('Error al eliminar pedido:', err)
    res.status(500).json({ error: 'Error al eliminar pedido' })
  }
})

// GET /api/pedidos/:id/csv
// Admin: descarga un pedido como CSV con codigo_articulo y cantidad
router.get('/:id/csv', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await supabase
      .from('items_pedido')
      .select('cantidad, articulos(codigo, nombre)')
      .eq('pedido_id', id)

    if (error) throw error

    // Generamos el CSV manualmente
    const filas = ['codigo_articulo,cantidad']
    data.forEach(item => {
      filas.push(`${item.articulos.codigo},${item.cantidad}`)
    })
    const csv = filas.join('\n')

    // Configuramos los headers para que el navegador descargue el archivo
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="pedido-${id}.csv"`)
    res.send(csv)
  } catch (err) {
    console.error('Error al generar CSV:', err)
    res.status(500).json({ error: 'Error al generar CSV' })
  }
})

module.exports = router
