import assert from 'node:assert/strict'
import test from 'node:test'
import { isRobotsPathAllowed } from '../src/robots'
import { extractWithRules, htmlToText, readJsonPointer } from '../src/rules'
import { sourceManifest } from './fixtures'

test('robots policy selects the specific agent and longest matching rule', () => {
  const robots = `
User-agent: *
Disallow: /private

User-agent: StudyInChinaDataBot
Disallow: /notices
Allow: /notices/public
`
  assert.equal(
    isRobotsPathAllowed(
      robots,
      new URL('https://admissions.example.edu.cn/notices/public/2026'),
      'StudyInChinaDataBot/1.0',
    ),
    true,
  )
  assert.equal(
    isRobotsPathAllowed(
      robots,
      new URL('https://admissions.example.edu.cn/notices/internal'),
      'StudyInChinaDataBot/1.0',
    ),
    false,
  )
})

test('deterministic regex rules coerce dates and money', () => {
  const result = extractWithRules(
    sourceManifest(),
    'Application Deadline: 2026-09-01. Tuition: ￥30,000 per academic year.',
    'text/html',
  )
  assert.equal(result.complete, true)
  assert.deepEqual(
    result.facts.map(({ fieldPath, value }) => ({ fieldPath, value })),
    [
      { fieldPath: 'deadline', value: '2026-09-01' },
      { fieldPath: 'tuitionCny', value: 30_000 },
    ],
  )
})

test('JSON pointer and HTML text extraction need no third-party parser', () => {
  assert.equal(readJsonPointer({ cycle: { deadline: '2026-09-01' } }, '/cycle/deadline'), '2026-09-01')
  assert.equal(
    htmlToText('<style>ignore</style><p>Tuition&nbsp;30,000</p><script>ignore()</script>'),
    'Tuition 30,000',
  )
})
