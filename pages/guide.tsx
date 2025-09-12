import { useState } from 'react'
import Nav from '../components/Nav'
import type { Lang } from '../lib/i18n'
import Footer from '../components/Footer'
import { ClipboardDocumentListIcon, CheckCircleIcon, CurrencyDollarIcon, GlobeAltIcon, AcademicCapIcon } from '@heroicons/react/24/outline'

export default function Guide(){
  const [lang, setLang] = useState<Lang>('en')
  const t = (en:string, zh:string, ru:string) => lang==='en'? en: (lang==='zh'? zh: ru)
  const steps = [
    { icon: GlobeAltIcon, en: 'Assess HSK (target 4–5)', zh: '评估HSK（目标4–5）', ru: 'Оцените HSK (цель 4–5)' },
    { icon: AcademicCapIcon, en: 'Pick schools that accept foundation', zh: '选择可“先预科/语言”的学校', ru: 'Выберите вузы с подготовительным/языком' },
    { icon: ClipboardDocumentListIcon, en: 'Prepare docs (PS + 2 refs)', zh: '准备材料（陈述+2推荐）', ru: 'Подготовьте документы (мотивац. + 2 рек.)' },
    { icon: CurrencyDollarIcon, en: 'Apply for CSC / uni scholarship', zh: '申请CSC/校级奖学金', ru: 'Подайтесь на CSC/вузовскую' },
    { icon: CheckCircleIcon, en: 'Track result and confirm enrollment', zh: '跟踪结果并确认入学', ru: 'Отслеживайте результат и подтверждайте' },
  ] as const

  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container py-6">
        <div className="section">
          <h2 className="mb-3">{t('Application Guide','申请指南','Гид по поступлению')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {steps.map((s, i)=> {
              const Icon = s.icon
              return (
                <div key={i} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm flex items-start gap-3">
                  <Icon className="w-6 h-6 text-sky-700"/>
                  <div>
                    <div className="font-semibold">{t(s.en, s.zh, s.ru)}</div>
                    <div className="muted">{t('Step','步骤','Шаг')} {i+1}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <section className="section mt-4">
          <h3 className="font-semibold mb-2">{t('Timeline (Typical)','时间线（常见）','Сроки (обычно)')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[ 
              t('Aug–Oct: shortlist, HSK prep, draft docs','8–10月：选校、HSK备考、撰写材料','Авг–Окт: выбор вузов, HSK, черновики документов'),
              t('Nov–Jan: university applications, referees','11–1月：校内网申、联系推荐人','Ноя–Янв: подача в вузы, рекомендации'),
              t('Dec–Apr: scholarships (CSC/SGS/Jasmine, etc.)','12–4月：奖学金集中申请（CSC/SGS/茉莉花等）','Дек–Апр: гранты (CSC/SGS/Jasmine и др.)'),
              t('Mar–Jun: admission results/interviews','3–6月：录取结果/面试','Мар–Июн: результаты/собеседования'),
              t('Jun–Aug: JW, visa (X1/X2), booking','6–8月：JW表、签证（X1/X2）、订票','Июн–Авг: формы JW, виза (X1/X2), билеты'),
              t('Aug–Sep: arrival & registration','8–9月：报道注册','Авг–Сен: прибытие и регистрация')
            ].map((item, idx)=> (
              <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200">{item}</div>
            ))}
          </div>
        </section>

        <section className="section mt-4">
          <h3 className="font-semibold mb-2">{t('Document Checklist (Details)','材料清单（细化）','Список документов (подробно)')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-slate-700">
            <div className="p-4 border border-slate-200 rounded-xl bg-white">
              <div className="font-semibold mb-1">{t('Academic','学术材料','Академические')}</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t('Transcripts + diplomas (notarized if required)','成绩单/学历（如需公证）','Выписки/дипломы (заверение при необходимости)')}</li>
                <li>{t('HSK certificate (target 4–5 for humanities)','HSK 成绩（人文方向目标4–5）','Сертификат HSK (для гуманитариев 4–5)')}</li>
                <li>{t('Two recommendation letters','两封推荐信','Две рекомендации')}</li>
              </ul>
            </div>
            <div className="p-4 border border-slate-200 rounded-xl bg-white">
              <div className="font-semibold mb-1">{t('Personal & Plan','个人与计划','Личные и план')}</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t('Passport & photo','护照与证件照','Паспорт и фото')}</li>
                <li>{t('Personal statement / study plan (IR: motivation + goals)','个人陈述/学习计划（IR需动机与目标）','Мотивационное письмо/план (для МО — мотивация и цели)')}</li>
                <li>{t('CV (if applicable)','简历（如需）','Резюме (если требуется)')}</li>
              </ul>
            </div>
            <div className="p-4 border border-slate-200 rounded-xl bg-white">
              <div className="font-semibold mb-1">{t('Health & Financial','健康与经费','Здоровье и финансы')}</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t('Medical check form (as required)','体检表（按要求）','Медсправка (по требованиям)')}</li>
                <li>{t('Funding proofs or scholarship form','经费证明或奖学金申请表','Финансовые гарантии или формы гранта')}</li>
              </ul>
            </div>
            <div className="p-4 border border-slate-200 rounded-xl bg-white">
              <div className="font-semibold mb-1">{t('Portfolio (if any)','作品/证明（如有）','Портфолио (если есть)')}</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t('For Translation: language certificates, practice proof','翻译方向：语言证书、实践证明','Для перевода: языковые сертификаты, подтверждение практики')}</li>
                <li>{t('For IR: research interests/reading list','国际关系：研究兴趣/阅读清单','Для МО: интересы/список чтения')}</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section mt-4">
          <h3 className="font-semibold mb-2">{t('Writing & Interview Tips','文书与面试技巧','Советы по эссе и собеседованию')}</h3>
          <ul className="list-disc pl-5 space-y-1 text-slate-700">
            <li>{t('Explain why China/this university/this program','明确“为什么中国/为什么该校/为什么该专业”','Объясните почему Китай/этот вуз/программа')}</li>
            <li>{t('Connect past experience with future goals','把过去经历与未来目标连接','Свяжите опыт с целями')}</li>
            <li>{t('Keep IR essays structured with evidence','IR 文章结构清晰、论据充分','МО: структура и доказательства')}</li>
          </ul>
        </section>

        <section className="section mt-4">
          <h3 className="font-semibold mb-2">{t('Visa & Arrival','签证与到校','Виза и прибытие')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-slate-700">
            {[t('JW201/202 issued by university','学校下发 JW201/202','Университет выдаёт JW201/202'), t('Apply X1/X2 visa (embassy/visa center)','申请 X1/X2 签证（使领馆/签证中心）','Виза X1/X2 (посольство/визовый центр)'), t('Registration + residence permit on arrival','到校报到并办理居留许可','Регистрация и ВНЖ по прибытии')].map((v,i)=>(
              <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200">{v}</div>
            ))}
          </div>
        </section>

        <Footer lang={lang} />
      </main>
    </>
  )
}
