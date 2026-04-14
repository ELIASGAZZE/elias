// Servicio de detección de ventas potencialmente duplicadas
// Corre como cron diario y genera notificaciones in-app para admins
const supabase = require('../config/supabase')
const logger = require('../config/logger')

const VENTANA_MINUTOS = 5 // Ventas con mismo cliente+total en N minutos = sospechosas

async function detectarVentasDuplicadas() {
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  ayer.setHours(0, 0, 0, 0)

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const desde = ayer.toISOString()
  const hasta = hoy.toISOString()

  logger.info(`[DetectarDuplicados] Analizando ventas del ${desde.slice(0, 10)}...`)

  // 1. Buscar duplicados en ventas_pos (ventas regulares + empleados)
  // Excluir NC de gift card (se crean automáticamente al usar una GC como pago)
  const { data: ventas, error } = await supabase
    .from('ventas_pos')
    .select('id, numero_venta, nombre_cliente, total, created_at, cajero_id, caja_id, ticket_uid, tipo, clasificacion, nc_concepto_tipo')
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .is('nc_concepto_tipo', null)
    .order('created_at', { ascending: true })

  if (error) {
    logger.error('[DetectarDuplicados] Error consultando ventas:', error.message)
    return { sospechosas: 0 }
  }

  if (!ventas || ventas.length === 0) {
    logger.info('[DetectarDuplicados] No hay ventas para analizar')
    return { sospechosas: 0 }
  }

  // Agrupar por cliente+total y buscar las que están dentro de la ventana temporal
  const sospechosas = []
  const ventanaMs = VENTANA_MINUTOS * 60 * 1000

  for (let i = 0; i < ventas.length; i++) {
    for (let j = i + 1; j < ventas.length; j++) {
      const a = ventas[i]
      const b = ventas[j]

      // Mismo cliente y mismo total
      if (a.nombre_cliente !== b.nombre_cliente || a.total !== b.total) continue

      // No comparar ventas de gift card entre sí (es normal vender varias GC seguidas)
      if (a.clasificacion === 'GIFT_CARD' && b.clasificacion === 'GIFT_CARD') continue

      // No comparar NC contra ventas normales
      if (a.tipo === 'nota_credito' || b.tipo === 'nota_credito') continue

      // Dentro de la ventana temporal
      const diffMs = Math.abs(new Date(b.created_at) - new Date(a.created_at))
      if (diffMs > ventanaMs) continue

      // Si ambos tienen ticket_uid diferente, es intencional (dos tickets distintos)
      if (a.ticket_uid && b.ticket_uid && a.ticket_uid !== b.ticket_uid) continue

      sospechosas.push({ ventaA: a, ventaB: b, diffSegundos: Math.round(diffMs / 1000) })
    }
  }

  // 2. Buscar duplicados en ventas_empleados específicamente
  const { data: ventasEmp, error: empError } = await supabase
    .from('ventas_empleados')
    .select('id, empleado_id, total, created_at, cajero_id')
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: true })

  if (!empError && ventasEmp && ventasEmp.length > 0) {
    for (let i = 0; i < ventasEmp.length; i++) {
      for (let j = i + 1; j < ventasEmp.length; j++) {
        const a = ventasEmp[i]
        const b = ventasEmp[j]

        if (a.empleado_id !== b.empleado_id || a.total !== b.total) continue

        const diffMs = Math.abs(new Date(b.created_at) - new Date(a.created_at))
        if (diffMs > ventanaMs) continue

        // Verificar que no esté ya reportado desde ventas_pos
        const yaReportado = sospechosas.some(s =>
          s.ventaA.nombre_cliente?.includes('Empleado') &&
          Math.abs(s.ventaA.total - a.total) < 0.01
        )
        if (!yaReportado) {
          sospechosas.push({
            ventaA: { ...a, tipo: 'empleado' },
            ventaB: { ...b, tipo: 'empleado' },
            diffSegundos: Math.round(diffMs / 1000),
          })
        }
      }
    }
  }

  if (sospechosas.length === 0) {
    logger.info('[DetectarDuplicados] No se encontraron ventas sospechosas')
    return { sospechosas: 0 }
  }

  // 3. Crear notificaciones para cada grupo sospechoso
  const notificaciones = sospechosas.map(s => {
    const esEmpleado = s.ventaA.tipo === 'empleado' || s.ventaA.nombre_cliente?.startsWith('Empleado:')
    const cliente = esEmpleado
      ? s.ventaA.nombre_cliente || `Empleado ID ${s.ventaA.empleado_id}`
      : s.ventaA.nombre_cliente

    const fecha = new Date(s.ventaA.created_at)
    const fechaStr = fecha.toLocaleDateString('es-AR')
    const horaStr = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    const total = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(s.ventaA.total)

    return {
      perfil_id: null, // Visible para todos los admins
      tipo: 'alerta',
      titulo: `Posible venta duplicada: ${cliente}`,
      mensaje: `${total} x2 el ${fechaStr} a las ${horaStr} (${s.diffSegundos}s de diferencia). Ventas #${s.ventaA.numero_venta || s.ventaA.id} y #${s.ventaB.numero_venta || s.ventaB.id}`,
      metadata: {
        tipo_alerta: 'venta_duplicada',
        venta_a_id: s.ventaA.id,
        venta_b_id: s.ventaB.id,
        total: s.ventaA.total,
        diff_segundos: s.diffSegundos,
        es_empleado: esEmpleado,
      },
    }
  })

  // Evitar duplicar notificaciones ya creadas (por si el cron corre 2 veces)
  for (const notif of notificaciones) {
    const { data: existente } = await supabase
      .from('notificaciones_admin')
      .select('id')
      .eq('tipo', 'alerta')
      .contains('metadata', { venta_a_id: notif.metadata.venta_a_id, venta_b_id: notif.metadata.venta_b_id })
      .maybeSingle()

    if (!existente) {
      await supabase.from('notificaciones_admin').insert(notif)
      logger.warn(`[DetectarDuplicados] Notificación creada: ${notif.titulo} — ${notif.mensaje}`)
    }
  }

  logger.info(`[DetectarDuplicados] ${sospechosas.length} ventas sospechosas detectadas, notificaciones creadas`)
  return { sospechosas: sospechosas.length }
}

module.exports = { detectarVentasDuplicadas }
