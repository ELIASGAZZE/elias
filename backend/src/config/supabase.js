// Configuración del cliente de Supabase para el backend
// Usamos la SERVICE_KEY (clave de servicio) que permite operaciones administrativas
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

// Verificamos que las variables de entorno estén configuradas
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Faltan las variables de entorno SUPABASE_URL o SUPABASE_SERVICE_KEY')
}

// Cliente principal con service key para queries de datos (bypasea RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

// Crea un cliente descartable para operaciones de auth que cambian el estado interno
// (signInWithPassword modifica el contexto del cliente, lo que afecta queries posteriores)
function crearClienteAuth() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

module.exports = supabase
module.exports.crearClienteAuth = crearClienteAuth
