import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('official entity R2 synchronization', () => {
  it('keeps missing uploads and delayed verification in separate phases', () => {
    const script = readFileSync(
      join(process.cwd(), 'scripts', 'ingestion', 'import-official-entities.ps1'),
      'utf8',
    )
    const syncStart = script.indexOf('function Sync-R2')
    const syncEnd = script.indexOf('function Import-Transport')
    expect(syncStart).toBeGreaterThanOrEqual(0)
    expect(syncEnd).toBeGreaterThan(syncStart)
    const r2Block = script.slice(syncStart, syncEnd)

    const firstGet = r2Block.indexOf('"r2", "object", "get"')
    const appliedGuard = r2Block.indexOf('if ($Applied)')
    const put = r2Block.indexOf('"r2", "object", "put"')
    const queued = r2Block.indexOf('$pendingVerification +=')
    const emptyPendingReturn = r2Block.indexOf(
      'if ($pendingVerification.Count -eq 0) { return }',
    )
    const visibilityWait = r2Block.indexOf('Start-Sleep -Seconds 30')
    const verificationLoop = r2Block.indexOf(
      'foreach ($entry in $pendingVerification)',
    )
    const secondGet = r2Block.indexOf('"r2", "object", "get"', firstGet + 1)

    expect(firstGet).toBeGreaterThanOrEqual(0)
    expect(firstGet).toBeLessThan(appliedGuard)
    expect(appliedGuard).toBeLessThan(put)
    expect(put).toBeLessThan(queued)
    expect(queued).toBeLessThan(emptyPendingReturn)
    expect(emptyPendingReturn).toBeLessThan(visibilityWait)
    expect(visibilityWait).toBeLessThan(verificationLoop)
    expect(verificationLoop).toBeLessThan(secondGet)
    expect(r2Block.match(/"r2", "object", "get"/gu)).toHaveLength(2)
    expect(r2Block.match(/"r2", "object", "put"/gu)).toHaveLength(1)
    expect(r2Block.slice(appliedGuard, put)).toContain(
      'Applied batch is missing immutable R2 object',
    )

    const verificationPhase = r2Block.slice(verificationLoop)
    const verificationGet = verificationPhase.indexOf(
      '"r2", "object", "get"',
    )
    expect(verificationGet).toBeGreaterThanOrEqual(0)
    expect(verificationPhase.indexOf('Get-FileHash $entry.download')).toBeGreaterThan(
      verificationGet,
    )
    expect(verificationPhase.indexOf('$downloadFile.Length')).toBeGreaterThan(
      verificationGet,
    )
    expect(verificationPhase.indexOf('$entry.byteLength')).toBeGreaterThan(
      verificationGet,
    )
  })

  it('treats only the exact Wrangler missing-key response as recoverable', () => {
    const script = readFileSync(
      join(process.cwd(), 'scripts', 'ingestion', 'import-official-entities.ps1'),
      'utf8',
    )
    const r2Block = script.slice(
      script.indexOf('function Sync-R2'),
      script.indexOf('function Import-Transport'),
    )
    const exactMissingGuard =
      '-notmatch "(?i)The specified key does not exist[.]"'

    expect(r2Block.split(exactMissingGuard)).toHaveLength(3)
    expect(r2Block.match(/-notmatch/gu)).toHaveLength(2)
    expect(r2Block).toContain('$errorText = ($_ | Out-String)')
    expect(r2Block).toContain('$verifyErrorText = ($_ | Out-String)')
    expect(r2Block).not.toContain('NoSuchKey')
    expect(r2Block).not.toContain('404')
    expect(r2Block.toLowerCase()).not.toContain('not found')

    const verificationClassifier = r2Block.indexOf(
      '$verifyErrorText -notmatch',
    )
    const immediateThrow = r2Block.indexOf('throw', verificationClassifier)
    const retryDelay = r2Block.indexOf(
      'Start-Sleep -Seconds ([Math]::Min',
      verificationClassifier,
    )
    expect(verificationClassifier).toBeGreaterThanOrEqual(0)
    expect(immediateThrow).toBeGreaterThan(verificationClassifier)
    expect(immediateThrow).toBeLessThan(retryDelay)
  })
})
