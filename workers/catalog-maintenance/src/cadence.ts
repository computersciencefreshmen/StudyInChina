type SourceCadence={category:string;interval_hours:number}
/** Old canonical dates affect acquisition priority only. They are never evidence
 * of a current deadline and do not update a fact or its review timestamp. */
export function captureCadence(source:SourceCadence,fields:Array<Record<string,unknown>>,now=Date.now()):{intervalHours:number;priority:number}{
  const base=Math.max(1,Math.min(2160,source.interval_hours))
  if(!fields.length){
    if(source.category==='contacts'||base===2160)return{intervalHours:2160,priority:10}
    if(/catalog|program_detail|international_admissions_home/u.test(source.category))return{intervalHours:720,priority:10}
    return{intervalHours:base,priority:10}
  }
  let nearest=Infinity
  for(const target of fields)for(const key of ['closesOn','deadline']){
    const value=target[key]
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))continue
    const date=Date.parse(`${value}T00:00:00Z`)
    if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==value)continue
    const remaining=Date.parse(`${value}T23:59:59+08:00`)-now
    if(remaining>=0)nearest=Math.min(nearest,remaining)
  }
  if(nearest<=7*86400000)return{intervalHours:Math.min(base,24),priority:0}
  if(nearest<=45*86400000)return{intervalHours:Math.min(base,72),priority:1}
  return{intervalHours:Math.min(base,168),priority:1}
}
