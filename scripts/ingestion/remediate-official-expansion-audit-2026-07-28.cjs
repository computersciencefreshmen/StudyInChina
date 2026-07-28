const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8'))
}

function writeJson(fileName, value) {
  fs.writeFileSync(
    path.join(DATA_DIR, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

function byId(items, id) {
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Missing record: ${id}`)
  return item
}

function localized(en, zh, ru) {
  return { en, zh, ru }
}

function apply() {
  const sources = readJson('sources.json')
  const programs = readJson('programs.json')
  const cycles = readJson('admission-cycles.json')
  const scholarships = readJson('scholarships.json')

  const sustechPostgraduateUrl = 'https://med.sustech.edu.cn/Home/Default/NewsDetailNE?AID=7174&classIDNow=3451'
  byId(sources, 'src-sustech-2026-postgraduate').url = sustechPostgraduateUrl
  byId(
    programs,
    'program-southern-university-of-science-and-technology-materials-science-master',
  ).programUrl = sustechPostgraduateUrl

  const gdufsApplicationUrl = 'https://gdufs.17gz.org/'
  for (const id of [
    'program-guangdong-university-of-foreign-studies-chinese-language-bachelor',
    'program-guangdong-university-of-foreign-studies-international-business-bachelor',
    'program-guangdong-university-of-foreign-studies-global-economic-governance-doctorate',
    'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
  ]) {
    byId(programs, id).applyUrl = gdufsApplicationUrl
  }

  byId(
    programs,
    'program-shenzhen-university-iclt-one-semester-language',
  ).applyUrl = 'https://status.szu.edu.cn/szulxs/stuzs/stuLogin.action?fpage_id=216'

  const blcuFinance = byId(
    programs,
    'program-beijing-language-and-culture-university-finance-english-bachelor',
  )
  blcuFinance.durationMonths = 48
  blcuFinance.languageRequirements = [
    { test: 'IELTS', minimum: '5.5 overall and in every component' },
    { test: 'TOEFL', minimum: '80' },
    { test: 'other', minimum: 'TOEIC 650' },
  ]
  blcuFinance.verificationScope = 'facts'

  for (const [id, durationMonths] of [
    ['program-shanghai-normal-university-human-geography-bachelor', 48],
    ['program-shanghai-normal-university-applied-chemistry-bachelor', 48],
    ['program-shanghai-normal-university-mathematics-education-master', 24],
    ['program-shanghai-normal-university-finance-master', 24],
  ]) {
    const program = byId(programs, id)
    program.durationMonths = durationMonths
    program.verificationScope = 'facts'
  }

  const xisuRegularChinese = byId(
    programs,
    'program-xian-international-studies-university-regular-chinese-language',
  )
  xisuRegularChinese.durationMonths = null
  delete xisuRegularChinese.durationMonthsMax
  xisuRegularChinese.languageRequirements = []
  xisuRegularChinese.verificationScope = 'identity'

  byId(
    programs,
    'program-xian-international-studies-university-new-sinology-translation-master',
  ).teachingLanguages = []

  const changanSelfFundedChinese = byId(
    programs,
    'program-changan-university-self-funded-chinese-language',
  )
  changanSelfFundedChinese.durationMonths = null
  delete changanSelfFundedChinese.durationMonthsMax
  changanSelfFundedChinese.languageRequirements = []
  changanSelfFundedChinese.verificationScope = 'identity'

  const nauRouteIds = new Set([
    'program-nanjing-audit-university-maud-mofcom-master',
    'program-nanjing-audit-university-maud-csc-master',
  ])
  const nauRoutes = programs.filter((program) => nauRouteIds.has(program.id))
  const existingNauProgram = programs.find(
    (program) => program.id === 'program-nanjing-audit-university-master-of-auditing',
  )
  if (nauRoutes.length === 0 && !existingNauProgram) {
    throw new Error('Missing Nanjing Audit University Master of Auditing source records')
  }
  const nauProgram = existingNauProgram ?? {
    ...nauRoutes[0],
    id: 'program-nanjing-audit-university-master-of-auditing',
    slug: 'nanjing-audit-university-master-of-auditing',
  }
  nauProgram.name = localized(
    'Master of Auditing',
    '审计硕士',
    'Магистратура по аудиту',
  )
  nauProgram.sourceIds = [...new Set([
    ...nauRoutes.flatMap((program) => program.sourceIds),
    ...(existingNauProgram?.sourceIds ?? []),
  ])]
  nauProgram.programUrl = 'https://lxsy.nau.edu.cn/2026/0706/c7234a160441/page.htm'
  nauProgram.applyUrl = 'https://apply.nausie.cucas.cn/'
  nauProgram.teachingLanguages = []
  nauProgram.durationMonths = null
  delete nauProgram.durationMonthsMax
  nauProgram.languageRequirements = []
  nauProgram.verificationScope = 'identity'
  const canonicalPrograms = programs.filter(
    (program) => !nauRouteIds.has(program.id)
      && program.id !== nauProgram.id,
  )
  canonicalPrograms.push(nauProgram)

  const removedCycleIds = new Set([
    'cycle-2027-blcu-finance-english-spring',
    'cycle-2027-changan-transportation-engineering-autumn',
    'cycle-2027-changan-civil-engineering-autumn',
    'cycle-2027-changan-self-funded-chinese-language-spring',
  ])
  const correctedCycles = cycles.filter((cycle) => !removedCycleIds.has(cycle.id))

  byId(correctedCycles, 'cycle-2027-xisu-regular-chinese-spring').applicationFeeCny = null
  for (const id of [
    'cycle-2026-wenzhou-medical-university-mbbs-autumn',
    'cycle-2026-wenzhou-medical-university-bds-autumn',
    'cycle-2026-wenzhou-medical-university-pharmaceutical-sciences-autumn',
  ]) {
    const cycle = byId(correctedCycles, id)
    cycle.applicationFeeCny = null
    cycle.tuitionStatus = 'reference'
    cycle.evidenceBasis = 'recurring-official-rule'
  }

  const wmuScholarship = byId(
    scholarships,
    'scholarship-wenzhou-medical-university-undergraduate-freshman',
  )
  wmuScholarship.name = localized(
    'Wenzhou Medical University MBBS/BDS Freshman Scholarship',
    '温州医科大学MBBS/BDS新生奖学金',
    'Стипендия первокурсникам MBBS/BDS Вэньчжоуского медицинского университета',
  )
  wmuScholarship.coverage.tuition = 'unknown'
  wmuScholarship.summary = localized(
    'MBBS and BDS students first pay the full tuition. Freshman cash awards of CNY 20,000, CNY 10,000 or CNY 5,000 are then granted according to the entrance-examination ranking; the current exact scholarship deadline is not separately announced.',
    'MBBS和BDS学生须先缴纳全额学费，再按入学考试排名获得2万元、1万元或5000元新生奖励；当期奖学金具体截止日期未单独公布。',
    'Студенты MBBS и BDS сначала оплачивают обучение полностью, после чего по рейтингу вступительного испытания получают выплату 20 000, 10 000 или 5 000 юаней; отдельный актуальный срок не опубликован.',
  )

  for (const id of [
    'scholarship-gdufs-guangdong-government',
    'scholarship-shenzhen-university-guangdong-outstanding-2026',
  ]) {
    byId(scholarships, id).coverage.tuition = 'unknown'
  }

  const changanScholarship = byId(scholarships, 'scholarship-changan-iclt-2027')
  changanScholarship.summary = localized(
    'For the International Chinese Education master’s route, the scholarship covers tuition, accommodation and insurance; the CNY 3,000 monthly stipend is limited to the first two academic years. The later published deadline is for March 2027 intake.',
    '国际中文教育硕士路线覆盖学费、住宿和保险；每月3000元生活费仅资助前两个学年。页面较晚截止日期对应2027年3月入学。',
    'Для магистратуры по международному преподаванию китайского языка покрываются обучение, проживание и страховка; выплата 3 000 юаней в месяц предоставляется только в первые два учебных года. Поздний срок относится к марту 2027 года.',
  )

  const nauScholarship = byId(
    scholarships,
    'scholarship-nanjing-audit-university-mofcom-maud',
  )
  nauScholarship.programIds = [nauProgram.id]
  nauScholarship.deadline = null
  nauScholarship.coverage.tuition = 'unknown'
  nauScholarship.summary = localized(
    'This is the MOFCOM-sponsored application route for the Master of Auditing. Applicants first apply to NAU and then seek a recommendation from the economic and commercial office of the Chinese embassy. The official FAQ gives June 6 as an annual recommended date, not a cycle-specific deadline; confirm the current funding items and date in the official notice.',
    '这是审计硕士的商务部资助申请路线。申请人先向南京审计大学申请，再向中国使馆经商机构申请推荐。官方问答仅将每年6月6日列为建议日期，并非当期精确截止日；资助项目和当期日期须以官方通知为准。',
    'Это спонсируемый MOFCOM маршрут поступления на магистратуру по аудиту. Сначала подаётся заявление в NAU, затем запрашивается рекомендация торгово-экономического отдела посольства Китая. В официальном FAQ 6 июня указано лишь как ежегодная рекомендуемая дата, а не срок конкретного цикла; актуальные условия финансирования и дату следует подтвердить в объявлении.',
  )

  const blcuScholarship = byId(
    scholarships,
    'scholarship-blcu-beijing-international-students-2027',
  )
  blcuScholarship.summary = localized(
    'For new bachelor’s, master’s and doctoral applicants, the scholarship covers first-year tuition only. The published January 12, 2027 deadline applies to March 2027 intake.',
    '面向新申请的本科、硕士和博士学历生，仅覆盖第一学年学费；官方公布的2027年1月12日截止日期对应2027年3月入学。',
    'Для новых поступающих на бакалавриат, магистратуру и докторантуру стипендия покрывает только обучение в первый год; опубликованный срок 12 января 2027 года относится к набору марта 2027 года.',
  )

  const sustechPresident = byId(scholarships, 'scholarship-sustech-president')
  sustechPresident.summary = localized(
    'This undergraduate-only package is valued at CNY 68,000 per year and covers tuition, dormitory, insurance and living support for up to four years, subject to annual review. Applicants are considered automatically only if they take and pass the online test/interview; applicants granted a test waiver are not eligible.',
    '该奖学金仅面向本科申请者，每年价值6.8万元，覆盖学费、住宿、保险和生活支持，最长四年并接受年度评审。只有参加并通过线上测试/面试的申请者才自动纳入评选；获得免试资格者不具备申请资格。',
    'Пакет только для бакалавриата стоимостью 68 000 юаней в год покрывает обучение, общежитие, страховку и проживание до четырёх лет при ежегодной проверке. Автоматически рассматриваются лишь прошедшие онлайн-тест/собеседование; освобождённые от теста не имеют права на эту стипендию.',
  )

  const sustechWaiver = byId(scholarships, 'scholarship-sustech-tuition-waiver')
  sustechWaiver.summary = localized(
    'This undergraduate-only award waives the published annual CNY 30,000 tuition. Applicants are considered automatically only if they take and pass the online test/interview; applicants granted a test waiver are not eligible.',
    '该奖学金仅面向本科申请者，减免官方公布的每年3万元学费。只有参加并通过线上测试/面试的申请者才自动纳入评选；获得免试资格者不具备申请资格。',
    'Эта стипендия только для бакалавриата освобождает от опубликованной платы 30 000 юаней в год. Автоматически рассматриваются лишь прошедшие онлайн-тест/собеседование; освобождённые от теста не имеют права на эту стипендию.',
  )

  writeJson('sources.json', sources)
  writeJson('programs.json', canonicalPrograms)
  writeJson('admission-cycles.json', correctedCycles)
  writeJson('scholarships.json', scholarships)

  console.log(JSON.stringify({
    programs: canonicalPrograms.length,
    admissionCycles: correctedCycles.length,
    scholarships: scholarships.length,
    removedFutureExtrapolations: [...removedCycleIds],
    mergedProgram: nauProgram.id,
  }, null, 2))
}

apply()
