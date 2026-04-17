// Servicio para detectar emails rebotados (bounces) y limpiar emails inválidos de clientes
const { ImapFlow } = require('imapflow')
const { createClient } = require('@supabase/supabase-js')
const logger = require('../config/logger')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Configuración IMAP (misma cuenta SMTP que envía comprobantes)
function getImapConfig() {
  return {
    host: process.env.IMAP_HOST || process.env.SMTP_HOST || 'mail.padano.com.ar',
    port: parseInt(process.env.IMAP_PORT) || 993,
    secure: true,
    auth: {
      user: process.env.SMTP_USER || 'comprobantes@padano.com.ar',
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
    logger: false,
  }
}

/**
 * Extrae el email del destinatario que rebotó desde el cuerpo del bounce.
 * Busca patrones comunes de mensajes de error SMTP (550, 553, etc.)
 */
function extraerEmailRebotado(texto) {
  if (!texto) return null

  // Patrón 1: "Final-Recipient: rfc822; email@domain.com"
  const finalRecipient = texto.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i)
  if (finalRecipient) return normalizar(finalRecipient[1])

  // Patrón 2: "Original-Recipient: rfc822;email@domain.com"
  const origRecipient = texto.match(/Original-Recipient:\s*rfc822;?\s*([^\s\r\n]+)/i)
  if (origRecipient) return normalizar(origRecipient[1])

  // Patrón 3: "<email@domain.com>: host ... said: 550 ..."
  const angleError = texto.match(/<([^>]+@[^>]+)>:\s*host\b.*?\bsaid:\s*5[0-9]{2}/i)
  if (angleError) return normalizar(angleError[1])

  // Patrón 4: "Delivery to the following recipient failed permanently: email@domain.com"
  const googleBounce = texto.match(/failed permanently[:\s]*\n?\s*([^\s\r\n]+@[^\s\r\n]+)/i)
  if (googleBounce) return normalizar(googleBounce[1])

  return null
}

function normalizar(email) {
  return email ? email.trim().toLowerCase().replace(/[<>]/g, '') : null
}

/**
 * Verifica si un mensaje es un bounce legítimo (error permanente 5.x.x)
 */
function esBounce(texto) {
  if (!texto) return false
  // Status 5.x.x = error permanente (no transitorio como 4.x.x)
  return /Status:\s*5\.\d+\.\d+/i.test(texto) ||
         /\b550[\s-]/i.test(texto) ||
         /\b553[\s-]/i.test(texto) ||
         /\b551[\s-]/i.test(texto) ||
         /does not exist/i.test(texto) ||
         /user unknown/i.test(texto) ||
         /no such user/i.test(texto) ||
         /mailbox not found/i.test(texto) ||
         /recipient rejected/i.test(texto) ||
         /account.*disabled/i.test(texto)
}

/**
 * Procesa bounces: lee inbox IMAP, detecta rebotes, limpia emails de clientes.
 * Diseñado para correr como cron job periódico.
 */
async function procesarBounces() {
  if (!process.env.SMTP_PASS) {
    logger.info('[Bounces] SMTP_PASS no configurada, saltando')
    return { procesados: 0, limpiados: 0, errores: 0 }
  }

  const client = new ImapFlow(getImapConfig())
  const resultado = { procesados: 0, limpiados: 0, errores: 0, detalles: [] }

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      // Buscar emails de MAILER-DAEMON o con subject de bounce (últimos 7 días)
      const desde = new Date()
      desde.setDate(desde.getDate() - 7)
      const desdeStr = desde.toISOString().split('T')[0]

      const messages = client.fetch(
        {
          or: [
            { from: 'MAILER-DAEMON' },
            { from: 'postmaster' },
            { subject: 'Undelivered' },
            { subject: 'Delivery Status' },
            { subject: 'Mail delivery failed' },
            { subject: 'Returned mail' },
            { subject: 'failure notice' },
          ],
          since: desdeStr,
        },
        { source: true, envelope: true, uid: true },
      )

      const uidsToDelete = []

      for await (const msg of messages) {
        resultado.procesados++
        try {
          const source = msg.source?.toString('utf-8') || ''

          if (!esBounce(source)) continue

          const emailRebotado = extraerEmailRebotado(source)
          if (!emailRebotado) {
            logger.info(`[Bounces] Bounce detectado pero no se pudo extraer email destinatario (UID ${msg.uid})`)
            continue
          }

          // Buscar cliente con ese email en Supabase
          const { data: clientes } = await supabase
            .from('clientes')
            .select('id, razon_social, email, codigo')
            .ilike('email', emailRebotado)

          if (!clientes || clientes.length === 0) {
            logger.info(`[Bounces] Email rebotado ${emailRebotado} no corresponde a ningún cliente`)
            uidsToDelete.push(msg.uid)
            continue
          }

          // Limpiar email de los clientes que lo tengan
          for (const cli of clientes) {
            const { error: updErr } = await supabase
              .from('clientes')
              .update({ email: null })
              .eq('id', cli.id)

            if (updErr) {
              logger.error(`[Bounces] Error limpiando email de cliente ${cli.codigo}: ${updErr.message}`)
              resultado.errores++
            } else {
              resultado.limpiados++
              resultado.detalles.push({
                email: emailRebotado,
                cliente: cli.razon_social,
                codigo: cli.codigo,
              })
              logger.info(`[Bounces] Email ${emailRebotado} eliminado del cliente ${cli.codigo} (${cli.razon_social})`)
            }
          }

          // Marcar para borrar después de procesado
          uidsToDelete.push(msg.uid)
        } catch (err) {
          logger.error(`[Bounces] Error procesando mensaje UID ${msg.uid}: ${err.message}`)
          resultado.errores++
        }
      }

      // Eliminar bounces procesados para no reprocesarlos
      if (uidsToDelete.length > 0) {
        await client.messageDelete(uidsToDelete, { uid: true })
        logger.info(`[Bounces] ${uidsToDelete.length} mensajes de bounce eliminados de la casilla`)
      }
    } finally {
      lock.release()
    }

    await client.logout()
  } catch (err) {
    logger.error(`[Bounces] Error conectando a IMAP: ${err.message}`)
    resultado.errores++
  }

  if (resultado.limpiados > 0) {
    logger.info(`[Bounces] Resumen: ${resultado.procesados} bounces revisados, ${resultado.limpiados} emails limpiados, ${resultado.errores} errores`)
  }

  return resultado
}

module.exports = { procesarBounces }
