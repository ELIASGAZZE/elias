// Configuración del cliente de Supabase para el backend
// Usamos la SERVICE_KEY (clave de servicio) que permite operaciones administrativas
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

// Verificamos que las variables de entorno estén configuradas
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Faltan las variables de entorno SUPABASE_URL o SUPABASE_SERVICE_KEY')
}

// El cliente con service key puede saltear las políticas de seguridad (RLS)
// Solo debe usarse en el backend, NUNCA en el frontend
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

module.exports = supabase
