import type { SourceManifestV1 } from '../src/types'

export function sourceManifest(
  overrides: Partial<SourceManifestV1> = {},
): SourceManifestV1 {
  return {
    version: 1,
    id: 'example-program-source',
    institutionId: 'example-university',
    entityType: 'program-cycle',
    sourceCategory: 'dates_deadlines',
    officialUrl: 'https://admissions.example.edu.cn/programs/computer-science',
    allowedHosts: ['admissions.example.edu.cn'],
    allowedRedirectHosts: ['static.example.edu.cn'],
    enabled: true,
    schedule: { intervalHours: 168, jitterMinutes: 60 },
    fetch: { timeoutMs: 10_000, maxBytes: 2_000_000 },
    robots: { mode: 'enforce' },
    canonicalization: {
      ignorePatterns: ['csrf-token="[^"]+"'],
      collapseWhitespace: true,
    },
    extraction: {
      mode: 'rules-then-minimax',
      schemaVersion: 'program-cycle-v1',
      fields: [
        { path: 'deadline', type: 'date', required: true, critical: true },
        { path: 'tuitionCny', type: 'money', required: true, critical: true },
      ],
      rules: [
        {
          kind: 'regex',
          fieldPath: 'deadline',
          pattern: 'Deadline:\\s*(\\d{4}-\\d{2}-\\d{2})',
        },
        {
          kind: 'regex',
          fieldPath: 'tuitionCny',
          pattern: 'Tuition:\\s*[¥￥]?([\\d,]+)',
        },
      ],
    },
    ...overrides,
  }
}
