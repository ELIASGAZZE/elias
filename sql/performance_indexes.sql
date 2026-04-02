-- ============================================================================
-- Índices de performance para tablas críticas
-- Ejecutar manualmente en Supabase SQL Editor
-- Fecha: 2026-04-01
-- ============================================================================

-- articulos: búsqueda por id_centum, codigo, tipo
CREATE INDEX IF NOT EXISTS idx_articulos_id_centum ON articulos(id_centum);
CREATE INDEX IF NOT EXISTS idx_articulos_codigo ON articulos(codigo);
CREATE INDEX IF NOT EXISTS idx_articulos_tipo ON articulos(tipo);

-- clientes: búsqueda por cuit, id_centum, codigo_centum
CREATE INDEX IF NOT EXISTS idx_clientes_cuit ON clientes(cuit);
CREATE INDEX IF NOT EXISTS idx_clientes_id_centum ON clientes(id_centum);
CREATE INDEX IF NOT EXISTS idx_clientes_codigo_centum ON clientes(codigo_centum);

-- ventas_pos: filtros por fecha, sucursal, cajero, estado sync
CREATE INDEX IF NOT EXISTS idx_ventas_pos_created_at ON ventas_pos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ventas_pos_sucursal_id ON ventas_pos(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_ventas_pos_cajero_id ON ventas_pos(cajero_id);
CREATE INDEX IF NOT EXISTS idx_ventas_pos_centum_sync ON ventas_pos(centum_sync) WHERE centum_sync = false;

-- perfiles: lookup por user_id (se usa en CADA request autenticado)
CREATE INDEX IF NOT EXISTS idx_perfiles_user_id ON perfiles(user_id);

-- articulos_por_sucursal: filtro por habilitado y sucursal
CREATE INDEX IF NOT EXISTS idx_aps_sucursal_habilitado ON articulos_por_sucursal(sucursal_id, habilitado) WHERE habilitado = true;

-- fichajes: consultas por empleado y fecha
CREATE INDEX IF NOT EXISTS idx_fichajes_empleado_fecha ON fichajes(empleado_id, fecha_hora DESC);

-- ejecuciones_tarea: consultas por fecha y estado
CREATE INDEX IF NOT EXISTS idx_ejecuciones_fecha ON ejecuciones_tarea(fecha_ejecucion DESC);
-- ejecuciones_tarea no tiene columna "estado", se indexa por tarea_config_id + fecha
CREATE INDEX IF NOT EXISTS idx_ejecuciones_config ON ejecuciones_tarea(tarea_config_id, fecha_ejecucion DESC);

-- ordenes_compra: filtro por estado y proveedor (ejecutar cuando la tabla exista)
-- CREATE INDEX IF NOT EXISTS idx_ordenes_compra_estado ON ordenes_compra(estado);
-- CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor ON ordenes_compra(proveedor_id);

-- ordenes_traspaso: filtro por estado (ejecutar cuando la tabla exista)
-- CREATE INDEX IF NOT EXISTS idx_ordenes_traspaso_estado ON ordenes_traspaso(estado);

-- api_logs: consultas por fecha y tipo
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at DESC);
