import { describe, expect, it } from 'vitest'
import { applySiteObservations, followedSiteUpdates, parseSiteNotifications, parseSiteObservations, parseSiteUpdates, type SiteObservation, type SiteUpdate } from '@/lib/site-notifications'

const observation: SiteObservation = { observationKey: 'program:program-one', id: 'program-one', kind: 'program', universityId: 'university-one', title: 'Software engineering', slug: 'software-engineering', fingerprint: 'before', verified: true }
const event: SiteUpdate = { eventId: 'event-one', id: 'program-one', kind: 'program', universityId: 'university-one', title: 'Software engineering', slug: 'software-engineering', change: 'created', publishedAt: 100 }
const follow = { kind: 'university' as const, id: 'university-one', label: 'University', followedAt: 0 }

describe('browser-local observed notification changes', () => {
  it('recovers from malformed storage and ignores invalid follows', () => {
    expect(parseSiteNotifications('broken').follows).toEqual([])
    const value = parseSiteNotifications(JSON.stringify({ follows: [{ kind: 'other', id: 'one', label: 'A', followedAt: 0 }], readIds: ['read', 'read', 1, null] }))
    expect(value.follows).toEqual([])
    expect(value.readIds).toEqual(['read'])
  })

  it('establishes a first baseline without sending a catalogue backlog', () => {
    const state = { ...parseSiteNotifications(null), follows: [follow] }
    const baseline = applySiteObservations(state, [observation], 100)
    expect(baseline.events).toEqual([])
    expect(baseline.baseline[observation.observationKey].fingerprint).toBe('before')
    expect(baseline.initializedTargets).toEqual(['university:university-one'])
    expect(applySiteObservations(baseline, [observation], 200).events).toEqual([])
  })

  it('emits new and changed verified records and deduplicates overlapping follows', () => {
    const state = { ...parseSiteNotifications(null), follows: [follow, { kind: 'program' as const, id: 'program-one', label: 'Program', followedAt: 0 }] }
    const baseline = applySiteObservations(state, [observation], 100)
    const result = applySiteObservations(baseline, [{ ...observation, fingerprint: 'after' }, { ...observation, observationKey: 'program:new', id: 'new' }, { ...observation, observationKey: 'program:draft', id: 'draft', verified: false }], 200)
    expect(result.events.map(event => event.change)).toEqual(['updated', 'created'])
    expect(result.events).toHaveLength(2)
  })

  it('counts transitions so a legitimate A to B to A change alerts twice', () => {
    let state = applySiteObservations({ ...parseSiteNotifications(null), follows: [follow] }, [observation], 100)
    state = applySiteObservations(state, [{ ...observation, fingerprint: 'after' }], 200)
    state = applySiteObservations(state, [observation], 300)
    expect(state.events).toHaveLength(2)
    expect(state.events[0].eventId).not.toBe(state.events[1].eventId)
    expect(state.baseline[observation.observationKey].occurrence).toBe(3)
  })

  it('retains missing baseline entries so temporary withdrawal does not create a renewal alert', () => {
    let state = applySiteObservations({ ...parseSiteNotifications(null), follows: [follow] }, [observation], 100)
    state = applySiteObservations(state, [], 200)
    state = applySiteObservations(state, [observation], 300)
    expect(state.events).toEqual([])
  })

  it('baselines already-public stale records and suppresses unchanged renewal after reload', () => {
    const stale = { ...observation, verified: false }
    let state = applySiteObservations({ ...parseSiteNotifications(null), follows: [follow] }, parseSiteObservations([stale]), 100)
    expect(state.events).toEqual([])
    state = parseSiteNotifications(JSON.stringify(state))
    expect(state.baseline[observation.observationKey].verified).toBe(false)
    expect(applySiteObservations(state, [observation], 200).events).toEqual([])
    const changed = applySiteObservations(state, [{ ...observation, fingerprint: 'corrected-facts' }], 200)
    expect(changed.events).toHaveLength(1)
    expect(changed.events[0].change).toBe('updated')
  })

  it('initializes new follows separately while existing follows still receive changes', () => {
    let state = applySiteObservations({ ...parseSiteNotifications(null), follows: [follow] }, [observation], 100)
    state = { ...state, follows: [...state.follows, { kind: 'university', id: 'university-two', label: 'Second university', followedAt: 150 }] }
    const result = applySiteObservations(state, [{ ...observation, fingerprint: 'after' }, { ...observation, observationKey: 'program:second', id: 'second', universityId: 'university-two' }], 200)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].id).toBe('program-one')
  })

  it('keeps cycles distinct even when they link to the same followed program', () => {
    let state = applySiteObservations({ ...parseSiteNotifications(null), follows: [follow] }, [observation], 100)
    state = applySiteObservations(state, [observation, { ...observation, observationKey: 'cycle:cycle-one', title: '2027 admission cycle' }], 200)
    expect(state.events).toHaveLength(1)
    expect(state.events[0].title).toBe('2027 admission cycle')
  })

  it('caps local history at100 events, retains30 days and removes read IDs outside retained history', () => {
    const state = { ...parseSiteNotifications(null), follows: [follow], initializedTargets: ['university:university-one'], readIds: ['old'], events: [{ ...event, eventId: 'old' }] }
    const many = Array.from({ length: 105 }, (_, index) => ({ ...observation, observationKey: 'program:new-' + index, id: 'new-' + index }))
    const result = applySiteObservations(state, many, 31 * 86_400_000)
    expect(result.events).toHaveLength(100)
    expect(result.readIds).toEqual([])
  })

  it('validates observations and events and excludes updates before follow time', () => {
    expect(parseSiteObservations([observation, { ...observation, verified: false }, { ...observation, verified: 'true' }, { ...observation, observationKey: 'invalid' }, null])).toEqual([observation, { ...observation, verified: false }])
    expect(parseSiteUpdates([event, { ...event, publishedAt: '100' }, null])).toEqual([event])
    expect(followedSiteUpdates([{ ...follow, followedAt: 101 }], [event])).toEqual([])
    expect(followedSiteUpdates([follow], [event, event])).toEqual([event])
  })

  it('migrates old browser state to five hours and preserves a valid daily preference', () => {
    expect(parseSiteNotifications(null).summaryFrequency).toBe('five-hours')
    expect(parseSiteNotifications(JSON.stringify({ summaryFrequency: 'unsupported' })).summaryFrequency).toBe('five-hours')
    const daily = { ...parseSiteNotifications(null), follows: [follow], summaryFrequency: 'daily' as const }
    expect(parseSiteNotifications(JSON.stringify(applySiteObservations(daily, [observation], 100))).summaryFrequency).toBe('daily')
  })

})
