import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceFingerprint, translationCacheKey } from '../src/pipeline'
import type { SourceCandidate } from '../src/types'

const candidate: SourceCandidate = {
  recordId: 'program-internal-1',
  recordPublicId: 'program-public-1',
  recordKind: 'program',
  institutionId: 'university-1',
  fieldName: 'name',
  sourceLocale: 'zh',
  sourceText: '计算机科学',
  targetLocale: 'en',
  targetStatus: null,
  targetSourceSha256: null,
}

test('unchanged source content produces the same cache key and changed content misses cache', async () => {
  const firstHash = await sourceFingerprint(candidate)
  const equivalentHash = await sourceFingerprint({ ...candidate, sourceText: '计算机科学' })
  const changedHash = await sourceFingerprint({ ...candidate, sourceText: '计算机科学与技术' })
  assert.equal(firstHash, equivalentHash)
  assert.notEqual(firstHash, changedHash)

  const firstKey = await translationCacheKey(candidate, firstHash, 'MiniMax-M2.7')
  const equivalentKey = await translationCacheKey(
    { ...candidate },
    equivalentHash,
    'MiniMax-M2.7',
  )
  const changedKey = await translationCacheKey(candidate, changedHash, 'MiniMax-M2.7')
  const upgradedModelKey = await translationCacheKey(candidate, firstHash, 'MiniMax-M3')
  assert.equal(firstKey, equivalentKey)
  assert.notEqual(firstKey, changedKey)
  assert.notEqual(firstKey, upgradedModelKey)
})

