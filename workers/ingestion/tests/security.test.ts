import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSafeSourceUrl,
  fetchWithValidatedRedirects,
  validateManifest,
  isPotentiallyUnsafeRegex,
} from '../src/security'
import { sourceManifest } from './fixtures'

test('manifest permits only an exact official HTTPS host', () => {
  const manifest = validateManifest(sourceManifest())
  assert.equal(
    assertSafeSourceUrl(manifest.officialUrl, manifest.allowedHosts).hostname,
    'admissions.example.edu.cn',
  )
  assert.throws(
    () => assertSafeSourceUrl('https://evil.example/program', manifest.allowedHosts),
    /not allowlisted/,
  )
  assert.throws(
    () => assertSafeSourceUrl('http://admissions.example.edu.cn/program', manifest.allowedHosts),
    /Only HTTPS/,
  )
  assert.throws(
    () => assertSafeSourceUrl('https://127.0.0.1/program', ['127.0.0.1']),
    /Invalid allowed host|forbidden/,
  )
})

test('runtime manifest validation rejects catastrophic regular-expression shapes', () => {
  assert.equal(isPotentiallyUnsafeRegex('(a+)+$'), true)
  assert.equal(isPotentiallyUnsafeRegex('Deadline:\\s*(\\d{4}-\\d{2}-\\d{2})'), false)
  const manifest = sourceManifest()
  assert.throws(
    () => validateManifest({
      ...manifest,
      extraction: {
        ...manifest.extraction,
        rules: [{ kind: 'regex', fieldPath: 'deadline', pattern: '(a+)+$' }],
      },
    }),
    /safe subset/,
  )
})

test('manifest requires a valid institution id and source category', () => {
  assert.throws(
    () => validateManifest({ ...sourceManifest(), institutionId: '../unsafe' }),
    /institutionId/,
  )
  assert.throws(
    () => validateManifest({ ...sourceManifest(), sourceCategory: 'unknown' as never }),
    /sourceCategory/,
  )
})

test('critical fields cannot use a rules-only extraction path', () => {
  const manifest = sourceManifest()
  assert.throws(
    () => validateManifest({
      ...manifest,
      extraction: { ...manifest.extraction, mode: 'rules-only' },
    }),
    /critical fields require.*dual extraction/i,
  )
})

test('browser and document collection options are bounded by the shared manifest schema', () => {
  const browserManifest = sourceManifest({
    fetch: {
      timeoutMs: 10_000,
      maxBytes: 2_000_000,
      renderMode: 'browser',
      browserWaitUntil: 'networkidle2',
      browserWaitForSelector: '#official-catalog',
      documentConversion: 'auto',
    },
  })
  assert.equal(validateManifest(browserManifest).fetch.renderMode, 'browser')
  assert.throws(
    () => validateManifest(sourceManifest({
      fetch: { browserWaitForSelector: '#catalog' },
    })),
    /renderMode=browser/,
  )
  assert.throws(
    () => validateManifest(sourceManifest({
      fetch: { maxBytes: 10 * 1024 * 1024 + 1 },
    })),
    /manifest/i,
  )
})

test('validated fetch follows an allowlisted redirect manually', async () => {
  const manifest = validateManifest(sourceManifest())
  const calls: string[] = []
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://static.example.edu.cn/notices/current.html' },
      })
    }
    return new Response('official content', { status: 200 })
  }

  const result = await fetchWithValidatedRedirects(
    fetcher,
    new URL(manifest.officialUrl),
    manifest,
    { method: 'GET' },
  )
  assert.equal(result.response.status, 200)
  assert.equal(result.finalUrl.hostname, 'static.example.edu.cn')
  assert.equal(result.redirects.length, 1)
})

test('validated fetch rejects a redirect outside the manifest before requesting it', async () => {
  const manifest = validateManifest(sourceManifest())
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://localhost/admin' },
    })
  }

  await assert.rejects(
    fetchWithValidatedRedirects(
      fetcher,
      new URL(manifest.officialUrl),
      manifest,
      { method: 'GET' },
    ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'redirect_unsafe')
      assert.equal((error as { retryable?: boolean }).retryable, false)
      return true
    },
  )
  assert.equal(calls, 1)
})
