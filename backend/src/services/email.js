// Servicio de envío de emails via SMTP (cPanel)
const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.padano.com.ar',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true, // SSL/TLS puerto 465
  auth: {
    user: process.env.SMTP_USER || 'comprobantes@padano.com.ar',
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
})

/**
 * Envía un email con PDF adjunto
 * @param {Object} opts
 * @param {string} opts.to - Email destinatario
 * @param {string} opts.subject - Asunto
 * @param {string} opts.html - Cuerpo HTML del email
 * @param {Buffer} opts.pdfBuffer - Buffer del PDF
 * @param {string} opts.pdfFilename - Nombre del archivo adjunto
 */
async function enviarEmail({ to, subject, html, pdfBuffer, pdfFilename }) {
  if (!process.env.SMTP_PASS) {
    throw new Error('SMTP_PASS no configurada')
  }

  const info = await transporter.sendMail({
    from: `"Factura de venta Almacen Zaatar" <${process.env.SMTP_USER || 'comprobantes@padano.com.ar'}>`,
    to,
    subject,
    html,
    attachments: pdfBuffer ? [{
      filename: pdfFilename || 'comprobante.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    }] : [],
  })

  return info
}

module.exports = { enviarEmail }
