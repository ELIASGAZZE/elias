// Test flujo completo: simula venta POS → sync Centum → verificar resultado
require('dotenv').config()
const supabase = require('./src/config/supabase')
const { registrarVentaPOSEnCentum } = require('./src/services/centumVentasPOS')

async function main() {
  const cajaId = '76d3cc0b-07d5-40e2-9b87-c0e25f68ae8d' // Caja 1 Fisherton, PV 2

  // 1. Obtener perfil admin
  const { data: perfil } = await supabase.from('perfiles')
    .select('id, nombre, rol, sucursal_id')
    .eq('rol', 'admin')
    .limit(1).single()
  console.log('1. Perfil cajero:', perfil.nombre)

  // 2. Insertar venta en ventas_pos (como haría POST /api/pos/ventas)
  const insertData = {
    cajero_id: perfil.id,
    sucursal_id: 'c254cac8-4c6e-4098-9119-485d7172f281', // Fisherton
    id_cliente_centum: 2,
    nombre_cliente: 'TEST FLUJO COMPLETO',
    subtotal: 19939.14,
    descuento_total: 0,
    total: 19939.14,
    monto_pagado: 20000,
    vuelto: 60.86,
    items: JSON.stringify([{
      id_articulo: 4408,
      codigo: '04340',
      nombre: 'SALENTEIN RESERVE MALBEC *1500ML',
      precio_unitario: 19939.14,
      cantidad: 1,
      iva_tasa: 21,
    }]),
    pagos: [{ tipo: 'efectivo', monto: 20000, detalle: null }],
  }

  const { data: venta, error } = await supabase
    .from('ventas_pos')
    .insert(insertData)
    .select()
    .single()

  if (error) {
    console.log('ERROR al insertar venta:', error.message)
    return
  }
  console.log('2. Venta local creada: id=' + venta.id)

  // 3. Obtener config de caja y sucursal (como hace pos.js)
  const { data: cajaData } = await supabase
    .from('cajas')
    .select('punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id)')
    .eq('id', cajaId)
    .single()

  const puntoVenta = cajaData.punto_venta_centum
  const sucursalFisicaId = cajaData.sucursales.centum_sucursal_id
  console.log('3. Config caja: PV=' + puntoVenta + ', Sucursal Centum=' + sucursalFisicaId)

  // 4. Registrar en Centum
  console.log('4. Enviando a Centum...')
  const resultado = await registrarVentaPOSEnCentum(venta, {
    sucursalFisicaId,
    puntoVenta,
  })

  if (!resultado) {
    console.log('ERROR: Centum no devolvió resultado')
    return
  }

  console.log('5. Centum respondió: IdVenta=' + resultado.IdVenta)

  // 5. Guardar referencia (como hace pos.js)
  const numDoc = resultado.NumeroDocumento
  const comprobante = numDoc
    ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
    : null

  await supabase.from('ventas_pos')
    .update({
      id_venta_centum: resultado.IdVenta || null,
      centum_comprobante: comprobante,
      centum_sync: true,
    })
    .eq('id', venta.id)

  console.log('6. Venta local actualizada con datos Centum')

  // 6. Verificar leyendo de vuelta
  const { data: ventaFinal } = await supabase.from('ventas_pos')
    .select('id, nombre_cliente, total, id_venta_centum, centum_comprobante, centum_sync, created_at')
    .eq('id', venta.id)
    .single()

  console.log('\n=== RESULTADO FINAL ===')
  console.log(JSON.stringify(ventaFinal, null, 2))
  console.log('\n' + (ventaFinal.centum_sync ? '✅ ÉXITO' : '❌ FALLO'))
  console.log('Comprobante Centum: ' + (ventaFinal.centum_comprobante || 'N/A'))
}

main().catch(err => console.error('Error:', err.message))
