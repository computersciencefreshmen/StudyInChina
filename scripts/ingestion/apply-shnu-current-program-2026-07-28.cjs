const fs = require('node:fs')
const path = require('node:path')

const dataDir = path.join(process.cwd(), 'content', 'data')
const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
const write = (name, value) => fs.writeFileSync(
  path.join(dataDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8',
)
const upsert = (items, addition) => {
  const index = items.findIndex((item) => item.id === addition.id)
  if (index === -1) items.push(addition)
  else items[index] = addition
}

const sourceId = 'src-shnu-chinese-improvement-2026'
const programId = 'program-shanghai-normal-university-chinese-improvement-autumn-2026'
const programUrl = 'https://iccs.shnu.edu.cn/_upload/article/files/d0/5b/3d7b3bcc469db0d3f39939dc2a03/a925e215-f1e3-4ecd-b004-03583c75e6d5.pdf'

const sources = read('sources.json')
upsert(sources, {
  id: sourceId,
  url: programUrl,
  title: '2026 Chinese Language Improvement Class (Online and On-campus)',
  publisher: 'Shanghai Normal University',
  kind: 'program',
  language: 'en',
  official: true,
  accessedAt: '2026-07-28',
})

const programs = read('programs.json')
upsert(programs, {
  sourceIds: [sourceId],
  verifiedAt: '2026-07-28',
  reviewAfter: '2026-08-27',
  status: 'verified',
  id: programId,
  slug: 'shanghai-normal-university-chinese-improvement-autumn-2026',
  universityId: 'uni-shanghai-normal-university',
  name: {
    en: 'Chinese Language Improvement Class',
    zh: '汉语提高班',
    ru: 'Курс повышения уровня китайского языка',
  },
  degreeLevel: 'language',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  durationMonths: 4,
  programUrl,
  applyUrl: 'https://iccs.shnu.edu.cn/en/29459/list.htm',
  languageRequirements: [],
  verificationScope: 'facts',
})

const admissionCycles = read('admission-cycles.json')
upsert(admissionCycles, {
  sourceIds: [sourceId],
  verifiedAt: '2026-07-28',
  reviewAfter: '2026-08-04',
  status: 'verified',
  id: 'cycle-2026-shnu-chinese-improvement-autumn',
  programId,
  academicYear: '2026-2027',
  intake: 'autumn',
  opensOn: null,
  closesOn: '2026-08-31',
  dateStatus: 'published',
  tuitionCny: 6000,
  tuitionPeriod: 'program',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'cycle-specific',
  factScope: 'complete',
  applicationFeeCny: 450,
})

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)

console.log(JSON.stringify({
  sourceId,
  programId,
  closesOn: '2026-08-31',
}, null, 2))
