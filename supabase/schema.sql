-- ============================================================
-- ESQUEMA DE BASE DE DATOS - Sistema de Pedidos Internos
-- Ejecutar este script en: Supabase > SQL Editor
-- ============================================================

-- ── Tabla de sucursales ──────────────────────────────────────
CREATE TABLE sucursales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabla de perfiles de usuario ────────────────────────────
-- Extiende la tabla auth.users de Supabase con datos extra
CREATE TABLE perfiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  -- El rol puede ser 'operario' o 'admin'
  rol TEXT NOT NULL CHECK (rol IN ('operario', 'admin')),
  -- Solo los operarios tienen sucursal asignada
  sucursal_id UUID REFERENCES sucursales(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabla de artículos ───────────────────────────────────────
CREATE TABLE articulos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  -- 'manual' = creado a mano, 'automatico' = sincronizado desde ERP Centum
  tipo TEXT NOT NULL DEFAULT 'manual' CHECK (tipo IN ('manual', 'automatico')),
  rubro TEXT,
  marca TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Artículos habilitados por sucursal ───────────────────────
-- Tabla intermedia: controla qué artículos ve cada sucursal
CREATE TABLE articulos_por_sucursal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  articulo_id UUID REFERENCES articulos(id) ON DELETE CASCADE NOT NULL,
  sucursal_id UUID REFERENCES sucursales(id) ON DELETE CASCADE NOT NULL,
  habilitado BOOLEAN DEFAULT TRUE,
  -- Stock ideal que debería tener la sucursal (para referencia del operario)
  stock_ideal INTEGER DEFAULT 0,
  -- Cada artículo aparece una sola vez por sucursal
  UNIQUE(articulo_id, sucursal_id)
);

-- ── Tabla de pedidos ─────────────────────────────────────────
CREATE TABLE pedidos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sucursal_id UUID REFERENCES sucursales(id) NOT NULL,
  -- usuario_id referencia al id del perfil (no al auth.users)
  usuario_id UUID REFERENCES perfiles(id) NOT NULL,
  fecha DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'confirmado', 'entregado', 'cancelado')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabla de items de pedido ─────────────────────────────────
CREATE TABLE items_pedido (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE NOT NULL,
  articulo_id UUID REFERENCES articulos(id) NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  -- Un artículo no puede repetirse en el mismo pedido
  UNIQUE(pedido_id, articulo_id)
);

-- ============================================================
-- DATOS DE EJEMPLO (opcional, para probar el sistema)
-- ============================================================

-- Sucursal de ejemplo
INSERT INTO sucursales (nombre) VALUES ('Sucursal Centro');

-- NOTA: Los usuarios se crean desde Supabase Auth > Users (en el dashboard)
-- Después de crear el usuario en Auth, insertamos su perfil acá:
--
-- Admin:
--   INSERT INTO perfiles (user_id, nombre, rol)
--   VALUES ('<UUID del usuario admin>', 'Administrador', 'admin');
--
-- Operario:
--   INSERT INTO perfiles (user_id, nombre, rol, sucursal_id)
--   VALUES ('<UUID del operario>', 'Juan Operario', 'operario', '<UUID sucursal>');

-- ============================================================
-- SEGURIDAD (Row Level Security)
-- El backend usa la service key y puede bypassear el RLS.
-- Estas políticas son para el cliente público (si se usa).
-- ============================================================

-- Habilitamos RLS en todas las tablas
ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE articulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE articulos_por_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_pedido ENABLE ROW LEVEL SECURITY;

-- Como todo el acceso pasa por el backend con service key,
-- bloqueamos el acceso directo desde el cliente público
CREATE POLICY "Sin acceso directo desde cliente" ON sucursales FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON perfiles FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON articulos FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON articulos_por_sucursal FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON pedidos FOR ALL USING (false);
CREATE POLICY "Sin acceso directo desde cliente" ON items_pedido FOR ALL USING (false);
