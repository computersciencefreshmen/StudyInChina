import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    '.next/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    // One-off, idempotent data migrations are validated through schema and
    // regression tests; they intentionally use the CommonJS Node runtime.
    'scripts/ingestion/*.cjs',
  ]),
])
