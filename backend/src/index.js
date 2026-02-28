// Punto de entrada del servidor Express
require('dotenv').config()
const express = require('express')
const cors = require('cors')

const authRoutes = require('./routes/auth')
const articulosRoutes = require('./routes/articulos')
const pedidosRoutes = require('./routes/pedidos')
const sucursalesRoutes = require('./routes/sucursales')
const rubrosRoutes = require('./routes/rubros')
const cajasRoutes = require('./routes/cajas')
const cierresRoutes = require('./routes/cierres')
const apiLogsRoutes = require('./routes/apiLogs')
const pushRoutes = require('./routes/push')
const denominacionesRoutes = require('./routes/denominaciones')
const formasCobroRoutes = require('./routes/formas-cobro')
const empleadosRoutes = require('./routes/empleados')
const retirosRoutes = require('./routes/retiros')
const clientesRoutes = require('./routes/clientes')
const deliveryRoutes = require('./routes/delivery')
const cajerosRoutes = require('./routes/cajeros')
const reglasIARoutes = require('./routes/reglasIA')
const { iniciarCronJobs } = require('./jobs/cron')

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
app.use('/api/cajas', cajasRoutes)
app.use('/api/cierres', cierresRoutes)
app.use('/api/api-logs', apiLogsRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/denominaciones', denominacionesRoutes)
app.use('/api/formas-cobro', formasCobroRoutes)
app.use('/api/empleados', empleadosRoutes)
app.use('/api', retirosRoutes)
app.use('/api/clientes', clientesRoutes)
app.use('/api/delivery', deliveryRoutes)
app.use('/api/cajeros', cajerosRoutes)
app.use('/api/reglas-ia', reglasIARoutes)

// Ruta de salud para verificar que el servidor está funcionando
app.get('/health', (req, res) => {
  res.json({ estado: 'ok', timestamp: new Date().toISOString() })
})

// ── Inicio del servidor ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
  iniciarCronJobs()
})
