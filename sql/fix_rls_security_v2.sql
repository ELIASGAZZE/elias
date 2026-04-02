-- ============================================================
-- FIX: Habilitar RLS en tablas pendientes
-- Fecha: 2026-04-01
-- Estado: PENDIENTE DE EJECUTAR
-- ============================================================
-- Contexto: Supabase envió alerta de seguridad el 30/03/2026
-- indicando tablas públicamente accesibles sin RLS.
-- El backend usa service_key que bypasea RLS.
-- Política USING (false) bloquea acceso desde anon key.
-- ============================================================

-- 1. analisis_ia
ALTER TABLE analisis_ia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON analisis_ia;
CREATE POLICY "Sin acceso directo desde cliente" ON analisis_ia
  FOR ALL USING (false);

-- 2. articulos_delivery
ALTER TABLE articulos_delivery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON articulos_delivery;
CREATE POLICY "Sin acceso directo desde cliente" ON articulos_delivery
  FOR ALL USING (false);

-- 3. asignaciones_turno
ALTER TABLE asignaciones_turno ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON asignaciones_turno;
CREATE POLICY "Sin acceso directo desde cliente" ON asignaciones_turno
  FOR ALL USING (false);

-- 4. autorizaciones_horario
ALTER TABLE autorizaciones_horario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON autorizaciones_horario;
CREATE POLICY "Sin acceso directo desde cliente" ON autorizaciones_horario
  FOR ALL USING (false);

-- 5. batch_analisis
ALTER TABLE batch_analisis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON batch_analisis;
CREATE POLICY "Sin acceso directo desde cliente" ON batch_analisis
  FOR ALL USING (false);

-- 6. feriados
ALTER TABLE feriados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON feriados;
CREATE POLICY "Sin acceso directo desde cliente" ON feriados
  FOR ALL USING (false);

-- 7. fichajes
ALTER TABLE fichajes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON fichajes;
CREATE POLICY "Sin acceso directo desde cliente" ON fichajes
  FOR ALL USING (false);

-- 8. grupos_descuento
ALTER TABLE grupos_descuento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON grupos_descuento;
CREATE POLICY "Sin acceso directo desde cliente" ON grupos_descuento
  FOR ALL USING (false);

-- 9. licencias
ALTER TABLE licencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON licencias;
CREATE POLICY "Sin acceso directo desde cliente" ON licencias
  FOR ALL USING (false);

-- 10. resoluciones_diferencias
ALTER TABLE resoluciones_diferencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON resoluciones_diferencias;
CREATE POLICY "Sin acceso directo desde cliente" ON resoluciones_diferencias
  FOR ALL USING (false);

-- 11. turnos
ALTER TABLE turnos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sin acceso directo desde cliente" ON turnos;
CREATE POLICY "Sin acceso directo desde cliente" ON turnos
  FOR ALL USING (false);

-- ── Verificación final ─────────────────────────────────────
-- Ejecutar después para confirmar que no quedan tablas sin RLS:
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public' AND rowsecurity = false
-- ORDER BY tablename;
-- Resultado esperado: 0 filas
