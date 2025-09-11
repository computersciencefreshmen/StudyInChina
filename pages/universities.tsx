import { useMemo, useState } from 'react'
import Nav from '../components/Nav'
import UniversityCard from '../components/UniversityCard'
import { UNIVERSITIES, Region, Program } from '../data/universities'

export default function Universities() {
  const [lang, setLang] = useState<'en'|'zh'|'ru'>('zh')
  const [region, setRegion] = useState<Region | '全部'>('全部')
  const [program, setProgram] = useState<Program | '全部'>('全部')
  const [q, setQ] = useState('')
  const [favs, setFavs] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('favs')||'[]') } catch { return [] }
  })

  const list = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    return UNIVERSITIES.filter(u => (region==='全部' || u.region===region) && (program==='全部' || u.programs.includes(program))
      && (!keyword || [u.name, u.englishName, u.city, u.region].filter(Boolean).some(x => String(x).toLowerCase().includes(keyword))))
  }, [region, program, q])

  const t = (en:string, zh:string, ru?:string) => lang==='en'? en: (lang==='zh'? zh: (ru??en))

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
    const chosen = UNIVERSITIES.filter(u => favs.includes(u.name))
    const items = (chosen.length? chosen : list).slice(0, 40)
    let y = 10
    doc.setFontSize(14)
    doc.text(t('Study in China - Picks','中国留学清单','Список вузов Китая'), 10, y); y+=8
    doc.setFontSize(10)
    for (const u of items) {
      const line = `${u.name} (${u.englishName||''}) - ${u.city||''} | HSK: ${u.hskNote}`
      doc.text(line, 10, y); y+=6
      if (u.programsDetailed && u.programsDetailed.length) {
        for (const pd of u.programsDetailed) {
          const l2 = `  • ${pd.program} ${pd.degree} HSK:${pd.hsk} ${pd.acceptsFoundation? '[foundation]':''}`
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
      <main className="container">
        <div className="row-spread" style={{marginBottom:12}}>
          <h2>{t('Universities','大学')}</h2>
          <div className="muted">{t('Filter by region/program to narrow down.','可按地区/方向筛选。')}</div>
        </div>

        <div className="filter">
          {(['全部','华北','东北','华东','华中'] as const).map(r => (
            <button key={r} className={"pill" + (region===r? ' active':'')} onClick={()=>setRegion(r as any)}>{r}</button>
          ))}
        </div>
        <div className="filter" style={{marginTop:6}}>
          {(['全部','Translation','International Relations'] as const).map(p => (
            <button key={p} className={"pill" + (program===p? ' active':'')} onClick={()=>setProgram(p as any)}>
              {p==='Translation'? t('Translation','翻译/口译','Перевод/устный') : p==='International Relations' ? t('International Relations','国际关系','Международные отношения') : '全部'}
            </button>
          ))}
        </div>
        <div className="row" style={{marginTop:8, gap:8}}>
          <input placeholder={t('Search by name/city','按名称/城市搜索','Поиск по названию/городу')} value={q} onChange={e=>setQ((e.target as HTMLInputElement).value)} style={{flex:1, padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:8}} />
          <button className="btn" onClick={exportPDF}>{t('Export PDF','导出PDF','Экспорт PDF')}</button>
        </div>

        <div className="grid" style={{marginTop:12}}>
          {list.map(u => (
            <UniversityCard key={u.name} u={u} lang={lang} toggleFav={toggleFav} isFav={favs.includes(u.name)} />
          ))}
        </div>
      </main>
    </>
  )
}
