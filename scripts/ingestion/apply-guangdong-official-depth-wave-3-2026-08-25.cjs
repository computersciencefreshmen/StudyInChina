const fs = require('node:fs')
const path = require('node:path')

const dataDir = process.env.STUDYINCHINA_DATA_DIR
  ? path.resolve(process.env.STUDYINCHINA_DATA_DIR)
  : path.join(process.cwd(), 'content', 'data')
const ledgerPath = process.env.STUDYINCHINA_GUANGDONG_LEDGER_PATH
  ? path.resolve(process.env.STUDYINCHINA_GUANGDONG_LEDGER_PATH)
  : path.join(
    process.cwd(),
    'quality',
    'official-depth-wave-3-2026-08-25',
    'guangdong-fact-ledger.json',
  )
const checkedAt = '2026-08-25'
const reviewAfter = '2026-09-24'
const upcomingReviewAfter = '2026-09-01'
const evidenceLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
const confirmedSourceIds = new Set(
  evidenceLedger.sources
    .filter((source) => (
      source.snapshotStatus === 'confirmed_private_r2_readback'
        && source.snapshotAudit?.confirmation === 'confirmed'
    ))
    .map((source) => source.sourceId),
)
const dependencyGate = {
  programsUpdated: 0,
  programsBlocked: 0,
  cyclesUpdated: 0,
  cyclesBlocked: 0,
  scholarshipsUpdated: 0,
  scholarshipsBlocked: 0,
}

const hasConfirmedSourceDependency = (sourceIds) => (
  Array.isArray(sourceIds)
    && sourceIds.some((sourceId) => confirmedSourceIds.has(sourceId))
)

const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
const write = (name, value) => fs.writeFileSync(
  path.join(dataDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8',
)
const unique = (values) => [...new Set(values)]
const localized = (en, zh) => ({ en, zh })

function upsertById(items, addition) {
  const index = items.findIndex((item) => item.id === addition.id)
  if (index === -1) items.push(addition)
  else items[index] = addition
}

function upsertCycleByKey(items, addition) {
  const index = items.findIndex((item) => (
    item.programId === addition.programId
      && item.academicYear === addition.academicYear
      && item.intake === addition.intake
  ))
  if (!hasConfirmedSourceDependency(addition.sourceIds)) {
    if (index !== -1 && items[index].status === 'verified') {
      items[index] = { ...items[index], status: 'stale', reviewAfter: checkedAt }
    }
    dependencyGate.cyclesBlocked += 1
    return
  }
  dependencyGate.cyclesUpdated += 1
  if (index === -1) {
    upsertById(items, addition)
    return
  }

  const existing = items[index]
  const duplicateIdIndex = items.findIndex((item) => item.id === addition.id)
  if (duplicateIdIndex !== -1 && duplicateIdIndex !== index) {
    throw new Error(`Cycle ID ${addition.id} already belongs to another cycle key`)
  }
  items[index] = { ...addition, id: existing.id }
}

const sourceSpecs = [
  {
    id: 'source-szu-2026-bachelor-guide',
    url: 'https://lxs.szu.edu.cn/info/1277/5807.htm',
    title: '2026 SZU Admission Brochure for Bachelor Programs of International Students',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'src-szu-2026-international-undergraduate-catalog',
    url: 'https://lxs.szu.edu.cn/info/1277/5767.htm',
    title: '2026 Shenzhen University International Undergraduate Program Catalog',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-szu-2026-master-guide',
    url: 'https://lxs.szu.edu.cn/info/1278/5817.htm',
    title: '2026 SZU Admission Brochure for Master Programs of International Students',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'src-szu-2026-international-master-catalog',
    url: 'https://lxs.szu.edu.cn/info/1278/5777.htm',
    title: '2026 Shenzhen University International Master Program Catalog',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-szu-2026-doctoral-guide',
    url: 'https://lxs.szu.edu.cn/info/1279/5837.htm',
    title: '2026 SZU Admission Brochure for Doctoral Programs of International Students',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'src-szu-2026-international-doctoral-catalog',
    url: 'https://lxs.szu.edu.cn/info/1279/5787.htm',
    title: '2026 Shenzhen University International Doctoral Program Catalog',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-szu-2026-autumn-chinese-language',
    url: 'https://lxs.szu.edu.cn/info/1253/7227.htm',
    title: 'Shenzhen University 2026 Autumn Long-term Chinese Language Course',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-szu-2026-autumn-chinese-language-supplement',
    url: 'https://lxs.szu.edu.cn/info/1169/7717.htm',
    title: 'Shenzhen University 2026 Autumn Chinese Language Course Supplementary Application Notice',
    publisher: 'Shenzhen University',
    kind: 'admissions',
    language: 'zh',
  },
  {
    id: 'source-szu-iclt-nondegree-2026-2027',
    url: 'https://lxs.szu.edu.cn/info/1169/6947.htm',
    title: 'Shenzhen University International Chinese Language Teachers Scholarship Non-degree Guide',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-szu-iclt-degree-2026',
    url: 'https://lxs.szu.edu.cn/info/1278/6757.htm',
    title: 'Shenzhen University 2026 International Chinese Language Teachers Scholarship Degree Guide',
    publisher: 'Shenzhen University',
    kind: 'scholarship',
    language: 'zh',
  },
  {
    id: 'src-jnu-2026-international-undergraduate-admissions',
    url: 'https://zsb.jnu.edu.cn/2026/0113/c40322a849403/page.htm',
    title: 'Jinan University Application Guide for International Students 2026',
    publisher: 'Jinan University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-jnu-official-application-portal',
    url: 'https://lxlz.jnu.edu.cn/',
    title: 'Jinan University International Student Application Portal',
    publisher: 'Jinan University',
    kind: 'admissions',
    language: 'zh',
  },
  {
    id: 'source-gdpu-international-program-disciplines',
    url: 'https://www.gdpu.edu.cn/zsyjy/gjxszs.htm',
    title: 'Guangdong Pharmaceutical University Programs Open to International Students',
    publisher: 'Guangdong Pharmaceutical University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-gdpu-2026-postgraduate-guide',
    url: 'https://sie.gdpu.edu.cn/info/1038/1493.htm',
    title: '2026 Prospectuses of Postgraduate Study for International Students at Guangdong Pharmaceutical University',
    publisher: 'Guangdong Pharmaceutical University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-gdpu-2026-guangdong-government-scholarship',
    url: 'https://sie.gdpu.edu.cn/info/1038/1347.htm',
    title: '2026 Guangdong Government Outstanding International Student Scholarship at GDPU',
    publisher: 'Guangdong Pharmaceutical University',
    kind: 'scholarship',
    language: 'en',
  },
  {
    id: 'source-gdufe-2026-master-guide-page',
    url: 'https://fao.gdufe.edu.cn/2026/0228/c9112a233410/page.htm',
    title: 'GDUFE 2026 Full-time Master Programs for International Students',
    publisher: 'Guangdong University of Finance and Economics',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-gdufe-2026-master-guide-pdf',
    url: 'https://fao.gdufe.edu.cn/_upload/article/files/bb/2a/1eb4c95143938ad1a6638dfb95b5/e02fe841-461f-438c-9bb4-fd598a4670ff.pdf',
    title: 'GDUFE 2026 Full-time Master Program Guide PDF',
    publisher: 'Guangdong University of Finance and Economics',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-gdufe-2026-doctoral-guide-page',
    url: 'https://fao.gdufe.edu.cn/2026/0228/c9112a233411/page.htm',
    title: 'GDUFE 2026 Full-time Doctoral Programs for International Students',
    publisher: 'Guangdong University of Finance and Economics',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-gdufe-2026-doctoral-guide-pdf',
    url: 'https://fao.gdufe.edu.cn/_upload/article/files/5f/04/4e9d0b444938999b5db3681746f1/c24295a5-32cf-4585-abb3-7cffaa025d2c.pdf',
    title: 'GDUFE 2026 Full-time Doctoral Program Guide PDF',
    publisher: 'Guangdong University of Finance and Economics',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-gdufe-official-application-portal',
    url: 'https://gdufe.at0086.cn/StuApplication/Login.aspx',
    title: 'GDUFE International Student Application Portal',
    publisher: 'Guangdong University of Finance and Economics',
    kind: 'admissions',
    language: 'en',
  },
].map((source) => ({ ...source, official: true, accessedAt: checkedAt }))

let sources = read('sources.json')
const programs = read('programs.json')
const admissionCycles = read('admission-cycles.json')
const scholarships = read('scholarships.json')

for (const source of sourceSpecs) upsertById(sources, source)

function refreshProgram(id, expectedUniversityId, changes) {
  const current = programs.find((item) => item.id === id)
  if (!current) throw new Error(`Missing program: ${id}`)
  if (current.universityId !== expectedUniversityId) {
    throw new Error(`Unexpected university on ${id}: ${current.universityId}`)
  }
  if (!hasConfirmedSourceDependency(changes.sourceIds)) {
    if (current.status === 'verified') {
      upsertById(programs, { ...current, status: 'stale', reviewAfter: checkedAt })
    }
    dependencyGate.programsBlocked += 1
    return
  }
  dependencyGate.programsUpdated += 1
  upsertById(programs, {
    ...current,
    ...changes,
    id: current.id,
    slug: current.slug,
    universityId: current.universityId,
    sourceIds: unique(changes.sourceIds),
    verifiedAt: checkedAt,
    reviewAfter: changes.reviewAfter ?? reviewAfter,
    status: 'verified',
  })
}

function upsertScholarshipWithGate(items, addition) {
  if (!hasConfirmedSourceDependency(addition.sourceIds)) {
    const current = items.find((item) => item.id === addition.id)
    if (current?.status === 'verified') {
      upsertById(items, { ...current, status: 'stale', reviewAfter: checkedAt })
    }
    dependencyGate.scholarshipsBlocked += 1
    return
  }
  dependencyGate.scholarshipsUpdated += 1
  upsertById(items, addition)
}

const SZU = 'uni-shenzhen-university'
const JNU = 'uni-jinan-university'
const GDPU = 'uni-guangdong-pharmaceutical-university'
const GDUFE = 'uni-guangdong-university-of-finance-and-economics'

const szuBachelorGuide = 'source-szu-2026-bachelor-guide'
const szuBachelorCatalog = 'src-szu-2026-international-undergraduate-catalog'
const szuMasterGuide = 'source-szu-2026-master-guide'
const szuMasterCatalog = 'src-szu-2026-international-master-catalog'
const szuDoctoralGuide = 'source-szu-2026-doctoral-guide'
const szuDoctoralCatalog = 'src-szu-2026-international-doctoral-catalog'
const szuBachelorPortal = 'https://status.szu.edu.cn/szulxs/html/vue/stuBm.html?fxq=2026-09&lxslbm=02'
const szuMasterPortal = 'https://status.szu.edu.cn/szulxs/html/vue/stuBm.html?fxq=2026-09&lxslbm=07'
const szuDoctoralPortal = 'https://status.szu.edu.cn/szulxs/html/vue/stuBm.html?fxq=2026-09&lxslbm=10'
const szuLanguagePortal = 'https://status.szu.edu.cn/szulxs/html/vue/stuBm.html?fxq=2026-09&lxslbm=01'
const szuIcltPortal = 'https://status.szu.edu.cn/szulxs/stuzs/stuLogin.action?fpage_id=216'
const jnuGuide = 'src-jnu-2026-international-undergraduate-admissions'
const jnuPortal = 'https://lxlz.jnu.edu.cn/'
const gdufePortal = 'https://gdufe.at0086.cn/StuApplication/Login.aspx'

const hsk4Science = [{ test: 'HSK', minimum: 'Level 4, score 180' }]
const hsk5Humanities = [{ test: 'HSK', minimum: 'Level 5, score 180' }]
const szuEnglishBachelorRequirements = [
  { test: 'IELTS', minimum: '5.5' },
  { test: 'TOEFL', minimum: '80 (iBT)' },
  { test: 'other', minimum: 'Duolingo English Test 100' },
]
const szuEnglishGraduateRequirements = [
  { test: 'other', minimum: 'Official English-proficiency proof for applicants whose native or prior degree language is not English' },
]
const noSzuBachelorHsk = [
  { test: 'other', minimum: 'No HSK certificate required for this major under the 2026 international bachelor guide' },
]

const szuProgramSpecs = [
  {
    id: 'program-shenzhen-university-computer-science-bachelor',
    programUrl: sourceSpecs.find((item) => item.id === szuBachelorCatalog).url,
    applyUrl: szuBachelorPortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    languageRequirements: hsk4Science,
    sourceIds: [szuBachelorCatalog, szuBachelorGuide],
  },
  {
    id: 'program-shenzhen-university-design-master',
    programUrl: sourceSpecs.find((item) => item.id === szuMasterCatalog).url,
    applyUrl: szuMasterPortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 36,
    languageRequirements: hsk5Humanities,
    sourceIds: [szuMasterCatalog, szuMasterGuide],
  },
  {
    id: 'program-shenzhen-university-chinese-language-program-language',
    programUrl: 'https://lxs.szu.edu.cn/info/1253/7227.htm',
    applyUrl: szuLanguagePortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 5,
    languageRequirements: [
      { test: 'other', minimum: 'Foreign passport holder, age 18–60, in good health and good conduct' },
    ],
    sourceIds: [
      'source-szu-2026-autumn-chinese-language',
      'source-szu-2026-autumn-chinese-language-supplement',
    ],
  },
  {
    id: 'program-shenzhen-university-iclt-one-semester-language',
    programUrl: 'https://lxs.szu.edu.cn/info/1169/6947.htm',
    applyUrl: szuIcltPortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 5,
    languageRequirements: [
      { test: 'HSK', minimum: 'Level 3, score 180' },
      { test: 'other', minimum: 'HSKK score report required' },
    ],
    sourceIds: ['source-szu-iclt-nondegree-2026-2027'],
    reviewAfter: upcomingReviewAfter,
  },
  ...[
    'program-shenzhen-university-international-business-administration-bachelor',
    'program-shenzhen-university-international-economics-and-trade-bachelor',
    'program-shenzhen-university-financial-technology-webank-asean-class-bachelor',
  ].map((id) => ({
    id,
    programUrl: sourceSpecs.find((item) => item.id === szuBachelorCatalog).url,
    applyUrl: szuBachelorPortal,
    teachingLanguages: ['English'],
    durationMonths: 48,
    languageRequirements: szuEnglishBachelorRequirements,
    sourceIds: [szuBachelorCatalog, szuBachelorGuide],
  })),
  ...[
    'program-shenzhen-university-foreign-languages-and-literature-master',
    'program-shenzhen-university-area-studies-master',
  ].map((id) => ({
    id,
    programUrl: sourceSpecs.find((item) => item.id === szuMasterCatalog).url,
    applyUrl: szuMasterPortal,
    teachingLanguages: ['English'],
    durationMonths: 24,
    languageRequirements: szuEnglishGraduateRequirements,
    sourceIds: [szuMasterCatalog, szuMasterGuide],
  })),
  {
    id: 'program-shenzhen-university-civil-engineering-master',
    programUrl: sourceSpecs.find((item) => item.id === szuMasterCatalog).url,
    applyUrl: szuMasterPortal,
    teachingLanguages: ['English'],
    durationMonths: 36,
    languageRequirements: szuEnglishGraduateRequirements,
    sourceIds: [szuMasterCatalog, szuMasterGuide],
  },
  ...[
    ['program-shenzhen-university-journalism-and-communication-doctorate', 'humanities'],
    ['program-shenzhen-university-chemistry-doctorate', 'science'],
    ['program-shenzhen-university-biology-doctorate', 'science'],
    ['program-shenzhen-university-basic-medicine-doctorate', 'medicine'],
  ].map(([id]) => ({
    id,
    programUrl: sourceSpecs.find((item) => item.id === szuDoctoralCatalog).url,
    applyUrl: szuDoctoralPortal,
    teachingLanguages: ['English'],
    durationMonths: 48,
    languageRequirements: szuEnglishGraduateRequirements,
    sourceIds: [szuDoctoralCatalog, szuDoctoralGuide],
  })),
  {
    id: 'prog-gap-prog-szu-chinese-language-literature-bachelor-2026',
    programUrl: sourceSpecs.find((item) => item.id === szuBachelorCatalog).url,
    applyUrl: szuBachelorPortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    languageRequirements: noSzuBachelorHsk,
    sourceIds: [szuBachelorCatalog, szuBachelorGuide],
  },
  {
    id: 'prog-gap-clw-sw-szu-icl-master',
    programUrl: sourceSpecs.find((item) => item.id === szuMasterCatalog).url,
    applyUrl: szuMasterPortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 24,
    languageRequirements: hsk5Humanities,
    sourceIds: [szuMasterCatalog, szuMasterGuide],
  },
  {
    id: 'prog-gap-prog-szu-tcsol-bachelor-2026',
    programUrl: sourceSpecs.find((item) => item.id === szuBachelorCatalog).url,
    applyUrl: szuBachelorPortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    languageRequirements: noSzuBachelorHsk,
    sourceIds: [szuBachelorCatalog, szuBachelorGuide],
  },
]

for (const spec of szuProgramSpecs) {
  refreshProgram(spec.id, SZU, { ...spec, verificationScope: 'facts' })
}

const jnuEnglishRequirements = [
  { test: 'IELTS', minimum: '5.5 overall, with each component at least 5.0' },
  { test: 'TOEFL', minimum: '80 (iBT)' },
  { test: 'other', minimum: 'SAT total score 1030 accepted by the 2026 guide' },
]
const jnuChineseRequirements = [{ test: 'HSK', minimum: 'Level 5, score 180' }]
const jnuEnglishPrograms = [
  ['program-jinan-university-international-economics-and-trade-bachelor', 48],
  ['program-jinan-university-computer-science-and-technology-bachelor', 48],
  ['program-jinan-university-accounting-bachelor', 48],
  ['program-jinan-university-finance-bachelor', 48],
  ['program-jinan-university-pharmacy-bachelor', 48],
  ['program-jinan-university-international-journalism-and-communication-bachelor', 48],
  ['program-jinan-university-food-nutrition-and-health-bachelor', 48],
  ['program-jinan-university-clinical-medicine-bachelor', 72],
]
const jnuChinesePrograms = [
  'prog-gap-clw-sw-jnu-chinese-language-bachelor',
  'prog-gap-clw-sw-jnu-chinese-culture-education-bachelor',
  'prog-gap-clw-sw-jnu-tcsol-bachelor',
]

for (const [id, durationMonths] of jnuEnglishPrograms) {
  refreshProgram(id, JNU, {
    programUrl: sourceSpecs.find((item) => item.id === jnuGuide).url,
    applyUrl: jnuPortal,
    teachingLanguages: ['English'],
    durationMonths,
    languageRequirements: jnuEnglishRequirements,
    verificationScope: 'facts',
    sourceIds: [jnuGuide, 'source-jnu-official-application-portal'],
  })
}
for (const id of jnuChinesePrograms) {
  refreshProgram(id, JNU, {
    programUrl: sourceSpecs.find((item) => item.id === jnuGuide).url,
    applyUrl: jnuPortal,
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    languageRequirements: jnuChineseRequirements,
    verificationScope: 'facts',
    sourceIds: [jnuGuide, 'source-jnu-official-application-portal'],
  })
}

const gdpuProgramIds = [
  'prog-gap-mew-0805-scw-gdpu-basic-medicine-master',
  'prog-gap-mew-0805-scw-gdpu-bioengineering-master',
  'prog-gap-mew-0805-scw-gdpu-integrated-medicine-master',
  'prog-gap-mew-0805-scw-gdpu-pharmacy-academic-master',
  'prog-gap-mew-0805-scw-gdpu-public-health-preventive-master',
]
const gdpuLanguageRequirements = [
  { test: 'IELTS', minimum: 'Academic 6.0 overall, with each component at least 5.5, for applicants from non-English-speaking countries' },
  { test: 'other', minimum: 'Equivalent English certificate, English-medium prior degree, or university online interview accepted' },
]
for (const id of gdpuProgramIds) {
  refreshProgram(id, GDPU, {
    programUrl: 'https://sie.gdpu.edu.cn/info/1038/1493.htm',
    applyUrl: null,
    teachingLanguages: [],
    durationMonths: 36,
    languageRequirements: gdpuLanguageRequirements,
    verificationScope: 'facts',
    sourceIds: [
      'source-gdpu-international-program-disciplines',
      'source-gdpu-2026-postgraduate-guide',
    ],
  })
}

const gdufeEnglishRequirements = [
  { test: 'IELTS', minimum: '6.0' },
  { test: 'TOEFL', minimum: '80 (iBT)' },
  { test: 'other', minimum: 'Duolingo English Test 112 or an officially accepted equivalent' },
]
const gdufeMasterPage = 'source-gdufe-2026-master-guide-page'
const gdufeMasterPdf = 'source-gdufe-2026-master-guide-pdf'
for (const [id, durationMonths] of [
  ['prog-gap-mew-csw-gdufe-digital-economy-master', 24],
  ['prog-gap-mew-csw-gdufe-international-trade-master', 36],
]) {
  refreshProgram(id, GDUFE, {
    programUrl: sourceSpecs.find((item) => item.id === gdufeMasterPage).url,
    applyUrl: gdufePortal,
    teachingLanguages: ['English'],
    durationMonths,
    languageRequirements: gdufeEnglishRequirements,
    verificationScope: 'facts',
    sourceIds: [gdufeMasterPage, gdufeMasterPdf, 'source-gdufe-official-application-portal'],
  })
}
refreshProgram('prog-gap-mew-csw-gdufe-international-chinese-education-master', GDUFE, {
  programUrl: sourceSpecs.find((item) => item.id === gdufeMasterPage).url,
  applyUrl: gdufePortal,
  teachingLanguages: ['Chinese'],
  durationMonths: 36,
  languageRequirements: [{ test: 'HSK', minimum: 'Level 5, score 180' }],
  verificationScope: 'facts',
  sourceIds: [gdufeMasterPage, gdufeMasterPdf, 'source-gdufe-official-application-portal'],
})
refreshProgram('prog-gap-mew-csw-gdufe-international-trade-doctorate', GDUFE, {
  programUrl: 'https://fao.gdufe.edu.cn/2026/0228/c9112a233411/page.htm',
  applyUrl: gdufePortal,
  teachingLanguages: ['Chinese'],
  durationMonths: 48,
  durationMonthsMax: 84,
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 5, score 180, or an accepted prior Chinese-medium degree' },
  ],
  verificationScope: 'facts',
  sourceIds: [
    'source-gdufe-2026-doctoral-guide-page',
    'source-gdufe-2026-doctoral-guide-pdf',
    'source-gdufe-official-application-portal',
  ],
})

function historicalCycle({
  id,
  programId,
  opensOn = null,
  closesOn,
  tuitionCny,
  tuitionPeriod = tuitionCny === null ? null : 'academic-year',
  applicationFeeCny,
  sourceIds,
  notes,
}) {
  return {
    id,
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn,
    closesOn,
    dateStatus: 'previous-cycle-reference',
    tuitionCny,
    tuitionPeriod,
    // A closed 2026 round remains useful evidence, but its fee must never be
    // counted as a current confirmed fee for a later intake.
    tuitionStatus: tuitionCny === null ? null : 'reference',
    evidenceBasis: 'cycle-specific',
    factScope: tuitionCny === null || applicationFeeCny === null ? 'dates-only' : 'complete',
    applicationFeeCny,
    notes,
    sourceIds: unique(sourceIds),
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  }
}

const szuClosedNotes = localized(
  'The official 2026 application round is closed. Tuition and the application fee are retained only as 2026–2027 historical facts; no 2027 degree dates or fees are inferred.',
  '2026年官方申请轮次已截止。学费和申请费仅作为2026—2027学年历史事实保留，不推定2027年学历项目日期或费用。',
)
const szuCycleFacts = [
  ['program-shenzhen-university-computer-science-bachelor', 30000, szuBachelorGuide, szuBachelorCatalog],
  ['program-shenzhen-university-design-master', 45000, szuMasterGuide, szuMasterCatalog],
  ['program-shenzhen-university-international-business-administration-bachelor', 26000, szuBachelorGuide, szuBachelorCatalog],
  ['program-shenzhen-university-international-economics-and-trade-bachelor', 26000, szuBachelorGuide, szuBachelorCatalog],
  ['program-shenzhen-university-financial-technology-webank-asean-class-bachelor', 26000, szuBachelorGuide, szuBachelorCatalog],
  ['program-shenzhen-university-foreign-languages-and-literature-master', 30000, szuMasterGuide, szuMasterCatalog],
  ['program-shenzhen-university-area-studies-master', 30000, szuMasterGuide, szuMasterCatalog],
  ['program-shenzhen-university-civil-engineering-master', 35000, szuMasterGuide, szuMasterCatalog],
  ['program-shenzhen-university-journalism-and-communication-doctorate', 34000, szuDoctoralGuide, szuDoctoralCatalog],
  ['program-shenzhen-university-chemistry-doctorate', 40000, szuDoctoralGuide, szuDoctoralCatalog],
  ['program-shenzhen-university-biology-doctorate', 40000, szuDoctoralGuide, szuDoctoralCatalog],
  ['program-shenzhen-university-basic-medicine-doctorate', 52000, szuDoctoralGuide, szuDoctoralCatalog],
  ['prog-gap-prog-szu-chinese-language-literature-bachelor-2026', 26000, szuBachelorGuide, szuBachelorCatalog],
  ['prog-gap-clw-sw-szu-icl-master', 30000, szuMasterGuide, szuMasterCatalog],
  ['prog-gap-prog-szu-tcsol-bachelor-2026', 26000, szuBachelorGuide, szuBachelorCatalog],
]
for (const [programId, tuitionCny, guide, catalog] of szuCycleFacts) {
  upsertCycleByKey(admissionCycles, historicalCycle({
    id: `cycle-wave3-${programId}-autumn-2026-historical`,
    programId,
    opensOn: '2026-01-01',
    closesOn: '2026-05-31',
    tuitionCny,
    applicationFeeCny: 400,
    sourceIds: [guide, catalog],
    notes: szuClosedNotes,
  }))
}
upsertCycleByKey(admissionCycles, historicalCycle({
  id: 'cycle-wave3-szu-chinese-language-autumn-2026-historical',
  programId: 'program-shenzhen-university-chinese-language-program-language',
  opensOn: '2026-05-15',
  closesOn: '2026-06-30',
  tuitionCny: 11000,
  tuitionPeriod: 'semester',
  applicationFeeCny: 400,
  sourceIds: [
    'source-szu-2026-autumn-chinese-language',
    'source-szu-2026-autumn-chinese-language-supplement',
  ],
  notes: localized(
    'The 18-week autumn 2026 course and its supplementary application window are closed. CNY 11,000 per semester and the CNY 400 fee are historical facts only.',
    '2026年秋季18周课程及其补录窗口均已截止。每学期11,000元学费和400元报名费仅作为历史事实保留。',
  ),
}))
upsertCycleByKey(admissionCycles, {
  id: 'cycle-2027-shenzhen-iclt-one-semester-spring',
  programId: 'program-shenzhen-university-iclt-one-semester-language',
  academicYear: '2026-2027',
  intake: 'spring',
  opensOn: null,
  closesOn: '2026-10-31',
  dateStatus: 'published',
  tuitionCny: null,
  tuitionPeriod: null,
  tuitionStatus: null,
  evidenceBasis: 'cycle-specific',
  factScope: 'dates-only',
  applicationFeeCny: null,
  notes: localized(
    'The official guide publishes a 31 October 2026 deadline for March 2027 entry but no opening date. The system therefore exposes a future deadline without claiming applications are open.',
    '官方简章公布2027年3月入学的截止日为2026年10月31日，但未公布开放日期，因此系统展示未来截止日而不声称申请已经开放。',
  ),
  sourceIds: ['source-szu-iclt-nondegree-2026-2027'],
  verifiedAt: checkedAt,
  reviewAfter: upcomingReviewAfter,
  status: 'verified',
})

const jnuClosedNotes = localized(
  'The official guide lists two 2026 application-review windows, 15 January–28 February and 1 April–31 May. The final deadline, tuition and CNY 500 fee are historical only; no continuous opening interval or 2027 cycle is inferred.',
  '官方简章列出2026年两段申请审核期：1月15日至2月28日、4月1日至5月31日。最终截止日、学费和500元报名费仅作历史记录，不虚构连续开放期或2027周期。',
)
const jnuTuition = new Map([
  ['program-jinan-university-international-economics-and-trade-bachelor', 28000],
  ['program-jinan-university-computer-science-and-technology-bachelor', 30000],
  ['program-jinan-university-accounting-bachelor', 32000],
  ['program-jinan-university-finance-bachelor', 28000],
  ['program-jinan-university-pharmacy-bachelor', 30000],
  ['program-jinan-university-international-journalism-and-communication-bachelor', 28000],
  ['program-jinan-university-food-nutrition-and-health-bachelor', 30000],
  ['program-jinan-university-clinical-medicine-bachelor', 40000],
  ['prog-gap-clw-sw-jnu-chinese-language-bachelor', 22000],
  ['prog-gap-clw-sw-jnu-chinese-culture-education-bachelor', 22000],
  ['prog-gap-clw-sw-jnu-tcsol-bachelor', 22000],
])
for (const [programId, tuitionCny] of jnuTuition) {
  upsertCycleByKey(admissionCycles, historicalCycle({
    id: `cycle-wave3-${programId}-autumn-2026-historical`,
    programId,
    closesOn: '2026-05-31',
    tuitionCny,
    applicationFeeCny: 500,
    sourceIds: [jnuGuide],
    notes: jnuClosedNotes,
  }))
}

const gdpuClosedNotes = localized(
  'The official 2026 postgraduate guide closes on 30 June 2026. It does not state tuition or an application fee, so both remain officially not announced instead of being copied from an aggregator or another year.',
  '2026年官方研究生简章截止日为2026年6月30日。简章未公布学费和申请费，因此两项继续标记为官网未公布，不引用聚合站或其他年份。',
)
for (const programId of gdpuProgramIds) {
  upsertCycleByKey(admissionCycles, historicalCycle({
    id: `cycle-wave3-${programId}-autumn-2026-historical`,
    programId,
    closesOn: '2026-06-30',
    tuitionCny: null,
    applicationFeeCny: null,
    sourceIds: [
      'source-gdpu-international-program-disciplines',
      'source-gdpu-2026-postgraduate-guide',
    ],
    notes: gdpuClosedNotes,
  }))
}

const gdufeMasterNotes = localized(
  'The official 2026 master guide confirms annual tuition of CNY 25,000, a CNY 500 application fee and a 1 June 2026 deadline. The round is closed and is not a 2027 announcement.',
  '2026年官方硕士简章确认学费每学年25,000元、申请费500元、截止日为2026年6月1日。该轮次已结束，不代表2027年公告。',
)
for (const programId of [
  'prog-gap-mew-csw-gdufe-digital-economy-master',
  'prog-gap-mew-csw-gdufe-international-trade-master',
  'prog-gap-mew-csw-gdufe-international-chinese-education-master',
]) {
  upsertCycleByKey(admissionCycles, historicalCycle({
    id: `cycle-wave3-${programId}-autumn-2026-historical`,
    programId,
    closesOn: '2026-06-01',
    tuitionCny: 25000,
    applicationFeeCny: 500,
    sourceIds: [gdufeMasterPage, gdufeMasterPdf],
    notes: gdufeMasterNotes,
  }))
}
upsertCycleByKey(admissionCycles, historicalCycle({
  id: 'cycle-wave3-gdufe-international-trade-doctorate-autumn-2026-historical',
  programId: 'prog-gap-mew-csw-gdufe-international-trade-doctorate',
  closesOn: '2026-05-01',
  tuitionCny: 30000,
  applicationFeeCny: 500,
  sourceIds: [
    'source-gdufe-2026-doctoral-guide-page',
    'source-gdufe-2026-doctoral-guide-pdf',
  ],
  notes: localized(
    'The official 2026 doctoral guide confirms four years of standard study, CNY 30,000 annual tuition, a CNY 500 application fee and a 1 May 2026 deadline. The round is closed.',
    '2026年官方博士简章确认标准学制4年、学费每学年30,000元、申请费500元、截止日为2026年5月1日；该轮次已结束。',
  ),
}))

const szuIcltScholarship = scholarships.find(
  (item) => item.id === 'scholarship-shenzhen-university-iclt-spring-2027',
)
if (!szuIcltScholarship) throw new Error('Missing SZU spring 2027 ICLT scholarship')
upsertScholarshipWithGate(scholarships, {
  ...szuIcltScholarship,
  sourceIds: ['source-szu-iclt-nondegree-2026-2027'],
  verifiedAt: checkedAt,
  reviewAfter: upcomingReviewAfter,
  status: 'verified',
})

const gdpuScholarship = scholarships.find(
  (item) => item.id === 'sch-gap-mew-0805-scw-gdpu-guangdong-government-scholarship',
)
if (!gdpuScholarship) throw new Error('Missing GDPU Guangdong Government scholarship')
upsertScholarshipWithGate(scholarships, {
  ...gdpuScholarship,
  programIds: gdpuProgramIds,
  deadline: '2026-07-30',
  applicationUrl: 'https://sie.gdpu.edu.cn/info/1038/1347.htm',
  summary: localized(
    'The official 2026 GDPU notice lists a CNY 20,000 award for eligible new or continuing master students. Applications ran from 1 May to 30 July 2026 and are closed.',
    '广东药科大学2026年官方通知列明，符合条件的硕士新生或在读生可获20,000元资助；申请期为2026年5月1日至7月30日，现已截止。',
  ),
  sourceIds: ['source-gdpu-2026-guangdong-government-scholarship'],
  verifiedAt: checkedAt,
  reviewAfter: checkedAt,
  status: 'stale',
})

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)
write('scholarships.json', scholarships)

console.log(JSON.stringify({
  checkedAt,
  sourcesUpserted: sourceSpecs.length,
  programsUpdated: szuProgramSpecs.length + jnuEnglishPrograms.length + jnuChinesePrograms.length + gdpuProgramIds.length + 4,
  historicalCyclesMaterialized: szuCycleFacts.length + 1 + jnuTuition.size + gdpuProgramIds.length + 4,
  futureDeadlineCyclesRefreshed: 1,
  scholarshipsRefreshed: 2,
  dependencyGate,
}, null, 2))
