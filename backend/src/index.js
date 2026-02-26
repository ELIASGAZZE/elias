// Punto de entrada del servidor Express
require('dotenv').config()
const express = require('express')
const cors = require('cors')

const authRoutes = require('./routes/auth')
const articulosRoutes = require('./routes/articulos')
const pedidosRoutes = require('./routes/pedidos')
const sucursalesRoutes = require('./routes/sucursales')
const rubrosRoutes = require('./routes/rubros')

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
app.use('/api/rubros', rubrosRoutes)

// Ruta de salud para verificar que el servidor está funcionando
app.get('/health', (req, res) => {
  res.json({ estado: 'ok', timestamp: new Date().toISOString() })
})

// ── Inicio del servidor ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
