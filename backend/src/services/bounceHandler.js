// Servicio para detectar emails rebotados (bounces) y limpiar emails inválidos de clientes
const { ImapFlow } = require('imapflow')
const { createClient } = require('@supabase/supabase-js')
const logger = require('../config/logger')
const { actualizarClienteEnCentum } = require('./centumClientes')

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

          // === Estrategia 1: buscar cliente con ese email en tabla clientes ===
          const { data: clientes } = await supabase
            .from('clientes')
            .select('id, razon_social, email, codigo, id_centum')
            .ilike('email', emailRebotado)

          if (clientes && clientes.length > 0) {
            for (const cli of clientes) {
              // Limpiar en Supabase
              const { error: updErr } = await supabase
                .from('clientes')
                .update({ email: null })
                .eq('id', cli.id)

              if (updErr) {
                logger.error(`[Bounces] Error limpiando email de cliente ${cli.codigo}: ${updErr.message}`)
                resultado.errores++
                continue
              }

              // Limpiar en Centum ERP (para que el sync no lo traiga de vuelta)
              if (cli.id_centum) {
                try {
                  await actualizarClienteEnCentum(cli.id_centum, { email: '' })
                  logger.info(`[Bounces] Email también limpiado en Centum para cliente ${cli.codigo} (id_centum: ${cli.id_centum})`)
                } catch (errCentum) {
                  logger.warn(`[Bounces] No se pudo limpiar email en Centum para ${cli.codigo}: ${errCentum.message}`)
                }
              }

              resultado.limpiados++
              resultado.detalles.push({
                email: emailRebotado,
                cliente: cli.razon_social,
                codigo: cli.codigo,
                via: 'clientes.email + centum',
              })
              logger.info(`[Bounces] Email ${emailRebotado} eliminado del cliente ${cli.codigo} (${cli.razon_social})`)
            }
          }

          // === Estrategia 2: buscar en ventas_pos.email_enviado_a (email manual del cajero) ===
          // Si el cajero ingresó un email incorrecto al enviar el comprobante,
          // ese email no está en la ficha del cliente sino en la venta
          const { data: ventas } = await supabase
            .from('ventas_pos')
            .select('id, numero_venta, id_cliente_centum, email_enviado_a')
            .ilike('email_enviado_a', emailRebotado)
            .limit(20)

          if (ventas && ventas.length > 0) {
            // Marcar esas ventas como email NO enviado para que no se reintenten con el email malo
            for (const v of ventas) {
              await supabase
                .from('ventas_pos')
                .update({ email_enviado: false, email_enviado_a: null })
                .eq('id', v.id)
            }

            // Limpiar email en Centum para los clientes asociados a esas ventas
            const idsCentumVentas = [...new Set(ventas.map(v => v.id_cliente_centum).filter(Boolean))]
            for (const idCentum of idsCentumVentas) {
              // Verificar si el cliente en Centum tiene este email (via BI local)
              const { data: cliVenta } = await supabase
                .from('clientes')
                .select('id, codigo, email')
                .eq('id_centum', idCentum)
                .single()

              if (cliVenta) {
                // Limpiar email local si coincide
                if (cliVenta.email && cliVenta.email.toLowerCase() === emailRebotado) {
                  await supabase.from('clientes').update({ email: null }).eq('id', cliVenta.id)
                }
                // Limpiar en Centum siempre (el email puede estar en Centum aunque no esté local)
                try {
                  await actualizarClienteEnCentum(idCentum, { email: '' })
                  logger.info(`[Bounces] Email limpiado en Centum para cliente id_centum=${idCentum}`)
                } catch (errCentum) {
                  logger.warn(`[Bounces] No se pudo limpiar email en Centum para id_centum=${idCentum}: ${errCentum.message}`)
                }
              }
            }

            logger.info(`[Bounces] ${ventas.length} ventas tenían email_enviado_a=${emailRebotado}, reseteadas`)
            resultado.detalles.push({
              email: emailRebotado,
              ventas_reseteadas: ventas.map(v => v.numero_venta),
              via: 'ventas_pos.email_enviado_a + centum',
            })
          }

          if ((!clientes || clientes.length === 0) && (!ventas || ventas.length === 0)) {
            logger.info(`[Bounces] Email rebotado ${emailRebotado} no corresponde a ningún cliente ni venta`)
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
