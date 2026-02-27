// Rutas para gestión de empleados
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/empleados
// Operario/Gestor: solo empleados de su sucursal. Admin: todos (o filtrados por sucursal_id).
// Por defecto solo activo=true, salvo que se envíe ?todas=true
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { sucursal_id, todas } = req.query
    const { rol, sucursal_id: perfilSucursalId } = req.perfil

    let query = supabase
      .from('empleados')
      .select('*, sucursales(id, nombre)')
      .order('nombre')

    // Filtro por activo: por defecto solo activos
    if (todas !== 'true') {
      query = query.eq('activo', true)
    }

    // Operario/Gestor: solo su sucursal
    if (rol !== 'admin') {
      query = query.eq('sucursal_id', perfilSucursalId)
    } else if (sucursal_id) {
      // Admin con filtro opcional
      query = query.eq('sucursal_id', sucursal_id)
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
// Busca empleado activo por código. Devuelve id + nombre + sucursal_id. 404 si no existe o inactivo.
router.get('/por-codigo/:codigo', verificarAuth, async (req, res) => {
  try {
    const { codigo } = req.params
    const { data, error } = await supabase
      .from('empleados')
      .select('id, nombre, sucursal_id')
      .eq('codigo', codigo)
      .eq('activo', true)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Empleado no encontrado o inactivo' })
    }

    res.json(data)
  } catch (err) {
    console.error('Error al buscar empleado por código:', err)
    res.status(500).json({ error: 'Error al buscar empleado' })
  }
})

// POST /api/empleados
// Admin: crea un nuevo empleado
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, sucursal_id, codigo } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del empleado es requerido' })
    }

    if (!sucursal_id) {
      return res.status(400).json({ error: 'La sucursal es requerida' })
    }

    if (!codigo || !codigo.trim()) {
      return res.status(400).json({ error: 'El código del empleado es requerido' })
    }

    const { data, error } = await supabase
      .from('empleados')
      .insert({ nombre: nombre.trim(), sucursal_id, codigo: codigo.trim() })
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
    const { nombre, sucursal_id, activo, codigo } = req.body

    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (sucursal_id !== undefined) updates.sucursal_id = sucursal_id
    if (activo !== undefined) updates.activo = activo
    if (codigo !== undefined) updates.codigo = codigo.trim()

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

module.exports = router
