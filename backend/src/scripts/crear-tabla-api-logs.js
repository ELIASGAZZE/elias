// Script para crear la tabla api_logs en Supabase via pg directo
// Ejecutar: node src/scripts/crear-tabla-api-logs.js
require('dotenv').config()
const { Pool } = require('pg')

const connectionString = process.argv[2] || process.env.DATABASE_URL

if (!connectionString) {
  console.error('Uso: node src/scripts/crear-tabla-api-logs.js <DATABASE_URL>')
  console.error('  o definir DATABASE_URL en .env')
  process.exit(1)
}

async function main() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } })

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_logs (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        servicio TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        metodo TEXT NOT NULL,
        estado TEXT NOT NULL,
        status_code INTEGER,
        duracion_ms INTEGER,
        items_procesados INTEGER,
        error_mensaje TEXT,
        origen TEXT DEFAULT 'cron'
      );
    `)
    console.log('Tabla api_logs creada correctamente')
  } catch (err) {
    console.error('Error al crear tabla:', err.message)
  } finally {
    await pool.end()
  }
}

main()
