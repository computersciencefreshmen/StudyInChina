const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')
const DFC_TARGET_PATH = path.join(
  process.cwd(),
  'content',
  'source-manifests',
  'double-first-class',
  'targets.v1.json',
)
const VERIFIED_AT = '2026-07-29'
const DYNAMIC_REVIEW_AFTER = '2026-08-28'
const PROFILE_REVIEW_AFTER = '2027-01-29'
const CITY_REVIEW_AFTER = '2027-07-29'
const ICLT_STANDARD_SOURCE_ID = 'src-clec-iclt-2026-standard'
const ICLT_PORTAL = 'https://pmplatform.chinese.cn/ui/start/#/login'
const CSC_PORTAL = 'https://studyinchina.csc.edu.cn/#/login'

const localized = (en, zh, ru) => ({ en, zh, ru })

const citySeeds = [
  ['quanzhou', 'Quanzhou', '泉州', 'Цюаньчжоу', 'Fujian', '福建省', 'Фуцзянь', 'east', 24.8741, 118.6757, 'https://www.quanzhou.gov.cn/'],
  ['zhenjiang', 'Zhenjiang', '镇江', 'Чжэньцзян', 'Jiangsu', '江苏省', 'Цзянсу', 'east', 32.188, 119.425, 'https://www.zhenjiang.gov.cn/'],
  ['ningbo', 'Ningbo', '宁波', 'Нинбо', 'Zhejiang', '浙江省', 'Чжэцзян', 'east', 29.8683, 121.544, 'https://www.ningbo.gov.cn/'],
  ['yinchuan', 'Yinchuan', '银川', 'Иньчуань', 'Ningxia Hui Autonomous Region', '宁夏回族自治区', 'Нинся-Хуэйский автономный район', 'northwest', 38.4872, 106.2309, 'https://www.yinchuan.gov.cn/'],
  ['xining', 'Xining', '西宁', 'Синин', 'Qinghai', '青海省', 'Цинхай', 'northwest', 36.6171, 101.7782, 'https://www.xining.gov.cn/'],
  ['shantou', 'Shantou', '汕头', 'Шаньтоу', 'Guangdong', '广东省', 'Гуандун', 'south', 23.3541, 116.682, 'https://www.shantou.gov.cn/'],
  ['shihezi', 'Shihezi', '石河子', 'Шихэцзы', 'Xinjiang Uyghur Autonomous Region', '新疆维吾尔自治区', 'Синьцзян-Уйгурский автономный район', 'northwest', 44.3059, 86.0805, 'https://www.shz.gov.cn/'],
  ['lhasa', 'Lhasa', '拉萨', 'Лхаса', 'Tibet Autonomous Region', '西藏自治区', 'Тибетский автономный район', 'southwest', 29.652, 91.1721, 'https://www.lasa.gov.cn/'],
  ['jinhua', 'Jinhua', '金华', 'Цзиньхуа', 'Zhejiang', '浙江省', 'Чжэцзян', 'east', 29.0787, 119.6474, 'https://www.jinhua.gov.cn/'],
  ['zhangzhou', 'Zhangzhou', '漳州', 'Чжанчжоу', 'Fujian', '福建省', 'Фуцзянь', 'east', 24.513, 117.6471, 'https://www.zhangzhou.gov.cn/'],
  ['yantai', 'Yantai', '烟台', 'Яньтай', 'Shandong', '山东省', 'Шаньдун', 'east', 37.4638, 121.4479, 'https://www.yantai.gov.cn/'],
  ['baoding', 'Baoding', '保定', 'Баодин', 'Hebei', '河北省', 'Хэбэй', 'north', 38.874, 115.4646, 'https://www.baoding.gov.cn/'],
]

const citySources = citySeeds.map(([slug, en, zh, , , , , , , , url]) => ({
  id: `src-city-profile-20260729-${slug}`,
  url,
  title: `Official city profile — ${en}`,
  publisher: `${en} Municipal People's Government`,
  kind: 'city',
  language: 'zh',
  official: true,
  accessedAt: VERIFIED_AT,
}))

const cities = citySeeds.map(([
  slug,
  en,
  zh,
  ru,
  provinceEn,
  provinceZh,
  provinceRu,
  region,
  lat,
  lng,
]) => ({
  sourceIds: [`src-city-profile-20260729-${slug}`],
  verifiedAt: VERIFIED_AT,
  reviewAfter: CITY_REVIEW_AFTER,
  status: 'verified',
  id: `city-${slug}`,
  slug,
  name: localized(en, zh, ru),
  province: localized(provinceEn, provinceZh, provinceRu),
  region,
  coordinates: { lat, lng },
  overview: localized(
    `${en} is an established higher-education location in ${provinceEn}.`,
    `${zh}是${provinceZh}的重要高等教育城市之一。`,
    `${en} — один из центров высшего образования региона ${provinceRu}.`,
  ),
  climate: null,
  foodHighlights: [],
  sights: [],
}))

// Every row below is identity-only unless a separate current program record is
// declared later in this migration. Official university domains are used as
// identity evidence; no program, fee or deadline is inferred from a homepage.
const universitySeeds = [
  ['peking-union-medical-college', 'Peking Union Medical College', '北京协和医学院', 'Пекинский объединённый медицинский колледж', 'city-beijing', 'https://www.pumc.edu.cn/', 'https://mdadmission.pumc.edu.cn/mdweb/site!index'],
  ['chengdu-university-of-technology', 'Chengdu University of Technology', '成都理工大学', 'Чэндуский технологический университет', 'city-chengdu', 'https://www.cdut.edu.cn/en/', 'https://cie.cdut.edu.cn/'],
  ['chengdu-university-of-traditional-chinese-medicine', 'Chengdu University of Traditional Chinese Medicine', '成都中医药大学', 'Чэндуский университет традиционной китайской медицины', 'city-chengdu', 'https://www.cdutcm.edu.cn/', 'https://zyd.cdutcm.edu.cn/gjjyxy/zsxx/wjxs/content_138726'],
  ['chongqing-medical-university', 'Chongqing Medical University', '重庆医科大学', 'Чунцинский медицинский университет', 'city-chongqing', 'https://www.cqmu.edu.cn/', null],
  ['chongqing-university-of-posts-and-telecommunications', 'Chongqing University of Posts and Telecommunications', '重庆邮电大学', 'Чунцинский университет почты и телекоммуникаций', 'city-chongqing', 'https://www.cqupt.edu.cn/', 'https://iso.cqupt.edu.cn/'],
  ['dalian-medical-university', 'Dalian Medical University', '大连医科大学', 'Даляньский медицинский университет', 'city-dalian', 'https://www.dmu.edu.cn/', null],
  ['dongbei-university-of-finance-and-economics', 'Dongbei University of Finance and Economics', '东北财经大学', 'Дунбэйский университет финансов и экономики', 'city-dalian', 'https://www.dufe.edu.cn/', null],
  ['northeast-normal-university', 'Northeast Normal University', '东北师范大学', 'Северо-Восточный педагогический университет', 'city-changchun', 'https://www.nenu.edu.cn/', 'https://iso.nenu.edu.cn/Admission/Bachelor_Program.htm'],
  ['fujian-normal-university', 'Fujian Normal University', '福建师范大学', 'Фуцзяньский педагогический университет', 'city-fuzhou', 'https://www.fjnu.edu.cn/', 'https://iccs.fjnu.edu.cn/a6/21/c6596a435745/page.htm'],
  ['guangxi-medical-university', 'Guangxi Medical University', '广西医科大学', 'Гуансиский медицинский университет', 'city-nanning', 'https://www.gxmu.edu.cn/', null],
  ['guangzhou-university', 'Guangzhou University', '广州大学', 'Гуанчжоуский университет', 'city-guangzhou', 'https://english.gzhu.edu.cn/', null],
  ['guangzhou-university-of-chinese-medicine', 'Guangzhou University of Chinese Medicine', '广州中医药大学', 'Гуанчжоуский университет китайской медицины', 'city-guangzhou', 'https://www.gzucm.edu.cn/', 'https://studyoverseas.gzucm.edu.cn/zsgz/gjzs.htm'],
  ['guizhou-normal-university', 'Guizhou Normal University', '贵州师范大学', 'Гуйчжоуский педагогический университет', 'city-guiyang', 'https://www.gznu.edu.cn/', 'https://iso.gznu.edu.cn/'],
  ['harbin-normal-university', 'Harbin Normal University', '哈尔滨师范大学', 'Харбинский педагогический университет', 'city-harbin', 'https://www.hrbnu.edu.cn/', 'https://iso.hrbnu.edu.cn/'],
  ['hangzhou-dianzi-university', 'Hangzhou Dianzi University', '杭州电子科技大学', 'Ханчжоуский университет электронных наук и технологий', 'city-hangzhou', 'https://en.hdu.edu.cn/', null],
  ['huaqiao-university', 'Huaqiao University', '华侨大学', 'Университет Хуацяо', 'city-quanzhou', 'https://www.hqu.edu.cn/', null],
  ['jiangsu-university', 'Jiangsu University', '江苏大学', 'Цзянсуский университет', 'city-zhenjiang', 'https://eng.ujs.edu.cn/', 'https://oec.ujs.edu.cn/'],
  ['jiangsu-normal-university', 'Jiangsu Normal University', '江苏师范大学', 'Цзянсуский педагогический университет', 'city-xuzhou', 'https://www.jsnu.edu.cn/', 'https://iso.jsnu.edu.cn/'],
  ['kunming-medical-university', 'Kunming Medical University', '昆明医科大学', 'Куньминский медицинский университет', 'city-kunming', 'https://www.kmmc.cn/', null],
  ['southern-medical-university', 'Southern Medical University', '南方医科大学', 'Южный медицинский университет', 'city-guangzhou', 'https://www.smu.edu.cn/', 'https://lxs.smu.edu.cn/'],
  ['ningbo-university', 'Ningbo University', '宁波大学', 'Нинбоский университет', 'city-ningbo', 'https://www.nbu.edu.cn/', 'https://icnbu.nbu.edu.cn/'],
  ['ningxia-university', 'Ningxia University', '宁夏大学', 'Нинсяский университет', 'city-yinchuan', 'https://www.nxu.edu.cn/', 'https://hzjl.nxu.edu.cn/lxnd/xljy.htm'],
  ['qinghai-university', 'Qinghai University', '青海大学', 'Цинхайский университет', 'city-xining', 'https://www.qhu.edu.cn/', 'https://wsb1.qhu.edu.cn/lxqd/zsjz.htm'],
  ['shandong-normal-university', 'Shandong Normal University', '山东师范大学', 'Шаньдунский педагогический университет', 'city-jinan', 'https://www.sdnu.edu.cn/', 'https://iso.sdnu.edu.cn/'],
  ['shantou-university', 'Shantou University', '汕头大学', 'Шаньтоуский университет', 'city-shantou', 'https://www.stu.edu.cn/', null],
  ['shanghai-university-of-international-business-and-economics', 'Shanghai University of International Business and Economics', '上海对外经贸大学', 'Шанхайский университет международного бизнеса и экономики', 'city-shanghai', 'https://www.suibe.edu.cn/', 'https://iso.suibe.edu.cn/'],
  ['shanghai-maritime-university', 'Shanghai Maritime University', '上海海事大学', 'Шанхайский морской университет', 'city-shanghai', 'https://www.shmtu.edu.cn/', 'https://iso.shmtu.edu.cn/'],
  ['shanghaitech-university', 'ShanghaiTech University', '上海科技大学', 'ШанхайТех', 'city-shanghai', 'https://www.shanghaitech.edu.cn/', 'https://www.shanghaitech.edu.cn/en/global/main.htm'],
  ['university-of-shanghai-for-science-and-technology', 'University of Shanghai for Science and Technology', '上海理工大学', 'Шанхайский университет науки и технологии', 'city-shanghai', 'https://www.usst.edu.cn/', null],
  ['shenyang-pharmaceutical-university', 'Shenyang Pharmaceutical University', '沈阳药科大学', 'Шэньянский фармацевтический университет', 'city-shenyang', 'https://www.syphu.edu.cn/', 'https://iso.syphu.edu.cn/'],
  ['shihezi-university', 'Shihezi University', '石河子大学', 'Шихэцзыский университет', 'city-shihezi', 'https://www.shzu.edu.cn/', null],
  ['capital-university-of-economics-and-business', 'Capital University of Economics and Business', '首都经济贸易大学', 'Столичный университет экономики и бизнеса', 'city-beijing', 'https://www.cueb.edu.cn/', 'https://sie.cueb.edu.cn/'],
  ['capital-normal-university', 'Capital Normal University', '首都师范大学', 'Столичный педагогический университет', 'city-beijing', 'https://www.cnu.edu.cn/', 'https://cie.cnu.edu.cn/lhlx/rxsq/index.htm'],
  ['sichuan-agricultural-university', 'Sichuan Agricultural University', '四川农业大学', 'Сычуаньский сельскохозяйственный университет', 'city-chengdu', 'https://www.sicau.edu.cn/', 'https://ghc.sicau.edu.cn/info/1218/7991.htm'],
  ['sichuan-normal-university', 'Sichuan Normal University', '四川师范大学', 'Сычуаньский педагогический университет', 'city-chengdu', 'https://www.sicnu.edu.cn/', 'https://iso.sicnu.edu.cn/'],
  ['sichuan-international-studies-university', 'Sichuan International Studies University', '四川外国语大学', 'Сычуаньский университет иностранных языков', 'city-chongqing', 'https://www.sisu.edu.cn/', null],
  ['tianjin-university-of-finance-and-economics', 'Tianjin University of Finance and Economics', '天津财经大学', 'Тяньцзиньский университет финансов и экономики', 'city-tianjin', 'https://www.tjufe.edu.cn/', 'https://iso.tjufe.edu.cn/'],
  ['tianjin-foreign-studies-university', 'Tianjin Foreign Studies University', '天津外国语大学', 'Тяньцзиньский университет иностранных языков', 'city-tianjin', 'https://www.tjfsu.edu.cn/', null],
  ['tianjin-medical-university', 'Tianjin Medical University', '天津医科大学', 'Тяньцзиньский медицинский университет', 'city-tianjin', 'https://www.tmu.edu.cn/', null],
  ['northwest-university', 'Northwest University', '西北大学', 'Северо-Западный университет', 'city-xian', 'https://www.nwu.edu.cn/', 'https://sie.nwu.edu.cn/en/Admissions/Majors.htm'],
  ['tibet-university', 'Tibet University', '西藏大学', 'Тибетский университет', 'city-lhasa', 'https://www.utibet.edu.cn/', 'https://gjc.utibet.edu.cn/info/1061/1441.htm'],
  ['southwest-petroleum-university', 'Southwest Petroleum University', '西南石油大学', 'Юго-Западный нефтяной университет', 'city-chengdu', 'https://www.swpu.edu.cn/', 'https://www.swpu.edu.cn/oice/info/1233/3691.htm'],
  ['yunnan-normal-university', 'Yunnan Normal University', '云南师范大学', 'Юньнаньский педагогический университет', 'city-kunming', 'https://www.ynnu.edu.cn/', null],
  ['zhejiang-university-of-finance-and-economics', 'Zhejiang University of Finance and Economics', '浙江财经大学', 'Чжэцзянский университет финансов и экономики', 'city-hangzhou', 'https://www.zufe.edu.cn/', 'https://iso.zufe.edu.cn/'],
  ['zhejiang-university-of-technology', 'Zhejiang University of Technology', '浙江工业大学', 'Чжэцзянский технологический университет', 'city-hangzhou', 'https://www.zjut.edu.cn/', 'https://ies.zjut.edu.cn/'],
  ['zhejiang-normal-university', 'Zhejiang Normal University', '浙江师范大学', 'Чжэцзянский педагогический университет', 'city-jinhua', 'https://www.zjnu.edu.cn/', 'https://iso.zjnu.edu.cn/'],
  ['china-university-of-geosciences-beijing', 'China University of Geosciences (Beijing)', '中国地质大学（北京）', 'Китайский университет геонаук (Пекин)', 'city-beijing', 'https://www.cugb.edu.cn/', 'https://bm.cugb.edu.cn/gjhzyjl-en/study-in-cugb/admission/'],
  ['china-jiliang-university', 'China Jiliang University', '中国计量大学', 'Китайский университет метрологии', 'city-hangzhou', 'https://www.cjlu.edu.cn/', 'https://iso.cjlu.edu.cn/'],
  ['university-of-chinese-academy-of-sciences', 'University of Chinese Academy of Sciences', '中国科学院大学', 'Университет Китайской академии наук', 'city-beijing', 'https://www.ucas.ac.cn/', 'https://english.ucas.ac.cn/index.php/admission/international-students'],
  ['china-university-of-mining-and-technology-beijing', 'China University of Mining and Technology-Beijing', '中国矿业大学（北京）', 'Китайский горный университет (Пекин)', 'city-beijing', 'https://www.cumtb.edu.cn/', 'https://international.cumtb.edu.cn/lxs/zsxx_jz_.htm'],
  ['peoples-public-security-university-of-china', "People's Public Security University of China", '中国人民公安大学', 'Китайский университет общественной безопасности', 'city-beijing', 'https://www.ppsuc.edu.cn/', 'https://en.ppsuc.edu.cn/Study_at_PPSUC/International_Students.htm'],
  ['china-medical-university', 'China Medical University', '中国医科大学', 'Китайский медицинский университет', 'city-shenyang', 'https://www.cmu.edu.cn/', null],
  ['central-academy-of-fine-arts', 'Central Academy of Fine Arts', '中央美术学院', 'Центральная академия изящных искусств', 'city-beijing', 'https://www.cafa.edu.cn/', 'https://www.cafa.edu.cn/library/dynamic.images/info/2025111215244501.pdf'],
  ['central-academy-of-drama', 'Central Academy of Drama', '中央戏剧学院', 'Центральная академия драмы', 'city-beijing', 'https://www.chntheatre.edu.cn/', 'https://www.chntheatre.edu.cn/cn/recruit/liuxue.html'],
  ['wenzhou-university', 'Wenzhou University', '温州大学', 'Вэньчжоуский университет', 'city-wenzhou', 'https://www.wzu.edu.cn/', 'https://cic.wzu.edu.cn/'],
  ['hubei-university', 'Hubei University', '湖北大学', 'Хубэйский университет', 'city-wuhan', 'https://www.hubu.edu.cn/', 'https://eng.hubu.edu.cn/info/1012/2530.htm'],
  ['chongqing-normal-university', 'Chongqing Normal University', '重庆师范大学', 'Чунцинский педагогический университет', 'city-chongqing', 'https://www.cqnu.edu.cn/', 'https://international.cqnu.edu.cn/ywb/info/1376/1302.htm'],
  ['minnan-normal-university', 'Minnan Normal University', '闽南师范大学', 'Миньнаньский педагогический университет', 'city-zhangzhou', 'https://www.mnnu.edu.cn/', 'https://oes.mnnu.edu.cn/info/1024/5947.htm'],
  ['zhejiang-af-university', 'Zhejiang A&F University', '浙江农林大学', 'Чжэцзянский университет сельского и лесного хозяйства', 'city-hangzhou', 'https://www.zafu.edu.cn/', 'https://iec.zafu.edu.cn/info/1038/6702.htm'],
  ['qingdao-university', 'Qingdao University', '青岛大学', 'Циндаоский университет', 'city-qingdao', 'https://www.qdu.edu.cn/', 'https://istudy.qdu.edu.cn/'],
  ['university-of-jinan', 'University of Jinan', '济南大学', 'Цзинаньский университет', 'city-jinan', 'https://www.ujn.edu.cn/', 'https://isao.ujn.edu.cn/'],
  ['yantai-university', 'Yantai University', '烟台大学', 'Яньтайский университет', 'city-yantai', 'https://www.ytu.edu.cn/', 'https://web.ytu.edu.cn/egjjlxy/Admissions.htm'],
  ['hebei-university', 'Hebei University', '河北大学', 'Хэбэйский университет', 'city-baoding', 'https://www.hbu.edu.cn/', 'https://ciee.hbu.edu.cn/en/home/list?did=6&pid=5'],
  ['dalian-university-of-foreign-languages', 'Dalian University of Foreign Languages', '大连外国语大学', 'Даляньский университет иностранных языков', 'city-dalian', 'https://www.dlufl.edu.cn/', 'https://scs.dlufl.edu.cn/gjzs/bksq.htm'],
]

function academicRoot(url) {
  const hostname = new URL(url).hostname.toLowerCase()
  const academic = hostname.match(/([^.]+\.(?:edu\.cn|ac\.cn))$/)
  if (academic) return academic[1]
  return hostname.replace(/^www\./, '')
}

for (const [, , , , , officialUrl, admissionsUrl] of universitySeeds) {
  if (new URL(officialUrl).protocol !== 'https:') throw new Error(`Non-HTTPS official URL: ${officialUrl}`)
  if (admissionsUrl && academicRoot(officialUrl) !== academicRoot(admissionsUrl)) {
    throw new Error(`Admissions domain does not match official institution: ${admissionsUrl}`)
  }
}

const universitySources = universitySeeds.map(([slug, en, , , , officialUrl]) => ({
  id: `src-institution-20260729-${slug}`,
  url: officialUrl,
  title: `Official university profile — ${en}`,
  publisher: en,
  kind: 'university',
  language: 'en',
  official: true,
  accessedAt: VERIFIED_AT,
}))

const cityNameById = new Map([
  ['city-beijing', localized('Beijing', '北京', 'Пекин')],
  ['city-shanghai', localized('Shanghai', '上海', 'Шанхай')],
  ['city-guangzhou', localized('Guangzhou', '广州', 'Гуанчжоу')],
  ['city-hangzhou', localized('Hangzhou', '杭州', 'Ханчжоу')],
  ['city-nanjing', localized('Nanjing', '南京', 'Нанкин')],
  ['city-wuhan', localized('Wuhan', '武汉', 'Ухань')],
  ['city-xian', localized("Xi'an", '西安', 'Сиань')],
  ['city-chengdu', localized('Chengdu', '成都', 'Чэнду')],
  ['city-chongqing', localized('Chongqing', '重庆', 'Чунцин')],
  ['city-tianjin', localized('Tianjin', '天津', 'Тяньцзинь')],
  ['city-harbin', localized('Harbin', '哈尔滨', 'Харбин')],
  ['city-shenyang', localized('Shenyang', '沈阳', 'Шэньян')],
  ['city-dalian', localized('Dalian', '大连', 'Далянь')],
  ['city-changchun', localized('Changchun', '长春', 'Чанчунь')],
  ['city-xuzhou', localized('Xuzhou', '徐州', 'Сюйчжоу')],
  ['city-fuzhou', localized('Fuzhou', '福州', 'Фучжоу')],
  ['city-jinan', localized('Jinan', '济南', 'Цзинань')],
  ['city-qingdao', localized('Qingdao', '青岛', 'Циндао')],
  ['city-nanning', localized('Nanning', '南宁', 'Наньнин')],
  ['city-wenzhou', localized('Wenzhou', '温州', 'Вэньчжоу')],
  ['city-guiyang', localized('Guiyang', '贵阳', 'Гуйян')],
  ['city-kunming', localized('Kunming', '昆明', 'Куньмин')],
  ...citySeeds.map(([slug, en, zh, ru]) => [`city-${slug}`, localized(en, zh, ru)]),
])

const regionByCity = new Map([
  ['city-beijing', 'north'], ['city-shanghai', 'east'], ['city-guangzhou', 'south'],
  ['city-hangzhou', 'east'], ['city-nanjing', 'east'], ['city-wuhan', 'central'],
  ['city-xian', 'northwest'], ['city-chengdu', 'southwest'], ['city-chongqing', 'southwest'],
  ['city-tianjin', 'north'], ['city-harbin', 'northeast'], ['city-shenyang', 'northeast'],
  ['city-dalian', 'northeast'], ['city-changchun', 'northeast'], ['city-xuzhou', 'east'],
  ['city-fuzhou', 'east'], ['city-jinan', 'east'], ['city-qingdao', 'east'],
  ['city-nanning', 'south'], ['city-wenzhou', 'east'], ['city-guiyang', 'southwest'],
  ['city-kunming', 'southwest'],
  ...citySeeds.map(([slug, , , , , , , region]) => [`city-${slug}`, region]),
])

const universities = universitySeeds.map(([
  slug,
  en,
  zh,
  ru,
  cityId,
  officialUrl,
  admissionsUrl,
]) => {
  const city = cityNameById.get(cityId)
  if (!city) throw new Error(`Missing city localization for ${cityId}`)
  return {
    sourceIds: [`src-institution-20260729-${slug}`],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: `uni-${slug}`,
    slug,
    name: localized(en, zh, ru),
    cityId,
    region: regionByCity.get(cityId) ?? null,
    officialUrl,
    admissionsUrl,
    summary: localized(
      `${en} is located in ${city.en}. The official institution and admissions entry points are registered; current program facts must be checked on the official admissions site.`,
      `${zh}位于${city.zh}。平台已登记学校官网及国际招生入口；当前项目、费用和截止日期以官方招生页面为准。`,
      `${ru} находится в городе ${city.ru}. Официальный сайт и приёмная страница зарегистрированы; актуальные программы, стоимость и сроки следует проверять на сайте вуза.`,
    ),
    featured: false,
  }
})

const opportunitySources = [
  ['src-cdut-china-link-2026', 'https://cie.cdut.edu.cn/info/1048/1761.htm', 'Chengdu University of Technology 2026 China Link Scholarship Program Brief', 'Chengdu University of Technology'],
  ['src-wzu-china-link-2026', 'https://cic.wzu.edu.cn/info/1718/11956.htm', 'Wenzhou University 2026 China Link Scholarship Program', 'Wenzhou University'],
  ['src-hubu-iclt-2026', 'https://eng.hubu.edu.cn/info/1012/2530.htm', 'Hubei University 2026 International Chinese Language Teachers Scholarship', 'Hubei University'],
  ['src-cqnu-iclt-2026', 'https://international.cqnu.edu.cn/info/1331/5225.htm', 'Chongqing Normal University 2026 International Chinese Language Teachers Scholarship', 'Chongqing Normal University'],
  ['src-mnnu-iclt-2026', 'https://oes.mnnu.edu.cn/info/1024/5947.htm', 'Minnan Normal University 2026 International Chinese Language Teachers Scholarship', 'Minnan Normal University'],
  ['src-zafu-iclt-2026', 'https://iec.zafu.edu.cn/info/1038/6702.htm', 'Zhejiang A&F University 2026 International Chinese Language Teachers Scholarship', 'Zhejiang A&F University'],
  ['src-fjnu-iclt-2026', 'https://iccs.fjnu.edu.cn/a6/21/c6596a435745/page.htm', 'Fujian Normal University 2026 International Chinese Language Teachers Scholarship', 'Fujian Normal University'],
  ['src-ybu-iclt-2026', 'https://liuxue.ybu.edu.cn/jxj/gjzwjsjxj.htm', 'Yanbian University 2026 International Chinese Language Teachers Scholarship', 'Yanbian University'],
  ['src-jiangnan-iclt-2026', 'https://studyabroad.jiangnan.edu.cn/jxj/gjzwjsjxj.htm', 'Jiangnan University 2026 International Chinese Language Teachers Scholarship', 'Jiangnan University'],
  ['src-sufe-iclt-2026', 'https://intlstu.sufe.edu.cn/ch/ef/57/c17920a257879/page.htm', 'Shanghai University of Finance and Economics 2026 International Chinese Language Teachers Scholarship', 'Shanghai University of Finance and Economics'],
  ['src-zjnu-iclt-2026', 'https://iso.zjnu.edu.cn/2018/0517/c19165a517272/page.htm', 'Zhejiang Normal University 2026 International Chinese Language Teachers Scholarship', 'Zhejiang Normal University'],
  ['src-cqnu-chinese-language-2027', 'https://international.cqnu.edu.cn/ywb/info/1376/1302.htm', 'Chongqing Normal University 2026 Admission Brochure for Language Programs', 'Chongqing Normal University'],
].map(([id, url, title, publisher]) => ({
  id,
  url,
  title,
  publisher,
  kind: 'program',
  language: 'en',
  official: true,
  accessedAt: VERIFIED_AT,
}))

const chinaLinkConfigs = [
  {
    key: 'cdut-china-link-2026-2027',
    universityId: 'uni-chengdu-university-of-technology',
    school: localized('Chengdu University of Technology', '成都理工大学', 'Чэндуский технологический университет'),
    sourceId: 'src-cdut-china-link-2026',
    programUrl: 'https://cie.cdut.edu.cn/info/1048/1761.htm',
    route: localized(
      'Apply in both the CSC and Chengdu University of Technology systems.',
      '须同时在国家留学基金委系统和成都理工大学系统提交申请。',
      'Заявка подаётся одновременно в системе CSC и системе университета.',
    ),
  },
  {
    key: 'wzu-china-link-2026-2027',
    universityId: 'uni-wenzhou-university',
    school: localized('Wenzhou University', '温州大学', 'Вэньчжоуский университет'),
    sourceId: 'src-wzu-china-link-2026',
    programUrl: 'https://cic.wzu.edu.cn/info/1718/11956.htm',
    route: localized(
      'A Wenzhou University pre-admission or invitation is required before the CSC submission.',
      '提交CSC申请前须先取得温州大学预录取或邀请材料。',
      'До подачи в CSC требуется предварительное зачисление или приглашение Вэньчжоуского университета.',
    ),
  },
]

const programs = []
const cycles = []
const scholarships = []

for (const config of chinaLinkConfigs) {
  const programId = `program-${config.key}`
  const sourceIds = [config.sourceId]
  programs.push({
    sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    id: programId,
    slug: config.key,
    universityId: config.universityId,
    name: localized(
      'China Link Short-Term Scientific Exchange Program (2026–2027)',
      '中国政府奖学金短期科研交流项目（2026—2027）',
      'Краткосрочная научно-исследовательская программа China Link (2026–2027)',
    ),
    degreeLevel: 'other',
    discipline: 'other',
    teachingLanguages: ['Chinese', 'English'],
    durationMonths: 1,
    durationMonthsMax: 12,
    programUrl: config.programUrl,
    applyUrl: CSC_PORTAL,
    languageRequirements: [
      { test: 'other', minimum: 'The working language is Chinese or English according to the host field; language proof is optional in the published guide.' },
    ],
    verificationScope: 'facts',
  })
  cycles.push({
    sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    id: `cycle-${config.key}`,
    programId,
    academicYear: '2026-2027',
    intake: 'other',
    opensOn: null,
    closesOn: null,
    dateStatus: 'rolling',
    tuitionCny: null,
    tuitionPeriod: null,
    tuitionStatus: null,
    evidenceBasis: 'cycle-specific',
    factScope: 'dates-only',
    applicationFeeCny: null,
    notes: localized(
      `Applications are accepted year-round and study must begin no later than August 31, 2027. ${config.route.en}`,
      `全年滚动申请，来华学习开始时间不得晚于2027年8月31日。${config.route.zh}`,
      `Заявки принимаются круглый год; обучение должно начаться не позднее 31 августа 2027 года. ${config.route.ru}`,
    ),
  })
  scholarships.push({
    sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    id: `scholarship-${config.key}`,
    slug: config.key,
    name: localized(
      `China Link Scholarship at ${config.school.en}`,
      `${config.school.zh}中国政府奖学金短期科研交流项目`,
      `Стипендия China Link в ${config.school.ru}`,
    ),
    providerType: 'csc',
    universityIds: [config.universityId],
    programIds: [programId],
    coverage: {
      tuition: 'full',
      accommodation: 'full',
      insurance: true,
      stipendCnyPerMonth: null,
    },
    deadline: null,
    applicationUrl: CSC_PORTAL,
    summary: localized(
      `Full funding covers tuition, on-campus accommodation and insurance. The monthly allowance is CNY 3,000 for general scholars and CNY 3,500 for senior scholars. ${config.route.en}`,
      `全额资助覆盖学费、校内住宿和保险；普通进修生生活费为每月3,000元，高级进修生为每月3,500元。${config.route.zh}`,
      `Полное финансирование покрывает обучение, общежитие и страховку; выплата составляет 3 000 юаней для обычных и 3 500 юаней для старших стажёров. ${config.route.ru}`,
    ),
  })
}

const icltConfigs = [
  ['hubu', 'uni-hubei-university', localized('Hubei University', '湖北大学', 'Хубэйском университете'), 'src-hubu-iclt-2026', 'https://eng.hubu.edu.cn/info/1012/2530.htm', '2026-10-10', 2500, null, 'HSK Level 3, 180 for language, literature, history and philosophy directions; an HSK score is required for Taiji culture', 'HSKK required for language, literature, history and philosophy; preferred for Taiji culture'],
  ['cqnu', 'uni-chongqing-normal-university', localized('Chongqing Normal University', '重庆师范大学', 'Чунцинском педагогическом университете'), 'src-cqnu-iclt-2026', 'https://international.cqnu.edu.cn/info/1331/5225.htm', '2026-10-31', 2500, null, 'HSK Level 3, 180 for language, literature, history and philosophy directions; an HSK score is required for TCM and Taiji culture', 'HSKK required for language, literature, history and philosophy; preferred for TCM and Taiji culture'],
  ['mnnu', 'uni-minnan-normal-university', localized('Minnan Normal University', '闽南师范大学', 'Миньнаньском педагогическом университете'), 'src-mnnu-iclt-2026', 'https://oes.mnnu.edu.cn/info/1024/5947.htm', '2026-10-31', 2500, null, 'HSK Level 3, 180', 'A valid HSKK score is required'],
  ['zafu', 'uni-zhejiang-af-university', localized('Zhejiang A&F University', '浙江农林大学', 'Чжэцзянском университете сельского и лесного хозяйства'), 'src-zafu-iclt-2026', 'https://iec.zafu.edu.cn/info/1038/6702.htm', '2026-10-31', 2500, 600, 'HSK Level 3, 180', 'A valid HSKK score is required'],
  ['fjnu', 'uni-fujian-normal-university', localized('Fujian Normal University', '福建师范大学', 'Фуцзяньском педагогическом университете'), 'src-fjnu-iclt-2026', 'https://iccs.fjnu.edu.cn/a6/21/c6596a435745/page.htm', '2026-10-31', 2500, null, 'HSK Level 3, 180', 'A valid HSKK score is required'],
  ['ybu', 'uni-yanbian-university', localized('Yanbian University', '延边大学', 'Яньбяньском университете'), 'src-ybu-iclt-2026', 'https://liuxue.ybu.edu.cn/jxj/gjzwjsjxj.htm', '2026-10-31', 2500, null, 'HSK Level 3, 180 for language, literature, history and philosophy directions; an HSK score is required for TCM and Taiji culture', 'HSKK required for language, literature, history and philosophy; preferred for TCM and Taiji culture'],
  ['jiangnan', 'uni-jiangnan-university', localized('Jiangnan University', '江南大学', 'Университете Цзяннань'), 'src-jiangnan-iclt-2026', 'https://studyabroad.jiangnan.edu.cn/jxj/gjzwjsjxj.htm', '2026-10-31', null, null, 'HSK Level 3, 180', 'A valid HSKK score is required'],
  ['sufe', 'uni-shanghai-university-of-finance-and-economics', localized('Shanghai University of Finance and Economics', '上海财经大学', 'Шанхайском университете финансов и экономики'), 'src-sufe-iclt-2026', 'https://intlstu.sufe.edu.cn/ch/ef/57/c17920a257879/page.htm', '2026-10-15', 2500, null, 'HSK Level 3, 270', 'A valid HSKK score is required'],
  ['zjnu', 'uni-zhejiang-normal-university', localized('Zhejiang Normal University', '浙江师范大学', 'Чжэцзянском педагогическом университете'), 'src-zjnu-iclt-2026', 'https://iso.zjnu.edu.cn/2018/0517/c19165a517272/page.htm', '2026-10-31', 2500, null, 'HSK Level 3, 180', 'A valid HSKK score is required'],
]

for (const [
  key,
  universityId,
  school,
  sourceId,
  programUrl,
  deadline,
  stipendCnyPerMonth,
  applicationFeeCny,
  hsk,
  hskk,
] of icltConfigs) {
  const slug = `${key}-iclt-one-semester-spring-2027`
  const programId = `program-${slug}`
  const sourceIds = [sourceId, ICLT_STANDARD_SOURCE_ID]
  const sufeRoute = key === 'sufe'
    ? localized(
        'The university program application is due October 15, 2026; the central scholarship application is due October 31, 2026.',
        '校内普通进修项目申请截止为2026年10月15日，中央奖学金系统截止为2026年10月31日。',
        'Заявка в университет подаётся до 15 октября 2026 года, а в центральной системе — до 31 октября 2026 года.',
      )
    : null
  programs.push({
    sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    id: programId,
    slug,
    universityId,
    name: localized(
      'International Chinese Language Teachers Scholarship — One-Semester Study (Spring 2027)',
      '国际中文教师奖学金一学期研修项目（2027年春季）',
      'Семестровая программа стипендии для преподавателей китайского языка (весна 2027)',
    ),
    degreeLevel: 'language',
    discipline: 'chinese-education',
    teachingLanguages: ['Chinese'],
    durationMonths: 5,
    programUrl,
    applyUrl: ICLT_PORTAL,
    languageRequirements: [
      { test: 'HSK', minimum: hsk },
      { test: 'other', minimum: hskk },
    ],
    verificationScope: 'facts',
  })
  cycles.push({
    sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    id: `cycle-${slug}`,
    programId,
    academicYear: '2026-2027',
    intake: 'spring',
    opensOn: null,
    closesOn: deadline,
    dateStatus: 'published',
    tuitionCny: null,
    tuitionPeriod: null,
    tuitionStatus: null,
    evidenceBasis: 'cycle-specific',
    factScope: applicationFeeCny === null ? 'dates-only' : 'partial',
    applicationFeeCny,
    notes: sufeRoute ?? localized(
      'A recommending institution is required. Follow the host university guide for any second application system.',
      '申请人须通过推荐机构，并按接收院校简章完成可能要求的第二报名系统。',
      'Требуется рекомендующая организация; при необходимости нужно подать вторую заявку в системе принимающего вуза.',
    ),
  })
  scholarships.push({
    sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    id: `scholarship-${slug}`,
    slug,
    name: localized(
      `International Chinese Language Teachers Scholarship at ${school.en} — Spring 2027`,
      `${school.zh}国际中文教师奖学金（2027年春季）`,
      `Стипендия для преподавателей китайского языка в ${school.ru} — весна 2027`,
    ),
    providerType: 'other',
    universityIds: [universityId],
    programIds: [programId],
    coverage: {
      tuition: 'full',
      accommodation: 'full',
      insurance: true,
      stipendCnyPerMonth,
    },
    deadline,
    applicationUrl: ICLT_PORTAL,
    summary: localized(
      `${stipendCnyPerMonth === null ? 'The official university page confirms tuition, accommodation, living support and medical insurance; it does not state a monthly amount.' : `Funding covers tuition, accommodation, medical insurance and a CNY ${stipendCnyPerMonth.toLocaleString('en')} monthly allowance.`}${key === 'zjnu' ? ' Awardees separately buy CNY 200 annual third-party liability insurance.' : ''}${key === 'zafu' ? ' The university also charges a CNY 600 application fee.' : ''}${sufeRoute ? ` ${sufeRoute.en}` : ''}`,
      `${stipendCnyPerMonth === null ? '学校官方页面确认覆盖学费、住宿、生活支持和医疗保险，但未公布月度金额。' : `资助覆盖学费、住宿、医疗保险及每月${stipendCnyPerMonth.toLocaleString('en')}元生活费。`}${key === 'zjnu' ? '获奖者另需自费购买每学年200元第三方责任险。' : ''}${key === 'zafu' ? '学校另收取600元申请费。' : ''}${sufeRoute ? sufeRoute.zh : ''}`,
      `${stipendCnyPerMonth === null ? 'Официальная страница подтверждает оплату обучения, проживания, поддержку и медицинскую страховку, но не указывает ежемесячную сумму.' : `Финансирование покрывает обучение, проживание, страховку и ежемесячную выплату ${stipendCnyPerMonth.toLocaleString('en')} юаней.`}${key === 'zjnu' ? ' Отдельно оплачивается страхование ответственности 200 юаней в год.' : ''}${key === 'zafu' ? ' Университет также взимает регистрационный сбор 600 юаней.' : ''}${sufeRoute ? ` ${sufeRoute.ru}` : ''}`,
    ),
  })
}

const cqnuLanguageSlug = 'cqnu-chinese-language-spring-2027'
programs.push({
  sourceIds: ['src-cqnu-chinese-language-2027'],
  verifiedAt: VERIFIED_AT,
  reviewAfter: DYNAMIC_REVIEW_AFTER,
  status: 'verified',
  id: `program-${cqnuLanguageSlug}`,
  slug: cqnuLanguageSlug,
  universityId: 'uni-chongqing-normal-university',
  name: localized(
    'Chinese Language Program — Spring 2027',
    '汉语进修项目（2027年春季）',
    'Программа китайского языка — весна 2027',
  ),
  degreeLevel: 'language',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  durationMonths: 4,
  durationMonthsMax: 5,
  programUrl: 'https://international.cqnu.edu.cn/ywb/info/1376/1302.htm',
  applyUrl: 'https://foreignstudent.cqnu.edu.cn/',
  languageRequirements: [
    { test: 'other', minimum: 'HSK and HSKK certificates are requested when available; the guide states no minimum score.' },
  ],
  verificationScope: 'facts',
})
cycles.push({
  sourceIds: ['src-cqnu-chinese-language-2027'],
  verifiedAt: VERIFIED_AT,
  reviewAfter: DYNAMIC_REVIEW_AFTER,
  status: 'verified',
  id: `cycle-${cqnuLanguageSlug}`,
  programId: `program-${cqnuLanguageSlug}`,
  academicYear: '2026-2027',
  intake: 'spring',
  opensOn: '2026-09-01',
  closesOn: '2026-12-30',
  dateStatus: 'published',
  tuitionCny: 7000,
  tuitionPeriod: 'semester',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'cycle-specific',
  factScope: 'complete',
  applicationFeeCny: 400,
  notes: localized(
    'Study runs from March to June/July 2027. The Chinese page closes on December 30 while the English page says December 31, so the earlier date is published. Double-room accommodation is CNY 5,400 per academic year and insurance is CNY 800 per year.',
    '学习时间为2027年3月至6月／7月。中文页截止为12月30日、英文页为12月31日，平台保守采用更早日期。双人间住宿费为每学年5,400元，保险费为每年800元。',
    'Обучение проходит с марта по июнь/июль 2027 года. Китайская страница указывает 30 декабря, английская — 31 декабря, поэтому опубликована более ранняя дата. Общежитие стоит 5 400 юаней в год, страховка — 800 юаней.',
  ),
})

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

function upsertById(current, additions) {
  const additionsById = new Map(additions.map((item) => [item.id, item]))
  const output = current.map((item) => additionsById.get(item.id) ?? item)
  const currentIds = new Set(current.map((item) => item.id))
  output.push(...additions.filter((item) => !currentIds.has(item.id)))
  return output
}

function normalizeBlcu(bundle) {
  const canonicalId = 'uni-beijing-language-and-culture-university'
  const duplicateId = 'uni-beijing-language-university'
  const canonical = bundle.universities.find((item) => item.id === canonicalId)
  const duplicate = bundle.universities.find((item) => item.id === duplicateId)
  if (!canonical) throw new Error('Canonical BLCU university is missing')
  if (duplicate) {
    canonical.sourceIds = [...new Set([...canonical.sourceIds, ...duplicate.sourceIds])]
  }
  bundle.universities = bundle.universities.filter((item) => item.id !== duplicateId)
  bundle.programs = bundle.programs.map((item) => (
    item.universityId === duplicateId ? { ...item, universityId: canonicalId } : item
  ))
  bundle.scholarships = bundle.scholarships.map((item) => ({
    ...item,
    universityIds: [...new Set(item.universityIds.map((id) => (
      id === duplicateId ? canonicalId : id
    )))],
  }))
  bundle.sources = bundle.sources.map((item) => (
    item.id === 'src-blcu-university' || item.id === 'src-blcu-iclt-2026'
      ? { ...item, publisher: 'Beijing Language and Culture University' }
      : item
  ))
}

function assertUnique(items, field, label) {
  const seen = new Set()
  for (const item of items) {
    const value = item[field]
    if (seen.has(value)) throw new Error(`Duplicate ${label} ${field}: ${value}`)
    seen.add(value)
  }
}

function apply() {
  const bundle = {
    sources: upsertById(readJson('sources.json'), [
      ...citySources,
      ...universitySources,
      ...opportunitySources,
    ]),
    cities: upsertById(readJson('cities.json'), cities),
    universities: upsertById(readJson('universities.json'), universities),
    programs: upsertById(readJson('programs.json'), programs),
    admissionCycles: upsertById(readJson('admission-cycles.json'), cycles),
    scholarships: upsertById(readJson('scholarships.json'), scholarships),
  }

  normalizeBlcu(bundle)
  assertUnique(bundle.universities, 'id', 'university')
  assertUnique(bundle.universities, 'slug', 'university')
  assertUnique(bundle.universities.map((item) => ({ zh: item.name.zh })), 'zh', 'university')
  assertUnique(bundle.programs, 'id', 'program')
  assertUnique(bundle.programs, 'slug', 'program')
  assertUnique(bundle.scholarships, 'id', 'scholarship')
  assertUnique(bundle.scholarships, 'slug', 'scholarship')

  writeJson('sources.json', bundle.sources)
  writeJson('cities.json', bundle.cities)
  writeJson('universities.json', bundle.universities)
  writeJson('programs.json', bundle.programs)
  writeJson('admission-cycles.json', bundle.admissionCycles)
  writeJson('scholarships.json', bundle.scholarships)

  const registry = JSON.parse(fs.readFileSync(DFC_TARGET_PATH, 'utf8'))
  const catalogIdByName = new Map(bundle.universities.map((item) => [item.name.zh, item.id]))
  registry.targets = registry.targets.map((target) => {
    const catalogInstitutionId = catalogIdByName.get(target.officialNameZh)
    if (!catalogInstitutionId) {
      const { catalogInstitutionId: ignored, ...rest } = target
      return rest
    }
    return { ...target, catalogInstitutionId }
  })
  fs.writeFileSync(DFC_TARGET_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')

  const futureThreshold = '2026-08-28'
  const newCycleIds = new Set(cycles.map((item) => item.id))
  for (const cycle of bundle.admissionCycles.filter((item) => newCycleIds.has(item.id))) {
    if (cycle.dateStatus !== 'rolling' && (!cycle.closesOn || cycle.closesOn < futureThreshold)) {
      throw new Error(`New cycle is not at least 30 days in the future: ${cycle.id}`)
    }
  }

  console.log(JSON.stringify({
    sources: bundle.sources.length,
    cities: bundle.cities.length,
    universities: bundle.universities.length,
    uniqueUniversities: new Set(bundle.universities.map((item) => item.name.zh)).size,
    programs: bundle.programs.length,
    admissionCycles: bundle.admissionCycles.length,
    scholarships: bundle.scholarships.length,
    newUniversityProfiles: universities.length,
    newPrograms: programs.length,
    newScholarships: scholarships.length,
    doubleFirstClassMapped: registry.targets.filter((item) => item.catalogInstitutionId).length,
  }, null, 2))
}

apply()
