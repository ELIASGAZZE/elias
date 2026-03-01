// Rutas para gestión de pedidos de delivery
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { generateAccessToken } = require('../services/syncERP')

const CENTUM_BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const CENTUM_API_KEY = process.env.CENTUM_API_KEY
const CENTUM_CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

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

// POST /api/delivery/calcular-descuentos
// Consulta a Centum los descuentos por promoción para los artículos del pedido
router.post('/calcular-descuentos', verificarAuth, async (req, res) => {
  try {
    const { cliente_id, items } = req.body

    if (!cliente_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requiere cliente_id e items[]' })
    }

    // Obtener id_centum del cliente
    const { data: cliente, error: errCli } = await supabase
      .from('clientes')
      .select('id_centum')
      .eq('id', cliente_id)
      .single()

    if (errCli || !cliente?.id_centum) {
      return res.status(400).json({ error: 'Cliente sin ID de Centum. Sincronizá los clientes primero.' })
    }

    // Obtener id_centum de cada artículo local
    const articuloIds = items.map(i => i.articulo_id)
    const { data: articulosLocales, error: errArt } = await supabase
      .from('articulos')
      .select('id, id_centum')
      .in('id', articuloIds)

    if (errArt) throw errArt

    const idCentumMap = {} // id_centum -> { local_id, cantidad }
    items.forEach(i => {
      const local = articulosLocales.find(a => a.id === i.articulo_id)
      if (local?.id_centum) {
        idCentumMap[local.id_centum] = { local_id: local.id, cantidad: i.cantidad }
      }
    })

    if (Object.keys(idCentumMap).length === 0) {
      return res.status(400).json({ error: 'Ningún artículo tiene ID de Centum' })
    }

    const accessToken = generateAccessToken(CENTUM_API_KEY)

    // Obtener artículos completos de Centum (con todos los campos requeridos)
    const hoy = new Date().toISOString().split('T')[0]
    const artResponse = await fetch(`${CENTUM_BASE_URL}/Articulos/Venta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CENTUM_CONSUMER_ID,
        'CentumSuiteAccessToken': generateAccessToken(CENTUM_API_KEY),
      },
      body: JSON.stringify({
        IdCliente: cliente.id_centum,
        FechaDocumento: hoy,
        Habilitado: true,
      }),
    })

    if (!artResponse.ok) {
      return res.status(502).json({ error: 'Error al obtener artículos de Centum' })
    }

    const artData = await artResponse.json()
    const articulosCentum = artData?.Articulos?.Items || artData?.Items || []

    // Armar VentaArticulos con objeto completo de Centum + Cantidad
    const ventaArticulos = []
    for (const [idCentumStr, info] of Object.entries(idCentumMap)) {
      const idCentum = parseInt(idCentumStr)
      const artCentum = articulosCentum.find(a => a.IdArticulo === idCentum)
      if (artCentum) {
        ventaArticulos.push({ ...artCentum, Cantidad: info.cantidad })
      }
    }

    if (ventaArticulos.length === 0) {
      return res.status(400).json({ error: 'No se encontraron artículos en Centum' })
    }

    // Llamar a Centum para calcular descuentos
    const descResponse = await fetch(`${CENTUM_BASE_URL}/Ventas/DescuentosPorPromocion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CENTUM_CONSUMER_ID,
        'CentumSuiteAccessToken': generateAccessToken(CENTUM_API_KEY),
      },
      body: JSON.stringify({
        NumeroDocumento: { PuntoVenta: 9 },
        Bonificacion: { IdBonificacion: 6235 },
        EsContado: true,
        Cliente: { IdCliente: cliente.id_centum },
        CondicionVenta: { IdCondicionVenta: 14 },
        TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 },
        Vendedor: { IdVendedor: 2 },
        PorcentajeDescuento: 0,
        VentaArticulos: ventaArticulos,
      }),
    })

    if (!descResponse.ok) {
      const texto = await descResponse.text()
      console.error('Error Centum descuentos:', descResponse.status, texto.slice(0, 500))
      return res.status(502).json({ error: 'Error al consultar descuentos en Centum', detalle: texto.slice(0, 200) })
    }

    const data = await descResponse.json()

    // Extraer descuentos
    const descuentos = data.VentaDescuentosPorPromocion || []
    const articulosResp = data.VentaArticulos || ventaArticulos

    // Calcular subtotal y total
    const subtotal = articulosResp.reduce((sum, a) => sum + (a.Precio || 0) * (a.Cantidad || 0), 0)
    const totalDescuentos = descuentos.reduce((sum, d) => sum + (d.ImporteDescuento || 0), 0)
    const total = subtotal - totalDescuentos

    res.json({
      subtotal: Math.round(subtotal * 100) / 100,
      descuentos: descuentos.map(d => ({
        id_promocion: d.IdPromocionComercial || d.PromocionComercial?.IdPromocionComercial,
        nombre: d.PromocionComercial?.Nombre || d.Nombre || 'Promoción',
        importe: Math.round((d.ImporteDescuento || 0) * 100) / 100,
      })),
      total_descuentos: Math.round(totalDescuentos * 100) / 100,
      total: Math.round(total * 100) / 100,
    })
  } catch (err) {
    console.error('Error al calcular descuentos:', err)
    res.status(500).json({ error: 'Error al calcular descuentos' })
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
        estado: 'pendiente_pago',
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
