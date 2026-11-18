import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPublishedPrograms } from './program-publication-readback.mjs'

const revision = 'a'.repeat(64), feedRevision = 'b'.repeat(64)
const timestamp = '2026-11-18T03:29:00Z'
const program = 'example-major', school = 'example-university'
const html = size => `<main data-program-revision="${revision}" data-public-program-count="${size}">`

function fixture() {
  return {
    '/api/v1/programs?view=all': { meta: { revision, total: 8 }, data: [{ slug: program, university: { slug: school } }] },
    '/api/minimax/catalogue': { revision, feedRevision, publicPrograms: 8 },
    '/en': html(8),
    [`/api/v1/programs/${program}?view=all`]: { meta: { revision, canonicalSlug: program } },
    [`/en/programs/${program}`]: html(1),
    [`/api/v1/programs?view=all&institution=${school}`]: { meta: { revision, total: 2 } },
    [`/en/universities/${school}`]: html(2),
  }
}
const verify = pages => verifyPublishedPrograms(feedRevision, path => pages[path], () => timestamp)

test('records an exact-version receipt for a linked major and university', async () => {
  assert.deepEqual(await verify(fixture()), {
    verifiedAt: timestamp, revision, feedRevision, publicPrograms: 8, sampledProgram: program, sampledSchool: school,
  })
})

test('rejects a stale home, a mismatched university count, or another detail', async () => {
  for (const [path, response] of [
    ['/en', html(7)],
    [`/en/universities/${school}`, html(3)],
    [`/api/v1/programs/${program}?view=all`, { meta: { revision, canonicalSlug: 'other-major' } }],
  ]) {
    await assert.rejects(verify({ ...fixture(), [path]: response }), /mismatch/)
  }
})

test('does not issue a receipt when the list only contains an unbound record', async () => {
  const pages = fixture()
  pages['/api/v1/programs?view=all'].data = [{ university: { slug: school } }]
  await assert.rejects(verify(pages), /no_bound_university_sample/)
})
