import { University } from '../data/universities'

export default function UniversityCard({ u, lang, toggleFav, isFav }: { u: University, lang: 'en'|'zh'|'ru', toggleFav?: (name:string)=>void, isFav?: boolean }) {
  const label = (en:string, zh:string, ru?:string) => lang==='en'? en: (lang==='zh'? zh: (ru??en))
  return (
    <div className="card">
      <div className="row-spread">
        <h3>{u.name}</h3>
        <div className="row">
          <span className="chip">{u.region}</span>
          {toggleFav && (
            <button className="btn" onClick={()=>toggleFav(u.name)}>{isFav? '★' : '☆'}</button>
          )}
        </div>
      </div>
      <div className="muted">{u.englishName}</div>
      {u.city && <div className="muted">{label('City','城市','Город')}: {u.city}</div>}
      <div className="row">
        {u.programs.map(p => (
          <span key={p} className="chip">{p === 'Translation' ? label('Translation','翻译/口译','Перевод/устный') : label('International Relations','国际关系','Международные отношения')}</span>
        ))}
      </div>
      <div className="row">
        <span className="chip badge-yellow">HSK: {u.hskNote}</span>
      </div>
      {u.bridgeNote && <div className="muted">{label('Bridge','过渡','Переход')}: {u.bridgeNote}</div>}
      {u.programsDetailed && u.programsDetailed.length>0 && (
        <div className="section" style={{padding:12}}>
          <div style={{fontWeight:600, marginBottom:8}}>{label('Program pages','专业链接','Страницы программ')}</div>
          {u.programsDetailed.map((pd, idx)=> (
            <div key={idx} className="row-spread" style={{marginBottom:6}}>
              <div className="muted">
                {pd.program === 'Translation' ? label('Translation','翻译/口译','Перевод/Устный перевод') : label('International Relations','国际关系','Международные отношения')} · {pd.degree} · HSK: {pd.hsk} · {label(pd.acceptsFoundation? 'Foundation accepted':'No foundation','可预科/语言过渡', pd.acceptsFoundation? 'Подготовит. год/язык — да':'Без подготовительного')}
              </div>
              <a className="btn link" href={pd.url} target="_blank" rel="noopener noreferrer">{label('Open','打开','Открыть')}</a>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{marginTop:8}}>
        <a className="btn" href={u.viewUrl} target="_blank" rel="noopener noreferrer">{label('View Details','查看详情','查看')}</a>
        <a className="btn primary" href={u.applyUrl} target="_blank" rel="noopener noreferrer">{label('Apply Now','立即申请','Подать сейчас')}</a>
      </div>
    </div>
  )
}
