// Servicio para crear Ventas POS en Centum ERP (sin PedidoVenta previo)
const { generateAccessToken } = require('./syncERP')
const { registrarLlamada } = require('./apiLogger')
const { crearClienteEnCentum } = require('./centumClientes')
const { createClient } = require('@supabase/supabase-js')
const logger = require('../config/logger')
const { breakers } = require('../utils/circuitBreaker')
const { fetchWithTimeout } = require('../utils/fetchWithTimeout')
const { cooldownWithBackoff } = require('../utils/retry')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

// Fallback: operador de env var (para backwards compat)
const OPERADOR_MOVIL_USER_PRUEBA = process.env.CENTUM_OPERADOR_PRUEBA_USER || 'api123'

// ============ ANTI-DUPLICACIÓN: constantes ============
const MAX_INTENTOS = 3
// Cooldown uses exponential backoff with jitter via cooldownWithBackoff()
// Base: 5 min → attempt 1: ~5 min, attempt 2: ~10 min, attempt 3+: capped at 1 hour
// Prefijos para centum_error que codifican el estado
const PREFIX_UNVERIFIED = 'UNVERIFIED|'
const PREFIX_DEFINITIVE = 'DEFINITIVE|'
const PREFIX_MAX_RETRIES = 'MAX_RETRIES|'

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

  // Detectar si todos los items son gift cards → enviar como concepto
  const esVentaGiftCard = items.length > 0 && items.every(it => it.es_gift_card === true)

  // Determinar IdValor según medio de pago principal
  const medioPrincipal = pagos && pagos.length > 0 ? (pagos[0].tipo || 'efectivo').toLowerCase() : 'efectivo'
  const idValor = MEDIO_A_ID_VALOR[medioPrincipal] || 1

  let ventaArticulos = []
  let ventaConceptos = []
  let importeValor

  if (esVentaGiftCard) {
    // Gift cards: enviar como concepto VENTA GIFT CARD (IdConcepto 20)
    const importeConcepto = esFacturaA ? Math.round(total / 1.21 * 100) / 100 : total
    importeValor = total

    ventaConceptos = [{
      IdConcepto: 20,
      Codigo: 'GIFTCARD',
      Nombre: 'VENTA GIFT CARD',
      Cantidad: 1,
      Precio: importeConcepto,
      CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: 21 },
    }]

    logger.info(`[Centum POS] Venta Gift Card como concepto: esFacturaA=${esFacturaA}, importeConcepto=${importeConcepto}, importeValor=${importeValor}`)
  } else {
    // Armar artículos para Centum
    ventaArticulos = items.map(item => {
      const precioConIva = parseFloat(item.precio_unitario || item.precioUnitario || item.precioFinal || item.precio || 0)
      const ivaTasa = parseFloat(item.iva_tasa || item.iva || item.ivaTasa || 21)
      // Para Factura A: enviar precio neto (sin IVA). Para Factura B: enviar precio final (con IVA)
      // Factura B: Centum descompone internamente a neto+IVA. Para evitar CobroNoBalanceaException,
      // asegurar que el precio sobreviva el round-trip neto→bruto (round(round(P/1.21)*1.21) == P)
      const neto = Math.round(precioConIva / (1 + ivaTasa / 100) * 100) / 100
      const precio = esFacturaA ? neto : Math.round(neto * (1 + ivaTasa / 100) * 100) / 100

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

    // Calcular subtotal ORIGINAL (siempre con IVA, desde items fuente) para detectar descuentos.
    // Necesario porque para Factura A los precios en ventaArticulos son neto (sin IVA),
    // pero total POS es con IVA. El ratio debe calcularse con la misma base.
    let subtotalOriginal = 0
    for (const item of items) {
      const precio = parseFloat(item.precio_unitario || item.precioUnitario || item.precioFinal || item.precio || 0)
      const cantidad = redondearCantidad(item.cantidad)
      subtotalOriginal += precio * cantidad
    }
    subtotalOriginal = Math.round(subtotalOriginal * 100) / 100

    // Si hay descuento (total POS < subtotal original), aplicar descuento proporcional a items.
    // Centum valida que sum(items) == sum(pagos) exactamente (CobroNoBalanceaException).
    // El ratio se calcula sobre precios originales (con IVA) porque total POS también incluye IVA.
    if (total < subtotalOriginal && subtotalOriginal > 0) {
      const ratio = total / subtotalOriginal
      logger.info(`[Centum POS] Descuento detectado: total=${total}, subtotalOriginal=${subtotalOriginal}, ratio=${ratio.toFixed(6)}`)
      for (const art of ventaArticulos) {
        art.Precio = Math.round(art.Precio * ratio * 100) / 100
      }
    }

    // Calcular importeValor simulando el cálculo interno de Centum:
    // Centum descompone cada línea en neto + IVA por separado.
    // Siempre calcular desde los items para garantizar que items == pago.
    let totalCentum = 0
    for (const art of ventaArticulos) {
      const ivaTasa = art.CategoriaImpuestoIVA?.Tasa || 21
      if (esFacturaA) {
        // Factura A: precio ya es neto, Centum suma IVA
        const netoLinea = Math.round(art.Precio * (art.Cantidad || 0) * 100) / 100
        const ivaLinea = Math.round(netoLinea * ivaTasa / 100 * 100) / 100
        totalCentum += Math.round((netoLinea + ivaLinea) * 100) / 100
      } else {
        // Factura B: precio es final, Centum descompone a neto+IVA internamente
        const netoUnit = Math.round(art.Precio / (1 + ivaTasa / 100) * 100) / 100
        const netoLinea = Math.round(netoUnit * (art.Cantidad || 0) * 100) / 100
        const ivaLinea = Math.round(netoLinea * ivaTasa / 100 * 100) / 100
        totalCentum += Math.round((netoLinea + ivaLinea) * 100) / 100
      }
    }
    importeValor = Math.round(totalCentum * 100) / 100

    // Validar que todos los artículos tengan IdArticulo válido
    const articulosSinId = ventaArticulos.filter(a => !a.IdArticulo || a.IdArticulo === 0)
    if (articulosSinId.length > 0) {
      throw new Error(`No se puede crear venta en Centum: ${articulosSinId.length} artículo(s) sin IdArticulo válido: ${articulosSinId.map(a => a.Codigo || a.Nombre || 'sin código').join(', ')}`)
    }

    // Validar que los precios de artículos no sean todos 0
    const preciosTodosZero = ventaArticulos.every(a => a.Precio === 0)
    if (preciosTodosZero) {
      throw new Error(`No se puede crear venta en Centum: todos los artículos tienen precio 0. Items originales: ${JSON.stringify(items.map(i => ({ nombre: i.nombre, precio_unitario: i.precio_unitario, precio: i.precio })))}`)
    }

    logger.info(`[Centum POS] esFacturaA=${esFacturaA}, subtotalOrig=${subtotalOriginal}, importeValor=${importeValor}, total=${total}`)
  }

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
    ...(esVentaGiftCard
      ? { VentaConceptos: ventaConceptos }
      : { VentaArticulos: ventaArticulos }),
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
    response = await breakers.centum.exec(() => fetchWithTimeout(url, {
      method: 'POST',
      headers: getHeaders({ operadorMovilUser }),
      body: JSON.stringify(body),
    }, 30000))
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
    logger.info(`[Centum POS] Venta creada: IdVenta=${data.IdVenta}, Total=${data.Total}`)

    // Verificar discrepancia de total: si Centum devuelve un total muy diferente, logear alerta
    const centumTotal = parseFloat(data.Total) || 0
    if (centumTotal > 0 && Math.abs(centumTotal - total) > total * 0.05) {
      logger.error(`[Centum POS] ⚠️ DISCREPANCIA DE TOTAL: POS=${total}, Centum=${centumTotal}, IdVenta=${data.IdVenta}. Body enviado: items=${ventaArticulos.length}, importeValor=${importeValor}`)
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
    logger.warn(`[Centum POS] HTTP 500 pero posiblemente creada. Response: ${texto.slice(0, 300)}`)
    registrarLlamada({
      servicio: 'centum_ventas_pos', endpoint: url, metodo: 'POST',
      estado: 'ok_con_warning', status_code: 500, duracion_ms: Date.now() - inicio,
      items_procesados: ventaArticulos.length, error_mensaje: 'HTTP 500', origen: 'pos',
    })
    return { _creadoConWarning: true, ...data }
  }

  // Debug info para CobroNoBalanceaException
  const debugInfo = (texto.includes('CobroNoBalancea'))
    ? ` [RT-SAFE: importeValor=${importeValor}, subtotalOriginal=${subtotalOriginal}, totalPOS=${total}, esFacturaA=${esFacturaA}, precios=${ventaArticulos.map(a=>`${a.Codigo}:${a.Precio}`).join('|')}]`
    : ''

  registrarLlamada({
    servicio: 'centum_ventas_pos', endpoint: url, metodo: 'POST',
    estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
    error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 300)}${debugInfo}`, origen: 'pos',
  })
  throw new Error(`Error al crear venta POS en Centum (${response.status}): ${texto.slice(0, 300)}${debugInfo}`)
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
    let idDivisionEmpresa = esFacturaA ? 3 : (soloEfectivo ? 2 : 3)

    // GC aplicada como pago → forzar B PRUEBA (división 2)
    if (parseFloat(ventaLocal.gc_aplicada_monto) > 0) {
      idDivisionEmpresa = 2
      logger.info(`[Centum POS] GC aplicada ($${ventaLocal.gc_aplicada_monto}) → forzando B PRUEBA`)
    }

    // Obtener operador móvil de la sucursal según división
    const operadorMovilUser = idDivisionEmpresa === 2
      ? (config.centum_operador_prueba || OPERADOR_MOVIL_USER_PRUEBA)
      : (config.centum_operador_empresa || null)

    logger.info(`[Centum POS] División=${idDivisionEmpresa}, operador=${operadorMovilUser}, sucursalFisica=${config.sucursalFisicaId}, PV=${config.puntoVenta}, configEmpresa=${config.centum_operador_empresa}, configPrueba=${config.centum_operador_prueba}`)

    // Guardar clasificación para que retries del cron usen la misma división
    if (ventaLocal.id) {
      supabase.from('ventas_pos').update({
        clasificacion: idDivisionEmpresa === 3 ? 'EMPRESA' : 'PRUEBA',
      }).eq('id', ventaLocal.id).then(() => {}).catch(() => {})
    }

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

    // GC aplicada como pago → crear NC concepto por el monto de GC
    if (parseFloat(ventaLocal.gc_aplicada_monto) > 0 && resultado) {
      try {
        const numDoc = resultado.NumeroDocumento
        const comprobante = numDoc ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}` : null
        await supabase.from('ventas_pos').insert({
          sucursal_id: ventaLocal.sucursal_id,
          cajero_id: ventaLocal.cajero_id,
          caja_id: ventaLocal.caja_id,
          id_cliente_centum: ventaLocal.id_cliente_centum || 2,
          nombre_cliente: ventaLocal.nombre_cliente || null,
          tipo: 'nota_credito',
          venta_origen_id: ventaLocal.id,
          total: parseFloat(ventaLocal.gc_aplicada_monto),
          subtotal: parseFloat(ventaLocal.gc_aplicada_monto),
          descuento_total: 0,
          monto_pagado: 0,
          vuelto: 0,
          items: JSON.stringify([{ descripcion: 'GIFT CARD', nombre: 'GIFT CARD', es_gift_card: true, cantidad: 1, precio_unitario: parseFloat(ventaLocal.gc_aplicada_monto), precio_final: parseFloat(ventaLocal.gc_aplicada_monto) }]),
          pagos: [],
          centum_sync: false,
          nc_concepto_tipo: 'gift_card',

          centum_comprobante: comprobante, // referencia a la factura de artículos
        })
        logger.info(`[Centum POS] NC Gift Card creada para venta ${ventaLocal.id}: monto=$${ventaLocal.gc_aplicada_monto}, ref=${comprobante}`)
      } catch (ncErr) {
        logger.error(`[Centum POS] Error al crear NC Gift Card para venta ${ventaLocal.id}:`, ncErr.message)
      }
    }

    return resultado
  } catch (err) {
    logger.error('[Centum POS] Error al registrar venta en Centum:', err.message, err.stack)
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
async function crearNotaCreditoPOS({ idCliente, sucursalFisicaId, idDivisionEmpresa, puntoVenta, items, total, condicionIva, operadorMovilUser, comprobanteOriginal, ventaPosId }) {
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

  logger.info(`[Centum POS NC] Preparando NC artículos: condicionIva=${condicionIva}, totalPOS=${total}, importeValor=${importeValor}, PV=${puntoVenta}`)

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

  // Anti-duplicación: marcar NC con UUID de la venta POS
  if (ventaPosId) {
    body.ObservacionInterna = `POS:${ventaPosId}`
  }

  // Agregar referencia al comprobante original (requerido para NC en Centum)
  // El campo correcto es "Referencia" (string), NO "NumeroReferencia" (objeto)
  if (comprobanteOriginal) {
    const ref = extraerPuntoVentaDeComprobante(comprobanteOriginal)
    if (ref) {
      body.Referencia = String(ref.numero)
      logger.info(`[Centum POS NC] Referencia: ${ref.numero} (de comprobante ${comprobanteOriginal})`)
    }
  }

  let response
  try {
    response = await breakers.centum.exec(() => fetchWithTimeout(url, {
      method: 'POST',
      headers: getHeaders({ operadorMovilUser }),
      body: JSON.stringify(body),
    }, 30000))
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
    logger.info(`[Centum POS NC] NC creada: IdVenta=${data.IdVenta}, Total=${data.Total}`)
    return data
  }

  if (response.status === 500) {
    logger.warn(`[Centum POS NC] HTTP 500 pero posiblemente creada. Response: ${texto.slice(0, 300)}`)
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
async function crearNotaCreditoConceptoPOS({ idCliente, sucursalFisicaId, idDivisionEmpresa, puntoVenta, total, condicionIva, descripcion, operadorMovilUser, comprobanteOriginal, concepto = {}, ventaPosId }) {
  const url = `${BASE_URL}/Ventas`
  const inicio = Date.now()

  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'
  const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'

  // Parámetros del concepto (con defaults para backwards compat)
  const { idConcepto = 25, codigoConcepto = '23', nombreConcepto = 'DIFERENCIA EN PRECIO DE GONDOLA' } = concepto

  // Para NC por concepto: el importe del concepto
  // Factura A: Centum espera neto, Factura B: importe final
  const importeConcepto = esFacturaA ? Math.round(total / 1.21 * 100) / 100 : total
  const importeValor = total // El valor efectivo siempre es el total con IVA

  logger.info(`[Centum POS NC Concepto] Preparando NC concepto: condicionIva=${condicionIva}, total=${total}, importeConcepto=${importeConcepto}, PV=${puntoVenta}, concepto=${nombreConcepto}`)

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

  // Anti-duplicación: marcar NC con UUID de la venta POS
  if (ventaPosId) {
    body.ObservacionInterna = `POS:${ventaPosId}`
  }

  // Nombre fijo, detalle de artículos en Observaciones
  if (descripcion) {
    body.Observaciones = descripcion
  }

  body.VentaConceptos = [{
    IdConcepto: idConcepto,
    Codigo: codigoConcepto,
    Nombre: nombreConcepto,
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
    response = await breakers.centum.exec(() => fetchWithTimeout(url, {
      method: 'POST',
      headers: getHeaders({ operadorMovilUser }),
      body: JSON.stringify(body),
    }, 30000))
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
    logger.info(`[Centum POS NC Concepto] NC creada: IdVenta=${data.IdVenta}, Total=${data.Total}`)
    return data
  }

  if (response.status === 500) {
    logger.warn(`[Centum POS NC Concepto] HTTP 500 pero posiblemente creada. Response: ${texto.slice(0, 300)}`)
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
    response = await breakers.centum.exec(() => fetchWithTimeout(url, {
      method: 'GET',
      headers: getHeaders(),
    }, 30000))
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

  logger.info(`[Centum POS] GET Venta ${idVenta}: CAE=${data.CAE || '(vacío)'}, FechaVtoCAE=${data.FechaVencimientoCAE || '(vacío)'}`)
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
    // Buscar en Centum BI (SQL Server) si ya existe una venta que coincida
    // Prioridad 1: buscar por ObservacionInterna (UUID exacto de la venta POS)
    // Prioridad 2: buscar por total aproximado + sucursal + fecha
    const { getPool } = require('../config/centum')
    const sql = require('mssql')
    const db = await getPool()

    const hoy = new Date().toISOString().split('T')[0]

    // Intento 1: Buscar por ObservacionInterna (match exacto por UUID — el más confiable)
    try {
      const obsResult = await db.request()
        .input('obs', sql.VarChar, `POS:${ventaPosId}`)
        .input('fecha', sql.VarChar, hoy)
        .query(`
          SELECT TOP 1 VentaID, NumeroDocumento, Total, FechaCreacion
          FROM Ventas_VIEW
          WHERE ObservacionInterna = @obs
            AND FechaDocumento >= @fecha
            AND Anulado = 0
        `)
      if (obsResult.recordset.length > 0) {
        const row = obsResult.recordset[0]
        logger.info(`[Centum POS] Venta encontrada por ObservacionInterna POS:${ventaPosId} → VentaID=${row.VentaID}`)
        const numDocStr = (row.NumeroDocumento || '').trim()
        const numDocMatch = numDocStr.match(/^([A-Z])(\d+)-(\d+)$/)
        return {
          IdVenta: row.VentaID,
          NumeroDocumento: numDocMatch ? {
            LetraDocumento: numDocMatch[1],
            PuntoVenta: parseInt(numDocMatch[2]),
            Numero: parseInt(numDocMatch[3]),
          } : null,
          Total: row.Total,
          CAE: null,
        }
      }
    } catch (obsErr) {
      // Si Ventas_VIEW no tiene ObservacionInterna, el query falla silenciosamente
      logger.info(`[Centum POS] ObservacionInterna no disponible en BI: ${obsErr.message?.slice(0, 100)}`)
    }

    // Intento 2: Buscar por total + sucursal + fecha (fallback)
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
      logger.info(`[Centum POS] No se encontró venta existente en BI para total=${total}, sucursal=${sucursalFisicaId}`)
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
        logger.info(`[Centum POS] Venta BI ${row.VentaID} ya vinculada a POS ${yaVinculada.id}, buscando otra`)
      }
    }

    if (!existente) {
      logger.info(`[Centum POS] Todas las ventas BI con total=${total} ya están vinculadas`)
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

    logger.info(`[Centum POS] Venta existente encontrada en BI: VentaID=${existente.VentaID}, NumDoc=${numDocStr}, Total=${existente.Total}`)
    return {
      IdVenta: existente.VentaID,
      NumeroDocumento: numDoc,
      Total: existente.Total,
      CAE: null, // Se obtiene después con fetchAndSaveCAE
    }
  } catch (err) {
    // Distinguir errores de conexión (BI caído) de errores de datos
    const msg = (err.message || '').toLowerCase()
    const esConexion = msg.includes('connect') || msg.includes('timeout') || msg.includes('econnrefused')
      || msg.includes('econnreset') || msg.includes('socket') || msg.includes('network')
      || msg.includes('failed to connect') || msg.includes('pool')
    if (esConexion) {
      logger.error(`[Centum POS] BI CAÍDO al buscar venta existente: ${err.message}`)
      throw err // Propagar — el caller NO debe crear la venta si BI está caído
    }
    logger.warn(`[Centum POS] Error no-conexión al buscar venta existente en BI: ${err.message}`)
    return null
  }
}

/**
 * Busca una venta existente en Centum vía API REST (POST /Ventas/FiltrosVenta/).
 * Canal alternativo a BI — consulta directo al servidor Centum (sin replicación).
 * Busca por ObservacionesInternas que contenga "POS:{uuid}".
 * @returns {Object|null} Venta encontrada o null
 */
async function buscarVentaExistenteEnCentumAPI(ventaPosId, sucursalFisicaId) {
  if (!ventaPosId) return null
  const url = `${BASE_URL}/Ventas/FiltrosVenta/?numeroPagina=1&cantidadItemsPorPagina=50`
  const hoy = new Date().toISOString().split('T')[0]
  const inicio = Date.now()

  let response
  try {
    response = await breakers.centum.exec(() => fetchWithTimeout(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        fechaDocumentoDesde: hoy,
        fechaDocumentoHasta: hoy,
        idSucursal: sucursalFisicaId,
      }),
    }, 30000))
  } catch (err) {
    logger.warn(`[Centum API Check] Error de conexión: ${err.message}`)
    throw new Error('API Centum no disponible: ' + err.message)
  }

  if (!response.ok) {
    const texto = await response.text().catch(() => '')
    logger.warn(`[Centum API Check] HTTP ${response.status}: ${texto.slice(0, 200)}`)
    throw new Error(`API Centum error ${response.status}`)
  }

  const data = await response.json()
  const ventas = data?.Ventas?.Items || []

  registrarLlamada({
    servicio: 'centum_ventas_api_check', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: ventas.length, origen: 'anti-dup',
  })

  // Buscar por ObservacionesInternas que contenga nuestro UUID
  const target = `POS:${ventaPosId}`
  const encontrada = ventas.find(v =>
    (v.ObservacionesInternas || '').includes(target) ||
    (v.ObservacionInterna || '').includes(target)
  )

  if (!encontrada) {
    logger.info(`[Centum API Check] No encontrada venta con ${target} entre ${ventas.length} del día (sucursal ${sucursalFisicaId})`)
    return null
  }

  logger.info(`[Centum API Check] ENCONTRADA venta POS:${ventaPosId} → IdVenta=${encontrada.IdVenta}`)
  return {
    IdVenta: encontrada.IdVenta,
    NumeroDocumento: encontrada.NumeroDocumento || null,
    Total: encontrada.Total || 0,
    CAE: encontrada.CAE || null,
  }
}

/**
 * Verificación anti-duplicación en 2 canales: BI (SQL Server) + API REST.
 * Estrategia: BI primero (rápido), API como fallback si BI falla.
 * Distingue 3 resultados:
 *   { found: true, data }          → ya existe, vincular
 *   { found: false }               → no encontrada en ningún canal, seguro crear
 *   { biDown: true, error }        → ambos canales fallaron, NO crear
 */
async function verificarEnBI(ventaPosId, sucursalFisicaId, puntoVenta, total) {
  // Canal 1: BI (SQL Server) — rápido, pero tiene delay de replicación
  try {
    const existente = await buscarVentaExistenteEnCentum(ventaPosId, sucursalFisicaId, puntoVenta, total)
    if (existente) return { found: true, data: existente }
    return { found: false }
  } catch (biErr) {
    logger.warn(`[AntiDup] BI caído (${biErr.message}), intentando vía API REST...`)

    // Canal 2: API REST — directo a Centum, sin replicación
    try {
      const existenteAPI = await buscarVentaExistenteEnCentumAPI(ventaPosId, sucursalFisicaId)
      if (existenteAPI) return { found: true, data: existenteAPI }
      return { found: false }
    } catch (apiErr) {
      logger.error(`[AntiDup] Ambos canales caídos — BI: ${biErr.message}, API: ${apiErr.message}`)
      return { biDown: true, error: `BI: ${biErr.message} | API: ${apiErr.message}` }
    }
  }
}

/**
 * Retry automático con máquina de estados anti-duplicación.
 * Principio: después de CUALQUIER POST, SIEMPRE verificar en BI antes de reintentar.
 * Si BI no está disponible, NO reintentar — esperar.
 */
async function retrySyncVentasCentum() {
  const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  // Grace period de 10 segundos (solo para evitar leer una venta a medio escribir)
  const hace10s = new Date(Date.now() - 10 * 1000).toISOString()

  // Buscar ventas pendientes (no sincronizadas, con caja asignada)
  // Incluye centum_intentos y centum_ultimo_intento para la máquina de estados
  const { data: pendientes, error } = await supabase
    .from('ventas_pos')
    .select('id, caja_id, id_cliente_centum, items, pagos, total, tipo, venta_origen_id, nombre_cliente, numero_venta, centum_error, centum_intentos, centum_ultimo_intento, gc_aplicada_monto, nc_concepto_tipo, sucursal_id, cajero_id, centum_comprobante, condicion_iva, clasificacion')
    .eq('centum_sync', false)
    .not('caja_id', 'is', null)
    .gte('created_at', hace30d)
    .lte('created_at', hace10s)
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) {
    logger.error('[RetryCentumVentas] Error en query Supabase:', error.message || error)
    return { reintentadas: 0, exitosas: 0, fallidas: 0 }
  }
  if (!pendientes?.length) {
    return { reintentadas: 0, exitosas: 0, fallidas: 0 }
  }

  // ============ MÁQUINA DE ESTADOS: filtrar por cooldown y max reintentos ============
  const ahoraMs = Date.now()
  let enCooldown = 0
  let enMaxRetries = 0
  const ventasReady = pendientes.filter(v => {
    const intentos = v.centum_intentos || 0

    // MAX_RETRIES: ya agotó intentos → no reintentar
    if (intentos >= MAX_INTENTOS) {
      // Marcar si no tiene el prefijo aún (puede pasar si se agregó la columna después)
      if (!v.centum_error || !v.centum_error.startsWith(PREFIX_MAX_RETRIES)) {
        supabase.from('ventas_pos').update({
          centum_error: `${PREFIX_MAX_RETRIES}${intentos} intentos agotados. Verificar manualmente.`
        }).eq('id', v.id).then(() => {})
      }
      enMaxRetries++
      return false
    }

    // COOLDOWN: si tiene intentos previos, respetar cooldown según nro de intento
    if (intentos > 0 && v.centum_ultimo_intento) {
      const tsUltimo = new Date(v.centum_ultimo_intento).getTime()
      const cooldownRequerido = cooldownWithBackoff(intentos) // exponential backoff with jitter
      const transcurrido = ahoraMs - tsUltimo
      if (transcurrido < cooldownRequerido) {
        const restante = Math.round((cooldownRequerido - transcurrido) / 1000)
        logger.info(`[RetryCentumVentas] Venta ${v.id} en cooldown (intento ${intentos}, faltan ${restante}s)`)
        enCooldown++
        return false
      }
    }

    // Compatibilidad: migrar formato viejo 500_NOVERIFY| al nuevo sistema
    if (intentos === 0 && v.centum_error && v.centum_error.startsWith('500_NOVERIFY|')) {
      const ts = parseInt(v.centum_error.split('|')[1], 10)
      if (!isNaN(ts)) {
        // Migrar: poner intentos=1 y usar el timestamp del error como ultimo intento
        supabase.from('ventas_pos').update({
          centum_intentos: 1,
          centum_ultimo_intento: new Date(ts).toISOString(),
          centum_error: `${PREFIX_UNVERIFIED}migrado de 500_NOVERIFY`
        }).eq('id', v.id).then(() => {})
        enCooldown++
        return false // Se procesará en el próximo ciclo con el nuevo formato
      }
    }

    return true
  })

  logger.info(`[RetryCentumVentas] ${pendientes.length} pendientes: ${ventasReady.length} listas, ${enCooldown} en cooldown, ${enMaxRetries} max reintentos`)

  if (!ventasReady.length) {
    return { reintentadas: 0, exitosas: 0, fallidas: 0, enCooldown, enMaxRetries }
  }

  let exitosas = 0
  let fallidas = 0

  for (let i = 0; i < ventasReady.length; i++) {
    const venta = ventasReady[i]
    const intentos = venta.centum_intentos || 0

    // ============ ATOMIC CLAIM: lock a nivel de base de datos ============
    // Previene que múltiples instancias (ej: durante deploy Render) procesen la misma venta.
    // NOTA: Supabase .update().select() evalúa TODOS los filtros sobre la fila YA ACTUALIZADA
    // (PostgREST re-aplica WHERE al RETURNING). Por eso hacemos UPDATE sin .select() y
    // verificamos con un SELECT separado usando el timestamp exacto como "claim token".
    const ahoraClaim = new Date().toISOString()
    // Ventana de 5 minutos: previene que una nueva instancia (deploy Render) reclame
    // una venta que la instancia vieja está procesando. El POST timeout es 30s, pero
    // durante deploy ambas instancias corren en paralelo ~30-90s + BI replication lag.
    const hace5min = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    // Paso 1: UPDATE condicional (sin .select para evitar el bug de PostgREST)
    await supabase
      .from('ventas_pos')
      .update({ centum_ultimo_intento: ahoraClaim })
      .eq('id', venta.id)
      .eq('centum_sync', false)
      .or(`centum_ultimo_intento.is.null,centum_ultimo_intento.lt.${hace5min}`)

    // Paso 2: Verificar si NUESTRO claim ganó (nuestro timestamp exacto quedó escrito)
    const { data: claimed } = await supabase
      .from('ventas_pos')
      .select('id')
      .eq('id', venta.id)
      .eq('centum_ultimo_intento', ahoraClaim)

    if (!claimed || claimed.length === 0) {
      logger.info(`[RetryCentumVentas] Venta ${venta.id} ya reclamada por otra instancia, saltando`)
      continue
    }

    logger.info(`[RetryCentumVentas] Procesando ${i+1}/${ventasReady.length}: venta ${venta.id} (#${venta.numero_venta || '?'}, intentos=${intentos}, cliente: ${venta.nombre_cliente || 'CF'})`)
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
        await supabase.from('ventas_pos').update({
          centum_error: `${PREFIX_DEFINITIVE}sin config Centum en caja/sucursal`
        }).eq('id', venta.id)
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

      // Si el cliente no tiene id_centum, intentar resolver desde DB local (o crearlo en Centum)
      if (!esEmpleado && (!venta.id_cliente_centum || venta.id_cliente_centum === 0)) {
        if (venta.nombre_cliente && venta.nombre_cliente !== 'Consumidor Final') {
          const { data: cliLocal } = await supabase
            .from('clientes')
            .select('*')
            .ilike('razon_social', venta.nombre_cliente)
            .limit(1)
            .maybeSingle()

          if (cliLocal?.id_centum) {
            // Ya tiene id_centum, usar directamente
            venta.id_cliente_centum = cliLocal.id_centum
            await supabase.from('ventas_pos').update({ id_cliente_centum: cliLocal.id_centum }).eq('id', venta.id)
            logger.info(`[Centum Retry] Cliente resuelto: ${venta.nombre_cliente} → id_centum=${cliLocal.id_centum}`)
          } else if (cliLocal) {
            // Cliente existe local pero sin id_centum → crearlo en Centum
            try {
              const condIva = venta.condicion_iva || cliLocal.condicion_iva || 'CF'
              const dir = cliLocal.direccion ? { direccion: cliLocal.direccion, localidad: cliLocal.localidad } : null
              const resultado = await crearClienteEnCentum(cliLocal, condIva, dir)
              const idCentum = resultado.IdCliente || resultado.Id
              if (idCentum) {
                await supabase.from('clientes').update({ id_centum: idCentum }).eq('id', cliLocal.id)
                venta.id_cliente_centum = idCentum
                await supabase.from('ventas_pos').update({ id_cliente_centum: idCentum }).eq('id', venta.id)
                logger.info(`[Centum Retry] Cliente "${venta.nombre_cliente}" creado en Centum → id_centum=${idCentum}`)
              } else {
                throw new Error('Centum no devolvió IdCliente')
              }
            } catch (errCli) {
              await supabase.from('ventas_pos').update({
                centum_error: `Error creando cliente "${venta.nombre_cliente}" en Centum: ${errCli.message}`
              }).eq('id', venta.id)
              fallidas++
              continue
            }
          } else {
            // Cliente no existe ni localmente
            await supabase.from('ventas_pos').update({
              centum_error: `Cliente "${venta.nombre_cliente}" no encontrado en DB local`
            }).eq('id', venta.id)
            fallidas++
            continue
          }
        }
      }

      // Determinar condición IVA del cliente real (no confiar en venta.condicion_iva,
      // que puede estar desactualizada o ser incorrecta respecto a Centum)
      let condicionIva = 'CF'
      if (!esEmpleado && venta.id_cliente_centum && venta.id_cliente_centum !== 2) {
        const { data: cliente } = await supabase
          .from('clientes').select('condicion_iva')
          .eq('id_centum', venta.id_cliente_centum).maybeSingle()
        condicionIva = cliente?.condicion_iva || venta.condicion_iva || 'CF'
      } else if (venta.condicion_iva) {
        condicionIva = venta.condicion_iva
      }

      const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
      const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
      const pagos = Array.isArray(venta.pagos) ? venta.pagos : []
      const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
      let idDivisionEmpresa

      // Fix anti-duplicación: si ya se calculó la clasificación en un intento previo, reutilizarla.
      // Esto previene que retries determinen una división diferente (ej: PRUEBA vs EMPRESA).
      if (venta.clasificacion === 'EMPRESA') {
        idDivisionEmpresa = 3
      } else if (venta.clasificacion === 'PRUEBA') {
        idDivisionEmpresa = 2
      } else {
        // Primera vez: calcular normalmente
        idDivisionEmpresa = esEmpleado ? 2 : (esFacturaA ? 3 : (soloEfectivo ? 2 : 3))

        // GC aplicada como pago → forzar B PRUEBA (división 2)
        if (parseFloat(venta.gc_aplicada_monto) > 0) {
          idDivisionEmpresa = 2
          logger.info(`[RetryCentumVentas] GC aplicada ($${venta.gc_aplicada_monto}) → forzando B PRUEBA`)
        }
      }

      const operadorMovilUser = idDivisionEmpresa === 2
        ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
        : (centumOperadorEmpresa || null)

      const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
      let resultado

      if (venta.tipo === 'nota_credito') {
        // ============ VERIFICACIÓN BI PARA NCs (anti-duplicación) ============
        {
          const checkNC = await verificarEnBI(venta.id, sucursalFisicaId, puntoVenta, Math.abs(parseFloat(venta.total) || 0))

          if (checkNC.found) {
            logger.info(`[RetryCentumVentas] NC ${venta.id} ENCONTRADA en BI (intento ${intentos}): IdVenta=${checkNC.data.IdVenta}`)
            const numDocEx = checkNC.data.NumeroDocumento
            const comprobanteEx = numDocEx
              ? `${numDocEx.LetraDocumento || ''} PV${numDocEx.PuntoVenta}-${numDocEx.Numero}`
              : null
            await supabase.from('ventas_pos').update({
              id_venta_centum: checkNC.data.IdVenta || null,
              centum_comprobante: comprobanteEx,
              centum_sync: true,
              centum_error: null,
              numero_cae: checkNC.data.CAE || null,
            }).eq('id', venta.id)
            fetchAndSaveCAE(venta.id, checkNC.data.IdVenta)
            exitosas++
            continue
          }

          if (checkNC.biDown) {
            logger.warn(`[RetryCentumVentas] NC ${venta.id}: BI CAÍDO, abortando`)
            fallidas++
            continue
          }

          logger.info(`[RetryCentumVentas] NC ${venta.id}: verificada en BI, NO encontrada → seguro ${intentos > 0 ? 'reintentar' : 'crear'}`)
        }

        // Pre-write para NC: registrar intento ANTES del POST
        await supabase.from('ventas_pos').update({
          centum_intentos: (venta.centum_intentos || 0) + 1,
          centum_ultimo_intento: new Date().toISOString(),
        }).eq('id', venta.id)

        // NC Gift Card: concepto VENTA GIFT CARD, siempre B PRUEBA
        if (venta.nc_concepto_tipo === 'gift_card') {
          // centum_comprobante almacena la referencia a la factura de artículos
          const comprobanteRef = venta.centum_comprobante || null
          const idClienteNC = venta.id_cliente_centum || 2
          const operadorNC = centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA
          resultado = await crearNotaCreditoConceptoPOS({
            idCliente: idClienteNC, sucursalFisicaId, idDivisionEmpresa: 2, puntoVenta,
            total: Math.abs(parseFloat(venta.total) || 0), condicionIva: 'CF',
            descripcion: `NC GIFT CARD - Venta origen: ${comprobanteRef || 'N/A'}`,
            operadorMovilUser: operadorNC, comprobanteOriginal: comprobanteRef,
            concepto: { idConcepto: 20, codigoConcepto: 'GIFTCARD', nombreConcepto: 'VENTA GIFT CARD' },
            ventaPosId: venta.id,
          })
        } else {
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
            ventaPosId: venta.id,
          })
        } else {
          resultado = await crearNotaCreditoPOS({
            idCliente: idClienteNC, sucursalFisicaId, idDivisionEmpresa: idDivisionNC, puntoVenta,
            items: itemsPositivos, total: Math.abs(parseFloat(venta.total) || 0),
            condicionIva: condicionIvaNC, operadorMovilUser: operadorNC, comprobanteOriginal,
            ventaPosId: venta.id,
          })
        }
        }
      } else {
        // ============ VERIFICACIÓN OBLIGATORIA EN BI (SIEMPRE, incluso primer intento) ============
        // Antes se verificaba solo si intentos > 0, pero durante deploys de Render la
        // instancia vieja puede haber posteado la venta antes de que esta instancia arranque.
        // También protege contra IIFEs (pedidos/delivery) que postearon pero no guardaron el resultado.
        {
          const check = await verificarEnBI(venta.id, sucursalFisicaId, puntoVenta, parseFloat(venta.total) || 0)

          if (check.found) {
            // Ya existe en Centum → vincular sin crear duplicado
            logger.info(`[RetryCentumVentas] Venta ${venta.id} ENCONTRADA en BI (intento ${intentos}): IdVenta=${check.data.IdVenta}`)
            const numDocEx = check.data.NumeroDocumento
            const comprobanteEx = numDocEx
              ? `${numDocEx.LetraDocumento || ''} PV${numDocEx.PuntoVenta}-${numDocEx.Numero}`
              : null
            await supabase.from('ventas_pos').update({
              id_venta_centum: check.data.IdVenta || null,
              centum_comprobante: comprobanteEx,
              centum_sync: true,
              centum_error: null,
              numero_cae: check.data.CAE || null,
            }).eq('id', venta.id)
            fetchAndSaveCAE(venta.id, check.data.IdVenta)
            // GC aplicada → crear NC si no existe ya
            if (parseFloat(venta.gc_aplicada_monto) > 0) {
              try {
                const { data: ncExiste } = await supabase.from('ventas_pos')
                  .select('id').eq('venta_origen_id', venta.id).eq('nc_concepto_tipo', 'gift_card').maybeSingle()
                if (!ncExiste) {
                  await supabase.from('ventas_pos').insert({
                    sucursal_id: venta.sucursal_id, cajero_id: venta.cajero_id, caja_id: venta.caja_id,
                    id_cliente_centum: venta.id_cliente_centum || 2, nombre_cliente: venta.nombre_cliente || null,
                    tipo: 'nota_credito', venta_origen_id: venta.id, total: parseFloat(venta.gc_aplicada_monto),
                    subtotal: parseFloat(venta.gc_aplicada_monto), descuento_total: 0, monto_pagado: 0, vuelto: 0,
                    items: JSON.stringify([{ descripcion: 'GIFT CARD', nombre: 'GIFT CARD', es_gift_card: true, cantidad: 1, precio_unitario: parseFloat(venta.gc_aplicada_monto), precio_final: parseFloat(venta.gc_aplicada_monto) }]),
                    pagos: [], centum_sync: false, nc_concepto_tipo: 'gift_card', clasificacion: 'NC-B_PRUEBA',
                    centum_comprobante: comprobanteEx,
                  })
                  logger.info(`[RetryCentumVentas] NC Gift Card creada (BI found) para venta ${venta.id}: monto=$${venta.gc_aplicada_monto}`)
                }
              } catch (ncErr) { logger.error(`[RetryCentumVentas] Error NC GC (BI found) venta ${venta.id}:`, ncErr.message) }
            }
            exitosas++
            continue
          }

          if (check.biDown) {
            // BI caído → NO crear la venta, esperar al próximo ciclo
            logger.warn(`[RetryCentumVentas] Venta ${venta.id}: BI CAÍDO, abortando (${check.error})`)
            fallidas++
            continue
          }

          // check.found === false → no existe en BI, seguro crear/reintentar
          logger.info(`[RetryCentumVentas] Venta ${venta.id}: verificada en BI, NO encontrada → seguro ${intentos > 0 ? 'reintentar' : 'crear'} (intento ${intentos + 1})`)
        }

        // ============ PRE-WRITE: registrar intento ANTES del POST ============
        const nuevoIntentos = intentos + 1
        const clasificacionCalculada = idDivisionEmpresa === 3 ? 'EMPRESA' : 'PRUEBA'
        const preWriteData = {
          centum_intentos: nuevoIntentos,
          centum_ultimo_intento: new Date().toISOString(),
        }
        // Guardar clasificación para que retries futuros usen la misma división
        if (!venta.clasificacion) {
          preWriteData.clasificacion = clasificacionCalculada
        }
        await supabase.from('ventas_pos').update(preWriteData).eq('id', venta.id)

        // ============ POST a Centum ============
        try {
          resultado = await crearVentaPOS({
            idCliente: venta.id_cliente_centum || 2,
            sucursalFisicaId, idDivisionEmpresa, puntoVenta,
            items, pagos, total: parseFloat(venta.total) || 0,
            condicionIva, operadorMovilUser,
            ventaPosId: venta.id,
          })
        } catch (postErr) {
          // CUALQUIER error post-POST → marcar UNVERIFIED
          // No distinguimos 500 de timeout — SIEMPRE verificar en BI antes de reintentar
          logger.warn(`[RetryCentumVentas] Venta ${venta.id}: POST falló (intento ${nuevoIntentos}): ${postErr.message}`)
          await supabase.from('ventas_pos').update({
            id_venta_centum: null,
            centum_comprobante: null,
            centum_sync: false,
            centum_error: `${PREFIX_UNVERIFIED}intento ${nuevoIntentos}: ${(postErr.message || '').slice(0, 150)}`,
            numero_cae: null,
          }).eq('id', venta.id)
          fallidas++
          continue
        }
      }

      // ============ POST exitoso → verificar con GET para confirmar ============
      let numDoc = resultado?.NumeroDocumento
      let comprobante = numDoc
        ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
        : null

      let caeReal = resultado?.CAE || null
      let ventaConfirmada = !resultado?._creadoConWarning
      if (resultado?.IdVenta) {
        try {
          const centumReal = await obtenerVentaCentum(resultado.IdVenta)
          const numDocReal = centumReal?.NumeroDocumento
          if (numDocReal && numDocReal.PuntoVenta && numDocReal.Numero) {
            comprobante = `${numDocReal.LetraDocumento || ''} PV${numDocReal.PuntoVenta}-${numDocReal.Numero}`
          }
          if (centumReal?.CAE) caeReal = centumReal.CAE
          ventaConfirmada = true
        } catch (e) {
          logger.warn(`[RetryCentumVentas] No se pudo verificar venta ${venta.id} en Centum:`, e.message)
          if (resultado?._creadoConWarning) {
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
        if (resultado?._discrepanciaTotal) {
          updateData.centum_error = `ALERTA: Total POS=$${resultado._totalPOS} vs Centum=$${resultado._totalCentum}`
        }
        await supabase.from('ventas_pos').update(updateData).eq('id', venta.id)

        // GC aplicada como pago → crear NC concepto por el monto de GC
        if (parseFloat(venta.gc_aplicada_monto) > 0 && venta.tipo !== 'nota_credito') {
          try {
            // Anti-dup: verificar que no exista ya una NC GC para esta venta
            const { data: ncGcExiste } = await supabase.from('ventas_pos')
              .select('id').eq('venta_origen_id', venta.id).eq('nc_concepto_tipo', 'gift_card').maybeSingle()
            if (ncGcExiste) {
              logger.info(`[RetryCentumVentas] NC Gift Card ya existe para venta ${venta.id} (id=${ncGcExiste.id}), saltando`)
            } else {
            await supabase.from('ventas_pos').insert({
              sucursal_id: venta.sucursal_id,
              cajero_id: venta.cajero_id,
              caja_id: venta.caja_id,
              id_cliente_centum: venta.id_cliente_centum || 2,
              nombre_cliente: venta.nombre_cliente || null,
              tipo: 'nota_credito',
              venta_origen_id: venta.id,
              total: parseFloat(venta.gc_aplicada_monto),
              subtotal: parseFloat(venta.gc_aplicada_monto),
              descuento_total: 0,
              monto_pagado: 0,
              vuelto: 0,
              items: JSON.stringify([{ descripcion: 'GIFT CARD', nombre: 'GIFT CARD', es_gift_card: true, cantidad: 1, precio_unitario: parseFloat(venta.gc_aplicada_monto), precio_final: parseFloat(venta.gc_aplicada_monto) }]),
              pagos: [],
              centum_sync: false,
              nc_concepto_tipo: 'gift_card',
    
              centum_comprobante: comprobante, // referencia a la factura de artículos
            })
            logger.info(`[RetryCentumVentas] NC Gift Card creada para venta ${venta.id}: monto=$${venta.gc_aplicada_monto}, ref=${comprobante}`)
            }
          } catch (ncErr) {
            logger.error(`[RetryCentumVentas] Error al crear NC Gift Card para venta ${venta.id}:`, ncErr.message)
          }
        }
      } else {
        // No confirmada → UNVERIFIED (se verificará en BI en el próximo ciclo)
        const nuevoIntentos = (venta.centum_intentos || 0) + (venta.tipo !== 'nota_credito' ? 0 : 1)
        await supabase.from('ventas_pos').update({
          id_venta_centum: null,
          centum_comprobante: null,
          centum_sync: false,
          centum_error: `${PREFIX_UNVERIFIED}POST OK pero GET falló`,
          centum_intentos: nuevoIntentos || (venta.centum_intentos || 0),
          centum_ultimo_intento: new Date().toISOString(),
          numero_cae: null,
        }).eq('id', venta.id)
        logger.warn(`[RetryCentumVentas] Venta ${venta.id}: creación no confirmada → UNVERIFIED`)
      }

      logger.info(`[RetryCentumVentas] Venta ${venta.id} OK: Comprobante=${comprobante}`)
      if (!caeReal && resultado?.IdVenta) fetchAndSaveCAE(venta.id, resultado.IdVenta)
      exitosas++
    } catch (err) {
      logger.error(`[RetryCentumVentas] Error venta ${venta.id} (#${venta.numero_venta}):`, err.message)
      try {
        registrarLlamada({
          servicio: 'centum_ventas_retry', endpoint: `venta #${venta.numero_venta}`, metodo: 'POST',
          estado: 'error', duracion_ms: 0, error_mensaje: (err.message || '').slice(0, 500), origen: 'cron',
        })
        await supabase.from('ventas_pos').update({ centum_error: `Retry: ${(err.message || '').slice(0, 200)}` }).eq('id', venta.id)
      } catch (e2) {
        logger.error(`[RetryCentumVentas] No se pudo guardar centum_error para venta ${venta.id}:`, e2.message)
      }
      fallidas++
    }

    // Pausa de 2 segundos entre ventas para no saturar Centum
    if (i < ventasReady.length - 1) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // ============ SAFETY NET: crear NCs faltantes para ventas con GC aplicada ya sincronizadas ============
  // Cubre el caso en que otra instancia (ej: Render producción) sincronizó la venta sin crear la NC
  try {
    const { data: ventasSinNC } = await supabase
      .from('ventas_pos')
      .select('id, sucursal_id, cajero_id, caja_id, id_cliente_centum, nombre_cliente, gc_aplicada_monto, centum_comprobante')
      .eq('centum_sync', true)
      .eq('tipo', 'venta')
      .gt('gc_aplicada_monto', 0)
      .gte('created_at', hace30d)
      .limit(20)

    if (ventasSinNC?.length > 0) {
      // Buscar cuáles ya tienen NC gift_card creada
      const ids = ventasSinNC.map(v => v.id)
      const { data: ncsExistentes } = await supabase
        .from('ventas_pos')
        .select('venta_origen_id')
        .in('venta_origen_id', ids)
        .eq('nc_concepto_tipo', 'gift_card')

      const idsConNC = new Set((ncsExistentes || []).map(nc => nc.venta_origen_id))
      const faltantes = ventasSinNC.filter(v => !idsConNC.has(v.id))

      for (const v of faltantes) {
        await supabase.from('ventas_pos').insert({
          sucursal_id: v.sucursal_id, cajero_id: v.cajero_id, caja_id: v.caja_id,
          id_cliente_centum: v.id_cliente_centum || 2, nombre_cliente: v.nombre_cliente || null,
          tipo: 'nota_credito', venta_origen_id: v.id, total: parseFloat(v.gc_aplicada_monto),
          subtotal: parseFloat(v.gc_aplicada_monto), descuento_total: 0, monto_pagado: 0, vuelto: 0,
          items: JSON.stringify([{ descripcion: 'GIFT CARD', nombre: 'GIFT CARD', es_gift_card: true, cantidad: 1, precio_unitario: parseFloat(v.gc_aplicada_monto), precio_final: parseFloat(v.gc_aplicada_monto) }]),
          pagos: [], centum_sync: false, nc_concepto_tipo: 'gift_card',
          centum_comprobante: v.centum_comprobante,
        })
        logger.info(`[RetryCentumVentas] NC Gift Card (safety net) creada para venta ${v.id}: monto=$${v.gc_aplicada_monto}`)
      }
    }
  } catch (safetyErr) {
    logger.error('[RetryCentumVentas] Error en safety net NC GC:', safetyErr.message)
  }

  registrarLlamada({
    servicio: 'centum_ventas_retry', endpoint: `retry batch`, metodo: 'BATCH',
    estado: 'ok', duracion_ms: 0, items_procesados: ventasReady.length,
    error_mensaje: `exitosas: ${exitosas}, fallidas: ${fallidas}, cooldown: ${enCooldown}, maxRetries: ${enMaxRetries}`, origen: 'cron',
  })
  return { reintentadas: ventasReady.length, exitosas, fallidas, enCooldown, enMaxRetries }
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
      logger.info(`[Centum POS] CAE guardado para venta ${ventaPosId}: ${cae}${updates.centum_comprobante ? `, comprobante=${updates.centum_comprobante}` : ''}`)

      // Envío automático de email (async, best effort)
      enviarComprobanteAutomatico(ventaPosId, cae, caeVto).catch(err => {
        logger.warn(`[Email Auto] Error para venta ${ventaPosId}:`, err.message)
      })
    } else if (updates.centum_comprobante) {
      // Sin CAE pero con comprobante real actualizado (ej: NC sin autorizar ARCA)
      await supabase.from('ventas_pos').update(updates).eq('id', ventaPosId)
      logger.info(`[Centum POS] Comprobante actualizado para venta ${ventaPosId}: ${updates.centum_comprobante}`)
    }
    return cae
  } catch (err) {
    logger.warn(`[Centum POS] No se pudo obtener CAE para venta ${ventaPosId}:`, err.message)
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
  if (error || !venta) { logger.info(`[Email Auto] Venta ${ventaPosId} no encontrada`); return }
  if (venta.email_enviado) return // Ya se envió

  // Obtener cliente y su email
  if (!venta.id_cliente_centum) { logger.info(`[Email Auto] Venta ${ventaPosId} sin cliente asignado`); return }
  const { data: cli } = await supabase.from('clientes')
    .select('razon_social, cuit, direccion, localidad, codigo_postal, telefono, condicion_iva, codigo, email')
    .eq('id_centum', venta.id_cliente_centum).single()
  if (!cli?.email) { logger.info(`[Email Auto] Cliente ${venta.id_cliente_centum} sin email (venta ${ventaPosId})`); return }

  // Verificar que sea EMPRESA (no PRUEBA)
  const condIva = cli.condicion_iva || 'CF'
  const esFacturaA = condIva === 'RI' || condIva === 'MT'
  const pagos = Array.isArray(venta.pagos) ? venta.pagos : []
  const tiposEf = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
  const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEf.includes((p.tipo || '').toLowerCase()))
  const esPrueba = !esFacturaA && soloEfectivo
  if (esPrueba) return

  // Generar link de descarga con token HMAC
  const crypto = require('crypto')
  const COMPROBANTE_SECRET = process.env.COMPROBANTE_SECRET || process.env.SUPABASE_SERVICE_KEY || 'comprobante-secret'
  const token = crypto.createHmac('sha256', COMPROBANTE_SECRET).update(String(ventaPosId)).digest('hex').slice(0, 32)
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`
  const linkPDF = `${backendUrl}/api/pos/ventas/${ventaPosId}/comprobante.pdf?token=${token}`

  const esNC = venta.tipo === 'nota_credito'
  const tipoDoc = esNC ? 'Nota de Crédito' : 'Comprobante'
  const numDoc = venta.centum_comprobante || `#${venta.numero_venta || ''}`

  const escapeHtml = (s) => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const { enviarEmail } = require('./email')
  await enviarEmail({
    to: cli.email.trim(),
    subject: `${tipoDoc} ${numDoc} - Almacen Zaatar`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <p>Estimado/a <strong>${escapeHtml(venta.nombre_cliente || 'Cliente')}</strong>,</p>
      <p>Su ${esNC ? 'nota de crédito' : 'comprobante de compra'} está disponible para descargar.</p>
      <p style="color:#555;font-size:13px">Número: <strong>${escapeHtml(numDoc)}</strong><br>
      Fecha: ${new Date(venta.created_at).toLocaleDateString('es-AR')}<br>
      Total: <strong>$${parseFloat(venta.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></p>
      <div style="text-align:center;margin:25px 0">
        <a href="${linkPDF}" style="background:#7c3aed;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">Descargar ${tipoDoc} PDF</a>
      </div>
      <p style="font-size:11px;color:#999;text-align:center">Si el botón no funciona, copiá y pegá este link en tu navegador:<br>
      <a href="${linkPDF}" style="color:#7c3aed;word-break:break-all">${linkPDF}</a></p>
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

  logger.info(`[Email Auto] Comprobante enviado a ${cli.email} para venta ${venta.numero_venta} (${numDoc})`)
}

/**
 * Cron: busca ventas sincronizadas con Centum (últimas 48h) que no tienen CAE guardado
 * e intenta obtenerlo. Si lo obtiene, dispara el envío automático de email.
 */
async function retrySyncCAE() {
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: ventas, error } = await supabase.from('ventas_pos')
    .select('id, numero_venta, id_venta_centum, centum_comprobante, pagos, id_cliente_centum')
    .eq('centum_sync', true)
    .not('id_venta_centum', 'is', null)
    .is('numero_cae', null)
    .gte('created_at', hace7d)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error || !ventas || ventas.length === 0) return { revisadas: 0, conCAE: 0, omitidas: 0 }

  // Filtrar: solo ventas EMPRESA (factura electrónica) necesitan CAE
  // Factura A (RI/MT) → siempre EMPRESA → siempre necesita CAE
  // Factura B (CF) + solo efectivo → PRUEBA → nunca tiene CAE
  // Factura B (CF) + pago electrónico → EMPRESA → necesita CAE
  const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
  const necesitanCAE = ventas.filter(v => {
    const comp = v.centum_comprobante || ''
    const esFacturaA = comp.startsWith('A ')
    if (esFacturaA) return true
    // Factura B: solo necesita CAE si tiene pago electrónico (división EMPRESA)
    const pagos = Array.isArray(v.pagos) ? v.pagos : []
    const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
    return !soloEfectivo // tiene pago electrónico → EMPRESA → necesita CAE
  })

  const omitidas = ventas.length - necesitanCAE.length
  if (omitidas > 0) {
    logger.info(`[RetryCAE] Omitidas ${omitidas} ventas PRUEBA (factura manual, sin CAE esperado)`)
  }

  let conCAE = 0
  for (const v of necesitanCAE) {
    const cae = await fetchAndSaveCAE(v.id, v.id_venta_centum)
    if (cae) conCAE++
  }

  return { revisadas: necesitanCAE.length, conCAE, omitidas }
}

/**
 * Cron: reintenta enviar emails para ventas que ya tienen CAE pero email_enviado = false.
 * Cubre el caso donde el email falló silenciosamente al momento de obtener el CAE.
 */
async function retryEmailsPendientes() {
  const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: ventas, error } = await supabase.from('ventas_pos')
    .select('id, numero_venta, numero_cae, id_cliente_centum, pagos, centum_comprobante')
    .eq('email_enviado', false)
    .eq('centum_sync', true)
    .not('numero_cae', 'is', null)
    .gt('id_cliente_centum', 0)
    .gte('created_at', hace48h)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !ventas || ventas.length === 0) return { pendientes: 0, enviados: 0, sinEmail: 0, fallidos: 0 }

  let enviados = 0, sinEmail = 0, fallidos = 0
  for (const v of ventas) {
    try {
      await enviarComprobanteAutomatico(v.id, v.numero_cae, null)
      // Verificar si realmente se envió (puede haber sido saltado por falta de email del cliente)
      const { data: check } = await supabase.from('ventas_pos').select('email_enviado').eq('id', v.id).single()
      if (check?.email_enviado) {
        enviados++
      } else {
        sinEmail++
      }
    } catch (err) {
      fallidos++
      logger.warn(`[RetryEmails] Error venta ${v.numero_venta}:`, err.message)
    }
  }

  return { pendientes: ventas.length, enviados, sinEmail, fallidos }
}

module.exports = { crearVentaPOS, registrarVentaPOSEnCentum, crearNotaCreditoPOS, crearNotaCreditoConceptoPOS, extraerPuntoVentaDeComprobante, obtenerVentaCentum, buscarVentaExistenteEnCentum, verificarEnBI, retrySyncVentasCentum, fetchAndSaveCAE, retrySyncCAE, enviarComprobanteAutomatico, retryEmailsPendientes }
