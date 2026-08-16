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
const p0Reliability = await text('scripts/operations/evaluate-p0-reliability.mjs')

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
  backup,
  /node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\/cloudflare\/backup-preflight\.ts --phase credentials[\s\S]*Install dependencies/,
  'The backup must validate configuration before installing dependencies.',
)
requirePattern(
  backup,
  /Verify read access to both remote D1 databases/,
  'The backup must verify both remote D1 resources before export.',
)
requirePattern(
  backup,
  /secrets\.CLOUDFLARE_D1_BACKUP_TOKEN/,
  'The backup must use the dedicated least-privilege backup token.',
)
requirePattern(
  backup,
  /studyinchina-backups\/backups\/daily\/\$day\/raw-v1\/catalog\.sql\.gz[\s\S]*studyinchina-backups\/backups\/monthly\/\$month\/raw-v1\/catalog\.sql\.gz/,
  'D1 backups must use the raw-v1 namespace in the private backup-only R2 bucket.',
)
requirePattern(
  backup,
  /--content-type="application\/gzip" --content-encoding="identity"/,
  'Compressed SQL objects must be stored as raw bytes without transparent content decoding.',
)
requirePattern(
  restore,
  /studyinchina-backups\/backups\/monthly\/\$BACKUP_MONTH\/raw-v1\/catalog\.sql\.gz[\s\S]*raw-v1\/pipeline\.sql\.gz[\s\S]*raw-v1\/sha256\.txt/,
  'Restore drills must read the versioned raw-v1 monthly backup set.',
)
requirePattern(
  backup,
  /Upload daily and monthly copies[\s\S]*Read back and cryptographically verify daily checkpoint[\s\S]*--phase artifacts/,
  'The backup must read back and cryptographically verify uploaded objects.',
)
requirePattern(
  backup,
  /Read back and cryptographically verify daily checkpoint[\s\S]*backups\/daily\/\$day\/raw-v1\/catalog\.sql\.gz[\s\S]*raw-v1\/pipeline\.sql\.gz[\s\S]*raw-v1\/sha256\.txt[\s\S]*--phase artifacts/,
  'The readback step must verify the same raw-v1 daily object set that was uploaded.',
)
if (/secrets\.CLOUDFLARE_API_TOKEN/u.test(backup)) {
  throw new Error('The backup still reads the legacy generic Cloudflare token secret.')
}
requirePattern(
  backup,
  /if:\s*\$\{\{ failure\(\) \}\}[\s\S]*does \*\*not\*\* satisfy/,
  'Failed backup runs must publish explicit incomplete-checkpoint guidance.',
)
requirePattern(
  restore,
  /15 1,4,7,10 \*/,
  'A quarterly restore drill is required.',
)
requirePattern(
  restore,
  /environment:\s*cloudflare-restore-drill/,
  'Restore access must be protected by the cloudflare-restore-drill environment.',
)
requirePattern(
  restore,
  /secrets\.CLOUDFLARE_D1_RESTORE_TOKEN/,
  'Restore must use a credential distinct from daily backup.',
)
if (/secrets\.CLOUDFLARE_(?:API|D1_BACKUP)_TOKEN/u.test(restore)) {
  throw new Error('Restore must not read the generic or daily backup token secret.')
}
requirePattern(
  alias,
  /vercel@58\.0\.0 alias set/,
  'Successful main deployments must support stable Vercel alias promotion.',
)
requirePattern(
  alias,
  /Wait for successful CI on the exact deployment SHA[\s\S]*branch=main&event=push[\s\S]*\.head_sha == \$sha[\s\S]*\.conclusion == "success"/,
  'Vercel alias promotion must wait for successful CI on the exact deployment SHA.',
)
requirePattern(
  alias,
  /Reconfirm deployment SHA is still current main[\s\S]*\/git\/ref\/heads\/main[\s\S]*steps\.current\.outputs\.matches == 'true'/,
  'Vercel alias promotion must recheck current main after waiting for CI.',
)
requirePattern(
  alias,
  /concurrency:[\s\S]*group:\s*vercel-production-alias[\s\S]*cancel-in-progress:\s*false/,
  'Vercel alias promotion must serialize runs without cancelling an in-progress mutation.',
)
const aliasPromotionStart = alias.indexOf('- name: Promote stable production alias transaction and verify release API')
if (aliasPromotionStart < 0) {
  throw new Error('The fail-closed Vercel alias transaction is missing.')
}
const aliasPromotionBlock = alias.slice(aliasPromotionStart)
requirePattern(
  aliasPromotionBlock,
  /alias list[\s\S]*rollback_on_failure\(\)[\s\S]*vercel@58\.0\.0 alias set[\s\S]*previous_target[\s\S]*trap rollback_on_failure EXIT[\s\S]*previous_target=[\s\S]*final_main_sha=[\s\S]*mutation_attempted=true[\s\S]*vercel@58\.0\.0 alias set[\s\S]*DEPLOYMENT_URL[\s\S]*post_promotion_main_sha=[\s\S]*studyinchina\.vercel\.app\/api\/v1\/releases\/current[\s\S]*transaction_committed=true/,
  'Alias mutation must capture the previous target, recheck main immediately, and retain a rollback path.',
)
requirePattern(
  aliasPromotionBlock,
  /\/git\/ref\/heads\/main/,
  'Alias mutation must re-read the current main SHA inside the transaction.',
)
requirePattern(
  aliasPromotionBlock,
  /Production promotion raced with main/,
  'Alias mutation must fail closed when main advances during promotion.',
)
requirePattern(
  aliasPromotionBlock,
  /Stable alias rollback failed[\s\S]*Stable alias rollback verification failed/,
  'Alias mutation must retain explicit rollback and rollback-verification failure paths.',
)
if ((aliasPromotionBlock.match(/vercel@58\.0\.0 alias set/gu) ?? []).length !== 2) {
  throw new Error('The alias mutation step must contain one promotion and one rollback command.')
}
requirePattern(
  alias,
  /\.data\.deploymentSha == \$sha[\s\S]*Promote stable production alias[\s\S]*\.data\.deploymentSha == \$sha/,
  'Immutable and stable release smokes must prove the exact deployment SHA.',
)
requirePattern(
  aliasPromotionBlock,
  /\.data\.publicCounts\.programs \| type == "number" and \. > 0/,
  'The stable release smoke must reject an empty or non-numeric public program count.',
)
requirePattern(
  alias,
  /api\/v1\/releases\/current/,
  'Vercel alias promotion must smoke-test the public release API.',
)
requirePattern(
  alias,
  /VERCEL_TOKEN is not configured[\s\S]*exit 1/,
  'A missing Vercel token must fail the alias workflow instead of producing a false green result.',
)
requirePattern(
  p0Reliability,
  /studyinchina\.p0-reliability-observations/,
  'The P0 reliability audit must consume an explicit observation document.',
)
requirePattern(
  p0Reliability,
  /backupMaxAgeHours:\s*26[\s\S]*releaseMaxAgeHours:\s*48[\s\S]*schedulerMaxAgeMinutes:\s*90[\s\S]*dlqMaxBacklogCount:\s*0[\s\S]*outboxMaxAgeHours:\s*168/,
  'The P0 reliability audit thresholds must remain fail-closed and reviewable.',
)
requirePattern(
  p0Reliability,
  /status:\s*'unobserved'[\s\S]*summary\.fail === 0 && summary\.unobserved === 0/,
  'Missing reliability observations must fail the overall audit.',
)
if (/\bfetch\s*\(|node:https|node:http|https?:\/\//u.test(p0Reliability)) {
  throw new Error('The P0 reliability evaluator must not contain a network access path.')
}
if (/process\.env/u.test(p0Reliability)) {
  throw new Error('The P0 reliability evaluator must not read environment secrets.')
}

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
  backup: 'daily-with-readback',
  restoreDrill: 'quarterly-protected',
  productionPromotion: 'exact-sha-ci-gated',
}, null, 2))
