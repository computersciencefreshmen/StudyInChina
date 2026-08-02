const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const outputDir = path.join(root, 'quality', 'official-gap-wave-2026-08-02')
const outputPath = path.join(outputDir, 'wave8-depth-flagships.json')
const checkedAt = '2026-08-02'
const sourceFile = 'wave8-depth-flagships.json'

const unknownFact = () => ({ value: null, status: 'officially_not_announced' })

function candidate({
  id,
  institutionSlug,
  name,
  programType = 'degree',
  level,
  language,
  duration,
  tuition,
  cycles = [],
  officialUrl,
  sourceTitle,
  applicationUrl,
  summary,
  additionalEvidence = [],
  riskFlags = [],
}) {
  return {
    candidateId: id,
    candidateIds: [id],
    institutionSlug,
    name,
    programType,
    level,
    teachingLanguage: language
      ? { value: language, status: 'known' }
      : unknownFact(),
    duration: duration
      ? { value: duration, status: 'known' }
      : unknownFact(),
    tuition: tuition
      ? { ...tuition, currency: 'CNY', status: 'known' }
      : { amount: null, currency: 'CNY', period: null, status: 'officially_not_announced' },
    cycles,
    evidence: {
      officialUrl,
      sourceTitle,
      checkedAt,
      summary,
    },
    additionalEvidence,
    applicationUrl,
    recommendedAction: cycles.some((cycle) => cycle.displayAsOpen)
      ? 'publish_verified_program_and_cycle'
      : 'publish_program_identity_without_open_cycle',
    qualityTier: 'A',
    riskFlags,
    sourceFiles: [sourceFile],
  }
}

function scholarship({
  id,
  institutionSlug,
  name,
  scope,
  applicableLevels,
  funding,
  officialUrl,
  sourceTitle,
  summary,
  cycles = [],
  riskFlags = [],
}) {
  return {
    candidateId: id,
    candidateIds: [id],
    institutionSlug,
    name,
    scholarshipType: null,
    scope,
    applicableLevels,
    funding,
    cycles,
    evidence: { officialUrl, sourceTitle, checkedAt, summary },
    additionalEvidence: [],
    recommendedAction: cycles.some((cycle) => cycle.displayAsOpen)
      ? 'publish_verified_scholarship_and_cycle'
      : 'publish_scholarship_identity_without_open_cycle',
    qualityTier: 'A',
    riskFlags,
    sourceFiles: [sourceFile],
    programCandidateIds: [],
  }
}

const bitUrl = 'https://isc.bit.edu.cn/aboutbit/faq/70fe36ccf5f64defb9ecda409efd2b71.htm'
const bitCycle = {
  academicYear: '2026-2027',
  intake: 'autumn',
  intakeLabel: null,
  applicationOpen: null,
  applicationDeadline: '2026-06-01',
  statusAsOfCheckedAt: 'closed',
  displayAsOpen: false,
  sourceFormat: 'canonical',
}
const bitPrograms = [
  ['aeronautical-astronautical-engineering', 'Aeronautical and Astronautical Engineering', '航空航天工程', 'Бакалавриат по авиационно-космической технике'],
  ['automation', 'Automation', '自动化', 'Бакалавриат по автоматизации'],
  ['mechatronics-engineering', 'Mechatronics Engineering', '机电工程', 'Бакалавриат по мехатронике'],
  ['electronic-science-technology', 'Electronic Science and Technology', '电子科学与技术', 'Бакалавриат по электронной науке и технологиям'],
  ['international-economics-trade', 'International Economics and Trade', '国际经济与贸易', 'Бакалавриат по международной экономике и торговле'],
].map(([key, en, zh, ru]) => candidate({
  id: `wave8-bit-${key}-bachelor`,
  institutionSlug: 'beijing-institute-of-technology',
  name: { en: `${en} (Bachelor's Program)`, zh: `${zh}本科项目`, ru },
  level: 'bachelor',
  language: 'English',
  duration: '4 years',
  tuition: { amount: 30000, period: 'academic-year' },
  cycles: [bitCycle],
  officialUrl: bitUrl,
  sourceTitle: 'Beijing Institute of Technology 2026 International Undergraduate Admission Book',
  applicationUrl: 'https://apply.isc.bit.edu.cn/',
  summary: {
    en: `BIT's official 2026 international undergraduate guide lists ${en} as an English-taught four-year program. English-medium tuition is CNY 30,000 per year; the 1 June 2026 deadline is closed.`,
    zh: `北京理工大学2026国际本科官方简章列有${zh}英文授课四年制项目，学费每年30000元；2026年6月1日截止，当前已关闭。`,
    ru: `Официальное руководство BIT 2026 включает программу «${en}» на английском языке сроком четыре года. Стоимость — 30 000 юаней в год; срок 1 июня 2026 года закрыт.`,
  },
  riskFlags: ['2026_application_cycle_closed'],
}))

const hitPrograms = [
  candidate({
    id: 'wave8-hit-pre-university-program',
    institutionSlug: 'harbin-institute-of-technology',
    name: { en: 'Pre-University Program', zh: '国际学生预科项目', ru: 'Подготовительная программа' },
    programType: 'foundation',
    level: 'foundation',
    language: 'Chinese / English',
    duration: '18 or 36 weeks',
    officialUrl: 'https://studyathit.hit.edu.cn/18362/list.htm',
    sourceTitle: 'Harbin Institute of Technology Pre-University Program',
    applicationUrl: 'https://hit.at0086.cn/student',
    summary: {
      en: 'HIT officially offers Chinese- and English-taught pre-university routes of 18 or 36 weeks for non-Chinese applicants preparing for degree study. Variant fees and recurring deadlines are kept out of the current cycle until the intake is explicit.',
      zh: '哈工大官方面向国际学生提供中文或英文授课的18周、36周预科路线；因不同路线费用和年份截止日不同，本记录只发布项目身份。',
      ru: 'HIT официально предлагает иностранным абитуриентам подготовительные траектории на китайском или английском языке продолжительностью 18 или 36 недель; текущий цикл не заявляется без точного набора.',
    },
    riskFlags: ['variant_specific_fees', 'current_cycle_not_explicit'],
  }),
  candidate({
    id: 'wave8-hit-long-term-chinese-language',
    institutionSlug: 'harbin-institute-of-technology',
    name: { en: 'Long-Term Chinese Language Program', zh: '长期汉语进修项目', ru: 'Долгосрочная программа китайского языка' },
    programType: 'language',
    level: 'language',
    language: 'Chinese',
    duration: '16 weeks',
    tuition: { amount: 7300, period: 'semester' },
    cycles: [{ ...bitCycle, applicationDeadline: '2026-07-15' }],
    officialUrl: 'https://studyathit.hit.edu.cn/LongwtermChineseLanguageProgram/list.htm',
    sourceTitle: 'HIT 2026 Long-Term Chinese Language Program',
    applicationUrl: 'https://hit.at0086.cn/StuApplication/Login.aspx',
    summary: {
      en: 'HIT publishes a 16-week long-term Chinese program for non-Chinese applicants at CNY 7,300 per semester. The fall 2026 deadline of 15 July is closed.',
      zh: '哈工大官方长期汉语项目面向非中国籍申请人，学制16周、每学期学费7300元；2026秋季7月15日截止，现已关闭。',
      ru: 'HIT публикует 16-недельную долгосрочную программу китайского языка стоимостью 7 300 юаней за семестр; срок осени 2026 года закрыт 15 июля.',
    },
    riskFlags: ['2026_application_cycle_closed'],
  }),
  candidate({
    id: 'wave8-hit-winter-short-term-chinese-2026',
    institutionSlug: 'harbin-institute-of-technology',
    name: { en: '2026–2027 Winter Short-Term Chinese Language Program', zh: '2026—2027冬季短期汉语项目', ru: 'Зимняя краткосрочная программа китайского языка 2026–2027' },
    programType: 'short_term',
    level: 'other',
    language: 'Chinese',
    duration: '4 weeks',
    tuition: { amount: 3500, period: 'program' },
    cycles: [{
      academicYear: '2026-2027', intake: 'winter', intakeLabel: '28 December 2026 – 24 January 2027',
      applicationOpen: null, applicationDeadline: '2026-11-30', statusAsOfCheckedAt: 'open',
      displayAsOpen: true, sourceFormat: 'canonical',
    }],
    officialUrl: 'https://studyathit.hit.edu.cn/ShortwTermPrograms/list.htm',
    sourceTitle: 'HIT 2026 Short-Term Chinese Language Program',
    applicationUrl: 'https://hit.at0086.cn/StuApplication/Login.aspx',
    summary: {
      en: "HIT's official short-term page lists a four-week winter Chinese and culture program from 28 December 2026 to 24 January 2027, tuition CNY 3,500, with applications due 30 November 2026.",
      zh: '哈工大官方短期项目页公布2026年12月28日至2027年1月24日四周冬季汉语文化项目，学费3500元，申请截止2026年11月30日。',
      ru: 'Официальная страница HIT объявляет четырёхнедельную зимнюю программу с 28 декабря 2026 по 24 января 2027 года, стоимостью 3 500 юаней и сроком подачи 30 ноября 2026 года.',
    },
  }),
  candidate({
    id: 'wave8-hit-global-summer-school',
    institutionSlug: 'harbin-institute-of-technology',
    name: { en: 'HIT Global Summer School', zh: '哈尔滨工业大学全球暑期学校', ru: 'Глобальная летняя школа HIT' },
    programType: 'short_term',
    level: 'other',
    officialUrl: 'https://studyathit.hit.edu.cn/GlobalSummerSchoolwHITGSSw/list.htm',
    sourceTitle: 'Harbin Institute of Technology Global Summer School',
    applicationUrl: 'https://hit.at0086.cn/student',
    summary: {
      en: "HIT's official Global Summer School page describes an international short-term platform with 21 technical and cultural themes. No future application cycle is asserted after the 2026 session.",
      zh: '哈工大全球暑期学校官方页面面向全球学生提供21个科技与文化主题；2026届结束后不推定下一周期。',
      ru: 'Официальная Global Summer School HIT предлагает международным студентам 21 техническое и культурное направление; следующий цикл после сессии 2026 года не предполагается.',
    },
    riskFlags: ['next_cycle_not_announced'],
  }),
]

const whutUrl = 'https://sie.whut.edu.cn/english/ist/unde/202602/t20260227_1385160.shtml'
const whutPrograms = [
  ['business-administration', 'Business Administration', '工商管理', 'Бакалавриат по управлению бизнесом', 20000],
  ['computer-science-technology', 'Computer Science and Technology', '计算机科学与技术', 'Бакалавриат по компьютерным наукам и технологиям', 24000],
  ['mining-engineering', 'Mining Engineering', '采矿工程', 'Бакалавриат по горному делу', 24000],
  ['logistics-management', 'Logistics Management', '物流管理', 'Бакалавриат по логистике', 20000],
  ['mechanical-engineering', 'Mechanical Engineering', '机械工程', 'Бакалавриат по машиностроению', 24000],
].map(([key, en, zh, ru, amount]) => candidate({
  id: `wave8-whut-${key}-bachelor`,
  institutionSlug: 'wuhan-university-of-technology',
  name: { en: `${en} (Bachelor's Program)`, zh: `${zh}本科项目`, ru },
  level: 'bachelor',
  language: 'English',
  duration: '4 years',
  tuition: { amount, period: 'academic-year' },
  cycles: [{ ...bitCycle, applicationOpen: '2025-10-10', applicationDeadline: '2026-06-30' }],
  officialUrl: whutUrl,
  sourceTitle: 'Wuhan University of Technology 2026 Undergraduate Programs',
  applicationUrl: 'https://admission.whut.edu.cn/',
  summary: {
    en: `WUT's official 2026 international undergraduate guide lists ${en} as a four-year English-taught option. The published annual tuition is CNY ${amount.toLocaleString('en-US')}; the 30 June 2026 deadline is closed.`,
    zh: `武汉理工大学2026国际本科官方简章列有${zh}四年制英文项目，学费每年${amount}元；2026年6月30日截止，当前已关闭。`,
    ru: `Официальный набор WUT 2026 включает англоязычный бакалавриат «${en}» сроком четыре года и стоимостью ${amount.toLocaleString('en-US')} юаней в год; срок 30 июня 2026 года закрыт.`,
  },
  riskFlags: ['2026_application_cycle_closed', 'class_requires_minimum_enrollment'],
}))

const scutUrl = 'https://sie.scut.edu.cn/2021/0602/c29044a431737/page.htm'
const scutPrograms = [
  ['artificial-intelligence', 'Artificial Intelligence', '人工智能', 'Бакалавриат по искусственному интеллекту'],
  ['biomedical-engineering', 'Biomedical Engineering', '生物医学工程', 'Бакалавриат по биомедицинской инженерии'],
  ['computer-science-technology', 'Computer Science and Technology', '计算机科学与技术', 'Бакалавриат по компьютерным наукам и технологиям'],
  ['international-economics-trade', 'International Economics and Trade', '国际经济与贸易', 'Бакалавриат по международной экономике и торговле'],
  ['robot-engineering', 'Robot Engineering', '机器人工程', 'Бакалавриат по робототехнике'],
].map(([key, en, zh, ru]) => candidate({
  id: `wave8-scut-${key}-bachelor`,
  institutionSlug: 'south-china-university-of-technology',
  name: { en: `${en} (Bachelor's Program)`, zh: `${zh}本科项目`, ru },
  level: 'bachelor',
  language: 'English',
  duration: '4 years',
  officialUrl: scutUrl,
  sourceTitle: 'SCUT English-Medium Undergraduate Programs',
  applicationUrl: 'https://www.scut.edu.cn/apply',
  summary: {
    en: `SCUT's current international-education catalog lists ${en} among its four-year English-medium undergraduate programs. Current-cycle tuition and dates are not inferred from the undated catalog page.`,
    zh: `华南理工大学国际教育学院当前目录将${zh}列为四年制英文授课本科项目；目录页未标明当期费用和日期，因此不作推定。`,
    ru: `Текущий международный каталог SCUT включает «${en}» в четырёхлетние англоязычные программы; стоимость и сроки текущего набора не предполагаются.`,
  },
  additionalEvidence: [{ officialUrl: 'https://sie.scut.edu.cn/fqa/', sourceTitle: 'SCUT International Admission FAQ' }],
  riskFlags: ['current_cycle_not_announced'],
}))


const swufeUrl = 'https://international.swufe.edu.cn/__local/8/53/1D/527EFAA78A778469B7FAA2ED1E6_65EE7881_598E3.pdf'
const swufePrograms = [
  ['accounting', 'Accounting', '会计学', 'Бакалавриат по бухгалтерскому учёту'],
  ['business-administration', 'Business Administration', '工商管理', 'Бакалавриат по управлению бизнесом'],
  ['economics', 'Economics', '经济学', 'Бакалавриат по экономике'],
  ['finance', 'Finance', '金融学', 'Бакалавриат по финансам'],
  ['ecommerce-ai-business', 'E-commerce (AI in Business)', '电子商务（AI商务方向）', 'Бакалавриат по электронной коммерции и ИИ в бизнесе'],
].map(([key, en, zh, ru]) => candidate({
  id: `wave8-swufe-${key}-bachelor`,
  institutionSlug: 'southwestern-university-of-finance-and-economics',
  name: { en: `${en} (Bachelor's Program)`, zh: `${zh}本科项目`, ru },
  level: 'bachelor',
  language: 'English',
  duration: '4 years',
  officialUrl: swufeUrl,
  sourceTitle: 'SWUFE 2026 Academic Program List',
  applicationUrl: 'https://international.swufe.edu.cn/EN/Admissions.htm',
  summary: {
    en: `SWUFE's official 2026 academic list identifies ${en} as a four-year English-taught bachelor program available to international applicants. Fees and a future deadline are not inferred from the program list.`,
    zh: `西南财经大学2026官方招生专业目录将${zh}列为面向国际学生的四年制英文本科项目；目录未提供可安全复用的未来费用和截止日，因此不作推定。`,
    ru: `Официальный каталог SWUFE 2026 включает «${en}» как четырёхлетнюю англоязычную программу бакалавриата для иностранных студентов; стоимость и будущий срок не предполагаются.`,
  },
  riskFlags: ['current_cycle_not_announced'],
}))

const njustUrl = 'https://study.njust.edu.cn/_upload/article/files/c7/93/9c7e117040008af4927036927a99/b75bbd08-7d75-4352-bfe6-4d68d079fda9.pdf'
const njustPrograms = [
  ['mechanical-engineering', 'Mechanical Engineering', '机械工程', 'Бакалавриат по машиностроению'],
  ['software-engineering', 'Software Engineering', '软件工程', 'Бакалавриат по программной инженерии'],
  ['international-economics-trade', 'International Economy and Trade', '国际经济与贸易', 'Бакалавриат по международной экономике и торговле'],
  ['nanomaterials-nanotechnology', 'Nanomaterials and Nanotechnology', '纳米材料与技术', 'Бакалавриат по наноматериалам и нанотехнологиям'],
].map(([key, en, zh, ru]) => candidate({
  id: `wave8-njust-${key}-bachelor`,
  institutionSlug: 'nanjing-university-of-science-and-technology',
  name: { en: `${en} (Bachelor's Program)`, zh: `${zh}本科项目`, ru },
  level: 'bachelor',
  language: 'English',
  officialUrl: njustUrl,
  sourceTitle: 'NJUST 2026 International Undergraduate Program Catalogue',
  applicationUrl: 'https://study.njust.edu.cn/',
  summary: {
    en: `NJUST's official 2026 international undergraduate catalogue lists ${en} as an English-taught major. Opening requires at least eight enrolled students, and no future deadline is inferred.`,
    zh: `南京理工大学2026来华留学生本科官方目录将${zh}列为英文授课专业；英文班需至少8人开班，未推定未来截止日期。`,
    ru: `Официальный международный каталог NJUST 2026 включает «${en}» на английском языке; для открытия группы требуется не менее восьми студентов, будущий срок не предполагается.`,
  },
  riskFlags: ['minimum_enrollment_eight', 'current_cycle_not_announced'],
}))

const ustcYouthUrl = 'https://ic.ustc.edu.cn/en/v7list.php?id=646'
const ustcPrograms = [candidate({
  id: 'wave8-ustc-scientific-management-leaders-mba',
  institutionSlug: 'university-of-science-and-technology-of-china',
  name: {
    en: 'Scientific Management Leaders MBA (Youth of Excellence Scheme)',
    zh: '科学管理领军人才MBA（青年卓越计划）',
    ru: 'MBA «Лидеры научного управления» (Youth of Excellence Scheme)',
  },
  level: 'master',
  language: 'English',
  duration: '2 academic years (1+1 model)',
  cycles: [{
    academicYear: '2026-2027', intake: 'autumn', intakeLabel: 'September 2026',
    applicationOpen: null, applicationDeadline: '2026-02-15', statusAsOfCheckedAt: 'closed',
    displayAsOpen: false, sourceFormat: 'canonical',
  }],
  officialUrl: ustcYouthUrl,
  sourceTitle: 'USTC 2026 Youth of Excellence Scheme of China Program',
  applicationUrl: ustcYouthUrl,
  summary: {
    en: 'USTC officially offers this English-taught MBA to eligible non-Chinese professionals through a two-year 1+1 model. The university-stage deadline of 15 February 2026 is closed; the program carries a full scholarship.',
    zh: '中国科学技术大学官方面向符合条件的非中国籍职业人士开设该英文MBA，采用两年“1+1”培养模式；校内申请截止2026年2月15日，现已关闭，并配套全额奖学金。',
    ru: 'USTC официально предлагает эту англоязычную MBA-программу подходящим иностранным специалистам по двухлетней модели 1+1; срок университета 15 февраля 2026 года закрыт, предусмотрена полная стипендия.',
  },
  riskFlags: ['2026_application_cycle_closed', 'professional_experience_required'],
})]


const jluUrl = 'https://cie.jlu.edu.cn/info/1047/3653.htm'
const jluCycle = {
  academicYear: '2026-2027', intake: 'autumn', intakeLabel: 'September 2026',
  applicationOpen: null, applicationDeadline: '2026-06-30', statusAsOfCheckedAt: 'closed',
  displayAsOpen: false, sourceFormat: 'canonical',
}
const jluPrograms = [
  ['pharmacy', 'Pharmacy', '药学', 'Бакалавриат по фармации', 'English', 28000],
  ['international-economics-trade', 'International Economics and Trade', '国际经济与贸易', 'Бакалавриат по международной экономике и торговле', 'Chinese', 19000],
  ['chinese-language', 'Chinese Language', '汉语言', 'Бакалавриат по китайскому языку', 'Chinese', 19000],
].map(([key, en, zh, ru, language, amount]) => candidate({
  id: `wave8-jlu-${key}-bachelor`,
  institutionSlug: 'jilin-university',
  name: { en: `${en} (Bachelor's Program)`, zh: `${zh}本科项目`, ru },
  level: 'bachelor',
  language,
  duration: '4 years',
  tuition: { amount, period: 'academic-year' },
  cycles: [jluCycle],
  officialUrl: jluUrl,
  sourceTitle: 'Jilin University 2026–2027 International Undergraduate Admission Guide',
  applicationUrl: jluUrl,
  summary: {
    en: `Jilin University's official 2026–2027 international undergraduate guide lists ${en} as a four-year ${language.toLowerCase()}-taught program. Annual tuition is CNY ${amount.toLocaleString('en-US')}; the 30 June 2026 deadline is closed.`,
    zh: `吉林大学2026—2027国际本科官方简章列有四年制${zh}${language === 'English' ? '英文' : '中文'}授课项目，学费每年${amount}元；2026年6月30日截止，当前已关闭。`,
    ru: `Официальное руководство JLU 2026–2027 включает четырёхлетний бакалавриат «${en}» на ${language === 'English' ? 'английском' : 'китайском'} языке, стоимостью ${amount.toLocaleString('en-US')} юаней в год; срок 30 июня 2026 года закрыт.`,
  },
  riskFlags: ['2026_application_cycle_closed'],
}))

const hnuUrl = 'https://www-en.hnu.edu.cn/__local/E/41/32/CBDFCD7B49E885A62AA9BE4753B_27BDAE72_4851A.pdf'
const hnuCycle = {
  academicYear: '2026-2027', intake: 'autumn', intakeLabel: 'September 2026',
  applicationOpen: null, applicationDeadline: '2026-03-01', statusAsOfCheckedAt: 'closed',
  displayAsOpen: false, sourceFormat: 'canonical',
}
const hnuPrograms = [
  ['computer-science-technology', 'Computer Science and Technology', '计算机科学与技术', 'Магистратура по компьютерным наукам и технологиям', 'master'],
  ['chemistry', 'Chemistry', '化学', 'Докторантура по химии', 'doctorate'],
  ['mechanical-engineering', 'Mechanical Engineering', '机械工程', 'Докторантура по машиностроению', 'doctorate'],
].map(([key, en, zh, ru, level]) => candidate({
  id: `wave8-hnu-${key}-${level}`,
  institutionSlug: 'hunan-university',
  name: {
    en: `${en} (${level === 'master' ? "Master's" : 'Doctoral'} Program)`,
    zh: `${zh}${level === 'master' ? '硕士' : '博士'}项目`,
    ru,
  },
  level,
  language: 'Chinese / English',
  cycles: [hnuCycle],
  officialUrl: hnuUrl,
  sourceTitle: 'Hunan University 2026 CSC High-level Postgraduate Program',
  applicationUrl: hnuUrl,
  summary: {
    en: `Hunan University's official 2026 high-level postgraduate notice lists ${en} at the ${level} level among majors taught in both English and Chinese. The Type B deadline of 1 March 2026 is closed.`,
    zh: `湖南大学2026高水平研究生项目官方通知将${zh}列为可中英文授课的${level === 'master' ? '硕士' : '博士'}专业；B类申请于2026年3月1日截止，当前已关闭。`,
    ru: `Официальное объявление HNU 2026 включает «${en}» уровня ${level === 'master' ? 'магистратуры' : 'докторантуры'} среди программ на китайском и английском языках; срок Type B 1 марта 2026 года закрыт.`,
  },
  riskFlags: ['2026_application_cycle_closed', 'scholarship_route_evidence'],
}))

const sduPrograms = [
  candidate({
    id: 'wave8-sdu-undergraduate-preparatory-program',
    institutionSlug: 'shandong-university',
    name: { en: 'Undergraduate Preparatory Program', zh: '国际学生本科预科项目', ru: 'Подготовительная программа для бакалавриата' },
    programType: 'foundation',
    level: 'foundation',
    officialUrl: 'https://istudy.sdu.edu.cn/info/1291/3970.htm',
    sourceTitle: 'Shandong University 2026 Undergraduate Preparatory Program',
    applicationUrl: 'https://istudy.sdu.edu.cn/info/1291/3970.htm',
    summary: {
      en: 'Shandong University publishes a dedicated 2026 application instruction page for its international undergraduate preparatory program. Image-only dynamic details are not guessed.',
      zh: '山东大学为国际学生本科预科项目发布了独立的2026申请说明页面；图片中的动态费用和日期未被猜测填充。',
      ru: 'Шаньдунский университет публикует отдельную официальную страницу подачи на подготовительную программу 2026 года; динамические данные из изображений не предполагаются.',
    },
    riskFlags: ['image_only_dynamic_fields', 'current_cycle_details_not_machine_verified'],
  }),
  candidate({
    id: 'wave8-sdu-chinese-language-program-2026',
    institutionSlug: 'shandong-university',
    name: { en: '2026 Chinese Language Program', zh: '2026国际学生汉语研修项目', ru: 'Программа китайского языка для иностранных студентов 2026' },
    programType: 'language',
    level: 'language',
    language: 'Chinese',
    officialUrl: 'https://istudy.sdu.edu.cn/info/1291/3969.htm',
    sourceTitle: 'Shandong University 2026 Chinese Language Program',
    applicationUrl: 'https://istudy.sdu.edu.cn/info/1291/3969.htm',
    summary: {
      en: 'Shandong University publishes a dedicated 2026 application instruction page for its Chinese language program for international students. Unparsed image-only fees and dates are withheld.',
      zh: '山东大学为国际学生汉语研修项目发布了独立的2026申请说明页面；未解析的图片费用和日期不予外推。',
      ru: 'Шаньдунский университет публикует отдельную официальную страницу программы китайского языка 2026 года для иностранных студентов; нераспознанные суммы и сроки не предполагаются.',
    },
    riskFlags: ['image_only_dynamic_fields', 'current_cycle_details_not_machine_verified'],
  }),
]

const scholarshipCandidates = [
  scholarship({
    id: 'wave8-jlu-csc-high-level-postgraduate-type-b',
    institutionSlug: 'jilin-university',
    name: { en: 'Jilin University CSC High-level Postgraduate Program (Type B)', zh: '吉林大学中国政府奖学金高水平研究生项目（B类）', ru: 'Программа CSC для аспирантов высокого уровня в JLU (тип B)' },
    scope: 'Full-time international master and doctoral applicants applying directly through Jilin University.',
    applicableLevels: ['master', 'doctorate'],
    funding: { status: 'known', tiers: ['Tuition, medical insurance, living allowance and accommodation subsidy; CNY 700/month accommodation for master and CNY 1,000/month for doctorate'] },
    cycles: [hnuCycle],
    officialUrl: 'https://cie.jlu.edu.cn/info/1079/3598.htm',
    sourceTitle: 'Jilin University 2026–2027 CSC High-level Postgraduate Program (Type B)',
    summary: {
      en: 'JLU confirms Type B coverage for tuition, insurance, living costs and accommodation subsidy for international master and doctoral students. The 1 March 2026 deadline is closed.',
      zh: '吉林大学确认B类高水平研究生项目资助国际硕博生的学费、保险、生活费和住宿补助；2026年3月1日截止，当前已关闭。',
      ru: 'JLU подтверждает покрытие обучения, страховки, проживания и стипендии для иностранных магистрантов и докторантов; срок 1 марта 2026 года закрыт.',
    },
    riskFlags: ['2026_application_cycle_closed'],
  }),
  scholarship({
    id: 'wave8-jlu-csc-bilateral-type-a',
    institutionSlug: 'jilin-university',
    name: { en: 'Chinese Government Scholarship Bilateral Program at JLU (Type A)', zh: '吉林大学中国政府奖学金国别双边项目（A类）', ru: 'Двусторонняя программа CSC в JLU (тип A)' },
    scope: 'Eligible international bachelor, master, doctoral and visiting applicants applying through the dispatching authority in their home country.',
    applicableLevels: ['bachelor', 'master', 'doctorate', 'other'],
    funding: { status: 'known', tiers: ['Application fee and tuition, living allowance, accommodation subsidy and comprehensive medical insurance'] },
    officialUrl: 'https://cie.jlu.edu.cn/info/1189/3601.htm',
    sourceTitle: 'Jilin University 2026–2027 CSC Bilateral Program (Type A)',
    summary: {
      en: 'JLU confirms the bilateral Type A route and its tuition, living, accommodation and insurance coverage. Country dispatching authorities set the exact January–April application window, so no single deadline is asserted.',
      zh: '吉林大学确认A类国别双边项目覆盖学费、生活费、住宿补助和保险；具体1—4月申请窗口由各国派遣部门确定，因此不设单一截止日。',
      ru: 'JLU подтверждает двусторонний маршрут Type A с покрытием обучения, проживания, пособия и страховки; точные сроки января–апреля устанавливает направляющий орган страны.',
    },
    riskFlags: ['country_specific_deadline', 'dispatching_authority_route'],
  }),
  scholarship({
    id: 'wave8-hnu-csc-high-level-postgraduate',
    institutionSlug: 'hunan-university',
    name: { en: 'Hunan University CSC High-level Postgraduate Program', zh: '湖南大学中国政府奖学金高水平研究生项目', ru: 'Программа CSC для аспирантов высокого уровня в HNU' },
    scope: 'International master and doctoral applicants applying to Hunan University through CSC Type B.',
    applicableLevels: ['master', 'doctorate'],
    funding: { status: 'known', tiers: ['Tuition, university dormitory or subsidy, insurance, CNY 3,000/month for master and CNY 3,500/month for doctorate'] },
    cycles: [hnuCycle],
    officialUrl: hnuUrl,
    sourceTitle: 'Hunan University 2026 CSC High-level Postgraduate Program',
    summary: {
      en: 'HNU publishes full Type B coverage including tuition, accommodation, insurance and monthly stipends of CNY 3,000 for master and CNY 3,500 for doctorate. The 2026 deadline is closed.',
      zh: '湖南大学公布B类项目覆盖学费、住宿、保险，并为硕士和博士分别提供每月3000元和3500元生活费；2026截止日已过。',
      ru: 'HNU публикует покрытие обучения, проживания, страховки и стипендии 3 000 юаней для магистратуры и 3 500 для докторантуры; срок 2026 года закрыт.',
    },
    riskFlags: ['2026_application_cycle_closed'],
  }),
  scholarship({
    id: 'wave8-sdu-csc-type-b',
    institutionSlug: 'shandong-university',
    name: { en: 'Shandong University Chinese Government Scholarship (Type B)', zh: '山东大学中国政府奖学金B类项目', ru: 'Стипендия правительства Китая в SDU (тип B)' },
    scope: 'International applicants following Shandong University’s official 2026 Type B application guide.',
    applicableLevels: ['master', 'doctorate'],
    funding: { status: 'officially_not_announced', tiers: [] },
    officialUrl: 'https://istudy.sdu.edu.cn/info/1291/3949.htm',
    sourceTitle: 'Shandong University 2026 Chinese Government Scholarship (Type B)',
    summary: {
      en: 'SDU publishes a dedicated 2026 Type B application guide. Funding details and dates are withheld until the image-based notice is independently parsed.',
      zh: '山东大学发布了独立的2026中国政府奖学金B类申请指南；图片中的资助明细和日期在独立解析前不予外推。',
      ru: 'SDU публикует отдельное руководство Type B на 2026 год; суммы и сроки из изображения не предполагаются до независимого разбора.',
    },
    riskFlags: ['image_only_dynamic_fields'],
  }),
  scholarship({
    id: 'wave8-sdu-international-chinese-language-teachers',
    institutionSlug: 'shandong-university',
    name: { en: 'International Chinese Language Teachers Scholarship at SDU', zh: '山东大学国际中文教师奖学金', ru: 'Стипендия для преподавателей китайского языка в SDU' },
    scope: 'Eligible international applicants applying through Shandong University’s official 2026 ICLT scholarship route.',
    applicableLevels: ['master', 'bachelor', 'language'],
    funding: { status: 'officially_not_announced', tiers: [] },
    officialUrl: 'https://istudy.sdu.edu.cn/info/1291/3947.htm',
    sourceTitle: 'Shandong University 2026 International Chinese Language Teachers Scholarship',
    summary: {
      en: 'SDU publishes a dedicated 2026 International Chinese Language Teachers Scholarship guide. Coverage and dates are not inferred from the image-only content.',
      zh: '山东大学发布了独立的2026国际中文教师奖学金申请指南；图片中的资助标准和日期不作推定。',
      ru: 'SDU публикует отдельное руководство по стипендии для преподавателей китайского языка 2026 года; покрытие и сроки из изображений не предполагаются.',
    },
    riskFlags: ['image_only_dynamic_fields'],
  }),
  scholarship({
    id: 'wave8-ustc-youth-excellence-full-scholarship',
    institutionSlug: 'university-of-science-and-technology-of-china',
    name: {
      en: 'USTC Youth of Excellence Scheme Full Scholarship',
      zh: '中国科大青年卓越计划全额奖学金',
      ru: 'Полная стипендия USTC Youth of Excellence Scheme',
    },
    scope: 'Eligible non-Chinese professionals admitted to the USTC Scientific Management Leaders English-taught MBA.',
    applicableLevels: ['master'],
    funding: { status: 'known', tiers: ['Full scholarship for the designated English-taught MBA program'] },
    cycles: [{
      academicYear: '2026-2027', intake: 'autumn', intakeLabel: 'September 2026',
      applicationOpen: null, applicationDeadline: '2026-03-31', statusAsOfCheckedAt: 'closed',
      displayAsOpen: false, sourceFormat: 'canonical',
    }],
    officialUrl: ustcYouthUrl,
    sourceTitle: 'USTC 2026 Youth of Excellence Scheme of China Program',
    summary: {
      en: 'USTC confirms a full scholarship for the designated Scientific Management Leaders MBA. The 2026 university and CSC stages are closed; no later cycle is inferred.',
      zh: '中国科大官方确认“科学管理领军人才”MBA配套全额奖学金；2026校内及CSC申请阶段均已结束，不推定下一周期。',
      ru: 'USTC подтверждает полную стипендию для MBA «Лидеры научного управления»; этапы университета и CSC 2026 года закрыты, следующий цикл не предполагается.',
    },
    riskFlags: ['2026_application_cycle_closed', 'designated_program_only'],
  }),
  scholarship({
    id: 'wave8-bit-international-student-scholarship',
    institutionSlug: 'beijing-institute-of-technology',
    name: { en: 'BIT International Student Scholarship', zh: '北京理工大学国际学生奖学金', ru: 'Стипендия BIT для иностранных студентов' },
    scope: 'International bachelor, master and doctoral applicants to Beijing Institute of Technology.',
    applicableLevels: ['bachelor', 'master', 'doctorate'],
    funding: { status: 'known', tiers: ['Full-duration and one-year awards; tiers range from 25% tuition to tuition, accommodation, stipend and insurance'] },
    officialUrl: 'https://isc.bit.edu.cn/aboutbit/faq/3714638c555d436b815ec089176975e4.htm',
    sourceTitle: 'Beijing Institute of Technology 2026 Scholarships',
    summary: {
      en: 'BIT publishes multi-tier international student awards ranging from partial tuition to tuition, accommodation, stipend and insurance. The 2026 deadline has closed; the next cycle is not announced.',
      zh: '北理工公布多档国际学生奖学金，覆盖从部分学费到学费、住宿、生活费和保险；2026截止日已过，下一周期尚未公布。',
      ru: 'BIT публикует несколько уровней поддержки — от частичной оплаты обучения до обучения, проживания, стипендии и страхования; срок 2026 года закрыт.',
    },
    riskFlags: ['2026_application_cycle_closed', 'next_cycle_not_announced'],
  }),
  scholarship({
    id: 'wave8-bit-beijing-government-scholarship',
    institutionSlug: 'beijing-institute-of-technology',
    name: { en: 'Beijing Government Scholarship at BIT', zh: '北京理工大学北京市外国留学生奖学金', ru: 'Стипендия правительства Пекина в BIT' },
    scope: 'International applicants to Beijing-campus degree programs at BIT.',
    applicableLevels: ['bachelor', 'master', 'doctorate'],
    funding: { status: 'known', tiers: ['Category A: tuition, accommodation, stipend and insurance', 'Category B: tuition, accommodation and insurance', 'Category C: tuition and insurance'] },
    officialUrl: 'https://isc.bit.edu.cn/aboutbit/faq/3714638c555d436b815ec089176975e4.htm',
    sourceTitle: 'Beijing Institute of Technology 2026 Scholarships',
    summary: {
      en: 'BIT lists three Beijing Government Scholarship tiers for international applicants at its Beijing campus. The 2026 deadline is closed and no next-cycle date is inferred.',
      zh: '北理工官方列出面向北京校区国际申请人的北京市政府奖学金A、B、C三档；2026截止日已过，不推定下一周期。',
      ru: 'BIT указывает три категории Пекинской правительственной стипендии для международных заявителей пекинского кампуса; срок 2026 года закрыт.',
    },
    riskFlags: ['2026_application_cycle_closed', 'beijing_campus_only'],
  }),
  scholarship({
    id: 'wave8-whut-csc-type-b-university-program',
    institutionSlug: 'wuhan-university-of-technology',
    name: { en: 'WHUT Chinese Government Scholarship Type B University Program', zh: '武汉理工大学中国政府奖学金B类高校项目', ru: 'Университетская программа CSC типа B в WUT' },
    scope: 'International master and doctoral applicants applying through Wuhan University of Technology.',
    applicableLevels: ['master', 'doctorate'],
    funding: { status: 'known', tiers: ['Chinese Government Scholarship coverage according to the official university route'] },
    officialUrl: 'https://sie.whut.edu.cn/english/ist/po/202602/t20260227_1385159.shtml',
    sourceTitle: 'WUT 2026 Postgraduate Programs and Scholarship Routes',
    summary: {
      en: 'WUT explicitly lists the CSC Type B Chinese University Program for international master and doctoral applicants applying through WUT. The 2026 deadline is closed.',
      zh: '武汉理工大学2026国际研究生简章明确列出由学校受理的中国政府奖学金B类高校项目，适用于硕博申请人；2026周期已结束。',
      ru: 'WUT официально указывает университетскую программу CSC типа B для иностранных магистрантов и докторантов; цикл 2026 года закрыт.',
    },
    riskFlags: ['2026_application_cycle_closed'],
  }),
  scholarship({
    id: 'wave8-scut-international-scholarship-excellence',
    institutionSlug: 'south-china-university-of-technology',
    name: { en: 'SCUT International Scholarship for Excellence', zh: '华南理工大学优秀国际学生奖学金', ru: 'Стипендия SCUT за выдающиеся достижения для иностранных студентов' },
    scope: 'Self-sponsored international degree applicants across SCUT bachelor, master and doctoral programs; candidates are selected without a separate application.',
    applicableLevels: ['bachelor', 'master', 'doctorate'],
    funding: { status: 'officially_not_announced', tiers: [] },
    officialUrl: 'https://sie.scut.edu.cn/29046/list.htm',
    sourceTitle: 'SCUT International Scholarship for Excellence',
    summary: {
      en: 'SCUT confirms this award covers degree programs at all levels and selects candidates from self-sponsored applicants without a separate scholarship application. Current amounts are not announced.',
      zh: '华南理工大学确认该奖学金覆盖本硕博学位项目，从自费申请人中择优遴选，无需单独申请；当前金额未公布。',
      ru: 'SCUT подтверждает, что стипендия охватывает программы всех уровней и присуждается среди самофинансируемых заявителей без отдельной заявки; суммы не объявлены.',
    },
    riskFlags: ['funding_amount_not_announced', 'current_cycle_not_announced'],
  }),
  scholarship({
    id: 'wave8-scut-guangdong-government-scholarship',
    institutionSlug: 'south-china-university-of-technology',
    name: { en: 'Guangdong Government Outstanding International Student Scholarship at SCUT', zh: '华南理工大学广东省政府来粤留学生奖学金', ru: 'Стипендия правительства Гуандуна для иностранных студентов SCUT' },
    scope: 'Self-sponsored international degree applicants at SCUT; candidates are selected without a separate application.',
    applicableLevels: ['bachelor', 'master', 'doctorate'],
    funding: { status: 'officially_not_announced', tiers: [] },
    officialUrl: 'https://sie.scut.edu.cn/29047/list.htm',
    sourceTitle: 'SCUT Guangdong Government Outstanding International Student Scholarship',
    summary: {
      en: 'SCUT confirms the Guangdong award covers its degree programs and is selected from self-sponsored applicants without a separate application. Current funding amounts and dates are not announced.',
      zh: '华南理工大学确认广东省政府来粤留学生奖学金覆盖校内学位项目，从自费申请人中遴选且无需单独申请；当期金额和日期未公布。',
      ru: 'SCUT подтверждает, что стипендия Гуандуна охватывает программы вуза и присуждается среди самофинансируемых заявителей без отдельной заявки; суммы и сроки не объявлены.',
    },
    riskFlags: ['funding_amount_not_announced', 'current_cycle_not_announced'],
  }),
]

const output = {
  schemaVersion: 'wave8-depth-flagships.v1',
  generatedAt: `${checkedAt}T00:00:00+08:00`,
  sourceFiles: [sourceFile],
  cities: [],
  universities: [],
  programCandidates: [
    ...bitPrograms,
    ...hitPrograms,
    ...whutPrograms,
    ...scutPrograms,
    ...swufePrograms,
    ...njustPrograms,
    ...ustcPrograms,
    ...jluPrograms,
    ...hnuPrograms,
    ...sduPrograms,
  ],
  scholarshipCandidates,
  exclusions: [],
}

fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  programs: output.programCandidates.length,
  scholarships: output.scholarshipCandidates.length,
}, null, 2))
