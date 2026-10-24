import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPriorReportHash } from './summarize-deadline-rechecks'

const good = 'a'.repeat(64), other = 'b'.repeat(64)
test('accepts the original reportSha256 evidence shape', () => assert.doesNotThrow(() => assertPriorReportHash({ reportSha256: good }, good)))
test('accepts sha256 while validating actual frozen bytes', () => assert.doesNotThrow(() => assertPriorReportHash({ sha256: good }, good)))
test('accepts matching aliases', () => assert.doesNotThrow(() => assertPriorReportHash({ reportSha256: good, sha256: good }, good)))
test('rejects conflicting aliases even when one matches the file', () => assert.throws(() => assertPriorReportHash({ reportSha256: good, sha256: other }, good)))
test('rejects a changed frozen report', () => assert.throws(() => assertPriorReportHash({ sha256: good }, other)))
test('rejects a missing referenced report', () => assert.throws(() => assertPriorReportHash({ sha256: good }, undefined)))
test('rejects missing or malformed hash evidence', () => { assert.throws(() => assertPriorReportHash({}, good)); assert.throws(() => assertPriorReportHash({ sha256: 'not-a-hash' }, good)) })
test('rejects an explicitly empty alias even if the other alias matches', () => assert.throws(() => assertPriorReportHash({ reportSha256: '', sha256: good }, good)))
