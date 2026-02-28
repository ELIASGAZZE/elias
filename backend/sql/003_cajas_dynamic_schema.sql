-- =====================================================================
-- Migración 003: Schema dinámico para Control de Cajas
-- Ejecutar en Supabase SQL Editor
-- =====================================================================

-- 1. Tabla empleados (cajeros físicos, separados de usuarios del sistema)
CREATE TABLE IF NOT EXISTS empleados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  sucursal_id UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabla denominaciones (billetes y monedas configurables)
CREATE TABLE IF NOT EXISTS denominaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  valor INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('billete', 'moneda')),
  activo BOOLEAN DEFAULT true,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(valor, tipo)
);

-- 3. Tabla formas de cobro (medios de pago configurables)
CREATE TABLE IF NOT EXISTS formas_cobro (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo BOOLEAN DEFAULT true,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Alterar tabla cierres: agregar columnas nuevas
ALTER TABLE cierres ADD COLUMN IF NOT EXISTS caja_id UUID REFERENCES cajas(id) ON DELETE RESTRICT;
ALTER TABLE cierres ADD COLUMN IF NOT EXISTS empleado_id UUID REFERENCES empleados(id) ON DELETE RESTRICT;
ALTER TABLE cierres ADD COLUMN IF NOT EXISTS medios_pago JSONB DEFAULT '[]';

-- 5. Eliminar columnas hardcodeadas de cierres
ALTER TABLE cierres DROP COLUMN IF EXISTS cheques;
ALTER TABLE cierres DROP COLUMN IF EXISTS cheques_cantidad;
ALTER TABLE cierres DROP COLUMN IF EXISTS vouchers_tc;
ALTER TABLE cierres DROP COLUMN IF EXISTS vouchers_tc_cantidad;
ALTER TABLE cierres DROP COLUMN IF EXISTS vouchers_td;
ALTER TABLE cierres DROP COLUMN IF EXISTS vouchers_td_cantidad;
ALTER TABLE cierres DROP COLUMN IF EXISTS transferencias;
ALTER TABLE cierres DROP COLUMN IF EXISTS transferencias_cantidad;
ALTER TABLE cierres DROP COLUMN IF EXISTS pagos_digitales;
ALTER TABLE cierres DROP COLUMN IF EXISTS pagos_digitales_cantidad;
ALTER TABLE cierres DROP COLUMN IF EXISTS otros;
ALTER TABLE cierres DROP COLUMN IF EXISTS otros_detalle;

-- 6. Alterar tabla verificaciones: agregar medios_pago JSONB
ALTER TABLE verificaciones ADD COLUMN IF NOT EXISTS medios_pago JSONB DEFAULT '[]';

-- 7. Eliminar columnas hardcodeadas de verificaciones
ALTER TABLE verificaciones DROP COLUMN IF EXISTS cheques;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS cheques_cantidad;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS vouchers_tc;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS vouchers_tc_cantidad;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS vouchers_td;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS vouchers_td_cantidad;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS transferencias;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS transferencias_cantidad;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS pagos_digitales;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS pagos_digitales_cantidad;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS otros;
ALTER TABLE verificaciones DROP COLUMN IF EXISTS otros_detalle;

-- 8. Actualizar constraint de estado en cierres (por si no incluye 'abierta')
ALTER TABLE cierres DROP CONSTRAINT IF EXISTS cierres_estado_check;
ALTER TABLE cierres ADD CONSTRAINT cierres_estado_check
  CHECK (estado IN ('abierta', 'pendiente_gestor', 'pendiente_agente', 'cerrado', 'con_diferencia'));

-- 9. Seed denominaciones
INSERT INTO denominaciones (valor, tipo, orden) VALUES
  (20000, 'billete', 1),
  (10000, 'billete', 2),
  (5000, 'billete', 3),
  (2000, 'billete', 4),
  (1000, 'billete', 5),
  (500, 'billete', 6),
  (200, 'billete', 7),
  (100, 'billete', 8),
  (500, 'moneda', 9),
  (200, 'moneda', 10),
  (100, 'moneda', 11),
  (50, 'moneda', 12),
  (20, 'moneda', 13),
  (10, 'moneda', 14),
  (5, 'moneda', 15),
  (2, 'moneda', 16),
  (1, 'moneda', 17)
ON CONFLICT (valor, tipo) DO NOTHING;

-- 10. Seed formas de cobro
INSERT INTO formas_cobro (nombre, orden) VALUES
  ('Cheques', 1),
  ('Vouchers TC (crédito)', 2),
  ('Vouchers TD (débito)', 3),
  ('Transferencias', 4),
  ('Pagos digitales', 5),
  ('Otros', 6)
ON CONFLICT (nombre) DO NOTHING;

-- 11. RLS para nuevas tablas
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE denominaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE formas_cobro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo a service_role en empleados" ON empleados FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a service_role en denominaciones" ON denominaciones FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a service_role en formas_cobro" ON formas_cobro FOR ALL USING (true) WITH CHECK (true);
