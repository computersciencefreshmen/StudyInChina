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
import { canonicalIdentityJson, identityFingerprint } from '../../src/lib/data/identity-acceptance'
import { universitySchema } from '../../src/lib/data/schema'

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex')
describe('23 new official school identities',()=>{
  it('adds new schools outside the original cohort without creating programmes or scholarships',()=>{
    expect(receipt.addedSchoolCount).toBe(23)
    const originalIds=new Set(originalScope.schools.map(school=>school.universityId))
    const addedIds=new Set(receipt.identities.map(proof=>proof.recordId))
    expect(addedIds.size).toBe(23)
    for(const id of addedIds){expect(originalIds.has(id)).toBe(false);expect(universities.some(school=>school.id===id)).toBe(true)}
    expect(programs.some(program=>addedIds.has(program.universityId))).toBe(false)
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
})
