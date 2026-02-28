// Servicio de IA para análisis de cierres de caja
const Anthropic = require('@anthropic-ai/sdk')
const supabase = require('../config/supabase')
const { registrarLlamada } = require('./apiLogger')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODELO = 'claude-haiku-4-5-20251001'

const SYSTEM_ANALISIS_BASE = `Sos un auditor experto de cajas para Padano SRL, una empresa de retail en Rosario, Argentina.
Analizá el cierre de caja que te pasan y devolvé SOLO un JSON válido (sin markdown, sin backticks) con esta estructura exacta:
{
  "puntaje": <número 0-100>,
  "nivel_riesgo": "<bajo|medio|alto|critico>",
  "resumen": "<2-3 oraciones resumiendo el cierre>",
  "alertas": [{"tipo": "<diferencia_efectivo|diferencia_medios|continuidad_cambio|retiros|erp>", "severidad": "<info|advertencia|critico>", "mensaje": "<descripción concisa>"}],
  "recomendaciones": ["<acción sugerida>"]
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
- Sé práctico y conciso. No recomiendes acciones obvias ni burocracia innecesaria.`

const SYSTEM_CHAT_BASE = `Sos un asistente de auditoría de cajas para Padano SRL, una empresa de retail en Rosario, Argentina.
Respondé en español, de forma concisa y profesional.
Tenés acceso a datos de cierres de caja que te pasan como contexto.
Si te preguntan sobre algo que no está en los datos, decilo claramente.
Los montos están en pesos argentinos (ARS). Diferencias menores a $2.000 son normales (vuelto/monedas).
PAYWAY y PAYWAY INTEGRADO son el mismo medio de pago.
No inventes datos. Si no tenés información suficiente, pedí más contexto.`

/**
 * Carga las reglas personalizadas de la tabla reglas_ia
 * @returns {string} Texto con reglas para inyectar en el system prompt
 */
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

/**
 * Analiza un cierre de caja usando IA
 * @param {object} auditoriaData - Datos del endpoint /auditoria
 * @returns {object} { puntaje, nivel_riesgo, resumen, alertas, recomendaciones }
 */
async function analizarCierre(auditoriaData) {
  const inicio = Date.now()
  try {
    const reglasExtra = await cargarReglas()
    const systemPrompt = SYSTEM_ANALISIS_BASE + reglasExtra

    const response = await client.messages.create({
      model: MODELO,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { role: 'user', content: JSON.stringify(auditoriaData) }
      ],
    })

    const texto = response.content[0].text
    // Intentar parsear el JSON (limpiar posibles backticks)
    const limpio = texto.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const resultado = JSON.parse(limpio)

    // Validar estructura mínima
    if (typeof resultado.puntaje !== 'number' || !resultado.nivel_riesgo || !resultado.resumen) {
      throw new Error('Respuesta de IA con estructura inválida')
    }

    registrarLlamada({
      servicio: 'claude_ia', endpoint: 'messages.create/analisis',
      metodo: 'POST', estado: 'ok', duracion_ms: Date.now() - inicio,
      items_procesados: response.usage?.output_tokens || null,
      origen: 'consulta',
    })

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

/**
 * Chat libre sobre cajas con contexto
 * @param {string} mensaje - Mensaje del usuario
 * @param {Array} historialChat - [{rol: 'user'|'assistant', contenido: string}]
 * @param {object|null} contextoAuditoria - Datos de auditoría para contexto
 * @returns {string} Respuesta en texto
 */
async function chatCajas(mensaje, historialChat = [], contextoAuditoria = null) {
  const inicio = Date.now()
  try {
    const reglasExtra = await cargarReglas()
    const systemPrompt = SYSTEM_CHAT_BASE + reglasExtra

    const messages = []

    // Agregar contexto como primer mensaje del usuario si existe
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

    // Agregar historial previo
    if (historialChat && historialChat.length > 0) {
      for (const msg of historialChat) {
        messages.push({
          role: msg.rol === 'user' ? 'user' : 'assistant',
          content: msg.contenido,
        })
      }
    }

    // Agregar mensaje actual
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

module.exports = { analizarCierre, chatCajas }
