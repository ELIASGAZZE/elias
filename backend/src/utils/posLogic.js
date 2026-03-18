// Funciones puras de lógica de negocio del POS
// Extraídas para ser testeables sin dependencias de BD/API

/**
 * Determina si es Factura A (precios netos) o B (precios finales)
 */
function esFacturaA(condicionIva) {
  return condicionIva === 'RI' || condicionIva === 'MT'
}

/**
 * Clasifica la división: EMPRESA (3) o PRUEBA (2)
 * - RI/MT → siempre EMPRESA
 * - CF + solo efectivo → PRUEBA
 * - CF + pago electrónico → EMPRESA
 */
const TIPOS_EFECTIVO = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']

function clasificarDivision(condicionIva, pagos) {
  if (esFacturaA(condicionIva)) return 3 // EMPRESA
  const soloEfectivo = !pagos || pagos.length === 0 || pagos.every(p => TIPOS_EFECTIVO.includes((p.tipo || '').toLowerCase()))
  return soloEfectivo ? 2 : 3 // PRUEBA o EMPRESA
}

/**
 * Clasifica la venta como 'EMPRESA' o 'PRUEBA' (texto)
 */
function clasificarVenta(condicionIva, pagos) {
  return clasificarDivision(condicionIva, pagos) === 3 ? 'EMPRESA' : 'PRUEBA'
}

/**
 * Convierte precio con IVA a precio neto (sin IVA)
 */
function precioNeto(precioConIva, ivaTasa = 21) {
  return Math.round(precioConIva / (1 + ivaTasa / 100) * 100) / 100
}

/**
 * Calcula el precio para Centum según tipo de factura
 * Factura A: neto (sin IVA) | Factura B: final (con IVA)
 */
function precioParaCentum(precioConIva, condicionIva, ivaTasa = 21) {
  return esFacturaA(condicionIva) ? precioNeto(precioConIva, ivaTasa) : precioConIva
}

/**
 * Calcula subtotal de artículos y aplica ajuste proporcional si hay descuento por forma de pago
 * Retorna { subtotalArticulos, importeValor, factor }
 */
function calcularSubtotalYAjuste(items, total, condicionIva) {
  const facturaA = esFacturaA(condicionIva)

  // Calcular precios para Centum
  const precios = items.map(item => {
    const precioConIva = parseFloat(item.precio_unitario || item.precioUnitario || item.precioFinal || item.precio || 0)
    const ivaTasa = parseFloat(item.iva_tasa || item.iva || item.ivaTasa || 21)
    const cantidad = parseFloat(item.cantidad) || 1
    const precio = facturaA ? precioNeto(precioConIva, ivaTasa) : precioConIva
    return { precio, cantidad }
  })

  let subtotalArticulos = precios.reduce((sum, p) => sum + p.precio * p.cantidad, 0)
  subtotalArticulos = Math.round(subtotalArticulos * 100) / 100

  // Comparar con total (para Factura A convertir a neto)
  const totalComparable = facturaA ? Math.round(total / 1.21 * 100) / 100 : total
  let factor = 1
  if (totalComparable < subtotalArticulos && subtotalArticulos > 0) {
    factor = totalComparable / subtotalArticulos
    subtotalArticulos = Math.round(totalComparable * 100) / 100
  }

  // Importe: Factura A = total POS (con IVA), Factura B = subtotal artículos
  const importeValor = facturaA ? total : subtotalArticulos

  return { subtotalArticulos, importeValor, factor }
}

/**
 * Calcula importe de concepto para NC
 * Factura A: neto | Factura B: final
 */
function importeConceptoNC(total, condicionIva) {
  return esFacturaA(condicionIva) ? Math.round(total / 1.21 * 100) / 100 : total
}

/**
 * Calcula el saldo a favor en una devolución
 * proporción del total pagado (que ya tiene descuentos)
 */
function calcularDevolucion(itemsDevueltos, itemsVenta, subtotalVenta, totalVenta) {
  let subtotalDevuelto = 0
  const errores = []

  for (const dev of itemsDevueltos) {
    const itemOriginal = itemsVenta[dev.indice]
    if (!itemOriginal) continue
    const precioUnit = parseFloat(itemOriginal.precio_unitario || itemOriginal.precioUnitario || itemOriginal.precio || 0)
    subtotalDevuelto += precioUnit * dev.cantidad
  }

  if (subtotalVenta <= 0) {
    errores.push('Subtotal de venta inválido')
    return { subtotalDevuelto: 0, saldoAFavor: 0, factorDescuento: 1, errores }
  }

  const proporcion = subtotalDevuelto / subtotalVenta
  const saldoAFavor = Math.round(proporcion * totalVenta * 100) / 100
  const factorDescuento = totalVenta / subtotalVenta

  return { subtotalDevuelto, saldoAFavor, factorDescuento, proporcion, errores }
}

/**
 * Filtra artículos del ERP (quita deshabilitados, combos)
 */
function filtrarArticulosERP(items) {
  return items.filter(art => {
    if (art.Habilitado === false) return false
    if (art.EsCombo === true) return false
    const nombre = (art.NombreFantasia || art.Nombre || '').toUpperCase()
    if (nombre.startsWith('COMBO ') || nombre.startsWith('COMBO\t')) return false
    return true
  })
}

/**
 * Mapea artículos del ERP al schema local
 */
function mapearArticuloERP(art) {
  return {
    codigo: art.Codigo != null ? String(art.Codigo).trim() : '',
    nombre: art.NombreFantasia || art.Nombre || 'Sin nombre',
    rubro: art.Rubro?.Nombre || null,
    marca: art.MarcaArticulo?.Nombre || null,
    tipo: 'automatico',
    es_pesable: art.EsPesable === true,
    id_centum: art.IdArticulo || null,
    precio: art.Precio != null ? Math.round(art.Precio * 100) / 100 : null,
    subrubro: art.SubRubro?.Nombre || null,
    rubro_id_centum: art.Rubro?.IdRubro || null,
    subrubro_id_centum: art.SubRubro?.IdSubRubro || null,
    descuento1: art.PorcentajeDescuento1 || 0,
    descuento2: art.PorcentajeDescuento2 || 0,
    descuento3: art.PorcentajeDescuento3 || 0,
    iva_tasa: art.CategoriaImpuestoIVA?.Tasa != null ? art.CategoriaImpuestoIVA.Tasa : 21,
  }
}

/**
 * Detecta cambios entre artículo del ERP y artículo local
 * Retorna true si hay cambios
 */
function articuloCambio(artERP, artLocal) {
  const cambioPrecio = Math.abs((parseFloat(artLocal.precio) || 0) - (artERP.precio || 0)) > 0.001
  const cambioDesc1 = Math.abs((parseFloat(artLocal.descuento1) || 0) - (artERP.descuento1 || 0)) > 0.001
  const cambioDesc2 = Math.abs((parseFloat(artLocal.descuento2) || 0) - (artERP.descuento2 || 0)) > 0.001
  const cambioDesc3 = Math.abs((parseFloat(artLocal.descuento3) || 0) - (artERP.descuento3 || 0)) > 0.001
  const cambioIva = Math.abs((parseFloat(artLocal.iva_tasa) || 21) - (artERP.iva_tasa || 21)) > 0.001
  const cambioNombre = artLocal.nombre !== artERP.nombre
  return cambioPrecio || cambioDesc1 || cambioDesc2 || cambioDesc3 || cambioIva || cambioNombre
}

/**
 * Parsea JSON de forma segura, retorna fallback si falla
 */
function safeParseJSON(str, fallback = []) {
  if (!str || typeof str !== 'string') return str || fallback
  try { return JSON.parse(str) } catch { return fallback }
}

module.exports = {
  esFacturaA,
  clasificarDivision,
  clasificarVenta,
  precioNeto,
  precioParaCentum,
  calcularSubtotalYAjuste,
  importeConceptoNC,
  calcularDevolucion,
  filtrarArticulosERP,
  mapearArticuloERP,
  articuloCambio,
  safeParseJSON,
  TIPOS_EFECTIVO,
}
