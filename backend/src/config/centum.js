// Conexión al SQL Server de Centum BI (modelo de datos del ERP)
const sql = require('mssql')
const { registrarLlamada } = require('../services/apiLogger')
const logger = require('./logger')

// Validar que las variables de entorno requeridas existan
const requiredEnvVars = ['CENTUM_BI_SERVER', 'CENTUM_BI_PORT', 'CENTUM_BI_DATABASE', 'CENTUM_BI_USER', 'CENTUM_BI_PASSWORD']
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    logger.warn(`[Centum BI] Variable de entorno ${varName} no configurada`)
  }
}

const centumConfig = {
  server: process.env.CENTUM_BI_SERVER,
  port: parseInt(process.env.CENTUM_BI_PORT || '22455'),
  database: process.env.CENTUM_BI_DATABASE,
  user: process.env.CENTUM_BI_USER,
  password: process.env.CENTUM_BI_PASSWORD,
  options: {
    encrypt: process.env.CENTUM_BI_ENCRYPT !== 'false',
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
      logger.error('Error en pool Centum BI:', err)
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
    logger.error('Error al fetchear Google Sheet:', res.status)
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
  const idxFecha = header.findIndex(h => /FechaCreacion/i.test(h))

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i])
    if (cols.length < Math.max(idxId, idxDesc, idxFecha) + 1) continue
    rows.push({
      notificacion_id: Number(cols[idxId]?.replace(/"/g, '')) || 0,
      descripcion: cols[idxDesc]?.replace(/^"|"$/g, '') || '',
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

    // 1. Obtener nombre de usuario y fecha de la planilla desde BI
    const planillaResult = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT p.FechaPlanillaCaja, u.NombreUsuario
        FROM PlanillasCajas_VIEW p
        LEFT JOIN Usuarios_VIEW u ON p.UsuarioAsignadoIDPlanillaCaja = u.UsuarioID
        WHERE p.PlanillaCajaID = @planillaId
      `)

    if (planillaResult.recordset.length === 0) {
      registrarLlamada({
        servicio: 'centum_bi', endpoint: 'VentasSinConfirmar',
        metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
        origen: 'consulta',
      })
      return { cantidad: 0, ventas: [] }
    }

    const { NombreUsuario: nombreUsuario, FechaPlanillaCaja: fechaPlanilla } = planillaResult.recordset[0]
    const nombreNorm = (nombreUsuario || '').trim().toLowerCase()

    // Normalizar fecha de planilla a DD/MM/YYYY para comparar (usar UTC para evitar desfase de timezone)
    const fp = new Date(fechaPlanilla)
    const fechaStr = `${String(fp.getUTCDate()).padStart(2, '0')}/${String(fp.getUTCMonth() + 1).padStart(2, '0')}/${fp.getUTCFullYear()}`

    // 2. Leer notificaciones del Google Sheet
    const todas = await fetchNotificacionesSheet()

    // 3. Filtrar por nombre de usuario (extraído de la descripción) + misma fecha
    const filtradas = todas.filter(n => {
      // Comparar fecha: el campo viene como "DD/MM/YYYY HH:MM:SS"
      const fechaNotif = n.fecha_creacion.split(' ')[0]
      if (fechaNotif !== fechaStr) return false
      // Matchear nombre de usuario de la descripción contra el de la planilla
      const userMatch = n.descripcion.match(/El usuario:\s*(.+?),\s*en la fecha/i)
      if (!userMatch) return false
      return userMatch[1].trim().toLowerCase() === nombreNorm
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
    logger.error('Error al obtener ventas sin confirmar:', err)
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

// ═══════════════════════════════════════════════════════════════
// FASE 3: Funciones para el agente investigador de IA
// ═══════════════════════════════════════════════════════════════

/**
 * Obtiene detalle de todas las transacciones de una planilla con timestamps
 * Útil para detectar duplicados o transacciones sospechosas
 * @param {number} planillaId - ID de planilla en Centum
 * @returns {Array} Lista de transacciones con detalles
 */
async function getTransaccionesDetalle(planillaId, { limit = 100 } = {}) {
  const inicio = Date.now()
  try {
    const db = await getPool()

    const result = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .query(`
        SELECT
          pci.PlanillaCajaItemID AS transaccion_id,
          pci.ImportePlanillaCajaItemID AS importe,
          pci.MovimientoValorIDPlanillaCajaItem AS cobro_item_id,
          ci.CobroID AS cobro_id,
          v.ValorID AS valor_id,
          v.DetalleValor AS forma_pago,
          ci_cancel.CobroItemID AS cancelacion_item_id,
          cc.CanceladoID AS documento_id,
          cc.CanceladoTipoComprobanteID AS tipo_comprobante_id,
          tc.CodigoComprobante AS codigo_comprobante,
          tc.NombreComprobante AS tipo_comprobante,
          ven.NumeroDocumento AS numero_documento,
          ven.FechaDocumento AS fecha_documento,
          ven.FechaCreacion AS hora_creacion,
          ven.Total AS total_documento
        FROM PlanillaCaja_Items_VIEW pci
        JOIN Cobro_Items_VIEW ci ON pci.MovimientoValorIDPlanillaCajaItem = ci.CobroItemID
        JOIN Valores_VIEW v ON ci.ValorID = v.ValorID
        LEFT JOIN Cobro_Items_VIEW ci_cancel ON ci.CobroID = ci_cancel.CobroID
          AND ci_cancel.ValorID = 0
          AND ci_cancel.TipoItemCobroID = 1
        LEFT JOIN Cobro_Cancelaciones_VIEW cc ON ci_cancel.CobroItemID = cc.CobroItemID
        LEFT JOIN TipoComprobantes_VIEW tc ON cc.CanceladoTipoComprobanteID = tc.TipoComprobanteID
        LEFT JOIN Ventas_VIEW ven ON cc.CanceladoID = ven.VentaID
        WHERE pci.PlanillaCajaID = @planillaId
        AND ci.ValorID > 0
        ORDER BY pci.PlanillaCajaItemID
      `)

    const transacciones = result.recordset.map(r => ({
      transaccion_id: r.transaccion_id,
      importe: parseFloat(r.importe?.toFixed(2) || 0),
      forma_pago: r.forma_pago?.trim() || null,
      valor_id: r.valor_id,
      cobro_id: r.cobro_id,
      documento_id: r.documento_id,
      tipo_comprobante: r.tipo_comprobante?.trim() || null,
      codigo_comprobante: r.codigo_comprobante?.trim() || null,
      numero_documento: r.numero_documento?.trim() || null,
      fecha_documento: r.fecha_documento || null,
      hora_creacion: r.hora_creacion || null,
      total_documento: r.total_documento ? parseFloat(r.total_documento.toFixed(2)) : null,
    }))

    // Detectar posibles duplicados (misma forma_pago + mismo importe + mismo cobro en corto tiempo)
    const duplicadosSospechosos = []
    for (let i = 0; i < transacciones.length; i++) {
      for (let j = i + 1; j < transacciones.length; j++) {
        const a = transacciones[i]
        const b = transacciones[j]
        if (a.forma_pago === b.forma_pago &&
            Math.abs(a.importe - b.importe) < 0.01 &&
            a.importe > 100 &&
            a.numero_documento === b.numero_documento) {
          duplicadosSospechosos.push({
            monto: a.importe,
            forma_pago: a.forma_pago,
            documento: a.numero_documento,
            ids: [a.transaccion_id, b.transaccion_id],
          })
        }
      }
    }

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'TransaccionesDetalle',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: transacciones.length, origen: 'consulta',
    })

    return {
      total: transacciones.length,
      transacciones: limit ? transacciones.slice(0, limit) : transacciones,
      duplicados_sospechosos: duplicadosSospechosos,
      resumen_por_forma_pago: Object.values(
        transacciones.reduce((acc, t) => {
          const key = t.forma_pago || 'DESCONOCIDO'
          if (!acc[key]) acc[key] = { forma_pago: key, total: 0, cantidad: 0 }
          acc[key].total += t.importe
          acc[key].cantidad++
          return acc
        }, {})
      ),
    }
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'TransaccionesDetalle',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    throw err
  }
}

/**
 * Busca comprobantes que coincidan con un monto específico (con tolerancia)
 * @param {number} planillaId - ID de planilla
 * @param {number} monto - Monto a buscar
 * @param {number} tolerancia - Tolerancia en pesos (+/-)
 * @returns {Array} Comprobantes que coinciden
 */
async function buscarComprobantesPorMonto(planillaId, monto, tolerancia = 100) {
  const inicio = Date.now()
  try {
    const db = await getPool()
    const montoAbs = Math.abs(monto)

    const result = await db.request()
      .input('planillaId', sql.Int, planillaId)
      .input('montoMin', sql.Decimal(12, 2), montoAbs - tolerancia)
      .input('montoMax', sql.Decimal(12, 2), montoAbs + tolerancia)
      .input('montoAbs', sql.Decimal(12, 2), montoAbs)
      .query(`
        SELECT DISTINCT
          ven.VentaID,
          ven.NumeroDocumento,
          ven.FechaDocumento,
          ven.Total,
          tc.CodigoComprobante,
          tc.NombreComprobante,
          cl.RazonSocialCliente
        FROM PlanillaCaja_Items_VIEW pci
        JOIN Cobro_Items_VIEW ci_valor ON pci.MovimientoValorIDPlanillaCajaItem = ci_valor.CobroItemID
          AND ci_valor.ValorID > 0
        JOIN Cobro_Items_VIEW ci_cancel ON ci_valor.CobroID = ci_cancel.CobroID
          AND ci_cancel.ValorID = 0
          AND ci_cancel.TipoItemCobroID = 1
        JOIN Cobro_Cancelaciones_VIEW cc ON ci_cancel.CobroItemID = cc.CobroItemID
        JOIN Ventas_VIEW ven ON cc.CanceladoID = ven.VentaID
        JOIN TipoComprobantes_VIEW tc ON cc.CanceladoTipoComprobanteID = tc.TipoComprobanteID
        LEFT JOIN Clientes_VIEW cl ON ven.ClienteID = cl.ClienteID
        WHERE pci.PlanillaCajaID = @planillaId
        AND ABS(ven.Total) BETWEEN @montoMin AND @montoMax
        ORDER BY ABS(ven.Total - @montoAbs) ASC
      `)

    const comprobantes = result.recordset.map(r => ({
      venta_id: r.VentaID,
      numero: r.NumeroDocumento?.trim() || null,
      fecha: r.FechaDocumento,
      total: parseFloat(r.Total),
      tipo: r.NombreComprobante?.trim() || null,
      codigo: r.CodigoComprobante?.trim() || null,
      cliente: r.RazonSocialCliente?.trim() || null,
      diferencia_vs_buscado: parseFloat((Math.abs(r.Total) - montoAbs).toFixed(2)),
    }))

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'ComprobantesPorMonto',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: comprobantes.length, origen: 'consulta',
    })

    return {
      monto_buscado: monto,
      tolerancia,
      encontrados: comprobantes.length,
      comprobantes,
    }
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'ComprobantesPorMonto',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    throw err
  }
}

// Cache de turnos de factura (una factura nunca cambia de turno después de creada)
const turnoCache = new Map() // nroDocumento → { turnoId, turnoNombre, timestamp }
const TURNO_CACHE_TTL = 30 * 60 * 1000 // 30 minutos

/**
 * Obtiene el TurnoEntrega de facturas por NumeroDocumento.
 * Consulta Ventas_VIEW + TurnosEntrega_VIEW en el SQL Server de Centum BI.
 * Usa cache en memoria para evitar consultas repetidas.
 * @param {string[]} nroDocumentos - Array de NumeroDocumento (ej: ["B00002-00007584"])
 * @returns {Object} Mapa { nroDocumento: { turnoId, turnoNombre } }
 */
async function getFacturasTurno(nroDocumentos) {
  if (!nroDocumentos || nroDocumentos.length === 0) return {}

  const ahora = Date.now()
  const resultado = {}
  const sinCache = []

  // Revisar cache primero
  for (const doc of nroDocumentos) {
    const cached = turnoCache.get(doc)
    if (cached && (ahora - cached.timestamp) < TURNO_CACHE_TTL) {
      resultado[doc] = { turnoId: cached.turnoId, turnoNombre: cached.turnoNombre }
    } else {
      sinCache.push(doc)
    }
  }

  // Si todo estaba en cache, retornar directo
  if (sinCache.length === 0) return resultado

  const inicio = Date.now()
  try {
    const db = await getPool()

    const placeholders = sinCache.map((_, i) => `@doc${i}`).join(', ')
    const request = db.request()
    sinCache.forEach((doc, i) => request.input(`doc${i}`, sql.VarChar, doc))

    const result = await request.query(`
      SELECT v.NumeroDocumento, v.TurnoEntregaID, t.NombreTurnoEntrega
      FROM Ventas_VIEW v
      LEFT JOIN TurnosEntrega_VIEW t ON v.TurnoEntregaID = t.TurnoEntregaID
      WHERE v.NumeroDocumento IN (${placeholders})
      AND v.Anulado = 0
    `)

    for (const r of result.recordset) {
      const doc = r.NumeroDocumento?.trim()
      if (doc) {
        const turno = {
          turnoId: r.TurnoEntregaID,
          turnoNombre: r.NombreTurnoEntrega?.trim() || null,
        }
        resultado[doc] = turno
        turnoCache.set(doc, { ...turno, timestamp: ahora })
      }
    }

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'FacturasTurnoEntrega',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: result.recordset.length, origen: 'consulta',
    })

    return resultado
  } catch (err) {
    logger.error('[Centum BI] Error al obtener turnos de facturas:', err.message)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'FacturasTurnoEntrega',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    return resultado // retornar lo que teníamos en cache
  }
}

/**
 * Obtiene ventas de Centum BI por rango de fecha.
 * @param {string} fechaDesde - YYYY-MM-DD
 * @param {string} fechaHasta - YYYY-MM-DD
 * @returns {Array} recordset de ventas
 */
async function getVentasCentumByFecha(fechaDesde, fechaHasta) {
  const inicio = Date.now()
  try {
    const db = await getPool()
    const result = await db.request()
      .input('fechaDesde', sql.VarChar, fechaDesde)
      .input('fechaHasta', sql.VarChar, fechaHasta)
      .query(`
        SELECT v.VentaID, v.NumeroDocumento, v.FechaDocumento,
               v.FechaCreacion, v.Total, v.ClienteID, v.Anulado
        FROM Ventas_VIEW v
        WHERE v.FechaDocumento >= @fechaDesde
          AND v.FechaDocumento <= @fechaHasta
          AND v.Anulado = 0
        ORDER BY v.VentaID
      `)

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasCentumByFecha',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: result.recordset.length, origen: 'reconciliacion',
    })

    return result.recordset
  } catch (err) {
    logger.error('[Centum BI] Error al obtener ventas por fecha:', err.message)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasCentumByFecha',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'reconciliacion',
    })
    throw err
  }
}

/**
 * Obtiene resumen de ventas de Centum BI para comparar con POS.
 * Consulta Ventas_VIEW agrupando por tipo comprobante y división.
 * @param {string} fechaDesde - YYYY-MM-DD
 * @param {string} fechaHasta - YYYY-MM-DD
 * @param {number[]} [sucursalIds] - IDs de sucursales físicas Centum (opcional)
 * @returns {Object} { totalVentas, totalNC, totalEmpresa, totalPrueba, cantVentas, cantNC }
 */
async function getResumenVentasCentumBI(fechaDesde, fechaHasta, sucursalIds, divisionId, usuarioId) {
  const inicio = Date.now()
  try {
    const db = await getPool()

    // Query principal: agrupar por tipo comprobante
    // TipoComprobanteVentaID: 4=Factura B, 1=Factura A, 6=NC B, 3=NC A, etc.
    // DivisionEmpresaGrupoEconomicoID: 2=PRUEBA, 3=EMPRESA
    let whereExtra = ''
    const request = db.request()
      .input('fechaDesde', sql.VarChar, fechaDesde)
      .input('fechaHasta', sql.VarChar, fechaHasta + 'T23:59:59')

    if (sucursalIds && sucursalIds.length > 0) {
      const placeholders = sucursalIds.map((id, i) => {
        request.input(`suc${i}`, sql.Int, id)
        return `@suc${i}`
      }).join(',')
      whereExtra = ` AND v.SucursalFisicaID IN (${placeholders})`
    }

    if (divisionId) {
      request.input('divId', sql.Int, divisionId)
      whereExtra += ` AND v.DivisionEmpresaGrupoEconomicoID = @divId`
    }

    if (usuarioId) {
      request.input('usuarioId', sql.Int, usuarioId)
      whereExtra += ` AND v.UsuarioID = @usuarioId`
    }

    const result = await request.query(`
      SELECT
        v.TipoComprobanteID,
        v.DivisionEmpresaGrupoEconomicoID,
        COUNT(*) AS cantidad,
        SUM(v.Total) AS total
      FROM Ventas_VIEW v
      WHERE v.FechaDocumento >= @fechaDesde
        AND v.FechaDocumento <= @fechaHasta
        AND v.Anulado = 0
        ${whereExtra}
      GROUP BY v.TipoComprobanteID, v.DivisionEmpresaGrupoEconomicoID
    `)

    let totalVentas = 0
    let totalNC = 0
    let totalEmpresa = 0
    let totalPrueba = 0
    let cantVentas = 0
    let cantNC = 0

    // TipoComprobanteVentaID: 3=NC A, 6=NC B son notas de crédito
    const tiposNC = [3, 6, 7, 8] // NC A, NC B, NC C, NC E

    for (const row of result.recordset) {
      const esNC = tiposNC.includes(row.TipoComprobanteID)
      const total = parseFloat(row.total) || 0
      const cant = row.cantidad || 0

      if (esNC) {
        totalNC -= Math.abs(total) // NC como negativo
        cantNC += cant
      } else {
        totalVentas += total
        cantVentas += cant
      }

      if (row.DivisionEmpresaGrupoEconomicoID === 3) {
        totalEmpresa += esNC ? -Math.abs(total) : total
      } else if (row.DivisionEmpresaGrupoEconomicoID === 2) {
        totalPrueba += esNC ? -Math.abs(total) : total
      }
    }

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'ResumenVentasCentumBI',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: cantVentas + cantNC, origen: 'reconciliacion',
    })

    return {
      totalVentas: Math.round(totalVentas * 100) / 100,
      totalNC: Math.round(totalNC * 100) / 100,
      totalEmpresa: Math.round(totalEmpresa * 100) / 100,
      totalPrueba: Math.round(totalPrueba * 100) / 100,
      cantVentas,
      cantNC,
    }
  } catch (err) {
    logger.error('[Centum BI] Error al obtener resumen ventas:', err.message)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'ResumenVentasCentumBI',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'reconciliacion',
    })
    throw err
  }
}

/**
 * Obtiene ventas detalladas de Centum BI con cliente y usuario para conciliación.
 * @param {string} fechaDesde - YYYY-MM-DD
 * @param {string} fechaHasta - YYYY-MM-DD
 * @returns {Array} recordset con campos extendidos
 */
async function getVentasCentumDetallado(fechaDesde, fechaHasta) {
  const inicio = Date.now()
  try {
    const db = await getPool()
    const result = await db.request()
      .input('fechaDesde', sql.VarChar, fechaDesde)
      .input('fechaHasta', sql.VarChar, fechaHasta)
      .query(`
        SELECT v.VentaID, v.NumeroDocumento, v.FechaDocumento,
               v.FechaCreacion, v.Total, v.ClienteID, v.Anulado,
               v.TipoComprobanteID, v.SucursalFisicaID,
               v.DivisionEmpresaGrupoEconomicoID,
               v.UsuarioID,
               c.RazonSocialCliente,
               s.NombreSucursalFisica
        FROM Ventas_VIEW v
        LEFT JOIN Clientes_VIEW c ON c.ClienteID = v.ClienteID
        LEFT JOIN SucursalesFisicas_VIEW s ON s.SucursalFisicaID = v.SucursalFisicaID
        WHERE v.FechaDocumento >= @fechaDesde
          AND v.FechaDocumento <= @fechaHasta
          AND v.Anulado = 0
        ORDER BY v.VentaID
      `)

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasCentumDetallado',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: result.recordset.length, origen: 'conciliacion',
    })

    return result.recordset
  } catch (err) {
    logger.error('[Centum BI] Error al obtener ventas detallado:', err.message)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasCentumDetallado',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'conciliacion',
    })
    throw err
  }
}

/**
 * Obtiene todas las ventas del Usuario API (1301) y las NC del mismo usuario,
 * para detectar facturas duplicadas cruzando con ventas_pos.
 * @param {number[]} ventaIds - VentaIDs conocidos de ventas_pos para identificar las "reales"
 * @returns {{ ventas: Array, notasCredito: Array }}
 */
async function getVentasPOSParaDuplicados(ventaIds) {
  const inicio = Date.now()
  try {
    const db = await getPool()

    // Todas las facturas (no NC) del usuario API 1301
    const ventasResult = await db.request().query(`
      SELECT v.VentaID, v.NumeroDocumento, v.FechaDocumento, v.FechaCreacion,
             v.Total, v.ClienteID, v.TipoComprobanteID, v.SucursalFisicaID,
             v.DivisionEmpresaGrupoEconomicoID,
             c.RazonSocialCliente, s.NombreSucursalFisica
      FROM Ventas_VIEW v
      LEFT JOIN Clientes_VIEW c ON c.ClienteID = v.ClienteID
      LEFT JOIN SucursalesFisicas_VIEW s ON s.SucursalFisicaID = v.SucursalFisicaID
      WHERE v.UsuarioID = 1301
        AND v.TipoComprobanteID NOT IN (3, 6, 7, 8)
        AND v.Anulado = 0
      ORDER BY v.VentaID
    `)

    // NC de TODOS los usuarios en sucursales POS (la NC puede haberse generado manualmente)
    // Filtrar por sucursales que usa el POS para no traer todo el sistema
    const sucursalIds = [...new Set(ventasResult.recordset.map(v => v.SucursalFisicaID).filter(Boolean))]
    let ncQuery = `
      SELECT VentaID, NumeroDocumento, Total, ClienteID, FechaCreacion,
             SucursalFisicaID, Referencia
      FROM Ventas_VIEW
      WHERE TipoComprobanteID IN (3, 6)
        AND Anulado = 0
    `
    const ncRequest = db.request()
    if (sucursalIds.length > 0) {
      const placeholders = sucursalIds.map((id, i) => {
        ncRequest.input(`ncsuc${i}`, sql.Int, id)
        return `@ncsuc${i}`
      }).join(',')
      ncQuery += ` AND SucursalFisicaID IN (${placeholders})`
    }
    const ncResult = await ncRequest.query(ncQuery)

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasPOSParaDuplicados',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: ventasResult.recordset.length, origen: 'duplicados',
    })

    return {
      ventas: ventasResult.recordset,
      notasCredito: ncResult.recordset,
    }
  } catch (err) {
    logger.error('[Centum BI] Error al obtener ventas para duplicados:', err.message)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasPOSParaDuplicados',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'duplicados',
    })
    throw err
  }
}

/**
 * Lista paginada de ventas de Centum BI por Usuario Api (1301).
 */
async function getVentasCentumPaginado(fechaDesde, fechaHasta, options = {}) {
  const { sucursalIds, divisionId, tiposComprobante, buscarCliente, buscarNumero, page = 1, pageSize = 50 } = options
  const inicio = Date.now()
  try {
    const db = await getPool()
    const request = db.request()
      .input('fechaDesde', sql.VarChar, fechaDesde)
      .input('fechaHasta', sql.VarChar, fechaHasta + 'T23:59:59')
      .input('offset', sql.Int, (page - 1) * pageSize)
      .input('pageSize', sql.Int, pageSize)

    let whereExtra = ''

    if (sucursalIds && sucursalIds.length > 0) {
      const placeholders = sucursalIds.map((id, i) => {
        request.input(`suc${i}`, sql.Int, id)
        return `@suc${i}`
      }).join(',')
      whereExtra += ` AND v.SucursalFisicaID IN (${placeholders})`
    }

    if (divisionId) {
      request.input('divId', sql.Int, divisionId)
      whereExtra += ` AND v.DivisionEmpresaGrupoEconomicoID = @divId`
    }

    if (tiposComprobante && tiposComprobante.length > 0) {
      const ph = tiposComprobante.map((id, i) => {
        request.input(`tc${i}`, sql.Int, id)
        return `@tc${i}`
      }).join(',')
      whereExtra += ` AND v.TipoComprobanteID IN (${ph})`
    }

    if (buscarCliente) {
      request.input('buscarCliente', sql.VarChar, `%${buscarCliente}%`)
      whereExtra += ` AND c.RazonSocialCliente LIKE @buscarCliente`
    }

    if (buscarNumero) {
      request.input('buscarNumero', sql.VarChar, `%${buscarNumero}%`)
      whereExtra += ` AND v.NumeroDocumento LIKE @buscarNumero`
    }

    const result = await request.query(`
      SELECT v.VentaID, v.NumeroDocumento, v.FechaDocumento, v.FechaCreacion,
             v.Total, v.SubTotal, v.IVA, v.ClienteID, v.TipoComprobanteID,
             v.SucursalFisicaID, v.DivisionEmpresaGrupoEconomicoID,
             c.RazonSocialCliente, s.NombreSucursalFisica,
             COUNT(*) OVER() AS _totalCount
      FROM Ventas_VIEW v
      LEFT JOIN Clientes_VIEW c ON c.ClienteID = v.ClienteID
      LEFT JOIN SucursalesFisicas_VIEW s ON s.SucursalFisicaID = v.SucursalFisicaID
      WHERE v.UsuarioID = 1301
        AND v.FechaDocumento >= @fechaDesde
        AND v.FechaDocumento <= @fechaHasta
        AND v.Anulado = 0
        ${whereExtra}
      ORDER BY v.FechaDocumento DESC, v.VentaID DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `)

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasCentumPaginado',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: result.recordset.length, origen: 'auditoria',
    })

    const totalCount = result.recordset[0]?._totalCount || 0
    const ventas = result.recordset.map(({ _totalCount, ...rest }) => rest)

    return { ventas, totalCount }
  } catch (err) {
    logger.error('[Centum BI] Error en getVentasCentumPaginado:', err.message)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentasCentumPaginado',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'auditoria',
    })
    throw err
  }
}

/**
 * Detalle completo de una venta de Centum BI: datos cabecera + items.
 */
async function getVentaCentumDetalle(ventaId) {
  const inicio = Date.now()
  try {
    const db = await getPool()

    const [ventaResult, itemsResult] = await Promise.all([
      db.request()
        .input('ventaId', sql.Int, ventaId)
        .query(`
          SELECT v.*,
                 c.RazonSocialCliente, c.CUITCliente, c.CodigoCliente,
                 c.CondicionIVAClienteID, c.DireccionCliente, c.LocalidadCliente,
                 s.NombreSucursalFisica,
                 u.NombreUsuario,
                 vend.NombreVendedor
          FROM Ventas_VIEW v
          LEFT JOIN Clientes_VIEW c ON c.ClienteID = v.ClienteID
          LEFT JOIN SucursalesFisicas_VIEW s ON s.SucursalFisicaID = v.SucursalFisicaID
          LEFT JOIN Usuarios_VIEW u ON u.UsuarioID = v.UsuarioID
          LEFT JOIN Vendedores_VIEW vend ON vend.VendedorID = v.VendedorID
          WHERE v.VentaID = @ventaId
        `),
      db.request()
        .input('ventaId', sql.Int, ventaId)
        .query(`
          SELECT vi.*, a.NombreArticulo, a.CodigoArticulo
          FROM Venta_Items_VIEW vi
          LEFT JOIN Articulos_VIEW a ON a.ArticuloID = vi.ArticuloID
          WHERE vi.VentaID = @ventaId
          ORDER BY vi.VentaItemID
        `),
    ])

    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentaCentumDetalle',
      metodo: 'QUERY', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: itemsResult.recordset.length, origen: 'auditoria',
    })

    const venta = ventaResult.recordset[0] || null
    if (venta) venta.items = itemsResult.recordset

    return venta
  } catch (err) {
    logger.error('[Centum BI] Error en getVentaCentumDetalle:', err.message)
    registrarLlamada({
      servicio: 'centum_bi', endpoint: 'VentaCentumDetalle',
      metodo: 'QUERY', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'auditoria',
    })
    throw err
  }
}

module.exports = {
  getPool, getPlanillaData, validarPlanilla, getVentasSinConfirmar, getComprobantesData,
  getTransaccionesDetalle, buscarComprobantesPorMonto, getFacturasTurno, getVentasCentumByFecha,
  getResumenVentasCentumBI, getVentasCentumDetallado, getVentasPOSParaDuplicados,
  getVentasCentumPaginado, getVentaCentumDetalle,
}
