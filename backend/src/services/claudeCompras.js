// Servicio de IA para compras inteligentes
// Patrón idéntico a claude.js: system prompt + reglas inyectadas + tool use + caché
const Anthropic = require('@anthropic-ai/sdk')
const supabase = require('../config/supabase')
const { registrarLlamada } = require('./apiLogger')
const { calcularDemanda } = require('./demandaCompras')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODELO = 'claude-haiku-4-5-20251001'

const SYSTEM_COMPRAS = `Sos un analista de compras experto para Padano SRL, una fiambrería gourmet en Rosario, Argentina.

CONTEXTO DEL NEGOCIO:
- Productos perecederos (fiambres, quesos, lácteos, embutidos)
- +200 proveedores, múltiples sucursales
- Consumo interno para producción de picadas y preparaciones
- Estacionalidad fuerte: verano (picadas, cerveza), invierno (fondues, guisos)
- Montos en pesos argentinos (ARS)

TU ROL:
- Analizar datos de demanda y sugerir cantidades óptimas de compra
- Detectar anomalías (picos/caídas inusuales de ventas)
- Considerar promos de proveedores para optimizar costos
- Aprender de ajustes previos del usuario
- Ser práctico y conciso — el usuario es experto en su negocio

REGLAS:
- Siempre explicá el razonamiento detrás de tus sugerencias
- Si un artículo tiene tendencia decreciente, mencionalo
- Si hay promo del proveedor, calculá si conviene comprar más
- Considerá consumo interno y pedidos extraordinarios
- No sugierás comprar artículos sin ventas a menos que haya pedidos especiales
- Respondé siempre en español`

// ═══════════════════════════════════════════════════════════════
// Herramientas del agente
// ═══════════════════════════════════════════════════════════════

const TOOLS_COMPRAS = [
  {
    name: 'consultar_ventas_articulo',
    description: 'Ventas diarias de un artículo en los últimos N días. Devuelve array de { fecha, cantidad }.',
    input_schema: {
      type: 'object',
      properties: {
        articulo_id: { type: 'string', description: 'ID del artículo' },
        dias: { type: 'integer', description: 'Últimos N días (default 30)' },
      },
      required: ['articulo_id'],
    },
  },
  {
    name: 'consultar_stock_actual',
    description: 'Stock actual de un artículo en depósito.',
    input_schema: {
      type: 'object',
      properties: {
        articulo_id: { type: 'string', description: 'ID del artículo' },
      },
      required: ['articulo_id'],
    },
  },
  {
    name: 'consultar_historial_compras',
    description: 'Últimas órdenes de compra a un proveedor.',
    input_schema: {
      type: 'object',
      properties: {
        proveedor_id: { type: 'string', description: 'UUID del proveedor' },
        limite: { type: 'integer', description: 'Cantidad de órdenes (default 5)' },
      },
      required: ['proveedor_id'],
    },
  },
  {
    name: 'consultar_ajustes_previos',
    description: 'Ajustes que el usuario hizo a sugerencias anteriores de IA para un artículo. Útil para aprender preferencias.',
    input_schema: {
      type: 'object',
      properties: {
        articulo_id: { type: 'string', description: 'ID del artículo' },
      },
      required: ['articulo_id'],
    },
  },
  {
    name: 'consultar_consumo_interno',
    description: 'Registros de consumo interno (producción, merma, degustación) de un artículo.',
    input_schema: {
      type: 'object',
      properties: {
        articulo_id: { type: 'string', description: 'ID del artículo' },
        dias: { type: 'integer', description: 'Últimos N días (default 30)' },
      },
      required: ['articulo_id'],
    },
  },
  {
    name: 'consultar_pedidos_extraordinarios',
    description: 'Pedidos especiales pendientes (eventos, clientes mayoristas).',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'consultar_promos_proveedor',
    description: 'Promociones activas de un proveedor (bonificaciones, descuentos).',
    input_schema: {
      type: 'object',
      properties: {
        proveedor_id: { type: 'string', description: 'UUID del proveedor' },
      },
      required: ['proveedor_id'],
    },
  },
  {
    name: 'calcular_demanda',
    description: 'Ejecuta el motor matemático completo de demanda para un proveedor. Devuelve artículos con velocidad, stock, sugerencia, riesgo.',
    input_schema: {
      type: 'object',
      properties: {
        proveedor_id: { type: 'string', description: 'UUID del proveedor' },
        dias: { type: 'integer', description: 'Días de historial (default 30)' },
      },
      required: ['proveedor_id'],
    },
  },
]

// ═══════════════════════════════════════════════════════════════
// Ejecución de herramientas
// ═══════════════════════════════════════════════════════════════

async function ejecutarHerramienta(nombre, input) {
  switch (nombre) {
    case 'consultar_ventas_articulo': {
      const dias = input.dias || 30
      const desde = new Date()
      desde.setDate(desde.getDate() - dias)
      const { data: ventas } = await supabase
        .from('ventas_pos')
        .select('items, created_at')
        .gte('created_at', desde.toISOString().split('T')[0])

      const porDia = {}
      for (const v of (ventas || [])) {
        const fecha = v.created_at?.split('T')[0]
        let items = v.items
        if (typeof items === 'string') try { items = JSON.parse(items) } catch { continue }
        if (!Array.isArray(items)) continue
        for (const item of items) {
          const aid = String(item.id || item.articulo_id || item.id_centum || '')
          if (aid === input.articulo_id) {
            porDia[fecha] = (porDia[fecha] || 0) + (item.cantidad || 1)
          }
        }
      }
      return Object.entries(porDia).map(([fecha, cantidad]) => ({ fecha, cantidad })).sort((a, b) => a.fecha.localeCompare(b.fecha))
    }

    case 'consultar_stock_actual': {
      const { data } = await supabase
        .from('articulos')
        .select('id, nombre, stock_actual, stock_minimo')
        .eq('id', input.articulo_id)
        .single()
      return data || { error: 'Artículo no encontrado' }
    }

    case 'consultar_historial_compras': {
      const { data } = await supabase
        .from('ordenes_compra')
        .select('id, numero, estado, items, total, created_at')
        .eq('proveedor_id', input.proveedor_id)
        .order('created_at', { ascending: false })
        .limit(input.limite || 5)
      return data || []
    }

    case 'consultar_ajustes_previos': {
      const { data } = await supabase
        .from('compras_ajustes')
        .select('*')
        .eq('articulo_id', input.articulo_id)
        .order('created_at', { ascending: false })
        .limit(10)
      return data || []
    }

    case 'consultar_consumo_interno': {
      const dias = input.dias || 30
      const desde = new Date()
      desde.setDate(desde.getDate() - dias)
      const { data } = await supabase
        .from('consumo_interno')
        .select('*')
        .eq('articulo_id', input.articulo_id)
        .gte('fecha', desde.toISOString().split('T')[0])
        .order('fecha', { ascending: false })
      return data || []
    }

    case 'consultar_pedidos_extraordinarios': {
      const { data } = await supabase
        .from('pedidos_extraordinarios')
        .select('*')
        .eq('estado', 'pendiente')
        .order('fecha_necesaria', { ascending: true })
      return data || []
    }

    case 'consultar_promos_proveedor': {
      const hoy = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('proveedor_promociones')
        .select('*')
        .eq('proveedor_id', input.proveedor_id)
        .eq('activa', true)
        .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
      return data || []
    }

    case 'calcular_demanda': {
      return await calcularDemanda(input.proveedor_id, { dias: input.dias || 30 })
    }

    default:
      return { error: `Herramienta no reconocida: ${nombre}` }
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function cargarReglasCompras(proveedorId) {
  try {
    let query = supabase
      .from('compras_reglas_ia')
      .select('regla, categoria')
      .eq('activa', true)
      .order('created_at', { ascending: true })

    const { data } = await query
    if (!data || data.length === 0) return ''

    // Filtrar reglas relevantes
    const relevantes = data.filter(r =>
      r.categoria === 'general' ||
      (r.categoria === 'proveedor' && r.proveedor_id === proveedorId)
    )
    if (relevantes.length === 0) return ''

    const reglas = relevantes.map((r, i) => `${i + 1}. ${r.regla}`).join('\n')
    return `\n\nREGLAS APRENDIDAS (respetá siempre):\n${reglas}`
  } catch {
    return ''
  }
}

async function cargarAjustesPrevios(proveedorId) {
  try {
    const { data } = await supabase
      .from('compras_ajustes')
      .select('articulo_id, cantidad_sugerida, cantidad_final, motivo, nota')
      .eq('orden_compra_id', proveedorId) // buscar por proveedor via ordenes
      .order('created_at', { ascending: false })
      .limit(20)

    if (!data || data.length === 0) return ''

    const ajustes = data.map(a =>
      `- Art ${a.articulo_id}: IA sugirió ${a.cantidad_sugerida}, usuario puso ${a.cantidad_final} (${a.motivo}${a.nota ? ': ' + a.nota : ''})`
    ).join('\n')
    return `\n\nAJUSTES PREVIOS DEL USUARIO:\n${ajustes}`
  } catch {
    return ''
  }
}

// ═══════════════════════════════════════════════════════════════
// Funciones principales
// ═══════════════════════════════════════════════════════════════

/**
 * Analiza demanda de un proveedor: motor matemático + resumen IA
 */
async function analizarDemandaProveedor(proveedorId) {
  const inicio = Date.now()

  try {
    // Verificar cache (4 horas)
    const { data: cache } = await supabase
      .from('compras_analisis_ia')
      .select('*')
      .eq('proveedor_id', proveedorId)
      .eq('tipo', 'demanda')
      .order('created_at', { ascending: false })
      .limit(1)

    if (cache && cache.length > 0) {
      const cacheAge = Date.now() - new Date(cache[0].created_at).getTime()
      if (cacheAge < 4 * 60 * 60 * 1000) {
        return cache[0].resultado
      }
    }

    // Motor matemático
    const demanda = await calcularDemanda(proveedorId)

    // Si no hay artículos, no llamar a IA
    if (!demanda || demanda.length === 0) {
      return { demanda: [], resumen_ia: null }
    }

    // IA: resumen y análisis
    const reglas = await cargarReglasCompras(proveedorId)
    const systemPrompt = SYSTEM_COMPRAS + reglas + `

Analiza estos datos de demanda y devolvé un resumen conciso:
1. Artículos que necesitan reposición urgente
2. Tendencias importantes
3. Oportunidades (promos que conviene aprovechar)
4. Alertas o anomalías

Respondé en texto plano, máximo 200 palabras. No uses JSON.`

    const response = await client.messages.create({
      model: MODELO,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Datos de demanda del proveedor:\n${JSON.stringify(demanda.slice(0, 30))}`,
      }],
    })

    const resumenIA = response.content[0]?.text || ''

    const resultado = { demanda, resumen_ia: resumenIA }

    // Cachear
    await supabase.from('compras_analisis_ia').insert({
      tipo: 'demanda',
      proveedor_id: proveedorId,
      resultado,
      modelo: MODELO,
      tokens_usados: response.usage?.output_tokens || 0,
      parametros: { dias: 30 },
    })

    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'compras/demanda',
      metodo: 'POST', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: response.usage?.output_tokens || 0,
      origen: 'consulta',
    })

    return resultado
  } catch (err) {
    console.error('Error en analizarDemandaProveedor:', err.message)
    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'compras/demanda',
      metodo: 'POST', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    // Fallback: solo motor matemático
    const demanda = await calcularDemanda(proveedorId)
    return { demanda, resumen_ia: null }
  }
}

/**
 * Genera una orden de compra sugerida con IA
 */
async function generarOrdenSugerida(proveedorId) {
  const inicio = Date.now()

  try {
    const demanda = await calcularDemanda(proveedorId)
    if (!demanda || demanda.length === 0) {
      return { items: [], total: 0, justificacion: 'No hay artículos vinculados a este proveedor.' }
    }

    // Proveedor info
    const { data: proveedor } = await supabase
      .from('proveedores')
      .select('*')
      .eq('id', proveedorId)
      .single()

    const reglas = await cargarReglasCompras(proveedorId)
    const systemPrompt = SYSTEM_COMPRAS + reglas + `

Generá una orden de compra optimizada. Para cada artículo decidí la cantidad final considerando:
- La sugerencia del motor matemático
- Promos activas del proveedor
- Monto mínimo del proveedor: $${proveedor?.monto_minimo || 0}
- Factor de conversión (redondear a cajas/packs)

Devolvé SOLO un JSON válido (sin backticks) con esta estructura:
{
  "items": [{"articulo_id": "...", "cantidad_final": N, "motivo": "texto breve"}],
  "total_estimado": N,
  "justificacion": "texto resumen de la orden",
  "alertas": ["..."]
}`

    const response = await client.messages.create({
      model: MODELO,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Proveedor: ${proveedor?.nombre || 'N/A'} (mínimo: $${proveedor?.monto_minimo || 0})\nDemanda calculada:\n${JSON.stringify(demanda)}`,
      }],
    })

    let texto = response.content[0]?.text || '{}'
    // Limpiar
    texto = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    if (!texto.startsWith('{')) {
      const idx = texto.indexOf('{')
      if (idx >= 0) texto = texto.slice(idx)
    }

    let resultado
    try {
      resultado = JSON.parse(texto)
    } catch {
      resultado = { items: [], total_estimado: 0, justificacion: 'Error parseando respuesta IA', alertas: [] }
    }

    // Enriquecer items con datos del motor
    const itemsEnriquecidos = (resultado.items || []).map(item => {
      const demandaItem = demanda.find(d => d.articulo_id === item.articulo_id)
      return {
        ...item,
        codigo: demandaItem?.codigo,
        nombre: demandaItem?.nombre,
        cantidad_sugerida_ia: demandaItem?.cantidad_sugerida || 0,
        cantidad_final: item.cantidad_final || demandaItem?.cantidad_sugerida || 0,
        unidad_compra: demandaItem?.unidad_compra || 'unidad',
        factor_conversion: demandaItem?.factor_conversion || 1,
        precio_unitario: demandaItem?.precio_compra || 0,
        subtotal: (item.cantidad_final || demandaItem?.cantidad_sugerida || 0) * (demandaItem?.precio_compra || 0),
        stock_actual: demandaItem?.stock_actual,
        velocidad_diaria: demandaItem?.velocidad_diaria,
        riesgo: demandaItem?.riesgo,
      }
    })

    // Si la IA no devolvió items, usar demanda con cantidad > 0
    if (itemsEnriquecidos.length === 0) {
      for (const d of demanda) {
        if (d.cantidad_sugerida > 0) {
          itemsEnriquecidos.push({
            articulo_id: d.articulo_id,
            codigo: d.codigo,
            nombre: d.nombre,
            cantidad_sugerida_ia: d.cantidad_sugerida,
            cantidad_final: d.cantidad_sugerida,
            unidad_compra: d.unidad_compra,
            factor_conversion: d.factor_conversion,
            precio_unitario: d.precio_compra || 0,
            subtotal: d.subtotal,
            stock_actual: d.stock_actual,
            velocidad_diaria: d.velocidad_diaria,
            riesgo: d.riesgo,
            motivo: 'Sugerencia automática del motor de demanda',
          })
        }
      }
    }

    const total = itemsEnriquecidos.reduce((s, i) => s + (i.subtotal || 0), 0)

    // Cachear
    await supabase.from('compras_analisis_ia').insert({
      tipo: 'orden_sugerida',
      proveedor_id: proveedorId,
      resultado: { items: itemsEnriquecidos, total, justificacion: resultado.justificacion },
      modelo: MODELO,
      tokens_usados: response.usage?.output_tokens || 0,
    })

    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'compras/orden-sugerida',
      metodo: 'POST', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: response.usage?.output_tokens || 0,
      origen: 'consulta',
    })

    return {
      items: itemsEnriquecidos,
      total,
      justificacion: resultado.justificacion || '',
      alertas: resultado.alertas || [],
    }
  } catch (err) {
    console.error('Error en generarOrdenSugerida:', err.message)
    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'compras/orden-sugerida',
      metodo: 'POST', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    // Fallback sin IA
    const demanda = await calcularDemanda(proveedorId)
    const items = demanda.filter(d => d.cantidad_sugerida > 0).map(d => ({
      articulo_id: d.articulo_id,
      codigo: d.codigo,
      nombre: d.nombre,
      cantidad_sugerida_ia: d.cantidad_sugerida,
      cantidad_final: d.cantidad_sugerida,
      unidad_compra: d.unidad_compra,
      factor_conversion: d.factor_conversion,
      precio_unitario: d.precio_compra || 0,
      subtotal: d.subtotal,
      stock_actual: d.stock_actual,
      velocidad_diaria: d.velocidad_diaria,
      riesgo: d.riesgo,
    }))
    return {
      items,
      total: items.reduce((s, i) => s + (i.subtotal || 0), 0),
      justificacion: 'Generado automáticamente sin IA (error en servicio)',
      alertas: ['IA no disponible, cantidades basadas solo en motor matemático'],
    }
  }
}

/**
 * Chat libre de compras con tool use
 */
async function chatCompras(mensaje, historial = []) {
  const inicio = Date.now()

  try {
    const reglas = await cargarReglasCompras()
    const systemPrompt = SYSTEM_COMPRAS + reglas

    const messages = []
    for (const msg of historial) {
      messages.push({
        role: msg.rol === 'user' ? 'user' : 'assistant',
        content: msg.contenido,
      })
    }
    messages.push({ role: 'user', content: mensaje })

    let response = await client.messages.create({
      model: MODELO,
      max_tokens: 1500,
      system: systemPrompt,
      messages,
      tools: TOOLS_COMPRAS,
    })

    // Loop de tool use (máx 3 iteraciones)
    let iteraciones = 0
    while (response.stop_reason === 'tool_use' && iteraciones < 3) {
      messages.push({ role: 'assistant', content: response.content })

      const toolResults = []
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          try {
            const result = await ejecutarHerramienta(block.name, block.input)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result).slice(0, 15000),
            })
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: err.message }),
              is_error: true,
            })
          }
        }
      }

      messages.push({ role: 'user', content: toolResults })
      response = await client.messages.create({
        model: MODELO,
        max_tokens: 1500,
        system: systemPrompt,
        messages,
        tools: TOOLS_COMPRAS,
      })
      iteraciones++
    }

    const textoFinal = response.content.find(c => c.type === 'text')?.text || ''

    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'compras/chat',
      metodo: 'POST', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: response.usage?.output_tokens || 0,
      origen: 'consulta',
    })

    return textoFinal
  } catch (err) {
    console.error('Error en chatCompras:', err.message)
    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'compras/chat',
      metodo: 'POST', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    if (err.status === 400 && err.message?.includes('credit balance')) {
      throw new Error('Sin créditos en la API de Anthropic. Recargá el saldo.')
    }
    throw new Error('No se pudo obtener respuesta de IA')
  }
}

module.exports = { analizarDemandaProveedor, generarOrdenSugerida, chatCompras }
