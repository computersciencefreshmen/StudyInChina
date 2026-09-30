import { describe,it,expect } from 'vitest'
import { meaningfulFingerprint,matchesFollowedUpdate,publishedUpdates,type PublishedObservation } from '@/lib/notifications/changes'
const program:PublishedObservation={id:'program-one',kind:'program',universityId:'university-one',fingerprint:'before',verified:true,title:'Software engineering',slug:'software-engineering'}
describe('published opportunity updates',()=>{
  it('does not flood subscribers with existing catalogue records at first observation',()=>{expect(publishedUpdates(null,{[program.id]:program})).toEqual([])})
  it('ignores refreshed verification dates and object property order',()=>{expect(meaningfulFingerprint({name:'A',fee:100,lastVerified:'2026-01-01',reviewAfter:'2026-03-01'})).toBe(meaningfulFingerprint({fee:100,name:'A',lastVerified:'2026-09-30',reviewAfter:'2026-10-30'}));expect(meaningfulFingerprint({fee:200})).not.toBe(meaningfulFingerprint({fee:100}))})
  it('emits new and changed verified records but withholds candidates',()=>{const before={[program.id]:program};const updates=publishedUpdates(before,{[program.id]:{...program,fingerprint:'after'},new:{...program,id:'new'},draft:{...program,id:'draft',verified:false}});expect(updates.map(item=>item.change)).toEqual(['updated','created']);expect(updates.some(item=>item.id==='draft')).toBe(false)})
  it('matches a new program to either its school or its program followers only',()=>{expect(matchesFollowedUpdate([{kind:'university',id:'university-one'}],program)).toBe(true);expect(matchesFollowedUpdate([{kind:'program',id:'program-one'}],program)).toBe(true);expect(matchesFollowedUpdate([{kind:'university',id:'university-other'}],program)).toBe(false)})
})
