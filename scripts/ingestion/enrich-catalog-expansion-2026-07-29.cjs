const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')
const VERIFIED_AT = '2026-07-29'
const DYNAMIC_REVIEW_AFTER = '2026-08-28'
const PROFILE_REVIEW_AFTER = '2027-01-29'
const ICLT_PORTAL = 'https://pmplatform.chinese.cn/ui/start/#/login'

const l = (en, zh, ru) => ({ en, zh, ru })
const read = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
const write = (file, value) => fs.writeFileSync(
  path.join(DATA_DIR, file),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8',
)

const sources = read('sources.json')
const universities = read('universities.json')
const programs = read('programs.json')
const cycles = read('admission-cycles.json')
const scholarships = read('scholarships.json')

function requireRecord(collection, id) {
  const record = collection.find((item) => item.id === id)
  if (!record) throw new Error(`Missing record: ${id}`)
  return record
}

function chinaLinkDetails(faculty) {
  return {
    faculty,
    overview: l(
      'A fully funded, non-degree academic and scientific exchange for general or senior scholars. The official call permits 1–12 months of study, with the start date no later than August 31, 2027.',
      '面向普通进修生或高级进修生的全额资助非学历学术科研交流。官方简章允许1至12个月研修，来华学习开始时间不得晚于2027年8月31日。',
      'Полностью финансируемый академический и научный обмен без присуждения степени для обычных и старших стажёров. Срок обучения — 1–12 месяцев, начало не позднее 31 августа 2027 года.',
    ),
    qualification: l(
      'Non-degree General Scholar or Senior Scholar',
      '非学历普通进修生或高级进修生',
      'Обычный или старший стажёр без присуждения степени',
    ),
    studyMode: 'full-time',
    languagePolicy: l(
      'The working language is Chinese or English according to the host discipline. The official guide does not publish one universal score threshold.',
      '工作语言按接收学科采用中文或英文；官方简章未设置统一语言分数线。',
      'Рабочий язык — китайский или английский в зависимости от специальности; единый минимальный балл не опубликован.',
    ),
    curriculumHighlights: [
      l(
        'Academic or scientific work under an approved host-university study or research plan',
        '按照获批学习或研究计划在接收高校开展学术或科研活动',
        'Академическая или исследовательская работа по утверждённому плану принимающего вуза',
      ),
      l(
        'A flexible 1–12 month exchange in an available host field other than Chinese-language study',
        '在接收高校可提供的非汉语言专业领域开展1至12个月灵活研修',
        'Обмен продолжительностью 1–12 месяцев по доступной специальности, кроме изучения китайского языка',
      ),
    ],
    eligibility: [
      l(
        'A non-Chinese citizen in good physical and mental health',
        '非中国籍人士，身心健康',
        'Иностранный гражданин с хорошим физическим и психическим здоровьем',
      ),
      l(
        'A full-time student or full-time academic employee at an eligible overseas partner institution throughout the application and study period',
        '申请及研修期间须为符合条件的海外合作院校全日制学生或全职教职工',
        'На всём протяжении подачи и обучения — студент очной формы или штатный сотрудник подходящего зарубежного партнёрского вуза',
      ),
      l(
        'General scholars must normally be no older than 45; senior scholars no older than 50',
        '普通进修生原则上不超过45周岁，高级进修生原则上不超过50周岁',
        'Обычные стажёры — не старше 45 лет; старшие стажёры — не старше 50 лет',
      ),
      l(
        'Obtain the host university pre-admission notice or invitation before the final scholarship submission',
        '最终提交奖学金申请前须取得接收高校预录取通知或邀请函',
        'До окончательной подачи необходимо получить предварительное зачисление или приглашение принимающего вуза',
      ),
    ],
    applicationMaterials: [
      l(
        'CSC online application form and valid passport information page',
        '国家留学基金委在线申请表及有效护照信息页',
        'Онлайн-заявление CSC и информационная страница действующего паспорта',
      ),
      l(
        'Proof of current enrollment or employment, highest diploma and academic transcript',
        '在读或在职证明、最高学历证明及成绩单',
        'Подтверждение обучения или работы, документ об образовании и выписка оценок',
      ),
      l(
        'A Chinese- or English-language study/research plan and host pre-admission notice or invitation',
        '中文或英文学习／研究计划，以及接收高校预录取通知或邀请函',
        'План обучения или исследования на китайском либо английском и предварительное зачисление или приглашение',
      ),
      l(
        'For stays longer than six months, the physical examination and no-criminal-record documents required by the guide',
        '研修超过6个月时，须按简章提交体检和无犯罪记录材料',
        'При сроке свыше шести месяцев — медицинская форма и справка об отсутствии судимости',
      ),
    ],
  }
}

const chinaLinkUpdates = [
  {
    id: 'program-cdut-china-link-2026-2027',
    applyUrl: 'https://cdut.at0086.cn/student',
    faculty: l(
      'College of International Education, Chengdu University of Technology',
      '成都理工大学国际教育学院',
      'Институт международного образования Чэндусского технологического университета',
    ),
  },
  {
    id: 'program-wzu-china-link-2026-2027',
    applyUrl: 'https://studyinchina.csc.edu.cn/#/login',
    faculty: l(
      'College of International Education, Wenzhou University',
      '温州大学国际教育学院',
      'Институт международного образования Вэньчжоуского университета',
    ),
  },
]

for (const update of chinaLinkUpdates) {
  const program = requireRecord(programs, update.id)
  program.applyUrl = update.applyUrl
  program.details = chinaLinkDetails(update.faculty)
  program.verificationScope = 'complete'
}

requireRecord(cycles, 'cycle-cdut-china-link-2026-2027').notes = l(
  'Applications are rolling and study must begin no later than August 31, 2027. Both submissions are mandatory: the CDUT system (https://cdut.at0086.cn/student) and the CSC Type B system (https://studyinchina.csc.edu.cn/#/login), agency number 10616.',
  '全年滚动申请，来华学习开始时间不得晚于2027年8月31日。两套申请均为必填：成都理工大学系统（https://cdut.at0086.cn/student）及CSC Type B系统（https://studyinchina.csc.edu.cn/#/login），受理机构编号10616。',
  'Заявки принимаются постоянно, начало обучения — не позднее 31 августа 2027 года. Обязательны обе системы: CDUT (https://cdut.at0086.cn/student) и CSC Type B (https://studyinchina.csc.edu.cn/#/login), код 10616.',
)
requireRecord(cycles, 'cycle-wzu-china-link-2026-2027').notes = l(
  'First email admission@wzu.edu.cn with the subject “China Link + Name + university name” to obtain admission eligibility or pre-admission, then submit CSC Type B (agency number 10351). Applications are rolling and study must begin no later than August 31, 2027.',
  '须先邮件联系admission@wzu.edu.cn（主题“China Link + 姓名 + 所在大学”）取得入学资格或预录取，再提交CSC Type B申请（受理机构编号10351）。全年滚动申请，最晚于2027年8月31日前开始学习。',
  'Сначала напишите на admission@wzu.edu.cn с темой «China Link + имя + университет» для подтверждения права на приём, затем подайте CSC Type B (код 10351). Начало обучения — не позднее 31 августа 2027 года.',
)

const commonEligibility = (age, language, extra = []) => [
  l(
    'A non-Chinese citizen with no criminal record, in good physical and mental health, and interested in Chinese-language education or related work',
    '非中国籍，无违法犯罪记录，身心健康，并有志于从事中文教育、教学或相关工作',
    'Иностранный гражданин без судимости, с хорошим физическим и психическим здоровьем и интересом к преподаванию китайского языка',
  ),
  age,
  language,
  ...extra,
  l(
    'Applicants who received the same type of scholarship within the previous three years are normally not admitted',
    '原则上不录取近3年内享受过同类奖学金的申请人',
    'Как правило, не принимаются заявители, получавшие такую же стипендию в предыдущие три года',
  ),
]

const defaultAge = l(
  'Normally 16–35 years old as of September 1, 2026; in-service Chinese-language teachers may be up to 45',
  '截至2026年9月1日原则上为16至35周岁；在职中文教师可放宽至45周岁',
  'Как правило, 16–35 лет на 1 сентября 2026 года; для работающих преподавателей китайского языка — до 45 лет',
)
const passport = l('Valid passport photo page', '有效护照照片页', 'Страница действующего паспорта с фотографией')
const languageReports = l('Valid HSK and HSKK score reports', '有效期内的HSK和HSKK成绩报告', 'Действующие сертификаты HSK и HSKK')
const recommender = l(
  'Recommendation letter signed by the head of the recommending institution',
  '推荐机构负责人签发的推荐信',
  'Рекомендательное письмо, подписанное руководителем рекомендующей организации',
)

function icltDetails(config) {
  return {
    faculty: config.faculty,
    overview: l(
      `A five-month, full-time, non-degree scholarship program starting in March 2027. The verified direction is ${config.direction.en}.`,
      `2027年3月入学、连续5个月的全日制非学历奖学金研修项目。本次已核实方向为${config.direction.zh}。`,
      `Пятимесячная очная стипендиальная программа без присуждения степени с началом в марте 2027 года. Подтверждённое направление: ${config.direction.ru}.`,
    ),
    qualification: config.qualification ?? l(
      'Non-degree one-semester scholar',
      '非学历一学期研修生',
      'Семестровый стажёр без присуждения степени',
    ),
    studyMode: 'full-time',
    languagePolicy: config.languagePolicy,
    curriculumHighlights: config.curriculumHighlights,
    eligibility: config.eligibility,
    applicationMaterials: config.materials,
  }
}

const icltConfigs = [
  {
    key: 'hubu',
    faculty: l('Hubei University Study Abroad Office', '湖北大学留学管理办公室', 'Отдел обучения иностранных студентов Университета Хубэй'),
    direction: l('International Chinese Language Education, Chinese Language and Literature, Chinese History, Chinese Philosophy, or Taiji Culture', '国际中文教育、汉语言文学、中国历史、中国哲学或太极文化', 'международное преподавание китайского языка, китайский язык и литература, история, философия или тайцзи'),
    languagePolicy: l('Chinese-medium. Most listed directions require HSK 3 (180) plus HSKK; Taiji Culture requires HSK and prefers HSKK.', '中文授课。多数公布方向要求HSK三级180分及HSKK；太极文化要求HSK并优先考虑HSKK。', 'Обучение на китайском. Для большинства направлений требуются HSK 3 (180) и HSKK; для тайцзи — HSK, HSKK предпочтителен.'),
    curriculumHighlights: [
      l('International Chinese Language Education, language/literature, history or philosophy direction', '国际中文教育、汉语言文学、中国历史或中国哲学方向研修', 'Международное преподавание китайского, язык и литература, история или философия'),
      l('Taiji Culture direction where the host language condition is met', '达到接收语言条件时可选择太极文化方向', 'Направление тайцзи при выполнении языковых требований'),
    ],
    eligibility: commonEligibility(defaultAge, l('Meet the HSK/HSKK threshold for the selected direction and obtain an eligible recommendation', '达到所选方向的HSK／HSKK门槛并取得符合条件的推荐', 'Выполнить требования HSK/HSKK выбранного направления и получить подходящую рекомендацию')),
    materials: [passport, languageReports, recommender, l('Employment proof and employer recommendation for in-service teachers; guardianship authorization for applicants under 18', '在职教师另交在职证明和单位推荐信；未满18岁者提交在华监护委托', 'Для работающих преподавателей — справка с работы и рекомендация; для лиц младше 18 лет — документ об опеке')],
    applyUrl: 'https://hubu.at0086.cn/student',
    notes: l('Both applications are mandatory: submit in the central scholarship platform and in the Hubei University system (https://hubu.at0086.cn/student).', '两套申请均为必填：须同时在中央奖学金平台和湖北大学系统（https://hubu.at0086.cn/student）提交。', 'Обязательны обе заявки: в центральной системе и в системе Университета Хубэй (https://hubu.at0086.cn/student).'),
  },
  {
    key: 'cqnu',
    faculty: l('Office of International Cooperation and Exchange, Chongqing Normal University', '重庆师范大学国际合作与交流处', 'Управление международного сотрудничества Чунцинского педагогического университета'),
    direction: l('International Chinese Language Education, language/literature, history, philosophy, TCM, or Taiji Culture', '国际中文教育、汉语言文学、中国历史、中国哲学、中医或太极文化', 'международное преподавание китайского, язык и литература, история, философия, ТКМ или тайцзи'),
    languagePolicy: l('Chinese-medium. Language/literature/history/philosophy directions require HSK 3 (180) plus HSKK; TCM and Taiji require HSK and prefer HSKK.', '中文授课。中文教育、文学、历史和哲学方向要求HSK三级180分及HSKK；中医、太极方向要求HSK并优先HSKK。', 'Обучение на китайском. Для языка, литературы, истории и философии — HSK 3 (180) и HSKK; для ТКМ и тайцзи — HSK, HSKK предпочтителен.'),
    curriculumHighlights: [
      l('Chinese-language education, literature, history or philosophy direction', '中文教育、汉语言文学、中国历史或中国哲学方向研修', 'Китайский язык, литература, история или философия'),
      l('TCM or Taiji Culture direction where the host language condition is met', '达到接收语言条件时可选择中医或太极文化方向', 'ТКМ или тайцзи при выполнении языковых требований'),
    ],
    eligibility: commonEligibility(defaultAge, l('Meet the published HSK/HSKK requirement and obtain a recommending-institution letter', '达到公布的HSK／HSKK要求并取得推荐机构负责人推荐信', 'Выполнить требования HSK/HSKK и получить письмо рекомендующей организации')),
    materials: [
      l('Central scholarship form, CQNU application form and passport page', '中央奖学金申请表、重庆师范大学入学申请表及护照页', 'Центральная стипендиальная форма, заявление CQNU и страница паспорта'),
      languageReports,
      l('Physical examination, notarized diploma/transcript and a Chinese- or English-language study plan of at least 1,000 words', '体检表、公证学历与成绩单，以及不少于1000字的中文或英文学习计划', 'Медицинская форма, нотариальные документы об образовании и план обучения не менее 1000 слов'),
      l('No-criminal-record proof issued within six months, bank certificate of normally at least CNY 25,000, and résumé', '近6个月无犯罪记录证明、原则上不少于25,000元人民币存款证明及个人简历', 'Справка об отсутствии судимости за последние шесть месяцев, банковская справка обычно не менее 25 000 юаней и резюме'),
    ],
    applyUrl: 'https://foreignstudent.cqnu.edu.cn/',
    notes: l('Both applications are mandatory: submit in the central scholarship platform and in the CQNU system (https://foreignstudent.cqnu.edu.cn/).', '两套申请均为必填：须同时在中央奖学金平台和重庆师范大学系统（https://foreignstudent.cqnu.edu.cn/）提交。', 'Обязательны обе заявки: в центральной системе и в системе CQNU (https://foreignstudent.cqnu.edu.cn/).'),
  },
  {
    key: 'mnnu',
    faculty: l('Overseas Education College, Minnan Normal University', '闽南师范大学海外教育学院', 'Институт зарубежного образования Миньнаньского педагогического университета'),
    direction: l('International Chinese Language Education or Chinese Language and Literature', '国际中文教育或汉语言文学', 'международное преподавание китайского языка или китайский язык и литература'),
    languagePolicy: l('Chinese-medium; HSK 3 (180) and a valid HSKK score are required.', '中文授课；要求HSK三级180分及有效HSKK成绩。', 'Обучение на китайском; требуются HSK 3 (180) и действующий HSKK.'),
    curriculumHighlights: [
      l('International Chinese Language Education direction', '国际中文教育方向研修', 'Международное преподавание китайского языка'),
      l('Chinese Language and Literature direction', '汉语言文学方向研修', 'Китайский язык и литература'),
    ],
    eligibility: commonEligibility(defaultAge, l('HSK 3 (180), HSKK and an eligible recommending institution are required', '须达到HSK三级180分、具备HSKK并取得符合条件推荐机构推荐', 'Требуются HSK 3 (180), HSKK и подходящая рекомендующая организация')),
    materials: [passport, languageReports, recommender, l('Physical examination valid for six months and no-criminal-record proof issued within six months', '6个月有效期体检表及近6个月内出具的无犯罪记录证明', 'Медицинская форма и справка об отсутствии судимости сроком не более шести месяцев')],
    applyUrl: 'https://admission.mnnu.edu.cn/',
    notes: l('Both applications are mandatory: submit in the central platform and in the Minnan Normal University system (https://admission.mnnu.edu.cn/).', '两套申请均为必填：须同时在中央平台和闽南师范大学系统（https://admission.mnnu.edu.cn/）提交。', 'Обязательны обе заявки: в центральной системе и в системе MNNU (https://admission.mnnu.edu.cn/).'),
  },
  {
    key: 'zafu',
    name: l('International Chinese Language Teachers Scholarship — One-Semester Chinese Language and Literature Program (Spring 2027)', '国际中文教师奖学金一学期汉语言文学研修项目（2027年春季）', 'Стипендия для преподавателей китайского языка — семестровая программа китайского языка и литературы (весна 2027)'),
    faculty: l('College of International Education, Zhejiang A&F University', '浙江农林大学国际教育学院', 'Институт международного образования Чжэцзянского университета сельского и лесного хозяйства'),
    direction: l('Chinese Language and Literature', '汉语言文学', 'китайский язык и литература'),
    languagePolicy: l('Chinese-medium Chinese Language and Literature; HSK 3 (180) and a valid HSKK score are required.', '中文授课的汉语言文学方向；要求HSK三级180分及有效HSKK成绩。', 'Китайский язык и литература на китайском языке; требуются HSK 3 (180) и HSKK.'),
    curriculumHighlights: [
      l('Chinese Language and Literature study', '汉语言文学方向研修', 'Китайский язык и литература'),
      l('Five months beginning in March 2027', '2027年3月入学并连续研修5个月', 'Пять месяцев обучения с марта 2027 года'),
    ],
    eligibility: commonEligibility(defaultAge, l('HSK 3 (180), HSKK and an eligible recommendation are required', '须达到HSK三级180分、具备HSKK并取得符合条件推荐', 'Требуются HSK 3 (180), HSKK и подходящая рекомендация'), [
      l('The passport must not contain an X1 or X2 Chinese visa', '护照中不得有中国X1或X2签证', 'В паспорте не должно быть китайской визы X1 или X2'),
    ]),
    materials: [passport, languageReports, recommender, l('Transfer students must also provide attendance proof in China; applicants under 18 need guardianship authorization', '转校生另交在华出勤证明；未满18岁者提交在华监护委托', 'Переводящиеся студенты подают подтверждение посещаемости в Китае; лица младше 18 лет — документ об опеке')],
    applyUrl: ICLT_PORTAL,
    notes: l('Apply in the central scholarship platform through an eligible recommending institution. After award, submit the personal information and arrival confirmation requested by Zhejiang A&F University.', '通过符合条件的推荐机构在中央奖学金平台申请；获奖后按浙江农林大学要求提交个人信息并确认来华手续。', 'Подайте заявку в центральной системе через подходящую рекомендующую организацию; после присуждения выполните требования вуза для подтверждения приезда.'),
  },
  {
    key: 'fjnu',
    faculty: l('Overseas Education College, Fujian Normal University', '福建师范大学海外教育学院', 'Институт зарубежного образования Фуцзяньского педагогического университета'),
    direction: l('the host university’s one-semester Chinese-language study direction', '接收院校公布的一学期中文研修方向', 'семестровое направление китайского языка принимающего вуза'),
    languagePolicy: l('Chinese-medium; HSK 3 (180) and a valid HSKK score are required.', '中文授课；要求HSK三级180分及有效HSKK成绩。', 'Обучение на китайском; требуются HSK 3 (180) и HSKK.'),
    curriculumHighlights: [
      l('Five-month Chinese-language study beginning in March 2027', '2027年3月入学、连续5个月中文研修', 'Пятимесячное изучение китайского языка с марта 2027 года'),
      l('Online selection interview arranged by Fujian Normal University', '按福建师范大学通知参加线上选拔面试', 'Онлайн-собеседование, организуемое Фуцзяньским педагогическим университетом'),
    ],
    eligibility: commonEligibility(defaultAge, l('HSK 3 (180), HSKK, eligible recommendation and the FJNU online interview are required', '须达到HSK三级180分、具备HSKK、取得推荐并参加福建师范大学线上面试', 'Требуются HSK 3 (180), HSKK, рекомендация и онлайн-собеседование FJNU')),
    materials: [
      l('Passport valid through at least July 2027', '有效期不得早于2027年7月的护照页', 'Паспорт, действительный как минимум до июля 2027 года'),
      languageReports,
      recommender,
      l('Highest diploma/transcript, physical examination valid for six months, and no-criminal-record proof issued within six months', '最高学历及成绩单、6个月有效体检表，以及近6个月内出具的无犯罪记录证明', 'Документы об образовании, медицинская форма и справка об отсутствии судимости сроком не более шести месяцев'),
    ],
    applyUrl: ICLT_PORTAL,
    notes: l('Apply in the central platform and monitor email for the mandatory Fujian Normal University online interview.', '通过中央平台申请，并及时查收邮件参加福建师范大学要求的线上面试。', 'Подайте заявку в центральной системе и следите за почтой для обязательного онлайн-собеседования FJNU.'),
  },
  {
    key: 'ybu',
    faculty: l('International Student Section, Office of International Cooperation and Exchange, Yanbian University', '延边大学国际交流合作处国际学生科', 'Отдел иностранных студентов Управления международного сотрудничества Яньбяньского университета'),
    direction: l('International Chinese Language Education, language/literature, history, philosophy, TCM, or Taiji Culture', '国际中文教育、汉语言文学、中国历史、中国哲学、中医或太极文化', 'международное преподавание китайского, язык и литература, история, философия, ТКМ или тайцзи'),
    languagePolicy: l('Chinese-medium. Language/literature/history/philosophy directions require HSK 3 (180) plus HSKK; TCM and Taiji require HSK and prefer HSKK.', '中文授课。中文教育、文学、历史和哲学方向要求HSK三级180分及HSKK；中医、太极方向要求HSK并优先HSKK。', 'Обучение на китайском. Для языка, литературы, истории и философии — HSK 3 (180) и HSKK; для ТКМ и тайцзи — HSK, HSKK предпочтителен.'),
    curriculumHighlights: [
      l('Chinese-language education, language/literature, history or philosophy direction', '中文教育、汉语言文学、中国历史或中国哲学方向', 'Китайский язык, литература, история или философия'),
      l('TCM or Taiji Culture direction where the host language condition is met', '达到接收语言条件时可选择中医或太极文化方向', 'ТКМ или тайцзи при выполнении языковых требований'),
    ],
    eligibility: commonEligibility(defaultAge, l('Meet the HSK/HSKK threshold and obtain an eligible recommendation', '达到HSK／HSKK门槛并取得符合条件的推荐', 'Выполнить требования HSK/HSKK и получить подходящую рекомендацию')),
    materials: [passport, languageReports, recommender, l('Highest diploma/transcript, physical examination and no-criminal-record proof issued within six months', '最高学历及成绩单、6个月有效体检表及近6个月无犯罪记录证明', 'Документы об образовании, медицинская форма и справка об отсутствии судимости за последние шесть месяцев')],
    applyUrl: ICLT_PORTAL,
    notes: l('Apply in the central scholarship platform; scholarship recipients then contact Yanbian University to complete admission arrangements.', '通过中央奖学金平台申请；获奖后联系延边大学完成录取手续。', 'Подайте заявку в центральной системе; после присуждения свяжитесь с Яньбяньским университетом для оформления приёма.'),
  },
  {
    key: 'jiangnan',
    name: l('International Chinese Language Teachers Scholarship — One-Semester Chinese Language and Literature Program (Spring 2027)', '国际中文教师奖学金一学期汉语言文学研修项目（2027年春季）', 'Стипендия для преподавателей китайского языка — семестровая программа китайского языка и литературы (весна 2027)'),
    faculty: l('International Student Admissions, Jiangnan University', '江南大学国际学生招生部门', 'Отдел приёма иностранных студентов Университета Цзяннань'),
    direction: l('Chinese Language and Literature', '汉语言文学', 'китайский язык и литература'),
    languagePolicy: l('Chinese-medium Chinese Language and Literature; HSK 3 (180) and a valid HSKK score are required.', '中文授课的汉语言文学方向；要求HSK三级180分及有效HSKK成绩。', 'Китайский язык и литература на китайском языке; требуются HSK 3 (180) и HSKK.'),
    curriculumHighlights: [
      l('Chinese Language and Literature study', '汉语言文学方向研修', 'Китайский язык и литература'),
      l('Five months beginning in March 2027', '2027年3月入学并连续研修5个月', 'Пять месяцев обучения с марта 2027 года'),
    ],
    eligibility: commonEligibility(defaultAge, l('HSK 3 (180), HSKK and an eligible recommendation are required', '须达到HSK三级180分、具备HSKK并取得符合条件推荐', 'Требуются HSK 3 (180), HSKK и подходящая рекомендация')),
    materials: [passport, languageReports, recommender],
    applyUrl: ICLT_PORTAL,
    notes: l('Apply in the central scholarship platform through an eligible recommending institution; recipients then confirm admission arrangements with Jiangnan University.', '通过符合条件的推荐机构在中央奖学金平台申请；获奖后与江南大学确认录取手续。', 'Подайте заявку в центральной системе через подходящую рекомендующую организацию; после присуждения подтвердите приём с Университетом Цзяннань.'),
  },
  {
    key: 'sufe',
    name: l('International Chinese Language Teachers Scholarship — One-Semester International Chinese Language Education Program (Spring 2027)', '国际中文教师奖学金一学期国际中文教育研修项目（2027年春季）', 'Стипендия для преподавателей китайского языка — семестровая программа международного преподавания китайского языка (весна 2027)'),
    faculty: l('International Cultural Exchange School, Shanghai University of Finance and Economics', '上海财经大学国际文化交流学院', 'Школа международного культурного обмена Шанхайского университета финансов и экономики'),
    direction: l('International Chinese Language Education', '国际中文教育', 'международное преподавание китайского языка'),
    qualification: l('Non-degree General Scholar', '非学历普通进修生', 'Обычный стажёр без присуждения степени'),
    languagePolicy: l('Chinese-medium International Chinese Language Education; HSK 3 (270) and a valid HSKK score are required.', '中文授课的国际中文教育方向；要求HSK三级270分及有效HSKK成绩。', 'Международное преподавание китайского на китайском языке; требуются HSK 3 (270) и HSKK.'),
    curriculumHighlights: [
      l('International Chinese Language Education study', '国际中文教育方向研修', 'Международное преподавание китайского языка'),
      l('Five months beginning in March 2027', '2027年3月入学并连续研修5个月', 'Пять месяцев обучения с марта 2027 года'),
    ],
    eligibility: commonEligibility(defaultAge, l('HSK 3 (270), HSKK and an eligible recommendation are required', '须达到HSK三级270分、具备HSKK并取得符合条件推荐', 'Требуются HSK 3 (270), HSKK и подходящая рекомендация')),
    materials: [
      l('Personal photo, passport page and valid HSK/HSKK reports', '个人照片、护照页及有效HSK／HSKK成绩', 'Фотография, страница паспорта и действующие HSK/HSKK'),
      recommender,
      l('Study plan, highest diploma and academic transcript', '学习计划、最高学历证明及成绩单', 'План обучения, документ об образовании и выписка оценок'),
      l('Physical examination issued within six months and any other documents requested by SUFE', '近6个月内体检表及上海财经大学要求的其他材料', 'Медицинская форма за последние шесть месяцев и другие документы по требованиям SUFE'),
    ],
    applyUrl: 'https://ao.sufe.edu.cn/',
    notes: l('Both applications are mandatory: submit the SUFE program application at https://ao.sufe.edu.cn/ by October 15, 2026 and the central scholarship application by October 31, 2026.', '两套申请均为必填：须在2026年10月15日前通过https://ao.sufe.edu.cn/提交校内项目申请，并在10月31日前通过中央平台提交奖学金申请。', 'Обязательны обе заявки: университетская на https://ao.sufe.edu.cn/ до 15 октября 2026 года и центральная стипендиальная до 31 октября 2026 года.'),
  },
  {
    key: 'zjnu',
    faculty: l('International Student Office, Zhejiang Normal University', '浙江师范大学国际学生管理部门', 'Отдел иностранных студентов Чжэцзянского педагогического университета'),
    direction: l('International Chinese Language Education, Chinese Language and Literature, Chinese History, or Chinese Philosophy', '国际中文教育、汉语言文学、中国历史或中国哲学', 'международное преподавание китайского, китайский язык и литература, история или философия'),
    languagePolicy: l('Chinese-medium; HSK 3 (180) and a valid HSKK score are required.', '中文授课；要求HSK三级180分及有效HSKK成绩。', 'Обучение на китайском; требуются HSK 3 (180) и HSKK.'),
    curriculumHighlights: [
      l('International Chinese Language Education direction', '国际中文教育方向研修', 'Международное преподавание китайского языка'),
      l('Chinese Language and Literature, Chinese History or Chinese Philosophy direction', '汉语言文学、中国历史或中国哲学方向研修', 'Китайский язык и литература, история или философия'),
    ],
    eligibility: commonEligibility(
      l('18–35 years old as of September 1, 2026', '截至2026年9月1日为18至35周岁', 'Возраст 18–35 лет на 1 сентября 2026 года'),
      l('HSK 3 (180), HSKK and an eligible recommendation are required', '须达到HSK三级180分、具备HSKK并取得符合条件推荐', 'Требуются HSK 3 (180), HSKK и подходящая рекомендация'),
      [l('The passport must not contain an X1 or X2 Chinese visa', '护照中不得有中国X1或X2签证', 'В паспорте не должно быть китайской визы X1 или X2')],
    ),
    materials: [passport, languageReports, recommender],
    applyUrl: ICLT_PORTAL,
    notes: l('Apply in the central scholarship platform through an eligible recommending institution. Awardees separately purchase annual third-party liability insurance of CNY 200.', '通过符合条件的推荐机构在中央奖学金平台申请；获奖者另需自费购买每学年200元第三方责任险。', 'Подайте заявку в центральной системе через подходящую рекомендующую организацию. Получатель отдельно оплачивает страхование ответственности 200 юаней в год.'),
  },
]

for (const config of icltConfigs) {
  const program = requireRecord(programs, `program-${config.key}-iclt-one-semester-spring-2027`)
  if (config.name) program.name = config.name
  program.applyUrl = config.applyUrl
  program.details = icltDetails(config)
  program.verificationScope = 'complete'
  requireRecord(cycles, `cycle-${config.key}-iclt-one-semester-spring-2027`).notes = config.notes
}

const jiangnanScholarship = requireRecord(
  scholarships,
  'scholarship-jiangnan-iclt-one-semester-spring-2027',
)
jiangnanScholarship.coverage.stipendCnyPerMonth = 2500
jiangnanScholarship.summary = l(
  'The university guide points to the official International Chinese Language Teachers Scholarship standard, which covers tuition, accommodation, medical insurance and a CNY 2,500 monthly allowance for one-semester scholars.',
  '学校申请办法采用国际中文教师奖学金官方资助标准，覆盖学费、住宿、医疗保险及一学期研修生每月2,500元生活费。',
  'Руководство вуза применяет официальный стандарт стипендии: обучение, проживание, медицинская страховка и ежемесячная выплата 2 500 юаней.',
)

const cqnuZhSource = {
  id: 'src-cqnu-chinese-language-2027-zh',
  url: 'https://international.cqnu.edu.cn/info/1386/5186.htm',
  title: '重庆师范大学2026年汉语进修生招生简章',
  publisher: 'Chongqing Normal University',
  kind: 'program',
  language: 'zh',
  official: true,
  accessedAt: VERIFIED_AT,
}
if (!sources.some((item) => item.id === cqnuZhSource.id)) sources.push(cqnuZhSource)

const cqnuLanguage = requireRecord(programs, 'program-cqnu-chinese-language-spring-2027')
cqnuLanguage.sourceIds = [...new Set([...cqnuLanguage.sourceIds, cqnuZhSource.id])]
cqnuLanguage.details = {
  faculty: l('Office of International Cooperation and Exchange, Chongqing Normal University', '重庆师范大学国际合作与交流处', 'Управление международного сотрудничества Чунцинского педагогического университета'),
  overview: l('A self-funded Spring 2027 Chinese-language program with small classes from beginner through advanced level, running from March to June or July.', '2027年春季自费汉语进修项目，按入学水平开设零起点至高级小班，学习时间为3月至6月或7月。', 'Платная программа китайского языка весной 2027 года с малочисленными группами от начального до продвинутого уровня, с марта по июнь или июль.'),
  qualification: l('Non-degree Chinese-language study', '非学历汉语进修生', 'Изучение китайского языка без присуждения степени'),
  studyMode: 'full-time',
  languagePolicy: l('Students are placed by entry level. No minimum HSK score is published; existing HSK/HSKK certificates must be submitted.', '按入学汉语水平分班；简章未公布最低HSK分数，已有HSK／HSKK证书须提交。', 'Распределение по уровню при поступлении. Минимальный HSK не опубликован; имеющиеся HSK/HSKK подаются.'),
  curriculumHighlights: [
    l('Beginner/elementary: comprehensive Chinese, conversation, listening and Chinese culture', '零起点／初级：综合汉语、会话、听力及中国文化', 'Начальный уровень: комплексный китайский, разговорная речь, аудирование и культура Китая'),
    l('Intermediate/advanced: reading, advanced Chinese, reading and writing, and China overview courses', '中高级：阅读、汉语提高、读写及中国概况等课程', 'Средний/продвинутый уровень: чтение, углублённый китайский, письмо и обзор Китая'),
  ],
  eligibility: [
    l('A non-Chinese citizen, friendly to China, in good physical and mental health, and 18–50 years old', '非中国籍、对华友好、身心健康，年龄18至50周岁', 'Иностранный гражданин 18–50 лет, дружественно настроенный к Китаю и с хорошим здоровьем'),
    l('Pass the university’s comprehensive review and any interview or written test it arranges', '通过学校综合评审及学校可能安排的面试或笔试', 'Пройти комплексное рассмотрение и возможное собеседование или письменный тест университета'),
  ],
  applicationMaterials: [
    l('CQNU application form and passport page; include prior Chinese visa pages when applicable', '重庆师范大学申请表及护照页；有来华经历者附相关签证页', 'Заявление CQNU и страница паспорта; при наличии — страницы прежних китайских виз'),
    l('Notarized highest diploma and transcript, plus a Chinese- or English-language study plan of at least 1,000 words', '公证最高学历及成绩单，以及不少于1000字的中文或英文学习计划', 'Нотариальные документы об образовании и план обучения на китайском или английском не менее 1000 слов'),
    l('Existing HSK/HSKK certificates and two recommendation letters', '已有HSK／HSKK证书及两封推荐信', 'Имеющиеся сертификаты HSK/HSKK и два рекомендательных письма'),
    l('Physical examination, no-criminal-record proof, résumé and bank certificate of normally at least CNY 25,000', '体检表、无犯罪记录、个人简历及原则上不少于25,000元人民币存款证明', 'Медицинская форма, справка об отсутствии судимости, резюме и банковская справка обычно не менее 25 000 юаней'),
  ],
}
cqnuLanguage.verificationScope = 'complete'
const cqnuCycle = requireRecord(cycles, 'cycle-cqnu-chinese-language-spring-2027')
cqnuCycle.sourceIds = [...new Set([...cqnuCycle.sourceIds, cqnuZhSource.id])]

const njnu = requireRecord(universities, 'uni-nanjing-normal-university')
if (!njnu.sourceIds.some((id) => sources.some((source) => source.id === id && source.official))) {
  throw new Error('Nanjing Normal University lacks official identity evidence')
}
njnu.status = 'verified'
njnu.verifiedAt = VERIFIED_AT
njnu.reviewAfter = PROFILE_REVIEW_AFTER

for (const university of universities) {
  if (
    university.admissionsUrl === null
    && university.sourceIds.some((id) => id.startsWith('src-institution-20260729-'))
  ) {
    university.summary = l(
      `${university.name.en} has a verified official university profile. A dedicated international-admissions entry point has not yet been confirmed; use the official university website for current notices.`,
      `${university.name.zh}的学校官网身份已经核实，专门的国际招生入口尚待确认；当前通知请从学校官网进入核实。`,
      `Официальный профиль ${university.name.ru} подтверждён. Специальная страница международного приёма пока не подтверждена; актуальные объявления проверяйте на сайте вуза.`,
    )
  }
}

write('sources.json', sources)
write('universities.json', universities)
write('programs.json', programs)
write('admission-cycles.json', cycles)
write('scholarships.json', scholarships)

console.log(JSON.stringify({
  universities: universities.length,
  publishedUniversityIdentities: universities.filter((item) => item.status !== 'draft').length,
  enrichedPrograms: chinaLinkUpdates.length + icltConfigs.length + 1,
  programsWithDetails: programs.filter((item) => item.details).length,
  sources: sources.length,
}, null, 2))
