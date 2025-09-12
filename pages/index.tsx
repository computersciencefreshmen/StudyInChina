import { useState } from 'react'
import type { Lang } from '../lib/i18n'
import Nav from '../components/Nav'
import Link from 'next/link'
import { UserCircleIcon, BookOpenIcon, AcademicCapIcon, MapPinIcon, BanknotesIcon, CloudIcon, SparklesIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import Footer from '../components/Footer'

export default function Home() {
  const [lang, setLang] = useState<Lang>('en')
  const t = (en:string, zh:string, ru:string) => lang==='en'? en: (lang==='zh'? zh: ru)
  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main>
        <header className="bg-gradient-to-r from-sky-50 to-white border-b border-slate-200">
          <div className="container py-12">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-3">{t('Study in China · Humanities Focus','中国留学 · 人文学科定向','Учёба в Китае · Гуманитарные')}</h1>
            <p className="text-slate-600 max-w-3xl">
              {t(
                'A focused guide for humanities majors (Translation / International Relations) with HSK3–4 pathways (foundation/Chinese language first) and direct HSK4+ options.',
                '面向人文学科（翻译/国际关系）的留学选校指南，强调HSK3–4可行路径（先预科/语言再升本）与HSK4+直接入读方案。',
                'Путеводитель по гуманитарным направлениям (перевод/международные отношения) с вариантами HSK3–4 (подготовительное/язык) и прямым поступлением с HSK4+.'
              )}
            </p>
            <div className="flex items-center gap-3 mt-6">
              <Link className="btn primary" href="/universities">{t('Explore Universities','浏览大学','Смотреть университеты')}</Link>
              <Link className="btn" href="/scholarships">{t('CSC Scholarship','中国政府奖学金','Гос. стипендия КНР (CSC)')}</Link>
            </div>
          </div>
        </header>

        {/* Profile blue panel */}
        <section className="container py-8">
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-5 sm:p-6">
            <h2 className="text-center text-xl font-semibold mb-4">{t("Elizabeth's Profile","Elizabeth 的画像","Профиль Elizabeth")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <UserCircleIcon className="w-5 h-5 text-sky-700"/>
                <div className="font-medium">{t('From Russia','来自俄罗斯','Из России')}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <BookOpenIcon className="w-5 h-5 text-indigo-700"/>
                <div className="font-medium">HSK 3 → HSK 4</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <AcademicCapIcon className="w-5 h-5 text-blue-700"/>
                <div className="font-medium">{t('Translation & International Relations','翻译与国际关系','Перевод и МО')}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <MapPinIcon className="w-5 h-5 text-rose-700"/>
                <div className="font-medium">{t('Prefers Northern China','偏好中国北方','Предпочитает Север Китая')}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <BanknotesIcon className="w-5 h-5 text-emerald-700"/>
                <div className="font-medium">{t('Needs Full Scholarship','期望全额奖学金','Нужна полная стипендия')}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <CloudIcon className="w-5 h-5 text-cyan-700"/>
                <div className="font-medium">{t('Cool Climate Preferred','偏好凉爽气候','Предпочитает прохладный климат')}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Why this guide */}
        <section className="container py-4">
          <h2 className="text-2xl font-bold text-center mb-6">{t('Why This Guide is Perfect for You','为什么这份指南适合你','Почему это руководство — для вас')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-slate-900 font-semibold"><SparklesIcon className="w-5 h-5 text-indigo-700"/>{t('Personalized Recommendations','个性化推荐','Персональные рекомендации')}</div>
              <p className="text-slate-600">{t('Universities and programs carefully selected based on your specific requirements and preferences.','根据你的要求与偏好精挑细选院校与项目。','Вузы и программы отобраны под ваши цели и предпочтения.')}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-slate-900 font-semibold"><ShieldCheckIcon className="w-5 h-5 text-emerald-700"/>{t('Full Scholarship Focus','专注全额奖学金','Фокус на полных грантах')}</div>
              <p className="text-slate-600">{t('Only universities offering full scholarships that cover tuition, accommodation, and living expenses.','优先提供覆盖学费、住宿与生活费的全额奖学金院校。','Только вузы с грантами, покрывающими учёбу, жильё и проживание.')}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-slate-900 font-semibold"><MapPinIcon className="w-5 h-5 text-rose-700"/>{t('Climate Consideration','气候考量','Учёт климата')}</div>
              <p className="text-slate-600">{t('All recommended universities are located in northern China with cooler, drier climates.','推荐院校位于中国北方，气候更凉爽干燥。','Все рекомендованные вузы — на севере Китая с прохладным, сухим климатом.')}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-slate-900 font-semibold"><BookOpenIcon className="w-5 h-5 text-blue-700"/>{t('Flexible Language Path','灵活语言路径','Гибкий языковой путь')}</div>
              <p className="text-slate-600">{t('Options for both direct entry with HSK 4 and preparatory programs starting from HSK 3.','既可HSK4直接入学，也可从HSK3走预科/语言。','Возможен прямой вход с HSK4 и подготовительные программы от HSK3.')}</p>
            </div>
          </div>
        </section>

        <section className="container py-8">
          <div className="section">
            <h2>{t('Quick Notes','要点速览','Коротко')}</h2>
            <ul className="list-disc pl-6 space-y-1 text-slate-700">
              <li>{t('Most Chinese-taught IR/Translation need HSK4–5; foundation year allows transition.', '中文授课国际关系/翻译通常需HSK4–5；不足可通过预科/语言过渡。','IR/перевод по-китайски обычно требуют HSK4–5; подготовительное/язык помогает перейти.')}</li>
              <li>{t('Prefer universities with strong language schools for smoother transition.', '优先选择语言学院成熟的高校，过渡更顺畅。','Выбирайте вузы с сильными языковыми школами — переход проще.')}</li>
              <li>{t('You can add more schools later; data is expandable.', '后续可持续补充更多院校，数据可扩展。','Список легко расширять новыми вузами.')}</li>
            </ul>
          </div>
        </section>

        <Footer lang={lang} />
      </main>
    </>
  )
}
