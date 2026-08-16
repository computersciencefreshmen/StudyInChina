import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BACKUP_CONFIGURATION_DOC,
  formatBackupPreflightError,
  inspectBackupArtifacts,
  validateBackupCredentials,
  validateRestoreCredentials,
} from '../../scripts/cloudflare/backup-preflight'

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function backupFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'studyinchina-backup-preflight-'))
  const catalog = gzipSync('INSERT INTO catalog_releases VALUES (1);')
  const pipeline = gzipSync('INSERT INTO ingestion_jobs VALUES (1);')
  writeFileSync(join(directory, 'catalog.sql.gz'), catalog)
  writeFileSync(join(directory, 'pipeline.sql.gz'), pipeline)
  writeFileSync(
    join(directory, 'backup-sha256.txt'),
    `${digest(catalog)}  catalog.sql.gz\n${digest(pipeline)}  pipeline.sql.gz\n`,
  )
  return directory
}

describe('Cloudflare backup preflight', () => {
  it('validates credential presence without returning secret values', () => {
    const token = 'secret-token-that-must-not-be-printed'
    const result = validateBackupCredentials({
      CLOUDFLARE_D1_BACKUP_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: '78969c65bfdd892bb12c116869ea91cf',
    })
    expect(result).toEqual({ databases: 2, bucket: 'studyinchina-backups' })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(() => validateBackupCredentials({})).toThrow(
      /CLOUDFLARE_D1_BACKUP_TOKEN, CLOUDFLARE_ACCOUNT_ID/u,
    )
    expect(() => validateBackupCredentials({})).toThrow(BACKUP_CONFIGURATION_DOC)
    expect(() => validateBackupCredentials({
      CLOUDFLARE_D1_BACKUP_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: 'invalid',
    })).toThrow(/32-character hexadecimal/u)
  })

  it('requires a separate protected restore credential without exposing it', () => {
    const token = 'restore-token-that-must-not-be-printed'
    expect(validateRestoreCredentials({
      CLOUDFLARE_D1_RESTORE_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: '78969c65bfdd892bb12c116869ea91cf',
    })).toEqual({ bucket: 'studyinchina-backups' })
    expect(() => validateRestoreCredentials({})).toThrow(
      /CLOUDFLARE_D1_RESTORE_TOKEN, CLOUDFLARE_ACCOUNT_ID/u,
    )
  })

  it('formats an actionable GitHub error without exposing credential values', () => {
    const credentialValue = 'credential-value-that-must-stay-private'
    let failure: unknown
    try {
      validateBackupCredentials({ CLOUDFLARE_D1_BACKUP_TOKEN: credentialValue })
    } catch (error) {
      failure = error
    }
    const output = formatBackupPreflightError(failure, true)
    expect(output).toContain('::error title=Cloudflare D1 backup preflight failed::')
    expect(output).toContain('CLOUDFLARE_ACCOUNT_ID')
    expect(output).toContain(BACKUP_CONFIGURATION_DOC)
    expect(output).not.toContain(credentialValue)
  })

  it('cryptographically verifies both non-empty gzip artifacts', () => {
    const directory = backupFixture()
    const result = inspectBackupArtifacts(directory)
    expect(result.map(({ file }) => file)).toEqual(['catalog.sql.gz', 'pipeline.sql.gz'])
    expect(result.every(({ bytes, sha256 }) => bytes > 2 && sha256.length === 64)).toBe(true)

    writeFileSync(join(directory, 'catalog.sql.gz'), Buffer.from('not-gzip'))
    expect(() => inspectBackupArtifacts(directory)).toThrow(/not gzip data/u)
  })

  it('fails closed when an archive changes after checksum creation', () => {
    const directory = backupFixture()
    const path = join(directory, 'pipeline.sql.gz')
    const archive = readFileSync(path)
    archive[archive.length - 1] ^= 1
    writeFileSync(path, archive)
    expect(() => inspectBackupArtifacts(directory)).toThrow(/SHA-256 mismatch/u)
  })

  it('runs configuration and remote checks before export and verification before upload', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github', 'workflows', 'cloudflare-backup.yml'),
      'utf8',
    )
    const credentialPreflight = workflow.indexOf('--phase credentials')
    const dependencyInstall = workflow.indexOf('Install dependencies')
    const remoteAccess = workflow.indexOf('Verify read access to both remote D1 databases')
    const exportStep = workflow.indexOf('Export catalog and pipeline databases')
    const artifactPreflight = workflow.indexOf('--phase artifacts')
    const uploadStep = workflow.indexOf('Upload daily and monthly copies')
    const readbackStep = workflow.indexOf('Read back and cryptographically verify daily checkpoint')
    expect(credentialPreflight).toBeGreaterThan(0)
    expect(dependencyInstall).toBeGreaterThan(credentialPreflight)
    expect(remoteAccess).toBeGreaterThan(dependencyInstall)
    expect(exportStep).toBeGreaterThan(remoteAccess)
    expect(artifactPreflight).toBeGreaterThan(exportStep)
    expect(uploadStep).toBeGreaterThan(artifactPreflight)
    expect(readbackStep).toBeGreaterThan(uploadStep)
    const uploadBlock = workflow.slice(uploadStep, readbackStep)
    const readbackBlock = workflow.slice(readbackStep)
    expect(readbackBlock).toContain('--phase artifacts')
    expect(uploadBlock).toContain('studyinchina-backups/backups/daily/$day/raw-v1/catalog.sql.gz')
    expect(uploadBlock).toContain('studyinchina-backups/backups/daily/$day/raw-v1/pipeline.sql.gz')
    expect(uploadBlock).toContain('studyinchina-backups/backups/daily/$day/raw-v1/sha256.txt')
    expect(uploadBlock).toContain('studyinchina-backups/backups/monthly/$month/raw-v1/catalog.sql.gz')
    expect(uploadBlock).toContain('studyinchina-backups/backups/monthly/$month/raw-v1/pipeline.sql.gz')
    expect(uploadBlock).toContain('studyinchina-backups/backups/monthly/$month/raw-v1/sha256.txt')
    expect(readbackBlock).toContain('backups/daily/$day/raw-v1/catalog.sql.gz')
    expect(readbackBlock).toContain('backups/daily/$day/raw-v1/pipeline.sql.gz')
    expect(readbackBlock).toContain('backups/daily/$day/raw-v1/sha256.txt')
    expect(workflow.match(/--content-encoding="identity"/gu)).toHaveLength(4)
    expect(workflow).not.toContain('--content-encoding="gzip"')
    const retention = readFileSync(
      join(process.cwd(), 'scripts', 'cloudflare', 'configure-retention.ps1'),
      'utf8',
    )
    expect(retention).toContain("[string]$Bucket = 'studyinchina-backups'")
    expect(workflow).toContain('secrets.CLOUDFLARE_D1_BACKUP_TOKEN')
    expect(workflow).not.toContain('secrets.CLOUDFLARE_API_TOKEN')
    expect(workflow).toContain('if: ${{ failure() }}')
    expect(workflow).toContain('does **not** satisfy the 24-hour RPO')
  })

  it('protects restore access with a distinct environment credential', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github', 'workflows', 'cloudflare-restore-drill.yml'),
      'utf8',
    )
    expect(workflow).toContain('environment: cloudflare-restore-drill')
    expect(workflow).toContain('secrets.CLOUDFLARE_D1_RESTORE_TOKEN')
    expect(workflow).not.toContain('secrets.CLOUDFLARE_D1_BACKUP_TOKEN')
    expect(workflow).not.toContain('secrets.CLOUDFLARE_API_TOKEN')
    expect(workflow).toContain(
      'studyinchina-backups/backups/monthly/$BACKUP_MONTH/raw-v1/catalog.sql.gz',
    )
    expect(workflow).toContain('monthly/$BACKUP_MONTH/raw-v1/pipeline.sql.gz')
    expect(workflow).toContain('monthly/$BACKUP_MONTH/raw-v1/sha256.txt')
    const credentialGate = workflow.indexOf('--phase restore-credentials')
    const dependencyInstall = workflow.indexOf('Install dependencies')
    const download = workflow.indexOf('Download private monthly backup')
    const isolatedRestore = workflow.indexOf('Run local isolated restore drill')
    expect(credentialGate).toBeGreaterThan(-1)
    expect(dependencyInstall).toBeGreaterThan(credentialGate)
    expect(download).toBeGreaterThan(dependencyInstall)
    expect(isolatedRestore).toBeGreaterThan(download)
    expect(workflow.slice(isolatedRestore)).not.toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.',
    )
  })
})
