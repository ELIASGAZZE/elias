// Servicio para crear Ventas POS en Centum ERP (sin PedidoVenta previo)
const { generateAccessToken } = require('./syncERP')
const { registrarLlamada } = require('./apiLogger')
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

// Fallback: operador de env var (para backwards compat)
const OPERADOR_MOVIL_USER_PRUEBA = process.env.CENTUM_OPERADOR_PRUEBA_USER || 'api123'

// Redondear cantidad para evitar errores de punto flotante (ej 3.001 → 3)
// Redondea a 3 decimales, y si queda a menos de 0.005 de un entero, redondea al entero
function redondearCantidad(cant) {
  let c = Math.round(parseFloat(cant || 1) * 1000) / 1000
  if (Math.abs(c - Math.round(c)) < 0.005) c = Math.round(c)
  return c || 1
}

function getHeaders({ operadorMovilUser } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
  if (operadorMovilUser) {
    headers['CentumSuiteOperadorMovilUser'] = operadorMovilUser
  }
  return headers
}

// Mapeo de medios de pago POS → IdValor Centum
const MEDIO_A_ID_VALOR = {
  efectivo: 1,
  debito: 13,
  credito: 13,
  qr: 13,
  cuenta_corriente: 1,
  gift_card: 1,
  saldo: 1,
}

/**
 * Crea una Venta directa en Centum desde el POS (sin PedidoVenta previo).
 * @param {Object} params
 * @param {number} params.idCliente - IdCliente Centum
 * @param {number} params.sucursalFisicaId - IdSucursalFisica Centum
 * @param {number} params.idDivisionEmpresa - 2=PRUEBA, 3=EMPRESA
 * @param {number} params.puntoVenta - Punto de venta Centum (de la caja)
 * @param {Array} params.items - Items de la venta POS
 * @param {Array} params.pagos - Pagos de la venta POS [{tipo, monto}]
 * @param {number} params.total - Total de la venta
 * @returns {Promise<Object>} Venta creada en Centum
 */
async function crearVentaPOS({ idCliente, sucursalFisicaId, idDivisionEmpresa, puntoVenta, items, pagos, total, condicionIva, operadorMovilUser, ventaPosId }) {
  const url = `${BASE_URL}/Ventas`
  const inicio = Date.now()

  // Guard: no enviar ventas sin items o sin total
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('No se puede crear venta en Centum: items vacíos o nulos')
  }
  if (!total || total <= 0) {
    throw new Error(`No se puede crear venta en Centum: total inválido (${total})`)
  }

  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'

  // Factura A (RI/MT): Centum espera precios NETOS (sin IVA) y discrimina IVA
  // Factura B (CF y otros): Centum espera precios FINALES (con IVA incluido)
  const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'

  // Armar artículos para Centum
  const ventaArticulos = items.map(item => {
    const precioConIva = parseFloat(item.precio_unitario || item.precioUnitario || item.precioFinal || item.precio || 0)
    const ivaTasa = parseFloat(item.iva_tasa || item.iva || item.ivaTasa || 21)
    // Para Factura A: enviar precio neto (sin IVA). Para Factura B: enviar precio final (con IVA)
    const precio = esFacturaA ? Math.round(precioConIva / (1 + ivaTasa / 100) * 100) / 100 : precioConIva

    return {
      IdArticulo: item.id_articulo || item.id || item.idArticulo || item.id_centum,
      Codigo: item.codigo || '',
      Nombre: item.nombre || '',
      Cantidad: redondearCantidad(item.cantidad),
      Precio: precio,
      PorcentajeDescuento1: 0,
      PorcentajeDescuento2: 0,
      PorcentajeDescuento3: 0,
      PorcentajeDescuentoMaximo: 100,
      CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: ivaTasa },
      ClaseDescuento: { IdClaseDescuento: 0 },
      Comision: { IdComision: 6089, Calculada: 0 },
      ImpuestoInterno: 0,
    }
  })

  // Calcular subtotal de artículos (precios tal como se envían a Centum)
  let subtotalArticulos = 0
  for (const art of ventaArticulos) {
    subtotalArticulos += art.Precio * (art.Cantidad || 0)
  }
  subtotalArticulos = Math.round(subtotalArticulos * 100) / 100

  // Si hay descuento por forma de pago, ajustar el Precio de cada artículo proporcionalmente
  // Para Factura A: convertir total POS (con IVA) a neto para comparar con precios netos
  // Para Factura B: comparar directo (precios ya incluyen IVA)
  const totalComparable = esFacturaA ? Math.round(total / 1.21 * 100) / 100 : total
  if (totalComparable < subtotalArticulos && subtotalArticulos > 0) {
    const factor = totalComparable / subtotalArticulos
    ventaArticulos.forEach(art => {
      art.Precio = Math.round(art.Precio * factor * 100) / 100
    })
    // Recalcular subtotal después del ajuste
    subtotalArticulos = 0
    for (const art of ventaArticulos) {
      subtotalArticulos += art.Precio * (art.Cantidad || 0)
    }
    subtotalArticulos = Math.round(subtotalArticulos * 100) / 100
  }

  // Importe para VentaValoresEfectivos:
  // Centum valida que importe total de ítems ≈ importe total de valores
  // Para Factura A: Centum suma IVA a los precios netos, así que el importe debe ser neto + IVA = total POS
  // Para Factura B: el importe es el subtotal de artículos (ya con IVA)
  const importeValor = esFacturaA ? total : subtotalArticulos

  // Determinar IdValor según medio de pago principal
  const medioPrincipal = pagos && pagos.length > 0 ? (pagos[0].tipo || 'efectivo').toLowerCase() : 'efectivo'
  const idValor = MEDIO_A_ID_VALOR[medioPrincipal] || 1

  // Validar que los precios de artículos no sean todos 0
  const preciosTodosZero = ventaArticulos.every(a => a.Precio === 0)
  if (preciosTodosZero) {
    throw new Error(`No se puede crear venta en Centum: todos los artículos tienen precio 0. Items originales: ${JSON.stringify(items.map(i => ({ nombre: i.nombre, precio_unitario: i.precio_unitario, precio: i.precio })))}`)
  }

  console.log(`[Centum POS] Preparando venta: condicionIva=${condicionIva}, esFacturaA=${esFacturaA}, totalPOS=${total}, importeValor=${importeValor}, items=${ventaArticulos.length}, preciosArticulos=[${ventaArticulos.map(a => `${a.Cantidad}x${a.Precio}`).join(',')}]`)

  const body = {
    FechaImputacion: fechaHoy,
    Cliente: { IdCliente: idCliente },
    SucursalFisica: { IdSucursalFisica: sucursalFisicaId },
    DivisionEmpresaGrupoEconomico: { IdDivisionEmpresaGrupoEconomico: idDivisionEmpresa },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 }, // Factura B
    NumeroDocumento: { PuntoVenta: puntoVenta },
    EsContado: true,
    Vendedor: { IdVendedor: 2 },
    CondicionVenta: { IdCondicionVenta: 14 },
    Bonificacion: { IdBonificacion: 6235 },
    VentaArticulos: ventaArticulos,
    VentaValoresEfectivos: [{
      IdValor: idValor,
      Cotizacion: 1,
      Importe: importeValor,
    }],
  }

  // Guardar UUID de venta POS en ObservacionInterna para idempotencia
  if (ventaPosId) {
    body.ObservacionInterna = `POS:${ventaPosId}`
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders({ operadorMovilUser }),
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_ventas_pos', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'pos',
    })
    throw new Error('Error al conectar con Centum ERP (Ventas POS): ' + err.message)
  }

  const texto = await response.text()
  let data = {}
  try { data = JSON.parse(texto) } catch { /* may not be JSON */ }

  if (response.ok) {
    registrarLlamada({
      servicio: 'centum_ventas_pos', endpoint: url, metodo: 'POST',
      estado: 'ok', status_code: response.status, duracion_ms: Date.now() - inicio,
      items_procesados: ventaArticulos.length, origen: 'pos',
    })
    console.log(`[Centum POS] Venta creada: IdVenta=${data.IdVenta}, Total=${data.Total}`)

    // Verificar discrepancia de total: si Centum devuelve un total muy diferente, logear alerta
    const centumTotal = parseFloat(data.Total) || 0
    if (centumTotal > 0 && Math.abs(centumTotal - total) > total * 0.05) {
      console.error(`[Centum POS] ⚠️ DISCREPANCIA DE TOTAL: POS=${total}, Centum=${centumTotal}, IdVenta=${data.IdVenta}. Body enviado: items=${ventaArticulos.length}, importeValor=${importeValor}`)
      registrarLlamada({
        servicio: 'centum_ventas_pos', endpoint: url, metodo: 'POST',
        estado: 'warning', status_code: response.status, duracion_ms: Date.now() - inicio,
        error_mensaje: `DISCREPANCIA TOTAL: POS=${total} vs Centum=${centumTotal}`, origen: 'pos',
      })
      data._discrepanciaTotal = true
      data._totalPOS = total
      data._totalCentum = centumTotal
    }

    return data
  }

  if (response.status === 500) {
    // Centum a veces devuelve 500 pero crea la venta
    console.warn(`[Centum POS] HTTP 500 pero posiblemente creada. Response: ${texto.slice(0, 300)}`)
    registrarLlamada({
      servicio: 'centum_ventas_pos', endpoint: url, metodo: 'POST',
      estado: 'ok_con_warning', status_code: 500, duracion_ms: Date.now() - inicio,
      items_procesados: ventaArticulos.length, error_mensaje: 'HTTP 500', origen: 'pos',
    })
    return { _creadoConWarning: true, ...data }
  }

  registrarLlamada({
    servicio: 'centum_ventas_pos', endpoint: url, metodo: 'POST',
    estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
    error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'pos',
  })
  throw new Error(`Error al crear venta POS en Centum (${response.status}): ${texto.slice(0, 500)}`)
}

/**
 * Registra una venta POS en Centum usando los datos de la venta local.
 * @param {Object} ventaLocal - Datos de la venta guardada en ventas_pos
 * @param {Object} config - { sucursalFisicaId, puntoVenta }
 * @returns {Promise<Object|null>} Resultado de Centum o null si falla
 */
async function registrarVentaPOSEnCentum(ventaLocal, config) {
  try {
    const items = typeof ventaLocal.items === 'string'
      ? JSON.parse(ventaLocal.items)
      : (ventaLocal.items || [])

    const pagos = Array.isArray(ventaLocal.pagos) ? ventaLocal.pagos : []

    // Condición IVA: usar la que viene en la venta (del frontend), fallback a DB
    let condicionIva = ventaLocal.condicion_iva || 'CF'
    if (!ventaLocal.condicion_iva && ventaLocal.id_cliente_centum) {
      const { data: cliente } = await supabase
        .from('clientes')
        .select('condicion_iva')
        .eq('id_centum', ventaLocal.id_cliente_centum)
        .single()
      condicionIva = cliente?.condicion_iva || 'CF'
    }

    // Clasificación división:
    // - Factura A (RI/MT) → siempre EMPRESA (3)
    // - Factura B (CF) + solo efectivo → PRUEBA (2)
    // - Factura B (CF) + pago electrónico → EMPRESA (3)
    const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
    const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
    const idDivisionEmpresa = esFacturaA ? 3 : (soloEfectivo ? 2 : 3)

    // Obtener operador móvil de la sucursal según división
    const operadorMovilUser = idDivisionEmpresa === 2
      ? (config.centum_operador_prueba || OPERADOR_MOVIL_USER_PRUEBA)
      : (config.centum_operador_empresa || null)

    console.log(`[Centum POS] División=${idDivisionEmpresa}, operador=${operadorMovilUser}, sucursalFisica=${config.sucursalFisicaId}, PV=${config.puntoVenta}, configEmpresa=${config.centum_operador_empresa}, configPrueba=${config.centum_operador_prueba}`)

    const resultado = await crearVentaPOS({
      idCliente: ventaLocal.id_cliente_centum || 2,
      sucursalFisicaId: config.sucursalFisicaId,
      idDivisionEmpresa,
      puntoVenta: config.puntoVenta,
      items,
      pagos,
      total: parseFloat(ventaLocal.total) || 0,
      condicionIva,
      operadorMovilUser,
      ventaPosId: ventaLocal.id,
    })

    return resultado
  } catch (err) {
    console.error('[Centum POS] Error al registrar venta en Centum:', err.message, err.stack)
    throw err // propagar para que pos.js guarde el error real en centum_error
  }
}

/**
 * Crea una Nota de Crédito con artículos en Centum (casos: devolución de producto, corrección de cliente).
 * @param {Object} params
 * @param {number} params.idCliente - IdCliente Centum del cliente original
 * @param {number} params.sucursalFisicaId - IdSucursalFisica Centum
 * @param {number} params.idDivisionEmpresa - 2=PRUEBA, 3=EMPRESA
 * @param {number} params.puntoVenta - Mismo punto de venta que la factura original
 * @param {Array} params.items - Items a incluir en la NC
 * @param {number} params.total - Total de la NC (positivo)
 * @param {string} params.condicionIva - Condición IVA del cliente (CF, RI, MT)
 * @returns {Promise<Object>} NC creada en Centum
 */
async function crearNotaCreditoPOS({ idCliente, sucursalFisicaId, idDivisionEmpresa, puntoVenta, items, total, condicionIva, operadorMovilUser, comprobanteOriginal }) {
  const url = `${BASE_URL}/Ventas`
  const inicio = Date.now()

  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'
  const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'

  const ventaArticulos = items.map(item => {
    const precioConIva = parseFloat(item.precio_unitario || item.precioUnitario || item.precioFinal || item.precio || 0)
    const ivaTasa = parseFloat(item.iva_tasa || item.iva || item.ivaTasa || 21)
    const precio = esFacturaA ? Math.round(precioConIva / (1 + ivaTasa / 100) * 100) / 100 : precioConIva

    return {
      IdArticulo: item.id_articulo || item.id || item.idArticulo || item.id_centum,
      Codigo: item.codigo || '',
      Nombre: item.nombre || '',
      Cantidad: redondearCantidad(item.cantidad),
      Precio: precio,
      PorcentajeDescuento1: 0,
      PorcentajeDescuento2: 0,
      PorcentajeDescuento3: 0,
      PorcentajeDescuentoMaximo: 100,
      CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: ivaTasa },
      ClaseDescuento: { IdClaseDescuento: 0 },
      Comision: { IdComision: 6089, Calculada: 0 },
      ImpuestoInterno: 0,
    }
  })

  // Calcular subtotal e importe igual que en crearVentaPOS
  let subtotalArticulos = 0
  for (const art of ventaArticulos) {
    subtotalArticulos += art.Precio * (art.Cantidad || 0)
  }
  subtotalArticulos = Math.round(subtotalArticulos * 100) / 100

  const totalComparable = esFacturaA ? Math.round(total / 1.21 * 100) / 100 : total
  if (totalComparable < subtotalArticulos && subtotalArticulos > 0) {
    const factor = totalComparable / subtotalArticulos
    ventaArticulos.forEach(art => {
      art.Precio = Math.round(art.Precio * factor * 100) / 100
    })
    subtotalArticulos = 0
    for (const art of ventaArticulos) {
      subtotalArticulos += art.Precio * (art.Cantidad || 0)
    }
    subtotalArticulos = Math.round(subtotalArticulos * 100) / 100
  }

  const importeValor = esFacturaA ? total : subtotalArticulos

  console.log(`[Centum POS NC] Preparando NC artículos: condicionIva=${condicionIva}, totalPOS=${total}, importeValor=${importeValor}, PV=${puntoVenta}`)

  const body = {
    FechaImputacion: fechaHoy,
    Cliente: { IdCliente: idCliente },
    SucursalFisica: { IdSucursalFisica: sucursalFisicaId },
    DivisionEmpresaGrupoEconomico: { IdDivisionEmpresaGrupoEconomico: idDivisionEmpresa },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 6 }, // NCV - Nota de Crédito
    NumeroDocumento: { PuntoVenta: puntoVenta },
    EsContado: true,
    Vendedor: { IdVendedor: 2 },
    CondicionVenta: { IdCondicionVenta: 14 },
    Bonificacion: { IdBonificacion: 6235 },
    VentaArticulos: ventaArticulos,
    VentaValoresEfectivos: [{
      IdValor: 1,
      Cotizacion: 1,
      Importe: importeValor,
    }],
  }

  // Agregar referencia al comprobante original (requerido para NC en Centum)
  // El campo correcto es "Referencia" (string), NO "NumeroReferencia" (objeto)
  if (comprobanteOriginal) {
    const ref = extraerPuntoVentaDeComprobante(comprobanteOriginal)
    if (ref) {
      body.Referencia = String(ref.numero)
      console.log(`[Centum POS NC] Referencia: ${ref.numero} (de comprobante ${comprobanteOriginal})`)
    }
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders({ operadorMovilUser }),
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_nc_pos', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'pos',
    })
    throw new Error('Error al conectar con Centum ERP (NC POS): ' + err.message)
  }

  const texto = await response.text()
  let data = {}
  try { data = JSON.parse(texto) } catch { /* may not be JSON */ }

  if (response.ok) {
    registrarLlamada({
      servicio: 'centum_nc_pos', endpoint: url, metodo: 'POST',
      estado: 'ok', status_code: response.status, duracion_ms: Date.now() - inicio,
      items_procesados: ventaArticulos.length, origen: 'pos',
    })
    console.log(`[Centum POS NC] NC creada: IdVenta=${data.IdVenta}, Total=${data.Total}`)
    return data
  }

  if (response.status === 500) {
    console.warn(`[Centum POS NC] HTTP 500 pero posiblemente creada. Response: ${texto.slice(0, 300)}`)
    registrarLlamada({
      servicio: 'centum_nc_pos', endpoint: url, metodo: 'POST',
      estado: 'ok_con_warning', status_code: 500, duracion_ms: Date.now() - inicio,
      items_procesados: ventaArticulos.length, error_mensaje: 'HTTP 500', origen: 'pos',
    })
    return { _creadoConWarning: true, ...data }
  }

  registrarLlamada({
    servicio: 'centum_nc_pos', endpoint: url, metodo: 'POST',
    estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
    error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'pos',
  })
  throw new Error(`Error al crear NC POS en Centum (${response.status}): ${texto.slice(0, 500)}`)
}

/**
 * Crea una Nota de Crédito por concepto en Centum (caso: diferencia de precio de góndola).
 * @param {Object} params
 * @param {number} params.idCliente - IdCliente Centum
 * @param {number} params.sucursalFisicaId - IdSucursalFisica Centum
 * @param {number} params.idDivisionEmpresa - 2=PRUEBA, 3=EMPRESA
 * @param {number} params.puntoVenta - Mismo punto de venta que la factura original
 * @param {number} params.total - Importe total de la NC (positivo)
 * @param {string} params.condicionIva - Condición IVA del cliente
 * @param {string} [params.descripcion] - Descripción adicional del concepto
 * @returns {Promise<Object>} NC creada en Centum
 */
async function crearNotaCreditoConceptoPOS({ idCliente, sucursalFisicaId, idDivisionEmpresa, puntoVenta, total, condicionIva, descripcion, operadorMovilUser, comprobanteOriginal }) {
  const url = `${BASE_URL}/Ventas`
  const inicio = Date.now()

  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'
  const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'

  // Para NC por concepto: el importe del concepto
  // Factura A: Centum espera neto, Factura B: importe final
  const importeConcepto = esFacturaA ? Math.round(total / 1.21 * 100) / 100 : total
  const importeValor = total // El valor efectivo siempre es el total con IVA

  console.log(`[Centum POS NC Concepto] Preparando NC concepto: condicionIva=${condicionIva}, total=${total}, importeConcepto=${importeConcepto}, PV=${puntoVenta}`)

  const body = {
    FechaImputacion: fechaHoy,
    Cliente: { IdCliente: idCliente },
    SucursalFisica: { IdSucursalFisica: sucursalFisicaId },
    DivisionEmpresaGrupoEconomico: { IdDivisionEmpresaGrupoEconomico: idDivisionEmpresa },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 6 }, // NCV - Nota de Crédito
    NumeroDocumento: { PuntoVenta: puntoVenta },
    EsContado: true,
    Vendedor: { IdVendedor: 2 },
    CondicionVenta: { IdCondicionVenta: 14 },
    Bonificacion: { IdBonificacion: 6235 },
  }

  if (comprobanteOriginal) {
    const ref = extraerPuntoVentaDeComprobante(comprobanteOriginal)
    if (ref) {
      body.Referencia = String(ref.numero)
    }
  }

  // Nombre fijo, detalle de artículos en Observaciones
  if (descripcion) {
    body.Observaciones = descripcion
  }

  body.VentaConceptos = [{
    IdConcepto: 25, // DIFERENCIA EN PRECIO DE GONDOLA
    Codigo: '23',
    Nombre: 'DIFERENCIA EN PRECIO DE GONDOLA',
    Cantidad: 1,
    Precio: importeConcepto,
    CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: 21 },
  }]
  body.VentaValoresEfectivos = [{
    IdValor: 1,
    Cotizacion: 1,
    Importe: importeValor,
  }]

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders({ operadorMovilUser }),
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_nc_concepto_pos', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'pos',
    })
    throw new Error('Error al conectar con Centum ERP (NC Concepto POS): ' + err.message)
  }

  const texto = await response.text()
  let data = {}
  try { data = JSON.parse(texto) } catch { /* may not be JSON */ }

  if (response.ok) {
    registrarLlamada({
      servicio: 'centum_nc_concepto_pos', endpoint: url, metodo: 'POST',
      estado: 'ok', status_code: response.status, duracion_ms: Date.now() - inicio,
      items_procesados: 1, origen: 'pos',
    })
    console.log(`[Centum POS NC Concepto] NC creada: IdVenta=${data.IdVenta}, Total=${data.Total}`)
    return data
  }

  if (response.status === 500) {
    console.warn(`[Centum POS NC Concepto] HTTP 500 pero posiblemente creada. Response: ${texto.slice(0, 300)}`)
    registrarLlamada({
      servicio: 'centum_nc_concepto_pos', endpoint: url, metodo: 'POST',
      estado: 'ok_con_warning', status_code: 500, duracion_ms: Date.now() - inicio,
      items_procesados: 1, error_mensaje: 'HTTP 500', origen: 'pos',
    })
    return { _creadoConWarning: true, ...data }
  }

  registrarLlamada({
    servicio: 'centum_nc_concepto_pos', endpoint: url, metodo: 'POST',
    estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
    error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'pos',
  })
  throw new Error(`Error al crear NC Concepto POS en Centum (${response.status}): ${texto.slice(0, 500)}`)
}

/**
 * Extrae el PuntoVenta del comprobante Centum (ej: "B PV2-7740" → 2)
 */
function extraerPuntoVentaDeComprobante(comprobante) {
  if (!comprobante) return null
  const match = comprobante.match(/PV(\d+)-(\d+)/)
  if (!match) {
    // Fallback: solo PV sin número
    const pvMatch = comprobante.match(/PV(\d+)/)
    return pvMatch ? { puntoVenta: parseInt(pvMatch[1]), numero: 0 } : null
  }
  return { puntoVenta: parseInt(match[1]), numero: parseInt(match[2]) }
}

/**
 * Obtiene una Venta de Centum por su IdVenta (para obtener CAE, NumeroDocumento, etc.)
 * GET /Ventas/{idVenta}
 * @param {number} idVenta - IdVenta en Centum
 * @returns {Promise<Object>} Datos de la venta incluyendo CAE y FechaVencimientoCAE
 */
async function obtenerVentaCentum(idVenta) {
  const url = `${BASE_URL}/Ventas/${idVenta}`
  const inicio = Date.now()

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_ventas_pos', endpoint: url, metodo: 'GET',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'pos',
    })
    throw new Error('Error al conectar con Centum ERP (GET Venta): ' + err.message)
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_ventas_pos', endpoint: url, metodo: 'GET',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'pos',
    })
    if (response.status === 404) {
      throw new Error(`Venta ${idVenta} no encontrada en Centum`)
    }
    throw new Error(`Error al obtener venta Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_ventas_pos', endpoint: url, metodo: 'GET',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'pos',
  })

  console.log(`[Centum POS] GET Venta ${idVenta}: CAE=${data.CAE || '(vacío)'}, FechaVtoCAE=${data.FechaVencimientoCAE || '(vacío)'}`)
  return data
}

/**
 * Busca si ya existe una venta en Centum para una venta POS específica.
 * Consulta las últimas ventas del PV/sucursal y busca coincidencia por ObservacionInterna.
 * @param {string} ventaPosId - UUID de la venta POS
 * @param {number} sucursalFisicaId - IdSucursalFisica Centum
 * @param {number} puntoVenta - Punto de venta Centum
 * @param {number} total - Total esperado
 * @returns {Promise<Object|null>} Venta encontrada o null
 */
async function buscarVentaExistenteEnCentum(ventaPosId, sucursalFisicaId, puntoVenta, total) {
  if (!ventaPosId || !total || total <= 0) return null

  try {
    // Buscar en Centum BI (SQL Server) si ya existe una venta con mismo total, sucursal y PV reciente
    // Esto detecta duplicados cuando el POST a Centum creó la venta pero la respuesta falló
    const { getPool } = require('../config/centum')
    const sql = require('mssql')
    const db = await getPool()

    // Buscar ventas de hoy con mismo total y sucursal, que NO estén ya vinculadas a una venta POS
    const hoy = new Date().toISOString().split('T')[0]
    const result = await db.request()
      .input('fecha', sql.VarChar, hoy)
      .input('total', sql.Decimal(18, 2), total)
      .input('sucursal', sql.Int, sucursalFisicaId)
      .input('tolerancia', sql.Decimal(18, 2), 1.0)
      .query(`
        SELECT TOP 5 VentaID, NumeroDocumento, Total, FechaCreacion
        FROM Ventas_VIEW
        WHERE FechaDocumento >= @fecha
          AND SucursalFisicaID = @sucursal
          AND ABS(Total - @total) < @tolerancia
          AND Anulado = 0
        ORDER BY VentaID DESC
      `)

    if (result.recordset.length === 0) {
      console.log(`[Centum POS] No se encontró venta existente en BI para total=${total}, sucursal=${sucursalFisicaId}`)
      return null
    }

    // Buscar la primera venta que NO esté ya vinculada a otra venta POS
    let existente = null
    for (const row of result.recordset) {
      const { data: yaVinculada } = await supabase
        .from('ventas_pos')
        .select('id')
        .eq('id_venta_centum', row.VentaID)
        .maybeSingle()

      if (!yaVinculada) {
        existente = row
        break
      } else {
        console.log(`[Centum POS] Venta BI ${row.VentaID} ya vinculada a POS ${yaVinculada.id}, buscando otra`)
      }
    }

    if (!existente) {
      console.log(`[Centum POS] Todas las ventas BI con total=${total} ya están vinculadas`)
      return null
    }

    // Parsear NumeroDocumento para armar la respuesta compatible
    const numDocStr = (existente.NumeroDocumento || '').trim()
    const numDocMatch = numDocStr.match(/^([A-Z])(\d+)-(\d+)$/)
    const numDoc = numDocMatch ? {
      LetraDocumento: numDocMatch[1],
      PuntoVenta: parseInt(numDocMatch[2]),
      Numero: parseInt(numDocMatch[3]),
    } : null

    console.log(`[Centum POS] Venta existente encontrada en BI: VentaID=${existente.VentaID}, NumDoc=${numDocStr}, Total=${existente.Total}`)
    return {
      IdVenta: existente.VentaID,
      NumeroDocumento: numDoc,
      Total: existente.Total,
      CAE: null, // Se obtiene después con fetchAndSaveCAE
    }
  } catch (err) {
    console.warn(`[Centum POS] Error al buscar venta existente en BI: ${err.message}`)
    return null
  }
}

/**
 * Retry automático: busca ventas con centum_sync=false de las últimas 24h y las reenvía.
 * Diseñado para correr desde un cron job.
 */
async function retrySyncVentasCentum() {
  const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Buscar ventas pendientes (no sincronizadas, con caja asignada, de las últimas 24h)
  const { data: pendientes, error } = await supabase
    .from('ventas_pos')
    .select('id, caja_id, id_cliente_centum, items, pagos, total, tipo, venta_origen_id, nombre_cliente, numero_venta')
    .eq('centum_sync', false)
    .not('caja_id', 'is', null)
    .gte('created_at', hace30d)
    .order('created_at', { ascending: true })
    .limit(20)

  if (error) {
    console.error('[RetryCentumVentas] Error en query Supabase:', error.message || error)
    return { reintentadas: 0, exitosas: 0, fallidas: 0 }
  }
  if (!pendientes?.length) {
    return { reintentadas: 0, exitosas: 0, fallidas: 0 }
  }
  console.log(`[RetryCentumVentas] Encontradas ${pendientes.length} ventas pendientes`)

  let exitosas = 0
  let fallidas = 0

  for (let i = 0; i < pendientes.length; i++) {
    const venta = pendientes[i]
    console.log(`[RetryCentumVentas] Procesando ${i+1}/${pendientes.length}: venta ${venta.id} (#${venta.numero_venta || '?'}, cliente: ${venta.nombre_cliente || 'CF'})`)
    try {
      // Obtener config de caja/sucursal
      const { data: cajaData } = await supabase
        .from('cajas')
        .select('punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
        .eq('id', venta.caja_id)
        .single()

      const puntoVenta = cajaData?.punto_venta_centum
      const sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
      if (!puntoVenta || !sucursalFisicaId) {
        await supabase.from('ventas_pos').update({ centum_error: 'Retry: sin config Centum en caja/sucursal' }).eq('id', venta.id)
        fallidas++
        continue
      }

      const centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
      const centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba

      // Ventas de empleados → Consumidor Final (id=2), siempre PRUEBA
      const esEmpleado = venta.nombre_cliente && venta.nombre_cliente.startsWith('Empleado:')
      if (esEmpleado) {
        venta.id_cliente_centum = 2
      }

      // Si el cliente no tiene id_centum, intentar resolver desde DB local
      if (!esEmpleado && (!venta.id_cliente_centum || venta.id_cliente_centum === 0)) {
        if (venta.nombre_cliente && venta.nombre_cliente !== 'Consumidor Final') {
          const { data: cliLocal } = await supabase
            .from('clientes')
            .select('id_centum')
            .ilike('razon_social', venta.nombre_cliente)
            .not('id_centum', 'is', null)
            .gt('id_centum', 0)
            .limit(1)
            .maybeSingle()
          if (cliLocal?.id_centum) {
            venta.id_cliente_centum = cliLocal.id_centum
            await supabase.from('ventas_pos').update({ id_cliente_centum: cliLocal.id_centum }).eq('id', venta.id)
            console.log(`[Centum Retry] Cliente resuelto: ${venta.nombre_cliente} → id_centum=${cliLocal.id_centum}`)
          } else {
            await supabase.from('ventas_pos').update({ centum_error: `Cliente "${venta.nombre_cliente}" aún sin ID Centum` }).eq('id', venta.id)
            fallidas++
            continue
          }
        }
      }

      // Determinar condición IVA y división
      let condicionIva = venta.condicion_iva || 'CF'
      if (!venta.condicion_iva && venta.id_cliente_centum) {
        const { data: cliente } = await supabase
          .from('clientes').select('condicion_iva')
          .eq('id_centum', venta.id_cliente_centum).maybeSingle()
        condicionIva = cliente?.condicion_iva || 'CF'
      }

      const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
      const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
      const pagos = Array.isArray(venta.pagos) ? venta.pagos : []
      const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
      const idDivisionEmpresa = esEmpleado ? 2 : (esFacturaA ? 3 : (soloEfectivo ? 2 : 3))

      const operadorMovilUser = idDivisionEmpresa === 2
        ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
        : (centumOperadorEmpresa || null)

      const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
      let resultado

      if (venta.tipo === 'nota_credito') {
        // NC: valores positivos
        const itemsPositivos = items.map(it => ({
          ...it,
          precio_unitario: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
          precioUnitario: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
          precio: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
          cantidad: redondearCantidad(Math.abs(parseFloat(it.cantidad || 1))),
        }))

        let comprobanteOriginal = null
        let idClienteNC = venta.id_cliente_centum || 2
        let condicionIvaNC = condicionIva
        let idDivisionNC = idDivisionEmpresa
        let operadorNC = operadorMovilUser

        if (venta.venta_origen_id) {
          const { data: ventaOrigen } = await supabase
            .from('ventas_pos').select('centum_comprobante, id_cliente_centum, pagos')
            .eq('id', venta.venta_origen_id).maybeSingle()
          comprobanteOriginal = ventaOrigen?.centum_comprobante || null
          if (ventaOrigen) {
            idClienteNC = ventaOrigen.id_cliente_centum || 2
            let condIvaOrig = 'CF'
            if (ventaOrigen.id_cliente_centum) {
              const { data: cliOrig } = await supabase
                .from('clientes').select('condicion_iva')
                .eq('id_centum', ventaOrigen.id_cliente_centum).maybeSingle()
              condIvaOrig = cliOrig?.condicion_iva || 'CF'
            }
            condicionIvaNC = condIvaOrig
            const esFacturaAOrig = condIvaOrig === 'RI' || condIvaOrig === 'MT'
            const pagosOrig = Array.isArray(ventaOrigen.pagos) ? ventaOrigen.pagos : []
            const soloEfectivoOrig = pagosOrig.length === 0 || pagosOrig.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
            idDivisionNC = esFacturaAOrig ? 3 : (soloEfectivoOrig ? 2 : 3)
            operadorNC = idDivisionNC === 2
              ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
              : (centumOperadorEmpresa || null)
          }
        }

        const esNCConcepto = items.some(it => it.precio_cobrado != null && it.precio_correcto != null)
        if (esNCConcepto) {
          const descripcionItems = items.map(it =>
            `${it.cantidad || 1}x ${it.nombre}: $${it.precio_cobrado} → $${it.precio_correcto}`
          ).join(', ')
          resultado = await crearNotaCreditoConceptoPOS({
            idCliente: idClienteNC, sucursalFisicaId, idDivisionEmpresa: idDivisionNC, puntoVenta,
            total: Math.abs(parseFloat(venta.total) || 0), condicionIva: condicionIvaNC,
            descripcion: `DIFERENCIA EN PRECIO DE GONDOLA - ${descripcionItems}`,
            operadorMovilUser: operadorNC, comprobanteOriginal,
          })
        } else {
          resultado = await crearNotaCreditoPOS({
            idCliente: idClienteNC, sucursalFisicaId, idDivisionEmpresa: idDivisionNC, puntoVenta,
            items: itemsPositivos, total: Math.abs(parseFloat(venta.total) || 0),
            condicionIva: condicionIvaNC, operadorMovilUser: operadorNC, comprobanteOriginal,
          })
        }
      } else {
        // Idempotencia: verificar si ya existe en Centum antes de crear
        const existente = await buscarVentaExistenteEnCentum(venta.id, sucursalFisicaId, puntoVenta, parseFloat(venta.total) || 0)
        if (existente) {
          console.log(`[RetryCentumVentas] Venta ${venta.id} ya existe en Centum (IdVenta=${existente.IdVenta}), vinculando sin crear duplicado`)
          const numDocEx = existente.NumeroDocumento
          const comprobanteEx = numDocEx
            ? `${numDocEx.LetraDocumento || ''} PV${numDocEx.PuntoVenta}-${numDocEx.Numero}`
            : null
          await supabase.from('ventas_pos').update({
            id_venta_centum: existente.IdVenta || null,
            centum_comprobante: comprobanteEx,
            centum_sync: true,
            centum_error: null,
            numero_cae: existente.CAE || null,
          }).eq('id', venta.id)
          const cae = await fetchAndSaveCAE(venta.id, existente.IdVenta)
          exitosas++
          continue
        }

        resultado = await crearVentaPOS({
          idCliente: venta.id_cliente_centum || 2,
          sucursalFisicaId, idDivisionEmpresa, puntoVenta,
          items, pagos, total: parseFloat(venta.total) || 0,
          condicionIva, operadorMovilUser,
          ventaPosId: venta.id,
        })
      }

      // Comprobante provisorio del POST (puede ser incorrecto para NCs)
      let numDoc = resultado?.NumeroDocumento
      let comprobante = numDoc
        ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
        : null

      // GET real de Centum para obtener comprobante y CAE correctos
      let caeReal = resultado?.CAE || null
      let ventaConfirmada = !resultado?._creadoConWarning // si no hubo warning, está confirmada
      if (resultado?.IdVenta) {
        try {
          const centumReal = await obtenerVentaCentum(resultado.IdVenta)
          const numDocReal = centumReal?.NumeroDocumento
          if (numDocReal && numDocReal.PuntoVenta && numDocReal.Numero) {
            comprobante = `${numDocReal.LetraDocumento || ''} PV${numDocReal.PuntoVenta}-${numDocReal.Numero}`
          }
          if (centumReal?.CAE) caeReal = centumReal.CAE
          ventaConfirmada = true // GET exitoso = la venta existe en Centum
        } catch (e) {
          console.warn(`[RetryCentumVentas] No se pudo verificar venta ${venta.id} en Centum:`, e.message)
          if (resultado?._creadoConWarning) {
            // HTTP 500 al crear + no se puede verificar = NO se creó
            ventaConfirmada = false
            comprobante = null
          }
        }
      }

      if (ventaConfirmada) {
        const updateData = {
          id_venta_centum: resultado?.IdVenta || null,
          centum_comprobante: comprobante,
          centum_sync: true,
          centum_error: null,
          numero_cae: caeReal,
        }
        // Guardar alerta si hubo discrepancia de total
        if (resultado?._discrepanciaTotal) {
          updateData.centum_error = `ALERTA: Total POS=$${resultado._totalPOS} vs Centum=$${resultado._totalCentum}`
        }
        await supabase.from('ventas_pos').update(updateData).eq('id', venta.id)
      } else {
        // No se confirmó en Centum — limpiar datos falsos
        await supabase.from('ventas_pos').update({
          id_venta_centum: null,
          centum_comprobante: null,
          centum_sync: false,
          centum_error: 'Centum devolvió 500 y la venta no se pudo verificar',
          numero_cae: null,
        }).eq('id', venta.id)
        console.warn(`[RetryCentumVentas] Venta ${venta.id}: creación no confirmada, marcada como no sincronizada`)
      }

      console.log(`[RetryCentumVentas] Venta ${venta.id} OK: Comprobante=${comprobante}`)
      // Obtener CAE en background (si no se obtuvo arriba)
      if (!caeReal) fetchAndSaveCAE(venta.id, resultado?.IdVenta)
      exitosas++
    } catch (err) {
      console.error(`[RetryCentumVentas] Error venta ${venta.id} (#${venta.numero_venta}):`, err.message)
      try {
        registrarLlamada({
          servicio: 'centum_ventas_retry', endpoint: `venta #${venta.numero_venta}`, metodo: 'POST',
          estado: 'error', duracion_ms: 0, error_mensaje: (err.message || '').slice(0, 500), origen: 'cron',
        })
        await supabase.from('ventas_pos').update({ centum_error: `Retry: ${(err.message || '').slice(0, 200)}` }).eq('id', venta.id)
      } catch (e2) {
        console.error(`[RetryCentumVentas] No se pudo guardar centum_error para venta ${venta.id}:`, e2.message)
      }
      fallidas++
    }
  }

  registrarLlamada({
    servicio: 'centum_ventas_retry', endpoint: `retry batch`, metodo: 'BATCH',
    estado: 'ok', duracion_ms: 0, items_procesados: pendientes.length,
    error_mensaje: `exitosas: ${exitosas}, fallidas: ${fallidas}`, origen: 'cron',
  })
  return { reintentadas: pendientes.length, exitosas, fallidas }
}

/**
 * Obtiene el CAE de una venta desde Centum (GET) y lo guarda en ventas_pos.
 * Si obtiene CAE, dispara envío automático de email al cliente (si tiene email).
 * Se llama después de un sync exitoso. No tira error si falla (best effort).
 */
async function fetchAndSaveCAE(ventaPosId, idVentaCentum) {
  if (!idVentaCentum || !ventaPosId) return null
  try {
    const centumData = await obtenerVentaCentum(idVentaCentum)
    const cae = centumData?.CAE || null
    const caeVto = centumData?.FechaVencimientoCAE || null

    // Actualizar comprobante real de Centum (puede diferir del que se guardó al crear)
    const numDocReal = centumData?.NumeroDocumento
    const updates = {}
    if (numDocReal && numDocReal.PuntoVenta && numDocReal.Numero) {
      updates.centum_comprobante = `${numDocReal.LetraDocumento || ''} PV${numDocReal.PuntoVenta}-${numDocReal.Numero}`
    }
    if (cae) {
      updates.numero_cae = cae
      await supabase.from('ventas_pos').update(updates).eq('id', ventaPosId)
      console.log(`[Centum POS] CAE guardado para venta ${ventaPosId}: ${cae}${updates.centum_comprobante ? `, comprobante=${updates.centum_comprobante}` : ''}`)

      // Envío automático de email (async, best effort)
      enviarComprobanteAutomatico(ventaPosId, cae, caeVto).catch(err => {
        console.warn(`[Email Auto] Error para venta ${ventaPosId}:`, err.message)
      })
    } else if (updates.centum_comprobante) {
      // Sin CAE pero con comprobante real actualizado (ej: NC sin autorizar ARCA)
      await supabase.from('ventas_pos').update(updates).eq('id', ventaPosId)
      console.log(`[Centum POS] Comprobante actualizado para venta ${ventaPosId}: ${updates.centum_comprobante}`)
    }
    return cae
  } catch (err) {
    console.warn(`[Centum POS] No se pudo obtener CAE para venta ${ventaPosId}:`, err.message)
    return null
  }
}

/**
 * Envía el comprobante por email automáticamente si:
 * - La venta es Factura A (RI/MT) o EMPRESA con pago electrónico
 * - El cliente tiene email cargado
 * - El email no fue enviado previamente
 *
 * Envía el comprobante como HTML embebido en el email (sin PDF/Puppeteer).
 * El PDF se puede generar bajo demanda desde el envío manual.
 */
async function enviarComprobanteAutomatico(ventaPosId, cae, caeVto) {
  // Obtener venta completa
  const { data: venta, error } = await supabase.from('ventas_pos').select('*').eq('id', ventaPosId).single()
  if (error || !venta) { console.log(`[Email Auto] Venta ${ventaPosId} no encontrada`); return }
  if (venta.email_enviado) return // Ya se envió

  // Obtener cliente y su email
  if (!venta.id_cliente_centum) { console.log(`[Email Auto] Venta ${ventaPosId} sin cliente asignado`); return }
  const { data: cli } = await supabase.from('clientes')
    .select('razon_social, cuit, direccion, localidad, codigo_postal, telefono, condicion_iva, codigo, email')
    .eq('id_centum', venta.id_cliente_centum).single()
  if (!cli?.email) { console.log(`[Email Auto] Cliente ${venta.id_cliente_centum} sin email (venta ${ventaPosId})`); return }

  // Verificar que sea EMPRESA (no PRUEBA)
  const condIva = cli.condicion_iva || 'CF'
  const esFacturaA = condIva === 'RI' || condIva === 'MT'
  const pagos = Array.isArray(venta.pagos) ? venta.pagos : []
  const tiposEf = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
  const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEf.includes((p.tipo || '').toLowerCase()))
  const esPrueba = !esFacturaA && soloEfectivo
  if (esPrueba) return

  const caeData = { cae, cae_vencimiento: caeVto, esFacturaA, cliente: cli }

  // Generar HTML del comprobante (se envía embebido en el email, sin PDF)
  const { generarComprobanteHTML } = require('./comprobanteHTML')
  const comprobanteHTML = await generarComprobanteHTML(venta, caeData)

  // Enviar email con el comprobante como HTML
  const esNC = venta.tipo === 'nota_credito'
  const tipoDoc = esNC ? 'Nota de Crédito' : 'Comprobante'
  const numDoc = venta.centum_comprobante || `#${venta.numero_venta || ''}`

  const escapeHtml = (s) => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const { enviarEmail } = require('./email')
  await enviarEmail({
    to: cli.email.trim(),
    subject: `${tipoDoc} ${numDoc} - Almacen Zaatar`,
    html: `<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px">
      <p>Estimado/a <strong>${escapeHtml(venta.nombre_cliente || 'Cliente')}</strong>,</p>
      <p>Le enviamos su ${esNC ? 'nota de crédito' : 'comprobante de compra'}.</p>
      <p style="color:#555;font-size:13px">Número: <strong>${escapeHtml(numDoc)}</strong><br>
      Fecha: ${new Date(venta.created_at).toLocaleDateString('es-AR')}<br>
      Total: <strong>$${parseFloat(venta.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></p>
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
      ${comprobanteHTML}
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
      <p style="font-size:11px;color:#999">Comercial Padano SRL - Brasil 313, Rosario<br>
      Este email fue enviado desde un sistema automatizado. No responder a esta dirección.</p>
    </div>`,
  })

  // Marcar como enviado
  await supabase.from('ventas_pos').update({
    email_enviado: true,
    email_enviado_a: cli.email.trim(),
    email_enviado_at: new Date().toISOString(),
  }).eq('id', ventaPosId)

  console.log(`[Email Auto] Comprobante enviado a ${cli.email} para venta ${venta.numero_venta} (${numDoc})`)
}

/**
 * Cron: busca ventas sincronizadas con Centum (últimas 48h) que no tienen CAE guardado
 * e intenta obtenerlo. Si lo obtiene, dispara el envío automático de email.
 */
async function retrySyncCAE() {
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: ventas, error } = await supabase.from('ventas_pos')
    .select('id, numero_venta, id_venta_centum')
    .eq('centum_sync', true)
    .not('id_venta_centum', 'is', null)
    .is('numero_cae', null)
    .gte('created_at', hace7d)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error || !ventas || ventas.length === 0) return { revisadas: 0, conCAE: 0 }

  let conCAE = 0
  for (const v of ventas) {
    const cae = await fetchAndSaveCAE(v.id, v.id_venta_centum)
    if (cae) conCAE++
  }

  return { revisadas: ventas.length, conCAE }
}

module.exports = { crearVentaPOS, registrarVentaPOSEnCentum, crearNotaCreditoPOS, crearNotaCreditoConceptoPOS, extraerPuntoVentaDeComprobante, obtenerVentaCentum, buscarVentaExistenteEnCentum, retrySyncVentasCentum, fetchAndSaveCAE, retrySyncCAE, enviarComprobanteAutomatico }
