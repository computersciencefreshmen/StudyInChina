import assert from 'node:assert/strict'
import test from 'node:test'
import { rolloutBindingDiagnostic, rolloutCommitDiagnostic } from '../src/rollout-diagnostics'
import { MaintenanceError } from '../src/types'

test('rollout diagnostics classify fixed D1 categories including wrapped causes without returning error text', () => {
  const cases = [
    ['D1_TYPE_ERROR: Type undefined is not supported', 'd1_parameter_type'],
    ['D1_ERROR: Wrong number of parameter bindings', 'd1_parameter_count'],
    ['too many SQL variables', 'd1_parameter_count'],
    ['SQLITE_RANGE: column index out of range', 'd1_parameter_count'],
    ['D1_ERROR: CHECK constraint failed: check_passed=1', 'check_constraint'],
    ['D1_ERROR: no such table: private_table', 'sql'],
    ['D1_ERROR 7500 daily read quota exceeded', 'quota'],
    ['R2_ERROR: storage unavailable', 'backend'],
    ['Opaque provider error', 'unclassified'],
  ] as const
  for (const [message, category] of cases) {
    const diagnostic = rolloutCommitDiagnostic('commit', new Error('D1 batch failed', { cause: new Error(`${message}; Bearer sensitive-secret SELECT raw_private_parameter`) }))
    assert.equal(diagnostic.category, category)
    assert.equal(diagnostic.stage, 'commit')
    assert.doesNotMatch(JSON.stringify(diagnostic), /sensitive|Bearer|SELECT|private|D1 batch/)
  }
})

test('only exact reviewed MaintenanceError codes are returned, arbitrary codes and object stringification are excluded', () => {
  for (const code of ['runtime_model_guard_index_invalid', 'terminal_quarantine_policy_invalid', 'legacy_model_guard_policy_corrupt']) {
    assert.equal(rolloutCommitDiagnostic('read_runtime_disposition', new MaintenanceError(code)).maintenanceCode, code)
  }
  const unknown = rolloutCommitDiagnostic('read_runtime_disposition', new MaintenanceError('runtime_model_guard_secret-Bearer-token'))
  assert.deepEqual(unknown, { format: 'studyinchina.rollout-commit-diagnostic', version: 1, stage: 'read_runtime_disposition', category: 'maintenance' })
  let stringified = false
  assert.equal(rolloutCommitDiagnostic('build_fences', { toString() { stringified = true; throw new Error('secret') } }).category, 'unclassified')
  assert.equal(stringified, false)
  const cyclic = new Error('fetch failed'); cyclic.cause = cyclic
  assert.equal(rolloutCommitDiagnostic('commit', cyclic).category, 'backend')
  assert.equal(rolloutCommitDiagnostic('read_runtime_disposition', new SyntaxError('private malformed evidence JSON')).category, 'invalid_evidence_json')
})

test('binding shape records one-based positions and fixed types without values or mutation', () => {
  const object = { secret: 'sensitive' }, values = ['do-not-return', 20, null, undefined, Number.NaN, Infinity, true, 1n, object, () => 'hidden', Symbol('private')]
  const result = rolloutBindingDiagnostic([values, ['second-statement']])
  assert.equal(result.parameterCount, 12)
  assert.deepEqual(result.statementParameterCounts, [11, 1])
  assert.deepEqual(result.unexpectedParameterTypes, [
    { statement: 1, position: 4, type: 'undefined' }, { statement: 1, position: 5, type: 'non_finite_number' },
    { statement: 1, position: 6, type: 'non_finite_number' }, { statement: 1, position: 7, type: 'boolean' },
    { statement: 1, position: 8, type: 'bigint' }, { statement: 1, position: 9, type: 'object' },
    { statement: 1, position: 10, type: 'function' }, { statement: 1, position: 11, type: 'symbol' },
  ])
  assert.doesNotMatch(JSON.stringify(result), /sensitive|hidden|private|do-not-return|second-statement/)
  assert.equal(values[8], object)
})
