require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function main() {
  const { data, error } = await supabase
    .from('ventas_pos')
    .select('id, numero_venta, created_at, nombre_cliente, total, centum_sync, centum_error, caja_id, tipo')
    .eq('centum_sync', false)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error:', error.message)
    return
  }

  console.log(`Total ventas sin sync a Centum: ${data.length}\n`)
  for (const v of data) {
    const fecha = v.created_at?.slice(0, 16).replace('T', ' ')
    console.log(`#${v.numero_venta} | ${fecha} | ${v.tipo} | ${v.nombre_cliente || 'CF'} | $${v.total} | caja: ${v.caja_id ? 'SI' : 'NO'} | error: ${v.centum_error || '(ninguno)'}`)
  }
}

main()
