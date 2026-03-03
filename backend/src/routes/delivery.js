// Rutas para gestión de pedidos de delivery
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { sincronizarPedidosVenta } = require('../services/syncPedidosVenta')
const { crearPedidoVentaCentum } = require('../services/centumClientes')

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

// POST /api/delivery/pedido-centum
// Admin: crear Pedido de Venta en Centum + registro local
router.post('/pedido-centum', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { cliente_id, tipo, fecha_entrega, direccion_entrega_id, sucursal_id } = req.body

    // Validaciones
    if (!cliente_id) return res.status(400).json({ error: 'cliente_id es requerido' })
    if (!tipo || !['delivery', 'retiro'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo debe ser "delivery" o "retiro"' })
    }
    if (!fecha_entrega) return res.status(400).json({ error: 'fecha_entrega es requerida' })

    // Obtener cliente y verificar que tenga id_centum
    const { data: cliente, error: errCli } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', cliente_id)
      .single()

    if (errCli || !cliente) return res.status(404).json({ error: 'Cliente no encontrado' })
    if (!cliente.id_centum) {
      return res.status(400).json({ error: 'El cliente no tiene ID de Centum. Debe sincronizarse primero.' })
    }

    let observaciones = ''
    let direccionEntrega = null
    let sucursalLocal = null
    let sucursalFisicaId = null

    if (tipo === 'delivery') {
      // Obtener dirección de entrega
      if (direccion_entrega_id) {
        const { data: dir } = await supabase
          .from('direcciones_entrega')
          .select('*')
          .eq('id', direccion_entrega_id)
          .single()
        if (dir) {
          direccionEntrega = [dir.direccion, dir.localidad].filter(Boolean).join(', ')
          observaciones = `Entregar en: ${direccionEntrega}`
        }
      }
      // Delivery siempre entra por Fisherton
      const { data: fisherton } = await supabase
        .from('sucursales')
        .select('id, centum_sucursal_id')
        .ilike('nombre', '%fisherton%')
        .single()
      if (fisherton?.centum_sucursal_id) sucursalFisicaId = fisherton.centum_sucursal_id
    } else {
      // Retiro por sucursal
      if (!sucursal_id) return res.status(400).json({ error: 'sucursal_id es requerido para retiro' })

      const { data: suc, error: errSuc } = await supabase
        .from('sucursales')
        .select('id, nombre, centum_sucursal_id')
        .eq('id', sucursal_id)
        .single()

      if (errSuc || !suc) return res.status(404).json({ error: 'Sucursal no encontrada' })
      sucursalLocal = suc
      sucursalFisicaId = suc.centum_sucursal_id
      observaciones = `Retiro por sucursal: ${suc.nombre}`
    }

    // Crear pedido en Centum
    const resultado = await crearPedidoVentaCentum({
      idCliente: cliente.id_centum,
      fechaEntrega: fecha_entrega,
      tipo,
      observaciones,
      sucursalFisicaId,
    })

    // Extraer número de documento de la respuesta de Centum
    const idPedidoCentum = resultado.IdPedidoVenta || resultado.Id || null
    const numDocRaw = resultado.NumeroDocumento
    let numeroFormateado = null
    if (numDocRaw && typeof numDocRaw === 'object') {
      // {PuntoVenta: 5, Numero: 1182} → "PV 5-1182"
      const pv = numDocRaw.PuntoVenta ?? ''
      const num = numDocRaw.Numero ?? ''
      numeroFormateado = `PV ${pv}-${num}`
    } else if (numDocRaw != null) {
      const s = String(numDocRaw)
      const match = s.match(/\w(\d+)-0*(\d+)/)
      if (match) numeroFormateado = `PV ${parseInt(match[1])}-${parseInt(match[2])}`
      else numeroFormateado = s
    }

    // Resolver sucursal_id (NOT NULL en BD)
    let sucursalParaGuardar = tipo === 'retiro' ? sucursal_id : req.perfil.sucursal_id
    if (!sucursalParaGuardar) {
      // Admin sin sucursal asignada: usar la primera sucursal
      const { data: primeraSuc } = await supabase.from('sucursales').select('id').limit(1).single()
      sucursalParaGuardar = primeraSuc?.id
    }

    // Guardar registro local en pedidos_delivery
    const insertData = {
      cliente_id,
      usuario_id: req.perfil.id,
      sucursal_id: sucursalParaGuardar,
      estado: 'pendiente_pago',
      estado_centum: 'Pendiente',
      numero_documento: numeroFormateado,
      fecha_entrega,
      direccion_entrega: tipo === 'delivery' ? direccionEntrega : null,
      observaciones,
      id_pedido_centum: idPedidoCentum,
    }

    const { data: pedido, error: errIns } = await supabase
      .from('pedidos_delivery')
      .insert(insertData)
      .select(`
        id, estado, estado_centum, numero_documento, fecha_entrega, observaciones, direccion_entrega, created_at,
        clientes(id, razon_social)
      `)
      .single()

    if (errIns) throw errIns

    res.status(201).json({
      mensaje: `Pedido de Venta creado en Centum${numeroFormateado ? ` (${numeroFormateado})` : ''}`,
      pedido,
      centum: resultado,
    })
  } catch (err) {
    console.error('Error al crear pedido de venta:', err)
    res.status(500).json({ error: 'Error al crear pedido de venta en Centum: ' + err.message })
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
