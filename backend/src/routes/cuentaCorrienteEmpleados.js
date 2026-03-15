// Rutas para cuenta corriente de empleados (retiros de mercadería + pagos)
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { registrarVentaPOSEnCentum } = require('../services/centumVentasPOS')

// ─── RUBROS DISPONIBLES (desde artículos) ──────────────────────────────────────

// GET /api/cuenta-empleados/rubros — lista rubros distintos de los artículos
router.get('/rubros', verificarAuth, async (req, res) => {
  try {
    const PAGE_SIZE = 1000
    const rubrosMap = {}
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('articulos')
        .select('rubro, rubro_id_centum')
        .eq('tipo', 'automatico')
        .gt('precio', 0)
        .not('rubro', 'is', null)
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw error
      if (!data || data.length === 0) break

      data.forEach(a => {
        if (a.rubro && !rubrosMap[a.rubro]) {
          rubrosMap[a.rubro] = { nombre: a.rubro, rubro_id_centum: a.rubro_id_centum }
        }
      })

      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const rubros = Object.values(rubrosMap).sort((a, b) => a.nombre.localeCompare(b.nombre))
    res.json(rubros)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── DESCUENTOS POR RUBRO (config, solo admin) ────────────────────────────────

// GET /api/cuenta-empleados/descuentos — listar descuentos por rubro
router.get('/descuentos', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('descuentos_empleados')
      .select('*')
      .order('rubro')

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/cuenta-empleados/descuentos — guardar descuentos (array completo)
router.post('/descuentos', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { descuentos } = req.body // [{ rubro, rubro_id_centum, porcentaje }]

    if (!Array.isArray(descuentos)) {
      return res.status(400).json({ error: 'descuentos debe ser un array' })
    }

    // Upsert cada rubro
    for (const d of descuentos) {
      const { error } = await supabase
        .from('descuentos_empleados')
        .upsert({
          rubro: d.rubro,
          rubro_id_centum: d.rubro_id_centum || null,
          porcentaje: parseFloat(d.porcentaje) || 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'rubro' })

      if (error) throw error
    }

    const { data } = await supabase
      .from('descuentos_empleados')
      .select('*')
      .order('rubro')

    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── TOPE MENSUAL POR EMPLEADO ─────────────────────────────────────────────────

// GET /api/cuenta-empleados/topes — listar empleados con su tope
router.get('/topes', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('empleados')
      .select('id, nombre, codigo, tope_mensual, sucursal_id, sucursales(id, nombre)')
      .eq('activo', true)
      .order('nombre')

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/cuenta-empleados/topes/:empleadoId — actualizar tope mensual
router.put('/topes/:empleadoId', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { tope_mensual } = req.body
    const { data, error } = await supabase
      .from('empleados')
      .update({ tope_mensual: tope_mensual != null ? parseFloat(tope_mensual) : null })
      .eq('id', req.params.empleadoId)
      .select('id, nombre, codigo, tope_mensual')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── VENTA A EMPLEADO (desde POS, cualquier cajero) ────────────────────────────

// POST /api/cuenta-empleados/ventas — registrar venta a cta cte
router.post('/ventas', verificarAuth, async (req, res) => {
  try {
    const { codigo_empleado, items, total, sucursal_id, caja_id } = req.body

    // Validar empleado por código
    const { data: empleado, error: empError } = await supabase
      .from('empleados')
      .select('id, nombre, codigo, tope_mensual')
      .eq('codigo', codigo_empleado)
      .eq('activo', true)
      .single()

    if (empError || !empleado) {
      return res.status(404).json({ error: 'Código de empleado inválido' })
    }

    // No permitir que el cajero se pase artículos a sí mismo
    if (req.perfil.nombre && empleado.nombre &&
        req.perfil.nombre.toLowerCase() === empleado.nombre.toLowerCase()) {
      return res.status(400).json({ error: 'No podés registrar un retiro para vos mismo' })
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debe haber al menos un artículo' })
    }

    // Validar tope mensual
    if (empleado.tope_mensual != null) {
      const ahora = new Date()
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()
      const finMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59).toISOString()

      const { data: ventasMes } = await supabase
        .from('ventas_empleados')
        .select('total')
        .eq('empleado_id', empleado.id)
        .gte('created_at', inicioMes)
        .lte('created_at', finMes)

      const consumidoMes = (ventasMes || []).reduce((s, v) => s + (v.total || 0), 0)

      if (consumidoMes + total > empleado.tope_mensual) {
        const disponible = Math.max(0, empleado.tope_mensual - consumidoMes)
        return res.status(400).json({
          error: `Supera el tope mensual. Disponible: $${disponible.toFixed(2)}`,
          disponible,
          consumido: consumidoMes,
          tope: empleado.tope_mensual,
        })
      }
    }

    // Determinar sucursal desde la caja
    let sucursalDeCaja = sucursal_id || null
    if (caja_id && !sucursalDeCaja) {
      const { data: cajaInfo } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_id).single()
      sucursalDeCaja = cajaInfo?.sucursal_id || null
    }

    // Guardar en ventas_empleados
    const { data: venta, error: ventaError } = await supabase
      .from('ventas_empleados')
      .insert({
        empleado_id: empleado.id,
        sucursal_id: sucursalDeCaja,
        cajero_id: req.perfil.id,
        items,
        total,
      })
      .select('*')
      .single()

    if (ventaError) throw ventaError

    // También guardar en ventas_pos para que aparezca en módulo Ventas
    const itemsPos = items.map(item => ({
      id_articulo: item.articulo_id,
      codigo: item.codigo,
      nombre: item.nombre,
      precio_unitario: item.precio_final,
      cantidad: item.cantidad,
      iva_tasa: item.iva_tasa || 21,
      rubro: item.rubro || null,
    }))

    const { data: ventaPos, error: ventaPosError } = await supabase
      .from('ventas_pos')
      .insert({
        cajero_id: req.perfil.id,
        sucursal_id: sucursalDeCaja,
        caja_id: caja_id || null,
        id_cliente_centum: null,
        nombre_cliente: `Empleado: ${empleado.nombre}`,
        subtotal: total,
        descuento_total: 0,
        total,
        monto_pagado: total,
        vuelto: 0,
        items: JSON.stringify(itemsPos),
        pagos: [{ tipo: 'cuenta_corriente', monto: total }],
      })
      .select()
      .single()

    if (ventaPosError) {
      console.error('Error guardando venta empleado en ventas_pos:', ventaPosError.message)
    }

    // Registrar en Centum async (no bloquea la respuesta)
    const ventaPosId = ventaPos?.id || null
    if (caja_id) {
      (async () => {
        try {
          const { data: caja } = await supabase
            .from('cajas')
            .select('id, punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
            .eq('id', caja_id)
            .single()

          const puntoVenta = caja?.punto_venta_centum
          const sucursalFisicaId = caja?.sucursales?.centum_sucursal_id

          if (!puntoVenta || !sucursalFisicaId) {
            const errorMsg = 'Sin config Centum para venta empleado'
            if (ventaPosId) await supabase.from('ventas_pos').update({ centum_error: errorMsg }).eq('id', ventaPosId)
            return
          }

          const ventaLocal = {
            items: items.map(item => ({
              id_centum: item.id_centum,
              codigo: item.codigo,
              nombre: item.nombre,
              cantidad: item.cantidad,
              precio: item.precio_final,
              iva_tasa: item.iva_tasa || 21,
              descuento1: 0, descuento2: 0, descuento3: 0,
            })),
            pagos: [{ tipo: 'cuenta_corriente', monto: total }],
            total,
            condicion_iva: 'CF',
            id_cliente_centum: null,
          }

          const resultado = await registrarVentaPOSEnCentum(ventaLocal, {
            sucursalFisicaId,
            puntoVenta,
            centum_operador_empresa: caja.sucursales.centum_operador_empresa,
            centum_operador_prueba: caja.sucursales.centum_operador_prueba,
          })

          if (resultado) {
            const numDoc = resultado.NumeroDocumento
            const comprobante = numDoc
              ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
              : null

            // Actualizar ventas_pos con datos de Centum
            if (ventaPosId) {
              await supabase.from('ventas_pos').update({
                id_venta_centum: resultado.IdVenta || null,
                centum_comprobante: comprobante,
                centum_sync: true,
                centum_error: null,
              }).eq('id', ventaPosId)
            }
            // Actualizar ventas_empleados con comprobante
            await supabase.from('ventas_empleados').update({
              comprobante_centum: comprobante || resultado.IdVenta || null,
            }).eq('id', venta.id)

            console.log(`[Centum] Venta empleado ${venta.id} registrada: IdVenta=${resultado.IdVenta}, Comprobante=${comprobante}`)
          } else {
            if (ventaPosId) await supabase.from('ventas_pos').update({ centum_error: 'Sin resultado de Centum' }).eq('id', ventaPosId)
          }
        } catch (centumErr) {
          console.error('Error registrando venta empleado en Centum (no bloquea):', centumErr.message)
          if (ventaPosId) await supabase.from('ventas_pos').update({ centum_error: centumErr.message }).eq('id', ventaPosId).catch(() => {})
        }
      })()
    }

    res.status(201).json({ ...venta, empleado })
  } catch (err) {
    console.error('Error al crear venta empleado:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── SALDOS Y CUENTA CORRIENTE (admin/gestor) ─────────────────────────────────

// GET /api/cuenta-empleados/saldos — resumen de todos los empleados
router.get('/saldos', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Traer empleados activos
    const { data: empleados, error } = await supabase
      .from('empleados')
      .select('id, nombre, codigo, tope_mensual, sucursal_id, sucursales(id, nombre)')
      .eq('activo', true)
      .order('nombre')

    if (error) throw error

    // Traer sumas de ventas y pagos
    const empIds = empleados.map(e => e.id)

    const { data: ventas } = await supabase
      .from('ventas_empleados')
      .select('empleado_id, total')
      .in('empleado_id', empIds)

    const { data: pagos } = await supabase
      .from('pagos_cuenta_empleados')
      .select('empleado_id, monto')
      .in('empleado_id', empIds)

    // Consumido este mes
    const ahora = new Date()
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()
    const finMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59).toISOString()

    const { data: ventasMes } = await supabase
      .from('ventas_empleados')
      .select('empleado_id, total')
      .in('empleado_id', empIds)
      .gte('created_at', inicioMes)
      .lte('created_at', finMes)

    // Calcular saldos
    const ventasMap = {}
    ;(ventas || []).forEach(v => {
      ventasMap[v.empleado_id] = (ventasMap[v.empleado_id] || 0) + (v.total || 0)
    })

    const pagosMap = {}
    ;(pagos || []).forEach(p => {
      pagosMap[p.empleado_id] = (pagosMap[p.empleado_id] || 0) + (p.monto || 0)
    })

    const ventasMesMap = {}
    ;(ventasMes || []).forEach(v => {
      ventasMesMap[v.empleado_id] = (ventasMesMap[v.empleado_id] || 0) + (v.total || 0)
    })

    const resultado = empleados.map(e => ({
      ...e,
      total_ventas: ventasMap[e.id] || 0,
      total_pagos: pagosMap[e.id] || 0,
      saldo: (ventasMap[e.id] || 0) - (pagosMap[e.id] || 0),
      consumido_mes: ventasMesMap[e.id] || 0,
    }))

    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/cuenta-empleados/:empleadoId/movimientos — detalle de movimientos
router.get('/:empleadoId/movimientos', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { empleadoId } = req.params

    const [ventasRes, pagosRes] = await Promise.all([
      supabase
        .from('ventas_empleados')
        .select('*, cajero:perfiles!cajero_id(id, nombre, username)')
        .eq('empleado_id', empleadoId)
        .order('created_at', { ascending: false }),
      supabase
        .from('pagos_cuenta_empleados')
        .select('*, registrado:perfiles!registrado_por(id, nombre, username)')
        .eq('empleado_id', empleadoId)
        .order('created_at', { ascending: false }),
    ])

    if (ventasRes.error) throw ventasRes.error
    if (pagosRes.error) throw pagosRes.error

    res.json({
      ventas: ventasRes.data || [],
      pagos: pagosRes.data || [],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/cuenta-empleados/:empleadoId/pagos — registrar pago/descuento de sueldo
router.post('/:empleadoId/pagos', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { monto, concepto } = req.body

    if (!monto || parseFloat(monto) <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' })
    }

    const { data, error } = await supabase
      .from('pagos_cuenta_empleados')
      .insert({
        empleado_id: req.params.empleadoId,
        monto: parseFloat(monto),
        concepto: concepto || '',
        registrado_por: req.perfil.id,
      })
      .select('*, registrado:perfiles!registrado_por(id, nombre, username)')
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
