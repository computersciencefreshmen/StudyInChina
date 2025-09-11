export type Program = 'Translation' | 'International Relations'
export type Region = '华北' | '东北' | '华东' | '华中'

export type University = {
  name: string
  englishName?: string
  region: Region
  city?: string
  programs: Program[]
  hskNote: string
  bridgeNote?: string
  programsDetailed?: Array<{
    program: Program
    degree: 'BA' | 'MA' | 'Other'
    hsk: string
    acceptsFoundation: boolean
    url: string
  }>
  viewUrl: string
  applyUrl: string
}

export const UNIVERSITIES: University[] = [
  // 华北
  {
    name: '北京外国语大学', englishName: 'Beijing Foreign Studies University (BFSU)', region: '华北', city: 'Beijing',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课通常需HSK5；HSK3-4可先读预科/汉语进修再升本',
    bridgeNote: '设有预科与汉语强化项目，常见路径为1年语言+升本（外语类/人文）',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4–5（以院系当年公告为准）', acceptsFoundation: true, url: 'https://en.bfsu.edu.cn/Academics.htm' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK5（建议）', acceptsFoundation: true, url: 'https://en.bfsu.edu.cn/Academics.htm' }
    ],
    viewUrl: 'https://en.bfsu.edu.cn/',
    applyUrl: 'https://admission.bfsu.edu.cn/'
  },
  {
    name: '北京语言大学', englishName: 'Beijing Language and Culture University (BLCU)', region: '华北', city: 'Beijing',
    programs: ['Translation', 'International Relations'],
    hskNote: '多数本科中文授课HSK4-5；HSK3-4可走预科/汉语进修通道',
    bridgeNote: '预科/汉语进修很成熟，支持语言过渡后申请人文专业',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4（部分方向HSK5）', acceptsFoundation: true, url: 'https://admission.blcu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://admission.blcu.edu.cn/' }
    ],
    viewUrl: 'https://admission.blcu.edu.cn/',
    applyUrl: 'https://apply.blcu.edu.cn/'
  },
  {
    name: '对外经济贸易大学', englishName: 'University of International Business and Economics (UIBE)', region: '华北', city: 'Beijing',
    programs: ['International Relations'],
    hskNote: '中文授课常见HSK4-5；HSK3-4建议先读预科/语言班',
    bridgeNote: '国际学院提供预科/语言强化路径',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://sie.uibe.edu.cn/' }
    ],
    viewUrl: 'https://sie.uibe.edu.cn/',
    applyUrl: 'https://apply.uibe.edu.cn/'
  },
  {
    name: '中央民族大学', englishName: 'Minzu University of China (MUC)', region: '华北', city: 'Beijing',
    programs: ['International Relations'],
    hskNote: '中文授课通常HSK4-5；可先语言过渡',
    bridgeNote: '国际教育学院提供语言/预科项目',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://international.muc.edu.cn/' }
    ],
    viewUrl: 'https://international.muc.edu.cn/',
    applyUrl: 'https://international.muc.edu.cn/'
  },
  {
    name: '天津外国语大学', englishName: 'Tianjin Foreign Studies University (TFSU)', region: '华北', city: 'Tianjin',
    programs: ['Translation', 'International Relations'],
    hskNote: '语言/外语类本科常见HSK4；不足者可先语言学习',
    bridgeNote: '提供预科/语言课程，支持“先过渡”',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'https://sie.tjfsu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://sie.tjfsu.edu.cn/' }
    ],
    viewUrl: 'https://sie.tjfsu.edu.cn/',
    applyUrl: 'https://apply.tjfsu.edu.cn/'
  },
  {
    name: '河北大学', englishName: 'Hebei University (HBU)', region: '华北', city: 'Baoding',
    programs: ['International Relations'],
    hskNote: '中文授课一般HSK4起；可先预科/语言提分',
    bridgeNote: '使用通用国际学生线上报名平台（17gz）',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://iee.hbu.edu.cn/' }
    ],
    viewUrl: 'http://iee.hbu.edu.cn/',
    applyUrl: 'https://hebei.17gz.org/'
  },

  // 东北
  {
    name: '哈尔滨工业大学', englishName: 'Harbin Institute of Technology (HIT)', region: '东北', city: 'Harbin',
    programs: ['International Relations'],
    hskNote: '中文授课多为HSK4-5；人文类名额有限，建议先语言/预科',
    bridgeNote: '国际教育学院设有语言学习渠道',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'http://studyathit.hit.edu.cn/' }
    ],
    viewUrl: 'http://studyathit.hit.edu.cn/',
    applyUrl: 'http://studyathit.hit.edu.cn/'
  },
  {
    name: '吉林大学', englishName: 'Jilin University (JLU)', region: '东北', city: 'Changchun',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课通常HSK4-5；不足者可先语言/预科',
    bridgeNote: '采用17gz报名平台，提供语言学习过渡',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://cie.jlu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'http://cie.jlu.edu.cn/' }
    ],
    viewUrl: 'http://cie.jlu.edu.cn/',
    applyUrl: 'https://jlu.17gz.org/'
  },
  {
    name: '东北师范大学', englishName: 'Northeast Normal University (NENU)', region: '东北', city: 'Changchun',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课一般HSK4-5；支持预科/语言班过渡',
    bridgeNote: '17gz报名通道',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://iso.nenu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'http://iso.nenu.edu.cn/' }
    ],
    viewUrl: 'http://iso.nenu.edu.cn/',
    applyUrl: 'https://nenu.17gz.org/'
  },
  {
    name: '辽宁大学', englishName: 'Liaoning University (LNU)', region: '东北', city: 'Shenyang',
    programs: ['International Relations'],
    hskNote: '中文授课多为HSK4-5；可先读语言/预科',
    bridgeNote: '17gz报名通道',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'http://liuxue.lnu.edu.cn/' }
    ],
    viewUrl: 'http://liuxue.lnu.edu.cn/',
    applyUrl: 'https://lnu.17gz.org/'
  },
  {
    name: '大连外国语大学', englishName: 'Dalian University of Foreign Languages (DUFL)', region: '东北', city: 'Dalian',
    programs: ['Translation', 'International Relations'],
    hskNote: '外语类/翻译类院校，中文授课常见HSK4；不足者可先语言/预科',
    bridgeNote: '17gz报名通道，语言过渡成熟',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'https://admissions.dlufl.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'https://admissions.dlufl.edu.cn/' }
    ],
    viewUrl: 'https://admissions.dlufl.edu.cn/',
    applyUrl: 'https://dlufl.17gz.org/'
  },
  {
    name: '黑龙江大学', englishName: 'Heilongjiang University (HLJU)', region: '东北', city: 'Harbin',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课多为HSK4；支持语言/预科过渡',
    bridgeNote: '17gz报名通道',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://sie.hlju.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://sie.hlju.edu.cn/' }
    ],
    viewUrl: 'http://sie.hlju.edu.cn/',
    applyUrl: 'https://hlju.17gz.org/'
  },
  {
    name: '延边大学', englishName: 'Yanbian University (YBU)', region: '东北', city: 'Yanji',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课一般HSK4；有语言学习与朝鲜语环境优势',
    bridgeNote: '17gz报名通道',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://sie.ybu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://sie.ybu.edu.cn/' }
    ],
    viewUrl: 'http://sie.ybu.edu.cn/',
    applyUrl: 'https://ybu.17gz.org/'
  },

  // 华东
  {
    name: '复旦大学', englishName: 'Fudan University', region: '华东', city: 'Shanghai',
    programs: ['International Relations'],
    hskNote: '中文授课IR通常HSK5；建议先中文预科/语言进修再申',
    bridgeNote: '国际文化交流学院提供语言课程',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK5（建议）', acceptsFoundation: true, url: 'https://iso.fudan.edu.cn/' }
    ],
    viewUrl: 'https://iso.fudan.edu.cn/',
    applyUrl: 'https://admission.iso.fudan.edu.cn/'
  },
  {
    name: '南京大学', englishName: 'Nanjing University (NJU)', region: '华东', city: 'Nanjing',
    programs: ['International Relations'],
    hskNote: '中文授课常见HSK5；HSK3-4建议走语言/预科过渡',
    bridgeNote: '留学生院有系统语言课程；17gz报名通道',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK5（常见）', acceptsFoundation: true, url: 'https://stuex.nju.edu.cn/' }
    ],
    viewUrl: 'https://stuex.nju.edu.cn/',
    applyUrl: 'https://nju.17gz.org/'
  },
  {
    name: '浙江大学', englishName: 'Zhejiang University (ZJU)', region: '华东', city: 'Hangzhou',
    programs: ['International Relations'],
    hskNote: '中文授课一般HSK5；建议语言进修/预科后申人文类',
    bridgeNote: '国际学院语言课程成熟',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK5', acceptsFoundation: true, url: 'https://is.zju.edu.cn/' }
    ],
    viewUrl: 'http://iczu.zju.edu.cn/english/',
    applyUrl: 'https://is.zju.edu.cn/'
  },
  {
    name: '厦门大学', englishName: 'Xiamen University (XMU)', region: '华东', city: 'Xiamen',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课多为HSK4-5；不足可先语言/预科',
    bridgeNote: '有官方在线申请系统与语言班',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://admissions.xmu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://admissions.xmu.edu.cn/' }
    ],
    viewUrl: 'https://admissions.xmu.edu.cn/',
    applyUrl: 'http://application.xmu.edu.cn/'
  },
  {
    name: '山东大学', englishName: 'Shandong University (SDU)', region: '华东', city: 'Jinan',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课常见HSK4-5；支持预科/语言过渡',
    bridgeNote: 'iStudy/17gz通道',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://www.istudy.sdu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'https://www.istudy.sdu.edu.cn/' }
    ],
    viewUrl: 'https://www.istudy.sdu.edu.cn/',
    applyUrl: 'https://sduniv.17gz.org/'
  },
  {
    name: '上海交通大学', englishName: 'Shanghai Jiao Tong University (SJTU)', region: '华东', city: 'Shanghai',
    programs: ['International Relations'],
    hskNote: '中文授课普遍HSK5；人文类名额有限，建议语言过渡',
    bridgeNote: '国际教育学院提供语言项目',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK5（建议）', acceptsFoundation: true, url: 'https://isc.sjtu.edu.cn/' }
    ],
    viewUrl: 'https://isc.sjtu.edu.cn/',
    applyUrl: 'https://apply.sjtu.edu.cn/'
  },

  // 华中
  {
    name: '武汉大学', englishName: 'Wuhan University (WHU)', region: '华中', city: 'Wuhan',
    programs: ['International Relations'],
    hskNote: '中文授课IR常见HSK5；HSK3-4建议先预科/语言后申',
    bridgeNote: '有中文进修/预科路径',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK5（常见）', acceptsFoundation: true, url: 'http://admission.whu.edu.cn/' }
    ],
    viewUrl: 'http://admission.whu.edu.cn/',
    applyUrl: 'http://admission.whu.edu.cn/apply'
  },
  {
    name: '华中师范大学', englishName: 'Central China Normal University (CCNU)', region: '华中', city: 'Wuhan',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课常见HSK4-5；支持语言/预科过渡',
    bridgeNote: '17gz报名通道',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'http://iso.ccnu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'http://iso.ccnu.edu.cn/' }
    ],
    viewUrl: 'http://iso.ccnu.edu.cn/',
    applyUrl: 'https://ccnu.17gz.org/'
  },
  {
    name: '郑州大学', englishName: 'Zhengzhou University (ZZU)', region: '华中', city: 'Zhengzhou',
    programs: ['International Relations'],
    hskNote: '中文授课一般HSK4-5；支持语言/预科过渡',
    bridgeNote: '17gz报名通道',
    programsDetailed: [
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4–5', acceptsFoundation: true, url: 'http://sie.zzu.edu.cn/' }
    ],
    viewUrl: 'http://sie.zzu.edu.cn/',
    applyUrl: 'https://zzu.17gz.org/'
  },
  {
    name: '河南大学', englishName: 'Henan University (HENU)', region: '华中', city: 'Kaifeng',
    programs: ['Translation', 'International Relations'],
    hskNote: '中文授课常见HSK4；支持语言/预科过渡',
    bridgeNote: '17gz报名通道',
    programsDetailed: [
      { program: 'Translation', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'https://oia.henu.edu.cn/' },
      { program: 'International Relations', degree: 'BA', hsk: 'HSK4', acceptsFoundation: true, url: 'https://oia.henu.edu.cn/' }
    ],
    viewUrl: 'https://oia.henu.edu.cn/',
    applyUrl: 'https://henu.17gz.org/'
  },
]
