// Rutas para gestión de pedidos
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const webpush = require('web-push')

// Configurar web-push con VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@padanosrl.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

// Envía push notification a todos los admins suscriptos (fire-and-forget)
async function notificarAdmins(titulo, cuerpo) {
  try {
    // Buscar suscripciones de usuarios con rol admin
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, perfil_id, perfiles(rol)')
      .eq('perfiles.rol', 'admin')

    if (error || !subs) return

    const adminSubs = subs.filter(s => s.perfiles?.rol === 'admin')

    const payload = JSON.stringify({ title: titulo, body: cuerpo })

    for (const sub of adminSubs) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }
      webpush.sendNotification(pushSub, payload).catch(async (err) => {
        // Si la suscripción expiró o es inválida, la eliminamos
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
      })
    }
  } catch (err) {
    console.error('Error al notificar admins:', err)
  }
}

// GET /api/pedidos
// Todos los usuarios ven todos los pedidos, con filtros opcionales
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { sucursal_id, estado, fecha_desde, fecha_hasta, usuario_id } = req.query

    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 15
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from('pedidos')
      .select(`
        id, nombre, fecha, estado, tipo, created_at,
        sucursales(id, nombre),
        perfiles(id, nombre),
        items_pedido(cantidad, articulos(id, codigo, nombre))
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    // Filtros opcionales
    if (sucursal_id) query = query.eq('sucursal_id', sucursal_id)
    if (estado) query = query.eq('estado', estado)
    if (usuario_id) query = query.eq('usuario_id', usuario_id)
    if (fecha_desde) query = query.gte('fecha', fecha_desde)
    if (fecha_hasta) query = query.lte('fecha', fecha_hasta)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ pedidos: data, total: count })
  } catch (err) {
    console.error('Error al obtener pedidos:', err)
    res.status(500).json({ error: 'Error al obtener pedidos' })
  }
})

// GET /api/pedidos/check-pendiente
// Verifica si el usuario ya tiene un pedido pendiente para una sucursal
router.get('/check-pendiente', verificarAuth, async (req, res) => {
  try {
    const { sucursal_id } = req.query
    if (!sucursal_id) {
      return res.status(400).json({ error: 'sucursal_id es requerido' })
    }

    const { data, error } = await supabase
      .from('pedidos')
      .select('id')
      .eq('sucursal_id', sucursal_id)
      .eq('usuario_id', req.perfil.id)
      .eq('estado', 'pendiente')
      .limit(1)

    if (error) throw error

    res.json({ tiene_pendiente: data.length > 0 })
  } catch (err) {
    console.error('Error al verificar pedido pendiente:', err)
    res.status(500).json({ error: 'Error al verificar pedido pendiente' })
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
        id, nombre, fecha, estado, tipo, created_at, usuario_id,
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
    const { items, sucursal_id, nombre, tipo } = req.body // items: [{ articulo_id, cantidad }]

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

    // Verificar que no exista pedido pendiente para esta sucursal/usuario
    const { data: pendientes, error: errPend } = await supabase
      .from('pedidos')
      .select('id')
      .eq('sucursal_id', sucursal_id)
      .eq('usuario_id', req.perfil.id)
      .eq('estado', 'pendiente')
      .limit(1)

    if (errPend) throw errPend

    if (pendientes.length > 0) {
      return res.status(409).json({ error: 'Ya tenés un pedido pendiente para esta sucursal. Esperá a que se procese antes de crear otro.' })
    }

    // Creamos el pedido
    const pedidoData = {
      sucursal_id,
      usuario_id: req.perfil.id,
      fecha: new Date().toISOString().split('T')[0], // solo la fecha YYYY-MM-DD
      estado: 'pendiente',
    }
    if (nombre && nombre.trim()) pedidoData.nombre = nombre.trim()
    if (tipo === 'extraordinario') pedidoData.tipo = 'extraordinario'

    const { data: pedido, error: errorPedido } = await supabase
      .from('pedidos')
      .insert(pedidoData)
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

    // Notificar admins vía push (fire-and-forget)
    const sucNombre = await supabase.from('sucursales').select('nombre').eq('id', sucursal_id).single()
    const nombreSuc = sucNombre.data?.nombre || 'una sucursal'
    notificarAdmins(
      'Nuevo pedido recibido',
      `${req.perfil.nombre || 'Un operario'} creó un pedido desde ${nombreSuc}`
    )

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

    const estadosValidos = ['pendiente', 'cargado_en_centum', 'cancelado']
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
      const estadosValidos = ['pendiente', 'cargado_en_centum', 'cancelado']
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

// GET /api/pedidos/:id/txt
// Admin: descarga solo artículos ERP (automatico) como TXT "codigo cantidad"
router.get('/:id/txt', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await supabase
      .from('items_pedido')
      .select('cantidad, articulos(codigo, tipo)')
      .eq('pedido_id', id)

    if (error) throw error

    const erp = data.filter(item => item.articulos.tipo === 'automatico')
    const lineas = erp.map(item => `${item.articulos.codigo}\t${item.cantidad}`)
    const txt = lineas.join('\n')

    // Auto-cambiar estado a cargado_en_centum si está pendiente
    await supabase.from('pedidos').update({ estado: 'cargado_en_centum' }).eq('id', id).eq('estado', 'pendiente')

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="pedido-${id}.txt"`)
    res.send(txt)
  } catch (err) {
    console.error('Error al generar TXT:', err)
    res.status(500).json({ error: 'Error al generar TXT' })
  }
})

// GET /api/pedidos/:id/pdf
// Admin: descarga PDF solo con artículos manuales del pedido
const PDFDocument = require('pdfkit')

router.get('/:id/pdf', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { data: pedido, error: errPedido } = await supabase
      .from('pedidos')
      .select('id, nombre, fecha, sucursales(nombre), perfiles(nombre)')
      .eq('id', id)
      .single()

    if (errPedido) throw errPedido

    const { data: items, error: errItems } = await supabase
      .from('items_pedido')
      .select('cantidad, articulos(codigo, nombre, tipo)')
      .eq('pedido_id', id)

    if (errItems) throw errItems

    const manuales = items.filter(item => item.articulos.tipo === 'manual')

    if (manuales.length === 0) {
      return res.status(404).json({ error: 'Este pedido no tiene artículos manuales' })
    }

    // Auto-cambiar estado a cargado_en_centum si está pendiente
    await supabase.from('pedidos').update({ estado: 'cargado_en_centum' }).eq('id', id).eq('estado', 'pendiente')

    const doc = new PDFDocument({ size: 'A4', margin: 40 })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="pedido-manual-${id}.pdf"`)
    doc.pipe(res)

    // Encabezado
    doc.fontSize(18).text('Pedido - Artículos Manuales', { align: 'center' })
    doc.moveDown(0.5)

    if (pedido.nombre) {
      doc.fontSize(14).text(pedido.nombre, { align: 'center' })
      doc.moveDown(0.3)
    }

    doc.fontSize(10).fillColor('#666')
    doc.text(`Sucursal: ${pedido.sucursales?.nombre || '—'}    Fecha: ${pedido.fecha}    Creado por: ${pedido.perfiles?.nombre || '—'}`, { align: 'center' })
    doc.moveDown(1)

    // Tabla
    const colCodigo = 40
    const colNombre = 120
    const colCant = 480

    doc.fillColor('#333').fontSize(10).font('Helvetica-Bold')
    doc.text('Código', colCodigo, doc.y)
    doc.text('Artículo', colNombre, doc.y - 12)
    doc.text('Cant.', colCant, doc.y - 12)
    doc.moveDown(0.3)

    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ccc').stroke()
    doc.moveDown(0.3)

    doc.font('Helvetica').fontSize(10).fillColor('#000')
    manuales.forEach(item => {
      const y = doc.y
      doc.text(item.articulos.codigo, colCodigo, y)
      doc.text(item.articulos.nombre, colNombre, y, { width: 340 })
      doc.text(String(item.cantidad), colCant, y)
      doc.moveDown(0.2)
    })

    doc.end()
  } catch (err) {
    console.error('Error al generar PDF:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar PDF' })
    }
  }
})

module.exports = router
