// Servicio de sincronización de clientes con ERP Centum
const { generateAccessToken } = require('./syncERP')
const { registrarLlamada } = require('./apiLogger')
const logger = require('../config/logger')
const { registrarAuditoria, calcularCambios } = require('./auditoriaClientes')

const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY
if (!API_KEY) logger.error('⚠ CENTUM_API_KEY no está configurada en variables de entorno')
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

// Obtener el siguiente número de código CLI- (soporta >4 dígitos)
async function getMaxCodigoCliente(supabase) {
  const { data: top4 } = await supabase.from('clientes').select('codigo')
    .like('codigo', 'CLI-____').order('codigo', { ascending: false }).limit(1)
  const { data: top5 } = await supabase.from('clientes').select('codigo')
    .like('codigo', 'CLI-_____').order('codigo', { ascending: false }).limit(1)
  const { data: top6 } = await supabase.from('clientes').select('codigo')
    .like('codigo', 'CLI-______').order('codigo', { ascending: false }).limit(1)
  let maxNum = 0
  for (const arr of [top4, top5, top6]) {
    if (arr && arr.length > 0) {
      const m = arr[0].codigo.match(/^CLI-(\d+)$/)
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]))
    }
  }
  return maxNum + 1
}

/**
 * Obtiene una página de clientes activos desde Centum ERP.
 * @param {number} pagina - Número de página (1-based)
 * @param {number} cantidadPorPagina - Items por página (default 500)
 * @returns {Promise<{items: Array, total: number}>}
 */
async function fetchClientesCentum(pagina = 1, cantidadPorPagina = 500) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Clientes?activo=true&numeroPagina=${pagina}&cantidadItemsPorPagina=${cantidadPorPagina}`
  const inicio = Date.now()

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'GET',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'GET',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al consultar clientes Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()
  const items = data.Items || data.Clientes?.Items || (Array.isArray(data) ? data : [])
  const total = data.CantidadTotalItems || items.length

  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'GET',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: items.length, origen: 'manual',
  })

  return { items, total }
}

// Cache de vendedores Centum (ID → Nombre), se refresca cada sync
let _vendedoresCache = null
let _vendedoresCacheTs = 0
const VENDEDORES_CACHE_TTL = 30 * 60 * 1000 // 30 min

async function fetchVendedoresMap() {
  if (_vendedoresCache && (Date.now() - _vendedoresCacheTs) < VENDEDORES_CACHE_TTL) {
    return _vendedoresCache
  }
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Vendedores`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
      'CentumSuiteAccessToken': accessToken,
    },
  })
  if (!response.ok) {
    logger.warn(`[SyncClientes] No se pudo obtener vendedores: HTTP ${response.status}`)
    return _vendedoresCache || new Map()
  }
  const data = await response.json()
  const items = data[0]?.Items || data.Items || []
  const map = new Map()
  for (const v of items) {
    map.set(v.IdVendedor, v.Nombre?.trim() || null)
  }
  _vendedoresCache = map
  _vendedoresCacheTs = Date.now()
  return map
}

/**
 * Sync incremental: importa clientes creados en las últimas N horas desde Centum BI (SQL Server).
 * Mucho más liviano que el sync masivo vía API REST.
 * @param {number} horasAtras - ventana de tiempo (default 2 horas)
 * @returns {Promise<{nuevos: number, existentes: number}>}
 */
async function syncClientesRecientes(horasAtras = 2) {
  const { getPool } = require('../config/centum')
  const sql = require('mssql')
  const supabase = require('../config/supabase')
  const inicioSync = Date.now()

  let db
  try {
  db = await getPool()
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes_bi', endpoint: 'Clientes_VIEW (BI SQL)', metodo: 'QUERY',
      estado: 'error', duracion_ms: Date.now() - inicioSync,
      error_mensaje: err.message, origen: 'cron',
    })
    throw err
  }
  const desde = new Date(Date.now() - horasAtras * 60 * 60 * 1000)

  // Obtener mapa de vendedores (ID → Nombre) desde API REST
  let vendedoresMap = new Map()
  try {
    vendedoresMap = await fetchVendedoresMap()
  } catch (err) {
    logger.warn(`[SyncClientes] Error obteniendo vendedores: ${err.message}`)
  }

  // Traer clientes nuevos (creados recientemente)
  const resultNuevos = await db.request()
    .input('desde', sql.DateTime, desde)
    .query(`
      SELECT ClienteID, CodigoCliente, RazonSocialCliente, CUITCliente,
             DireccionCliente, LocalidadCliente, CodigoPostalCliente, Telefono1Cliente,
             CondicionIVAClienteID, EmailCliente, VendedorID
      FROM Clientes_VIEW
      WHERE ActivoCliente = 1 AND FechaAltaCliente >= @desde
    `)

  const mapCondicionIVA = (id) => {
    if (id === 1895) return 'RI'
    if (id === 1894) return 'MT'
    if (id === 1893) return 'EX' // Exento
    return 'CF'
  }

  const mapearCliente = (r) => ({
    razon_social: r.RazonSocialCliente?.trim() || 'Sin nombre',
    cuit: r.CUITCliente?.trim() || null,
    direccion: r.DireccionCliente?.trim() || null,
    localidad: r.LocalidadCliente?.trim() || null,
    codigo_postal: r.CodigoPostalCliente?.trim() || null,
    telefono: r.Telefono1Cliente?.trim() || null,
    codigo_centum: r.CodigoCliente?.trim() || null,
    ...(r.CondicionIVAClienteID != null ? { condicion_iva: mapCondicionIVA(r.CondicionIVAClienteID) } : {}),
    // Email desde BI (solo se incluye si tiene valor, para merge policy)
    ...(r.EmailCliente?.trim() ? { _centum_email: r.EmailCliente.trim() } : {}),
    // Vendedor asignado desde Centum
    ...(r.VendedorID != null ? { vendedor_centum_id: r.VendedorID, vendedor_nombre: vendedoresMap.get(r.VendedorID) || null } : {}),
  })

  // Obtener todos los clientes locales (con y sin id_centum) para evitar duplicados por CUIT
  // Paginado para superar el límite de 1000 filas de Supabase
  let todosLocales = []
  let fromLocal = 0
  while (true) {
    const { data } = await supabase
      .from('clientes')
      .select('id, id_centum, razon_social, cuit, direccion, localidad, codigo_postal, telefono, condicion_iva, codigo_centum, email, celular, vendedor_centum_id, vendedor_nombre')
      .eq('activo', true)
      .range(fromLocal, fromLocal + 999)
    todosLocales = todosLocales.concat(data || [])
    if (!data || data.length < 1000) break
    fromLocal += 1000
  }

  const existentesMap = new Map((todosLocales || []).filter(e => e.id_centum).map(e => [e.id_centum, e]))
  const cuitMap = new Map((todosLocales || []).filter(e => e.cuit).map(e => [e.cuit.replace(/\D/g, ''), e]))

  // Separar: existentes por id_centum, o por CUIT (linkear), o realmente nuevos
  const nuevosBI = []
  const existentesBI = []
  for (const r of resultNuevos.recordset) {
    if (existentesMap.has(r.ClienteID)) {
      existentesBI.push(r)
    } else {
      // Verificar si existe por CUIT
      const cuit = (r.CUITCliente || '').replace(/\D/g, '')
      const localPorCuit = cuit.length >= 7 ? cuitMap.get(cuit) : null
      if (localPorCuit && !localPorCuit.id_centum) {
        // Linkear id_centum al existente
        await supabase.from('clientes').update({ id_centum: r.ClienteID, ...mapearCliente(r), updated_at: new Date().toISOString() }).eq('id', localPorCuit.id)
        logger.info(`[SyncClientes] Linkeado ${r.RazonSocialCliente} (CUIT ${cuit}) → id_centum ${r.ClienteID}`)
      } else if (!localPorCuit) {
        nuevosBI.push(r)
      }
      // Si localPorCuit ya tiene id_centum, ignorar (duplicado en Centum)
    }
  }

  // También actualizar todos los clientes locales activos con datos de Centum BI
  // Paginado para superar el límite de 1000 filas de Supabase
  let localesActivos = []
  let fromActivos = 0
  while (true) {
    const { data } = await supabase
      .from('clientes')
      .select('id, id_centum')
      .eq('activo', true)
      .not('id_centum', 'is', null)
      .range(fromActivos, fromActivos + 999)
    localesActivos = localesActivos.concat(data || [])
    if (!data || data.length < 1000) break
    fromActivos += 1000
  }

  let nuevosCount = 0
  let actualizadosCount = 0

  if (localesActivos && localesActivos.length > 0) {
    const idsActivos = [...new Set(localesActivos.map(c => c.id_centum))]
    const processedIds = new Set()
    const normalize = v => (v === undefined || v === '' ? null : v)
    // Traer datos actuales de Centum en lotes
    for (let i = 0; i < idsActivos.length; i += 500) {
      const lote = idsActivos.slice(i, i + 500)
      const resCentum = await db.request().query(
        `SELECT ClienteID, CodigoCliente, RazonSocialCliente, CUITCliente, DireccionCliente, LocalidadCliente, CodigoPostalCliente, Telefono1Cliente, CondicionIVAClienteID, EmailCliente, VendedorID
         FROM Clientes_VIEW
         WHERE ActivoCliente = 1 AND ClienteID IN (${lote.join(',')})`
      )
      for (const r of resCentum.recordset) {
        if (processedIds.has(r.ClienteID)) continue
        processedIds.add(r.ClienteID)
        const local = existentesMap.get(r.ClienteID)
        if (!local) continue
        const centumData = mapearCliente(r)

        // Merge email: Centum llena local vacío, local gana si ambos tienen valor
        const emailMerge = {}
        if (centumData._centum_email && !local.email) {
          emailMerge.email = centumData._centum_email
        }
        delete centumData._centum_email

        const updateData = { ...centumData, ...emailMerge }

        // Solo actualizar si hay diferencias
        const cambio = Object.keys(updateData).some(k => normalize(updateData[k]) !== normalize(local[k]))
        if (cambio) {
          const cambiosAudit = calcularCambios(local, updateData)
          const { error } = await supabase.from('clientes').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', local.id)
          if (error) {
            logger.warn(`[SyncClientes] Error actualizando ${local.id}:`, error.message)
            continue
          }
          actualizadosCount++
          if (Object.keys(cambiosAudit).length > 0) {
            registrarAuditoria({
              cliente_id: local.id,
              accion: 'sync_centum',
              origen: 'cron',
              cambios: cambiosAudit,
              detalle: 'Sync automático desde Centum BI',
            })
          }
        }
      }
    }
  }

  // Insertar nuevos
  if (nuevosBI.length > 0) {
    const siguiente = await getMaxCodigoCliente(supabase)

    const inserts = nuevosBI.map((r, i) => ({
      codigo: `CLI-${String(siguiente + i).padStart(5, '0')}`,
      ...mapearCliente(r),
      id_centum: r.ClienteID,
      activo: true,
    }))

    const { error } = await supabase.from('clientes').insert(inserts)
    if (error) throw error
    nuevosCount = inserts.length
  }

  // Desactivar clientes locales activos que ya no son clientes en Centum
  let desactivadosCount = 0
  try {
    let localesActivosDesact = []
    let fromDesact = 0
    while (true) {
      const { data } = await supabase
        .from('clientes')
        .select('id, id_centum')
        .eq('activo', true)
        .not('id_centum', 'is', null)
        .range(fromDesact, fromDesact + 999)
      localesActivosDesact = localesActivosDesact.concat(data || [])
      if (!data || data.length < 1000) break
      fromDesact += 1000
    }

    if (localesActivosDesact.length > 0) {
      const idsLocales = localesActivosDesact.map(c => c.id_centum)
      // Consultar cuáles están inactivos en Centum (en lotes de 500)
      for (let i = 0; i < idsLocales.length; i += 500) {
        const lote = idsLocales.slice(i, i + 500)
        const resInactivos = await db.request().query(
          `SELECT ClienteID FROM Clientes_VIEW WHERE ActivoCliente = 0 AND ClienteID IN (${lote.join(',')})`
        )
        for (const r of resInactivos.recordset) {
          const cli = localesActivosDesact.find(c => c.id_centum === r.ClienteID)
          if (cli) {
            const { error: errDesact } = await supabase
              .from('clientes')
              .update({ activo: false, updated_at: new Date().toISOString() })
              .eq('id', cli.id)
            if (!errDesact) desactivadosCount++
          }
        }
      }
      if (desactivadosCount > 0) {
        logger.info(`[SyncClientes] ${desactivadosCount} clientes desactivados (inactivos en Centum)`)
      }
    }
  } catch (err) {
    logger.warn('[SyncClientes] Error al verificar clientes inactivos:', err.message)
  }

  // Reactivar clientes locales inactivos que fueron reactivados en Centum
  let reactivadosCount = 0
  try {
    let localesInactivos = []
    let fromInact = 0
    while (true) {
      const { data } = await supabase
        .from('clientes')
        .select('id, id_centum')
        .eq('activo', false)
        .not('id_centum', 'is', null)
        .range(fromInact, fromInact + 999)
      localesInactivos = localesInactivos.concat(data || [])
      if (!data || data.length < 1000) break
      fromInact += 1000
    }

    if (localesInactivos.length > 0) {
      const idsInactivos = localesInactivos.map(c => c.id_centum)
      for (let i = 0; i < idsInactivos.length; i += 500) {
        const lote = idsInactivos.slice(i, i + 500)
        const resActivos = await db.request().query(
          `SELECT ClienteID FROM Clientes_VIEW WHERE ActivoCliente = 1 AND ClienteID IN (${lote.join(',')})`
        )
        for (const r of resActivos.recordset) {
          const cli = localesInactivos.find(c => c.id_centum === r.ClienteID)
          if (cli) {
            const { error: errReact } = await supabase
              .from('clientes')
              .update({ activo: true, updated_at: new Date().toISOString() })
              .eq('id', cli.id)
            if (!errReact) reactivadosCount++
          }
        }
      }
      if (reactivadosCount > 0) {
        logger.info(`[SyncClientes] ${reactivadosCount} clientes reactivados (activos en Centum)`)
      }
    }
  } catch (err) {
    logger.warn('[SyncClientes] Error al verificar clientes reactivados:', err.message)
  }

  const resultado = { nuevos: nuevosCount, actualizados: actualizadosCount, desactivados: desactivadosCount, reactivados: reactivadosCount }

  registrarLlamada({
    servicio: 'centum_clientes_bi',
    endpoint: 'Clientes_VIEW (BI SQL)',
    metodo: 'QUERY',
    estado: 'ok',
    duracion_ms: Date.now() - inicioSync,
    items_procesados: nuevosCount + actualizadosCount,
    origen: 'cron',
  })

  return resultado
}

/**
 * Retry: busca clientes locales sin id_centum y los crea en Centum.
 * Corre periódicamente desde el cron.
 * @returns {Promise<{reintentados: number, exitosos: number, fallidos: number}>}
 */
async function retrySyncCentum() {
  const supabase = require('../config/supabase')
  const inicioRetry = Date.now()

  const { data: pendientes, error } = await supabase
    .from('clientes')
    .select('*')
    .is('id_centum', null)
    .eq('activo', true)
    .like('codigo', 'CLI-%')
    .order('created_at', { ascending: true })
    .limit(10)

  if (error || !pendientes || pendientes.length === 0) {
    registrarLlamada({
      servicio: 'centum_clientes_retry', endpoint: 'clientes (retry)', metodo: 'BATCH',
      estado: error ? 'error' : 'ok', duracion_ms: Date.now() - inicioRetry,
      items_procesados: 0, error_mensaje: error?.message || null, origen: 'cron',
    })
    return { reintentados: 0, exitosos: 0, fallidos: 0 }
  }

  let exitosos = 0
  let fallidos = 0

  // Intentar obtener pool de BI para buscar duplicados
  let db = null
  try {
    const { getPool } = require('../config/centum')
    const sql = require('mssql')
    db = await getPool()
  } catch (_) { /* BI no disponible, se intentará crear directo */ }

  for (const cliente of pendientes) {
    try {
      let idCentum = null

      // Primero buscar en Centum BI si ya existe por CUIT (evitar duplicados)
      if (db && cliente.cuit) {
        const sql = require('mssql')
        const cuitLimpio = cliente.cuit.replace(/\D/g, '')
        if (cuitLimpio.length >= 7) {
          const res = await db.request()
            .input('cuit', sql.VarChar, `%${cuitLimpio}%`)
            .query(`SELECT TOP 1 ClienteID FROM Clientes_VIEW WHERE CUITCliente LIKE @cuit AND ActivoCliente = 1`)
          if (res.recordset.length > 0) {
            idCentum = res.recordset[0].ClienteID
            logger.info(`[RetryCentum] Cliente ${cliente.razon_social} ya existe en Centum (ID: ${idCentum}), linkeando`)
          }
        }
      }

      // Si no se encontró en BI, intentar crear
      if (!idCentum) {
        try {
          const condicion = cliente.condicion_iva || 'CF'
          const resultado = await crearClienteEnCentum(cliente, condicion)
          idCentum = resultado.IdCliente || resultado.Id || null
        } catch (errCrear) {
          // Si es YaExiste, buscar por CUIT en BI para linkear
          if (errCrear.message?.includes('YaExiste') && db && cliente.cuit) {
            const sql = require('mssql')
            const cuitLimpio = cliente.cuit.replace(/\D/g, '')
            const res = await db.request()
              .input('cuit', sql.VarChar, `%${cuitLimpio}%`)
              .query(`SELECT TOP 1 ClienteID FROM Clientes_VIEW WHERE CUITCliente LIKE @cuit AND ActivoCliente = 1`)
            if (res.recordset.length > 0) {
              idCentum = res.recordset[0].ClienteID
              logger.info(`[RetryCentum] Cliente ${cliente.razon_social} YaExiste, linkeando ID: ${idCentum}`)
            }
          }
          if (!idCentum) throw errCrear
        }
      }

      if (idCentum) {
        await supabase
          .from('clientes')
          .update({ id_centum: idCentum, updated_at: new Date().toISOString() })
          .eq('id', cliente.id)

        // Intentar agregar contacto de envío si tiene email/celular
        if (cliente.email || cliente.celular) {
          try {
            await agregarContactoEnvioCentum(idCentum, {
              email: cliente.email,
              celular: cliente.celular,
            })
          } catch (_) { /* best effort */ }
        }

        exitosos++
      } else {
        fallidos++
      }
    } catch (err) {
      logger.warn(`[RetryCentum] Falló cliente ${cliente.id} (${cliente.razon_social}):`, err.message)
      fallidos++
    }
  }

  const resultado = { reintentados: pendientes.length, exitosos, fallidos }

  registrarLlamada({
    servicio: 'centum_clientes_retry', endpoint: 'clientes (retry)', metodo: 'BATCH',
    estado: fallidos === pendientes.length ? 'error' : 'ok',
    duracion_ms: Date.now() - inicioRetry,
    items_procesados: exitosos,
    error_mensaje: fallidos > 0 ? `${fallidos} fallidos de ${pendientes.length}` : null,
    origen: 'cron',
  })

  return resultado
}

// Mapping de condición IVA para Centum
const CONDICION_IVA_MAP = {
  CF: {
    CondicionIVA: { IdCondicionIVA: 1892 },
    CondicionVenta: { IdCondicionVenta: 14 },
  },
  RI: {
    CondicionIVA: { IdCondicionIVA: 1895 },
    CondicionVenta: { IdCondicionVenta: 1 },
  },
  MT: {
    CondicionIVA: { IdCondicionIVA: 1894 },
    CondicionVenta: { IdCondicionVenta: 1 },
  },
  EX: {
    CondicionIVA: { IdCondicionIVA: 1893 },
    CondicionVenta: { IdCondicionVenta: 14 },
  },
}

/**
 * Crea un cliente en Centum ERP.
 * @param {Object} cliente - Datos del cliente
 * @param {string} condicion_iva - 'CF' o 'RI' (default 'CF')
 * @param {Object} [direccionEntrega] - Dirección de entrega principal { direccion, localidad }
 * @returns {Promise<Object>} - Respuesta del ERP
 */
async function crearClienteEnCentum(cliente, condicion_iva = 'CF', direccionEntrega = null) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Clientes`
  const inicio = Date.now()

  const condicion = CONDICION_IVA_MAP[condicion_iva] || CONDICION_IVA_MAP.CF

  const body = {
    RazonSocial: cliente.razon_social,
    CUIT: cliente.cuit || '',
    Direccion: cliente.direccion || '',
    Localidad: cliente.localidad || '',
    CodigoPostal: cliente.codigo_postal || '',
    Telefono: cliente.telefono || '',
    // Dirección de entrega (si se proporciona)
    CalleEntrega: direccionEntrega?.direccion || '',
    LocalidadEntrega: direccionEntrega?.localidad || '',
    // Campos obligatorios de Centum con defaults
    Provincia: { IdProvincia: 4667, Codigo: '2', Nombre: 'Santa Fe' },
    Pais: { IdPais: 4657, Codigo: 'ARG', Nombre: 'Argentina' },
    Zona: { IdZona: 6099, Codigo: '1', Nombre: 'Zona no identificada' },
    ZonaEntrega: { IdZona: 6095, Codigo: '2', Nombre: 'ROSARIO' },
    CondicionIVA: condicion.CondicionIVA,
    CondicionVenta: condicion.CondicionVenta,
    Vendedor: { IdVendedor: 2, Codigo: '01', Nombre: 'Sin Vendedor' },
    Transporte: { IdTransporte: 1 },
    ListaPrecio: { IdListaPrecio: 1 },
    Bonificacion: { IdBonificacion: 6235 },
    LimiteCredito: { IdLimiteCredito: 46005 },
    ClaseCliente: { IdClaseCliente: 8723 },
    FrecuenciaCliente: { IdFrecuenciaCliente: 6891 },
    CanalCliente: { IdCanalCliente: 6899 },
    CadenaCliente: { IdCadenaCliente: 6920 },
    UbicacionCliente: { IdUbicacionCliente: 6942 },
    EdadesPromedioConsumidoresCliente: { IdEdadesPromedioConsumidoresCliente: 6951 },
    GeneroPromedioConsumidoresCliente: { IdGeneroPromedioConsumidoresCliente: 6964 },
    DiasAtencionCliente: { IdDiasAtencionCliente: 6969 },
    HorarioAtencionCliente: { IdHorarioAtencionCliente: 6970 },
    CigarreraCliente: { IdCigarreraCliente: 6972 },
    CondicionIIBB: { IdCondicionIIBB: 6053, Codigo: '1' },
    DiasMorosidad: 30,
    DiasIncobrables: 180,
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al crear cliente en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })

  return data
}

/**
 * Actualiza un cliente existente en Centum ERP (PUT).
 * @param {number} idCliente - ID del cliente en Centum
 * @param {Object} datos - Campos a actualizar
 * @returns {Promise<Object>} - Respuesta del ERP
 */
async function actualizarClienteEnCentum(idCliente, datos) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Clientes/Actualizar`
  const inicio = Date.now()

  const body = { IdCliente: idCliente }
  if (datos.razon_social) body.RazonSocial = datos.razon_social
  if (datos.cuit !== undefined) body.CUIT = datos.cuit || ''
  if (datos.direccion !== undefined) body.Direccion = datos.direccion || ''
  if (datos.localidad !== undefined) body.Localidad = datos.localidad || ''
  if (datos.codigo_postal !== undefined) body.CodigoPostal = datos.codigo_postal || ''
  if (datos.telefono !== undefined) body.Telefono = datos.telefono || ''
  if (datos.condicion_iva) {
    const condicion = CONDICION_IVA_MAP[datos.condicion_iva] || CONDICION_IVA_MAP.CF
    body.CondicionIVA = condicion.CondicionIVA
    body.CondicionVenta = condicion.CondicionVenta
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al actualizar cliente en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json().catch(() => ({}))
  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: response.status, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })
  return data
}

// Cache de actividades de envío de comprobante (no cambian)
let actividadesCache = null

/**
 * Obtiene los IDs de actividades para envío de comprobante desde Centum.
 * Se cachean en memoria ya que no cambian.
 */
async function getActividadesEnvio() {
  if (actividadesCache) return actividadesCache

  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Actividades/EnvioContactoComprobantes`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
      'CentumSuiteAccessToken': accessToken,
    },
  })

  if (!response.ok) {
    const texto = await response.text()
    throw new Error(`Error al obtener actividades de envío (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()
  // Extraer IDs de actividades
  const items = Array.isArray(data) ? data : (data.Items || [])
  actividadesCache = items.map(a => a.IdActividad || a.Id || a)
  return actividadesCache
}

/**
 * Agrega contacto de envío de comprobante a un cliente en Centum.
 * @param {number} idCliente - ID del cliente en Centum
 * @param {Object} contacto - { email, celular }
 */
async function agregarContactoEnvioCentum(idCliente, { email, celular }) {
  if (!email && !celular) return null

  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/ContactoEnvioComprobanteEmpresa/${idCliente}`
  const inicio = Date.now()

  let idsActividad = []
  try {
    idsActividad = await getActividadesEnvio()
  } catch (err) {
    logger.warn('No se pudieron obtener actividades de envío:', err.message)
  }

  const body = {
    Email: email || '',
    Celular: celular || '',
    IdsActividad: idsActividad,
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  const texto = await response.text()
  let data = {}
  try { data = JSON.parse(texto) } catch { /* may not be JSON */ }

  if (!response.ok) {
    // Si el email/celular ya existe como contacto, no es un error real
    const code = data?.Code || ''
    if (code.includes('YaExiste')) {
      logger.info(`[Centum] Contacto envío ya existe para cliente ${idCliente}, ignorando.`)
      registrarLlamada({
        servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
        estado: 'ok_existente', status_code: response.status, duracion_ms: Date.now() - inicio,
        items_procesados: 1, origen: 'manual',
      })
      return data
    }
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al agregar contacto envío en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })

  return data
}

/**
 * Crea un Pedido de Venta en Centum ERP.
 * Artículo fijo: 08136 "PEDIDO APP PADANO GESTION"
 * @param {Object} params
 * @param {number} params.idCliente - ID del cliente en Centum
 * @param {string} params.fechaEntrega - Fecha ISO (YYYY-MM-DD)
 * @param {string} params.tipo - "delivery" o "retiro"
 * @param {string} [params.observaciones] - Observaciones libres
 * @param {number} [params.sucursalFisicaId] - ID de SucursalFisica Centum (solo para retiro)
 * @returns {Promise<Object>} - Respuesta del ERP con el pedido creado
 */
async function crearPedidoVentaCentum({ idCliente, fechaEntrega, tipo, observaciones, sucursalFisicaId }) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/PedidosVenta`
  const inicio = Date.now()

  const obs = observaciones
    ? `Pedido desde App Padano (${tipo === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}) - ${observaciones}`
    : `Pedido desde App Padano (${tipo === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'})`

  const body = {
    Bonificacion: { IdBonificacion: 6235 },
    Cliente: { IdCliente: idCliente },
    NumeroDocumento: { PuntoVenta: 4 },
    FechaEntrega: `${fechaEntrega}T00:00:00`,
    Observaciones: obs,
    PedidoVentaArticulos: [
      {
        IdArticulo: 8135,
        Codigo: '08136',
        Nombre: 'PEDIDO APP PADANO GESTION',
        Cantidad: 1.0,
        Precio: 1.0,
        CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: 21.0 },
      },
    ],
    Vendedor: { IdVendedor: 2 },
    TurnoEntrega: { IdTurnoEntrega: 8782 },
  }

  // Agregar sucursal física (delivery → Fisherton, retiro → la elegida)
  if (sucursalFisicaId) {
    body.SucursalFisica = { IdSucursalFisica: sucursalFisicaId }
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al crear pedido de venta en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })

  return data
}

/**
 * Full scan: detecta clientes activos en Centum BI que no existen localmente y los crea.
 * Más pesado que el incremental — corre cada hora.
 */
async function syncClientesFaltantes() {
  const { getPool } = require('../config/centum')
  const supabase = require('../config/supabase')
  const inicioSync = Date.now()

  let db
  try {
    db = await getPool()
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes_bi', endpoint: 'Clientes_VIEW (full scan)', metodo: 'QUERY',
      estado: 'error', duracion_ms: Date.now() - inicioSync,
      error_mensaje: err.message, origen: 'cron',
    })
    throw err
  }

  // Traer todos los ClienteID activos de Centum BI
  const resCentum = await db.request().query(`
    SELECT ClienteID, CodigoCliente, RazonSocialCliente, CUITCliente,
           DireccionCliente, LocalidadCliente, CodigoPostalCliente, Telefono1Cliente,
           CondicionIVAClienteID, EmailCliente
    FROM Clientes_VIEW
    WHERE ActivoCliente = 1
  `)

  // Traer todos los clientes locales (id_centum y cuit) para evitar duplicados
  let locales = []
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('clientes')
      .select('id, id_centum, cuit')
      .eq('activo', true)
      .range(from, from + 999)
    locales = locales.concat(data || [])
    if (!data || data.length < 1000) break
    from += 1000
  }

  const localesIdSet = new Set(locales.filter(c => c.id_centum).map(c => c.id_centum))
  const localesCuitSet = new Set(locales.filter(c => c.cuit).map(c => c.cuit.replace(/\D/g, '')).filter(c => c.length >= 7))

  // Filtrar los que faltan: no existe por id_centum NI por CUIT
  const faltantes = resCentum.recordset.filter(r => {
    if (localesIdSet.has(r.ClienteID)) return false
    const cuit = (r.CUITCliente || '').replace(/\D/g, '')
    if (cuit.length >= 7 && localesCuitSet.has(cuit)) {
      // Ya existe por CUIT pero sin id_centum — linkear en vez de crear
      const local = locales.find(l => l.cuit && l.cuit.replace(/\D/g, '') === cuit && !l.id_centum)
      if (local) {
        supabase.from('clientes').update({ id_centum: r.ClienteID, updated_at: new Date().toISOString() }).eq('id', local.id).then(() => {})
      }
      return false
    }
    return true
  })

  if (faltantes.length === 0) {
    registrarLlamada({
      servicio: 'centum_clientes_bi', endpoint: 'Clientes_VIEW (full scan)', metodo: 'QUERY',
      estado: 'ok', duracion_ms: Date.now() - inicioSync,
      items_procesados: 0, origen: 'cron',
    })
    return { faltantes_encontrados: 0, insertados: 0 }
  }

  const mapCondicionIVA = (id) => {
    if (id === 1895) return 'RI'
    if (id === 1894) return 'MT'
    if (id === 1893) return 'EX'
    return 'CF'
  }

  // Generar códigos CLI-XXXXX
  const siguiente = await getMaxCodigoCliente(supabase)

  const inserts = faltantes.map((r, i) => ({
    codigo: `CLI-${String(siguiente + i).padStart(5, '0')}`,
    razon_social: r.RazonSocialCliente?.trim() || 'Sin nombre',
    cuit: r.CUITCliente?.trim() || null,
    direccion: r.DireccionCliente?.trim() || null,
    localidad: r.LocalidadCliente?.trim() || null,
    codigo_postal: r.CodigoPostalCliente?.trim() || null,
    telefono: r.Telefono1Cliente?.trim() || null,
    codigo_centum: r.CodigoCliente?.trim() || null,
    condicion_iva: r.CondicionIVAClienteID != null ? mapCondicionIVA(r.CondicionIVAClienteID) : 'CF',
    email: r.EmailCliente?.trim() || null,
    id_centum: r.ClienteID,
    activo: true,
  }))

  // Insertar en lotes de 200
  let insertados = 0
  for (let i = 0; i < inserts.length; i += 200) {
    const lote = inserts.slice(i, i + 200)
    const { error } = await supabase.from('clientes').insert(lote)
    if (error) {
      logger.warn(`[SyncFaltantes] Error insertando lote ${i}:`, error.message)
    } else {
      insertados += lote.length
    }
  }

  logger.info(`[SyncFaltantes] ${insertados} clientes faltantes importados de Centum BI`)

  registrarLlamada({
    servicio: 'centum_clientes_bi', endpoint: 'Clientes_VIEW (full scan)', metodo: 'QUERY',
    estado: 'ok', duracion_ms: Date.now() - inicioSync,
    items_procesados: insertados, origen: 'cron',
  })

  return { faltantes_encontrados: faltantes.length, insertados }
}

/**
 * Desactiva un cliente en Centum ERP (Activo = false).
 * Usa POST /Clientes/Actualizar (PUT da 405).
 * @param {number} idCliente - ID del cliente en Centum
 * @returns {Promise<Object>}
 */
async function desactivarClienteEnCentum(idCliente) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Clientes/Actualizar`
  const inicio = Date.now()

  const body = { IdCliente: idCliente, Activo: false }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al desactivar cliente en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json().catch(() => ({}))
  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: response.status, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })
  return data
}

module.exports = { fetchClientesCentum, crearClienteEnCentum, actualizarClienteEnCentum, desactivarClienteEnCentum, agregarContactoEnvioCentum, syncClientesRecientes, retrySyncCentum, syncClientesFaltantes, crearPedidoVentaCentum }
