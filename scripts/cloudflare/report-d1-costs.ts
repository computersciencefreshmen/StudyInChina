import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

type Insight={query:string;totalRowsRead:number;totalRowsWritten:number;numberOfTimesRun:number;avgRowsRead:number;avgRowsWritten:number;avgDurationMs:number}
/** Insights are a bounded top-query sample, never the shared account's quota
 * balance. Keep SQL/bound values out of the portable diagnostic report. */
export function summarizeD1Costs(rows:Insight[],observedAt:string,timePeriod:string){
  return {format:'studyinchina.d1-query-costs',version:1,observedAt,timePeriod,scope:'top-query-sample',accountQuotaRemaining:null,
    sample:{rowsRead:rows.reduce((n,r)=>n+r.totalRowsRead,0),rowsWritten:rows.reduce((n,r)=>n+r.totalRowsWritten,0)},
    queries:rows.map(row=>({querySha256:createHash('sha256').update(row.query).digest('hex'),operation:row.query.trim().split(/\s+/u)[0].toUpperCase(),
      totalRowsRead:row.totalRowsRead,totalRowsWritten:row.totalRowsWritten,executions:row.numberOfTimesRun,averageRowsRead:row.avgRowsRead,averageRowsWritten:row.avgRowsWritten,averageDurationMs:row.avgDurationMs}))}
}
async function main(){
  const args=process.argv.slice(2),value=(flag:string,fallback:string)=>{const index=args.indexOf(flag);return index<0?fallback:args[index+1]??fallback}
  const database=value('--database','studyinchina-pipeline'),period=value('--time-period','1d'),output=resolve(value('--output','.tmp/d1-query-costs.json'))
  if(!/^[a-zA-Z0-9_-]+$/u.test(database)||!/^\d+[hmwd]$/u.test(period))throw Error('invalid_d1_insights_options')
  const {stdout}=await promisify(execFile)(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','insights',database,'--config','workers/catalog-maintenance/wrangler.jsonc','--time-period',period,'--sort-by','reads','--sort-type','sum','--limit','20','--json'],{maxBuffer:4*1024*1024,windowsHide:true})
  const rows=JSON.parse(stdout)as Insight[]
  if(!Array.isArray(rows)||rows.some(row=>typeof row.query!=='string'||[row.totalRowsRead,row.totalRowsWritten,row.numberOfTimesRun,row.avgRowsRead,row.avgRowsWritten,row.avgDurationMs].some(n=>!Number.isFinite(n)||n<0)))throw Error('invalid_d1_insights_response')
  const report=summarizeD1Costs(rows,new Date().toISOString(),period)
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({output,...report}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error instanceof Error?error.message:'d1_insights_failed');process.exitCode=1})
