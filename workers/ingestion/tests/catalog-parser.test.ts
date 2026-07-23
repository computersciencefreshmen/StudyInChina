import assert from 'node:assert/strict'
import test from 'node:test'
import {
  inferDegreeLevel,
  parseOfficialCatalogHtml,
} from '../src/catalog-parser'

const baseOptions = {
  sourceUrl: 'https://admissions.example.edu.cn/catalog/index.html',
  allowedHosts: ['admissions.example.edu.cn', 'static.example.edu.cn'],
} as const

test('parses program table rows, resolves official HTTPS links, and infers degree levels conservatively', () => {
  const candidates = parseOfficialCatalogHtml(`
    <table>
      <tr><th>No.</th><th>Program</th><th>Link</th></tr>
      <tr>
        <td>1</td><td>Bachelor of Engineering in Computer Science</td>
        <td><a href="../programs/cs.html?lang=en&amp;cycle=2026#overview">Details</a></td>
      </tr>
      <tr>
        <td>2</td><td>Artificial Intelligence</td>
        <td><a href="https://static.example.edu.cn/programs/ai">View details</a></td>
      </tr>
    </table>
  `, {
    ...baseOptions,
    sourceCategory: 'undergraduate_catalog',
  })

  assert.equal(candidates.length, 2)
  assert.deepEqual(candidates[0], {
    kind: 'program',
    name: 'Bachelor of Engineering in Computer Science',
    degreeLevel: 'bachelor',
    anchorText: 'Details',
    officialUrl:
      'https://admissions.example.edu.cn/programs/cs.html?lang=en&cycle=2026',
    evidence: {
      quote: '1 Bachelor of Engineering in Computer Science Details',
      locator: 'html:table-row[2]/a[1]',
    },
  })
  assert.equal(candidates[1]?.name, 'Artificial Intelligence')
  assert.equal(candidates[1]?.degreeLevel, 'bachelor')
  assert.equal(candidates[1]?.officialUrl, 'https://static.example.edu.cn/programs/ai')
})

test('parses scholarship list links and deduplicates repeated heading links', () => {
  const candidates = parseOfficialCatalogHtml(`
    <ul>
      <li><a href="/funding/president?year=2026">University President Scholarship</a></li>
      <li><a href="https://evil.example/fake">Fake Scholarship</a></li>
      <li><a href="http://admissions.example.edu.cn/insecure">Insecure Scholarship</a></li>
      <li><a href="https://127.0.0.1/private">Private Scholarship</a></li>
    </ul>
    <h2><a href="/funding/president?year=2026#apply">University President Scholarship</a></h2>
  `, {
    ...baseOptions,
    sourceCategory: 'university_scholarship',
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.kind, 'scholarship')
  assert.equal(candidates[0]?.degreeLevel, null)
  assert.equal(candidates[0]?.anchorText, 'University President Scholarship')
  assert.equal(
    candidates[0]?.officialUrl,
    'https://admissions.example.edu.cn/funding/president?year=2026',
  )
  assert.equal(candidates[0]?.evidence.locator, 'html:list-item[1]/a[1]')
})

test('extracts signalled text-only headings, skips generic headings, and honors the candidate cap', () => {
  const candidates = parseOfficialCatalogHtml(`
    <h1>Programs</h1>
    <h2>PhD Program in Artificial Intelligence</h2>
    <h2>Master of Laws Program</h2>
    <h2>Foundation Program for International Students</h2>
  `, {
    ...baseOptions,
    expectedKind: 'program',
    maxCandidates: 2,
  })

  assert.deepEqual(
    candidates.map(({ name, degreeLevel, officialUrl }) => ({
      name,
      degreeLevel,
      officialUrl,
    })),
    [
      {
        name: 'PhD Program in Artificial Intelligence',
        degreeLevel: 'doctorate',
        officialUrl: 'https://admissions.example.edu.cn/catalog/index.html',
      },
      {
        name: 'Master of Laws Program',
        degreeLevel: 'master',
        officialUrl: 'https://admissions.example.edu.cn/catalog/index.html',
      },
    ],
  )
})

test('auto mode omits ambiguous entries and recognizes explicit program and scholarship signals', () => {
  const candidates = parseOfficialCatalogHtml(`
    <ul>
      <li><a href="/math">Mathematics</a></li>
      <li><a href="/exchange">International Exchange Program</a></li>
      <li><a href="/funding">Municipal Scholarship for International Students</a></li>
    </ul>
  `, {
    ...baseOptions,
    expectedKind: 'auto',
  })

  assert.deepEqual(candidates.map(({ kind, name }) => ({ kind, name })), [
    { kind: 'program', name: 'International Exchange Program' },
    { kind: 'scholarship', name: 'Municipal Scholarship for International Students' },
  ])
})

test('degree inference does not guess when degree signals conflict or language is only instructional', () => {
  assert.equal(inferDegreeLevel('Bachelor-Master joint pathway'), null)
  assert.equal(inferDegreeLevel('English Language of Instruction: English'), null)
  assert.equal(inferDegreeLevel('Chinese Language Training Program'), 'language')
  assert.equal(inferDegreeLevel('国际学生预科项目'), 'foundation')
})

test('rejects an unsafe source URL and invalid candidate limits before parsing', () => {
  assert.throws(
    () => parseOfficialCatalogHtml('<h2>PhD Program</h2>', {
      sourceUrl: 'https://localhost/catalog',
      allowedHosts: ['admissions.example.edu.cn'],
    }),
    /forbidden|allowlisted/i,
  )
  assert.throws(
    () => parseOfficialCatalogHtml('<h2>PhD Program</h2>', {
      ...baseOptions,
      maxCandidates: 2_001,
    }),
    /maxCandidates/,
  )
})

test('ignores nested Tsinghua-style navigation and only admits plain majors from an explicit major column', () => {
  const candidates = parseOfficialCatalogHtml(`
    <header class="site-header">
      <nav class="navbar-nav">
        <ul><li><a href="/admissions">Admissions</a><ul class="submenu">
          <li><a href="/masters">Master's Programs</a></li>
          <li><a href="/doctoral">PhD Programs</a></li>
          <li><a href="/funding">Scholarships</a></li>
        </ul></li></ul>
      </nav>
    </header>
    <div id="side-menu"><a href="/guide">Application Guide</a></div>
    <ul id="zsyx"><li><a href="/departments/024">Department of Computer Science</a></li></ul>
    <table>
      <tr><th>Department</th><th>Major Name</th><th>Official page</th></tr>
      <tr><td>Computer Science</td><td>Artificial Intelligence</td>
        <td><a href="/programs/artificial-intelligence">Details</a></td></tr>
    </table>
    <ul><li><a href="/programs/mathematics">Mathematics</a></li></ul>
  `, {
    ...baseOptions,
    sourceCategory: 'masters_catalog',
  })

  assert.deepEqual(candidates.map(({ name, kind, degreeLevel, officialUrl }) => ({
    name,
    kind,
    degreeLevel,
    officialUrl,
  })), [{
    name: 'Artificial Intelligence',
    kind: 'program',
    degreeLevel: 'master',
    officialUrl: 'https://admissions.example.edu.cn/programs/artificial-intelligence',
  }])
})

test('parses ZJU-style scholarship table rows but not funding directories or degree section headings', () => {
  const candidates = parseOfficialCatalogHtml(`
    <h2>Bachelor's Scholarships</h2>
    <h2>Master's Scholarships</h2>
    <ul class="funding-menu">
      <li><a href="/funding/catalog">Scholarship Programs</a></li>
      <li><a href="/funding/guide">Application Guide</a></li>
    </ul>
    <table class="funding-table">
      <tr><th>Scholarship Programs</th><th>Coverage</th><th>Official details</th></tr>
      <tr><td>Zhejiang University Scholarship for International Students</td>
        <td>Full tuition</td><td><a href="/funding/zju">Details</a></td></tr>
      <tr><td><a href="/funding/csc">Chinese Government Scholarship</a></td>
        <td>Full</td><td>See notice</td></tr>
      <tr><td>Silk Road Award</td><td>Partial</td>
        <td><a href="/funding/silk-road">View details</a></td></tr>
    </table>
  `, {
    ...baseOptions,
    sourceCategory: 'university_scholarship',
  })

  assert.deepEqual(candidates.map(({ name, kind }) => ({ name, kind })), [
    {
      name: 'Zhejiang University Scholarship for International Students',
      kind: 'scholarship',
    },
    { name: 'Chinese Government Scholarship', kind: 'scholarship' },
    { name: 'Silk Road Award', kind: 'scholarship' },
  ])
})

test('source categories never cross-classify opposite entity kinds', () => {
  const html = `
    <ul>
      <li><a href="/exchange">International Exchange Program</a></li>
      <li><a href="/funding">Municipal Scholarship for International Students</a></li>
    </ul>
  `
  const programCandidates = parseOfficialCatalogHtml(html, {
    ...baseOptions,
    sourceCategory: 'non_degree_catalog',
  })
  const scholarshipCandidates = parseOfficialCatalogHtml(html, {
    ...baseOptions,
    sourceCategory: 'university_scholarship',
  })

  assert.deepEqual(programCandidates.map(({ kind, name }) => ({ kind, name })), [
    { kind: 'program', name: 'International Exchange Program' },
  ])
  assert.deepEqual(scholarshipCandidates.map(({ kind, name }) => ({ kind, name })), [
    { kind: 'scholarship', name: 'Municipal Scholarship for International Students' },
  ])
})

test('does not admit a plain program name from a table without an entity header', () => {
  const candidates = parseOfficialCatalogHtml(`
    <table>
      <tr><th>School</th><th>Official page</th></tr>
      <tr><td>Artificial Intelligence</td><td><a href="/ai">Details</a></td></tr>
    </table>
  `, {
    ...baseOptions,
    sourceCategory: 'undergraduate_catalog',
  })

  assert.deepEqual(candidates, [])
})
