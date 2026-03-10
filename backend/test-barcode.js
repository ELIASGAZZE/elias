require('dotenv').config()
const { getPool } = require('./src/config/centum')

async function test() {
  try {
    const db = await getPool()

    // Ver estructura de ArticulosCodigosBarras_VIEW
    const cols = await db.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'ArticulosCodigosBarras_VIEW'
      ORDER BY ORDINAL_POSITION
    `)
    console.log('Columnas de ArticulosCodigosBarras_VIEW:')
    cols.recordset.forEach(r => console.log(`  ${r.COLUMN_NAME} (${r.DATA_TYPE})`))

    // Contar registros
    const count = await db.request().query(`SELECT COUNT(*) AS total FROM ArticulosCodigosBarras_VIEW`)
    console.log('\nTotal registros:', count.recordset[0].total)

    // Contar cuántos tienen código no vacío
    const countNonEmpty = await db.request().query(`
      SELECT COUNT(*) AS total FROM ArticulosCodigosBarras_VIEW
      WHERE CodigoBarras IS NOT NULL AND CodigoBarras != ''
    `)
    console.log('Con codigo de barras:', countNonEmpty.recordset[0].total)

    // Mostrar ejemplos
    const sample = await db.request().query(`
      SELECT TOP 15 *
      FROM ArticulosCodigosBarras_VIEW
      WHERE CodigoBarras IS NOT NULL AND CodigoBarras != ''
      ORDER BY ArticuloID
    `)
    console.log('\nEjemplos:')
    for (const r of sample.recordset) {
      const vals = Object.entries(r).map(([k, v]) => `${k}=${v}`).join(', ')
      console.log(' ', vals)
    }

    process.exit(0)
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  }
}
test()
