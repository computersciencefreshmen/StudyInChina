import assert from 'node:assert/strict'
import test from 'node:test'
import { toReleaseTranslationStatus } from '../src/release-projection'

test('release projection never presents machine output as reviewed', () => {
  assert.equal(toReleaseTranslationStatus('reviewed', null), 'reviewed')
  assert.equal(toReleaseTranslationStatus('published', null), 'published')
  assert.equal(toReleaseTranslationStatus('machine_generated', 'zh'), 'fallback')
  assert.equal(toReleaseTranslationStatus('machine', 'en'), 'fallback')
  assert.equal(toReleaseTranslationStatus('machine', null), null)
  assert.equal(toReleaseTranslationStatus('draft', 'zh'), null)
})

