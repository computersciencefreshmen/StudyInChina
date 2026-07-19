import type { LocalizedText } from '@/lib/data/types'

type GuideSection = { title: LocalizedText; items: LocalizedText[] }
export type Guide = { slug: string; title: LocalizedText; summary: LocalizedText; updatedAt: string; sections: GuideSection[] }

const t = (en: string, zh: string, ru: string): LocalizedText => ({ en, zh, ru })

export const guides: Guide[] = [
  {
    slug: 'choose-a-program', updatedAt: '2026-07-16',
    title: t('Choose a university and program', '如何选择大学与项目', 'Как выбрать вуз и программу'),
    summary: t('Build a balanced shortlist using academic fit, language, cost and verified application facts.', '从学术匹配、授课语言、费用和已核验申请信息出发，建立合理选校清单。', 'Составьте сбалансированный список с учётом программы, языка, стоимости и проверенных условий.'),
    sections: [
      { title: t('Start with your constraints', '先明确自己的条件', 'Начните с ограничений'), items: [t('Choose the degree level, subject and teaching language you can realistically study in.', '确定适合自己的学位、学科和授课语言。', 'Определите подходящие уровень, направление и язык обучения.'), t('Set a total annual budget that includes tuition, housing, insurance and daily life.', '年度预算应包含学费、住宿、保险与日常生活费。', 'Учтите обучение, жильё, страховку и повседневные расходы.')] },
      { title: t('Create three tiers', '建立三个梯度', 'Сделайте три уровня'), items: [t('Include ambitious, realistic and safer options; rankings alone do not predict admission.', '同时选择冲刺、匹配和稳妥项目；排名本身不能预测录取。', 'Добавьте амбициозные, реалистичные и более надёжные варианты; рейтинг не гарантирует поступление.'), t('Confirm every deadline and requirement on the official page before submitting.', '提交前在官方页面再次确认每项截止日期和要求。', 'Перед подачей перепроверьте сроки и требования на официальном сайте.')] },
    ],
  },
  {
    slug: 'application-documents', updatedAt: '2026-07-16',
    title: t('Prepare application documents', '准备申请材料', 'Подготовка документов'),
    summary: t('A privacy-conscious checklist for assembling common university application materials.', '一份注重隐私的常见大学申请材料清单。', 'Безопасный список типичных документов для поступления.'),
    sections: [
      { title: t('Common documents', '常见材料', 'Типичные документы'), items: [t('Passport identity page, diploma or expected-graduation letter, transcripts and certified translations when required.', '护照信息页、毕业证或预毕业证明、成绩单，以及学校要求的认证翻译件。', 'Страница паспорта, диплом или справка об ожидаемом выпуске, выписка оценок и заверенные переводы при необходимости.'), t('Language certificate, study plan, recommendation letters and a recent photo may be requested.', '学校可能要求语言证书、学习计划、推荐信和近期照片。', 'Могут потребоваться языковой сертификат, учебный план, рекомендации и фотография.')] },
      { title: t('Protect sensitive files', '保护敏感文件', 'Защитите данные'), items: [t('Upload documents only to the university or scholarship system named on an official domain.', '只向官方域名所指向的大学或奖学金系统上传材料。', 'Загружайте документы только в систему, указанную на официальном домене.'), t('This website never asks for passports, transcripts, health records or recommendation letters.', '本站绝不会索要护照、成绩单、健康资料或推荐信。', 'Этот сайт никогда не запрашивает паспорт, оценки, медицинские документы или рекомендации.')] },
    ],
  },
  {
    slug: 'scholarship-route', updatedAt: '2026-07-16',
    title: t('Plan a scholarship route', '规划奖学金申请', 'План стипендиальной заявки'),
    summary: t('Compare national, local and university funding without assuming that one application covers all routes.', '比较国家、地方和高校资助，避免误以为一次申请即可覆盖所有渠道。', 'Сравните государственные, местные и вузовские варианты — у них могут быть разные заявки.'),
    sections: [
      { title: t('Read the route carefully', '仔细确认申请渠道', 'Проверьте маршрут подачи'), items: [t('CSC, provincial, city and university awards may use different portals and nomination routes.', 'CSC、省市及高校奖学金可能使用不同系统和推荐渠道。', 'CSC, провинциальные, городские и вузовские стипендии могут иметь разные порталы и порядок номинации.'), t('Check whether admission and scholarship applications are separate and whether both deadlines apply.', '确认入学申请与奖学金申请是否分开，以及是否存在两个截止日期。', 'Уточните, раздельны ли заявления на поступление и стипендию и действуют ли два срока.')] },
      { title: t('Confirm the coverage', '确认资助范围', 'Уточните покрытие'), items: [t('Verify tuition, accommodation, insurance and stipend separately for the current cycle.', '分别核对当期学费、住宿、保险和生活费资助。', 'Отдельно проверьте оплату обучения, жилья, страховки и стипендию на текущий цикл.')] },
    ],
  },
  {
    slug: 'visa-and-arrival', updatedAt: '2026-07-16',
    title: t('Visa and arrival basics', '签证与抵达基础', 'Виза и прибытие'),
    summary: t('Use your university instructions and official consular guidance for the final pre-departure steps.', '最后的行前步骤应以学校通知和领事机构官方指引为准。', 'На финальном этапе следуйте инструкциям вуза и официальным консульским требованиям.'),
    sections: [
      { title: t('Before departure', '出发之前', 'До поездки'), items: [t('Confirm the correct visa type, required admission documents and any medical-examination rules with the responsible Chinese mission.', '向负责地区的中国使领馆确认签证类型、录取材料和体检规则。', 'Уточните тип визы, документы о зачислении и медосмотр в ответственном консульстве Китая.'), t('Keep digital and paper copies, but do not send them through informal messaging accounts.', '保存电子与纸质副本，但不要通过非官方聊天账号发送。', 'Храните цифровые и бумажные копии, но не пересылайте их неофициальным аккаунтам.')] },
      { title: t('After arrival', '抵达之后', 'После прибытия'), items: [t('Follow university registration, accommodation registration and residence-permit instructions promptly.', '及时按照学校要求完成报到、住宿登记和居留许可手续。', 'Своевременно выполните регистрацию в вузе, по месту проживания и оформление вида на жительство.')] },
    ],
  },
  {
    slug: 'verify-admissions-data', updatedAt: '2026-07-16',
    title: t('How to verify admissions information', '如何核验招生信息', 'Как проверять данные о приёме'),
    summary: t('Recognize official sources, academic-year labels and warning signs before acting on a claim.', '在采取行动前，识别官方来源、适用学年与风险信号。', 'Научитесь распознавать официальные источники, учебный год и тревожные признаки.'),
    sections: [
      { title: t('Use the source chain', '沿着来源链核验', 'Проверяйте цепочку источников'), items: [t('Open the linked official university or government page and confirm the academic year.', '打开所链接的高校或政府官方页面，并确认适用学年。', 'Откройте официальную страницу вуза или ведомства и проверьте учебный год.'), t('Treat undated screenshots, copied tables and agent messages as leads, not authority.', '把无日期截图、转载表格和中介消息视为线索，而非最终依据。', 'Считайте скриншоты без даты, копии таблиц и сообщения посредников подсказками, а не официальным подтверждением.')] },
      { title: t('When information conflicts', '出现冲突时', 'Если данные расходятся'), items: [t('Prefer the newest official notice for the same program and contact the university admissions office if ambiguity remains.', '优先采用同一项目最新的官方通知；仍不明确时联系学校招生办公室。', 'Отдавайте приоритет новейшему официальному объявлению по той же программе; при сомнениях свяжитесь с приёмной комиссией.')] },
    ],
  },
]

export function getGuide(slug: string) { return guides.find((guide) => guide.slug === slug) }
