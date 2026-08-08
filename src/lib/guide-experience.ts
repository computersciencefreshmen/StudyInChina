import type { LocalizedText } from '@/lib/data/types'

export type GuideChapter = {
  id: string
  title: LocalizedText
  introduction: LocalizedText
  items: LocalizedText[]
}

export type GuideOfficialSource = {
  title: LocalizedText
  publisher: LocalizedText
  url: string
  checkedAt: string
}

export type GuideFaq = {
  question: LocalizedText
  answer: LocalizedText
}

export type GuideRelatedLink = {
  title: LocalizedText
  description: LocalizedText
  path: string
}

export type GuideEnhancement = {
  updatedAt: string
  readTimeMinutes: number
  chapters: GuideChapter[]
  sources: GuideOfficialSource[]
  faq: GuideFaq[]
  relatedLinks: GuideRelatedLink[]
}

const t = (en: string, zh: string, ru: string): LocalizedText => ({ en, zh, ru })

const chooseAProgram: GuideEnhancement = {
  updatedAt: '2026-08-08',
  readTimeMinutes: 12,
  chapters: [
    {
      id: 'define-your-fit',
      title: t('Define your non-negotiables', '先定义不可妥协的条件', 'Определите обязательные условия'),
      introduction: t('A useful shortlist begins with your constraints, not a ranking table.', '有效的选校清单应从个人条件开始，而不是从排名表开始。', 'Полезный список начинается с ваших условий, а не с рейтинга.'),
      items: [
        t('Write down one degree level, two or three academic fields and every teaching language in which you can complete assessed work.', '写下一个目标学位层次、两到三个学科方向，以及你能够完成课程考核的授课语言。', 'Запишите уровень обучения, два-три направления и языки, на которых вы сможете выполнять учебные задания.'),
        t('Set an annual ceiling that includes tuition, application fees, housing, insurance, travel and daily life—not tuition alone.', '设定包含学费、申请费、住宿、保险、交通和生活费的年度预算上限，而不是只看学费。', 'Установите годовой бюджет с учётом обучения, сборов, жилья, страховки, поездок и повседневных расходов.'),
        t('Mark the earliest date when your passport, diploma, transcripts, language result and recommendations can be ready.', '标出护照、学历证明、成绩单、语言成绩和推荐信最早可以准备完成的日期。', 'Отметьте, когда будут готовы паспорт, диплом, выписка оценок, языковой сертификат и рекомендации.'),
      ],
    },
    {
      id: 'confirm-international-access',
      title: t('Confirm that international applicants can use the route', '确认该渠道真正面向国际申请人', 'Убедитесь, что маршрут открыт иностранцам'),
      introduction: t('A domestic course catalogue proves that a subject exists; it does not prove that an international applicant can apply.', '国内生培养目录只能证明专业存在，并不能证明国际学生可以申请。', 'Внутренний каталог подтверждает существование программы, но не доступность для иностранцев.'),
      items: [
        t('Start from the university’s official international admissions domain or international-student office, then follow its program-level links.', '从大学国际招生官网或国际学生办公室页面进入，再沿着链接找到项目级页面。', 'Начинайте с официального сайта международного приёма и переходите по ссылкам на конкретную программу.'),
        t('Look for an explicit degree, intake, applicant category and application route. Treat exchange-only, nominated or group-only routes separately.', '确认页面明确写出学位、入学季、申请人类别和申请渠道；交换、校际推荐或团体渠道要单独判断。', 'Ищите явные сведения о степени, наборе, категории заявителя и маршруте подачи; обменные и номинационные маршруты рассматривайте отдельно.'),
        t('Separate program identity from the annual admission cycle. A valid program can remain visible while its next deadline is not yet announced.', '把项目本身与年度招生周期分开：项目可以继续存在，但下一轮截止日期可能尚未公布。', 'Отделяйте саму программу от ежегодного набора: программа может существовать, даже если новый срок ещё не объявлен.'),
      ],
    },
    {
      id: 'compare-like-for-like',
      title: t('Compare like with like', '使用同一口径比较', 'Сравнивайте одинаковые параметры'),
      introduction: t('Build one comparison row per official fact so a missing value stays visible instead of becoming a guess.', '每个官方事实对应一列，让缺失信息保持可见，而不是被猜测值填满。', 'Сведите официальные факты в одинаковые столбцы, не заменяя пробелы догадками.'),
      items: [
        t('Compare degree, faculty, teaching language, duration, campus and qualification—not title alone.', '比较学位、院系、授课语言、学制、校区和最终资格，而不只比较项目名称。', 'Сравнивайте степень, факультет, язык, длительность, кампус и квалификацию, а не только название.'),
        t('Record tuition with its billing period and academic year. “30,000 CNY” can mean per semester, year or whole program.', '记录学费时同时记录计费周期和学年；“30,000 元”可能指每学期、每学年或整个项目。', 'Записывайте стоимость вместе с периодом и учебным годом: сумма может относиться к семестру, году или всей программе.'),
        t('For research degrees, check supervisor or faculty fit and proposal requirements before treating a route as realistic.', '申请研究型学位时，应先核对导师或院系匹配度以及研究计划要求，再判断项目是否现实。', 'Для исследовательских степеней заранее проверьте научного руководителя, факультет и требования к проекту.'),
      ],
    },
    {
      id: 'build-a-balanced-portfolio',
      title: t('Build a balanced application portfolio', '建立有梯度的申请组合', 'Соберите сбалансированный портфель'),
      introduction: t('The purpose of tiers is risk control, not predicting an admission decision.', '分档的目的在于控制风险，而不是预测录取结果。', 'Уровни нужны для управления риском, а не для предсказания решения.'),
      items: [
        t('Use ambitious, well-matched and more conservative tiers based on published eligibility—not reputation alone.', '根据公开的申请资格划分冲刺、匹配和相对稳妥档，而不是只看学校声誉。', 'Разделите варианты на амбициозные, подходящие и более надёжные по опубликованным требованиям, а не только по престижу.'),
        t('Keep enough geographic and cost diversity that one city, deadline or funding decision cannot collapse the whole plan.', '保持城市和费用结构的多样性，避免一个城市、一个截止日或一次奖学金结果让整个计划失效。', 'Разнообразьте города и стоимость, чтобы один срок или отказ в финансировании не разрушил весь план.'),
        t('Track admission and scholarship routes separately; they may use different portals, documents and deadlines.', '分别跟进入学申请与奖学金申请；两者可能使用不同系统、材料和截止日期。', 'Отслеживайте поступление и стипендию отдельно: порталы, документы и сроки могут различаться.'),
      ],
    },
    {
      id: 'final-source-check',
      title: t('Run a final source check before submitting', '提交前完成最后一次来源核验', 'Проведите финальную проверку источников'),
      introduction: t('Your saved comparison is a working record; the official application system is the final authority.', '保存的比较表只是工作记录，最终仍以官方申请系统为准。', 'Ваша таблица — рабочая запись; окончательным источником остаётся официальная система.'),
      items: [
        t('Save the official URL, page title, academic year and date checked beside every deadline, fee and requirement.', '在每个截止日期、费用和要求旁保存官方网址、页面标题、学年和检查日期。', 'Сохраняйте официальный URL, заголовок, учебный год и дату проверки рядом с каждым сроком, сбором и требованием.'),
        t('Re-open every source shortly before payment or submission, especially if the page was a PDF or an older cycle.', '付款或提交前再次打开每个来源，尤其是 PDF 或旧年度页面。', 'Перед оплатой и подачей снова откройте каждый источник, особенно PDF и страницы прошлых циклов.'),
        t('If two official pages conflict, do not average them. Ask the international admissions office which notice governs your route.', '如果两个官方页面冲突，不要自行折中；应向国际招生办公室确认哪个公告适用于你的渠道。', 'Если официальные страницы противоречат друг другу, не усредняйте данные — уточните применимый документ у международной приёмной.'),
      ],
    },
  ],
  sources: [
    {
      title: t('Application for Studying in China', '来华留学申请说明', 'Подача на обучение в Китае'),
      publisher: t('Ministry of Education of the People’s Republic of China', '中华人民共和国教育部', 'Министерство образования КНР'),
      url: 'https://en.moe.gov.cn/Cooperation_Exchanges/201506/t20150626_191374.html',
      checkedAt: '2026-08-08',
    },
    {
      title: t('Chinese Government Scholarship online application guide', '中国政府奖学金网上申请操作指南', 'Инструкция по онлайн-заявке на стипендию правительства Китая'),
      publisher: t('China Scholarship Council / Campus China', '国家留学基金管理委员会 / 留学中国', 'China Scholarship Council / Campus China'),
      url: 'https://campuschina.org/Upload/file/20240408/20240408111909_5912.pdf',
      checkedAt: '2026-08-08',
    },
    {
      title: t('International undergraduate admissions', '国际本科生招生官网', 'Международный приём на бакалавриат'),
      publisher: t('Tsinghua University', '清华大学', 'Университет Цинхуа'),
      url: 'https://international.join-tsinghua.edu.cn/',
      checkedAt: '2026-08-08',
    },
  ],
  faq: [
    {
      question: t('Is a university ranking enough to choose a program?', '大学排名足以决定项目吗？', 'Достаточно ли рейтинга для выбора?'),
      answer: t('No. Rankings can help with discovery, but international eligibility, curriculum, language, current cycle, total cost and official application route determine whether an option is usable.', '不够。排名可用于发现学校，但国际生资格、课程、语言、当前招生周期、总成本和官方渠道才决定项目是否可申请。', 'Нет. Рейтинг помогает искать, но пригодность определяют доступность для иностранцев, содержание, язык, текущий набор, стоимость и официальный маршрут.'),
    },
    {
      question: t('Does a program page prove that applications are open now?', '项目页面能证明现在开放申请吗？', 'Доказывает ли страница программы, что приём открыт?'),
      answer: t('Not by itself. Confirm a current academic year, intake, opening date and deadline on the official admissions notice or system.', '不能。还需在官方招生公告或系统中确认当前学年、入学季、开放日期和截止日期。', 'Нет. Нужны текущий учебный год, набор, дата открытия и срок на официальной странице или в системе.'),
    },
    {
      question: t('What should I do when tuition or a deadline is missing?', '学费或截止日期缺失时怎么办？', 'Что делать, если нет стоимости или срока?'),
      answer: t('Keep the field unknown, open the official admissions route and contact the university if the decision cannot wait. Do not copy a value from another program or year.', '保持“尚未公布”，打开官方招生渠道；若无法等待，应联系学校。不要套用其他项目或年份的数据。', 'Оставьте поле неизвестным, проверьте официальный маршрут и при необходимости свяжитесь с вузом. Не переносите данные из другой программы или года.'),
    },
    {
      question: t('How many applications should I submit?', '应该申请多少个项目？', 'Сколько заявок подавать?'),
      answer: t('There is no universal number. Choose a workload you can document carefully, afford and submit on time while preserving a genuine range of academic and financial outcomes.', '没有通用数量。应选择自己能认真准备材料、承担费用并按时提交的规模，同时保持学术和费用层面的选择空间。', 'Универсального числа нет. Выберите объём, который сможете качественно подготовить, оплатить и подать вовремя, сохранив разнообразие вариантов.'),
    },
  ],
  relatedLinks: [
    { title: t('Compare programs', '比较项目', 'Сравнить программы'), description: t('Filter by level, field, language and published dates.', '按学位、学科、语言和已公布日期筛选。', 'Фильтруйте по уровню, направлению, языку и датам.'), path: 'programs' },
    { title: t('Explore universities', '探索大学', 'Смотреть университеты'), description: t('Review institutions by city, region and academic field.', '按城市、区域和学科了解高校。', 'Смотрите вузы по городу, региону и направлению.'), path: 'universities' },
    { title: t('Check scholarships', '查看奖学金', 'Проверить стипендии'), description: t('Keep funding routes separate from admission routes.', '分别规划奖学金与入学申请渠道。', 'Отслеживайте финансирование отдельно от поступления.'), path: 'scholarships' },
    { title: t('Read the data policy', '阅读数据政策', 'Прочитать политику данных'), description: t('Understand source, freshness and unknown-value rules.', '了解来源、时效和未知值处理原则。', 'Узнайте правила источников, актуальности и неизвестных значений.'), path: 'data-policy' },
  ],
}

const visaAndArrival: GuideEnhancement = {
  updatedAt: '2026-08-08',
  readTimeMinutes: 14,
  chapters: [
    {
      id: 'follow-the-right-authority',
      title: t('Follow the right authority in the right order', '按正确顺序核对主管机构', 'Проверяйте органы в правильном порядке'),
      introduction: t('Visa and arrival rules depend on your circumstances and place of application, so one generic checklist is never final.', '签证和入境规则取决于个人情况与申请地点，因此通用清单不能替代最终要求。', 'Визовые правила зависят от обстоятельств и места подачи, поэтому общий список не бывает окончательным.'),
      items: [
        t('First read the admission package and arrival instructions issued by your university for your intake.', '先阅读大学针对当前入学季发出的录取材料与报到说明。', 'Сначала изучите пакет зачисления и инструкции вуза для вашего набора.'),
        t('Then check the Chinese embassy, consulate or authorized visa centre responsible for the place where you legally apply.', '再核对负责你合法申请所在地的中国使领馆或授权签证中心。', 'Затем проверьте требования посольства, консульства или уполномоченного визового центра по месту законной подачи.'),
        t('After entry, follow the university and local exit-entry administration; rules for a visa application abroad and residence formalities in China are different stages.', '入境后听从学校和当地出入境管理部门指引；境外签证申请与境内居留手续是两个阶段。', 'После въезда следуйте инструкциям вуза и местной миграционной службы: зарубежная виза и оформление проживания — разные этапы.'),
      ],
    },
    {
      id: 'understand-x1-and-x2',
      title: t('Understand the X1 / X2 distinction', '理解 X1 与 X2 的区别', 'Поймите различие X1 и X2'),
      introduction: t('Official consular guidance generally distinguishes study longer than 180 days from study of 180 days or less.', '官方领事指引通常以超过 180 天和不超过 180 天区分长期与短期学习。', 'Официальные консульские инструкции обычно разделяют обучение свыше 180 дней и до 180 дней включительно.'),
      items: [
        t('X1 is generally for study longer than 180 days; X2 is generally for study of no more than 180 days. Confirm the category with your responsible mission.', 'X1 通常适用于超过 180 天的学习，X2 通常适用于不超过 180 天的学习；最终应向负责使领馆确认。', 'X1 обычно предназначена для обучения свыше 180 дней, X2 — до 180 дней включительно; подтвердите категорию в своей миссии.'),
        t('Use the admission notice and study-in-China confirmation documents exactly as your university and mission instruct; names and required originals can vary by route.', '按照大学和使领馆说明使用录取通知书及来华学习确认材料；不同渠道对材料名称和原件要求可能不同。', 'Используйте письмо о зачислении и подтверждения строго по инструкциям вуза и миссии; требования к оригиналам различаются.'),
        t('Do not buy non-refundable travel solely because an application was submitted. Wait for the issued visa and university arrival window.', '不要仅因已经提交签证申请就购买不可退改的行程；应等待签证签发并确认学校报到时间。', 'Не покупайте невозвратные билеты только на основании поданной заявки; дождитесь визы и окна прибытия вуза.'),
      ],
    },
    {
      id: 'prepare-and-protect-documents',
      title: t('Prepare—and protect—your document set', '准备并保护好材料', 'Подготовьте и защитите документы'),
      introduction: t('Keep an orderly travel file without sending sensitive documents through unofficial channels.', '建立清晰的行前材料档案，同时避免通过非官方渠道发送敏感文件。', 'Соберите упорядоченный комплект, не отправляя чувствительные документы по неофициальным каналам.'),
      items: [
        t('Follow the current mission checklist for passport validity, forms, photographs, admission documents and any country-specific evidence.', '按照负责使领馆的当期清单准备护照有效期、申请表、照片、录取材料和当地附加证明。', 'Следуйте актуальному списку миссии по паспорту, анкетам, фото, документам о зачислении и местным подтверждениям.'),
        t('Carry secure paper and encrypted digital copies of the documents your university tells you to bring; keep originals in hand luggage.', '按学校要求准备纸质与加密电子副本，并把重要原件放在随身行李中。', 'Возьмите бумажные и защищённые цифровые копии по списку вуза, а оригиналы держите в ручной клади.'),
        t('Upload passports, health records and financial evidence only to the official system named by the university, mission or authority.', '只向大学、使领馆或主管机构明确指定的官方系统上传护照、健康或财务材料。', 'Загружайте паспорт, медицинские и финансовые документы только в официальную систему, указанную вузом или органом.'),
      ],
    },
    {
      id: 'plan-the-arrival-window',
      title: t('Plan the arrival window, not just the flight', '规划完整报到窗口，而不只是航班', 'Планируйте окно прибытия, а не только рейс'),
      introduction: t('Your arrival plan should connect border entry, transport, accommodation and university registration.', '抵达计划应把入境、交通、住宿和学校报到连接起来。', 'План прибытия должен связывать въезд, транспорт, жильё и регистрацию в вузе.'),
      items: [
        t('Confirm the permitted registration dates, airport or station guidance, campus address and whom to contact outside office hours.', '确认允许报到的日期、机场或车站指引、校区地址以及非办公时间的联系人。', 'Уточните даты регистрации, маршрут из аэропорта или вокзала, адрес кампуса и контакт вне рабочих часов.'),
        t('Keep the university address and accommodation confirmation available offline in Chinese and English.', '离线保存中英文学校地址与住宿确认信息。', 'Храните офлайн адрес вуза и подтверждение жилья на китайском и английском.'),
        t('Do not assume early arrival guarantees dormitory access. Confirm check-in dates and temporary accommodation before travel.', '不要假设提前抵达就能入住宿舍；出发前应确认入住日期和临时住宿安排。', 'Не считайте, что ранний приезд гарантирует общежитие; заранее уточните заселение и временное жильё.'),
      ],
    },
    {
      id: 'complete-post-entry-formalities',
      title: t('Complete post-entry formalities promptly', '及时完成入境后手续', 'Быстро оформите процедуры после въезда'),
      introduction: t('Accommodation registration and a student residence permit are time-sensitive legal processes, not optional campus administration.', '住宿登记和学习类居留许可属于有时限的法律手续，并非可选的校内流程。', 'Регистрация проживания и студенческий вид на жительство — срочные юридические процедуры, а не факультативная формальность.'),
      items: [
        t('Hotels normally register guests. For a non-hotel residence, official law requires the foreigner or host to register with local public security within 24 hours; use the current local process.', '酒店通常代为登记；入住非酒店住所时，法律要求外国人或留宿人在 24 小时内向当地公安机关办理登记，应使用当地当期流程。', 'Гостиницы обычно регистрируют гостей. При проживании не в гостинице закон требует регистрации иностранца или принимающей стороны в местной полиции в течение 24 часов.'),
        t('Official NIA guidance says an X1 holder whose visa requires a residence permit should apply locally within 30 days after entry; follow the university’s appointment and document instructions.', '国家移民管理局指引说明，需要办理居留许可的 X1 持有人应在入境后 30 日内向当地部门申请，并按学校预约与材料要求办理。', 'По руководству NIA владелец X1, которому нужен вид на жительство, должен обратиться по месту проживания в течение 30 дней после въезда.'),
        t('Online accommodation registration introduced in 2026 began as a pilot in selected regions. Check whether the service covers your address instead of assuming nationwide availability.', '2026 年推出的线上住宿登记最初仅在部分地区试点；应确认你的住址是否已覆盖，不要假设全国均可使用。', 'Онлайн-регистрация проживания, запущенная в 2026 году, началась как пилот в отдельных регионах; проверьте доступность по адресу.'),
      ],
    },
    {
      id: 'protect-your-status',
      title: t('Protect your status throughout the semester', '在整个学期维护合法身份', 'Сохраняйте законный статус весь семестр'),
      introduction: t('Record expiry dates and ask before changing study, address, work or internship arrangements.', '记录证件到期日，并在改变学习、住址、工作或实习安排前咨询主管部门。', 'Записывайте сроки действия и консультируйтесь до изменения учёбы, адреса, работы или стажировки.'),
      items: [
        t('Calendar passport, visa or residence-permit expiry dates and the university’s renewal preparation window.', '把护照、签证或居留许可到期日以及学校建议的续办准备时间加入日历。', 'Занесите в календарь сроки паспорта, визы или вида на жительство и период подготовки продления.'),
        t('Report address or passport changes through the process specified by the university and local authority.', '按学校和当地主管部门规定的流程申报住址或护照变更。', 'Сообщайте об изменении адреса или паспорта по процедуре вуза и местного органа.'),
        t('A student residence permit does not automatically authorize off-campus work or internships; obtain the school approval and required permit remark before starting.', '学习类居留许可并不自动允许校外工作或实习；开始前应取得学校同意并办理所需加注。', 'Студенческий вид на жительство не даёт автоматического права на работу или стажировку; сначала нужны одобрение вуза и требуемая отметка.'),
      ],
    },
  ],
  sources: [
    {
      title: t('X1 & X2 visa guidance', 'X1 与 X2 签证指引', 'Руководство по визам X1 и X2'),
      publisher: t('Embassy of the People’s Republic of China', '中华人民共和国驻外使馆', 'Посольство Китайской Народной Республики'),
      url: 'https://pg.china-embassy.gov.cn/eng/lsyw/lsfw/202411/t20241118_11528046.htm',
      checkedAt: '2026-08-08',
    },
    {
      title: t('Service guide on issuance of residence permits for foreigners', '外国人居留证件签发服务指南', 'Руководство по выдаче вида на жительство иностранцам'),
      publisher: t('National Immigration Administration', '国家移民管理局', 'Государственное управление по делам миграции'),
      url: 'https://en.nia.gov.cn/n147423/n147478/n147715/c158270/content.html',
      checkedAt: '2026-08-08',
    },
    {
      title: t('Online accommodation registration policy interpretation', '外国人住宿登记网上办理政策解读', 'Разъяснение онлайн-регистрации проживания'),
      publisher: t('National Immigration Administration', '国家移民管理局', 'Государственное управление по делам миграции'),
      url: 'https://en.nia.gov.cn/n147418/n147463/c197328/content.html',
      checkedAt: '2026-08-08',
    },
    {
      title: t('Exit and Entry Administration Law of the People’s Republic of China', '中华人民共和国出境入境管理法', 'Закон КНР об управлении въездом и выездом'),
      publisher: t('National Immigration Administration', '国家移民管理局', 'Государственное управление по делам миграции'),
      url: 'https://en.nia.gov.cn/n147418/n147458/c155978/content.html',
      checkedAt: '2026-08-08',
    },
  ],
  faq: [
    {
      question: t('Is X1 always the right visa for a degree program?', '学位项目一定申请 X1 吗？', 'Всегда ли для программы нужна X1?'),
      answer: t('X1 is generally for study longer than 180 days, but the responsible Chinese mission and your university determine the documents for your case. Follow their current instructions.', 'X1 通常适用于超过 180 天的学习，但具体材料由负责使领馆和大学根据个人情况确定，应以当期说明为准。', 'X1 обычно используется при обучении свыше 180 дней, но документы определяют ответственная миссия и вуз. Следуйте актуальным инструкциям.'),
    },
    {
      question: t('Can I complete every arrival formality online?', '所有入境后手续都能在线办理吗？', 'Можно ли оформить всё после въезда онлайн?'),
      answer: t('Do not assume so. The NIA online accommodation service began with selected pilot regions, while residence-permit procedures and university registration remain locally administered.', '不能这样假设。线上住宿登记最初只覆盖部分试点地区，居留许可和学校报到仍按当地流程办理。', 'Не рассчитывайте на это. Онлайн-регистрация жилья начиналась в пилотных регионах, а вид на жительство и регистрация в вузе оформляются локально.'),
    },
    {
      question: t('Does a hotel registration complete my university registration?', '酒店登记等于学校报到吗？', 'Регистрация в гостинице заменяет регистрацию в вузе?'),
      answer: t('No. Accommodation registration, university enrolment and residence-permit formalities are separate processes, even when the university helps coordinate them.', '不等于。住宿登记、学校报到和居留许可是不同流程，即使学校协助办理也不能混为一谈。', 'Нет. Регистрация проживания, зачисление в вузе и вид на жительство — отдельные процедуры.'),
    },
    {
      question: t('Can I work or intern on a student residence permit?', '持学习类居留许可可以工作或实习吗？', 'Можно ли работать по студенческому виду на жительство?'),
      answer: t('Not automatically. NIA guidance requires university approval and a residence-permit remark for authorized off-campus part-time work or an internship. Confirm locally before starting.', '不能自动获得资格。国家移民管理局指引要求校外勤工助学或实习先取得学校同意，并在居留许可上加注；开始前应向当地确认。', 'Не автоматически. По правилам NIA нужны одобрение вуза и отметка в виде на жительство; уточните всё до начала.'),
    },
  ],
  relatedLinks: [
    { title: t('Prepare application documents', '准备申请材料', 'Подготовить документы'), description: t('Build a privacy-conscious document checklist.', '建立注重隐私的材料清单。', 'Соберите безопасный список документов.'), path: 'guides/application-documents' },
    { title: t('Explore student cities', '探索留学城市', 'Смотреть студенческие города'), description: t('Compare university locations before planning arrival.', '规划抵达前先了解大学所在城市。', 'Изучите города до планирования прибытия.'), path: 'cities' },
    { title: t('Read the privacy policy', '阅读隐私政策', 'Прочитать политику конфиденциальности'), description: t('See what this platform never asks applicants to upload.', '了解本站不会要求申请人上传哪些材料。', 'Узнайте, какие данные платформа никогда не запрашивает.'), path: 'privacy' },
  ],
}

const enhancements: Record<string, GuideEnhancement> = {
  'choose-a-program': chooseAProgram,
  'visa-and-arrival': visaAndArrival,
}

export function getGuideEnhancement(slug: string): GuideEnhancement | null {
  return enhancements[slug] ?? null
}
