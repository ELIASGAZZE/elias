-- Campos para pallets en traspaso_canastos
ALTER TABLE traspaso_canastos
  ADD COLUMN IF NOT EXISTS cantidad_bultos_origen INTEGER,
  ADD COLUMN IF NOT EXISTS cantidad_bultos_destino INTEGER,
  ADD COLUMN IF NOT EXISTS numero_pallet TEXT;

-- Permitir tipo 'pallet' en el check constraint
ALTER TABLE traspaso_canastos DROP CONSTRAINT IF EXISTS traspaso_canastos_tipo_check;
ALTER TABLE traspaso_canastos ADD CONSTRAINT traspaso_canastos_tipo_check
  CHECK (tipo IN ('canasto', 'bulto', 'pallet'));

-- Indice para buscar pallets por numero
CREATE INDEX IF NOT EXISTS idx_tc_numero_pallet ON traspaso_canastos(numero_pallet) WHERE numero_pallet IS NOT NULL;

-- Migrar config de tolerancia: porcentaje -> gramos
DELETE FROM traspaso_config WHERE clave = 'tolerancia_peso_porcentaje';
INSERT INTO traspaso_config (clave, valor) VALUES ('tolerancia_peso_gramos', '500')
  ON CONFLICT (clave) DO UPDATE SET valor = '500';

-- Secuencia para numeros de pallet
CREATE SEQUENCE IF NOT EXISTS traspaso_pallet_numero_seq START 1;
