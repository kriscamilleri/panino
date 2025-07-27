-- /backend/postgres-init/003_powersync_oplog.sql

-- Create the schema that PowerSync uses for its oplog
CREATE SCHEMA IF NOT EXISTS powersync;

-- Create the oplog table for write-back
CREATE TABLE IF NOT EXISTS powersync.ps_oplog (
  id BIGSERIAL PRIMARY KEY,
  op TEXT NOT NULL,
  "table" TEXT NOT NULL,
  row_id TEXT,
  data TEXT,
  changed_data TEXT,
  op_timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create a function that will be called by our triggers
CREATE OR REPLACE FUNCTION powersync.oplog_notify()
RETURNS TRIGGER AS $$
DECLARE
  op_type TEXT;
  full_data TEXT;
  changed_data TEXT;
BEGIN
  op_type := TG_OP; -- INSERT, UPDATE, DELETE

  IF (op_type = 'UPDATE' OR op_type = 'INSERT') THEN
    full_data := row_to_json(NEW)::TEXT;
  END IF;

  IF (op_type = 'UPDATE') THEN
    changed_data := jsonb_diff_val(row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb)::TEXT;
  END IF;

  INSERT INTO powersync.ps_oplog(op, "table", row_id, data, changed_data)
  VALUES (
    op_type,
    TG_TABLE_NAME,
    CASE WHEN op_type = 'DELETE' THEN OLD.id ELSE NEW.id END,
    full_data,
    changed_data
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Helper function to diff JSONB for UPDATE operations
CREATE OR REPLACE FUNCTION jsonb_diff_val(val1 JSONB, val2 JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  v RECORD;
BEGIN
   result = val2;
   FOR v IN SELECT * FROM jsonb_each(val1) LOOP
     IF result @> jsonb_build_object(v.key, v.value) THEN
        result = result - v.key;
     END IF;
   END LOOP;
   RETURN result;
END;
$$ LANGUAGE plpgsql;


-- Create triggers for the 'notes' table
DROP TRIGGER IF EXISTS ps_oplog_notes_trigger ON notes;
CREATE TRIGGER ps_oplog_notes_trigger
AFTER INSERT OR UPDATE OR DELETE ON notes
FOR EACH ROW EXECUTE FUNCTION powersync.oplog_notify();

-- Create triggers for the 'folders' table
DROP TRIGGER IF EXISTS ps_oplog_folders_trigger ON folders;
CREATE TRIGGER ps_oplog_folders_trigger
AFTER INSERT OR UPDATE OR DELETE ON folders
FOR EACH ROW EXECUTE FUNCTION powersync.oplog_notify();