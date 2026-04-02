// Test: simular insert de ventas_pos como lo hace giftcards.js activar
require('dotenv').config()
const supabase = require('./src/config/supabase')

async function test() {
  const codigo = 'TEST_GC_' + Date.now()
  const monto = 1000

  const ventaInsert = {
    cajero_id: '75201893-4950-4364-b277-2917bd879385', // mismo cajero que activó la GC problemática
    id_cliente_centum: 0,
    sucursal_id: null, // SIMULAR el caso problemático
    caja_id: null,
    nombre_cliente: 'test',
    subtotal: monto,
    descuento_total: 0,
    total: monto,
    monto_pagado: monto,
    vuelto: 0,
    items: JSON.stringify([{ nombre: `Gift Card ${codigo}`, cantidad: 1, precio_unitario: monto, precio_final: monto, es_gift_card: true }]),
    pagos: [{ tipo: 'QR MP', monto: monto }],
    gift_cards_vendidas: [{ codigo, monto_nominal: monto, comprador: 'test' }],
    centum_sync: true,
  }

  console.log('Insertando con sucursal_id=null, caja_id=null...')
  const { data, error } = await supabase
    .from('ventas_pos')
    .insert(ventaInsert)
    .select('id, numero_venta')
    .single()

  if (error) {
    console.error('ERROR:', error.message)
    console.error('Details:', error.details)
    console.error('Hint:', error.hint)
    console.error('Code:', error.code)
  } else {
    console.log('OK! Venta creada:', data)
    // Limpiar
    await supabase.from('ventas_pos').delete().eq('id', data.id)
    console.log('Test venta eliminada')
  }
}

test().catch(e => console.error(e))
