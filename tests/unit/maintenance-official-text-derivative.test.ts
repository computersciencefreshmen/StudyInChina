import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyReviewedProposalEvidence } from '../../scripts/maintenance/import-identities'
import { proposalContentSha256, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import { htmlToText, normalizeEvidenceText } from '../../workers/ingestion/src/rules'

const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex')
const encode=(text:string)=>new TextEncoder().encode(text)
async function fixture(){
  const raw=encode('<h1>International admissions</h1><p>Computer Science master degree for international students.</p>')
  const text=normalizeEvidenceText(htmlToText(new TextDecoder().decode(raw))), bytes=encode(text)
  const source={id:'official',url:'https://test.edu.cn/catalog',snapshotSha256:hash(raw),objectKey:'maintenance/raw.html',checkedAt:'2026-11-11T00:00:00.000Z',contentType:'text/html',locator:`text:offset:0:${text.length}`,quote:'Computer Science',
    textArtifact:{objectKey:'maintenance/text.txt',sha256:hash(bytes),rawSnapshotSha256:hash(raw),parser:'official-response-text-v1' as const}}
  const proposal:MaintenanceProposal={id:'synthetic',universityId:'school',entityType:'program',recordId:null,operation:'create',fields:{},source,
    fieldEvidence:[],scope:{year:null,intake:null},extractionAttemptId:null,status:'ready',warnings:[]}
  const refresh=async()=>{proposal.review={decision:'approved',method:'deterministic',reviewerId:'deterministic:synthetic-text-fixture',reviewedAt:source.checkedAt,
    candidateSha256:await proposalContentSha256(proposal),snapshotSha256:source.snapshotSha256,checks:{internationalScope:true,concreteProgram:true,evidenceLocated:true}}}
  await refresh()
  const objects=new Map([['maintenance/raw.html',raw],['maintenance/text.txt',bytes]])
  const read=async(key:string)=>{const value=objects.get(key);if(!value)throw Error('missing_fixture');return value}
  const school={officialHosts:['test.edu.cn']} as MaintenanceScope['schools'][number]
  return{proposal,objects,read,school,refresh}
}
describe('partition text is reproducible official evidence',()=>{
  it('accepts exact full-text derivatives and original UTF-16 offset quotes',async()=>{
    const f=await fixture();await expect(verifyReviewedProposalEvidence(f.proposal,f.school,f.read)).resolves.toBeUndefined()
  })
  it('rejects an invented derivative even with a matching derivative hash and a valid original quote',async()=>{
    const f=await fixture(), bytes=encode('Computer Science. Invented tuition: free.')
    f.objects.set('maintenance/text.txt',bytes);f.proposal.source.textArtifact!.sha256=hash(bytes);await f.refresh()
    await expect(verifyReviewedProposalEvidence(f.proposal,f.school,f.read)).rejects.toThrow('official_response_text_not_reproducible')
  })
  it('rejects changed original bytes and quotes outside the admitted offset span',async()=>{
    const f=await fixture();f.objects.set('maintenance/raw.html',encode('<p>Changed original</p>'))
    await expect(verifyReviewedProposalEvidence(f.proposal,f.school,f.read)).rejects.toThrow('source_snapshot_checksum_mismatch')
    const g=await fixture();g.proposal.source.locator='text:offset:0:5';await g.refresh()
    await expect(verifyReviewedProposalEvidence(g.proposal,g.school,g.read)).rejects.toThrow('evidence_quote_not_at_locator')
  })
})
