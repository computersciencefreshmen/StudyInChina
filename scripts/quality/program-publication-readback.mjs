import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const origin = 'https://studyinchina.vercel.app'
const publicId = /^[a-z0-9][a-z0-9-]{0,199}$/
const revisionId = /^[a-f0-9]{64}$/

async function get(path, json = true) {
  const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`readback_http_${response.status}:${path}`)
  return json ? response.json() : response.text()
}

export async function verifyPublishedPrograms(expectedFeedRevision, read = get, now = () => new Date().toISOString()) {
  if (!revisionId.test(expectedFeedRevision)) throw new Error('invalid_expected_feed_revision')
  const [list, stats, home] = await Promise.all([read('/api/v1/programs?view=all'), read('/api/minimax/catalogue'), read('/en', false)])
  const { revision, total } = list.meta
  if (!revisionId.test(revision) || stats.feedRevision !== expectedFeedRevision || stats.revision !== revision || stats.publicPrograms !== total
    || !Number.isSafeInteger(total) || total < 1 || !home.includes(`data-program-revision="${revision}"`)
    || !home.includes(`data-public-program-count="${total}"`)) throw new Error('readback_version_or_total_mismatch')
  const first = list.data.find(row => typeof row.slug === 'string' && publicId.test(row.slug) && publicId.test(row.university?.slug || ''))
  if (!first) throw new Error('readback_has_no_bound_university_sample')
  const school = first.university.slug
  const [detail, html, scoped, schoolHtml] = await Promise.all([
    read(`/api/v1/programs/${first.slug}?view=all`), read(`/en/programs/${first.slug}`, false),
    read(`/api/v1/programs?view=all&institution=${school}`), read(`/en/universities/${school}`, false),
  ])
  if (detail.meta.revision !== revision || detail.meta.canonicalSlug !== first.slug || scoped.meta.revision !== revision || scoped.meta.total < 1
    || ![html, schoolHtml].every(page => page.includes(`data-program-revision="${revision}"`))
    || !schoolHtml.includes(`data-public-program-count="${scoped.meta.total}"`)) throw new Error('readback_detail_or_school_mismatch')
  return { verifiedAt: now(), revision, feedRevision: expectedFeedRevision, publicPrograms: total, sampledProgram: first.slug, sampledSchool: school }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifestPath, outputPath] = process.argv.slice(2)
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8')).publication?.revision
  for (let attempt = 1; ; attempt++) {
    try {
      const receipt = await verifyPublishedPrograms(expected)
      writeFileSync(outputPath, JSON.stringify(receipt) + '\n')
      console.log(JSON.stringify(receipt))
      break
    } catch (error) {
      if (attempt >= 8) throw error
      console.warn(`Public readback pending (${attempt}/8): ${error.message}`)
      await new Promise(done => setTimeout(done, 45_000))
    }
  }
}
