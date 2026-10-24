import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['./tests/**/*.test.{ts,tsx}'],
    // Full-catalogue SQLite/JSON fixtures are memory-heavy. Do not start one
    // jsdom process per logical core on large desktops and starve each test.
    maxWorkers: Math.min(4, availableParallelism()),
    coverage: { reporter: ['text', 'html'] },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
    },
  },
})
