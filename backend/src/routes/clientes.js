// Rutas para gestión de clientes
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { fetchClientesCentum, crearClienteEnCentum } = require('../services/centumClientes')
const { registrarLlamada } = require('../services/apiLogger')

// GET /api/clientes
// Lista clientes con búsqueda y paginación
router.get('/', verificarAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const from = (page - 1) * limit
    const to = from + limit - 1
    const { buscar } = req.query

    let query = supabase
      .from('clientes')
      .select('*', { count: 'exact' })
      .eq('activo', true)
      .order('razon_social', { ascending: true })
      .range(from, to)

    if (buscar && buscar.trim()) {
      const termino = buscar.trim()
      const soloDigitos = termino.replace(/\D/g, '')
      const esNumerico = /^\d[\d\-\s]*$/.test(termino) && soloDigitos.length >= 3

      if (esNumerico) {
        // Búsqueda por CUIT/DNI: usar ilike con el patrón numérico
        // También buscar sin guiones para matchear ambos formatos
        const conGuiones = soloDigitos.length === 11
          ? `${soloDigitos.slice(0,2)}-${soloDigitos.slice(2,10)}-${soloDigitos.slice(10)}`
          : null

        let orFilter = `cuit.ilike.%${soloDigitos}%`
        if (conGuiones) orFilter += `,cuit.ilike.%${conGuiones}%`
        // También agregar el término original por si tiene guiones
        if (termino !== soloDigitos) orFilter += `,cuit.ilike.%${termino}%`

        const cuitQuery = supabase
          .from('clientes')
          .select('*', { count: 'exact' })
          .eq('activo', true)
          .or(orFilter)
          .order('razon_social', { ascending: true })
          .range(from, to)

        const { data: cuitData, error: cuitError, count: cuitCount } = await cuitQuery
        if (cuitError) throw cuitError

        return res.json({ clientes: cuitData, total: cuitCount })
      }

      // Búsqueda por texto (razon_social, codigo, cuit)
      query = query.or(`razon_social.ilike.%${termino}%,codigo.ilike.%${termino}%,cuit.ilike.%${termino}%`)
    }

    const { data, error, count } = await query
    if (error) throw error

    res.json({ clientes: data, total: count })
  } catch (err) {
    console.error('Error al obtener clientes:', err)
    res.status(500).json({ error: 'Error al obtener clientes' })
  }
})

// GET /api/clientes/:id
// Detalle de un cliente
router.get('/:id', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Cliente no encontrado' })
    }

    res.json(data)
  } catch (err) {
    console.error('Error al obtener cliente:', err)
    res.status(500).json({ error: 'Error al obtener cliente' })
  }
})

// POST /api/clientes
// Crear cliente local (código auto-generado CLI-0001)
router.post('/', verificarAuth, async (req, res) => {
  try {
    const { razon_social, cuit, direccion, localidad, codigo_postal, provincia, telefono } = req.body

    if (!razon_social || !razon_social.trim()) {
      return res.status(400).json({ error: 'La razón social es requerida' })
    }

    // Generar código auto-incremental CLI-0001
    const { data: ultimo } = await supabase
      .from('clientes')
      .select('codigo')
      .like('codigo', 'CLI-%')
      .order('codigo', { ascending: false })
      .limit(1)

    let siguiente = 1
    if (ultimo && ultimo.length > 0) {
      const match = ultimo[0].codigo.match(/CLI-(\d+)/)
      if (match) siguiente = parseInt(match[1]) + 1
    }
    const codigo = `CLI-${String(siguiente).padStart(4, '0')}`

    const { data, error } = await supabase
      .from('clientes')
      .insert({
        codigo,
        razon_social: razon_social.trim(),
        cuit: cuit?.trim() || null,
        direccion: direccion?.trim() || null,
        localidad: localidad?.trim() || null,
        codigo_postal: codigo_postal?.trim() || null,
        provincia: provincia?.trim() || null,
        telefono: telefono?.trim() || null,
        activo: true,
      })
      .select()
      .single()

    if (error) throw error

    // Auto-exportar a Centum ERP
    try {
      const resultado = await crearClienteEnCentum(data)
      const idCentum = resultado.IdCliente || resultado.Id || null
      if (idCentum) {
        const { data: actualizado } = await supabase
          .from('clientes')
          .update({ id_centum: idCentum })
          .eq('id', data.id)
          .select()
          .single()
        return res.status(201).json(actualizado || data)
      }
    } catch (errCentum) {
      console.warn('No se pudo exportar cliente a Centum (se creó solo local):', errCentum.message)
    }

    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear cliente:', err)
    res.status(500).json({ error: 'Error al crear cliente' })
  }
})

// PUT /api/clientes/:id
// Editar cliente
router.put('/:id', verificarAuth, async (req, res) => {
  try {
    const { razon_social, cuit, direccion, localidad, codigo_postal, provincia, telefono, activo } = req.body

    const updates = {}
    if (razon_social !== undefined) updates.razon_social = razon_social.trim()
    if (cuit !== undefined) updates.cuit = cuit?.trim() || null
    if (direccion !== undefined) updates.direccion = direccion?.trim() || null
    if (localidad !== undefined) updates.localidad = localidad?.trim() || null
    if (codigo_postal !== undefined) updates.codigo_postal = codigo_postal?.trim() || null
    if (provincia !== undefined) updates.provincia = provincia?.trim() || null
    if (telefono !== undefined) updates.telefono = telefono?.trim() || null
    if (activo !== undefined) updates.activo = activo

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('clientes')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al actualizar cliente:', err)
    res.status(500).json({ error: 'Error al actualizar cliente' })
  }
})

// POST /api/clientes/sincronizar-centum
// Admin: importar todos los clientes desde Centum (upsert por codigo)
router.post('/sincronizar-centum', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const PAGE_SIZE = 500
    const BATCH_SIZE = 500
    let pagina = 1
    let totalImportados = 0
    const inicio = Date.now()

    while (true) {
      const { items, total } = await fetchClientesCentum(pagina, PAGE_SIZE)

      if (items.length === 0) break

      // Mapear campos del ERP a nuestro schema
      const clientesMapeados = items.map(c => ({
        codigo: c.Codigo != null ? String(c.Codigo).trim() : '',
        razon_social: c.RazonSocial || c.Nombre || 'Sin nombre',
        cuit: c.CUIT || null,
        direccion: c.Direccion || null,
        localidad: c.Localidad || null,
        codigo_postal: c.CodigoPostal || null,
        provincia: c.Provincia || null,
        telefono: c.Telefono || null,
        id_centum: c.IdCliente || c.Id || null,
        activo: true,
      })).filter(c => c.codigo) // Filtrar clientes sin código

      // Upsert en lotes
      for (let i = 0; i < clientesMapeados.length; i += BATCH_SIZE) {
        const lote = clientesMapeados.slice(i, i + BATCH_SIZE)
        const { error } = await supabase
          .from('clientes')
          .upsert(lote, { onConflict: 'codigo' })

        if (error) throw error
        totalImportados += lote.length
      }

      console.log(`[Clientes] Página ${pagina}: ${items.length} items (acumulado: ${totalImportados}/${total})`)

      if (items.length < PAGE_SIZE) break
      pagina++
    }

    registrarLlamada({
      servicio: 'centum_clientes', endpoint: 'sincronizar', metodo: 'GET',
      estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
      items_procesados: totalImportados, origen: 'manual',
    })

    res.json({
      mensaje: `${totalImportados} clientes sincronizados desde Centum`,
      cantidad: totalImportados,
    })
  } catch (err) {
    console.error('Error al sincronizar clientes:', err)
    res.status(500).json({ error: 'Error al sincronizar clientes desde Centum' })
  }
})

// POST /api/clientes/:id/exportar-centum
// Admin: exportar un cliente local a Centum
router.post('/:id/exportar-centum', verificarAuth, soloAdmin, async (req, res) => {
  try {
    // Obtener cliente local
    const { data: cliente, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error || !cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' })
    }

    if (cliente.id_centum) {
      return res.status(400).json({ error: 'Este cliente ya existe en Centum' })
    }

    // Crear en Centum
    const resultado = await crearClienteEnCentum(cliente)

    // Actualizar id_centum en BD local
    const idCentum = resultado.IdCliente || resultado.Id || null
    if (idCentum) {
      await supabase
        .from('clientes')
        .update({ id_centum: idCentum })
        .eq('id', cliente.id)
    }

    res.json({
      mensaje: 'Cliente exportado a Centum correctamente',
      id_centum: idCentum,
    })
  } catch (err) {
    console.error('Error al exportar cliente a Centum:', err)
    res.status(500).json({ error: 'Error al exportar cliente a Centum' })
  }
})

module.exports = router
