// Script para sincronizar códigos de barra desde Centum BI → Supabase
// Solo barcodes, no toca precios ni artículos
require('dotenv').config()
const { getPool } = require('./src/config/centum')
const supabase = require('./src/config/supabase')

async function syncBarcodes() {
  console.log('Obteniendo códigos de barra desde Centum BI...')
  const db = await getPool()

  const result = await db.request().query(`
    SELECT ArticuloID, CodigoBarras
    FROM ArticulosCodigosBarras_VIEW
    WHERE CodigoBarras IS NOT NULL AND CodigoBarras != ''
      AND LEN(CodigoBarras) >= 8
  `)

  console.log(`${result.recordset.length} códigos de barra encontrados (>= 8 dígitos)`)

  // Agrupar por ArticuloID
  const barcodeMap = {}
  for (const row of result.recordset) {
    const id = row.ArticuloID
    if (!barcodeMap[id]) barcodeMap[id] = []
    barcodeMap[id].push(row.CodigoBarras.trim())
  }

  const entries = Object.entries(barcodeMap)
  console.log(`${entries.length} artículos con códigos de barra`)

  // Actualizar en lotes via RPC o updates individuales agrupados
  let actualizados = 0
  let errores = 0
  const BATCH = 50

  for (let i = 0; i < entries.length; i += BATCH) {
    const lote = entries.slice(i, i + BATCH)
    const promesas = lote.map(([idCentum, codigos]) =>
      supabase
        .from('articulos')
        .update({ codigos_barras: codigos })
        .eq('id_centum', parseInt(idCentum))
        .then(({ error }) => {
          if (error) { errores++; return }
          actualizados++
        })
    )
    await Promise.all(promesas)
    process.stdout.write(`\r  ${actualizados + errores}/${entries.length}`)
  }

  console.log(`\n\nResultado: ${actualizados} actualizados, ${errores} errores`)
  process.exit(0)
}

syncBarcodes().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
