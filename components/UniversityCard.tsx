import { University } from '../data/universities'
import { Lang, programLabel, degreeLabel, regionLabel } from '../lib/i18n'
import { MapPinIcon, AcademicCapIcon, GlobeAsiaAustraliaIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarSolid } from '@heroicons/react/24/solid'
import { StarIcon as StarOutline } from '@heroicons/react/24/outline'

export default function UniversityCard({ u, lang, toggleFav, isFav }: { u: University, lang: Lang, toggleFav?: (name:string)=>void, isFav?: boolean }) {
  const pick = (lt: { en: string; zh: string; ru: string }) => lt[lang]
  const hskColor = (text: string) => {
    const s = text.toLowerCase()
    const has4 = s.includes('hsk4') || s.includes('hsk 4') || s.includes('4')
    const has5 = s.includes('hsk5') || s.includes('hsk 5') || s.includes('5')
    if (has5 && !has4) return 'badge-red'
    if (has4 && has5) return 'badge-yellow'
    if (has4) return 'badge-green'
    return 'badge-yellow'
  }

  return (
    <div className="card hover:-translate-y-0.5 hover:shadow-lg">
      <div className="row-spread">
        <div>
          <h3 className="text-lg font-semibold">{pick(u.name)}</h3>
          {u.englishName && lang==='en' && <div className="muted">{u.englishName}</div>}
        </div>
        <div className="row">
          <span className="chip">{regionLabel(lang, u.region)}</span>
          {toggleFav && (
            <button aria-label="favorite" className="btn" onClick={()=>toggleFav(pick(u.name))}>
              {isFav ? <StarSolid className="w-4 h-4 text-amber-500"/> : <StarOutline className="w-4 h-4 text-slate-600"/>}
            </button>
          )}
        </div>
      </div>

      <div className="row text-slate-700">
        {u.city && (
          <div className="row">
            <MapPinIcon className="w-4 h-4 text-sky-700"/>
            <span className="text-sm">{pick(u.city)}</span>
          </div>
        )}
        <div className="row">
          {u.programs.map(p => (
            <span key={p} className="chip">
              {p === 'Translation' ? <AcademicCapIcon className="w-4 h-4"/> : <GlobeAsiaAustraliaIcon className="w-4 h-4"/>}
              {programLabel(lang, p)}
            </span>
          ))}
        </div>
      </div>

      <div className="row">
        <span className={`chip ${hskColor(pick(u.hskNote))}`}>HSK: {pick(u.hskNote)}</span>
      </div>
      {u.bridgeNote && <div className="muted">{(lang==='en'? 'Bridge':'zh'===lang? '过渡':'Переход')}: {pick(u.bridgeNote)}</div>}

      {u.programsDetailed && u.programsDetailed.length>0 && (
        <div className="section p-3">
          <div className="font-semibold mb-2">{(lang==='en'? 'Program pages': lang==='zh'? '专业链接':'Страницы программ')}</div>
          {u.programsDetailed.map((pd, idx)=> (
            <div key={idx} className="row-spread mb-2">
              <div className="muted">
                {programLabel(lang, pd.program)} · {degreeLabel(lang, pd.degree)} · HSK: {pick(pd.hsk)} · {(pd.acceptsFoundation ? (lang==='en'?'Foundation accepted':lang==='zh'?'可预科/语言过渡':'Есть подготовительный/язык') : (lang==='en'?'No foundation':lang==='zh'?'不支持预科':'Без подготовительного'))}
              </div>
              <a className="btn link" href={pd.url} target="_blank" rel="noopener noreferrer">{(lang==='en'?'Open':lang==='zh'?'打开':'Открыть')}<ArrowTopRightOnSquareIcon className="w-4 h-4"/></a>
            </div>
          ))}
        </div>
      )}
      <div className="row mt-2">
        <a className="btn" href={u.viewUrl} target="_blank" rel="noopener noreferrer">{(lang==='en'?'View Details':lang==='zh'?'查看详情':'Подробнее')}<ArrowTopRightOnSquareIcon className="w-4 h-4"/></a>
        <a className="btn primary" href={u.applyUrl} target="_blank" rel="noopener noreferrer">{(lang==='en'?'Apply Now':lang==='zh'?'立即申请':'Подать сейчас')}<ArrowTopRightOnSquareIcon className="w-4 h-4"/></a>
      </div>
    </div>
  )
}
