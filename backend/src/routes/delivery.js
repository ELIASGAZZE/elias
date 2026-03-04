// Rutas para gestión de pedidos de delivery
// Consulta directa a Centum REST API + merge con estados locales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { crearPedidoVentaCentum } = require('../services/centumClientes')
const { fetchPedidosCentum, fetchPedidoCentum, mapCentumPedido, formatNumeroDocumento, anularPedidoCentum, crearPedidoVentaCompletoCentum, extractFacturaFromEstados, crearVentaDesdePedido, crearCobroDeVenta } = require('../services/centumPedidosVenta')
const { crearPreferenciaPago, obtenerPago } = require('../services/mercadopago')
const { getFacturasTurno } = require('../config/centum')

// Helper: mapa centum_sucursal_id → { id, nombre }
async function getSucursalesMap() {
  const { data } = await supabase
    .from('sucursales')
    .select('id, nombre, centum_sucursal_id')
    .not('centum_sucursal_id', 'is', null)
  const map = {}
  for (const s of (data || [])) map[s.centum_sucursal_id] = s
  return map
}

// GET /api/delivery
// Lista pedidos desde Centum API + merge con estados locales
router.get('/', verificarAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 15), 100)
    const { estado, sucursal_id, busqueda } = req.query

    // 1. Obtener mapa de sucursales
    const sucursalesMap = await getSucursalesMap()

    // 2. Determinar qué sucursales consultar en Centum (IdSucursal es obligatorio)
    const centumSucursalIds = []
    if (req.perfil.rol !== 'admin') {
      // Operario: solo su sucursal
      const { data: suc } = await supabase
        .from('sucursales')
        .select('centum_sucursal_id')
        .eq('id', req.perfil.sucursal_id)
        .single()
      if (suc?.centum_sucursal_id) centumSucursalIds.push(suc.centum_sucursal_id)
    } else if (sucursal_id) {
      // Admin filtrando por sucursal específica
      const { data: suc } = await supabase
        .from('sucursales')
        .select('centum_sucursal_id')
        .eq('id', sucursal_id)
        .single()
      if (suc?.centum_sucursal_id) centumSucursalIds.push(suc.centum_sucursal_id)
    } else {
      // Admin sin filtro: todas las sucursales con centum_sucursal_id
      for (const csId of Object.keys(sucursalesMap)) centumSucursalIds.push(parseInt(csId))
    }

    // 3. Fetch de Centum (últimos 60 días) — una llamada por sucursal
    const fechaDesde = new Date()
    fechaDesde.setDate(fechaDesde.getDate() - 60)
    const fechaDesdeStr = fechaDesde.toISOString().split('T')[0] + 'T00:00:00'
    const fechaHastaStr = new Date().toISOString().split('T')[0] + 'T23:59:59'

    let pedidosCentum = []
    const fetchPromises = centumSucursalIds.map(csId =>
      fetchPedidosCentum({
        fechaDesde: fechaDesdeStr,
        fechaHasta: fechaHastaStr,
        idSucursal: csId,
      }).then(r => r.items).catch(err => {
        console.error(`[Delivery] Error consultando sucursal ${csId}:`, err.message)
        return []
      })
    )
    const resultados = await Promise.all(fetchPromises)
    for (const items of resultados) pedidosCentum.push(...items)

    // 4. Obtener registros locales para merge de estados
    const idsCentum = pedidosCentum.map(p => p.IdPedidoVenta).filter(Boolean)
    const localesMap = {}
    if (idsCentum.length > 0) {
      for (let i = 0; i < idsCentum.length; i += 500) {
        const lote = idsCentum.slice(i, i + 500)
        const { data: locales } = await supabase
          .from('pedidos_delivery')
          .select('id, id_pedido_centum, estado, estado_centum, direccion_entrega, observaciones, fecha_entrega, created_at, perfiles(id, nombre)')
          .in('id_pedido_centum', lote)
        for (const l of (locales || [])) localesMap[l.id_pedido_centum] = l
      }
    }

    // 5. Auto-crear registros locales para pedidos nuevos
    const nuevos = pedidosCentum.filter(p => p.IdPedidoVenta && !localesMap[p.IdPedidoVenta])
    if (nuevos.length > 0) {
      const { data: defaultSuc } = await supabase.from('sucursales').select('id').limit(1).single()
      const inserts = nuevos.map(p => {
        const sucFisicaId = p.SucursalFisica?.IdSucursalFisica
        const sucLocal = sucFisicaId ? sucursalesMap[sucFisicaId] : null
        return {
          id_pedido_centum: p.IdPedidoVenta,
          estado: 'pendiente_pago',
          numero_documento: formatNumeroDocumento(p.NumeroDocumento),
          sucursal_id: sucLocal?.id || defaultSuc?.id,
        }
      }).filter(ins => ins.sucursal_id)

      if (inserts.length > 0) {
        try {
          const { data: creados } = await supabase
            .from('pedidos_delivery')
            .upsert(inserts, { onConflict: 'id_pedido_centum', ignoreDuplicates: true })
            .select('id, id_pedido_centum, estado, estado_centum, perfiles(id, nombre)')
          for (const n of (creados || [])) localesMap[n.id_pedido_centum] = n
        } catch (err) {
          console.error('[Delivery] Error auto-creando registros locales:', err.message)
        }
      }
    }

    // 6. Obtener turnos de factura SOLO para suscriptos que aún no están como 'entregado'
    //    Una vez determinado, se guarda en Supabase → no se vuelve a consultar SQL Server
    const facturasMap = {} // nroFactura → idPedidoVenta
    for (const p of pedidosCentum) {
      const local = localesMap[p.IdPedidoVenta]
      // Si ya está como 'entregado' en local, no necesitamos consultar SQL Server
      if (local?.estado === 'entregado') continue
      const estados = p.PedidoVentaEstados || []
      const ultimoEstado = estados.length > 0 ? estados[estados.length - 1] : null
      const estadoNombre = ultimoEstado?.Estado?.Nombre || ''
      if (typeof estadoNombre === 'string' && estadoNombre.toLowerCase().includes('suscripto')) {
        const nroFactura = extractFacturaFromEstados(estados)
        if (nroFactura) facturasMap[nroFactura] = p.IdPedidoVenta
      }
    }

    let turnosFactura = {} // nroFactura → { turnoId, turnoNombre }
    const nroFacturas = Object.keys(facturasMap)
    if (nroFacturas.length > 0) {
      try {
        turnosFactura = await getFacturasTurno(nroFacturas)
      } catch (err) {
        console.error('[Delivery] Error al obtener turnos de facturas:', err.message)
      }
    }

    // Invertir mapa: idPedidoVenta → turnoNombre
    const turnosPorPedido = {}
    for (const [nroFac, idPV] of Object.entries(facturasMap)) {
      if (turnosFactura[nroFac]) {
        turnosPorPedido[idPV] = turnosFactura[nroFac].turnoNombre
      }
    }

    // 7. Mapear Centum → formato frontend + merge estado local + turno factura
    let pedidosMapeados = pedidosCentum.map(p =>
      mapCentumPedido(p, localesMap[p.IdPedidoVenta] || null, sucursalesMap, turnosPorPedido[p.IdPedidoVenta] || null)
    )

    // 8. Auto-actualizar estados locales que cambiaron (persistir en Supabase)
    const actualizaciones = []
    for (const pm of pedidosMapeados) {
      const local = localesMap[pm.id_pedido_centum]
      if (local && local.estado !== pm.estado) {
        actualizaciones.push({ id_pedido_centum: pm.id_pedido_centum, estado: pm.estado })
      }
    }
    if (actualizaciones.length > 0) {
      for (const upd of actualizaciones) {
        supabase.from('pedidos_delivery').update({ estado: upd.estado }).eq('id_pedido_centum', upd.id_pedido_centum).then()
      }
    }

    // Ordenar por fecha más reciente
    pedidosMapeados.sort((a, b) => {
      const da = a.created_at ? new Date(a.created_at) : new Date(0)
      const db = b.created_at ? new Date(b.created_at) : new Date(0)
      return db - da
    })

    // 9. Filtrar por estado local
    if (estado) {
      pedidosMapeados = pedidosMapeados.filter(p => p.estado === estado)
    }

    // 10. Filtrar por búsqueda
    if (busqueda && busqueda.trim()) {
      const terminos = busqueda.toLowerCase().trim().split(/\s+/)
      pedidosMapeados = pedidosMapeados.filter(p => {
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
    }

    // 11. Paginar
    const total = pedidosMapeados.length
    const from = (page - 1) * limit
    const paginados = pedidosMapeados.slice(from, from + limit)

    res.json({ pedidos: paginados, total })
  } catch (err) {
    console.error('Error al obtener pedidos delivery:', err)
    if (err.message?.includes('Error al conectar con Centum')) {
      return res.status(502).json({ error: 'Error al conectar con Centum ERP' })
    }
    res.status(500).json({ error: 'Error al obtener pedidos delivery' })
  }
})

// GET /api/delivery/:id/raw — datos crudos de Centum (debug, solo admin)
router.get('/:id/raw', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const idCentum = parseInt(req.params.id)
    if (isNaN(idCentum)) return res.status(400).json({ error: 'ID inválido' })
    const data = await fetchPedidoCentum(idCentum)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/delivery/:id/factura — datos de la factura vinculada (debug, solo admin)
router.get('/:id/factura', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const idCentum = parseInt(req.params.id)
    if (isNaN(idCentum)) return res.status(400).json({ error: 'ID inválido' })

    // 1. Obtener pedido y extraer nro de factura del estado Suscripto
    const pedido = await fetchPedidoCentum(idCentum)
    const estados = pedido.PedidoVentaEstados || []
    const suscripto = estados.find(e => {
      const nombre = e.Estado?.Nombre || ''
      return nombre.toLowerCase().includes('suscripto')
    })
    if (!suscripto) return res.status(404).json({ error: 'Pedido no suscripto, no tiene factura' })

    // Extraer nro factura del detalle: "Alta de Venta B00002-00007581"
    const match = suscripto.Detalle?.match(/Alta de Venta\s+(\S+)/)
    const nroFactura = match ? match[1] : null

    // 2. Probar endpoints de Ventas en Centum
    const { generateAccessToken } = require('../services/syncERP')
    const BASE = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
    const KEY = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
    const headers = {
      'Content-Type': 'application/json',
      'CentumSuiteConsumidorApiPublicaId': process.env.CENTUM_CONSUMER_ID || '2',
      'CentumSuiteAccessToken': generateAccessToken(KEY),
    }

    // Probar distintos endpoints
    const resultados = {}
    const fechaDesde = new Date()
    fechaDesde.setDate(fechaDesde.getDate() - 60)
    const fechaDesdeStr = fechaDesde.toISOString().split('T')[0] + 'T00:00:00'
    const fechaHastaStr = new Date().toISOString().split('T')[0] + 'T23:59:59'

    // POST /Ventas/FiltrosVenta — buscar todas del día, matchear por PedidoVenta
    try {
      const r = await fetch(`${BASE}/Ventas/FiltrosVenta?numeroPagina=1&cantidadItemsPorPagina=100`, {
        method: 'POST', headers, body: JSON.stringify({
          FechaDocumentoDesde: '2026-03-04T00:00:00',
          FechaDocumentoHasta: fechaHastaStr,
        })
      })
      const data = r.ok ? await r.json() : { status: r.status, body: await r.text().then(t => t.slice(0, 500)) }
      const items = data?.Ventas?.Items || []

      // Buscar la factura que suscribe nuestro pedido
      const facturaMatch = items.find(v => {
        // Match por PedidoVenta vinculado
        if (v.PedidoVenta?.IdPedidoVenta === idCentum) return true
        // Match por PedidosVentaSuscriptos
        if (v.PedidosVentaSuscriptos?.some(p => p.IdPedidoVenta === idCentum)) return true
        // Match por nro documento
        const nd = v.NumeroDocumento
        if (nd) {
          const formatted = `${nd.LetraDocumento || ''}${String(nd.PuntoVenta || '').padStart(5, '0')}-${String(nd.Numero || '').padStart(8, '0')}`
          if (formatted === nroFactura) return true
        }
        return false
      })

      if (facturaMatch) {
        // Obtener detalle completo (regenerar token)
        try {
          const headers2 = { ...headers, 'CentumSuiteAccessToken': generateAccessToken(KEY) }
          const r2 = await fetch(`${BASE}/Ventas/${facturaMatch.IdVenta}`, { method: 'GET', headers: headers2 })
          const det = r2.ok ? await r2.json() : { status: r2.status, body: await r2.text().then(t => t.slice(0, 500)) }
          // Limpiar para ver campos relevantes
          delete det.VentaArticulos
          delete det.Cliente
          delete det.VentaValoresEfectivos
          delete det.VentaValoresVouchers
          delete det.VentaRegimenesEspeciales
          delete det.VentaConceptos
          delete det.VentaDescuentosPorPromocion
          delete det.PresupuestoVentaArticulosSuscriptos
          delete det.PedidoVentaArticulosSuscriptos
          delete det.RemitoVentaArticulosSuscriptos
          resultados.ventaDetalle = det
        } catch (e) { resultados.ventaDetalle = { error: e.message } }
      } else {
        resultados.ventaDetalle = null
        resultados.totalVentas = items.length
      }
    } catch (e) { resultados.error = e.message }

    res.json({ nroFactura, detalleSuscripto: suscripto, resultados })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/delivery/:id
// Detalle: fetch directo de Centum + merge estado local
router.get('/:id', verificarAuth, async (req, res) => {
  try {
    const idCentum = parseInt(req.params.id)
    if (isNaN(idCentum)) return res.status(400).json({ error: 'ID inválido' })

    // 1. Fetch pedido de Centum (con ítems)
    const pedidoCentum = await fetchPedidoCentum(idCentum)

    // 2. Mapa de sucursales
    const sucursalesMap = await getSucursalesMap()

    // 3. Buscar o crear registro local
    const sucFisicaId = pedidoCentum.SucursalFisica?.IdSucursalFisica
    const sucLocal = sucFisicaId ? sucursalesMap[sucFisicaId] : null
    let sucursalId = sucLocal?.id || null
    if (!sucursalId) {
      const { data: defaultSuc } = await supabase.from('sucursales').select('id').limit(1).single()
      sucursalId = defaultSuc?.id || null
    }

    let registroLocal = null
    const { data: existing } = await supabase
      .from('pedidos_delivery')
      .select('id, id_pedido_centum, estado, estado_centum, direccion_entrega, observaciones, fecha_entrega, created_at, usuario_id, perfiles(id, nombre)')
      .eq('id_pedido_centum', idCentum)
      .maybeSingle()

    if (existing) {
      registroLocal = existing
    } else if (sucursalId) {
      try {
        const { data: nuevo } = await supabase
          .from('pedidos_delivery')
          .insert({
            id_pedido_centum: idCentum,
            estado: 'pendiente_pago',
            numero_documento: formatNumeroDocumento(pedidoCentum.NumeroDocumento),
            sucursal_id: sucursalId,
          })
          .select('id, id_pedido_centum, estado, estado_centum, direccion_entrega, observaciones, fecha_entrega, created_at, perfiles(id, nombre)')
          .single()
        registroLocal = nuevo
      } catch (err) {
        // Race condition (23505) o error — seguir sin registro local
        if (err.code === '23505') {
          const { data: retry } = await supabase
            .from('pedidos_delivery')
            .select('id, id_pedido_centum, estado, estado_centum, direccion_entrega, observaciones, fecha_entrega, created_at, perfiles(id, nombre)')
            .eq('id_pedido_centum', idCentum)
            .maybeSingle()
          registroLocal = retry
        } else {
          console.error(`[Delivery] Error auto-creando registro para pedido ${idCentum}:`, err.message)
        }
      }
    }

    // 4. Validar acceso por sucursal
    if (req.perfil.rol !== 'admin') {
      const sucursalPedido = sucLocal?.id || registroLocal?.sucursal_id
      if (sucursalPedido && sucursalPedido !== req.perfil.sucursal_id) {
        return res.status(403).json({ error: 'No tenés acceso a este pedido' })
      }
    }

    // 5. Obtener turno de factura SOLO si suscripto y no ya 'entregado'
    let turnoFacturaNombre = null
    if (registroLocal?.estado !== 'entregado') {
      const estados = pedidoCentum.PedidoVentaEstados || []
      const nroFactura = extractFacturaFromEstados(estados)
      if (nroFactura) {
        try {
          const turnos = await getFacturasTurno([nroFactura])
          if (turnos[nroFactura]) turnoFacturaNombre = turnos[nroFactura].turnoNombre
        } catch (err) {
          console.error('[Delivery] Error al obtener turno de factura:', err.message)
        }
      }
    }

    // 6. Mapear y retornar
    const pedido = mapCentumPedido(pedidoCentum, registroLocal, sucursalesMap, turnoFacturaNombre)

    // Auto-actualizar estado local si cambió (persistir en Supabase)
    if (registroLocal && registroLocal.estado !== pedido.estado) {
      supabase.from('pedidos_delivery').update({ estado: pedido.estado }).eq('id_pedido_centum', idCentum).then()
    }

    res.json(pedido)
  } catch (err) {
    console.error('Error al obtener pedido delivery:', err)
    if (err.message?.includes('no encontrado en Centum')) {
      return res.status(404).json({ error: 'Pedido no encontrado en Centum' })
    }
    if (err.message?.includes('Error al conectar con Centum')) {
      return res.status(502).json({ error: 'Error al conectar con Centum ERP' })
    }
    res.status(500).json({ error: 'Error al obtener pedido delivery' })
  }
})

// POST /api/delivery/pedido-centum
// Crear Pedido de Venta en Centum + registro local (admin y operarios)
router.post('/pedido-centum', verificarAuth, async (req, res) => {
  try {
    const { cliente_id, tipo, fecha_entrega, direccion_entrega_id, sucursal_id } = req.body

    // Validaciones
    if (!cliente_id) return res.status(400).json({ error: 'cliente_id es requerido' })
    if (!tipo || !['delivery', 'retiro'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo debe ser "delivery" o "retiro"' })
    }
    if (!fecha_entrega) return res.status(400).json({ error: 'fecha_entrega es requerida' })

    // Operarios solo pueden crear retiro en su propia sucursal o delivery
    if (req.perfil.rol !== 'admin' && tipo === 'retiro') {
      if (sucursal_id && sucursal_id !== req.perfil.sucursal_id) {
        return res.status(403).json({ error: 'Solo podés crear pedidos de retiro para tu sucursal' })
      }
    }

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
    let numeroFormateado = formatNumeroDocumento(numDocRaw)

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
        id, estado, estado_centum, numero_documento, fecha_entrega, observaciones, direccion_entrega, created_at, id_pedido_centum,
        clientes(id, razon_social)
      `)
      .single()

    if (errIns) throw errIns

    // Retornar id_pedido_centum como id para consistencia con el nuevo formato
    const respuesta = {
      ...pedido,
      id: idPedidoCentum || pedido.id,
    }

    res.status(201).json({
      mensaje: `Pedido de Venta creado en Centum${numeroFormateado ? ` (${numeroFormateado})` : ''}`,
      pedido: respuesta,
      centum: resultado,
    })
  } catch (err) {
    console.error('Error al crear pedido de venta:', err)
    res.status(500).json({ error: 'Error al crear pedido de venta en Centum: ' + err.message })
  }
})

// POST /api/delivery/webhook-mp
// Webhook de Mercado Pago — SIN auth (viene de servidores de MP)
router.post('/webhook-mp', async (req, res) => {
  try {
    if (req.body.type === 'payment') {
      const paymentId = req.body.data?.id
      if (paymentId) {
        const pago = await obtenerPago(paymentId)
        if (pago.status === 'approved' && pago.external_reference) {
          const idCentum = parseInt(pago.external_reference)
          if (!isNaN(idCentum)) {
            const { data: pedido } = await supabase
              .from('pedidos_delivery')
              .select('estado')
              .eq('id_pedido_centum', idCentum)
              .maybeSingle()
            if (pedido && pedido.estado === 'pendiente_pago') {
              await supabase
                .from('pedidos_delivery')
                .update({ estado: 'pagado', mp_payment_id: String(paymentId) })
                .eq('id_pedido_centum', idCentum)
              console.log(`[MP Webhook] Pedido ${idCentum} marcado como pagado (payment ${paymentId})`)

              // Facturación async — no bloquea la respuesta al webhook
              facturarPedidoAsync(idCentum).catch(err => {
                console.error(`[MP Webhook] Error en facturación async pedido ${idCentum}:`, err.message)
              })
            }
          }
        }
      }
    }
    res.sendStatus(200)
  } catch (err) {
    console.error('[MP Webhook] Error:', err.message)
    res.sendStatus(200) // Siempre responder 200 a MP
  }
})

/**
 * Facturación async: crea Venta + Cobro en Centum después de marcar como pagado.
 * Si falla, guarda el error en error_facturacion para tracking.
 */
async function facturarPedidoAsync(idCentum) {
  try {
    // 1. Buscar pedido local con cliente_id
    const { data: pedidoLocal } = await supabase
      .from('pedidos_delivery')
      .select('id, cliente_id')
      .eq('id_pedido_centum', idCentum)
      .maybeSingle()

    if (!pedidoLocal?.cliente_id) {
      throw new Error('Pedido local no tiene cliente_id asociado')
    }

    // 2. Buscar cliente para obtener id_centum
    const { data: cliente } = await supabase
      .from('clientes')
      .select('id_centum')
      .eq('id', pedidoLocal.cliente_id)
      .single()

    if (!cliente?.id_centum) {
      throw new Error('Cliente no tiene id_centum')
    }

    // 3. Obtener pedido de Centum para SucursalFisica
    const pedidoCentum = await fetchPedidoCentum(idCentum)
    const sucursalFisicaId = pedidoCentum.SucursalFisica?.IdSucursalFisica
    if (!sucursalFisicaId) {
      throw new Error('Pedido Centum no tiene SucursalFisica')
    }

    // 4. Crear Venta (factura) suscribiendo el PedidoVenta
    console.log(`[Facturación] Creando venta para pedido ${idCentum}...`)
    const venta = await crearVentaDesdePedido(idCentum, cliente.id_centum, sucursalFisicaId)
    const idVenta = venta.IdVenta || venta.Id
    const totalVenta = venta.Total || venta.ImporteTotal || 0
    const numDocVenta = venta.NumeroDocumento
    let numeroFactura = null
    if (numDocVenta) {
      const letra = numDocVenta.LetraDocumento || ''
      const pv = String(numDocVenta.PuntoVenta || '').padStart(5, '0')
      const num = String(numDocVenta.Numero || '').padStart(8, '0')
      numeroFactura = `${letra}${pv}-${num}`
    }
    console.log(`[Facturación] Venta creada: IdVenta=${idVenta}, Total=${totalVenta}, Factura=${numeroFactura}`)

    // 5. Crear Cobro con IdValor 13 (Mercado Pago)
    console.log(`[Facturación] Creando cobro para venta ${idVenta}...`)
    const cobro = await crearCobroDeVenta(idVenta, cliente.id_centum, sucursalFisicaId, totalVenta)
    const idCobro = cobro.IdCobro || cobro.Id
    console.log(`[Facturación] Cobro creado: IdCobro=${idCobro}`)

    // 6. Actualizar BD con datos de facturación
    await supabase
      .from('pedidos_delivery')
      .update({
        id_venta_centum: idVenta,
        id_cobro_centum: idCobro,
        numero_factura: numeroFactura,
        error_facturacion: null,
      })
      .eq('id_pedido_centum', idCentum)

    console.log(`[Facturación] Pedido ${idCentum} facturado OK → Venta ${idVenta}, Cobro ${idCobro}, Factura ${numeroFactura}`)
  } catch (err) {
    console.error(`[Facturación] Error facturando pedido ${idCentum}:`, err.message)
    // Guardar error para tracking — el pedido queda como 'pagado' sin factura
    await supabase
      .from('pedidos_delivery')
      .update({ error_facturacion: err.message.slice(0, 500) })
      .eq('id_pedido_centum', idCentum)
      .catch(e => console.error('[Facturación] Error guardando error_facturacion:', e.message))
  }
}

// POST /api/delivery/:id/link-pago
// Genera link de pago de Mercado Pago para un pedido
router.post('/:id/link-pago', verificarAuth, async (req, res) => {
  try {
    const idCentum = parseInt(req.params.id)
    if (isNaN(idCentum)) return res.status(400).json({ error: 'ID inválido' })

    // 1. Buscar pedido local
    const { data: pedido } = await supabase
      .from('pedidos_delivery')
      .select('id, id_pedido_centum, estado, mp_link_pago, mp_preference_id, numero_documento')
      .eq('id_pedido_centum', idCentum)
      .maybeSingle()

    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
    if (pedido.estado !== 'pendiente_pago') {
      return res.status(400).json({ error: 'El pedido no está pendiente de pago' })
    }

    // 2. Obtener detalle de Centum para calcular total actual (siempre recalcular)
    const pedidoCentum = await fetchPedidoCentum(idCentum)
    const articulos = pedidoCentum.PedidoVentaArticulos || []
    const total = articulos.reduce((sum, a) => {
      let precio = a.Precio || 0
      const d1 = a.PorcentajeDescuento1 || 0
      const d2 = a.PorcentajeDescuento2 || 0
      const d3 = a.PorcentajeDescuento3 || 0
      precio = precio * (1 - d1 / 100) * (1 - d2 / 100) * (1 - d3 / 100)
      const cantidad = a.Cantidad || 0
      return sum + (precio * cantidad)
    }, 0)

    console.log(`[Link MP] Pedido ${idCentum}: total calculado = $${total} (${articulos.length} artículos)`)

    if (total <= 0) {
      return res.status(400).json({ error: 'El pedido no tiene un total válido para cobrar' })
    }

    // 4. Crear preferencia en MP
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`
    const titulo = `Pedido ${pedido.numero_documento || `#${idCentum}`}`
    const { id: prefId, init_point } = await crearPreferenciaPago({
      idPedido: idCentum,
      titulo,
      monto: Math.round(total * 100) / 100,
      notificationUrl: `${backendUrl}/api/delivery/webhook-mp`,
    })

    // 5. Guardar preference_id (para tracking del webhook, no para caché)
    await supabase
      .from('pedidos_delivery')
      .update({ mp_preference_id: prefId, mp_link_pago: null })
      .eq('id_pedido_centum', idCentum)

    res.json({ link: init_point })
  } catch (err) {
    console.error('[Link MP] Error:', err)
    res.status(500).json({ error: 'Error al generar link de pago: ' + err.message })
  }
})

// PUT /api/delivery/:id/estado
// Cambiar estado local (id = id_pedido_centum)
// Admin: cualquier transición. Operario: solo pagado → entregado
router.put('/:id/estado', verificarAuth, async (req, res) => {
  try {
    const { estado } = req.body
    const idCentum = parseInt(req.params.id)
    if (isNaN(idCentum)) return res.status(400).json({ error: 'ID inválido' })

    const estadosValidos = ['pendiente_pago', 'pagado', 'entregado', 'cancelado']
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` })
    }

    // Operarios solo pueden pasar de pagado → entregado
    if (req.perfil.rol !== 'admin') {
      if (estado !== 'entregado') {
        return res.status(403).json({ error: 'Solo podés marcar pedidos como entregados' })
      }
      // Verificar que el pedido esté en pagado
      const { data: actual } = await supabase
        .from('pedidos_delivery')
        .select('estado')
        .eq('id_pedido_centum', idCentum)
        .maybeSingle()
      if (actual && actual.estado !== 'pagado') {
        return res.status(403).json({ error: 'Solo podés marcar como entregado un pedido que esté pagado' })
      }
    }

    // Intentar actualizar registro existente
    const { data } = await supabase
      .from('pedidos_delivery')
      .update({ estado })
      .eq('id_pedido_centum', idCentum)
      .select()

    if (data && data.length > 0) {
      return res.json(data[0])
    }

    // No existe registro local — crear uno con el estado
    let sucursalId = null
    try {
      const pedidoCentum = await fetchPedidoCentum(idCentum)
      const sucFisicaId = pedidoCentum.SucursalFisica?.IdSucursalFisica
      if (sucFisicaId) {
        const { data: suc } = await supabase
          .from('sucursales')
          .select('id')
          .eq('centum_sucursal_id', sucFisicaId)
          .single()
        sucursalId = suc?.id || null
      }
    } catch (_) {}

    if (!sucursalId) {
      const { data: defaultSuc } = await supabase.from('sucursales').select('id').limit(1).single()
      sucursalId = defaultSuc?.id || null
    }

    const { data: nuevo, error: errIns } = await supabase
      .from('pedidos_delivery')
      .insert({
        id_pedido_centum: idCentum,
        estado,
        sucursal_id: sucursalId,
      })
      .select()
      .single()

    if (errIns) throw errIns
    res.json(nuevo)
  } catch (err) {
    console.error('Error al actualizar estado:', err)
    res.status(500).json({ error: 'Error al actualizar estado del pedido' })
  }
})

// POST /api/delivery/:id/editar
// Admin: anular pedido viejo en Centum y crear uno nuevo con los mismos artículos + cambios
router.post('/:id/editar', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const idCentum = parseInt(req.params.id)
    if (isNaN(idCentum)) return res.status(400).json({ error: 'ID inválido' })

    const { tipo, sucursal_id, direccion_entrega_id, fecha_entrega } = req.body
    if (!tipo || !['delivery', 'retiro'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo debe ser "delivery" o "retiro"' })
    }

    // 1. Obtener pedido original completo de Centum
    const pedidoOriginal = await fetchPedidoCentum(idCentum)

    // 2. Verificar que no esté anulado (campo Anulado o último estado)
    const anulado = pedidoOriginal.Anulado === true || pedidoOriginal.Anulado === 1
    const estados = pedidoOriginal.PedidoVentaEstados || []
    const ultimoEstado = estados.length > 0 ? estados[estados.length - 1] : null
    const estadoNombre = ultimoEstado?.Estado?.Nombre || ultimoEstado?.Estado || ''
    const anuladoPorEstado = typeof estadoNombre === 'string' && estadoNombre.toLowerCase().includes('anulado')
    if (anulado || anuladoPorEstado) {
      return res.status(400).json({ error: 'No se puede editar un pedido anulado' })
    }
    const suscriptoTotal = typeof estadoNombre === 'string' && estadoNombre.toLowerCase().includes('suscripto total')
    if (suscriptoTotal) {
      return res.status(400).json({ error: 'No se puede editar un pedido con estado "Suscripto Total"' })
    }

    // 3. Verificar que tenga artículos
    const articulos = pedidoOriginal.PedidoVentaArticulos || []
    if (articulos.length === 0) {
      return res.status(400).json({ error: 'El pedido no tiene artículos en Centum' })
    }

    // 4. Determinar nueva sucursal física y observaciones
    let sucursalFisicaId = null
    let observaciones = ''
    let direccionEntrega = null
    let sucursalParaGuardar = null

    if (tipo === 'delivery') {
      // Delivery siempre entra por Fisherton
      const { data: fisherton } = await supabase
        .from('sucursales')
        .select('id, centum_sucursal_id')
        .ilike('nombre', '%fisherton%')
        .single()
      if (fisherton?.centum_sucursal_id) sucursalFisicaId = fisherton.centum_sucursal_id
      sucursalParaGuardar = fisherton?.id || req.perfil.sucursal_id

      // Dirección de entrega
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
    } else {
      // Retiro por sucursal
      if (!sucursal_id) return res.status(400).json({ error: 'sucursal_id es requerido para retiro' })

      const { data: suc, error: errSuc } = await supabase
        .from('sucursales')
        .select('id, nombre, centum_sucursal_id')
        .eq('id', sucursal_id)
        .single()

      if (errSuc || !suc) return res.status(404).json({ error: 'Sucursal no encontrada' })
      sucursalFisicaId = suc.centum_sucursal_id
      sucursalParaGuardar = suc.id
      observaciones = `Retiro por sucursal: ${suc.nombre}`
    }

    // 5. Datos del pedido original para recrear
    const idCliente = pedidoOriginal.Cliente?.IdCliente
    if (!idCliente) return res.status(400).json({ error: 'El pedido no tiene cliente asociado en Centum' })

    const fechaEntregaFinal = fecha_entrega || (pedidoOriginal.FechaEntrega ? pedidoOriginal.FechaEntrega.split('T')[0] : new Date().toISOString().split('T')[0])

    // 6. PRIMERO crear el nuevo pedido (si falla, el viejo queda intacto)
    const nuevoResultado = await crearPedidoVentaCompletoCentum({
      idCliente,
      fechaEntrega: fechaEntregaFinal,
      observaciones,
      sucursalFisicaId,
      articulos,
      bonificacion: pedidoOriginal.Bonificacion || null,
      vendedor: pedidoOriginal.Vendedor || null,
      turnoEntrega: pedidoOriginal.TurnoEntrega || null,
      condicionVenta: pedidoOriginal.CondicionVenta || null,
      transporte: pedidoOriginal.Transporte || null,
    })

    const nuevoIdCentum = nuevoResultado.IdPedidoVenta || nuevoResultado.Id || null
    const nuevoNumDoc = formatNumeroDocumento(nuevoResultado.NumeroDocumento)

    // 7. LUEGO anular el viejo
    let pedidoAnulado = null
    try {
      pedidoAnulado = await anularPedidoCentum(idCentum)
    } catch (errAnular) {
      console.error(`[Delivery] Error anulando pedido ${idCentum} (nuevo ya creado: ${nuevoIdCentum}):`, errAnular.message)
      // El nuevo ya se creó, notificar pero no fallar
    }

    // 8. Actualizar registro local
    if (nuevoIdCentum) {
      // Actualizar el registro existente: apuntar al nuevo pedido de Centum
      const updateData = {
        id_pedido_centum: nuevoIdCentum,
        numero_documento: nuevoNumDoc,
        observaciones,
        direccion_entrega: tipo === 'delivery' ? direccionEntrega : null,
        fecha_entrega: fechaEntregaFinal,
        mp_link_pago: null,
        mp_preference_id: null,
      }
      if (sucursalParaGuardar) updateData.sucursal_id = sucursalParaGuardar

      await supabase
        .from('pedidos_delivery')
        .update(updateData)
        .eq('id_pedido_centum', idCentum)
    }

    res.json({
      mensaje: `Pedido editado. Nuevo: ${nuevoNumDoc || nuevoIdCentum}, Anulado: ${idCentum}`,
      pedido_nuevo: { id: nuevoIdCentum, numero_documento: nuevoNumDoc },
      pedido_anulado: { id: idCentum, anulado: !!pedidoAnulado },
    })
  } catch (err) {
    console.error('Error al editar pedido delivery:', err)
    if (err.message?.includes('no encontrado en Centum')) {
      return res.status(404).json({ error: 'Pedido no encontrado en Centum' })
    }
    if (err.message?.includes('Error al conectar con Centum')) {
      return res.status(502).json({ error: 'Error al conectar con Centum ERP' })
    }
    res.status(500).json({ error: 'Error al editar pedido: ' + err.message })
  }
})

// POST /api/delivery/:id/eliminar
// Admin: anular pedido en Centum + marcar como cancelado localmente
router.post('/:id/eliminar', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const idCentum = parseInt(req.params.id)
    if (isNaN(idCentum)) return res.status(400).json({ error: 'ID inválido' })

    // 1. Verificar que no esté ya anulado en Centum
    const pedidoCentum = await fetchPedidoCentum(idCentum)
    const anulado = pedidoCentum.Anulado === true || pedidoCentum.Anulado === 1
    const estados = pedidoCentum.PedidoVentaEstados || []
    const ultimoEstado = estados.length > 0 ? estados[estados.length - 1] : null
    const estadoNombre = ultimoEstado?.Estado?.Nombre || ultimoEstado?.Estado || ''
    const anuladoPorEstado = typeof estadoNombre === 'string' && estadoNombre.toLowerCase().includes('anulado')
    if (anulado || anuladoPorEstado) {
      return res.status(400).json({ error: 'El pedido ya está anulado en Centum' })
    }
    const suscriptoTotal = typeof estadoNombre === 'string' && estadoNombre.toLowerCase().includes('suscripto total')
    if (suscriptoTotal) {
      return res.status(400).json({ error: 'No se puede anular un pedido con estado "Suscripto Total"' })
    }

    // 2. Anular en Centum
    await anularPedidoCentum(idCentum)

    // 3. Actualizar registro local
    await supabase
      .from('pedidos_delivery')
      .update({ estado: 'cancelado', estado_centum: 'Anulado' })
      .eq('id_pedido_centum', idCentum)

    res.json({ mensaje: `Pedido ${formatNumeroDocumento(pedidoCentum.NumeroDocumento) || idCentum} anulado correctamente` })
  } catch (err) {
    console.error('Error al eliminar pedido delivery:', err)
    if (err.message?.includes('no encontrado en Centum')) {
      return res.status(404).json({ error: 'Pedido no encontrado en Centum' })
    }
    if (err.message?.includes('Error al conectar con Centum')) {
      return res.status(502).json({ error: 'Error al conectar con Centum ERP' })
    }
    res.status(500).json({ error: 'Error al anular pedido: ' + err.message })
  }
})

module.exports = router
