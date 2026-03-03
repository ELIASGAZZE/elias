// Servicio de IA para análisis de cierres de caja
// Fase 1: análisis simple / Fase 2: con contexto histórico / Fase 3: agente con tool use
const Anthropic = require('@anthropic-ai/sdk')
const supabase = require('../config/supabase')
const { registrarLlamada } = require('./apiLogger')
const { getEstadisticasCajero, getResolucionesSimilares, getResolucionesCierre } = require('./historialCajero')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODELO = 'claude-haiku-4-5-20251001'
const UMBRAL_AGENTE = 2000 // Solo usar agente si diferencia > $2.000

const SYSTEM_ANALISIS_BASE = `Sos un auditor experto de cajas para Padano SRL, una empresa de retail en Rosario, Argentina.
Analizá el cierre de caja que te pasan y devolvé SOLO un JSON válido (sin markdown, sin backticks) con esta estructura exacta:
{
  "puntaje": <número 0-100>,
  "nivel_riesgo": "<bajo|medio|alto|critico>",
  "resumen": "<2-3 oraciones resumiendo el cierre>",
  "alertas": [{"tipo": "<diferencia_efectivo|diferencia_medios|continuidad_cambio|retiros|erp>", "severidad": "<info|advertencia|critico>", "mensaje": "<descripción concisa>"}],
  "recomendaciones": ["<acción sugerida>"],
  "posibles_causas": [{"tipo": "<efectivo|payway|transferencia|mercadopago|qr|otro_medio>", "causa": "<factura_duplicada|venta_sin_confirmar|error_conteo|redondeo|faltante_caja|sobrante_caja|nota_credito|error_sistema|otro>", "confianza": <0.0-1.0>, "label": "<descripción corta>", "descripcion": "<explicación>"}]
}

Criterios de evaluación:
- Puntaje 90-100: sin diferencias significativas, todo cuadra
- Puntaje 70-89: diferencias menores, nada preocupante
- Puntaje 50-69: diferencias moderadas que merecen revisión
- Puntaje 30-49: diferencias significativas
- Puntaje 0-29: diferencias graves o múltiples alertas críticas

REGLAS DE NEGOCIO IMPORTANTES:
- Los montos están en pesos argentinos (ARS). En Argentina, diferencias menores a $2.000 son insignificantes (equivale a monedas/vuelto). No las marques como críticas ni sospechosas.
- Diferencias de centavos (ej: $0.05, $0.10) entre sistemas son redondeos normales, ignoralas.
- PAYWAY, PAYWAY INTEGRADO y variantes son el MISMO medio de pago (la tarjeta). El ERP a veces usa nombres distintos. No marques como "duplicación" ni "sin correspondencia" si los montos coinciden.
- El "efectivo neto" del cajero ya tiene descontado fondo fijo y cambio. Compará ese valor con el ERP, no el bruto.
- Continuidad de cambio: el cambio dejado en un cierre debe coincidir con el fondo fijo de la apertura siguiente. Si coincide, es correcto.
- Ventas sin confirmar pueden explicar diferencias — mencionalo como posible causa.
- Sé práctico y conciso. No recomiendes acciones obvias ni burocracia innecesaria.

En "posibles_causas", sugerí la causa más probable para cada diferencia encontrada (con confianza 0-1). Esto ayuda al auditor a resolver las diferencias más rápido. Si no hay diferencias, devolvé un array vacío.`

const SYSTEM_CHAT_BASE = `Sos un asistente de auditoría de cajas para Padano SRL, una empresa de retail en Rosario, Argentina.
Respondé en español, de forma concisa y profesional.
Tenés acceso a datos de cierres de caja que te pasan como contexto.
Si te preguntan sobre algo que no está en los datos, decilo claramente.
Los montos están en pesos argentinos (ARS). Diferencias menores a $2.000 son normales (vuelto/monedas).
PAYWAY y PAYWAY INTEGRADO son el mismo medio de pago.
No inventes datos. Si no tenés información suficiente, pedí más contexto.`

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function cargarReglas() {
  try {
    const { data, error } = await supabase
      .from('reglas_ia')
      .select('regla')
      .eq('activa', true)
      .order('created_at', { ascending: true })

    if (error || !data || data.length === 0) return ''

    const reglas = data.map((r, i) => `${i + 1}. ${r.regla}`).join('\n')
    return `\n\nREGLAS APRENDIDAS DEL USUARIO (respetá siempre estas reglas):\n${reglas}`
  } catch (err) {
    console.error('Error cargando reglas IA:', err.message)
    return ''
  }
}

function limpiarJSON(texto) {
  return texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
}

function validarAnalisis(resultado) {
  if (typeof resultado.puntaje !== 'number' || !resultado.nivel_riesgo || !resultado.resumen) {
    throw new Error('Respuesta de IA con estructura inválida')
  }
  if (!resultado.posibles_causas) resultado.posibles_causas = []
  if (!resultado.alertas) resultado.alertas = []
  if (!resultado.recomendaciones) resultado.recomendaciones = []
  return resultado
}

/**
 * Construye sección de historial para inyectar en el system prompt (Fase 2)
 */
function construirContextoHistorial(estadisticasCajero, resolucionesPrevias, resolucionesActuales) {
  const secciones = []

  if (estadisticasCajero && estadisticasCajero.total_cierres > 0) {
    secciones.push(`HISTORIAL DEL CAJERO (últimos ${estadisticasCajero.total_cierres} cierres):
- Cierres verificados: ${estadisticasCajero.cierres_verificados}
- Promedio diferencia efectivo: $${estadisticasCajero.promedio_diferencia_efectivo}
- Promedio diferencia total: $${estadisticasCajero.promedio_diferencia_total}${
  estadisticasCajero.patrones.length > 0
    ? '\n- Patrones: ' + estadisticasCajero.patrones.map(p =>
        `${p.medio}: ${p.veces_con_diferencia} veces con dif, promedio $${p.promedio_diferencia}`
      ).join('; ')
    : ''
}`)
  }

  if (resolucionesPrevias && resolucionesPrevias.length > 0) {
    secciones.push(`RESOLUCIONES PREVIAS SIMILARES (últimas ${resolucionesPrevias.length}):
${resolucionesPrevias.map(r =>
  `- Planilla ${r.planilla_id || '?'}: ${r.tipo_diferencia} $${r.monto_diferencia} → ${r.causa}${r.descripcion ? ' (' + r.descripcion + ')' : ''}`
).join('\n')}`)
  }

  if (resolucionesActuales && resolucionesActuales.length > 0) {
    secciones.push(`DIFERENCIAS YA RESUELTAS EN ESTE CIERRE:
${resolucionesActuales.map(r =>
  `- ${r.tipo_diferencia} $${r.monto_diferencia} → ${r.causa}${r.descripcion ? ' (' + r.descripcion + ')' : ''}`
).join('\n')}
Nota: las diferencias ya resueltas pueden subir el puntaje y reducir el nivel de riesgo.`)
  }

  return secciones.length > 0 ? '\n\n' + secciones.join('\n\n') : ''
}

/**
 * Guarda resultado de análisis en cache (tabla analisis_ia)
 */
async function cachearAnalisis(cierreId, resultado, modelo, tokensUsados) {
  try {
    // Borrar cache anterior si existe
    await supabase.from('analisis_ia').delete().eq('cierre_id', cierreId)

    await supabase.from('analisis_ia').insert({
      cierre_id: cierreId,
      puntaje: resultado.puntaje,
      nivel_riesgo: resultado.nivel_riesgo,
      resumen: resultado.resumen,
      alertas: resultado.alertas || [],
      recomendaciones: resultado.recomendaciones || [],
      posibles_causas: resultado.posibles_causas || [],
      investigacion: resultado.investigacion || null,
      modelo,
      tokens_usados: tokensUsados || 0,
    })
  } catch (err) {
    console.error('Error cacheando análisis IA:', err.message)
  }
}

/**
 * Busca análisis cacheado para un cierre
 */
async function buscarCache(cierreId) {
  try {
    const { data } = await supabase
      .from('analisis_ia')
      .select('*')
      .eq('cierre_id', cierreId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return data || null
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// FASE 2: Análisis con contexto histórico
// ═══════════════════════════════════════════════════════════════

/**
 * Analiza un cierre de caja usando IA con contexto histórico
 * @param {object} auditoriaData - Datos del endpoint /auditoria
 * @param {object} options - { useCache: true, forceRefresh: false }
 * @returns {object} { puntaje, nivel_riesgo, resumen, alertas, recomendaciones, posibles_causas }
 */
async function analizarCierre(auditoriaData, options = {}) {
  const { useCache = true, forceRefresh = false } = options
  const cierreId = auditoriaData.cierre_id
  const inicio = Date.now()

  // Buscar cache si no se pide forzar
  if (useCache && !forceRefresh && cierreId) {
    const cached = await buscarCache(cierreId)
    if (cached) {
      return {
        puntaje: cached.puntaje,
        nivel_riesgo: cached.nivel_riesgo,
        resumen: cached.resumen,
        alertas: cached.alertas || [],
        recomendaciones: cached.recomendaciones || [],
        posibles_causas: cached.posibles_causas || [],
        investigacion: cached.investigacion || null,
        _cached: true,
      }
    }
  }

  try {
    // Obtener contexto histórico en paralelo (Fase 2)
    const cajeroPerfilId = auditoriaData.contexto?.cajero_perfil?.id
    const empleadoId = auditoriaData.contexto?.empleado_id // may not exist, need to check
    const sucursalId = auditoriaData.contexto?.sucursal?.id

    // Detectar la mayor diferencia para buscar similares
    const diffs = auditoriaData.diferencias || {}
    const mayorDif = Math.max(
      Math.abs(diffs.cajero_vs_erp?.efectivo || 0),
      Math.abs(diffs.gestor_vs_erp?.efectivo || 0),
      Math.abs(diffs.cajero_vs_erp?.total_general || 0),
      Math.abs(diffs.gestor_vs_erp?.total_general || 0),
    )
    const tipoDifPrincipal = Math.abs(diffs.gestor_vs_erp?.efectivo || diffs.cajero_vs_erp?.efectivo || 0) > 0 ? 'efectivo' : null

    const [estadisticasCajero, resolucionesPrevias, resolucionesActuales, reglasExtra] = await Promise.all([
      cajeroPerfilId ? getEstadisticasCajero(cajeroPerfilId).catch(() => null) : null,
      getResolucionesSimilares({
        cajero_id: cajeroPerfilId,
        sucursal_id: sucursalId,
        tipo_diferencia: tipoDifPrincipal,
        monto: mayorDif,
      }).catch(() => []),
      cierreId ? getResolucionesCierre(cierreId).catch(() => []) : [],
      cargarReglas(),
    ])

    const historialCtx = construirContextoHistorial(estadisticasCajero, resolucionesPrevias, resolucionesActuales)
    const systemPrompt = SYSTEM_ANALISIS_BASE + historialCtx + reglasExtra

    const response = await client.messages.create({
      model: MODELO,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        { role: 'user', content: JSON.stringify(auditoriaData) }
      ],
    })

    const texto = response.content[0].text
    const limpio = limpiarJSON(texto)
    const resultado = validarAnalisis(JSON.parse(limpio))

    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'messages.create/analisis',
      metodo: 'POST', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: response.usage?.output_tokens || null,
      origen: 'consulta',
    })

    // Cachear resultado
    if (cierreId) {
      cachearAnalisis(cierreId, resultado, MODELO, response.usage?.output_tokens || 0)
    }

    return resultado
  } catch (err) {
    console.error('Error en analizarCierre:', err.message)
    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'messages.create/analisis',
      metodo: 'POST', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    if (err.status === 400 && err.message?.includes('credit balance')) {
      throw new Error('Sin créditos en la API de Anthropic. Recargá el saldo.')
    }
    throw new Error('No se pudo generar el análisis de IA')
  }
}

// ═══════════════════════════════════════════════════════════════
// FASE 3: Agente investigador con tool use
// ═══════════════════════════════════════════════════════════════

const TOOLS_AGENTE = [
  {
    name: 'consultar_transacciones_detalle',
    description: 'Lista todas las transacciones de la planilla con timestamps, montos y comprobantes. Útil para detectar duplicados o transacciones sospechosas.',
    input_schema: {
      type: 'object',
      properties: {
        planilla_id: { type: 'integer', description: 'ID de la planilla de caja en Centum' },
      },
      required: ['planilla_id'],
    },
  },
  {
    name: 'buscar_comprobantes_por_monto',
    description: 'Busca comprobantes/facturas que coincidan con un monto específico (con tolerancia). Útil para encontrar la factura que causa una diferencia.',
    input_schema: {
      type: 'object',
      properties: {
        planilla_id: { type: 'integer', description: 'ID de la planilla de caja' },
        monto: { type: 'number', description: 'Monto a buscar (en pesos argentinos)' },
        tolerancia: { type: 'number', description: 'Tolerancia en pesos (+/-). Default: 100' },
      },
      required: ['planilla_id', 'monto'],
    },
  },
  {
    name: 'consultar_historial_cajero',
    description: 'Obtiene estadísticas históricas del cajero: promedios, tendencias, patrones de diferencias.',
    input_schema: {
      type: 'object',
      properties: {
        cajero_id: { type: 'string', description: 'UUID del perfil del cajero' },
      },
      required: ['cajero_id'],
    },
  },
  {
    name: 'consultar_resoluciones_previas',
    description: 'Busca resoluciones de diferencias similares por tipo, cajero o monto. Útil para encontrar patrones.',
    input_schema: {
      type: 'object',
      properties: {
        tipo_diferencia: { type: 'string', description: 'Tipo: efectivo, payway, transferencia, etc.' },
        cajero_id: { type: 'string', description: 'UUID del cajero (opcional)' },
        monto: { type: 'number', description: 'Monto de la diferencia (opcional)' },
      },
      required: ['tipo_diferencia'],
    },
  },
]

const SYSTEM_AGENTE = `Sos un agente auditor inteligente de cajas para Padano SRL, una empresa de retail en Rosario, Argentina.

Tu trabajo es INVESTIGAR las causas de diferencias en un cierre de caja. Tenés herramientas para consultar datos del ERP.

PROCESO:
1. Analizá los datos del cierre que te pasan
2. Si hay diferencias significativas (> $2.000), usá las herramientas para investigar la causa
3. Buscá patrones: comprobantes duplicados, transacciones con timestamps muy cercanos, montos que coinciden con la diferencia
4. Consultá el historial del cajero para ver si es un patrón recurrente
5. Devolvé tu análisis final en JSON

REGLAS DE NEGOCIO:
- Montos en pesos argentinos (ARS). Diferencias < $2.000 son insignificantes.
- PAYWAY, PAYWAY INTEGRADO = mismo medio de pago.
- "Efectivo neto" ya tiene descontado fondo fijo y cambio.
- Ventas sin confirmar pueden explicar diferencias.

Cuando termines de investigar, devolvé SOLO un JSON con esta estructura:
{
  "puntaje": <0-100>,
  "nivel_riesgo": "<bajo|medio|alto|critico>",
  "resumen": "<2-3 oraciones>",
  "alertas": [{"tipo": "...", "severidad": "...", "mensaje": "..."}],
  "recomendaciones": ["..."],
  "posibles_causas": [{"tipo": "...", "causa": "...", "confianza": <0-1>, "label": "...", "descripcion": "..."}],
  "investigacion": {
    "herramientas_usadas": [{"nombre": "...", "resultado_resumen": "..."}],
    "hallazgos": ["<hallazgo clave 1>", "..."],
    "conclusion": "<conclusión de la investigación>"
  }
}`

/**
 * Ejecuta una herramienta del agente
 */
async function ejecutarHerramienta(nombre, input) {
  // Lazy import to avoid circular dependencies
  const { getTransaccionesDetalle, buscarComprobantesPorMonto } = require('../config/centum')

  switch (nombre) {
    case 'consultar_transacciones_detalle':
      return await getTransaccionesDetalle(input.planilla_id)

    case 'buscar_comprobantes_por_monto':
      return await buscarComprobantesPorMonto(input.planilla_id, input.monto, input.tolerancia || 100)

    case 'consultar_historial_cajero':
      return await getEstadisticasCajero(input.cajero_id)

    case 'consultar_resoluciones_previas':
      return await getResolucionesSimilares({
        tipo_diferencia: input.tipo_diferencia,
        cajero_id: input.cajero_id || null,
        monto: input.monto || null,
      })

    default:
      return { error: `Herramienta no reconocida: ${nombre}` }
  }
}

/**
 * Analiza un cierre usando el agente con tool use (Fase 3)
 * Solo se usa cuando hay diferencias significativas
 * @param {object} auditoriaData - Datos de auditoría
 * @param {object} options - { maxIteraciones: 3 }
 * @returns {object} Análisis con investigación
 */
async function analizarCierreAgente(auditoriaData, options = {}) {
  const { maxIteraciones = 3 } = options
  const cierreId = auditoriaData.cierre_id
  const inicio = Date.now()

  try {
    const reglasExtra = await cargarReglas()
    const systemPrompt = SYSTEM_AGENTE + reglasExtra

    let messages = [
      { role: 'user', content: `Analizá este cierre de caja e investigá las diferencias:\n${JSON.stringify(auditoriaData)}` }
    ]

    let iteraciones = 0
    let tokensTotal = 0
    const herramientasUsadas = []

    while (iteraciones < maxIteraciones) {
      const response = await client.messages.create({
        model: MODELO,
        max_tokens: 2000,
        system: systemPrompt,
        messages,
        tools: TOOLS_AGENTE,
      })

      tokensTotal += response.usage?.output_tokens || 0

      // Si la respuesta es solo texto (end_turn), parsear resultado final
      if (response.stop_reason === 'end_turn') {
        const textoFinal = response.content.find(c => c.type === 'text')?.text || ''
        const limpio = limpiarJSON(textoFinal)

        try {
          const resultado = validarAnalisis(JSON.parse(limpio))
          resultado.investigacion = resultado.investigacion || {
            herramientas_usadas: herramientasUsadas,
            hallazgos: [],
            conclusion: resultado.resumen,
          }

          registrarLlamada({
            servicio: 'claude_ia', endpoint: 'messages.create/agente',
            metodo: 'POST', estado: 'ok', duracion_ms: Date.now() - inicio,
            items_procesados: tokensTotal, origen: 'consulta',
          })

          if (cierreId) cachearAnalisis(cierreId, resultado, MODELO, tokensTotal)
          return resultado
        } catch {
          // Si no es JSON válido, devolver como texto
          break
        }
      }

      // Si hay tool_use, ejecutar herramientas
      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content })

        const toolResults = []
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            try {
              const result = await ejecutarHerramienta(block.name, block.input)
              herramientasUsadas.push({
                nombre: block.name,
                input: block.input,
                resultado_resumen: Array.isArray(result) ? `${result.length} resultados` : 'OK',
              })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result).slice(0, 10000), // Limitar tamaño
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
        iteraciones++
      } else {
        break
      }
    }

    // Fallback si no se pudo parsear resultado del agente
    throw new Error('El agente no devolvió un resultado válido')
  } catch (err) {
    console.error('Error en analizarCierreAgente:', err.message)
    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'messages.create/agente',
      metodo: 'POST', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    // Fallback a análisis simple
    return analizarCierre(auditoriaData, { useCache: false })
  }
}

/**
 * Decide si usar agente o análisis simple según la magnitud de las diferencias
 */
async function analizarCierreIA(auditoriaData, options = {}) {
  const diffs = auditoriaData.diferencias || {}
  const mayorDif = Math.max(
    Math.abs(diffs.cajero_vs_erp?.efectivo || 0),
    Math.abs(diffs.gestor_vs_erp?.efectivo || 0),
    Math.abs(diffs.cajero_vs_erp?.total_general || 0),
    Math.abs(diffs.gestor_vs_erp?.total_general || 0),
  )

  // Usar agente solo para diferencias significativas (ahorra costos)
  if (mayorDif > UMBRAL_AGENTE && auditoriaData.planilla_id) {
    return analizarCierreAgente(auditoriaData, options)
  }

  return analizarCierre(auditoriaData, options)
}

// ═══════════════════════════════════════════════════════════════
// Chat (sin cambios significativos)
// ═══════════════════════════════════════════════════════════════

async function chatCajas(mensaje, historialChat = [], contextoAuditoria = null) {
  const inicio = Date.now()
  try {
    const reglasExtra = await cargarReglas()
    const systemPrompt = SYSTEM_CHAT_BASE + reglasExtra

    const messages = []

    if (contextoAuditoria) {
      messages.push({
        role: 'user',
        content: `Contexto de datos de cierres de caja (usalo para responder preguntas):\n${JSON.stringify(contextoAuditoria)}`
      })
      messages.push({
        role: 'assistant',
        content: 'Entendido, tengo los datos de los cierres de caja. Haceme tu consulta.'
      })
    }

    if (historialChat && historialChat.length > 0) {
      for (const msg of historialChat) {
        messages.push({
          role: msg.rol === 'user' ? 'user' : 'assistant',
          content: msg.contenido,
        })
      }
    }

    messages.push({ role: 'user', content: mensaje })

    const response = await client.messages.create({
      model: MODELO,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })

    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'messages.create/chat',
      metodo: 'POST', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: response.usage?.output_tokens || null,
      origen: 'consulta',
    })

    return response.content[0].text
  } catch (err) {
    console.error('Error en chatCajas:', err.message)
    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'messages.create/chat',
      metodo: 'POST', estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'consulta',
    })
    if (err.status === 400 && err.message?.includes('credit balance')) {
      throw new Error('Sin créditos en la API de Anthropic. Recargá el saldo.')
    }
    throw new Error('No se pudo obtener respuesta de IA')
  }
}

module.exports = { analizarCierre, analizarCierreIA, analizarCierreAgente, chatCajas }
