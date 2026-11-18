import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  local: { type: 'boolean' }, sha: { type: 'string' }, output: { type: 'string' },
} })
if (!values.output || (!values.local && !/^[a-f0-9]{40}$/.test(values.sha ?? ''))) {
  throw new Error('Supply --sha <expected production commit> --output <private receipt path>, or --local --output <path>.')
}
const origin = values.local ? 'http://127.0.0.1:3974' : 'https://studyinchina.vercel.app'
const batchPath = 'quality/maintenance/batches/coverage-pilot-20261118/'
const readJson = async path => JSON.parse(await readFile(new URL('../../' + path, import.meta.url), 'utf8'))
const [review, fieldLedger, programs, cycles, scholarships] = await Promise.all([
  readJson(batchPath + 'review.json'), readJson('content/data/field-verifications.json'),
  readJson('content/data/programs.json'), readJson('content/data/admission-cycles.json'), readJson('content/data/scholarships.json'),
])
const fields = fieldLedger.entries.filter(row => row.receiptPath === batchPath + 'field-receipt.json')
const award = scholarships.find(row => row.id === review.scholarship.recordId)
assert.equal(fields.length, 31)
assert.equal(award.programIds.length, 5)
const receipt = { origin, expectedSha: values.sha ?? null, startedAt: new Date().toISOString(), schools: [], scholarship: {}, requests: [] }

async function get(route, html = false) {
  const result = await fetch(origin + route, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(values.local ? 120_000 : 45_000) })
  const bytes = Buffer.from(await result.arrayBuffer())
  receipt.requests.push({ route, status: result.status, sha256: createHash('sha256').update(bytes).digest('hex') })
  assert.equal(result.status, 200, route)
  return html ? bytes.toString('utf8') : JSON.parse(bytes)
}

function pageTitle(html) {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]
  assert.ok(title?.includes('Study in China Atlas'), 'Missing public page title')
  return title
}

function verifyFields(record, html) {
  assert.ok(record?.id, 'Missing published record')
  return fields.filter(field => field.recordId === record.id).map(field => {
    const actual = field.fieldPath.split('.').reduce((obj, key) => obj?.[key], record)
    assert.deepEqual(actual, field.value, record.id + '.' + field.fieldPath)
    const meta = record.discovery?.fieldMeta?.[field.fieldPath] ?? record.fieldMeta?.[field.fieldPath]
    assert.equal(meta?.status, field.factStatus, record.id + '.' + field.fieldPath)
    assert.equal(meta?.officialUrl, field.sourceUrl, record.id + '.' + field.fieldPath + ' source')
    const loc = meta.location
    if (loc?.kind === 'text') {
      assert.equal(field.locator, 'normalized-' + (loc.unit === 'UTF-16' ? 'utf16' : 'code-points') + ':' + loc.start + ':' + loc.end)
      assert.ok(loc.excerpt && loc.excerpt.length <= 95)
    } else if (loc?.kind === 'html') assert.equal(loc.path, field.locator)
    else assert.fail('Pilot field has no usable exact public source position: ' + field.fieldPath)
    assert.ok(html.includes('data-field-evidence="' + record.id + ':' + field.fieldPath + '"'), 'Per-field evidence missing from HTML')
    assert.ok(html.includes('href="' + field.sourceUrl.replaceAll('&', '&amp;') + '"'), 'Source missing from HTML: ' + field.sourceUrl)
    return { field: field.fieldPath, source: meta.officialUrl, checkedAt: meta.checkedAt,
      locator: field.locator, snapshotSha256: field.snapshotSha256, valueSha256: field.valueSha256 }
  })
}

async function checkSchool(program) {
  const university = program.universityId.slice(4)
  const academicCycle = cycles.find(row => row.programId === program.id)
  const api = await get('/api/v1/programs/' + program.slug + '?view=all')
  const list = await get('/api/v1/programs?view=all&institution=' + university)
  const detail = await get('/en/programs/' + program.slug, true)
  const schoolPage = await get('/en/universities/' + university, true)
  assert.equal(api.data.id, program.id)
  assert.equal(api.data.university.slug, university)
  assert.equal(api.data.cycle?.id, academicCycle.id)
  assert.equal(api.data.degreeLevel, program.degreeLevel)
  assert.equal(api.data.cycle.academicYear, academicCycle.academicYear)
  assert.equal(api.data.cycle.intake, academicCycle.intake)
  assert.equal(api.data.cycle.teachingLanguage, academicCycle.teachingLanguage)
  assert.equal(api.meta.revision, list.meta.revision)
  assert.match(api.meta.revision, /^[a-f0-9]{64}$/)
  assert.ok(list.meta.total >= 1)
  assert.ok(list.data.some(row => row.id === program.id), 'Program missing from school listing: ' + university)
  assert.ok(schoolPage.includes('href="/en/programs/' + program.slug + '"'))
  assert.ok(schoolPage.includes('data-public-program-count="' + list.meta.total + '"'))
  for (const html of [detail, schoolPage]) assert.ok(html.includes('data-program-revision="' + list.meta.revision + '"'))
  return { university, program: program.slug, previousPrograms: review.baseline.counts[program.universityId],
    publicPrograms: list.meta.total, revision: list.meta.revision, schoolTitle: pageTitle(schoolPage), programTitle: pageTitle(detail),
    academicYear: api.data.cycle.academicYear, degree: api.data.degreeLevel, programFields: verifyFields(api.data, detail),
    cycleFields: verifyFields(api.data.cycle, detail) }
}

async function checkScholarship() {
  const html = await get('/en/scholarships/' + award.slug, true)
  const positives = [], negatives = [
    'program-xiamen-university-clinical-medicine-mbbs-bachelor-english',
    'program-xmu-long-term-chinese-language-spring-2027',
    ...Object.keys(review.programmeEvidence),
  ]
  let published
  for (const id of [...award.programIds, ...negatives]) {
    const response = await get('/api/v1/directory/scholarships?limit=100&program=' + id)
    const found = response.data.find(row => row.id === award.id)
    assert.equal(Boolean(found), award.programIds.includes(id), 'Wrong scholarship scope for ' + id)
    if (found) { positives.push(id); published = found }
  }
  assert.deepEqual([...published.programIds].sort(), [...award.programIds].sort())
  return { slug: award.slug, pageTitle: pageTitle(html), positiveFilters: positives, negativeFilters: negatives, fields: verifyFields(published, html) }
}

try {
  const start = (await get('/api/v1/releases/current')).data.deploymentSha
  receipt.deploymentSha = start
  if (values.sha) assert.equal(start, values.sha, 'Deployment SHA has not reached target')
  for (const id of Object.keys(review.programmeEvidence)) receipt.schools.push(await checkSchool(programs.find(row => row.id === id)))
  receipt.scholarship = await checkScholarship()
  assert.equal(new Set(receipt.schools.map(row => row.revision)).size, 1, 'Programme feed changed during readback; rerun against one version')
  const verifiedFields = receipt.schools.reduce((count, row) => count + row.programFields.length + row.cycleFields.length, receipt.scholarship.fields.length)
  assert.equal(verifiedFields, 31)
  assert.equal((await get('/api/v1/releases/current')).data.deploymentSha, start, 'Deployment changed during readback')
  Object.assign(receipt, { passed: true, verifiedFields })
} catch (error) {
  Object.assign(receipt, { passed: false, error: error.message })
  process.exitCode = 1
} finally {
  receipt.finishedAt = new Date().toISOString()
  await writeFile(values.output, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ passed: receipt.passed, deploymentSha: receipt.deploymentSha, fields: receipt.verifiedFields,
    schools: receipt.schools.map(school => [school.university, school.publicPrograms]), error: receipt.error }))
}

