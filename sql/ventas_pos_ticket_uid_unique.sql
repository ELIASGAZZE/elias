-- Unique constraint on ticket_uid to prevent duplicate sales at the database level.
-- Partial index: only enforces uniqueness where ticket_uid is not null
-- (historical sales without ticket_uid are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_pos_ticket_uid_unique
  ON ventas_pos (ticket_uid)
  WHERE ticket_uid IS NOT NULL;
