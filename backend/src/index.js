// Punto de entrada del servidor Express
require('dotenv').config()
const express = require('express')
const cors = require('cors')

const authRoutes = require('./routes/auth')
const articulosRoutes = require('./routes/articulos')
const pedidosRoutes = require('./routes/pedidos')
const sucursalesRoutes = require('./routes/sucursales')

const app = express()
const PORT = process.env.PORT || 3001

// ── Middlewares globales ──────────────────────────────────────────────────────

// Permitimos requests desde el frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))

// Parseamos el body de los requests como JSON
app.use(express.json())

// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/articulos', articulosRoutes)
app.use('/api/pedidos', pedidosRoutes)
app.use('/api/sucursales', sucursalesRoutes)

// Ruta de salud para verificar que el servidor está funcionando
app.get('/health', (req, res) => {
  res.json({ estado: 'ok', timestamp: new Date().toISOString() })
})

// Ruta temporal de migración — ELIMINAR después de ejecutar
const supabase = require('./config/supabase')
app.post('/api/migrate', async (req, res) => {
  try {
    const results = []

    // Intentar agregar columna tipo
    const { error: e1 } = await supabase.rpc('exec_sql', { sql: "ALTER TABLE articulos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'manual'" })
    results.push({ col: 'tipo', error: e1?.message || 'ok (o ya usamos rpc)' })

    // Approach alternativo: intentar insertar/actualizar para verificar que las columnas existen
    // Si las columnas no existen, el error nos lo dirá
    const { data: testTipo, error: testErr } = await supabase.from('articulos').select('tipo').limit(1)
    if (testErr && testErr.code === '42703') {
      results.push({ status: 'COLUMNAS NO EXISTEN - Ejecutar SQL manualmente en Supabase Dashboard' })
    } else {
      results.push({ status: 'Columna tipo: existe', data: testTipo })
    }

    const { data: testStock, error: testErr2 } = await supabase.from('articulos_por_sucursal').select('stock_ideal').limit(1)
    if (testErr2 && testErr2.code === '42703') {
      results.push({ status: 'Columna stock_ideal: NO EXISTE' })
    } else {
      results.push({ status: 'Columna stock_ideal: existe', data: testStock })
    }

    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Inicio del servidor ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
