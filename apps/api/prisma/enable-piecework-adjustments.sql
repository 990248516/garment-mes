BEGIN;

ALTER TABLE piecework_entries
  DROP CONSTRAINT IF EXISTS piecework_entries_amount_check,
  DROP CONSTRAINT IF EXISTS piecework_entries_check,
  DROP CONSTRAINT IF EXISTS piecework_entries_quantity_check,
  DROP CONSTRAINT IF EXISTS piecework_entries_unit_rate_check;

ALTER TABLE piecework_entries
  ADD CONSTRAINT piecework_entries_amount_check
    CHECK (adjustment_of_id IS NOT NULL OR amount >= 0),
  ADD CONSTRAINT piecework_entries_check
    CHECK (adjustment_of_id IS NOT NULL OR amount = quantity::numeric * unit_rate),
  ADD CONSTRAINT piecework_entries_quantity_check
    CHECK (adjustment_of_id IS NOT NULL OR quantity >= 0),
  ADD CONSTRAINT piecework_entries_unit_rate_check
    CHECK (adjustment_of_id IS NOT NULL OR unit_rate >= 0);

COMMIT;
