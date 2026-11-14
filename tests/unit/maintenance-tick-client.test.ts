import { describe, expect, it } from 'vitest'
import { requestIsolatedTick, type MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'

describe('isolated scheduler client fails closed against an older Worker', () => {
  it.each(['dispatch_only', 'administrative_only'] as const)('requires fixed capabilities before sending %s', async mode => {
    const calls: unknown[][] = []
    const client: Pick<MaintenanceClient, 'json'> = { async json(...args) { calls.push(args); return args[1] === 'POST'
      ? { format: 'studyinchina.cloud-maintenance-tick', mode }
      : { format: 'studyinchina.maintenance-tick-modes', version: 1, modes: ['full', 'dispatch_only', 'administrative_only'] } } }
    expect(await requestIsolatedTick(client, mode)).toMatchObject({ mode })
    expect(calls).toEqual([['/tick'], [mode==='dispatch_only'?'/tick/dispatch':'/tick/administrative', 'POST', { mode }]])
  })

  it.each([null, {}, { format: 'studyinchina.cloud-maintenance-status' }, { format: 'studyinchina.maintenance-tick-modes', version: 1, modes: ['full'] }])('never posts when support is unproved: %j', async response => {
    const calls: unknown[][] = [], client: Pick<MaintenanceClient, 'json'> = { async json(...args) { calls.push(args); return response } }
    await expect(requestIsolatedTick(client, 'dispatch_only')).rejects.toThrow('maintenance_tick_mode_unavailable')
    expect(calls).toEqual([['/tick']])
  })

  it('a legacy 404 or unavailable capability stops before POST, and a mismatched mode response is never reported as success', async () => {
    let calls = 0
    await expect(requestIsolatedTick({ async json() { calls++; throw new Error('maintenance_http_404') } }, 'dispatch_only')).rejects.toThrow('maintenance_http_404')
    expect(calls).toBe(1)
    await expect(requestIsolatedTick({ async json(_path, method) { return method === 'POST' ? { format: 'studyinchina.cloud-maintenance-tick' } : { format: 'studyinchina.maintenance-tick-modes', version: 1, modes: ['dispatch_only'] } } }, 'dispatch_only')).rejects.toThrow('maintenance_tick_mode_response_invalid')
  })

  it('new GET followed by an old Worker POST cannot fall through to the old full tick', async () => {
    let oldFullTickCalls=0,posts=0
    await expect(requestIsolatedTick({async json(path,method){
      if(!method)return{format:'studyinchina.maintenance-tick-modes',version:1,modes:['dispatch_only']}
      posts++
      // The old router only handles POST /tick; unknown subpaths return 404.
      if(path==='/tick'){oldFullTickCalls++;return{format:'studyinchina.cloud-maintenance-tick'}}
      throw new Error('maintenance_http_404')
    }},'dispatch_only')).rejects.toThrow('maintenance_http_404')
    expect(posts).toBe(1);expect(oldFullTickCalls).toBe(0)
  })
})
