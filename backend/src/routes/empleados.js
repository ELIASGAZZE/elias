// Rutas para gestión de empleados
const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/empleados
// Operario/Gestor: solo empleados de su sucursal. Admin: todos (o filtrados por sucursal_id).
// Por defecto solo activo=true, salvo que se envíe ?todas=true
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { sucursal_id, todas, empresa } = req.query
    const { rol, sucursal_id: perfilSucursalId } = req.perfil

    let query = supabase
      .from('empleados')
      .select('*')
      .order('nombre')

    // Filtro por activo: por defecto solo activos
    if (todas !== 'true') {
      query = query.eq('activo', true)
    }

    // Filtro por empresa
    if (empresa) {
      query = query.eq('empresa', empresa)
    }

    const { data, error } = await query

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener empleados:', err)
    res.status(500).json({ error: 'Error al obtener empleados' })
  }
})

// GET /api/empleados/por-codigo/:codigo
// Busca empleado activo por código. Devuelve id + nombre + sucursal_id + tope/consumido mes.
router.get('/por-codigo/:codigo', verificarAuth, async (req, res) => {
  try {
    const { codigo } = req.params
    const { data, error } = await supabase
      .from('empleados')
      .select('id, nombre, sucursal_id, tope_mensual')
      .eq('codigo', codigo)
      .eq('activo', true)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Empleado no encontrado o inactivo' })
    }

    // Calcular consumido del mes actual
    const ahora = new Date()
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()
    const finMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59).toISOString()

    const { data: ventasMes } = await supabase
      .from('ventas_empleados')
      .select('total')
      .eq('empleado_id', data.id)
      .gte('created_at', inicioMes)
      .lte('created_at', finMes)

    const consumido_mes = (ventasMes || []).reduce((s, v) => s + (v.total || 0), 0)
    const disponible = data.tope_mensual != null ? Math.max(0, data.tope_mensual - consumido_mes) : null

    res.json({ ...data, consumido_mes, disponible })
  } catch (err) {
    console.error('Error al buscar empleado por código:', err)
    res.status(500).json({ error: 'Error al buscar empleado' })
  }
})

// POST /api/empleados
// Admin: crea un nuevo empleado
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, sucursal_id, codigo, fecha_cumpleanos, empresa } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del empleado es requerido' })
    }

    if (!codigo || !codigo.trim()) {
      return res.status(400).json({ error: 'El código del empleado es requerido' })
    }

    const insert = { nombre: nombre.trim(), codigo: codigo.trim() }
    if (sucursal_id) insert.sucursal_id = sucursal_id
    if (empresa) insert.empresa = empresa.toLowerCase()
    if (fecha_cumpleanos !== undefined) insert.fecha_cumpleanos = fecha_cumpleanos || null

    const { data, error } = await supabase
      .from('empleados')
      .insert(insert)
      .select('*, sucursales(id, nombre)')
      .single()

    if (error) {
      if (error.code === '23505' && error.message.includes('codigo')) {
        return res.status(409).json({ error: 'Ya existe un empleado con ese código' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear empleado:', err)
    res.status(500).json({ error: 'Error al crear empleado' })
  }
})

// PUT /api/empleados/:id
// Admin: edita nombre, sucursal_id, activo. Solo actualiza campos enviados.
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, sucursal_id, activo, codigo, fecha_cumpleanos, empresa } = req.body

    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (sucursal_id !== undefined) updates.sucursal_id = sucursal_id
    if (activo !== undefined) updates.activo = activo
    if (codigo !== undefined) updates.codigo = codigo.trim()
    if (empresa !== undefined) updates.empresa = empresa.toLowerCase()
    if (fecha_cumpleanos !== undefined) updates.fecha_cumpleanos = fecha_cumpleanos || null

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('empleados')
      .update(updates)
      .eq('id', id)
      .select('*, sucursales(id, nombre)')
      .single()

    if (error) {
      if (error.code === '23505' && error.message.includes('codigo')) {
        return res.status(409).json({ error: 'Ya existe un empleado con ese código' })
      }
      throw error
    }
    res.json(data)
  } catch (err) {
    console.error('Error al editar empleado:', err)
    res.status(500).json({ error: 'Error al editar empleado' })
  }
})

// DELETE /api/empleados/:id
// Admin: elimina un empleado
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('empleados')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Empleado eliminado correctamente' })
  } catch (err) {
    console.error('Error al eliminar empleado:', err)
    res.status(500).json({ error: 'Error al eliminar empleado' })
  }
})

// ── PIN de fichaje ──────────────────────────────────────────────────────────

// POST /api/empleados/:id/pin — Asignar/cambiar PIN (admin)
router.post('/:id/pin', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { pin, temporal } = req.body

    if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      return res.status(400).json({ error: 'El PIN debe ser de 4-6 dígitos numéricos' })
    }

    // Verificar que el PIN no esté en uso por otro empleado
    const { data: empleados } = await supabase
      .from('empleados')
      .select('id, pin_fichaje')
      .eq('activo', true)
      .not('pin_fichaje', 'is', null)
      .neq('id', id)

    for (const emp of (empleados || [])) {
      const match = await bcrypt.compare(pin, emp.pin_fichaje)
      if (match) {
        return res.status(409).json({ error: 'Ese PIN ya está en uso por otro empleado' })
      }
    }

    const hash = await bcrypt.hash(pin, 10)

    const { data, error } = await supabase
      .from('empleados')
      .update({ pin_fichaje: hash, pin_fichaje_temp: temporal === true })
      .eq('id', id)
      .select('id, nombre, pin_fichaje_temp')
      .single()

    if (error) throw error
    res.json({ ...data, mensaje: 'PIN asignado correctamente' })
  } catch (err) {
    console.error('Error al asignar PIN:', err)
    res.status(500).json({ error: 'Error al asignar PIN' })
  }
})

// POST /api/empleados/cambiar-pin — Empleado cambia su propio PIN
router.post('/cambiar-pin', async (req, res) => {
  try {
    const { empleado_id, pin_actual, pin_nuevo } = req.body

    if (!empleado_id || !pin_actual || !pin_nuevo) {
      return res.status(400).json({ error: 'empleado_id, pin_actual y pin_nuevo son requeridos' })
    }

    if (pin_nuevo.length < 4 || pin_nuevo.length > 6 || !/^\d+$/.test(pin_nuevo)) {
      return res.status(400).json({ error: 'El PIN nuevo debe ser de 4-6 dígitos numéricos' })
    }

    // Verificar PIN actual
    const { data: emp, error: empError } = await supabase
      .from('empleados')
      .select('id, pin_fichaje')
      .eq('id', empleado_id)
      .single()

    if (empError || !emp || !emp.pin_fichaje) {
      return res.status(404).json({ error: 'Empleado no encontrado o sin PIN' })
    }

    const pinValido = await bcrypt.compare(pin_actual, emp.pin_fichaje)
    if (!pinValido) {
      return res.status(401).json({ error: 'PIN actual incorrecto' })
    }

    // Verificar que el nuevo PIN no esté en uso
    const { data: otrosEmpleados } = await supabase
      .from('empleados')
      .select('id, pin_fichaje')
      .eq('activo', true)
      .not('pin_fichaje', 'is', null)
      .neq('id', empleado_id)

    for (const otro of (otrosEmpleados || [])) {
      const match = await bcrypt.compare(pin_nuevo, otro.pin_fichaje)
      if (match) {
        return res.status(409).json({ error: 'Ese PIN ya está en uso por otro empleado' })
      }
    }

    const hash = await bcrypt.hash(pin_nuevo, 10)

    const { error } = await supabase
      .from('empleados')
      .update({ pin_fichaje: hash, pin_fichaje_temp: false })
      .eq('id', empleado_id)

    if (error) throw error
    res.json({ mensaje: 'PIN cambiado correctamente' })
  } catch (err) {
    console.error('Error al cambiar PIN:', err)
    res.status(500).json({ error: 'Error al cambiar PIN' })
  }
})

module.exports = router
