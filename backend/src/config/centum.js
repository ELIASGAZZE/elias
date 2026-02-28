// Conexión al SQL Server de Centum BI (modelo de datos del ERP)
const sql = require('mssql')

const centumConfig = {
  server: process.env.CENTUM_BI_SERVER || '119.8.79.133',
  port: parseInt(process.env.CENTUM_BI_PORT || '22455'),
  database: process.env.CENTUM_BI_DATABASE || 'CentumSuiteBL7GazzeJorge',
  user: process.env.CENTUM_BI_USER || 'centum_bi_GazzeJorge',
  password: process.env.CENTUM_BI_PASSWORD || '8601',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 30000,
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 60000,
  },
}

let pool = null

async function getPool() {
  if (!pool) {
    pool = await sql.connect(centumConfig)
    pool.on('error', (err) => {
      console.error('Error en pool Centum BI:', err)
      pool = null
    })
  }
  return pool
}

// Obtener datos de planilla de caja por PlanillaCajaID
async function getPlanillaData(planillaId) {
  const db = await getPool()

  // Info general de la planilla
  const planillaResult = await db.request()
    .input('planillaId', sql.Int, planillaId)
    .query(`
      SELECT PlanillaCajaID, FechaPlanillaCaja, Nombre, Cerrada
      FROM PlanillasCajas_VIEW
      WHERE PlanillaCajaID = @planillaId
    `)

  if (planillaResult.recordset.length === 0) {
    return null
  }

  const planilla = planillaResult.recordset[0]

  // Totales agrupados por forma de pago
  const itemsResult = await db.request()
    .input('planillaId', sql.Int, planillaId)
    .query(`
      SELECT
        v.ValorID AS valor_id,
        v.DetalleValor AS forma_pago,
        SUM(pci.ImportePlanillaCajaItemID) AS total,
        COUNT(*) AS operaciones
      FROM PlanillaCaja_Items_VIEW pci
      JOIN Cobro_Items_VIEW ci ON pci.MovimientoValorIDPlanillaCajaItem = ci.CobroItemID
      JOIN Valores_VIEW v ON ci.ValorID = v.ValorID
      WHERE pci.PlanillaCajaID = @planillaId
      AND ci.ValorID > 0
      GROUP BY v.ValorID, v.DetalleValor
      ORDER BY total DESC
    `)

  const medios_pago = itemsResult.recordset.map(r => ({
    valor_id: r.valor_id,
    nombre: r.forma_pago.trim(),
    total: parseFloat(r.total.toFixed(2)),
    operaciones: r.operaciones,
  }))

  const total_general = medios_pago.reduce((sum, mp) => sum + mp.total, 0)
  const total_efectivo = medios_pago
    .filter(mp => mp.valor_id === 1)
    .reduce((sum, mp) => sum + mp.total, 0)

  return {
    planilla_id: planilla.PlanillaCajaID,
    fecha: planilla.FechaPlanillaCaja,
    nombre_cajero: planilla.Nombre?.trim(),
    cerrada: planilla.Cerrada,
    medios_pago,
    total_efectivo: parseFloat(total_efectivo.toFixed(2)),
    total_general: parseFloat(total_general.toFixed(2)),
  }
}

module.exports = { getPool, getPlanillaData }
