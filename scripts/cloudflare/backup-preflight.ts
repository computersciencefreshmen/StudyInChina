import { createHash } from 'node:crypto'
import {
  lstatSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BACKUP_DATABASES = [
  'studyinchina-catalog',
  'studyinchina-pipeline',
] as const
export const BACKUP_BUCKET = 'studyinchina-releases'
export const BACKUP_CONFIGURATION_DOC =
  'docs/backup-and-restore.md#github-actions-configuration'
const BACKUP_FILES = ['catalog.sql.gz', 'pipeline.sql.gz'] as const

export type BackupArtifactReport = {
  file: (typeof BACKUP_FILES)[number]
  bytes: number
  sha256: string
}

export function validateBackupCredentials(
  environment: Readonly<Record<string, string | undefined>>,
): { databases: number; bucket: string } {
  const token = environment.CLOUDFLARE_API_TOKEN?.trim()
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (!token || !accountId) {
    const missing = [
      !token ? 'CLOUDFLARE_API_TOKEN' : undefined,
      !accountId ? 'CLOUDFLARE_ACCOUNT_ID' : undefined,
    ].filter((name): name is string => Boolean(name))
    throw new Error(
      `Missing required GitHub Actions repository secret(s): ${missing.join(', ')}. `
      + `Configure them before rerunning; see ${BACKUP_CONFIGURATION_DOC}. No backup was created.`,
    )
  }
  if (!/^[0-9a-f]{32}$/iu.test(accountId)) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal identifier. '
      + `See ${BACKUP_CONFIGURATION_DOC}. No backup was created.`,
    )
  }
  return { databases: BACKUP_DATABASES.length, bucket: BACKUP_BUCKET }
}

function escapeWorkflowCommand(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}

export function formatBackupPreflightError(
  error: unknown,
  githubActions = false,
): string {
  const detail = error instanceof Error ? error.message : String(error)
  const message = `Cloudflare D1 backup preflight failed: ${detail}`
  if (!githubActions) return `${message}\n`
  return `::error title=Cloudflare D1 backup preflight failed::${escapeWorkflowCommand(message)}\n${message}\n`
}

function checksum(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readChecksumManifest(path: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^([0-9a-f]{64})\s+\*?([^\\/]+)$/iu.exec(line)
    if (!match) throw new Error(`Invalid backup checksum line: ${line}`)
    const [, digest, file] = match
    if (!digest || !file || basename(file) !== file) {
      throw new Error('Backup checksum manifest contains an unsafe file name')
    }
    if (entries.has(file)) throw new Error(`Duplicate backup checksum entry: ${file}`)
    entries.set(file, digest.toLowerCase())
  }
  const expected = new Set<string>(BACKUP_FILES)
  if (entries.size !== expected.size || [...entries].some(([file]) => !expected.has(file))) {
    throw new Error('Backup checksum manifest must contain exactly catalog.sql.gz and pipeline.sql.gz')
  }
  return entries
}

export function inspectBackupArtifacts(directory: string): BackupArtifactReport[] {
  const root = resolve(directory)
  const manifestPath = resolve(root, 'backup-sha256.txt')
  if (lstatSync(manifestPath).isSymbolicLink()) {
    throw new Error('Backup checksum manifest must not be a symbolic link')
  }
  const expected = readChecksumManifest(manifestPath)

  return BACKUP_FILES.map((file) => {
    const path = resolve(root, file)
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Backup artifact must be a regular file: ${file}`)
    }
    const size = statSync(path).size
    if (size <= 2) throw new Error(`Backup artifact is empty: ${file}`)
    const header = readFileSync(path).subarray(0, 2)
    if (header[0] !== 0x1f || header[1] !== 0x8b) {
      throw new Error(`Backup artifact is not gzip data: ${file}`)
    }
    const sha256 = checksum(path)
    if (expected.get(file) !== sha256) {
      throw new Error(`Backup SHA-256 mismatch: ${file}`)
    }
    return { file, bytes: size, sha256 }
  })
}

function argument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url)
}

function main(): void {
  const args = process.argv.slice(2)
  const phase = argument(args, '--phase')
  if (phase === 'credentials') {
    const result = validateBackupCredentials(process.env)
    process.stdout.write(`${JSON.stringify({ ok: true, phase, ...result })}\n`)
    return
  }
  if (phase === 'artifacts') {
    const directory = argument(args, '--directory')
    if (!directory) throw new Error('--directory is required for artifact preflight')
    const artifacts = inspectBackupArtifacts(directory)
    process.stdout.write(`${JSON.stringify({ ok: true, phase, artifacts })}\n`)
    return
  }
  throw new Error('Use --phase credentials or --phase artifacts')
}

if (isMainModule()) {
  try {
    main()
  } catch (error) {
    process.stderr.write(formatBackupPreflightError(error, process.env.GITHUB_ACTIONS === 'true'))
    process.exitCode = 1
  }
}
