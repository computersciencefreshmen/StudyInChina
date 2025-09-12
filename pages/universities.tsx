import { useMemo, useState } from 'react'
import Nav from '../components/Nav'
import UniversityCard from '../components/UniversityCard'
import { UNIVERSITIES } from '../data/universities'
import { Lang, RegionId, ProgramId, regionLabel, programLabel } from '../lib/i18n'

export default function Universities() {
  const [lang, setLang] = useState<Lang>('zh')
  const [region, setRegion] = useState<RegionId | 'ALL'>('ALL')
  const [program, setProgram] = useState<ProgramId | 'ALL'>('ALL')
  const [q, setQ] = useState('')
  const [favs, setFavs] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('favs')||'[]') } catch { return [] }
  })

  const pick = (lt?: { en: string; zh: string; ru: string }) => lt ? (lang==='en'? lt.en : (lang==='zh'? lt.zh : lt.ru)) : ''

  const list = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    return UNIVERSITIES.filter(u => (region==='ALL' || u.region===region) && (program==='ALL' || u.programs.includes(program))
      && (!keyword || [pick(u.name), u.englishName, pick(u.city), regionLabel(lang, u.region)].filter(Boolean).some(x => String(x).toLowerCase().includes(keyword))))
  }, [region, program, q, lang])

  const t = (en:string, zh:string, ru:string) => (lang==='en'? en: (lang==='zh'? zh: ru))

  const toggleFav = (name:string) => {
    setFavs(prev => {
      const next = prev.includes(name) ? prev.filter(n=>n!==name) : [...prev, name]
      if (typeof window !== 'undefined') localStorage.setItem('favs', JSON.stringify(next))
      return next
    })
  }

  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF()
    const chosen = UNIVERSITIES.filter(u => favs.includes(pick(u.name)))
    const items = (chosen.length? chosen : list).slice(0, 40)
    let y = 10
    doc.setFontSize(14)
    doc.text(t('Study in China - Picks','中国留学清单','Список вузов Китая'), 10, y); y+=8
    doc.setFontSize(10)
    for (const u of items) {
      const line = `${pick(u.name)} ${u.englishName && lang==='en' ? `(${u.englishName})` : ''} - ${pick(u.city)} | HSK: ${pick(u.hskNote)}`
      doc.text(line, 10, y); y+=6
      if (u.programsDetailed && u.programsDetailed.length) {
        for (const pd of u.programsDetailed) {
          const l2 = `  • ${pd.program} ${pd.degree} HSK:${pick(pd.hsk)} ${pd.acceptsFoundation? '[foundation]':''}`
          doc.text(l2, 12, y); y+=6
        }
      }
      if (y>280) { doc.addPage(); y=10 }
    }
    doc.save('study-cn.pdf')
  }

  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container py-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl font-semibold">{t('Universities','大学','Университеты')}</h2>
          <div className="muted">{t('Filter by region/program to narrow down.','可按地区/方向筛选。','Фильтр по региону/направлению')}</div>
        </div>

        <div className="filter">
          {(['ALL','NORTH_CHINA','NORTHEAST','EAST_CHINA','CENTRAL_CHINA'] as const).map(r => (
            <button key={r} className={"pill" + (region===r? ' active':'')} onClick={()=>setRegion(r as any)}>
              {r==='ALL' ? (lang==='en'?'All':lang==='zh'?'全部':'Все') : regionLabel(lang, r)}
            </button>
          ))}
        </div>
        <div className="filter mt-1">
          {(['ALL','Translation','International Relations'] as const).map(p => (
            <button key={p} className={"pill" + (program===p? ' active':'')} onClick={()=>setProgram(p as any)}>
              {p==='ALL' ? (lang==='en'?'All':lang==='zh'?'全部':'Все') : programLabel(lang, p as ProgramId)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input className="flex-1 px-3 py-2 border border-slate-200 rounded-lg" placeholder={t('Search by name/city','按名称/城市搜索','Поиск по названию/городу')} value={q} onChange={e=>setQ((e.target as HTMLInputElement).value)} />
          <button className="btn" onClick={exportPDF}>{t('Export PDF','导出PDF','Экспорт PDF')}</button>
        </div>

        <div className="grid-auto mt-3">
          {list.map(u => (
            <UniversityCard key={u.viewUrl} u={u} lang={lang} toggleFav={toggleFav} isFav={favs.includes(pick(u.name))} />
          ))}
        </div>
      </main>
    </>
  )
}

