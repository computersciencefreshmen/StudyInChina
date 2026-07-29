const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const dataDir = path.join(root, 'content', 'data')

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`)
}

function upsert(items, record) {
  const index = items.findIndex((item) => item.id === record.id)
  if (index === -1) items.push(record)
  else items[index] = record
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const sources = readJson('sources.json')
const cities = readJson('cities.json')
const universities = readJson('universities.json')
const programs = readJson('programs.json')
const cycles = readJson('admission-cycles.json')
const scholarships = readJson('scholarships.json')

const checkedAt = '2026-07-29'
const stableReviewAfter = '2026-08-28'
const weeklyReviewAfter = '2026-08-05'

const sourceRecords = [
  {
    id: 'src-thu-undergraduate-divisions-current',
    url: 'https://international.join-tsinghua.edu.cn/Divisions1.htm',
    title: 'Divisions — Tsinghua Undergraduate Admissions',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-undergraduate-fees-current',
    url: 'https://international.join-tsinghua.edu.cn/Admission1/Fees.htm',
    title: 'Fees — Tsinghua Undergraduate Admissions',
    publisher: 'Tsinghua University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-chinese-language-program-current',
    url: 'https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=254607',
    title: 'Admission of Chinese Language Program in THU',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-graduate-programs-in-english-current',
    url: 'https://yz.tsinghua.edu.cn/en/Programs/Graduate_Programs_in_English.htm',
    title: 'Graduate Programs in English',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-advanced-computing-current',
    url: 'https://ac.cs.tsinghua.edu.cn/application.html',
    title: 'PhD and Master in Advanced Computing — Application',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-llm-chinese-law-current',
    url: 'https://llm.law.tsinghua.edu.cn/2021/1118/c429a1333/page.htm',
    title: 'LL.M. in Chinese Law',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-visiting-student-current',
    url: 'https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627',
    title: 'Admission to Visiting Student Program of Tsinghua University',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-schwarzman-program-current',
    url: 'https://www.schwarzmanscholars.org/program-experience/',
    title: 'Schwarzman Scholars Program Experience',
    publisher: 'Schwarzman Scholars',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-schwarzman-application-2027',
    url: 'https://www.schwarzmanscholars.org/admissions/application-instructions/',
    title: 'Schwarzman Scholars Application Instructions — Class of 2027-2028',
    publisher: 'Schwarzman Scholars',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-uni-guangdong-university-of-technology',
    url: 'https://www.gdut.edu.cn/',
    title: 'Guangdong University of Technology',
    publisher: 'Guangdong University of Technology',
    kind: 'university',
    language: 'zh',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gdut-2026-international-admissions',
    url: 'https://iec.gdut.edu.cn/info/1005/5323.htm',
    title: '2026 International Student Admissions Guide',
    publisher: 'Guangdong University of Technology',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-zjut-2026-international-undergraduate',
    url: 'https://www.gjxy.zjut.edu.cn/ueditor/upload/file/20251125/1764050265176062.pdf',
    title: '2026 International Undergraduate Programs',
    publisher: 'Zhejiang University of Technology',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-jsu-preuniversity-english',
    url: 'https://oec.ujs.edu.cn/en/PROGRAMS/Non_Degree/CSCA_International_English_Standard_Pre_university.htm',
    title: 'CSCA International English Standard Pre-university',
    publisher: 'Jiangsu University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-jsu-preuniversity-chinese',
    url: 'https://oec.ujs.edu.cn/en/PROGRAMS/Non_Degree.htm',
    title: 'Non-degree Programs',
    publisher: 'Jiangsu University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-jsu-culture-practice',
    url: 'https://oec.ujs.edu.cn/en/PROGRAMS/Non_Degree/Culture_and_Practice_One_Semester_Program.htm',
    title: 'Culture and Practice One-Semester Program',
    publisher: 'Jiangsu University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-jsu-juris-master',
    url: 'https://oec.ujs.edu.cn/en/PROGRAMS/Master/Juris_Master.htm',
    title: 'Juris Master',
    publisher: 'Jiangsu University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-jsu-pedagogy-master',
    url: 'https://oec.ujs.edu.cn/en/PROGRAMS/Master/Pedagogy.htm',
    title: 'Pedagogy',
    publisher: 'Jiangsu University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-jsu-business-administration-master',
    url: 'https://oec.ujs.edu.cn/en/PROGRAMS/Master/Business_Administration.htm',
    title: 'Business Administration',
    publisher: 'Jiangsu University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gzhu-smart-governance-2026',
    url: 'https://gjjyxy.gzhu.edu.cn/info/1015/4924.htm',
    title: 'Public Administration (Smart Governance)',
    publisher: 'Guangzhou University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-stu-2026-international-bachelor-index',
    url: 'https://sie.stu.edu.cn/en/study.aspx?flowNo=2',
    title: '2026 International Undergraduate Programs',
    publisher: 'Shantou University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-stu-international-bachelor-brochure',
    url: 'https://sie.stu.edu.cn/upload/file/20220407/6378494039526102862185350.pdf',
    title: 'Undergraduate Programs for International Students',
    publisher: 'Shantou University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-smu-international-how-to-apply',
    url: 'https://portal.smu.edu.cn/en/info/1022/1020.htm',
    title: 'How to Apply — International Students',
    publisher: 'Southern Medical University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-smu-undergraduate-programs',
    url: 'https://www.smu.edu.cn/english/education/Undergraduate/Undergraduate_Programs.htm',
    title: 'Undergraduate Programs',
    publisher: 'Southern Medical University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-szu-2026-international-undergraduate-catalog',
    url: 'https://lxs.szu.edu.cn/info/1277/5767.htm',
    title: '2026 International Undergraduate Program Catalog',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-szu-2026-international-master-catalog',
    url: 'https://lxs.szu.edu.cn/info/1278/5777.htm',
    title: '2026 International Master Program Catalog',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-szu-2026-international-doctoral-catalog',
    url: 'https://lxs.szu.edu.cn/info/1279/5787.htm',
    title: '2026 International Doctoral Program Catalog',
    publisher: 'Shenzhen University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-szu-international-tuition-current',
    url: 'https://lxs.szu.edu.cn/en/Admissions/Tuition.htm',
    title: 'Tuition for International Students',
    publisher: 'Shenzhen University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-jnu-2026-international-undergraduate-admissions',
    url: 'https://zsb.jnu.edu.cn/2025/1205/c40322a847522/page.htm',
    title: '2026 Undergraduate Admissions Guide for International Students',
    publisher: 'Jinan University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
]

for (const source of sourceRecords) upsert(sources, source)

if (!cities.some((city) => city.id === 'city-guangzhou')) {
  throw new Error('Expected city-guangzhou to exist before adding Guangdong University of Technology')
}

upsert(universities, {
  id: 'uni-guangdong-university-of-technology',
  slug: 'guangdong-university-of-technology',
  name: {
    en: 'Guangdong University of Technology',
    zh: '广东工业大学',
    ru: 'Гуандунский технологический университет',
  },
  cityId: 'city-guangzhou',
  region: 'south',
  officialUrl: 'https://www.gdut.edu.cn/',
  admissionsUrl: 'https://iec.gdut.edu.cn/',
  summary: {
    en: 'A major engineering-focused public university in Guangzhou with official degree and non-degree routes for international students.',
    zh: '位于广州、以工科见长的公办高校，设有面向国际学生的学历与非学历项目。',
    ru: 'Крупный государственный инженерно-технологический университет в Гуанчжоу с программами для иностранных студентов.',
  },
  featured: false,
  sourceIds: ['src-uni-guangdong-university-of-technology'],
  verifiedAt: checkedAt,
  reviewAfter: stableReviewAfter,
  status: 'verified',
})

for (const [id, admissionsUrl] of [
  ['uni-guangzhou-university', 'https://gjjyxy.gzhu.edu.cn/'],
  ['uni-shantou-university', 'https://sie.stu.edu.cn/en/study.aspx?flowNo=2'],
  ['uni-southern-medical-university', 'https://istudy.smu.edu.cn/pc_en/'],
]) {
  const university = universities.find((item) => item.id === id)
  if (university) university.admissionsUrl = admissionsUrl
}

function makeProgram({
  universityId,
  universitySlug,
  en,
  zh,
  ru,
  degreeLevel,
  discipline,
  teachingLanguages,
  durationMonths = null,
  durationMonthsMax,
  programUrl,
  applyUrl,
  sourceIds,
  verificationScope = 'identity',
  languageRequirements = [],
  details,
  id,
}) {
  const slug = `${universitySlug}-${slugify(en)}-${degreeLevel}`
  return {
    id: id || `program-${slug}`,
    slug,
    universityId,
    name: { en, zh, ru },
    degreeLevel,
    discipline,
    teachingLanguages,
    durationMonths,
    ...(durationMonthsMax ? { durationMonthsMax } : {}),
    programUrl,
    applyUrl,
    languageRequirements,
    verificationScope,
    ...(details ? { details } : {}),
    sourceIds,
    verifiedAt: checkedAt,
    reviewAfter: stableReviewAfter,
    status: 'verified',
  }
}

const tsinghuaProgramCatalogUrl = 'https://yz.tsinghua.edu.cn/en/Programs/Graduate_Programs_in_English.htm'
const tsinghuaGraduateApplyUrl = 'https://yzbm.tsinghua.edu.cn/intlLogin'

upsert(programs, makeProgram({
  id: 'program-tsinghua-university-computer-science-bachelor',
  universityId: 'uni-tsinghua-university',
  universitySlug: 'tsinghua-university',
  en: 'Computer Science and Technology',
  zh: '计算机科学与技术',
  ru: 'Компьютерные науки и технологии',
  degreeLevel: 'bachelor',
  discipline: 'engineering',
  teachingLanguages: ['Chinese', 'English'],
  durationMonths: 48,
  programUrl: 'https://international.join-tsinghua.edu.cn/Divisions1.htm',
  applyUrl: 'https://apply.join-tsinghua.edu.cn/international',
  sourceIds: ['src-thu-undergraduate-divisions-current', 'src-thu-undergraduate-fees-current'],
  verificationScope: 'facts',
}))

// Preserve the public URL shipped by the original catalog while upgrading the
// record from draft to verified. Existing bookmarks must not break.
programs.find(
  (program) => program.id === 'program-tsinghua-university-computer-science-bachelor',
).slug = 'tsinghua-university-computer-science-bachelor'

upsert(programs, makeProgram({
  id: 'program-tsinghua-university-chinese-language-program-language',
  universityId: 'uni-tsinghua-university',
  universitySlug: 'tsinghua-university',
  en: 'Chinese Language Program',
  zh: '汉语进修项目',
  ru: 'Программа китайского языка',
  degreeLevel: 'language',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  programUrl: 'https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=254607',
  applyUrl: 'https://intl-nondegree.tsinghua.edu.cn/f/login',
  sourceIds: ['src-thu-chinese-language-program-current'],
  verificationScope: 'identity',
}))

upsert(programs, makeProgram({
  universityId: 'uni-tsinghua-university',
  universitySlug: 'tsinghua-university',
  en: 'Visiting Student Program',
  zh: '国际访问学生项目',
  ru: 'Программа для приглашённых студентов',
  degreeLevel: 'other',
  discipline: 'other',
  teachingLanguages: ['Chinese', 'English'],
  durationMonths: null,
  programUrl: 'https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627',
  applyUrl: 'https://intl-nondegree.tsinghua.edu.cn/f/login',
  sourceIds: ['src-thu-visiting-student-current'],
  verificationScope: 'facts',
  languageRequirements: [
    { test: 'IELTS', minimum: '6.5 when required by the selected English-medium courses' },
    { test: 'TOEFL', minimum: '90 when required by the selected English-medium courses' },
  ],
}))

const tsinghuaEnglishGraduatePrograms = [
  ['English Doctoral Program in Environmental Science, Engineering and Management', '环境科学、工程与管理英文博士项目', 'Англоязычная докторантура по экологическим наукам, инженерии и управлению', 'doctorate', 'engineering'],
  ['Doctoral Program in Computer Science and Technology', '计算机科学与技术博士项目', 'Докторантура по компьютерным наукам и технологиям', 'doctorate', 'engineering'],
  ['International Doctoral Program of Materials Science and Engineering', '材料科学与工程国际博士项目', 'Международная докторантура по материаловедению и инженерии', 'doctorate', 'engineering'],
  ['Doctoral Program in Communication and Global Development', '传播与全球发展博士项目', 'Докторантура по коммуникациям и глобальному развитию', 'doctorate', 'humanities'],
  ['Doctoral Program in Global Health', '全球健康博士项目', 'Докторантура по глобальному здравоохранению', 'doctorate', 'medicine'],
  ['Doctoral Program in Mathematics', '数学博士项目', 'Докторантура по математике', 'doctorate', 'science'],
  ['Doctoral Program in Environmental Science and New Energy Technology', '环境科学与新能源技术博士项目', 'Докторантура по экологическим наукам и новым энергетическим технологиям', 'doctorate', 'engineering'],
  ['Doctoral Program in Data Science and Information Technology', '数据科学与信息技术博士项目', 'Докторантура по науке о данных и информационным технологиям', 'doctorate', 'engineering'],
  ['Doctoral Program in Precision Medicine and Healthcare', '精准医学与健康博士项目', 'Докторантура по прецизионной медицине и здравоохранению', 'doctorate', 'medicine'],
  ["Master's Program in Architecture", '建筑学硕士项目', 'Магистратура по архитектуре', 'master', 'engineering'],
  ["Master's Program in International Construction and Project Management", '国际建设与项目管理硕士项目', 'Магистратура по международному строительству и управлению проектами', 'master', 'engineering'],
  ["Master's Program in Environmental Science, Engineering and Management", '环境科学、工程与管理硕士项目', 'Магистратура по экологическим наукам, инженерии и управлению', 'master', 'engineering'],
  ["Master's Program in Vehicle and Mobility", '车辆与出行硕士项目', 'Магистратура по транспортным средствам и мобильности', 'master', 'engineering'],
  ["Master's Program in Global Manufacturing and Analytics", '全球制造与分析硕士项目', 'Магистратура по глобальному производству и аналитике', 'master', 'engineering'],
  ['International Master of Engineering Management', '国际工程管理硕士项目', 'Международная магистратура по инженерному менеджменту', 'master', 'business'],
  ["Master's Program in Electronic and Information Engineering", '电子与信息工程硕士项目', 'Магистратура по электронике и информационной инженерии', 'master', 'engineering'],
  ["Master's Program in Advanced Computing", '高级计算硕士项目', 'Магистратура по передовым вычислениям', 'master', 'engineering'],
  ['International Master in Nuclear Engineering and Management', '核工程与管理国际硕士项目', 'Международная магистратура по ядерной инженерии и управлению', 'master', 'engineering'],
  ['International Master Program of Materials Science and Engineering', '材料科学与工程国际硕士项目', 'Международная магистратура по материаловедению и инженерии', 'master', 'engineering'],
  ['Tsinghua Global MBA Program', '清华全球工商管理硕士项目', 'Глобальная программа MBA Университета Цинхуа', 'master', 'business'],
  ['Master of Global Industrial Innovation', '全球产业创新硕士项目', 'Магистратура по глобальным промышленным инновациям', 'master', 'business'],
  ['Master of Public Administration in International Development', '国际发展公共管理硕士项目', 'Магистратура государственного управления в международном развитии', 'master', 'law-ir'],
  ['International Master of Public Administration', '国际公共管理硕士项目', 'Международная магистратура государственного управления', 'master', 'law-ir'],
  ["LL.M. in Chinese Law", '中国法法学硕士项目', 'Магистратура права по китайскому праву', 'master', 'law-ir'],
  ["Master's Program in Global Business Journalism", '全球财经新闻硕士项目', 'Магистратура по глобальной деловой журналистике', 'master', 'humanities'],
  ["Master's Program in Chinese Politics, Foreign Policy and International Relations", '中国政治、外交政策与国际关系硕士项目', 'Магистратура по политике Китая, внешней политике и международным отношениям', 'master', 'law-ir'],
  ['Master of International Affairs, Global Governance', '国际事务与全球治理硕士项目', 'Магистратура по международным отношениям и глобальному управлению', 'master', 'law-ir'],
  ['International Master of Applied Psychology', '应用心理学国际硕士项目', 'Международная магистратура по прикладной психологии', 'master', 'science'],
  ['International Master of Public Health', '公共卫生国际硕士项目', 'Международная магистратура по общественному здравоохранению', 'master', 'medicine'],
  ["Master's Program in General Medicine", '全科医学硕士项目', 'Магистратура по общей медицине', 'master', 'medicine'],
  ["Master's Program in Green Environmental Infrastructure", '绿色环境基础设施硕士项目', 'Магистратура по зелёной экологической инфраструктуре', 'master', 'engineering'],
  ["Master's Program in Environmental Science and New Energy Technology", '环境科学与新能源技术硕士项目', 'Магистратура по экологическим наукам и новым энергетическим технологиям', 'master', 'engineering'],
  ["Master's Program in Precision Medicine and Healthcare", '精准医学与健康硕士项目', 'Магистратура по прецизионной медицине и здравоохранению', 'master', 'medicine'],
  ['Logistics Engineering and Management', '物流工程与管理硕士项目', 'Магистратура по логистической инженерии и управлению', 'master', 'business'],
  ['Master of Urban Systems in Human Habitats', '人居环境城市系统硕士项目', 'Магистратура по городским системам среды обитания', 'master', 'engineering'],
  ["Master's Program in Data Science and Information Technology", '数据科学与信息技术硕士项目', 'Магистратура по науке о данных и информационным технологиям', 'master', 'engineering'],
  ["Master's Program in Future Industry and Technology", '未来产业与技术硕士项目', 'Магистратура по технологиям и индустриям будущего', 'master', 'engineering'],
]

for (const [en, zh, ru, degreeLevel, discipline] of tsinghuaEnglishGraduatePrograms) {
  const isAdvancedComputing = en === "Master's Program in Advanced Computing"
  const isLlm = en === 'LL.M. in Chinese Law'
  const isSchwarzman = en === 'Schwarzman Scholars Program'
  if (isSchwarzman) continue
  upsert(programs, makeProgram({
    universityId: 'uni-tsinghua-university',
    universitySlug: 'tsinghua-university',
    en,
    zh,
    ru,
    degreeLevel,
    discipline,
    teachingLanguages: ['English'],
    durationMonths: isAdvancedComputing ? 24 : isLlm ? 12 : null,
    programUrl: isAdvancedComputing
      ? 'https://ac.cs.tsinghua.edu.cn/application.html'
      : isLlm
        ? 'https://llm.law.tsinghua.edu.cn/2021/1118/c429a1333/page.htm'
        : tsinghuaProgramCatalogUrl,
    applyUrl: tsinghuaGraduateApplyUrl,
    sourceIds: isAdvancedComputing
      ? ['src-thu-advanced-computing-current', 'src-thu-graduate-programs-in-english-current']
      : isLlm
        ? ['src-thu-llm-chinese-law-current', 'src-thu-graduate-programs-in-english-current']
        : ['src-thu-graduate-programs-in-english-current'],
    verificationScope: isAdvancedComputing || isLlm ? 'facts' : 'identity',
    languageRequirements: isAdvancedComputing
      ? [
          { test: 'IELTS', minimum: '6.5' },
          { test: 'TOEFL', minimum: '85' },
        ]
      : isLlm
        ? [
            { test: 'IELTS', minimum: '6.0' },
            { test: 'TOEFL', minimum: '90' },
          ]
        : [],
  }))
}

upsert(programs, makeProgram({
  universityId: 'uni-tsinghua-university',
  universitySlug: 'tsinghua-university',
  en: 'Doctoral Program in Advanced Computing',
  zh: '高级计算博士项目',
  ru: 'Докторантура по передовым вычислениям',
  degreeLevel: 'doctorate',
  discipline: 'engineering',
  teachingLanguages: ['English'],
  programUrl: 'https://ac.cs.tsinghua.edu.cn/application.html',
  applyUrl: tsinghuaGraduateApplyUrl,
  sourceIds: ['src-thu-advanced-computing-current'],
  verificationScope: 'facts',
  languageRequirements: [
    { test: 'IELTS', minimum: '6.5' },
    { test: 'TOEFL', minimum: '85' },
  ],
}))

const schwarzmanProgram = makeProgram({
  universityId: 'uni-tsinghua-university',
  universitySlug: 'tsinghua-university',
  en: 'Schwarzman Scholars — Master of Global Affairs',
  zh: '苏世民学者项目——全球事务硕士',
  ru: 'Schwarzman Scholars — магистратура по глобальным вопросам',
  degreeLevel: 'master',
  discipline: 'law-ir',
  teachingLanguages: ['English'],
  durationMonths: 12,
  programUrl: 'https://www.schwarzmanscholars.org/program-experience/',
  applyUrl: 'https://www.schwarzmanscholars.org/admissions/application-instructions/',
  sourceIds: [
    'src-schwarzman-program-current',
    'src-schwarzman-application-2027',
    'src-thu-graduate-programs-in-english-current',
  ],
  verificationScope: 'complete',
  languageRequirements: [
    {
      test: 'other',
      minimum: 'Official English proficiency evidence is required unless the applicant qualifies for the English-medium study exemption.',
    },
  ],
  details: {
    faculty: {
      en: 'Schwarzman College',
      zh: '苏世民书院',
      ru: 'Колледж Шварцмана',
    },
    overview: {
      en: 'A fully funded, one-year Master of Global Affairs at Tsinghua University focused on China, leadership and global affairs.',
      zh: '清华大学一年制全额资助全球事务硕士项目，核心方向包括中国、领导力与全球事务。',
      ru: 'Полностью финансируемая годичная магистратура Университета Цинхуа по глобальным вопросам, Китаю и лидерству.',
    },
    qualification: {
      en: 'Master of Global Affairs',
      zh: '全球事务硕士',
      ru: 'Магистр глобальных вопросов',
    },
    studyMode: 'full-time',
    languagePolicy: {
      en: 'The application and program are conducted in English; non-native speakers must meet the official English-evidence rules.',
      zh: '申请和培养使用英语；非英语母语申请人须满足官方英语能力证明要求。',
      ru: 'Заявка и обучение проходят на английском; неносители должны выполнить официальные требования к подтверждению языка.',
    },
    curriculumHighlights: [
      {
        en: 'China and global affairs',
        zh: '中国与全球事务',
        ru: 'Китай и глобальные вопросы',
      },
      {
        en: 'Leadership development',
        zh: '领导力发展',
        ru: 'Развитие лидерских качеств',
      },
      {
        en: 'Immersive field learning',
        zh: '沉浸式实践学习',
        ru: 'Практическое обучение с погружением',
      },
    ],
    eligibility: [
      {
        en: 'Applicants must complete all undergraduate degree requirements by August 1, 2027.',
        zh: '申请人须在2027年8月1日前完成本科学位全部要求。',
        ru: 'Все требования бакалавриата должны быть выполнены до 1 августа 2027 года.',
      },
      {
        en: 'Candidates must be at least 18 but not yet 29 on August 1, 2027.',
        zh: '申请人在2027年8月1日须年满18岁且未满29岁。',
        ru: 'На 1 августа 2027 года кандидату должно быть не менее 18 и менее 29 лет.',
      },
    ],
    applicationMaterials: [
      {
        en: 'Online application and academic records',
        zh: '在线申请与学业材料',
        ru: 'Онлайн-заявка и академические документы',
      },
      {
        en: 'Essays, recommendations and required video',
        zh: '申请文书、推荐信及规定视频',
        ru: 'Эссе, рекомендации и обязательное видео',
      },
    ],
    campus: {
      en: 'Schwarzman College, Tsinghua University, Beijing',
      zh: '北京清华大学苏世民书院',
      ru: 'Колледж Шварцмана, Университет Цинхуа, Пекин',
    },
  },
})
upsert(programs, schwarzmanProgram)

const tsinghuaRemovedCycleIds = new Set([
  'cycle-2027-tsinghua-university-computer-science-bachelor',
  'cycle-2027-tsinghua-university-chinese-language-program-language',
])
for (let index = cycles.length - 1; index >= 0; index -= 1) {
  if (tsinghuaRemovedCycleIds.has(cycles[index].id)) cycles.splice(index, 1)
}

upsert(cycles, {
  id: 'cycle-2027-schwarzman-scholars-global',
  programId: schwarzmanProgram.id,
  academicYear: '2027-2028',
  intake: 'autumn',
  opensOn: '2026-04-08',
  closesOn: '2026-09-09',
  dateStatus: 'published',
  tuitionCny: null,
  tuitionPeriod: null,
  tuitionStatus: null,
  evidenceBasis: 'cycle-specific',
  factScope: 'dates-only',
  applicationFeeCny: null,
  notes: {
    en: 'The September 9 deadline is for U.S. and global applicants. Applicants with Chinese citizenship use the separate China application cycle.',
    zh: '9月9日截止日期适用于美国及全球申请人；中国籍申请人使用单独的中国区申请周期。',
    ru: 'Срок 9 сентября относится к заявителям из США и других стран; для граждан Китая действует отдельный цикл.',
  },
  sourceIds: ['src-schwarzman-application-2027'],
  verifiedAt: checkedAt,
  reviewAfter: weeklyReviewAfter,
  status: 'verified',
})

upsert(scholarships, {
  id: 'scholarship-schwarzman-scholars-2027',
  slug: 'schwarzman-scholars-2027',
  name: {
    en: 'Schwarzman Scholars — Class of 2027-2028',
    zh: '苏世民学者项目（2027—2028级）',
    ru: 'Стипендия Schwarzman Scholars 2027–2028',
  },
  providerType: 'other',
  universityIds: ['uni-tsinghua-university'],
  programIds: [schwarzmanProgram.id],
  coverage: {
    tuition: 'full',
    accommodation: 'full',
    insurance: true,
    stipendCnyPerMonth: null,
  },
  deadline: '2026-09-09',
  applicationUrl: 'https://www.schwarzmanscholars.org/admissions/application-instructions/',
  summary: {
    en: 'A fully funded one-year Master of Global Affairs at Tsinghua University. The listed deadline applies to the U.S./global application route.',
    zh: '清华大学一年制全额资助全球事务硕士项目；所列截止日期适用于美国及全球申请通道。',
    ru: 'Полностью финансируемая годичная магистратура по глобальным вопросам в Университете Цинхуа; указан срок для международного маршрута.',
  },
  sourceIds: ['src-schwarzman-program-current', 'src-schwarzman-application-2027'],
  verifiedAt: checkedAt,
  reviewAfter: weeklyReviewAfter,
  status: 'verified',
})

const gdutPrograms = [
  ['E-commerce', '电子商务', 'Электронная коммерция', 'bachelor', 'business', ['English'], 48],
  ['Computer Science and Technology', '计算机科学与技术', 'Компьютерные науки и технологии', 'bachelor', 'engineering', ['English'], 48],
  ['International Economics and Trade', '国际经济与贸易', 'Международная экономика и торговля', 'bachelor', 'business', ['English'], 48],
  ['Civil Engineering (Chinese International Student Class)', '土木工程（中文国际学生班）', 'Строительство (китайскоязычная международная группа)', 'bachelor', 'engineering', ['Chinese'], 48],
]
for (const [en, zh, ru, degreeLevel, discipline, teachingLanguages, durationMonths] of gdutPrograms) {
  upsert(programs, makeProgram({
    universityId: 'uni-guangdong-university-of-technology',
    universitySlug: 'guangdong-university-of-technology',
    en,
    zh,
    ru,
    degreeLevel,
    discipline,
    teachingLanguages,
    durationMonths,
    programUrl: 'https://iec.gdut.edu.cn/info/1005/5323.htm',
    applyUrl: 'https://apply.gdut.edu.cn/',
    sourceIds: ['src-gdut-2026-international-admissions'],
    verificationScope: 'facts',
  }))
}

const gdutLanguageProgram = makeProgram({
  universityId: 'uni-guangdong-university-of-technology',
  universitySlug: 'guangdong-university-of-technology',
  en: 'Chinese Language Training — One Semester',
  zh: '汉语言培训（一学期）',
  ru: 'Курс китайского языка — один семестр',
  degreeLevel: 'language',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  programUrl: 'https://iec.gdut.edu.cn/info/1005/5323.htm',
  applyUrl: 'https://apply.gdut.edu.cn/',
  sourceIds: ['src-gdut-2026-international-admissions'],
  verificationScope: 'facts',
})
upsert(programs, gdutLanguageProgram)
upsert(cycles, {
  id: 'cycle-gdut-chinese-language-training-rolling',
  programId: gdutLanguageProgram.id,
  academicYear: '2026-2027',
  intake: 'other',
  opensOn: null,
  closesOn: null,
  dateStatus: 'rolling',
  tuitionCny: 8000,
  tuitionPeriod: 'semester',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'recurring-official-rule',
  factScope: 'partial',
  applicationFeeCny: 400,
  sourceIds: ['src-gdut-2026-international-admissions'],
  verifiedAt: checkedAt,
  reviewAfter: weeklyReviewAfter,
  status: 'verified',
})

const zjutPrograms = [
  ['Chemical Engineering and Technology', '化学工程与工艺', 'Химическая инженерия и технология', 'engineering'],
  ['Pharmaceutical Science', '药学', 'Фармацевтические науки', 'medicine'],
  ['Environmental Engineering', '环境工程', 'Экологическая инженерия', 'engineering'],
  ['Mechanical Engineering', '机械工程', 'Машиностроение', 'engineering'],
  ['Computer Science and Technology', '计算机科学与技术', 'Компьютерные науки и технологии', 'engineering'],
]
for (const [en, zh, ru, discipline] of zjutPrograms) {
  upsert(programs, makeProgram({
    universityId: 'uni-zhejiang-university-of-technology',
    universitySlug: 'zhejiang-university-of-technology',
    en,
    zh,
    ru,
    degreeLevel: 'bachelor',
    discipline,
    teachingLanguages: ['English'],
    durationMonths: 48,
    programUrl: 'https://www.gjxy.zjut.edu.cn/ueditor/upload/file/20251125/1764050265176062.pdf',
    applyUrl: 'https://zjut.at0086.cn/student',
    sourceIds: ['src-zjut-2026-international-undergraduate'],
    verificationScope: 'facts',
  }))
}

const jsuPrograms = [
  ['CSCA International English Standard Pre-university', 'CSCA国际英文标准预科', 'Международная англоязычная подготовительная программа CSCA', 'foundation', 'other', ['English'], null, 'https://oec.ujs.edu.cn/en/PROGRAMS/Non_Degree/CSCA_International_English_Standard_Pre_university.htm', 'src-jsu-preuniversity-english'],
  ['CSCA International Chinese Standard Pre-university — One Year', 'CSCA国际中文标准预科（一年）', 'Международная китайскоязычная подготовительная программа CSCA — один год', 'foundation', 'chinese-education', ['Chinese'], 12, 'https://oec.ujs.edu.cn/en/PROGRAMS/Non_Degree.htm', 'src-jsu-preuniversity-chinese'],
  ['Culture and Practice — One Semester', '文化与实践（一学期）', 'Культура и практика — один семестр', 'other', 'chinese-education', ['Chinese'], null, 'https://oec.ujs.edu.cn/en/PROGRAMS/Non_Degree/Culture_and_Practice_One_Semester_Program.htm', 'src-jsu-culture-practice'],
  ['Juris Master', '法律硕士', 'Магистр права', 'master', 'law-ir', ['Chinese', 'English'], 36, 'https://oec.ujs.edu.cn/en/PROGRAMS/Master/Juris_Master.htm', 'src-jsu-juris-master'],
  ['Pedagogy', '教育学', 'Педагогика', 'master', 'humanities', ['Chinese', 'English'], 36, 'https://oec.ujs.edu.cn/en/PROGRAMS/Master/Pedagogy.htm', 'src-jsu-pedagogy-master'],
  ['Business Administration', '工商管理', 'Деловое администрирование', 'master', 'business', ['Chinese', 'English'], 36, 'https://oec.ujs.edu.cn/en/PROGRAMS/Master/Business_Administration.htm', 'src-jsu-business-administration-master'],
]
for (const [en, zh, ru, degreeLevel, discipline, teachingLanguages, durationMonths, programUrl, sourceId] of jsuPrograms) {
  upsert(programs, makeProgram({
    universityId: 'uni-jiangsu-university',
    universitySlug: 'jiangsu-university',
    en,
    zh,
    ru,
    degreeLevel,
    discipline,
    teachingLanguages,
    durationMonths,
    programUrl,
    applyUrl: 'https://admission.ujs.edu.cn/',
    sourceIds: [sourceId],
    verificationScope: 'facts',
  }))
}

upsert(programs, makeProgram({
  universityId: 'uni-guangzhou-university',
  universitySlug: 'guangzhou-university',
  en: 'Public Administration (Smart Governance)',
  zh: '行政管理（智慧治理方向）',
  ru: 'Государственное управление (умное управление)',
  degreeLevel: 'bachelor',
  discipline: 'law-ir',
  teachingLanguages: [],
  durationMonths: 48,
  programUrl: 'https://gjjyxy.gzhu.edu.cn/info/1015/4924.htm',
  applyUrl: 'https://gjjyxy.gzhu.edu.cn/',
  sourceIds: ['src-gzhu-smart-governance-2026'],
  verificationScope: 'facts',
}))

const shantouPrograms = [
  ['Clinical Medicine (English-taught)', '临床医学（英文授课）', 'Клиническая медицина (на английском языке)', 'medicine', ['English'], 72],
  ['Clinical Medicine (Chinese/English-taught)', '临床医学（中英双语授课）', 'Клиническая медицина (на китайском и английском)', 'medicine', ['Chinese', 'English'], 60],
  ['Optometry Medicine (English-taught)', '眼视光医学（英文授课）', 'Оптометрическая медицина (на английском языке)', 'medicine', ['English'], 60],
  ['Computer Science and Technology', '计算机科学与技术', 'Компьютерные науки и технологии', 'engineering', [], null],
  ['International Economics and Trade', '国际经济与贸易', 'Международная экономика и торговля', 'business', [], null],
]
for (const [en, zh, ru, discipline, teachingLanguages, durationMonths] of shantouPrograms) {
  upsert(programs, makeProgram({
    universityId: 'uni-shantou-university',
    universitySlug: 'shantou-university',
    en,
    zh,
    ru,
    degreeLevel: 'bachelor',
    discipline,
    teachingLanguages,
    durationMonths,
    programUrl: 'https://sie.stu.edu.cn/en/study.aspx?flowNo=2',
    applyUrl: 'https://stu.at0086.cn/student',
    sourceIds: ['src-stu-2026-international-bachelor-index', 'src-stu-international-bachelor-brochure'],
    verificationScope: durationMonths ? 'facts' : 'identity',
  }))
}

upsert(programs, makeProgram({
  universityId: 'uni-southern-medical-university',
  universitySlug: 'southern-medical-university',
  en: 'Clinical Medicine',
  zh: '临床医学',
  ru: 'Клиническая медицина',
  degreeLevel: 'bachelor',
  discipline: 'medicine',
  teachingLanguages: [],
  durationMonths: 60,
  programUrl: 'https://www.smu.edu.cn/english/education/Undergraduate/Undergraduate_Programs.htm',
  applyUrl: 'https://fimmu.at0086.cn/Student',
  sourceIds: ['src-smu-undergraduate-programs', 'src-smu-international-how-to-apply'],
  verificationScope: 'facts',
}))

const shenzhenPrograms = [
  ['International Business Administration', '工商管理（英文）', 'Международное деловое администрирование', 'bachelor', 'business', 48, 'src-szu-2026-international-undergraduate-catalog'],
  ['International Economics and Trade', '国际经济与贸易（英文）', 'Международная экономика и торговля', 'bachelor', 'business', 48, 'src-szu-2026-international-undergraduate-catalog'],
  ['Financial Technology (WeBank ASEAN Class)', '金融科技（微众东盟班）', 'Финансовые технологии (класс WeBank ASEAN)', 'bachelor', 'business', 48, 'src-szu-2026-international-undergraduate-catalog'],
  ['Foreign Languages and Literature', '外国语言文学', 'Иностранные языки и литература', 'master', 'humanities', 24, 'src-szu-2026-international-master-catalog'],
  ['Area Studies', '国别和区域研究', 'Регионоведение', 'master', 'law-ir', 24, 'src-szu-2026-international-master-catalog'],
  ['Civil Engineering', '土木工程', 'Строительство', 'master', 'engineering', 36, 'src-szu-2026-international-master-catalog'],
  ['Journalism and Communication', '新闻传播学', 'Журналистика и коммуникации', 'doctorate', 'humanities', 48, 'src-szu-2026-international-doctoral-catalog'],
  ['Chemistry', '化学', 'Химия', 'doctorate', 'science', 48, 'src-szu-2026-international-doctoral-catalog'],
  ['Biology', '生物学', 'Биология', 'doctorate', 'science', 48, 'src-szu-2026-international-doctoral-catalog'],
  ['Basic Medicine', '基础医学', 'Фундаментальная медицина', 'doctorate', 'medicine', 48, 'src-szu-2026-international-doctoral-catalog'],
]
for (const [en, zh, ru, degreeLevel, discipline, durationMonths, catalogSourceId] of shenzhenPrograms) {
  const catalogSource = sourceRecords.find((source) => source.id === catalogSourceId)
  upsert(programs, makeProgram({
    universityId: 'uni-shenzhen-university',
    universitySlug: 'shenzhen-university',
    en,
    zh,
    ru,
    degreeLevel,
    discipline,
    teachingLanguages: ['English'],
    durationMonths,
    programUrl: catalogSource.url,
    applyUrl: 'https://lxs.szu.edu.cn/',
    sourceIds: [catalogSourceId, 'src-szu-international-tuition-current'],
    verificationScope: 'facts',
  }))
}

const jinanPrograms = [
  ['International Economics and Trade', '国际经济与贸易', 'Международная экономика и торговля', 'business', 48],
  ['Accounting', '会计学', 'Бухгалтерский учёт', 'business', 48],
  ['Finance', '金融学', 'Финансы', 'business', 48],
  ['Pharmacy', '药学', 'Фармация', 'medicine', 48],
  ['Computer Science and Technology', '计算机科学与技术', 'Компьютерные науки и технологии', 'engineering', 48],
  ['International Journalism and Communication', '国际新闻与传播', 'Международная журналистика и коммуникации', 'humanities', 48],
  ['Food Nutrition and Health', '食品营养与健康', 'Питание и здоровье', 'medicine', 48],
  ['Clinical Medicine', '临床医学', 'Клиническая медицина', 'medicine', 72],
]
for (const [en, zh, ru, discipline, durationMonths] of jinanPrograms) {
  upsert(programs, makeProgram({
    universityId: 'uni-jinan-university',
    universitySlug: 'jinan-university',
    en,
    zh,
    ru,
    degreeLevel: 'bachelor',
    discipline,
    teachingLanguages: ['English'],
    durationMonths,
    programUrl: 'https://zsb.jnu.edu.cn/2025/1205/c40322a847522/page.htm',
    applyUrl: 'https://lxlz.jnu.edu.cn/',
    sourceIds: ['src-jnu-2026-international-undergraduate-admissions'],
    verificationScope: 'facts',
    languageRequirements: [
      { test: 'IELTS', minimum: '5.5 overall, with each component at least 5.0' },
      { test: 'TOEFL', minimum: '80 iBT' },
    ],
  }))
}

upsert(scholarships, {
  id: 'scholarship-jnu-guangdong-government-international-students',
  slug: 'jnu-guangdong-government-international-students',
  name: {
    en: 'Guangdong Government Outstanding International Student Scholarship — Jinan University',
    zh: '广东省政府来粤留学生奖学金（暨南大学）',
    ru: 'Стипендия правительства провинции Гуандун для иностранных студентов — Университет Цзинань',
  },
  providerType: 'province',
  universityIds: ['uni-jinan-university'],
  programIds: [],
  coverage: {
    tuition: 'partial',
    accommodation: 'none',
    insurance: 'unknown',
    stipendCnyPerMonth: null,
  },
  deadline: null,
  applicationUrl: 'https://zsb.jnu.edu.cn/2025/1205/c40322a847522/page.htm',
  summary: {
    en: 'The official 2026 guide lists a first-year award of RMB 10,000 for eligible international undergraduates; the next application schedule has not yet been published.',
    zh: '官方2026简章列明，符合条件的国际本科新生第一学年可获人民币10,000元；下一申请周期尚未公布。',
    ru: 'В официальном руководстве на 2026 год указана выплата 10 000 юаней за первый год для подходящих иностранных бакалавров; следующий срок ещё не опубликован.',
  },
  sourceIds: ['src-jnu-2026-international-undergraduate-admissions'],
  verifiedAt: checkedAt,
  reviewAfter: stableReviewAfter,
  status: 'verified',
})

for (const name of [
  'sources.json',
  'universities.json',
  'programs.json',
  'admission-cycles.json',
  'scholarships.json',
]) {
  const value = {
    'sources.json': sources,
    'universities.json': universities,
    'programs.json': programs,
    'admission-cycles.json': cycles,
    'scholarships.json': scholarships,
  }[name]
  writeJson(name, value)
}

console.log(JSON.stringify({
  sources: sources.length,
  universities: universities.length,
  programs: programs.length,
  admissionCycles: cycles.length,
  scholarships: scholarships.length,
  tsinghuaPrograms: programs.filter((program) => program.universityId === 'uni-tsinghua-university' && program.status === 'verified').length,
  addedLocalStrongSchools: [
    'uni-guangdong-university-of-technology',
    'uni-zhejiang-university-of-technology',
    'uni-jiangsu-university',
    'uni-guangzhou-university',
    'uni-shantou-university',
    'uni-southern-medical-university',
  ],
}, null, 2))
