// Mapa de formas de cobro con IDs fijos de la tabla formas_cobro en Supabase.
// Permite resolver forma_cobro_id sin hacer queries al DB.
// Si se agrega una nueva forma de cobro a la tabla, agregar acá también.

const FORMAS_COBRO = {
  EFECTIVO:          { id: '2b3a4947-4299-4f29-99b7-d1dcf9c3d1d1', nombre: 'Efectivo' },
  TRANSFERENCIA:     { id: 'f3fbc96d-835b-4b9f-a4d4-c344672cc0c1', nombre: 'Transferencia' },
  POSNET_MP:         { id: '666f620f-dab7-4737-9ca5-d01c7ff8a4ab', nombre: 'Posnet MP' },
  QR_MP:             { id: '9f5efb0c-86a2-4668-aa89-390614523226', nombre: 'QR MP' },
  PAYWAY:            { id: '2073b4ec-b15a-45f1-be0c-2a3e24918a0d', nombre: 'Payway' },
  RAPPI_PEDIDO_YA:   { id: 'e3e35892-b4e8-4179-a031-4445b050ada1', nombre: 'RAPPI / PEDIDO YA' },
  CUENTA_CORRIENTE:  { id: 'd4de1915-6687-49d5-bc9c-288b57f9fa34', nombre: 'Cuenta Corriente' },
  TALO_PAY:          { id: 'a6eba9d9-7d0f-46bf-a70d-3a357c21dac6', nombre: 'Talo Pay' },
  PAGO_ANTICIPADO:   { id: '92216d1d-4b75-4060-8935-c7431cb02df4', nombre: 'Pago Anticipado' },
  SALDO:             { id: 'f5fdda59-0587-46e0-8dde-b67d9ba3eb97', nombre: 'Saldo' },
}

// Mapa inverso: tipo string (case-insensitive) → forma de cobro
const TIPO_TO_FORMA = {}
Object.values(FORMAS_COBRO).forEach(fc => {
  TIPO_TO_FORMA[fc.nombre.toLowerCase()] = fc
})
// Aliases para variantes comunes
TIPO_TO_FORMA['efectivo'] = FORMAS_COBRO.EFECTIVO
TIPO_TO_FORMA['cuenta_corriente'] = FORMAS_COBRO.CUENTA_CORRIENTE
TIPO_TO_FORMA['talo pay'] = FORMAS_COBRO.TALO_PAY
TIPO_TO_FORMA['pago anticipado'] = FORMAS_COBRO.PAGO_ANTICIPADO
TIPO_TO_FORMA['rappi / pedido ya'] = FORMAS_COBRO.RAPPI_PEDIDO_YA
TIPO_TO_FORMA['posnet mp'] = FORMAS_COBRO.POSNET_MP
TIPO_TO_FORMA['qr mp'] = FORMAS_COBRO.QR_MP
TIPO_TO_FORMA['payway'] = FORMAS_COBRO.PAYWAY
TIPO_TO_FORMA['transferencia'] = FORMAS_COBRO.TRANSFERENCIA
TIPO_TO_FORMA['saldo'] = FORMAS_COBRO.SALDO

// Mapa inverso: forma_cobro_id → forma de cobro
const ID_TO_FORMA = {}
Object.values(FORMAS_COBRO).forEach(fc => {
  ID_TO_FORMA[fc.id] = fc
})

/**
 * Resolver forma_cobro_id a partir de un pago.
 * Busca primero en forma_cobro_id explícito, luego en detalle.forma_cobro_id,
 * y finalmente por el tipo string.
 * @param {object} pago - { tipo, monto, forma_cobro_id?, detalle? }
 * @returns {string|null} UUID de la forma de cobro
 */
function resolverFormaCobro(pago) {
  // 1. forma_cobro_id explícito en el pago
  if (pago.forma_cobro_id && ID_TO_FORMA[pago.forma_cobro_id]) return pago.forma_cobro_id
  // 2. forma_cobro_id dentro de detalle (formato legacy)
  if (pago.detalle?.forma_cobro_id && ID_TO_FORMA[pago.detalle.forma_cobro_id]) return pago.detalle.forma_cobro_id
  // 3. Resolver por tipo string
  const fc = TIPO_TO_FORMA[(pago.tipo || '').toLowerCase()]
  return fc ? fc.id : null
}

/**
 * Normalizar un pago: agrega forma_cobro_id y nombre canónico.
 * No modifica el pago original, devuelve uno nuevo.
 * @param {object} pago - { tipo, monto, detalle? }
 * @returns {object} pago con forma_cobro_id y tipo normalizado
 */
function normalizarPago(pago) {
  const fcId = resolverFormaCobro(pago)
  const fc = fcId ? ID_TO_FORMA[fcId] : null
  return {
    ...pago,
    forma_cobro_id: fcId,
    tipo: fc ? fc.nombre : (pago.tipo || 'Efectivo'),
  }
}

module.exports = { FORMAS_COBRO, TIPO_TO_FORMA, ID_TO_FORMA, resolverFormaCobro, normalizarPago }
