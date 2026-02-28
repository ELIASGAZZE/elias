-- ============================================================
-- TABLAS PARA APP CONTROL DE CAJAS
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ── Tabla de cajas registradoras ──────────────────────────────
CREATE TABLE IF NOT EXISTS cajas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sucursal_id UUID REFERENCES sucursales(id) ON DELETE CASCADE NOT NULL,
  nombre TEXT NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sucursal_id, nombre)
);

-- ── Tabla de empleados ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empleados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  sucursal_id UUID REFERENCES sucursales(id) ON DELETE CASCADE NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabla de denominaciones (billetes y monedas) ──────────────
CREATE TABLE IF NOT EXISTS denominaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  valor INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('billete', 'moneda')),
  activo BOOLEAN DEFAULT TRUE,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(valor, tipo)
);

-- ── Tabla de formas de cobro ──────────────────────────────────
CREATE TABLE IF NOT EXISTS formas_cobro (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo BOOLEAN DEFAULT TRUE,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabla de cierres de caja ──────────────────────────────────
CREATE TABLE IF NOT EXISTS cierres (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  planilla_id TEXT NOT NULL UNIQUE,
  caja_id UUID REFERENCES cajas(id) NOT NULL,
  empleado_id UUID REFERENCES empleados(id) NOT NULL,
  cajero_id UUID REFERENCES perfiles(id) NOT NULL,
  fecha DATE DEFAULT CURRENT_DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierta'
    CHECK (estado IN ('abierta', 'pendiente_gestor', 'pendiente_agente', 'cerrado', 'con_diferencia')),
  fondo_fijo NUMERIC DEFAULT 0,
  billetes JSONB DEFAULT '{}',
  monedas JSONB DEFAULT '{}',
  total_efectivo NUMERIC DEFAULT 0,
  medios_pago JSONB DEFAULT '[]',
  total_general NUMERIC DEFAULT 0,
  observaciones TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabla de verificaciones (gestor) ──────────────────────────
CREATE TABLE IF NOT EXISTS verificaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cierre_id UUID REFERENCES cierres(id) ON DELETE CASCADE NOT NULL UNIQUE,
  gestor_id UUID REFERENCES perfiles(id) NOT NULL,
  billetes JSONB DEFAULT '{}',
  monedas JSONB DEFAULT '{}',
  total_efectivo NUMERIC DEFAULT 0,
  medios_pago JSONB DEFAULT '[]',
  total_general NUMERIC DEFAULT 0,
  observaciones TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS (Row Level Security) ──────────────────────────────────
-- Todo acceso pasa por backend con service key
ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE denominaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE formas_cobro ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres ENABLE ROW LEVEL SECURITY;
ALTER TABLE verificaciones ENABLE ROW LEVEL SECURITY;

-- Políticas: sin acceso directo desde cliente público
CREATE POLICY "Sin acceso directo desde cliente" ON cajas FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON empleados FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON denominaciones FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON formas_cobro FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON cierres FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON verificaciones FOR ALL USING (false);

-- ============================================================
-- DATOS INICIALES
-- ============================================================

-- Denominaciones de billetes argentinos
INSERT INTO denominaciones (valor, tipo, orden) VALUES
  (20000, 'billete', 1),
  (10000, 'billete', 2),
  (5000, 'billete', 3),
  (2000, 'billete', 4),
  (1000, 'billete', 5),
  (500, 'billete', 6),
  (200, 'billete', 7),
  (100, 'billete', 8)
ON CONFLICT (valor, tipo) DO NOTHING;

-- Denominaciones de monedas argentinas
INSERT INTO denominaciones (valor, tipo, orden) VALUES
  (500, 'moneda', 1),
  (200, 'moneda', 2),
  (100, 'moneda', 3),
  (50, 'moneda', 4),
  (20, 'moneda', 5),
  (10, 'moneda', 6),
  (5, 'moneda', 7),
  (2, 'moneda', 8),
  (1, 'moneda', 9)
ON CONFLICT (valor, tipo) DO NOTHING;

-- Formas de cobro comunes
INSERT INTO formas_cobro (nombre, orden) VALUES
  ('Cheques', 1),
  ('Vouchers TC (crédito)', 2),
  ('Vouchers TD (débito)', 3),
  ('Transferencias', 4),
  ('Pagos digitales', 5)
ON CONFLICT (nombre) DO NOTHING;

-- Cajas de prueba (una por sucursal)
INSERT INTO cajas (sucursal_id, nombre) VALUES
  ('c254cac8-4c6e-4098-9119-485d7172f281', 'Caja 1'),
  ('c254cac8-4c6e-4098-9119-485d7172f281', 'Caja 2'),
  ('5bae4356-0fc1-44c4-81a9-ecfc24ed3ce3', 'Caja 1'),
  ('19da94f2-e51b-4766-bd74-b0a2d093d644', 'Caja 1')
ON CONFLICT (sucursal_id, nombre) DO NOTHING;

-- Empleados de prueba (uno por sucursal)
INSERT INTO empleados (nombre, sucursal_id) VALUES
  ('Juan Pérez', 'c254cac8-4c6e-4098-9119-485d7172f281'),
  ('María García', 'c254cac8-4c6e-4098-9119-485d7172f281'),
  ('Carlos López', '5bae4356-0fc1-44c4-81a9-ecfc24ed3ce3'),
  ('Ana Martínez', '19da94f2-e51b-4766-bd74-b0a2d093d644');
