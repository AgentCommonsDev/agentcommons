-- Native keys are the identity whenever supplied. JSONL truncation can reuse a
-- byte offset for a distinct native record; only keyless records dedupe by slot.
DROP INDEX raw_record_session_id_pos_source_version_key;
CREATE UNIQUE INDEX raw_record_keyless_source_position
  ON raw_record(session_id, pos, source_version) WHERE key IS NULL;
CREATE INDEX raw_record_session_id_pos_source_version_id_idx
  ON raw_record(session_id, pos, source_version, id);
