-- Agregar columna atributos (JSONB) a tabla articulos
-- Formato: [{ "id": 2, "nombre": "CLASIFICACION ESPECIAL", "valor": "ATM CAGNOLI", "id_valor": 9 }]
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS atributos JSONB DEFAULT '[]'::jsonb;
