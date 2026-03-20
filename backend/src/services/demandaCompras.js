// Motor de cálculo de demanda — matemática pura, sin IA
const supabase = require('../config/supabase')

/**
 * Calcula la demanda de artículos para un proveedor
 * @param {string} proveedorId - UUID del proveedor
 * @param {object} opts - { dias: 30 }
 * @returns {Array} artículos con demanda calculada, ordenados por urgencia
 */
async function calcularDemanda(proveedorId, { dias = 30 } = {}) {
  // 1. Obtener artículos del proveedor
  const { data: provArticulos, error: paErr } = await supabase
    .from('proveedor_articulos')
    .select('*, proveedores!inner(lead_time_dias, lead_time_variabilidad_dias)')
    .eq('proveedor_id', proveedorId)

  if (paErr) throw new Error(`Error cargando artículos proveedor: ${paErr.message}`)
  if (!provArticulos || provArticulos.length === 0) return []

  const articuloIds = provArticulos.map(pa => pa.articulo_id)
  const leadTime = provArticulos[0]?.proveedores?.lead_time_dias || 1
  const leadTimeVar = provArticulos[0]?.proveedores?.lead_time_variabilidad_dias || 0

  // 2. Obtener artículos locales (nombre, stock, id_centum)
  const { data: articulos } = await supabase
    .from('articulos')
    .select('id, nombre, codigo, id_centum, stock_actual, stock_minimo, precio_venta')
    .in('id', articuloIds)

  const articulosMap = {}
  for (const a of (articulos || [])) {
    articulosMap[a.id] = a
  }

  // 3. Query ventas últimos N días
  const desde = new Date()
  desde.setDate(desde.getDate() - dias)
  const desdeStr = desde.toISOString().split('T')[0]

  const { data: ventas } = await supabase
    .from('ventas_pos')
    .select('items, created_at')
    .gte('created_at', desdeStr)
    .order('created_at', { ascending: true })

  // Acumular ventas por artículo por día
  const ventasPorArticuloDia = {} // { articuloId: { '2026-03-15': cantidad, ... } }
  for (const venta of (ventas || [])) {
    const fecha = venta.created_at?.split('T')[0]
    if (!fecha) continue
    let items = venta.items
    if (typeof items === 'string') {
      try { items = JSON.parse(items) } catch { continue }
    }
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const aid = item.id || item.articulo_id || item.id_centum
      if (!aid || !articuloIds.includes(String(aid))) continue
      const key = String(aid)
      if (!ventasPorArticuloDia[key]) ventasPorArticuloDia[key] = {}
      ventasPorArticuloDia[key][fecha] = (ventasPorArticuloDia[key][fecha] || 0) + (item.cantidad || 1)
    }
  }

  // 4. Consumo interno últimos N días
  const { data: consumos } = await supabase
    .from('consumo_interno')
    .select('articulo_id, cantidad')
    .in('articulo_id', articuloIds)
    .gte('fecha', desdeStr)

  const consumoPorArticulo = {}
  for (const c of (consumos || [])) {
    consumoPorArticulo[c.articulo_id] = (consumoPorArticulo[c.articulo_id] || 0) + Number(c.cantidad)
  }

  // 5. Pedidos extraordinarios pendientes
  const { data: pedidosExtra } = await supabase
    .from('pedidos_extraordinarios')
    .select('articulo_id, cantidad')
    .in('articulo_id', articuloIds)
    .eq('estado', 'pendiente')

  const extraPorArticulo = {}
  for (const p of (pedidosExtra || [])) {
    if (p.articulo_id) {
      extraPorArticulo[p.articulo_id] = (extraPorArticulo[p.articulo_id] || 0) + Number(p.cantidad)
    }
  }

  // 6. Promos activas del proveedor
  const hoy = new Date().toISOString().split('T')[0]
  const { data: promos } = await supabase
    .from('proveedor_promociones')
    .select('*')
    .eq('proveedor_id', proveedorId)
    .eq('activa', true)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)

  const promosPorArticulo = {}
  for (const p of (promos || [])) {
    if (p.articulo_id) {
      promosPorArticulo[p.articulo_id] = p
    }
  }

  // 7. Calcular demanda por artículo
  const resultado = []
  const hoyDate = new Date()

  for (const pa of provArticulos) {
    const art = articulosMap[pa.articulo_id] || {}
    const ventasDia = ventasPorArticuloDia[pa.articulo_id] || {}

    // Generar array de ventas diarias (últimos N días)
    const ventasDiarias = []
    for (let i = 0; i < dias; i++) {
      const d = new Date(hoyDate)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      ventasDiarias.push(ventasDia[key] || 0)
    }

    // WMA: 7d peso 3, 8-14d peso 2, 15-30d peso 1
    let sumaPonderada = 0
    let sumaPesos = 0
    for (let i = 0; i < ventasDiarias.length; i++) {
      const peso = i < 7 ? 3 : i < 14 ? 2 : 1
      sumaPonderada += ventasDiarias[i] * peso
      sumaPesos += peso
    }
    const velocidad = sumaPesos > 0 ? sumaPonderada / sumaPesos : 0

    // Tendencia: regresión lineal simple
    const n = ventasDiarias.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    for (let i = 0; i < n; i++) {
      const x = n - 1 - i // día más viejo = 0, más nuevo = n-1
      const y = ventasDiarias[i]
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x
    }
    const pendiente = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0
    const tendencia = pendiente > 0.05 ? 'creciente' : pendiente < -0.05 ? 'decreciente' : 'estable'

    // Desviación estándar de demanda
    const media = sumY / n
    let sumDesv = 0
    for (const v of ventasDiarias) {
      sumDesv += (v - media) ** 2
    }
    const sigma = Math.sqrt(sumDesv / n)

    // Safety stock: z * σ * √(lead_time)
    const z = 1.65 // 95% service level
    const safetyStock = z * sigma * Math.sqrt(leadTime)

    // Punto de reorden
    const puntoReorden = (velocidad * leadTime) + safetyStock

    // Stock actual
    const stockActual = Number(art.stock_actual || 0)

    // Cantidad sugerida base
    let cantidadSugerida = Math.max(puntoReorden - stockActual, 0)

    // Ajustes
    // +consumo interno promedio diario
    const consumoTotal = consumoPorArticulo[pa.articulo_id] || 0
    const consumoDiario = consumoTotal / dias
    cantidadSugerida += consumoDiario * leadTime

    // +pedidos extraordinarios
    cantidadSugerida += extraPorArticulo[pa.articulo_id] || 0

    // Redondear a múltiplo de factor_conversion
    const factor = pa.factor_conversion || 1
    if (factor > 1) {
      cantidadSugerida = Math.ceil(cantidadSugerida / factor) * factor
    } else {
      cantidadSugerida = Math.ceil(cantidadSugerida)
    }

    // Si hay promo bonificación, redondear al múltiplo que la activa
    const promo = promosPorArticulo[pa.articulo_id]
    if (promo && promo.tipo === 'bonificacion' && promo.cantidad_minima && cantidadSugerida > 0) {
      const minPromo = promo.cantidad_minima
      if (cantidadSugerida < minPromo && cantidadSugerida > minPromo * 0.7) {
        cantidadSugerida = minPromo // subir al mínimo de promo si está cerca
      } else if (cantidadSugerida >= minPromo) {
        cantidadSugerida = Math.ceil(cantidadSugerida / minPromo) * minPromo
      }
    }

    // Clasificación riesgo
    const diasStock = velocidad > 0 ? stockActual / velocidad : (stockActual > 0 ? 999 : 0)
    let riesgo = 'verde'
    if (velocidad === 0 && stockActual === 0) riesgo = 'gris'
    else if (velocidad === 0) riesgo = 'gris'
    else if (diasStock < 3) riesgo = 'rojo'
    else if (diasStock < 7) riesgo = 'amarillo'

    resultado.push({
      articulo_id: pa.articulo_id,
      codigo: art.codigo || art.id_centum || pa.articulo_id,
      nombre: art.nombre || 'Sin nombre',
      stock_actual: stockActual,
      velocidad_diaria: Math.round(velocidad * 100) / 100,
      tendencia,
      dias_stock: Math.round(diasStock * 10) / 10,
      riesgo,
      safety_stock: Math.round(safetyStock * 10) / 10,
      punto_reorden: Math.round(puntoReorden * 10) / 10,
      cantidad_sugerida: cantidadSugerida,
      unidad_compra: pa.unidad_compra || 'unidad',
      factor_conversion: pa.factor_conversion || 1,
      precio_compra: pa.precio_compra,
      subtotal: cantidadSugerida * (pa.precio_compra || 0),
      consumo_interno_diario: Math.round(consumoDiario * 100) / 100,
      pedidos_extra: extraPorArticulo[pa.articulo_id] || 0,
      promo_activa: promo ? {
        tipo: promo.tipo,
        descripcion: promo.descripcion,
        cantidad_minima: promo.cantidad_minima,
        cantidad_bonus: promo.cantidad_bonus,
      } : null,
      precio_venta: art.precio_venta,
    })
  }

  // Ordenar por urgencia (días stock ASC)
  resultado.sort((a, b) => {
    if (a.riesgo === 'gris' && b.riesgo !== 'gris') return 1
    if (a.riesgo !== 'gris' && b.riesgo === 'gris') return -1
    return a.dias_stock - b.dias_stock
  })

  return resultado
}

/**
 * Dashboard global: artículos críticos cross-proveedor
 */
async function dashboardCompras() {
  // Proveedores activos
  const { data: proveedores } = await supabase
    .from('proveedores')
    .select('id, nombre')
    .eq('activo', true)

  // Órdenes pendientes
  const { data: ordenesPendientes } = await supabase
    .from('ordenes_compra')
    .select('id, numero, proveedor_id, estado, total, created_at')
    .in('estado', ['borrador', 'enviada'])
    .order('created_at', { ascending: false })
    .limit(20)

  // Artículos críticos (stock < stock_minimo)
  const { data: criticos } = await supabase
    .from('articulos')
    .select('id, nombre, codigo, stock_actual, stock_minimo')
    .not('stock_minimo', 'is', null)
    .order('stock_actual', { ascending: true })
    .limit(50)

  const articulosCriticos = (criticos || []).filter(a =>
    a.stock_minimo && Number(a.stock_actual || 0) < Number(a.stock_minimo)
  )

  // Gasto del mes
  const inicioMes = new Date()
  inicioMes.setDate(1)
  const { data: ordenesDelMes } = await supabase
    .from('ordenes_compra')
    .select('total')
    .in('estado', ['enviada', 'recibida_parcial', 'recibida'])
    .gte('created_at', inicioMes.toISOString())

  const gastoMes = (ordenesDelMes || []).reduce((sum, o) => sum + Number(o.total || 0), 0)

  return {
    total_proveedores: (proveedores || []).length,
    ordenes_pendientes: (ordenesPendientes || []).length,
    ordenes_recientes: ordenesPendientes || [],
    articulos_criticos: articulosCriticos.slice(0, 10),
    total_criticos: articulosCriticos.length,
    gasto_mes: gastoMes,
  }
}

module.exports = { calcularDemanda, dashboardCompras }
