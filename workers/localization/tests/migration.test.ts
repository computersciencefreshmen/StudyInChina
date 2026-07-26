import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

test('localization migration is rerunnable and enforces machine-generated provenance', () => {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE records (id TEXT PRIMARY KEY);
  `)
  const migration = readFileSync(
    'infra/d1/pipeline/migrations/0012_localization_pipeline.sql',
    'utf8',
  )
  database.exec(migration)
  database.exec(migration)
  const hash = 'a'.repeat(64)
  database.prepare(`
    INSERT INTO translation_cache (
      cache_key, source_sha256, source_locale, target_locale, record_kind,
      field_name, model, prompt_version, translated_text, translated_sha256,
      created_at, last_used_at
    ) VALUES (?, ?, 'zh', 'en', 'program', 'name', 'MiniMax-M2.7',
              'translation-v1', 'Computer Science', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(hash, hash, hash)
  const stored = database.prepare(`
    SELECT translation_status FROM translation_cache WHERE cache_key = ?
  `).get(hash) as { translation_status: string }
  assert.equal(stored.translation_status, 'machine_generated')
  assert.throws(() => database.prepare(`
    INSERT INTO translation_cache (
      cache_key, source_sha256, source_locale, target_locale, record_kind,
      field_name, model, prompt_version, translated_text, translated_sha256,
      translation_status, created_at, last_used_at
    ) VALUES (?, ?, 'zh', 'zh', 'program', 'name', 'm', 'p', 'x', ?,
              'reviewed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run('b'.repeat(64), hash, hash))
  database.close()
})

