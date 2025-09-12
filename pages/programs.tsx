import { useState } from 'react'
import type { Lang } from '../lib/i18n'
import Nav from '../components/Nav'
import { UNIVERSITIES } from '../data/universities'
import { programLabel } from '../lib/i18n'
import Footer from '../components/Footer'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { useLanguage } from '../lib/lang'

export default function Programs(){
  const { lang, setLang } = useLanguage()
  const t = (en:string, zh:string, ru:string) => lang==='en'? en: (lang==='zh'? zh: ru)
  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container py-6">
        <section className="section">
          <h2 className="mb-3">{t('Programs','专业方向','Программы')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(['Translation','International Relations'] as const).map(pg => {
              const cards = [] as Array<{title:string; hsk:string; url:string; uni:string}>
              UNIVERSITIES.forEach(u => u.programsDetailed?.forEach(pd => {
                if (pd.program === pg && pd.degree==='BA') {
                  // Use university viewUrl as safer landing to avoid 404s on deep pages
                  cards.push({ title: `${u.name[lang]}`, hsk: pd.hsk[lang], url: u.viewUrl, uni: u.englishName || '' })
                }
              }))
              const view = cards.slice(0, 8)
              return (
                <div key={pg}>
                  <div className="text-lg font-semibold mb-2">{programLabel(lang, pg)}</div>
                  <div className="grid grid-cols-1 gap-3">
                    {view.map((c, i) => (
                      <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" className="p-4 border border-slate-200 rounded-xl bg-white hover:-translate-y-0.5 hover:shadow-lg transition flex items-center justify-between">
                        <div>
                          <div className="font-medium">{c.title}</div>
                          <div className="muted">HSK: {c.hsk}</div>
                        </div>
                        <ArrowTopRightOnSquareIcon className="w-5 h-5 text-slate-500"/>
                      </a>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
        <Footer lang={lang} />
      </main>
    </>
  )
}
