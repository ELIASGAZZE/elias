-- Migración: Agente Inteligente de Auditoría
-- Ejecutar en Supabase SQL Editor

-- ══════════════════════════════════════════════════════════════
-- FASE 1: Resoluciones de diferencias + cache de análisis IA
-- ══════════════════════════════════════════════════════════════

-- Tabla para registrar la resolución/explicación de cada diferencia encontrada
CREATE TABLE IF NOT EXISTS resoluciones_diferencias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cierre_id UUID NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
  tipo_diferencia TEXT NOT NULL CHECK (tipo_diferencia IN (
    'efectivo', 'payway', 'transferencia', 'mercadopago', 'qr',
    'cheque', 'otro_medio', 'retiro', 'continuidad_cambio'
  )),
  monto_diferencia NUMERIC(12,2) NOT NULL DEFAULT 0,
  causa TEXT NOT NULL CHECK (causa IN (
    'factura_duplicada', 'venta_sin_confirmar', 'error_conteo',
    'redondeo', 'faltante_caja', 'sobrante_caja', 'nota_credito',
    'error_sistema', 'retiro_no_registrado', 'gasto_no_registrado', 'otro'
  )),
  descripcion TEXT,
  evidencia JSONB DEFAULT '{}',
  resuelta_por UUID NOT NULL REFERENCES perfiles(id),
  cajero_id UUID REFERENCES perfiles(id),
  sucursal_id UUID REFERENCES sucursales(id),
  planilla_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_resoluciones_cierre ON resoluciones_diferencias(cierre_id);
CREATE INDEX idx_resoluciones_cajero ON resoluciones_diferencias(cajero_id);
CREATE INDEX idx_resoluciones_sucursal ON resoluciones_diferencias(sucursal_id);
CREATE INDEX idx_resoluciones_causa ON resoluciones_diferencias(causa);

-- Cache de análisis IA (evita re-analizar el mismo cierre)
CREATE TABLE IF NOT EXISTS analisis_ia (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cierre_id UUID NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
  puntaje INTEGER NOT NULL CHECK (puntaje >= 0 AND puntaje <= 100),
  nivel_riesgo TEXT NOT NULL CHECK (nivel_riesgo IN ('bajo', 'medio', 'alto', 'critico')),
  resumen TEXT NOT NULL,
  alertas JSONB DEFAULT '[]',
  recomendaciones JSONB DEFAULT '[]',
  posibles_causas JSONB DEFAULT '[]',
  investigacion JSONB DEFAULT NULL,
  modelo TEXT NOT NULL,
  tokens_usados INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analisis_ia_cierre ON analisis_ia(cierre_id);

-- ══════════════════════════════════════════════════════════════
-- FASE 4: Batch analysis
-- ══════════════════════════════════════════════════════════════

-- Registro de corridas batch de análisis
CREATE TABLE IF NOT EXISTS batch_analisis (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  sucursal_id UUID REFERENCES sucursales(id),
  total_cierres INTEGER NOT NULL DEFAULT 0,
  analizados INTEGER NOT NULL DEFAULT 0,
  con_diferencia INTEGER NOT NULL DEFAULT 0,
  puntaje_promedio NUMERIC(5,2),
  resumen TEXT,
  patrones JSONB DEFAULT '[]',
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesando', 'completado', 'error')),
  error_mensaje TEXT,
  iniciado_por UUID REFERENCES perfiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  completado_at TIMESTAMPTZ
);

CREATE INDEX idx_batch_fecha ON batch_analisis(fecha);
CREATE INDEX idx_batch_sucursal ON batch_analisis(sucursal_id);

-- ══════════════════════════════════════════════════════════════
-- Reglas personalizadas de IA (se inyectan en los prompts)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reglas_ia (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  regla TEXT NOT NULL,
  activa BOOLEAN DEFAULT true,
  creado_por UUID NOT NULL REFERENCES perfiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
