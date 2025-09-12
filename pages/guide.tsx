import { useState } from 'react'
import Nav from '../components/Nav'
import type { Lang } from '../lib/i18n'
import { ClipboardDocumentListIcon, CheckCircleIcon, CurrencyDollarIcon, GlobeAltIcon, AcademicCapIcon } from '@heroicons/react/24/outline'

export default function Guide(){
  const [lang, setLang] = useState<Lang>('zh')
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
      </main>
    </>
  )
}
