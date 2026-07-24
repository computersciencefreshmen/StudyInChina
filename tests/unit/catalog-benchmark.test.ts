import { describe, expect, it } from 'vitest'
import {
  parseBenchmarkOptions,
  percentile,
  summarizeMetric,
} from '../../scripts/catalog/benchmark-catalog'

describe('synthetic Catalog benchmark helpers', () => {
  it('uses the locked full-scale defaults and supports a deterministic smoke scale', () => {
    const defaults = parseBenchmarkOptions([], '/workspace')
    expect(defaults).toMatchObject({
      institutions: 1_000,
      programs: 100_000,
      cycles: 300_000,
      iterations: 200,
      warmup: 20,
      seed: 20_260_720,
      keepDatabase: false,
    })

    const smoke = parseBenchmarkOptions(
      [
        '--institutions',
        '10',
        '--programs',
        '100',
        '--cycles',
        '300',
        '--iterations',
        '12',
        '--warmup',
        '3',
        '--seed',
        '42',
        '--keep-db',
      ],
      '/workspace',
    )
    expect(smoke).toMatchObject({
      institutions: 10,
      programs: 100,
      cycles: 300,
      iterations: 12,
      warmup: 3,
      seed: 42,
      keepDatabase: true,
    })
  })

  it('rejects scales that cannot give every institution a program and every program a cycle', () => {
    expect(() =>
      parseBenchmarkOptions(
        ['--institutions', '10', '--programs', '9', '--cycles', '20'],
      ),
    ).toThrow(/programs/)
    expect(() =>
      parseBenchmarkOptions(
        ['--institutions', '10', '--programs', '20', '--cycles', '19'],
      ),
    ).toThrow(/cycles/)
  })

  it('uses nearest-rank p95 and fails at the strict threshold boundary', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1)
    expect(percentile(samples, 0.95)).toBe(19)
    expect(summarizeMetric(samples, Array(20).fill(1), 20)).toMatchObject({
      p95Ms: 19,
      thresholdMs: 20,
      passed: true,
    })
    expect(summarizeMetric(Array(20).fill(250), Array(20).fill(1), 250).passed).toBe(
      false,
    )
  })
})
