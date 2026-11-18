const SHA = /^[a-f0-9]{64}$/

export function providerEvidenceClient(env, fetcher = fetch) {
  const origin = new URL(env.CATALOG_MAINTENANCE_URL)
  if (origin.href !== 'https://studyinchina-catalog-maintenance.yanghanyu2023.workers.dev/'
    || !env.CATALOG_MAINTENANCE_TOKEN || /[\r\n]/u.test(env.CATALOG_MAINTENANCE_TOKEN)) throw new Error('provider_archive_configuration_invalid')
  async function request(path, options) {
    return fetcher(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(20_000), ...options,
      headers: { authorization: `Bearer ${env.CATALOG_MAINTENANCE_TOKEN}`, ...options.headers } })
  }
  return {
    async archive(body, hash, sourceUrl) {
      if (!SHA.test(hash)) throw new Error('provider_archive_hash_invalid')
      const response = await request(`/provider-evidence/sicas/${hash}`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-source-url': sourceUrl }, body })
      if (!response.ok) throw new Error('provider_archive_unavailable')
      const receipt = await response.json()
      if (receipt.stored !== true || receipt.sha256 !== hash || receipt.bytes !== body.length || receipt.sourceUrl !== sourceUrl) throw new Error('provider_archive_receipt_invalid')
    },
    async coverage() {
      const commit = env.GITHUB_SHA
      if (commit && !/^[a-f0-9]{40}$/u.test(commit)) throw new Error('provider_coverage_commit_invalid')
      const response = await request(commit ? '/coverage?deploymentSha=' + commit : '/coverage', { method: 'GET' })
      if (response.status === 503) return null
      if (!response.ok) throw new Error('provider_coverage_unavailable')
      return response.json()
    },
  }
}
