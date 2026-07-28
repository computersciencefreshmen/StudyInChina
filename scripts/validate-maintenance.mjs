#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const requiredWorkflows = [
  '.github/workflows/ci.yml',
  '.github/workflows/data-health.yml',
  '.github/workflows/program-fact-refresh.yml',
  '.github/workflows/official-catalog-harvest.yml',
  '.github/workflows/cloudflare-backup.yml',
  '.github/workflows/cloudflare-restore-drill.yml',
  '.github/workflows/vercel-production-alias.yml',
]

async function text(path) {
  return readFile(path, 'utf8')
}

function requirePattern(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message)
}

const workflowEntries = await Promise.all(
  requiredWorkflows.map(async (path) => [path, await text(path)]),
)
const workflows = new Map(workflowEntries)
const refresh = workflows.get('.github/workflows/program-fact-refresh.yml')
const harvest = workflows.get('.github/workflows/official-catalog-harvest.yml')
const health = workflows.get('.github/workflows/data-health.yml')
const backup = workflows.get('.github/workflows/cloudflare-backup.yml')
const restore = workflows.get('.github/workflows/cloudflare-restore-drill.yml')
const alias = workflows.get('.github/workflows/vercel-production-alias.yml')

requirePattern(
  refresh,
  /cron:\s*'19 4 \* \* 2'/,
  'The complete Catalog fact refresh must run weekly.',
)
requirePattern(
  refresh,
  /build-current-program-review\.ts/,
  'The fact refresh must build its queue from the current Catalog.',
)
requirePattern(
  refresh,
  /--minimum-domain-interval-ms 5000/,
  'The fact refresh must keep the five-second per-domain interval.',
)
requirePattern(
  harvest,
  /expected_upload_count/,
  'The official harvest must derive its R2 object count from the manifest.',
)
if (/-ne 64|exactly 64 verified/u.test(harvest)) {
  throw new Error('The official harvest still contains the legacy fixed R2 object count.')
}
requirePattern(
  health,
  /11 2 \* \* \*/,
  'A daily freshness audit is required.',
)
requirePattern(
  health,
  /17 3 \* \* 0/,
  'A weekly source audit is required.',
)
requirePattern(
  health,
  /23 4 1 \* \*/,
  'A monthly data review is required.',
)
requirePattern(
  backup,
  /37 18 \* \* \*/,
  'Daily D1 backups are required.',
)
requirePattern(
  restore,
  /15 1,4,7,10 \*/,
  'A quarterly restore drill is required.',
)
requirePattern(
  alias,
  /vercel@58\.0\.0 alias set/,
  'Successful main deployments must support stable Vercel alias promotion.',
)
requirePattern(
  alias,
  /api\/v1\/releases\/current/,
  'Vercel alias promotion must smoke-test the public release API.',
)

const programs = JSON.parse(await text('content/data/programs.json'))
const currentPrograms = programs.filter(
  (program) => program.status === 'verified' || program.status === 'stale',
)
const uniqueOfficialUrls = new Set(currentPrograms.map((program) => program.programUrl))
const scheduledUrlLimit = Number(refresh.match(/default:\s*'(\d+)'/)?.[1])
if (!Number.isFinite(scheduledUrlLimit) || scheduledUrlLimit <= 0) {
  throw new Error('The scheduled Catalog URL limit is invalid.')
}
if (uniqueOfficialUrls.size > scheduledUrlLimit) {
  throw new Error(
    `The Catalog has ${uniqueOfficialUrls.size} official URLs but the weekly refresh limit is ${scheduledUrlLimit}.`,
  )
}

console.log(JSON.stringify({
  status: 'ready',
  requiredWorkflows: requiredWorkflows.length,
  currentPrograms: currentPrograms.length,
  uniqueOfficialUrls: uniqueOfficialUrls.size,
  scheduledUrlLimit,
  freshnessAudit: 'daily',
  factRefresh: 'weekly',
  backup: 'daily',
  restoreDrill: 'quarterly',
}, null, 2))
