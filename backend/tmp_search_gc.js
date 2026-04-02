require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function buscar() {
  const { data, error } = await supabase
    .from('ventas_pos')
    .select('id, numero_venta, total, monto_pagado, items, pagos, gift_cards_vendidas, created_at')
    .not('items', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300)

  if (error) { console.log('Error:', error.message); return }

  const mixtas = data.filter(v => {
    const items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || [])
    const tieneGC = items.some(i => i.es_gift_card === true)
    const tieneNormal = items.some(i => i.es_gift_card !== true)
    return tieneGC && tieneNormal
  })

  if (mixtas.length > 0) {
    console.log('=== VENTAS MIXTAS (items + GC) ===')
    mixtas.forEach(v => {
      const items = typeof v.items === 'string' ? JSON.parse(v.items) : v.items
      console.log('#' + v.numero_venta, '- Total:', v.total, '- Fecha:', v.created_at)
      items.forEach(i => console.log('  -', i.nombre, i.es_gift_card ? '[GC]' : '', '$' + i.precio_final))
      console.log('  gc_vendidas:', JSON.stringify(v.gift_cards_vendidas))
    })
  } else {
    console.log('No hay ventas mixtas (items + GC en el mismo ticket)')
  }

  const soloGC = data.filter(v => {
    const items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || [])
    return items.length > 0 && items.every(i => i.es_gift_card === true)
  })

  if (soloGC.length > 0) {
    console.log('\n=== VENTAS SOLO GC ===')
    soloGC.forEach(v => {
      console.log('#' + v.numero_venta, '- Total:', v.total, '- Pagos:', JSON.stringify(v.pagos), '- gc_vendidas:', JSON.stringify(v.gift_cards_vendidas))
    })
  }
}
buscar()
