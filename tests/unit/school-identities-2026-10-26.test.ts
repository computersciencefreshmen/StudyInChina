import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import ledger from '../../content/data/identity-acceptances.json'
import originalScope from '../../content/maintenance/scope-272.v1.json'
import registry from '../../content/targets/national-university-registry.json'
import receipt from '../../quality/schools/2026-10-26/new-school-identities.json'
import programmeReceipt from '../../quality/schools/2026-10-27/new-school-programmes.json'
import { canonicalIdentityJson, identityFingerprint } from '../../src/lib/data/identity-acceptance'
import { universitySchema, programSchema } from '../../src/lib/data/schema'
import { selectDiscoveryData, type DiscoveryRecord } from '../../src/lib/data/discovery'
import type { Program } from '../../src/lib/data/types'
import { selectPublishedData } from '../../src/lib/data/publication'
import { identityAcceptanceLedgerSchema } from '../../src/lib/data/identity-acceptance'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex')
describe('23 new official school identities',()=>{
  it('keeps newly discovered schools outside the original cohort and requires programmes before publication',()=>{
    expect(receipt.addedSchoolCount).toBe(23)
    const originalIds=new Set(originalScope.schools.map(school=>school.universityId))
    const addedIds=new Set(receipt.identities.map(proof=>proof.recordId))
    expect(addedIds.size).toBe(23)
    for(const id of addedIds){expect(originalIds.has(id)).toBe(false);expect(universities.some(school=>school.id===id)).toBe(true)}
    const bundle=loadMaintenanceBundle(process.cwd())
    const directory=selectDiscoveryData(bundle,'2026-10-27',identityAcceptanceLedgerSchema.parse(ledger).entries,[])
    expect(directory.universities.filter(school=>addedIds.has(school.id))).toHaveLength(23)
    for(const id of addedIds){
      const visible=directory.programs.filter(program=>program.universityId===id)
      expect(visible.length).toBeGreaterThanOrEqual(1)
      for(const program of visible){
        expect(program.verificationScope).toBe('identity')
        expect((program as DiscoveryRecord<Program>).discovery.currentFacts).toBe(false)
        expect(program.durationMonths).toBeNull()
        expect(program.applyUrl).toBeNull()
        expect(program.teachingLanguages).toEqual([])
        expect(program.languageRequirements).toEqual([])
      }
    }
    expect(selectPublishedData(bundle,'2026-10-27').programs.some(program=>addedIds.has(program.universityId))).toBe(false)
    expect(scholarships.some(award=>award.universityIds.some(id=>addedIds.has(id)))).toBe(false)
  })
  it('binds every school to the exact ministry name, city, identity and archived official bytes',()=>{
    const{sha256,...content}=receipt
    expect(hash(canonicalIdentityJson(content))).toBe(sha256)
    for(const proof of receipt.identities){
      const school=universitySchema.parse(universities.find(row=>row.id===proof.recordId))
      const official=registry.institutions.find(row=>row.institutionCode===proof.institutionCode)
      expect(official?.officialNameZh).toBe(school.name.zh)
      expect(proof.officialUrl).toBe(school.officialUrl)
      expect(identityFingerprint('university',school)).toBe(proof.identitySha256)
      expect(ledger.entries.find(entry=>entry.entityType==='university'&&entry.recordId===school.id)?.receiptSha256).toBe(sha256)
      for(const source of proof.sources){
        expect(source.url).toMatch(/^https:\/\//u)
        expect(source.httpStatus).toBe(200)
        const raw=gunzipSync(readFileSync(resolve(source.evidencePath)))
        expect(raw.length).toBe(source.byteLength)
        expect(hash(raw)).toBe(source.rawSha256)
      }
    }
  })
  it('preserves independently locatable programme, degree and international-scope evidence for all new schools',()=>{
    const{sha256,...content}=programmeReceipt
    expect(hash(canonicalIdentityJson(content))).toBe(sha256)
    expect(programmeReceipt.addedProgrammeCount).toBe(23)
    expect(new Set(programmeReceipt.accepted.map(proof=>proof.universityId)).size).toBe(23)
    for(const artifact of programmeReceipt.artifacts){
      const raw=gunzipSync(readFileSync(resolve(artifact.evidencePath)))
      expect(raw.length).toBe(artifact.byteLength)
      expect(hash(raw)).toBe(artifact.sha256)
    }
    for(const proof of programmeReceipt.accepted){
      const program=programSchema.parse(programs.find(row=>row.id===proof.recordId))
      expect(program.universityId).toBe(proof.universityId)
      expect(program.name).toEqual(proof.name)
      expect(program.verificationScope).toBe('identity')
      expect(identityFingerprint('program',program)).toBe(proof.identitySha256)
      expect(ledger.entries.find(entry=>entry.entityType==='program'&&entry.recordId===program.id)?.receiptSha256).toBe(sha256)
      expect(proof.currentOpportunityVerified).toBe(false)
      expect(proof.catalogueReconciled).toBe(false)
      expect(proof.sources.some(source=>source.url===program.programUrl)).toBe(true)
      expect(proof.evidence.length).toBeGreaterThanOrEqual(2)
      for(const evidence of proof.evidence){
        const source=proof.sources.find(row=>row.url===evidence.url&&row.rawSha256===evidence.rawSha256)
        expect(source).toBeDefined()
        if(!source)throw new Error('unbound programme evidence')
        const raw=gunzipSync(readFileSync(resolve(source.evidencePath)))
        expect(hash(raw)).toBe(evidence.rawSha256)
        if(evidence.validation==='visual reading of archived original image'){
          expect(source.contentType).toBe('image/png')
          continue
        }
        if(!('textEvidencePath' in source)||typeof source.textEvidencePath!=='string')throw new Error('missing archived source text')
        const text=gunzipSync(readFileSync(resolve(source.textEvidencePath))).toString('utf8')
        expect(hash(text)).toBe(evidence.textSha256)
        if(typeof evidence.locator!=='object'||!('start'in evidence.locator))throw new Error('missing exact quote span')
        expect(text.slice(evidence.locator.start,evidence.locator.end)).toBe(evidence.quote)
      }
    }
  })
})
