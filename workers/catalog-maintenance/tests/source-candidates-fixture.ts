import { seed,setControls } from '../src/repository'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'
import { canonical,digest } from '../src/util'
import { makeEnv,seedInput,TEST_CATALOG,TEST_GUARDS } from './fixture'

export const candidateNow=Date.parse('2026-11-14T12:00:00.000Z'),candidateCommit='d'.repeat(40)
export async function sourceCandidateFixture(){
  const f=makeEnv(),input=seedInput()
  input.scopeRegistrySha256=EXISTING_SCHOOLS_V2_SHA256
  for(let i=272;i<295;i++)input.schools.push({universityId:`uni-${String(i).padStart(3,'0')}`,name:{en:`University ${i}`},sourceSeeds:[]})
  for(const [index,host]of ['www.cup.edu.cn','other.edu.cn'].entries())input.schools[index].sourceSeeds=[{id:`anchor-${index}`,url:`https://${host}/`,allowedHosts:[host.replace(/^www\./u,'')],sourceCategory:'catalog_anchor',enabled:true,registration:'catalogue_official'}]
  f.env.SCOPE_REGISTRY_SHA256=EXISTING_SCHOOLS_V2_SHA256;f.env.SCOPE_SCHOOL_COUNT='295'
  await seed(f.env,input,candidateNow)
  await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:false,canaryUniversityIds:['uni-000','uni-001','uni-002','uni-003','uni-004']},candidateNow)
  const audit={sourceIds:['source-city'],verifiedAt:'2026-11-14',reviewAfter:'2027-11-14',status:'verified'}
  const city={...audit,id:'city-beijing',slug:'beijing',name:{en:'Beijing'},province:{en:'Beijing'},region:'north',coordinates:{lat:39,lng:116},overview:null,climate:null,foodHighlights:[],sights:[]}
  const universities=['www.cup.edu.cn','other.edu.cn'].map((host,index)=>({...audit,id:`uni-00${index}`,slug:`university-${index}`,name:{en:`University ${index}`},cityId:city.id,region:'north',officialUrl:`https://${host}/`,admissionsUrl:`https://${host}/`,summary:null,featured:false,sourceIds:[`source-university-${index}`]}))
  const sources=[{id:'source-city',url:'https://beijing.gov.cn/',title:'City source',publisher:'City',kind:'city',language:'en',official:true,accessedAt:'2026-11-14'},...universities.map((u,index)=>({id:`source-university-${index}`,url:u.officialUrl,title:'Official university',publisher:u.name.en,kind:'university',language:'en',official:true,accessedAt:'2026-11-14'}))]
  const files:Record<string,unknown>={'universities.json':universities,'cities.json':[city],'sources.json':sources,'identity-acceptances.json':{schemaVersion:1,entries:[]}}
  const calls:Array<{url:string;options?:RequestInit}>=[]
  const fetcher:typeof fetch=async(url,options)=>{const value=String(url);calls.push({url:value,options});if(!value.startsWith(`https://raw.githubusercontent.com/computersciencefreshmen/StudyInChina/${candidateCommit}/content/data/`))throw Error('external request prohibited');const name=value.split('/').at(-1)!;if(!Object.hasOwn(files,name))throw Error('unapproved file');return new Response(JSON.stringify(files[name]),{headers:{'content-type':'application/json'}})}
  const ack={batchId:'publication-test',outcome:'published',receiptSha256:'c'.repeat(64),sourceCommit:candidateCommit,newInputCatalogSha256:TEST_CATALOG,acceptedProposalIds:['actual-proposal'],heldProposalIds:[],unchangedProposalIds:[],deploymentId:'dpl_publishedDirectory',stableProofSha256:'e'.repeat(64)},ackJson=canonical(ack)
  f.db.sqlite.prepare("INSERT INTO maintenance_exports VALUES(?,?,?,?,?,?,'published',?,?)").run(ack.batchId,TEST_CATALOG,EXISTING_SCHOOLS_V2_SHA256,'maintenance/export.json','f'.repeat(64),new Date(candidateNow).toISOString(),await digest(ackJson),ackJson)
  const request=(suffix='first')=>({operationId:`candidate-${suffix}`,expectedRevision:1,scopeRegistrySha256:EXISTING_SCHOOLS_V2_SHA256,inputCatalogSha256:TEST_CATALOG,universityId:'uni-000',urls:[{url:'https://www.cup.edu.cn/overseas/docs/2027/new-guide.pdf',categories:['current_guide']}]})
  return{...f,input,files,calls,fetcher,request}
}
