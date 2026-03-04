// Servicio de integración con Mercado Pago
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago')

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })

async function crearPreferenciaPago({ idPedido, titulo, monto, notificationUrl }) {
  const frontendUrl = 'https://zaatar.com.ar'
  const preference = new Preference(client)
  const result = await preference.create({
    body: {
      items: [{
        title: titulo,
        quantity: 1,
        unit_price: monto,
        currency_id: 'ARS',
      }],
      external_reference: String(idPedido),
      notification_url: notificationUrl,
      back_urls: {
        success: `${frontendUrl}/delivery/${idPedido}`,
        failure: `${frontendUrl}/delivery/${idPedido}`,
        pending: `${frontendUrl}/delivery/${idPedido}`,
      },
    }
  })
  return { id: result.id, init_point: result.init_point }
}

async function obtenerPago(paymentId) {
  const payment = new Payment(client)
  const result = await payment.get({ id: paymentId })
  return { status: result.status, external_reference: result.external_reference }
}

module.exports = { crearPreferenciaPago, obtenerPago }
