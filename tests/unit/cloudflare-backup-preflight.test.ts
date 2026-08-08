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
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: '78969c65bfdd892bb12c116869ea91cf',
    })
    expect(result).toEqual({ databases: 2, bucket: 'studyinchina-releases' })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(() => validateBackupCredentials({})).toThrow(
      /CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID/u,
    )
    expect(() => validateBackupCredentials({})).toThrow(BACKUP_CONFIGURATION_DOC)
    expect(() => validateBackupCredentials({
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: 'invalid',
    })).toThrow(/32-character hexadecimal/u)
  })

  it('formats an actionable GitHub error without exposing credential values', () => {
    const credentialValue = 'credential-value-that-must-stay-private'
    let failure: unknown
    try {
      validateBackupCredentials({ CLOUDFLARE_API_TOKEN: credentialValue })
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
    expect(credentialPreflight).toBeGreaterThan(0)
    expect(dependencyInstall).toBeGreaterThan(credentialPreflight)
    expect(remoteAccess).toBeGreaterThan(dependencyInstall)
    expect(exportStep).toBeGreaterThan(remoteAccess)
    expect(artifactPreflight).toBeGreaterThan(exportStep)
    expect(uploadStep).toBeGreaterThan(artifactPreflight)
    expect(workflow).toContain('if: ${{ failure() }}')
    expect(workflow).toContain('does **not** satisfy the 24-hour RPO')
  })
})
