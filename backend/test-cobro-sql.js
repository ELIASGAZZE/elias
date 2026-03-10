require('dotenv').config()
const sql = require('mssql')

async function test() {
  const pool = await sql.connect({
    server: '119.8.79.133',
    port: 22455,
    database: 'CentumSuiteBL7GazzeJorge',
    user: 'centum_bi_GazzeJorge',
    password: '8601',
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 15000,
    connectionTimeout: 10000,
  })

  const result = await pool.request().query(`
    SELECT TOP 10 CobroID, NumeroDocumento, FechaDocumento, FechaImputacion,
           Anulado, FechaAlta, SucursalFisicaID, ClienteID
    FROM Cobros
    WHERE ClienteID = 11928
    ORDER BY CobroID DESC
  `)

  console.log('Cobros del cliente 11928:')
  result.recordset.forEach(r => {
    console.log('  CobroID:', r.CobroID, '| NumDoc:', r.NumeroDocumento, '| FechaAlta:', r.FechaAlta, '| Anulado:', r.Anulado)
  })

  await pool.close()
}
test().catch(console.error)
