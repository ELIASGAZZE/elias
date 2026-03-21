// Rutas del módulo de traspasos entre sucursales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { ajusteStockNegativo, ajusteStockPositivo } = require('../services/centumAjusteStock')

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

router.get('/config', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('traspaso_config').select('*')
    if (error) throw error
    const config = {}
    for (const row of (data || [])) config[row.clave] = row.valor
    res.json(config)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/config', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const entries = Object.entries(req.body)
    for (const [clave, valor] of entries) {
      await supabase.from('traspaso_config').upsert({ clave, valor: String(valor) })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard', verificarAuth, async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0]

    const { data: ordenes } = await supabase
      .from('ordenes_traspaso')
      .select('estado, recibido_at')
      .not('estado', 'eq', 'cancelado')

    const all = ordenes || []
    const pendientes = all.filter(o => o.estado === 'borrador').length
    const en_preparacion = all.filter(o => o.estado === 'en_preparacion').length
    const preparados = all.filter(o => o.estado === 'preparado').length
    const despachados = all.filter(o => o.estado === 'despachado').length
    const recibidos_hoy = all.filter(o =>
      (o.estado === 'recibido' || o.estado === 'con_diferencia') &&
      o.recibido_at && o.recibido_at.startsWith(hoy)
    ).length

    res.json({ pendientes, en_preparacion, preparados, despachados, recibidos_hoy })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Órdenes CRUD
// ═══════════════════════════════════════════════════════════════

router.get('/ordenes', verificarAuth, async (req, res) => {
  try {
    const { estado, sucursal, desde, hasta } = req.query
    let query = supabase
      .from('ordenes_traspaso')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (estado) query = query.eq('estado', estado)
    if (sucursal) query = query.or(`sucursal_origen_id.eq.${sucursal},sucursal_destino_id.eq.${sucursal}`)
    if (desde) query = query.gte('created_at', desde)
    if (hasta) query = query.lte('created_at', hasta)

    const { data, error } = await query
    if (error) throw error

    // Enriquecer con nombres de sucursal
    const sucursalIds = new Set()
    for (const o of (data || [])) {
      sucursalIds.add(o.sucursal_origen_id)
      sucursalIds.add(o.sucursal_destino_id)
    }
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id, nombre')
      .in('id', [...sucursalIds].length > 0 ? [...sucursalIds] : ['_none_'])

    const sucMap = {}
    for (const s of (sucursales || [])) sucMap[s.id] = s.nombre

    const enriquecidas = (data || []).map(o => ({
      ...o,
      sucursal_origen_nombre: sucMap[o.sucursal_origen_id] || 'Desconocida',
      sucursal_destino_nombre: sucMap[o.sucursal_destino_id] || 'Desconocida',
    }))

    res.json(enriquecidas)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/ordenes/:id', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error) throw error

    // Traer canastos
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('orden_traspaso_id', req.params.id)
      .order('created_at')

    // Traer nombres de sucursal
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id, nombre')
      .in('id', [data.sucursal_origen_id, data.sucursal_destino_id])

    const sucMap = {}
    for (const s of (sucursales || [])) sucMap[s.id] = s.nombre

    res.json({
      ...data,
      canastos: canastos || [],
      sucursal_origen_nombre: sucMap[data.sucursal_origen_id] || 'Desconocida',
      sucursal_destino_nombre: sucMap[data.sucursal_destino_id] || 'Desconocida',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/ordenes', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { sucursal_origen_id, sucursal_destino_id, items, notas } = req.body
    if (!sucursal_origen_id || !sucursal_destino_id) {
      return res.status(400).json({ error: 'Sucursal origen y destino requeridas' })
    }
    if (sucursal_origen_id === sucursal_destino_id) {
      return res.status(400).json({ error: 'Origen y destino deben ser diferentes' })
    }

    // Generar número — contar órdenes existentes + 1 como fallback seguro
    let numero
    try {
      const { count } = await supabase.from('ordenes_traspaso').select('*', { count: 'exact', head: true })
      numero = `OT-${String((count || 0) + 1).padStart(6, '0')}`
    } catch {
      numero = `OT-${Date.now()}`
    }

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .insert({
        numero,
        sucursal_origen_id,
        sucursal_destino_id,
        items: items || [],
        notas,
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

router.put('/ordenes/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Solo editar borradores
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden || orden.estado !== 'borrador') {
      return res.status(400).json({ error: 'Solo se pueden editar órdenes en borrador' })
    }

    const { items, notas, sucursal_destino_id } = req.body
    const updates = { updated_at: new Date().toISOString() }
    if (items !== undefined) updates.items = items
    if (notas !== undefined) updates.notas = notas
    if (sucursal_destino_id !== undefined) updates.sucursal_destino_id = sucursal_destino_id

    const { data, error } = await supabase
      .from('ordenes_traspaso')
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

router.delete('/ordenes/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden || !['borrador', 'en_preparacion'].includes(orden.estado)) {
      return res.status(400).json({ error: 'Solo se pueden cancelar órdenes en borrador o en preparación' })
    }

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Transiciones de estado
// ═══════════════════════════════════════════════════════════════

router.put('/ordenes/:id/iniciar-preparacion', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'en_preparacion',
        preparado_por: req.usuario?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('estado', 'borrador')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(400).json({ error: 'Solo se puede iniciar preparación de órdenes en borrador' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/preparado', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Validar que todos los canastos estén cerrados
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('orden_traspaso_id', req.params.id)

    if (!canastos || canastos.length === 0) {
      return res.status(400).json({ error: 'Debe crear al menos un canasto antes de marcar como preparado' })
    }

    const noCerrados = canastos.filter(c => c.estado !== 'cerrado')
    if (noCerrados.length > 0) {
      return res.status(400).json({ error: `Hay ${noCerrados.length} canasto(s) sin cerrar` })
    }

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'preparado',
        preparado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('estado', 'en_preparacion')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(400).json({ error: 'La orden debe estar en preparación' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/despachar', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('id', req.params.id)
      .eq('estado', 'preparado')
      .single()

    if (!orden) return res.status(400).json({ error: 'La orden debe estar preparada para despachar' })

    // Ajuste negativo de stock en origen (stub)
    const resultado = await ajusteStockNegativo(
      orden.sucursal_origen_id,
      orden.items || [],
      orden.numero
    )

    // Actualizar canastos a despachado
    await supabase
      .from('traspaso_canastos')
      .update({ estado: 'despachado', updated_at: new Date().toISOString() })
      .eq('orden_traspaso_id', req.params.id)
      .eq('estado', 'cerrado')

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'despachado',
        despachado_por: req.usuario?.id,
        despachado_at: new Date().toISOString(),
        centum_ajuste_origen_id: resultado.ajusteId,
        centum_error: resultado.error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    // TODO: Push notification a operarios de sucursal destino

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/recibir', verificarAuth, async (req, res) => {
  try {
    // Validar que todos los canastos estén verificados
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('orden_traspaso_id', req.params.id)

    if (!canastos || canastos.length === 0) {
      return res.status(400).json({ error: 'No hay canastos para recibir' })
    }

    const estadosFinales = ['aprobado', 'con_diferencia']
    const noVerificados = canastos.filter(c => !estadosFinales.includes(c.estado))
    if (noVerificados.length > 0) {
      return res.status(400).json({ error: `Hay ${noVerificados.length} canasto(s) sin verificar` })
    }

    const hayDiferencias = canastos.some(c => c.estado === 'con_diferencia')

    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('id', req.params.id)
      .eq('estado', 'despachado')
      .single()

    if (!orden) return res.status(400).json({ error: 'La orden debe estar despachada para recibir' })

    // Ajuste positivo de stock en destino (stub)
    const resultado = await ajusteStockPositivo(
      orden.sucursal_destino_id,
      orden.items || [],
      orden.numero
    )

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: hayDiferencias ? 'con_diferencia' : 'recibido',
        recibido_por: req.usuario?.id,
        recibido_at: new Date().toISOString(),
        centum_ajuste_destino_id: resultado.ajusteId,
        centum_error: resultado.error ? (orden.centum_error ? orden.centum_error + ' | ' + resultado.error : resultado.error) : orden.centum_error,
        updated_at: new Date().toISOString(),
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

// ═══════════════════════════════════════════════════════════════
// Canastos
// ═══════════════════════════════════════════════════════════════

router.post('/ordenes/:id/canastos', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Validar que la orden esté en preparación
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden || orden.estado !== 'en_preparacion') {
      return res.status(400).json({ error: 'Solo se pueden crear canastos en órdenes en preparación' })
    }

    const { precinto, items } = req.body
    if (!precinto) return res.status(400).json({ error: 'Código de precinto requerido' })

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .insert({
        orden_traspaso_id: req.params.id,
        precinto,
        items: items || [],
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'en_preparacion') {
      return res.status(400).json({ error: 'Solo se pueden editar canastos en preparación' })
    }

    const { items, peso_origen, precinto } = req.body
    const updates = { updated_at: new Date().toISOString() }
    if (items !== undefined) updates.items = items
    if (peso_origen !== undefined) updates.peso_origen = peso_origen
    if (precinto !== undefined) updates.precinto = precinto

    const { data, error } = await supabase
      .from('traspaso_canastos')
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

router.put('/canastos/:id/cerrar', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'en_preparacion') {
      return res.status(400).json({ error: 'Solo se pueden cerrar canastos en preparación' })
    }

    if (!canasto.peso_origen) {
      return res.status(400).json({ error: 'Debe registrar el peso antes de cerrar el canasto' })
    }

    if (!canasto.items || canasto.items.length === 0) {
      return res.status(400).json({ error: 'El canasto debe tener al menos un artículo' })
    }

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({ estado: 'cerrado', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/:id/pesar-destino', verificarAuth, async (req, res) => {
  try {
    const { peso_destino } = req.body
    if (peso_destino === undefined || peso_destino === null) {
      return res.status(400).json({ error: 'peso_destino requerido' })
    }

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'despachado') {
      return res.status(400).json({ error: 'Solo se pueden pesar canastos despachados' })
    }

    // Obtener tolerancia
    const { data: configRows } = await supabase
      .from('traspaso_config')
      .select('valor')
      .eq('clave', 'tolerancia_peso_porcentaje')
      .single()

    const tolerancia = parseFloat(configRows?.valor || '2') / 100
    const pesoOrigen = parseFloat(canasto.peso_origen)
    const pesoDestino = parseFloat(peso_destino)
    const diferenciaPct = Math.abs(pesoDestino - pesoOrigen) / pesoOrigen

    let nuevoEstado
    if (diferenciaPct <= tolerancia) {
      nuevoEstado = 'aprobado'
    } else {
      nuevoEstado = 'verificacion_manual'
    }

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        peso_destino: pesoDestino,
        estado: nuevoEstado,
        verificado_por: req.usuario?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ...data, dentro_tolerancia: nuevoEstado === 'aprobado' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/:id/verificar', verificarAuth, async (req, res) => {
  try {
    const { diferencias } = req.body
    if (!diferencias) return res.status(400).json({ error: 'diferencias requeridas' })

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'verificacion_manual') {
      return res.status(400).json({ error: 'Solo se pueden verificar canastos en verificación manual' })
    }

    const hayDiferencias = diferencias.some(d => d.cantidad_esperada !== d.cantidad_real)

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        diferencias,
        estado: hayDiferencias ? 'con_diferencia' : 'aprobado',
        verificado_por: req.usuario?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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

router.delete('/canastos/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'en_preparacion') {
      return res.status(400).json({ error: 'Solo se pueden eliminar canastos en preparación' })
    }

    const { error } = await supabase
      .from('traspaso_canastos')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
