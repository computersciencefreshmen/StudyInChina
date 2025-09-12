import { University } from '../data/universities'
import { Lang, programLabel, degreeLabel, regionLabel } from '../lib/i18n'

export default function UniversityCard({ u, lang, toggleFav, isFav }: { u: University, lang: Lang, toggleFav?: (name:string)=>void, isFav?: boolean }) {
  const pick = (lt: { en: string; zh: string; ru: string }) => lt[lang]
  return (
    <div className="card">
      <div className="row-spread">
        <h3>{pick(u.name)}</h3>
        <div className="row">
          <span className="chip">{regionLabel(lang, u.region)}</span>
          {toggleFav && (
            <button className="btn" onClick={()=>toggleFav(u.name)}>{isFav? '★' : '☆'}</button>
          )}
        </div>
      </div>
      {u.englishName && <div className="muted">{u.englishName}</div>}
      {u.city && <div className="muted">{(lang==='en'? 'City': lang==='zh'? '城市':'Город')}: {pick(u.city)}</div>}
      <div className="row">
        {u.programs.map(p => (<span key={p} className="chip">{programLabel(lang, p)}</span>))}
      </div>
      <div className="row">
        <span className="chip badge-yellow">HSK: {pick(u.hskNote)}</span>
      </div>
      {u.bridgeNote && <div className="muted">{(lang==='en'? 'Bridge':'zh'===lang? '过渡':'Переход')}: {pick(u.bridgeNote)}</div>}
      {u.programsDetailed && u.programsDetailed.length>0 && (
        <div className="section" style={{padding:12}}>
          <div style={{fontWeight:600, marginBottom:8}}>{(lang==='en'? 'Program pages': lang==='zh'? '专业链接':'Страницы программ')}</div>
          {u.programsDetailed.map((pd, idx)=> (
            <div key={idx} className="row-spread" style={{marginBottom:6}}>
              <div className="muted">
                {programLabel(lang, pd.program)} · {degreeLabel(lang, pd.degree)} · HSK: {pick(pd.hsk)} · {(pd.acceptsFoundation ? (lang==='en'?'Foundation accepted':lang==='zh'?'可预科/语言过渡':'Есть подготовительный/язык') : (lang==='en'?'No foundation':lang==='zh'?'不支持预科':'Без подготовительного'))}
              </div>
              <a className="btn link" href={pd.url} target="_blank" rel="noopener noreferrer">{(lang==='en'?'Open':lang==='zh'?'打开':'Открыть')}</a>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{marginTop:8}}>
        <a className="btn" href={u.viewUrl} target="_blank" rel="noopener noreferrer">{(lang==='en'?'View Details':lang==='zh'?'查看详情':'Подробнее')}</a>
        <a className="btn primary" href={u.applyUrl} target="_blank" rel="noopener noreferrer">{(lang==='en'?'Apply Now':lang==='zh'?'立即申请':'Подать сейчас')}</a>
      </div>
    </div>
  )
}
