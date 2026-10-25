import assert from 'node:assert/strict'
import test from 'node:test'
import type { MaintenanceProposal } from '../../../scripts/maintenance/contracts'
import { persistProposals } from '../src/proposals'
import { seed } from '../src/repository'
import { digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

async function candidates(count:number){
  const sourceId=await digest('https://test.edu.cn/catalog'),snapshotSha256='1'.repeat(64),checkedAt=new Date().toISOString()
  const proposals:MaintenanceProposal[]=Array.from({length:count},(_,index)=>({id:`proposal-${index}`,universityId:'uni-000',entityType:'program',recordId:null,operation:'create',fields:{name:{en:`Program ${index}`}},source:{id:sourceId,url:'https://test.edu.cn/catalog',snapshotSha256,objectKey:'maintenance/raw.bin',checkedAt,contentType:'text/html',locator:'text:document',quote:'International programme'},fieldEvidence:[{sourceId,url:'https://test.edu.cn/catalog',snapshotSha256,objectKey:'maintenance/raw.bin',locator:'text:document',quote:'International programme',fieldPath:'name.en'}],scope:{year:null,intake:null},status:'ready',warnings:[]}))
  return{sourceId,snapshotSha256,proposals}
}
test('a full 100-programme catalogue persists in ten bounded D1 statements without dropping its tail',async()=>{
  const f=makeEnv(),input=await candidates(100),batch=f.db.batch.bind(f.db),sizes:number[]=[]
  await seed(f.env,seedInput())
  f.env.PIPELINE_DB.batch=async statements=>{sizes.push(statements.length);return batch(statements)}
  await persistProposals(f.env,input.proposals,input.sourceId,input.snapshotSha256)
  assert.deepEqual(sizes,[10]);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_proposals').get()?.count,100)
  assert.equal(f.db.sqlite.prepare('SELECT proposal_id FROM maintenance_proposals WHERE proposal_id=?').get('proposal-99')?.proposal_id,'proposal-99')
  await persistProposals(f.env,input.proposals,input.sourceId,input.snapshotSha256)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_proposals').get()?.count,100);f.db.sqlite.close()
})
test('a tail failure rolls back all proposal chunks, so an engine cannot silently save half a catalogue',async()=>{
  const f=makeEnv(),input=await candidates(100)
  await seed(f.env,seedInput())
  f.db.sqlite.exec("CREATE TRIGGER reject_tail BEFORE INSERT ON maintenance_proposals WHEN NEW.proposal_id='proposal-99' BEGIN SELECT RAISE(ABORT,'simulated tail failure'); END")
  await assert.rejects(persistProposals(f.env,input.proposals,input.sourceId,input.snapshotSha256),/simulated tail failure/)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_proposals').get()?.count,0);f.db.sqlite.close()
})
test('field batches use four statements and invalid source bindings fail before persistence',async()=>{
  const f=makeEnv(),input=await candidates(40),batch=f.db.batch.bind(f.db),sizes:number[]=[]
  await seed(f.env,seedInput())
  f.env.PIPELINE_DB.batch=async statements=>{sizes.push(statements.length);return batch(statements)}
  input.proposals[39].source.snapshotSha256='2'.repeat(64)
  await assert.rejects(persistProposals(f.env,input.proposals,input.sourceId,input.snapshotSha256),/proposal_batch_binding_invalid/);assert.deepEqual(sizes,[])
  input.proposals[39].source.snapshotSha256=input.snapshotSha256
  await persistProposals(f.env,input.proposals,input.sourceId,input.snapshotSha256);assert.deepEqual(sizes,[4]);f.db.sqlite.close()
})
