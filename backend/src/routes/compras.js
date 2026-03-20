// Rutas del módulo de compras
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { calcularDemanda, dashboardCompras } = require('../services/demandaCompras')
const { analizarDemandaProveedor, generarOrdenSugerida, chatCompras } = require('../services/claudeCompras')

// Todas las rutas requieren auth + admin
router.use(verificarAuth, soloAdmin)

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard', async (req, res) => {
  try {
    const dashboard = await dashboardCompras()
    res.json(dashboard)
  } catch (err) {
    console.error('Error en dashboard compras:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Proveedores
// ═══════════════════════════════════════════════════════════════

router.get('/proveedores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('proveedores')
      .select('*, proveedor_articulos(count)')
      .order('nombre')

    if (error) throw error

    const proveedores = (data || []).map(p => ({
      ...p,
      total_articulos: p.proveedor_articulos?.[0]?.count || 0,
      proveedor_articulos: undefined,
    }))

    res.json(proveedores)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/proveedores/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/proveedores', async (req, res) => {
  try {
    const { nombre, cuit, codigo, lead_time_dias, lead_time_variabilidad_dias, dias_pedido, contacto, telefono, email, whatsapp, monto_minimo, notas } = req.body
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' })

    const { data, error } = await supabase
      .from('proveedores')
      .insert({
        nombre, cuit, codigo, lead_time_dias, lead_time_variabilidad_dias,
        dias_pedido: dias_pedido || [], contacto, telefono, email, whatsapp,
        monto_minimo: monto_minimo || 0, notas,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/proveedores/:id', async (req, res) => {
  try {
    const { nombre, cuit, codigo, lead_time_dias, lead_time_variabilidad_dias, dias_pedido, contacto, telefono, email, whatsapp, monto_minimo, notas, activo } = req.body

    const { data, error } = await supabase
      .from('proveedores')
      .update({
        nombre, cuit, codigo, lead_time_dias, lead_time_variabilidad_dias,
        dias_pedido, contacto, telefono, email, whatsapp,
        monto_minimo, notas, activo, updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Artículos del proveedor ─────────────────────────────────

router.get('/proveedores/:id/articulos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('proveedor_articulos')
      .select('*')
      .eq('proveedor_id', req.params.id)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Enriquecer con datos del artículo local
    const articuloIds = data.map(pa => pa.articulo_id)
    const { data: articulos } = await supabase
      .from('articulos')
      .select('id, nombre, codigo, id_centum, stock_actual, precio_venta')
      .in('id', articuloIds.length > 0 ? articuloIds : ['_none_'])

    const artMap = {}
    for (const a of (articulos || [])) artMap[a.id] = a

    const enriquecidos = data.map(pa => ({
      ...pa,
      articulo: artMap[pa.articulo_id] || null,
    }))

    res.json(enriquecidos)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/proveedores/:id/articulos', async (req, res) => {
  try {
    const { articulo_id, unidad_compra, factor_conversion, codigo_proveedor, precio_compra, es_principal } = req.body
    if (!articulo_id) return res.status(400).json({ error: 'articulo_id requerido' })

    const { data, error } = await supabase
      .from('proveedor_articulos')
      .insert({
        proveedor_id: req.params.id,
        articulo_id, unidad_compra, factor_conversion: factor_conversion || 1,
        codigo_proveedor, precio_compra, es_principal: es_principal || false,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Este artículo ya está vinculado al proveedor' })
      throw error
    }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/proveedor-articulos/:id', async (req, res) => {
  try {
    const { unidad_compra, factor_conversion, codigo_proveedor, precio_compra, es_principal } = req.body
    const { data, error } = await supabase
      .from('proveedor_articulos')
      .update({ unidad_compra, factor_conversion, codigo_proveedor, precio_compra, es_principal, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/proveedor-articulos/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('proveedor_articulos')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Promociones proveedor
// ═══════════════════════════════════════════════════════════════

router.get('/proveedores/:id/promociones', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('proveedor_promociones')
      .select('*')
      .eq('proveedor_id', req.params.id)
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/proveedores/:id/promociones', async (req, res) => {
  try {
    const { articulo_id, tipo, cantidad_minima, cantidad_bonus, descuento_porcentaje, precio_especial, descripcion, vigente_desde, vigente_hasta } = req.body
    if (!tipo) return res.status(400).json({ error: 'tipo requerido' })

    const { data, error } = await supabase
      .from('proveedor_promociones')
      .insert({
        proveedor_id: req.params.id,
        articulo_id, tipo, cantidad_minima, cantidad_bonus,
        descuento_porcentaje, precio_especial, descripcion,
        vigente_desde, vigente_hasta,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/proveedor-promociones/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('proveedor_promociones')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/proveedor-promociones/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('proveedor_promociones')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Órdenes de compra
// ═══════════════════════════════════════════════════════════════

router.get('/ordenes', async (req, res) => {
  try {
    const { estado, proveedor_id, desde, hasta } = req.query
    let query = supabase
      .from('ordenes_compra')
      .select('*, proveedores(nombre)')
      .order('created_at', { ascending: false })
      .limit(50)

    if (estado) query = query.eq('estado', estado)
    if (proveedor_id) query = query.eq('proveedor_id', proveedor_id)
    if (desde) query = query.gte('created_at', desde)
    if (hasta) query = query.lte('created_at', hasta)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/ordenes/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .select('*, proveedores(*)')
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/ordenes', async (req, res) => {
  try {
    const { proveedor_id, items, notas, fecha_entrega_esperada, metodo_envio, analisis_ia_id } = req.body
    if (!proveedor_id) return res.status(400).json({ error: 'proveedor_id requerido' })

    // Generar número
    const { data: seq } = await supabase.rpc('nextval', { seq_name: 'ordenes_compra_numero_seq' }).single()
    const numero = `OC-${String(seq || Date.now()).padStart(6, '0')}`

    const itemsArr = items || []
    const total = itemsArr.reduce((s, i) => s + (i.subtotal || 0), 0)

    const { data, error } = await supabase
      .from('ordenes_compra')
      .insert({
        numero, proveedor_id, items: itemsArr, subtotal: total, total,
        notas, fecha_entrega_esperada, metodo_envio, analisis_ia_id,
        creado_por: req.usuario?.id,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    // Fallback para número si la secuencia no existe
    if (err.message?.includes('nextval')) {
      try {
        const { proveedor_id, items, notas, fecha_entrega_esperada, metodo_envio, analisis_ia_id } = req.body
        const numero = `OC-${Date.now()}`
        const itemsArr = items || []
        const total = itemsArr.reduce((s, i) => s + (i.subtotal || 0), 0)

        const { data, error } = await supabase
          .from('ordenes_compra')
          .insert({
            numero, proveedor_id, items: itemsArr, subtotal: total, total,
            notas, fecha_entrega_esperada, metodo_envio, analisis_ia_id,
            creado_por: req.usuario?.id,
          })
          .select()
          .single()

        if (error) throw error
        return res.json(data)
      } catch (err2) {
        return res.status(500).json({ error: err2.message })
      }
    }
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id', async (req, res) => {
  try {
    const { items, notas, fecha_entrega_esperada, metodo_envio } = req.body
    const updates = { updated_at: new Date().toISOString() }
    if (items !== undefined) {
      updates.items = items
      updates.total = items.reduce((s, i) => s + (i.subtotal || 0), 0)
      updates.subtotal = updates.total
    }
    if (notas !== undefined) updates.notas = notas
    if (fecha_entrega_esperada !== undefined) updates.fecha_entrega_esperada = fecha_entrega_esperada
    if (metodo_envio !== undefined) updates.metodo_envio = metodo_envio

    const { data, error } = await supabase
      .from('ordenes_compra')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/enviar', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .update({ estado: 'enviada', enviado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('estado', 'borrador')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(400).json({ error: 'Solo se pueden enviar órdenes en borrador' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/ordenes/:id', async (req, res) => {
  try {
    // Solo cancelar borradores
    const { data, error } = await supabase
      .from('ordenes_compra')
      .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('estado', 'borrador')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(400).json({ error: 'Solo se pueden cancelar órdenes en borrador' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// IA y demanda
// ═══════════════════════════════════════════════════════════════

router.get('/demanda/:proveedorId', async (req, res) => {
  try {
    const resultado = await analizarDemandaProveedor(req.params.proveedorId)
    res.json(resultado)
  } catch (err) {
    console.error('Error demanda:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/orden-sugerida/:proveedorId', async (req, res) => {
  try {
    const resultado = await generarOrdenSugerida(req.params.proveedorId)
    res.json(resultado)
  } catch (err) {
    console.error('Error orden sugerida:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/chat', async (req, res) => {
  try {
    const { mensaje, historial } = req.body
    if (!mensaje) return res.status(400).json({ error: 'mensaje requerido' })

    const respuesta = await chatCompras(mensaje, historial || [])
    res.json({ respuesta })
  } catch (err) {
    console.error('Error chat compras:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Aprendizaje
// ═══════════════════════════════════════════════════════════════

router.post('/ajustes', async (req, res) => {
  try {
    const { orden_compra_id, articulo_id, cantidad_sugerida, cantidad_final, motivo, nota } = req.body
    if (!articulo_id) return res.status(400).json({ error: 'articulo_id requerido' })

    const { data, error } = await supabase
      .from('compras_ajustes')
      .insert({
        orden_compra_id, articulo_id, cantidad_sugerida, cantidad_final,
        motivo, nota, ajustado_por: req.usuario?.id,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/reglas-ia', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compras_reglas_ia')
      .select('*')
      .eq('activa', true)
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/reglas-ia', async (req, res) => {
  try {
    const { regla, categoria, proveedor_id, articulo_id } = req.body
    if (!regla) return res.status(400).json({ error: 'regla requerida' })

    const { data, error } = await supabase
      .from('compras_reglas_ia')
      .insert({
        regla, categoria: categoria || 'general',
        proveedor_id, articulo_id,
        creado_por: req.usuario?.id,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/reglas-ia/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('compras_reglas_ia')
      .update({ activa: false })
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Consumo interno
// ═══════════════════════════════════════════════════════════════

router.get('/consumo-interno', async (req, res) => {
  try {
    const { desde, hasta, articulo_id } = req.query
    let query = supabase
      .from('consumo_interno')
      .select('*')
      .order('fecha', { ascending: false })
      .limit(100)

    if (desde) query = query.gte('fecha', desde)
    if (hasta) query = query.lte('fecha', hasta)
    if (articulo_id) query = query.eq('articulo_id', articulo_id)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/consumo-interno', async (req, res) => {
  try {
    const { articulo_id, cantidad, motivo, notas, sucursal_id, fecha } = req.body
    if (!articulo_id || !cantidad) return res.status(400).json({ error: 'articulo_id y cantidad requeridos' })

    const { data, error } = await supabase
      .from('consumo_interno')
      .insert({
        articulo_id, cantidad, motivo: motivo || 'otro',
        notas, sucursal_id, fecha: fecha || new Date().toISOString().split('T')[0],
        registrado_por: req.usuario?.id,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Pedidos extraordinarios
// ═══════════════════════════════════════════════════════════════

router.get('/pedidos-extraordinarios', async (req, res) => {
  try {
    const { estado } = req.query
    let query = supabase
      .from('pedidos_extraordinarios')
      .select('*')
      .order('fecha_necesaria', { ascending: true })

    if (estado) query = query.eq('estado', estado)
    else query = query.in('estado', ['pendiente', 'incluido_en_oc'])

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/pedidos-extraordinarios', async (req, res) => {
  try {
    const { articulo_id, articulo_nombre, cantidad, cliente_nombre, fecha_necesaria, notas } = req.body
    if (!cantidad) return res.status(400).json({ error: 'cantidad requerida' })

    const { data, error } = await supabase
      .from('pedidos_extraordinarios')
      .insert({
        articulo_id, articulo_nombre, cantidad, cliente_nombre,
        fecha_necesaria, notas, creado_por: req.usuario?.id,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/pedidos-extraordinarios/:id', async (req, res) => {
  try {
    const { estado, orden_compra_id } = req.body
    const { data, error } = await supabase
      .from('pedidos_extraordinarios')
      .update({ estado, orden_compra_id })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
