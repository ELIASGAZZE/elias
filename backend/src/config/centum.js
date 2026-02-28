// Conexión al SQL Server de Centum BI (modelo de datos del ERP)
const sql = require('mssql')
const { registrarLlamada } = require('../services/apiLogger')

const centumConfig = {
  server: process.env.CENTUM_BI_SERVER || '119.8.79.133',
  port: parseInt(process.env.CENTUM_BI_PORT || '22455'),
  database: process.env.CENTUM_BI_DATABASE || 'CentumSuiteBL7GazzeJorge',
  user: process.env.CENTUM_BI_USER || 'centum_bi_GazzeJorge',
  password: process.env.CENTUM_BI_PASSWORD || '8601',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 30000,
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 60000,
  },
}

let pool = null

async function getPool() {
  if (!pool) {
    pool = await sql.connect(centumConfig)
    pool.on('error', (err) => {
      console.error('Error en pool Centum BI:', err)
      pool = null
    })
  }
  return pool
}

// Obtener datos de planilla de caja por PlanillaCajaID
async function getPlanillaData(planillaId) {
  const inicio = Date.now()
  try {
    const db = await getPool()

    // Info general de la planilla
    const planillaResult = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT PlanillaCajaID, FechaPlanillaCaja, Nombre, Cerrada
        FROM PlanillasCajas_VIEW
        WHERE PlanillaCajaID = @planillaId
      `)

    if (planillaResult.recordset.length === 0) {
      registrarLlamada({
        servicio: 'centum_bi', endpoint: 'PlanillasCajas_VIEW',
        metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
        origen: 'consulta',
      })
      return null
    }

    const planilla = planillaResult.recordset[0]

    // Totales agrupados por forma de pago
    const itemsResult = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT
          v.ValorID AS valor_id,
          v.DetalleValor AS forma_pago,
          SUM(pci.ImportePlanillaCajaItemID) AS total,
          COUNT(*) AS operaciones
        FROM PlanillaCaja_Items_VIEW pci
        JOIN Cobro_Items_VIEW ci ON pci.MovimientoValorIDPlanillaCajaItem = ci.CobroItemID
        JOIN Valores_VIEW v ON ci.ValorID = v.ValorID
        WHERE pci.PlanillaCajaID = @planillaId
        AND ci.ValorID > 0
        GROUP BY v.ValorID, v.DetalleValor
        ORDER BY total DESC
      `)

    const medios_pago = itemsResult.recordset.map(r => ({
      valor_id: r.valor_id,
      nombre: r.forma_pago.trim(),
      total: parseFloat(r.total.toFixed(2)),
      operaciones: r.operaciones,
    }))

    const total_general = medios_pago.reduce((sum, mp) => sum + mp.total, 0)
    const total_efectivo = medios_pago
      .filter(mp => mp.valor_id === 1)
      .reduce((sum, mp) => sum + mp.total, 0)

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'PlanillasCajas_VIEW',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      origen: 'consulta',
    })

    return {
      planilla_id: planilla.PlanillaCajaID,
      fecha: planilla.FechaPlanillaCaja,
      nombre_cajero: planilla.Nombre?.trim(),
      cerrada: planilla.Cerrada,
      medios_pago,
      total_efectivo: parseFloat(total_efectivo.toFixed(2)),
      total_general: parseFloat(total_general.toFixed(2)),
    }
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'PlanillasCajas_VIEW',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    throw err
  }
}

// Validar que una planilla exista en Centum y devolver su estado + asignación
async function validarPlanilla(planillaId) {
  const inicio = Date.now()
  try {
    const db = await getPool()
    const result = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT p.PlanillaCajaID, p.Cerrada, p.Nombre,
          p.UsuarioAsignadoIDPlanillaCaja, p.SucursalFisicaIDPlanillaCaja,
          u.NombreUsuario, s.NombreSucursalFisica
        FROM PlanillasCajas_VIEW p
        LEFT JOIN Usuarios_VIEW u ON p.UsuarioAsignadoIDPlanillaCaja = u.UsuarioID
        LEFT JOIN SucursalesFisicas_VIEW s ON p.SucursalFisicaIDPlanillaCaja = s.SucursalFisicaID
        WHERE p.PlanillaCajaID = @planillaId
      `)

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'PlanillasCajas_VIEW/validar',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      origen: 'consulta',
    })

    if (result.recordset.length === 0) {
      return { existe: false }
    }

    const planilla = result.recordset[0]
    return {
      existe: true,
      cerrada: planilla.Cerrada,
      nombre: planilla.Nombre?.trim(),
      centum_usuario_id: planilla.UsuarioAsignadoIDPlanillaCaja,
      centum_sucursal_id: planilla.SucursalFisicaIDPlanillaCaja,
      nombre_usuario: planilla.NombreUsuario?.trim(),
      nombre_sucursal: planilla.NombreSucursalFisica?.trim(),
    }
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'PlanillasCajas_VIEW/validar',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    throw err
  }
}

// Parsear descripción de notificación de venta sin confirmar
// Formato: "El usuario: Caja 1 pellegrini, en la fecha: 21/02/2026 10:05, equipo cliente: PELLEGRINI - CAJA 1 - 3
//   ha cerrado una venta en la sucursal Sucursal Pellegrini sin confirmar para el cliente ID: 0 y razón social:
//   CONSUMIDOR FINAL suc por los artículos: Código: 03641, Nombre: FOCACCIA ROMANA, Cantidad: 4,000. ..."
function parsearDescripcionVenta(descripcion) {
  try {
    const resultado = { descripcion_raw: descripcion }

    const userMatch = descripcion.match(/El usuario:\s*(.+?),\s*en la fecha/i)
    if (userMatch) resultado.usuario = userMatch[1].trim()

    const fechaMatch = descripcion.match(/en la fecha:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2})/i)
    if (fechaMatch) resultado.fecha = fechaMatch[1]

    const equipoMatch = descripcion.match(/equipo cliente:\s*(.+?)\s+ha cerrado/i)
    if (equipoMatch) resultado.equipo = equipoMatch[1].trim()

    const sucMatch = descripcion.match(/en la sucursal\s+(.+?)\s+sin confirmar/i)
    if (sucMatch) resultado.sucursal = sucMatch[1].trim()

    const clienteMatch = descripcion.match(/cliente ID:\s*(.+?)\s+y razón social:\s*(.+?)\s+por los artículos/i)
    if (clienteMatch) {
      resultado.cliente_id = clienteMatch[1].trim()
      resultado.cliente_nombre = clienteMatch[2].trim()
    }

    // Artículos: "Código: COD, Nombre: NOMBRE, Cantidad: CANT."
    const artRegex = /Código:\s*(\S+),\s*Nombre:\s*(.+?),\s*Cantidad:\s*([\d,.]+)\./g
    const articulos = []
    let match
    while ((match = artRegex.exec(descripcion)) !== null) {
      articulos.push({
        codigo: match[1],
        nombre: match[2].trim(),
        cantidad: parseFloat(match[3].replace(/\./g, '').replace(',', '.')),
      })
    }
    if (articulos.length > 0) resultado.articulos = articulos

    return resultado
  } catch {
    return { descripcion_raw: descripcion }
  }
}

// Parser CSV simple que maneja campos entre comillas
function parseCSVRow(row) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const char = row[i]
    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

// Cache de notificaciones (1 hora)
let notifCache = { data: null, timestamp: 0 }
const CACHE_TTL = 60 * 60 * 1000

async function fetchNotificacionesSheet() {
  const sheetId = process.env.GOOGLE_SHEET_NOTIFICACIONES_ID
  if (!sheetId) return []

  // Usar cache si es reciente
  if (notifCache.data && (Date.now() - notifCache.timestamp) < CACHE_TTL) {
    return notifCache.data
  }

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`
  const inicio = Date.now()
  let res
  try {
    res = await fetch(url)
  } catch (err) {
    registrarLlamada({
      servicio: 'google_sheets', endpoint: url,
      metodo: 'GET', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    return notifCache.data || []
  }

  if (!res.ok) {
    console.error('Error al fetchear Google Sheet:', res.status)
    registrarLlamada({
      servicio: 'google_sheets', endpoint: url,
      metodo: 'GET', estado: 'error', status_code: res.status,
      duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${res.status}`, origen: 'consulta',
    })
    return notifCache.data || []
  }

  const text = await res.text()
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) {
    registrarLlamada({
      servicio: 'google_sheets', endpoint: url,
      metodo: 'GET', estado: 'ok', status_code: res.status,
      duracion_ms: Date.now() - inicio, items_procesados: 0,
      origen: 'consulta',
    })
    return []
  }

  // Parsear header para detectar columnas
  const header = parseCSVRow(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''))

  const idxId = header.findIndex(h => /NotificacionID/i.test(h))
  const idxDesc = header.findIndex(h => /Descripcion/i.test(h))
  const idxUser = header.findIndex(h => /UsuarioIDAlta/i.test(h))
  const idxFecha = header.findIndex(h => /FechaCreacion/i.test(h))

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i])
    if (cols.length < header.length) continue
    rows.push({
      notificacion_id: parseInt(cols[idxId]?.replace(/"/g, '')) || 0,
      descripcion: cols[idxDesc]?.replace(/^"|"$/g, '') || '',
      usuario_id_alta: parseInt(cols[idxUser]?.replace(/"/g, '')) || 0,
      fecha_creacion: cols[idxFecha]?.replace(/^"|"$/g, '') || '',
    })
  }

  registrarLlamada({
    servicio: 'google_sheets', endpoint: url,
    metodo: 'GET', estado: 'ok', status_code: res.status,
    duracion_ms: Date.now() - inicio, items_procesados: rows.length,
    origen: 'consulta',
  })

  notifCache = { data: rows, timestamp: Date.now() }
  return rows
}

// Obtener ventas cerradas sin confirmar para una sesión de caja
async function getVentasSinConfirmar(planillaId) {
  const inicio = Date.now()
  try {
    const db = await getPool()

    // 1. Obtener usuario y fecha de la planilla desde BI
    const planillaResult = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT UsuarioAsignadoIDPlanillaCaja, FechaPlanillaCaja
        FROM PlanillasCajas_VIEW
        WHERE PlanillaCajaID = @planillaId
      `)

    if (planillaResult.recordset.length === 0) {
      registrarLlamada({
        servicio: 'centum_bi', endpoint: 'VentasSinConfirmar',
        metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
        origen: 'consulta',
      })
      return { cantidad: 0, ventas: [] }
    }

    const { UsuarioAsignadoIDPlanillaCaja: usuarioId, FechaPlanillaCaja: fechaPlanilla } = planillaResult.recordset[0]

    // Normalizar fecha de planilla a DD/MM/YYYY para comparar
    const fp = new Date(fechaPlanilla)
    const fechaStr = `${String(fp.getDate()).padStart(2, '0')}/${String(fp.getMonth() + 1).padStart(2, '0')}/${fp.getFullYear()}`

    // 2. Leer notificaciones del Google Sheet
    const todas = await fetchNotificacionesSheet()

    // 3. Filtrar por UsuarioIDAlta + misma fecha
    const filtradas = todas.filter(n => {
      if (n.usuario_id_alta !== usuarioId) return false
      // Comparar fecha: el campo viene como "DD/MM/YYYY HH:MM:SS"
      const fechaNotif = n.fecha_creacion.split(' ')[0]
      return fechaNotif === fechaStr
    })

    const ventas = filtradas.map(n => ({
      id: n.notificacion_id,
      fecha_creacion: n.fecha_creacion,
      ...parsearDescripcionVenta(n.descripcion),
    }))

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasSinConfirmar',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: ventas.length, origen: 'consulta',
    })

    return { cantidad: ventas.length, ventas }
  } catch (err) {
    console.error('Error al obtener ventas sin confirmar:', err)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasSinConfirmar',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    return { cantidad: 0, ventas: [] }
  }
}

// Obtener comprobantes (facturas, NC, ND, anticipos) asociados a una planilla de caja
async function getComprobantesData(planillaId) {
  const inicio = Date.now()
  try {
    const db = await getPool()

    // Query 1: Resumen por tipo de comprobante
    // Join path: PlanillaCaja_Items → Cobro_Items (pago, ValorID>0) → CobroID →
    //   Cobro_Items (cancelación, ValorID=0) → Cobro_Cancelaciones → Ventas → TipoComprobantes
    const resumenResult = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT tc.TipoComprobanteID, tc.CodigoComprobante, tc.NombreComprobante,
          COUNT(DISTINCT cc.CanceladoID) AS cantidad,
          SUM(pci.ImportePlanillaCajaItemID) AS total
        FROM PlanillaCaja_Items_VIEW pci
        JOIN Cobro_Items_VIEW ci_valor ON pci.MovimientoValorIDPlanillaCajaItem = ci_valor.CobroItemID
          AND ci_valor.ValorID > 0
        JOIN Cobro_Items_VIEW ci_cancel ON ci_valor.CobroID = ci_cancel.CobroID
          AND ci_cancel.ValorID = 0
          AND ci_cancel.TipoItemCobroID = 1
        JOIN Cobro_Cancelaciones_VIEW cc ON ci_cancel.CobroItemID = cc.CobroItemID
        JOIN TipoComprobantes_VIEW tc ON cc.CanceladoTipoComprobanteID = tc.TipoComprobanteID
        WHERE pci.PlanillaCajaID = @planillaId
        GROUP BY tc.TipoComprobanteID, tc.CodigoComprobante, tc.NombreComprobante
        ORDER BY cantidad DESC
      `)

    const resumen = resumenResult.recordset.map(r => ({
      tipo_id: r.TipoComprobanteID,
      codigo: r.CodigoComprobante.trim(),
      nombre: r.NombreComprobante.trim(),
      cantidad: r.cantidad,
      total: parseFloat(r.total.toFixed(2)),
    }))

    const total_comprobantes = resumen.reduce((sum, r) => sum + r.cantidad, 0)

    // Query 2: Detalle de Notas de Crédito (TipoComprobanteID = 6)
    const ncResult = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT DISTINCT v.VentaID, v.NumeroDocumento, v.FechaDocumento, v.Total,
          v.ClienteID, cl.RazonSocialCliente
        FROM PlanillaCaja_Items_VIEW pci
        JOIN Cobro_Items_VIEW ci_valor ON pci.MovimientoValorIDPlanillaCajaItem = ci_valor.CobroItemID
          AND ci_valor.ValorID > 0
        JOIN Cobro_Items_VIEW ci_cancel ON ci_valor.CobroID = ci_cancel.CobroID
          AND ci_cancel.ValorID = 0
          AND ci_cancel.TipoItemCobroID = 1
        JOIN Cobro_Cancelaciones_VIEW cc ON ci_cancel.CobroItemID = cc.CobroItemID
        LEFT JOIN Ventas_VIEW v ON cc.CanceladoID = v.VentaID
        LEFT JOIN Clientes_VIEW cl ON v.ClienteID = cl.ClienteID
        WHERE pci.PlanillaCajaID = @planillaId
        AND cc.CanceladoTipoComprobanteID = 6
      `)

    // Query 3: Artículos de cada NC
    const notas_credito = []
    for (const nc of ncResult.recordset) {
      if (!nc.VentaID) continue

      const artResult = await db.request()
        .input('vid', sql.Int, nc.VentaID)
        .query(`
          SELECT vi.ArticuloID, vi.Cantidad, vi.Precio,
            a.CodigoArticulo, a.NombreArticulo
          FROM Venta_Items_VIEW vi
          LEFT JOIN Articulos_VIEW a ON vi.ArticuloID = a.ArticuloID
          WHERE vi.VentaID = @vid
        `)

      notas_credito.push({
        venta_id: nc.VentaID,
        numero: nc.NumeroDocumento?.trim() || null,
        fecha: nc.FechaDocumento,
        total: parseFloat(nc.Total),
        cliente: nc.RazonSocialCliente?.trim() || null,
        articulos: artResult.recordset.map(a => ({
          codigo: a.CodigoArticulo?.trim() || null,
          nombre: a.NombreArticulo?.trim() || null,
          cantidad: a.Cantidad,
          precio: parseFloat(a.Precio),
        })),
      })
    }

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'Comprobantes_VIEW',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: total_comprobantes, origen: 'consulta',
    })

    return { resumen, total_comprobantes, notas_credito }
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'Comprobantes_VIEW',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    throw err
  }
}

module.exports = { getPool, getPlanillaData, validarPlanilla, getVentasSinConfirmar, getComprobantesData }
