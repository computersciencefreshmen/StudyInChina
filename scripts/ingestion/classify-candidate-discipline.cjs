'use strict'

const TECHNICAL_PATTERN = /\b(?:artificial intelligence|computer(?: science)?|computing|software|engineering|information technology|data science|transport(?:ation)?|marine engineering|mining engineering)\b|人工智能|计算机|软件|工程|信息技术|数据科学|交通运输|矿业工程/i

// `Chinese` on its own often describes the teaching language (for example,
// "Computer Science — Chinese-English bilingual"). It is not evidence that
// the subject is Chinese-language study, so require an explicit study title.
const CHINESE_STUDY_PATTERN = /\b(?:chinese language(?: and literature)?|chinese literature|chinese linguistics?|chinese philology|chinese culture|chinese studies|business chinese|chinese for business|mandarin|international chinese (?:language )?education|international education of chinese language|teaching chinese(?: to speakers of other languages)?|mtcsol|tcsol)\b|国际中文教育|汉语国际教育|对外汉语|汉语言(?:文学)?|汉语|中文|中国语言(?:文学)?/i

function classifyCandidateDiscipline(candidate) {
  const text = `${candidate.name?.en ?? ''} ${candidate.name?.zh ?? ''} ${candidate.name?.ru ?? ''}`.normalize('NFKC')

  if (/medicine|medical|mbbs|stomat|pharmacy|pharmaceutical|public health|中医|医学|口腔|药学|公共卫生/i.test(text)) return 'medicine'
  if (TECHNICAL_PATTERN.test(text)) return 'engineering'
  if (CHINESE_STUDY_PATTERN.test(text)) return 'chinese-education'
  if (/business|econom|finance|account|management|commerce|trade|logistics|mba|经济|金融|管理|商务|贸易|会计|物流/i.test(text)) return 'business'
  if (/law|legal|法学|法律/i.test(text)) return 'law-ir'
  if (/educational technology|education|pedagog|curriculum|教育技术学?|教育学|课程与教学|学前教育|特殊教育/i.test(text)) return 'humanities'
  if (/art|design|music|drama|film|theatre|美术|艺术|设计|音乐|戏剧|电影/i.test(text)) return 'art-design'
  if (/technology|marine|mining|electrical|electronic|mechanical|automation|技术|海洋|矿业|电气|电子|机械|自动化/i.test(text)) return 'engineering'
  if (/science|mathemat|physics|chemistry|biology|environment|科学|数学|物理|化学|生物|环境/i.test(text)) return 'science'
  if (/history|literature|language|education|psychology|历史|文学|语言|教育|心理/i.test(text)) return 'humanities'
  return 'other'
}

module.exports = { classifyCandidateDiscipline }
