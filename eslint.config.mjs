import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    '.next/**',
    '.pipeline-build/**', // Isolated build exports and generated pipeline artifacts.
    '**/.tmp/**', // Worker dry-run output; generated bundles are not source files.
    'coverage/**',
    // Immutable date-audit captures and one-off CommonJS receipts are evidence.
    // Maintainable audit tools and their tests remain linted under scripts/quality.
    'quality/deadline-sweep-20261019/**',
    'playwright-report/**',
    'test-results/**',
    // One-off, idempotent data migrations are validated through schema and
    // regression tests; they intentionally use the CommonJS Node runtime.
    'scripts/ingestion/*.cjs',
  ]),
])
