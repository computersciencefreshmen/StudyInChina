import { LText, ProgramId, RegionId } from '../lib/i18n'

export type University = {
  name: LText
  englishName?: string
  region: RegionId
  city?: LText
  programs: ProgramId[]
  hskNote: LText
  bridgeNote?: LText
  // UI details for card rendering
  recommended?: boolean
  summary?: LText
  scholarshipsAvailable?: number
  difficulty?: 'Low' | 'Medium' | 'High'
  languageRequirement?: {
    direct?: LText
    preparatory?: LText
  }
  programsDetailed?: Array<{
    program: ProgramId
    degree: 'BA' | 'MA' | 'Other'
    hsk: LText
    acceptsFoundation: boolean
    url: string
  }>
  viewUrl: string
  applyUrl: string
}

const zh = (s: string) => ({ zh: s, en: '', ru: '' } as LText)
const en = (s: string) => ({ en: s, zh: '', ru: '' } as LText)
const ru = (s: string) => ({ ru: s, en: '', zh: '' } as LText)
const l = (enS:string, zhS:string, ruS:string): LText => ({ en: enS, zh: zhS, ru: ruS })

export const UNIVERSITIES: University[] = [
  // 华北 NORTH_CHINA
  {
    name: l('Beijing Foreign Studies University','北京外国语大学','Пекинский университет иностранных языков'),
    englishName: 'Beijing Foreign Studies University (BFSU)',
    region: 'NORTH_CHINA',
    city: l('Beijing','北京','Пекин'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught often HSK5; with HSK3–4, do foundation/language first.','中文授课通常需HSK5；HSK3–4可先预科/语言后升本。','Программы на китайском обычно требуют HSK5; с HSK3–4 — подготовительный/языковой год.'),
    bridgeNote: l('Has foundation and intensive Chinese routes.','设有预科与汉语强化项目。','Есть подготовительные и языковые программы.'),
    recommended: true,
    summary: l("Known as the 'Cradle of Chinese Diplomats', leading in translation and international relations.", '被称为“外交官的摇篮”，翻译与国际关系优势明显。', 'Известен как «колыбель дипломатов Китая», силён в переводе и МО.'),
    scholarshipsAvailable: 1,
    difficulty: 'High',
    languageRequirement: {
      direct: l('Direct Entry: HSK 5','直入：HSK5','Прямой: HSK5'),
      preparatory: l('Preparatory: HSK 4','预科：HSK4','Подготовительное: HSK4')
    },
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4–5 (per school notice)','HSK4–5（以院系公告为准）','HSK4–5 (по правилам факультета)'), acceptsFoundation: true, url: 'https://en.bfsu.edu.cn/Academics.htm' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK5 (typical)','HSK5（常见）','HSK5 (обычно)'), acceptsFoundation: true, url: 'https://en.bfsu.edu.cn/Academics.htm' }
    ],
    viewUrl: 'https://en.bfsu.edu.cn/',
    applyUrl: 'https://admission.bfsu.edu.cn/'
  },
  {
    name: l('Beijing Language and Culture University','北京语言大学','Пекинский университет языка и культуры'),
    englishName: 'Beijing Language and Culture University (BLCU)',
    region: 'NORTH_CHINA',
    city: l('Beijing','北京','Пекин'),
    programs: ['Translation','International Relations'],
    hskNote: l('Most Chinese-taught need HSK4–5; HSK3–4 can do language/foundation first.','多数中文授课HSK4–5；HSK3–4可先语言/预科。','Обычно HSK4–5; с HSK3–4 — сначала язык/подготовительное.'),
    bridgeNote: l('Very mature language/foundation pathways.','预科/汉语进修成熟。','Зрелые языковые/подготовительные маршруты.'),
    recommended: true,
    summary: l('The only Chinese university dedicated to Chinese language and culture for international students.','中国唯一专门面向来华留学生开展汉语和中华文化教育的大学。','Единственный вуз Китая, специализирующийся на китайском языке и культуре для иностранцев.'),
    scholarshipsAvailable: 2,
    difficulty: 'Medium',
    languageRequirement: {
      direct: l('Direct Entry: HSK 4','直入：HSK4','Прямой: HSK4'),
      preparatory: l('Preparatory: HSK 3 (≥180+)','预科：HSK3（≥180+）','Подготовительное: HSK3 (≥180+)')
    },
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4 (some tracks 5)','HSK4（部分方向HSK5）','HSK4 (иногда 5)'), acceptsFoundation: true, url: 'https://admission.blcu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://admission.blcu.edu.cn/' }
    ],
    viewUrl: 'https://admission.blcu.edu.cn/',
    applyUrl: 'https://apply.blcu.edu.cn/'
  },
  {
    name: l('University of International Business and Economics','对外经济贸易大学','Университет международного бизнеса и экономики (UIBE)'),
    englishName: 'University of International Business and Economics (UIBE)',
    region: 'NORTH_CHINA',
    city: l('Beijing','北京','Пекин'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught often HSK4–5; HSK3–4 do language/foundation first.','中文授课常见HSK4–5；HSK3–4先语言/预科。','Обычно HSK4–5; с HSK3–4 — язык/подготовительное.'),
    bridgeNote: l('Foundation/Language via School of International Education.','国际学院提供预科/语言强化。','Подготовительные/языковые курсы через институт международного образования.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://sie.uibe.edu.cn/' }
    ],
    viewUrl: 'https://sie.uibe.edu.cn/',
    applyUrl: 'https://apply.uibe.edu.cn/'
  },
  {
    name: l('Minzu University of China','中央民族大学','Центральный университет национальностей (Minzu)'),
    englishName: 'Minzu University of China (MUC)',
    region: 'NORTH_CHINA',
    city: l('Beijing','北京','Пекин'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught typically HSK4–5; language transition available.','中文授课通常HSK4–5；可语言过渡。','Обычно HSK4–5; возможен языковой переход.'),
    bridgeNote: l('Language/Foundation via International Education College.','国际教育学院语言/预科项目。','Языковые/подготовительные программы в институте международного образования.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://international.muc.edu.cn/' }
    ],
    viewUrl: 'https://international.muc.edu.cn/',
    applyUrl: 'https://international.muc.edu.cn/'
  },
  {
    name: l('Tianjin Foreign Studies University','天津外国语大学','Тяньцзиньский университет иностранных языков'),
    englishName: 'Tianjin Foreign Studies University (TFSU)',
    region: 'NORTH_CHINA',
    city: l('Tianjin','天津','Тяньцзинь'),
    programs: ['Translation','International Relations'],
    hskNote: l('Language/translation BA often HSK4; can do language first.','外语/翻译类本科常见HSK4；可先语言学习。','Для языковых/переводческих направлений часто HSK4; можно начать с языкового курса.'),
    bridgeNote: l('Has foundation/language courses.','提供预科/语言课程。','Есть подготовительные/языковые курсы.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'https://sie.tjfsu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://sie.tjfsu.edu.cn/' }
    ],
    viewUrl: 'https://sie.tjfsu.edu.cn/',
    applyUrl: 'https://apply.tjfsu.edu.cn/'
  },
  {
    name: l('Hebei University','河北大学','Университет Хэбэй'),
    englishName: 'Hebei University (HBU)',
    region: 'NORTH_CHINA',
    city: l('Baoding','保定','Баодин'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught usually HSK4+; foundation possible via 17gz.','中文授课一般HSK4+；17gz通道可预科。','Обычно HSK4+; возможны подготовительные через 17gz.'),
    bridgeNote: l('Uses 17gz platform.','使用17gz报名平台。','Использует платформу 17gz.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://iee.hbu.edu.cn/' }
    ],
    viewUrl: 'http://iee.hbu.edu.cn/',
    applyUrl: 'https://hebei.17gz.org/'
  },

  // 东北 NORTHEAST
  {
    name: l('Harbin Institute of Technology','哈尔滨工业大学','Харбинский политехнический университет (HIT)'),
    englishName: 'Harbin Institute of Technology (HIT)',
    region: 'NORTHEAST',
    city: l('Harbin','哈尔滨','Харбин'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught often HSK4–5; humanities seats limited; do language first.','中文授课多HSK4–5；人文名额有限，建议先语言。','Часто HSK4–5; мест мало, лучше начать с языка.'),
    bridgeNote: l('Language study channel available.','国际教育学院有语言学习渠道。','Есть языковые курсы для иностранных студентов.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'http://studyathit.hit.edu.cn/' }
    ],
    viewUrl: 'http://studyathit.hit.edu.cn/',
    applyUrl: 'http://studyathit.hit.edu.cn/'
  },
  {
    name: l('Jilin University','吉林大学','Университет Цзилинь'),
    englishName: 'Jilin University (JLU)',
    region: 'NORTHEAST',
    city: l('Changchun','长春','Чанчунь'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught HSK4–5; language/foundation ok via 17gz.','中文授课HSK4–5；17gz语言/预科可行。','HSK4–5; возможен язык/подготовительное через 17gz.'),
    bridgeNote: l('Uses 17gz; has language transition.','17gz报名；提供语言过渡。','17gz; есть языковой переход.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://cie.jlu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'http://cie.jlu.edu.cn/' }
    ],
    viewUrl: 'http://cie.jlu.edu.cn/',
    applyUrl: 'https://jlu.17gz.org/'
  },
  {
    name: l('Northeast Normal University','东北师范大学','Северо-восточный педагогический университет (NENU)'),
    englishName: 'Northeast Normal University (NENU)',
    region: 'NORTHEAST',
    city: l('Changchun','长春','Чанчунь'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught HSK4–5; foundation/language supported.','中文授课HSK4–5；支持预科/语言。','HSK4–5; поддерживаются подготовительные/язык.'),
    bridgeNote: l('17gz admission.','17gz报名通道。','Подача через 17gz.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://iso.nenu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'http://iso.nenu.edu.cn/' }
    ],
    viewUrl: 'http://iso.nenu.edu.cn/',
    applyUrl: 'https://nenu.17gz.org/'
  },
  {
    name: l('Liaoning University','辽宁大学','Университет Ляонин'),
    englishName: 'Liaoning University (LNU)',
    region: 'NORTHEAST',
    city: l('Shenyang','沈阳','Шэньян'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught HSK4–5; foundation/language ok.','中文授课HSK4–5；可语言/预科。','HSK4–5; возможны подготовительные/язык.'),
    bridgeNote: l('17gz admission.','17gz报名通道。','Подача через 17gz.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'http://liuxue.lnu.edu.cn/' }
    ],
    viewUrl: 'http://liuxue.lnu.edu.cn/',
    applyUrl: 'https://lnu.17gz.org/'
  },
  {
    name: l('Dalian University of Foreign Languages','大连外国语大学','Даляньский университет иностранных языков'),
    englishName: 'Dalian University of Foreign Languages (DUFL)',
    region: 'NORTHEAST',
    city: l('Dalian','大连','Далянь'),
    programs: ['Translation','International Relations'],
    hskNote: l('Language/translation school; often HSK4; language/foundation path mature.','外语/翻译向；HSK4常见；语言/预科成熟。','Языковой/переводческий вуз; часто HSK4; зрелые подготовительные/язык.'),
    bridgeNote: l('17gz admission.','17gz报名通道。','Подача через 17gz.'),
    recommended: true,
    summary: l('International Politics and Translation majors with lower living cost in Dalian.','大连生活成本相对较低，设有国际政治与翻译专业。','В Даляне ниже стоимость жизни; есть МО и перевод.'),
    scholarshipsAvailable: 2,
    difficulty: 'Medium',
    languageRequirement: {
      direct: l('Direct Entry: HSK 4','直入：HSK4','Прямой: HSK4'),
      preparatory: l('Preparatory: HSK 3','预科：HSK3','Подготовительное: HSK3')
    },
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'https://admissions.dlufl.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'https://admissions.dlufl.edu.cn/' }
    ],
    viewUrl: 'https://admissions.dlufl.edu.cn/',
    applyUrl: 'https://dlufl.17gz.org/'
  },
  {
    name: l('Heilongjiang University','黑龙江大学','Университет Хэйлунцзян'),
    englishName: 'Heilongjiang University (HLJU)',
    region: 'NORTHEAST',
    city: l('Harbin','哈尔滨','Харбин'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught often HSK4; supports language/foundation.','中文授课多HSK4；支持语言/预科。','Часто HSK4; поддерживает язык/подготовительное.'),
    bridgeNote: l('17gz admission.','17gz报名通道。','Подача через 17gz.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://sie.hlju.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://sie.hlju.edu.cn/' }
    ],
    viewUrl: 'http://sie.hlju.edu.cn/',
    applyUrl: 'https://hlju.17gz.org/'
  },
  {
    name: l('Yanbian University','延边大学','Яньбяньский университет'),
    englishName: 'Yanbian University (YBU)',
    region: 'NORTHEAST',
    city: l('Yanji','延吉','Яньцзи'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught usually HSK4; bilingual environment advantage.','中文授课一般HSK4；双语环境有优势。','Обычно HSK4; преимущества двуязычной среды.'),
    bridgeNote: l('17gz admission.','17gz报名通道。','Подача через 17gz.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://sie.ybu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://sie.ybu.edu.cn/' }
    ],
    viewUrl: 'http://sie.ybu.edu.cn/',
    applyUrl: 'https://ybu.17gz.org/'
  },

  // 华东 EAST_CHINA
  {
    name: l('Fudan University','复旦大学','Фуданьский университет'),
    englishName: 'Fudan University',
    region: 'EAST_CHINA',
    city: l('Shanghai','上海','Шанхай'),
    programs: ['International Relations'],
    hskNote: l('IR usually HSK5; suggest foundation/language first.','国际关系通常HSK5；建议先中文预科/语言。','МО обычно HSK5; рекомендуется подготовительный/язык.'),
    bridgeNote: l('Language courses via International Cultural Exchange School.','国际文化交流学院语言课程。','Языковые курсы в школе международного обмена.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK5 (typical)','HSK5（常见）','HSK5 (обычно)'), acceptsFoundation: true, url: 'https://iso.fudan.edu.cn/' }
    ],
    viewUrl: 'https://iso.fudan.edu.cn/',
    applyUrl: 'https://admission.iso.fudan.edu.cn/'
  },
  {
    name: l('Nanjing University','南京大学','Нанькинский университет'),
    englishName: 'Nanjing University (NJU)',
    region: 'EAST_CHINA',
    city: l('Nanjing','南京','Нанкин'),
    programs: ['International Relations'],
    hskNote: l('IR commonly HSK5; with HSK3–4 use language/foundation.','IR常见HSK5；HSK3–4建议语言/预科。','МО обычно HSK5; с HSK3–4 — язык/подготовительное.'),
    bridgeNote: l('Language courses; 17gz portal.','留学生院语言课程；17gz报名。','Языковые курсы; подача через 17gz.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK5 (common)','HSK5（常见）','HSK5 (часто)'), acceptsFoundation: true, url: 'https://stuex.nju.edu.cn/' }
    ],
    viewUrl: 'https://stuex.nju.edu.cn/',
    applyUrl: 'https://nju.17gz.org/'
  },
  {
    name: l('Zhejiang University','浙江大学','Чжэцзянский университет'),
    englishName: 'Zhejiang University (ZJU)',
    region: 'EAST_CHINA',
    city: l('Hangzhou','杭州','Ханчжоу'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught commonly HSK5; do language/foundation for humanities.','中文授课一般HSK5；人文建议语言/预科。','Обычно HSK5; гуманитариям лучше пройти язык/подготовку.'),
    bridgeNote: l('Mature language courses.','国际学院语言课程成熟。','Зрелые языковые курсы.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK5','HSK5','HSK5'), acceptsFoundation: true, url: 'https://is.zju.edu.cn/' }
    ],
    viewUrl: 'http://iczu.zju.edu.cn/english/',
    applyUrl: 'https://is.zju.edu.cn/'
  },
  {
    name: l('Xiamen University','厦门大学','Сямэньский университет'),
    englishName: 'Xiamen University (XMU)',
    region: 'EAST_CHINA',
    city: l('Xiamen','厦门','Сямынь'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught often HSK4–5; language/foundation mature.','中文授课多HSK4–5；语言/预科成熟。','Часто HSK4–5; зрелые язык/подготовка.'),
    bridgeNote: l('Official online application system and language programs.','官网网申系统与语言班。','Официальная онлайн-заявка и языковые курсы.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://admissions.xmu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://admissions.xmu.edu.cn/' }
    ],
    viewUrl: 'https://admissions.xmu.edu.cn/',
    applyUrl: 'http://application.xmu.edu.cn/'
  },
  {
    name: l('Shandong University','山东大学','Шаньдунский университет'),
    englishName: 'Shandong University (SDU)',
    region: 'EAST_CHINA',
    city: l('Jinan','济南','Цзинань'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught HSK4–5; supports foundation/language.','中文授课HSK4–5；支持预科/语言。','HSK4–5; поддерживает подготовит./язык.'),
    bridgeNote: l('iStudy/17gz channel.','iStudy/17gz通道。','Каналы iStudy/17gz.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://www.istudy.sdu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'https://www.istudy.sdu.edu.cn/' }
    ],
    viewUrl: 'https://www.istudy.sdu.edu.cn/',
    applyUrl: 'https://sduniv.17gz.org/'
  },
  {
    name: l('Shanghai Jiao Tong University','上海交通大学','Шанхайский университет Цзяотун'),
    englishName: 'Shanghai Jiao Tong University (SJTU)',
    region: 'EAST_CHINA',
    city: l('Shanghai','上海','Шанхай'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught IR often HSK5; recommend language first.','中文授课IR多HSK5；建议语言过渡。','МО часто HSK5; лучше сначала язык.'),
    bridgeNote: l('Language programs at ISC.','国际教育学院语言项目。','Языковые программы ISC.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK5 (typical)','HSK5（常见）','HSK5 (обычно)'), acceptsFoundation: true, url: 'https://isc.sjtu.edu.cn/' }
    ],
    viewUrl: 'https://isc.sjtu.edu.cn/',
    applyUrl: 'https://apply.sjtu.edu.cn/'
  },

  // 华中 CENTRAL_CHINA
  {
    name: l('Wuhan University','武汉大学','Уханьский университет'),
    englishName: 'Wuhan University (WHU)',
    region: 'CENTRAL_CHINA',
    city: l('Wuhan','武汉','Ухань'),
    programs: ['International Relations'],
    hskNote: l('IR commonly HSK5; HSK3–4 do foundation/language first.','IR常见HSK5；HSK3–4先预科/语言。','МО обычно HSK5; с HSK3–4 — подготовительное/язык.'),
    bridgeNote: l('Chinese language/foundation available.','中文进修/预科路径。','Есть китайский/подготовка.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK5 (common)','HSK5（常见）','HSK5 (часто)'), acceptsFoundation: true, url: 'http://admission.whu.edu.cn/' }
    ],
    viewUrl: 'http://admission.whu.edu.cn/',
    applyUrl: 'http://admission.whu.edu.cn/apply'
  },
  {
    name: l('Central China Normal University','华中师范大学','Центрально-Китайский педагогический университет (CCNU)'),
    englishName: 'Central China Normal University (CCNU)',
    region: 'CENTRAL_CHINA',
    city: l('Wuhan','武汉','Ухань'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught HSK4–5; supports language/foundation.','中文授课HSK4–5；支持语言/预科。','HSK4–5; поддерживает язык/подготовит.'),
    bridgeNote: l('17gz admission channel.','17gz报名通道。','Подача через 17gz.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'http://iso.ccnu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'http://iso.ccnu.edu.cn/' }
    ],
    viewUrl: 'http://iso.ccnu.edu.cn/',
    applyUrl: 'https://ccnu.17gz.org/'
  },
  {
    name: l('Zhengzhou University','郑州大学','Чжэнчжоуский университет'),
    englishName: 'Zhengzhou University (ZZU)',
    region: 'CENTRAL_CHINA',
    city: l('Zhengzhou','郑州','Чжэнчжоу'),
    programs: ['International Relations'],
    hskNote: l('Chinese-taught HSK4–5; supports language/foundation.','中文授课HSK4–5；支持语言/预科。','HSK4–5; поддерживает язык/подготовит.'),
    bridgeNote: l('17gz admission channel.','17gz报名通道。','Подача через 17gz.'),
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4–5','HSK4–5','HSK4–5'), acceptsFoundation: true, url: 'http://sie.zzu.edu.cn/' }
    ],
    viewUrl: 'http://sie.zzu.edu.cn/',
    applyUrl: 'https://zzu.17gz.org/'
  },
  {
    name: l('Henan University','河南大学','Хэнаньский университет'),
    englishName: 'Henan University (HENU)',
    region: 'CENTRAL_CHINA',
    city: l('Kaifeng','开封','Кайфэн'),
    programs: ['Translation','International Relations'],
    hskNote: l('Chinese-taught HSK4 common; supports language/foundation.','中文授课常见HSK4；支持语言/预科。','Часто HSK4; поддерживает язык/подготовит.'),
    bridgeNote: l('17gz admission channel.','17gz报名通道。','Подача через 17gz.'),
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'https://oia.henu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: l('HSK4','HSK4','HSK4'), acceptsFoundation: true, url: 'https://oia.henu.edu.cn/' }
    ],
    viewUrl: 'https://oia.henu.edu.cn/',
    applyUrl: 'https://henu.17gz.org/'
  },
]
