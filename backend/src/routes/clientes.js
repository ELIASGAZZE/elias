// Rutas para gestión de clientes
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { fetchClientesCentum, crearClienteEnCentum, actualizarClienteEnCentum, agregarContactoEnvioCentum } = require('../services/centumClientes')
const { registrarLlamada } = require('../services/apiLogger')
const { getPool } = require('../config/centum')
const sql = require('mssql')
const { consultarCUIT } = require('../services/afip')

// GET /api/clientes
// Lista clientes con búsqueda y paginación
router.get('/', verificarAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100)
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
      const soloDni = req.query.solo_dni === 'true'

      if (soloDni) {
        // Solo buscar por CUIT/DNI (usado en búsqueda de pedidos)
        if (soloDigitos.length < 3) {
          return res.json({ clientes: [], total: 0 })
        }
        const conGuiones = soloDigitos.length === 11
          ? `${soloDigitos.slice(0,2)}-${soloDigitos.slice(2,10)}-${soloDigitos.slice(10)}`
          : null

        let orFilter = `cuit.ilike.%${soloDigitos}%`
        if (conGuiones) orFilter += `,cuit.ilike.%${conGuiones}%`
        if (termino !== soloDigitos) orFilter += `,cuit.ilike.%${termino}%`

        const dniQuery = supabase
          .from('clientes')
          .select('*', { count: 'exact' })
          .eq('activo', true)
          .or(orFilter)
          .order('razon_social', { ascending: true })
          .range(from, to)

        const { data: dniData, error: dniError, count: dniCount } = await dniQuery
        if (dniError) throw dniError
        return res.json({ clientes: dniData, total: dniCount })
      }

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

// GET /api/clientes/afip-status — diagnóstico de configuración AFIP
router.get('/afip-status', verificarAuth, async (req, res) => {
  const certEnv = !!process.env.AFIP_CERT
  const keyEnv = !!process.env.AFIP_KEY
  const certLen = process.env.AFIP_CERT?.length || 0
  const keyLen = process.env.AFIP_KEY?.length || 0
  const certStart = process.env.AFIP_CERT?.substring(0, 30) || 'N/A'
  const keyStart = process.env.AFIP_KEY?.substring(0, 30) || 'N/A'

  const fs = require('fs')
  const path = require('path')
  const certPath = path.join(__dirname, '../../certs/COMERCIAL PADANO_7627c4ab3209aadb.crt')
  const keyPath = path.join(__dirname, '../../certs/afip.key')
  const certFile = fs.existsSync(certPath)
  const keyFile = fs.existsSync(keyPath)

  res.json({ certEnv, keyEnv, certLen, keyLen, certStart, keyStart, certFile, keyFile })
})

// GET /api/clientes/buscar-afip?cuit=XXX
// Consulta datos de un CUIT en AFIP/ARCA
router.get('/buscar-afip', verificarAuth, async (req, res) => {
  try {
    const { cuit } = req.query
    const soloDigitos = cuit?.replace(/\D/g, '') || ''
    if (soloDigitos.length < 7) {
      return res.status(400).json({ error: 'Ingrese al menos 7 dígitos (DNI o CUIT)' })
    }

    const datos = await consultarCUIT(soloDigitos)
    if (!datos) {
      return res.json({ encontrado: false })
    }

    res.json({ encontrado: true, datos })
  } catch (err) {
    console.error('Error al consultar AFIP:', err.message, err.stack?.substring(0, 300))
    // Si AFIP no responde, no romper el flujo
    const msg = err.response?.data?.message || err.message
    if (msg.includes('No existe persona')) {
      return res.json({ encontrado: false })
    }
    res.status(500).json({ error: 'Error al consultar AFIP' })
  }
})

// GET /api/clientes/buscar-centum?cuit=XXX
// Busca clientes en Centum BI por CUIT/DNI
router.get('/buscar-centum', verificarAuth, async (req, res) => {
  try {
    const { cuit } = req.query
    if (!cuit || cuit.trim().length < 3) {
      return res.json({ resultados: [] })
    }

    const termino = cuit.trim().replace(/\D/g, '')
    if (termino.length < 3) {
      return res.json({ resultados: [] })
    }

    const db = await getPool()
    const result = await db.request()
      .input('cuit', sql.NVarChar, `%${termino}%`)
      .query(`
        SELECT TOP 10 ClienteID, RazonSocialCliente, CUITCliente, DireccionCliente, LocalidadCliente, Telefono1Cliente
        FROM Clientes_VIEW
        WHERE REPLACE(REPLACE(ISNULL(CUITCliente,''), '-', ''), ' ', '') LIKE @cuit
        AND ActivoCliente = 1
        ORDER BY RazonSocialCliente
      `)

    const resultados = result.recordset.map(r => ({
      id_centum: r.ClienteID,
      razon_social: r.RazonSocialCliente?.trim() || '',
      cuit: r.CUITCliente?.trim() || '',
      direccion: r.DireccionCliente?.trim() || '',
      localidad: r.LocalidadCliente?.trim() || '',
      telefono: r.Telefono1Cliente?.trim() || '',
    }))

    res.json({ resultados })
  } catch (err) {
    console.error('Error al buscar cliente en Centum:', err)
    res.status(500).json({ error: 'Error al buscar en Centum' })
  }
})

// POST /api/clientes/importar-centum
// Importa un cliente existente de Centum a la BD local
router.post('/importar-centum', verificarAuth, async (req, res) => {
  try {
    const { id_centum, razon_social, cuit, direccion, localidad, telefono } = req.body

    if (!id_centum) {
      return res.status(400).json({ error: 'id_centum es requerido' })
    }

    // Verificar si ya existe localmente
    const { data: existente } = await supabase
      .from('clientes')
      .select('*')
      .eq('id_centum', id_centum)
      .maybeSingle()

    if (existente) {
      return res.json(existente)
    }

    // Generar código CLI-XXXX
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
        razon_social: razon_social?.trim() || 'Sin nombre',
        cuit: cuit?.trim() || null,
        direccion: direccion?.trim() || null,
        localidad: localidad?.trim() || null,
        telefono: telefono?.trim() || null,
        id_centum,
        activo: true,
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json(data)
  } catch (err) {
    console.error('Error al importar cliente de Centum:', err)
    res.status(500).json({ error: 'Error al importar cliente' })
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
// Crear cliente local (código auto-generado CLI-0001) + exportar a Centum
router.post('/', verificarAuth, async (req, res) => {
  try {
    const { razon_social, cuit, direccion, localidad, codigo_postal, provincia, telefono,
            email, celular, condicion_iva, direcciones_entrega } = req.body

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
        email: email?.trim() || null,
        celular: celular?.trim() || null,
        condicion_iva: condicion_iva || 'CF',
        activo: true,
      })
      .select()
      .single()

    if (error) throw error

    // Auto-exportar a Centum ERP
    let clienteResponse = data
    let warningCentum = null

    // Extraer dirección de entrega principal para Centum
    const dirPrincipal = Array.isArray(direcciones_entrega)
      ? direcciones_entrega.find(d => d.direccion?.trim())
      : null

    try {
      const resultado = await crearClienteEnCentum(data, condicion_iva || 'CF', dirPrincipal)
      const idCentum = resultado.IdCliente || resultado.Id || null
      if (idCentum) {
        const { data: actualizado } = await supabase
          .from('clientes')
          .update({ id_centum: idCentum })
          .eq('id', data.id)
          .select()
          .single()
        clienteResponse = actualizado || data

        // Agregar contacto de envío en Centum (email/celular)
        if (email || celular) {
          try {
            await agregarContactoEnvioCentum(idCentum, { email, celular })
          } catch (errContacto) {
            console.warn('No se pudo agregar contacto envío en Centum:', errContacto.message)
          }
        }
      }
    } catch (errCentum) {
      console.warn('No se pudo exportar cliente a Centum (se creó solo local):', errCentum.message)
      warningCentum = 'No se pudo cargar el cliente en Centum. Se reintentará automáticamente, o cargarlo de forma manual en Centum.'
    }

    // Insertar direcciones de entrega locales
    if (Array.isArray(direcciones_entrega) && direcciones_entrega.length > 0) {
      const dirs = direcciones_entrega
        .filter(d => d.direccion?.trim())
        .map((d, i) => ({
          cliente_id: clienteResponse.id,
          direccion: d.direccion.trim(),
          localidad: d.localidad?.trim() || null,
          referencia: d.referencia?.trim() || null,
          es_principal: i === 0,
        }))

      if (dirs.length > 0) {
        await supabase.from('direcciones_entrega').insert(dirs)
      }
    }

    const respuesta = { ...clienteResponse }
    if (warningCentum) respuesta.warning_centum = warningCentum
    res.status(201).json(respuesta)
  } catch (err) {
    console.error('Error al crear cliente:', err)
    res.status(500).json({ error: 'Error al crear cliente' })
  }
})

// PUT /api/clientes/contacto/:idCentum
// Actualizar email/celular del cliente (local + Centum contacto envío comprobantes)
router.put('/contacto/:idCentum', verificarAuth, async (req, res) => {
  const idCentum = parseInt(req.params.idCentum)
  const { email, celular } = req.body

  if (!idCentum) {
    return res.status(400).json({ error: 'ID Centum requerido' })
  }

  try {
    // Actualizar localmente
    const updates = {}
    if (email !== undefined) updates.email = email?.trim() || null
    if (celular !== undefined) updates.celular = celular?.trim() || null

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('clientes')
        .update(updates)
        .eq('id_centum', idCentum)
    }

    // Actualizar en Centum (contacto envío comprobantes)
    let warningCentum = null
    try {
      await agregarContactoEnvioCentum(idCentum, { email: email?.trim(), celular: celular?.trim() })
    } catch (err) {
      console.error('Error actualizando contacto en Centum:', err.message)
      warningCentum = err.message
    }

    const respuesta = { ok: true, email: email?.trim() || null, celular: celular?.trim() || null }
    if (warningCentum) respuesta.warning_centum = warningCentum
    res.json(respuesta)
  } catch (err) {
    console.error('Error al actualizar contacto:', err)
    res.status(500).json({ error: 'Error al actualizar contacto' })
  }
})

// GET /api/clientes/refresh/:idCentum
// Refresca un cliente individual desde Centum BI
router.get('/refresh/:idCentum', verificarAuth, async (req, res) => {
  const idCentum = parseInt(req.params.idCentum)
  if (!idCentum) return res.status(400).json({ error: 'ID Centum requerido' })

  try {
    const db = await getPool()
    const result = await db.request()
      .input('id', sql.Int, idCentum)
      .query(`
        SELECT ClienteID, RazonSocialCliente, CUITCliente, DireccionCliente,
               LocalidadCliente, CodigoPostalCliente, Telefono1Cliente, CondicionIVAClienteID, ActivoCliente
        FROM Clientes_VIEW
        WHERE ClienteID = @id
      `)

    if (!result.recordset || result.recordset.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado en Centum' })
    }

    // Si el cliente está inactivo en Centum, desactivarlo localmente y avisar
    if (result.recordset[0].ActivoCliente === 0 || result.recordset[0].ActivoCliente === false) {
      await supabase.from('clientes').update({ activo: false }).eq('id_centum', idCentum)
      return res.status(410).json({ error: 'Cliente desactivado en Centum', desactivado: true })
    }

    const r = result.recordset[0]
    const mapCondicionIVA = (id) => {
      if (id === 1895) return 'RI'
      if (id === 1894) return 'MT'
      if (id === 1893) return 'EX' // Exento
      return 'CF'
    }

    const updates = {
      razon_social: r.RazonSocialCliente?.trim() || 'Sin nombre',
      cuit: r.CUITCliente?.trim() || null,
      direccion: r.DireccionCliente?.trim() || null,
      localidad: r.LocalidadCliente?.trim() || null,
      codigo_postal: r.CodigoPostalCliente?.trim() || null,
      telefono: r.Telefono1Cliente?.trim() || null,
      condicion_iva: mapCondicionIVA(r.CondicionIVAClienteID),
    }

    const { data, error } = await supabase
      .from('clientes')
      .update(updates)
      .eq('id_centum', idCentum)
      .select('id, id_centum, codigo, razon_social, cuit, condicion_iva, email, celular, telefono')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error refrescando cliente:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/clientes/editar-centum/:idCentum
// Editar cliente local + sync a Centum
router.put('/editar-centum/:idCentum', verificarAuth, async (req, res) => {
  const idCentum = parseInt(req.params.idCentum)
  const { razon_social, cuit, condicion_iva, telefono, email, celular } = req.body

  if (!idCentum) {
    return res.status(400).json({ error: 'ID Centum requerido' })
  }

  try {
    // Actualizar localmente
    const updates = {}
    if (razon_social !== undefined) updates.razon_social = razon_social?.trim() || null
    if (cuit !== undefined) updates.cuit = cuit?.trim() || null
    if (condicion_iva !== undefined) updates.condicion_iva = condicion_iva
    if (telefono !== undefined) updates.telefono = telefono?.trim() || null
    if (email !== undefined) updates.email = email?.trim() || null
    if (celular !== undefined) updates.celular = celular?.trim() || null

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('clientes')
        .update(updates)
        .eq('id_centum', idCentum)
    }

    // Actualizar contacto envío comprobantes en Centum (email/celular)
    // Nota: Centum no soporta PUT/PATCH en /Clientes, solo se puede actualizar el contacto de envío
    let warningCentum = null
    if (email || celular) {
      try {
        await agregarContactoEnvioCentum(idCentum, { email: email?.trim(), celular: celular?.trim() })
      } catch (err) {
        console.error('Error actualizando contacto envío en Centum:', err.message)
        warningCentum = err.message
      }
    }

    const respuesta = { ok: true, ...updates }
    if (warningCentum) respuesta.warning_centum = warningCentum
    res.json(respuesta)
  } catch (err) {
    console.error('Error al editar cliente con sync:', err)
    res.status(500).json({ error: 'Error al editar cliente' })
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

// GET /api/clientes/:id/direcciones
// Listar direcciones de entrega de un cliente
router.get('/:id/direcciones', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('direcciones_entrega')
      .select('*')
      .eq('cliente_id', req.params.id)
      .order('es_principal', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener direcciones:', err)
    res.status(500).json({ error: 'Error al obtener direcciones' })
  }
})

// POST /api/clientes/:id/direcciones
// Agregar dirección de entrega a un cliente
router.post('/:id/direcciones', verificarAuth, async (req, res) => {
  try {
    const { direccion, localidad, referencia, es_principal } = req.body

    if (!direccion || !direccion.trim()) {
      return res.status(400).json({ error: 'La dirección es requerida' })
    }

    // Si es principal, quitar flag de las demás
    if (es_principal) {
      await supabase
        .from('direcciones_entrega')
        .update({ es_principal: false })
        .eq('cliente_id', req.params.id)
    }

    const { data, error } = await supabase
      .from('direcciones_entrega')
      .insert({
        cliente_id: req.params.id,
        direccion: direccion.trim(),
        localidad: localidad?.trim() || null,
        referencia: referencia?.trim() || null,
        es_principal: es_principal || false,
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al agregar dirección:', err)
    res.status(500).json({ error: 'Error al agregar dirección' })
  }
})

module.exports = router
