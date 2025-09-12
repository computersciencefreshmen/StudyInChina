import { useState } from 'react'
import type { Lang } from '../lib/i18n'
import { AcademicCapIcon, ClipboardDocumentListIcon, CalendarDaysIcon, LightBulbIcon, CheckCircleIcon, GlobeAltIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import Footer from '../components/Footer'
import Nav from '../components/Nav'

export default function Scholarships(){
  const [lang, setLang] = useState<Lang>('en')
  const t = (en:string, zh:string, ru:string) => lang==='en'? en: (lang==='zh'? zh: ru)
  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container py-6">
        <div className="grid gap-6">
          <section className="section">
            <div className="flex items-center gap-2 mb-2">
              <AcademicCapIcon className="w-5 h-5 text-sky-700"/>
              <h2>{t('China Government Scholarship (CSC)','中国政府奖学金（CSC）','Гос. стипендия Китая (CSC)')}</h2>
            </div>
            <p className="muted">
              {t(
                'Covers tuition, accommodation, stipend, and insurance. Annual calls usually Dec–Apr. Apply via CampusChina portal and the target university.',
                '覆盖学费、住宿、生活费、保险。每年12–4月为主申请季。通过“留学中国网”及目标高校渠道申请。',
                'Покрывает обучение, проживание, стипендию и медстраховку. Сезон набора обычно декабрь—апрель. Подача через портал CampusChina и университет.'
              )}
            </p>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="section">
              <div className="flex items-center gap-2 mb-2"><GlobeAltIcon className="w-5 h-5 text-green-600"/><h3 className="font-semibold">{t('Coverage','资助范围','Покрытие')}</h3></div>
              <ul className="text-slate-700 list-disc pl-5 space-y-1">
                <li>{t('Tuition','学费','Обучение')}</li>
                <li>{t('Accommodation','住宿','Проживание')}</li>
                <li>{t('Monthly stipend','生活费','Ежемесячная стипендия')}</li>
                <li>{t('Medical insurance','医保','Медстраховка')}</li>
              </ul>
            </div>
            <div className="section">
              <div className="flex items-center gap-2 mb-2"><ClipboardDocumentListIcon className="w-5 h-5 text-blue-600"/><h3 className="font-semibold">{t('Eligibility','申请条件','Требования')}</h3></div>
              <ul className="text-slate-700 list-disc pl-5 space-y-1">
                <li>{t('Non-Chinese citizen, in good health','非中国籍，身心健康','Иностранец, здоровье')}</li>
                <li>{t('Degree-specific criteria apply','不同学位阶段另有要求','Критерии зависят от степени')}</li>
              </ul>
            </div>
          </section>

          <section className="section border-red-200 bg-red-50">
            <div className="flex items-center gap-2 mb-2 text-red-800"><CalendarDaysIcon className="w-5 h-5"/><h3 className="font-semibold">{t('Deadline','截止时间','Сроки')}</h3></div>
            <p className="text-red-800">{t('Main round: December – April (varies by university).','主申请季：每年12月至翌年4月（以学校公布为准）。','Основной период: декабрь – апрель (по вузам).')}</p>
          </section>

          <section className="section">
            <div className="flex items-center gap-2 mb-2"><ClipboardDocumentListIcon className="w-5 h-5 text-sky-700"/><h3 className="font-semibold">{t('Application Process','申请流程','Процесс подачи')}</h3></div>
            <ol className="space-y-2">
              {[t('Choose university','选校','Выбор вуза'), t('Get agency code','获取受理机构代码','Код агентства'), t('Submit online on CampusChina','在留学中国网填报','Онлайн-заявка на CampusChina'), t('Mail paper docs if required','如需邮寄纸质材料','Отправка бумаг (если требуется)'), t('Track result','等待结果','Ожидание результата')].map((step, i)=> (
                <li key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-800 flex items-center justify-center font-bold text-sm">{i+1}</div>
                  <span className="text-slate-700">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="section">
            <div className="flex items-center gap-2 mb-2"><CheckCircleIcon className="w-5 h-5 text-green-600"/><h3 className="font-semibold">{t('Documents','材料清单','Пакет документов')}</h3></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700">
              {[t('Passport copy','护照复印件','Копия паспорта'), t('Transcripts/diplomas','成绩单/学历','Выписки/дипломы'), t('HSK certificate','HSK 成绩','Сертификат HSK'), t('Personal statement','个人陈述','Мотивационное письмо'), t('2 recommendation letters','2封推荐信','2 рекомендации'), t('Medical check (if required)','体检表（如需）','Медсправка (если требуется)')].map((d,i)=> (
                <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200">{d}</div>
              ))}
            </div>
          </section>

          <section className="section border-blue-200 bg-blue-50">
            <div className="flex items-center gap-2 mb-2 text-blue-900"><LightBulbIcon className="w-5 h-5"/><h3 className="font-semibold">{t('Tips','申请提示','Подсказки')}</h3></div>
            <ul className="list-disc pl-5 space-y-1 text-blue-900">
              <li>{t('Prepare translations and certifications early','提前准备翻译/公证','Заранее готовьте переводы/заверения')}</li>
              <li>{t('Ask referees in advance','提前联系推荐人','Заранее договоритесь с рекомендателями')}</li>
              <li>{t('Have a clear study plan','清晰的学习计划','План обучения')}</li>
            </ul>
          </section>

          <section className="section">
            <h3 className="font-semibold mb-3">{t('Other Scholarships','其他奖学金','Другие стипендии')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-slate-700">
              <div className="p-4 border border-slate-200 rounded-xl">
                <div className="font-semibold mb-1">{t('University Scholarships','高校奖学金','Университетские гранты')}</div>
                <p>{t('Provided by universities; amounts and criteria vary.','由学校提供，金额与条件各异。','Предоставляются вузами; суммы и условия отличаются.')}</p>
              </div>
              <div className="p-4 border border-slate-200 rounded-xl">
                <div className="font-semibold mb-1">{t('Provincial Scholarships','省级奖学金','Провинциальные гранты')}</div>
                <p>{t('Offered by provinces for outstanding students.','由省级部门提供给优秀学生。','От провинций для отличившихся студентов.')}</p>
              </div>
              <div className="p-4 border border-slate-200 rounded-xl">
                <div className="font-semibold mb-1">{t('Bilateral Programs','双边项目','Двусторонние программы')}</div>
                <p>{t('Based on agreements between China and your country.','基于中国与贵国的协议。','По соглашениям между Китаем и вашей страной.')}</p>
              </div>
            </div>
            <div className="row mt-4">
              <a className="btn" href="https://www.campuschina.org/" target="_blank" rel="noopener noreferrer">{t('CSC Official Info','CSC官方信息','Официально о CSC')}</a>
              <a className="btn primary" href="https://studyinchina.csc.edu.cn/" target="_blank" rel="noopener noreferrer">{t('Apply on CampusChina','前往留学中国网申请','Подать на CampusChina')}</a>
            </div>
          </section>

          {/* For Russian students */}
          <section className="section">
            <h3 className="font-semibold mb-3">{t('For Russian Students','面向俄罗斯学生','Для граждан РФ')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border border-slate-200 rounded-xl bg-white">
                <div className="font-semibold mb-1">{t('CSC Bilateral Program (China–Russia)','CSC双边项目（中俄政府奖学金）','Гос. стипендия КНР: двусторонняя (Китай–Россия)')}</div>
                <p className="text-slate-700 text-sm mb-2">
                  {t('Intergovernmental program. Apply on CampusChina as “Bilateral Program (Type A)”. Russian side may publish additional notices each year.','两国政府间项目。通过留学中国网选择“双边项目（Type A）”申报。俄罗斯方每年也会发布相应通知。','Межправительственная программа. Подача на CampusChina: «Bilateral Program (Type A)». Российская сторона публикует ежегодные объявления.')}
                </p>
                <div className="row">
                  <a className="btn" href="https://www.campuschina.org/" target="_blank" rel="noopener noreferrer">{t('Learn More','了解详情','Подробнее')}</a>
                  <a className="btn primary" href="https://studyinchina.csc.edu.cn/" target="_blank" rel="noopener noreferrer">{t('Apply','申请','Подать')}</a>
                </div>
              </div>
              <div className="p-4 border border-slate-200 rounded-xl bg-white">
                <div className="font-semibold mb-1">{t('Shanghai Government Scholarship (SGS)','上海市政府奖学金（SGS）','Стипендия правительства Шанхая (SGS)')}</div>
                <p className="text-slate-700 text-sm mb-2">
                  {t('Open to outstanding international students including Russian citizens. Covers tuition, accommodation subsidy, and stipend (by category).','面向优秀国际生（含俄罗斯籍）。按类别覆盖学费、住宿补贴、生活费等。','Для иностранных студентов, в т.ч. граждан РФ. По категориям покрывает обучение, проживание и стипендию.')}
                </p>
                <div className="row">
                  <a className="btn" href="https://study.edu.sh.gov.cn/" target="_blank" rel="noopener noreferrer">{t('Official Site','官方网站','Официальный сайт')}</a>
                </div>
              </div>
              <div className="p-4 border border-slate-200 rounded-xl bg-white">
                <div className="font-semibold mb-1">{t('Jiangsu Jasmine Scholarship','江苏省“茉莉花”政府奖学金','Провинц. стипендия Цзянсу Jasmine')}</div>
                <p className="text-slate-700 text-sm mb-2">
                  {t('Provincial scholarship supporting degree and language programs in Jiangsu.','支持在江苏就读学位/语言项目的优秀学生。','Провинциальный грант для обучения в пров. Цзянсу (языковые/степенные программы).')}
                </p>
                <div className="row">
                  <a className="btn" href="https://www.studyinjiangsu.org/" target="_blank" rel="noopener noreferrer">{t('Official Site','官方网站','Официальный сайт')}</a>
                </div>
              </div>
              <div className="p-4 border border-slate-200 rounded-xl bg-white">
                <div className="font-semibold mb-1">{t('University/City Scholarships','高校/城市奖学金','Университетские/городские гранты')}</div>
                <p className="text-slate-700 text-sm mb-2">
                  {t('Many target universities offer their own or city-level scholarships (e.g., Beijing, Harbin). Check each OIA for details.','多数目标高校提供校级或城市奖学金（如北京、哈尔滨等），以各校国际处公告为准。','Многие вузы/города дают собственные гранты (Пекин, Харбин и др.); проверяйте сайты OIA вузов.')}
                </p>
              </div>
            </div>
          </section>
        </div>
        <Footer lang={lang} />
      </main>
    </>
  )
}
