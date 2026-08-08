import type { Region } from '@/lib/data/types'

export type CityExplorerView = 'constellation' | 'directory'
export type CityExplorerSort = 'universities' | 'name'
export type CityExplorerRegion = Region | 'all'

export type CityExplorerSearchParams = Record<string, string | string[] | undefined>

export type CityExplorerState = {
  view: CityExplorerView
  query: string
  region: CityExplorerRegion
  sort: CityExplorerSort
  viewExplicit: boolean
}

const regions = new Set<Region>([
  'north',
  'northeast',
  'east',
  'south',
  'central',
  'southwest',
  'northwest',
])

function readParam(
  params: CityExplorerSearchParams | URLSearchParams,
  key: string,
): string {
  if (params instanceof URLSearchParams) return params.get(key)?.trim() ?? ''
  const value = params[key]
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

function bounded(value: string, maxLength = 120): string {
  return value.slice(0, maxLength)
}

export const defaultCityExplorerState: CityExplorerState = {
  view: 'constellation',
  query: '',
  region: 'all',
  sort: 'universities',
  viewExplicit: false,
}

export function parseCityExplorerSearchParams(
  params: CityExplorerSearchParams | URLSearchParams,
): CityExplorerState {
  const requestedView = readParam(params, 'view')
  const requestedRegion = readParam(params, 'region')
  const requestedSort = readParam(params, 'sort')
  const viewExplicit = requestedView === 'constellation' || requestedView === 'directory'

  return {
    view: viewExplicit ? requestedView : defaultCityExplorerState.view,
    query: bounded(readParam(params, 'q')),
    region: regions.has(requestedRegion as Region)
      ? requestedRegion as Region
      : defaultCityExplorerState.region,
    sort: requestedSort === 'name' ? 'name' : defaultCityExplorerState.sort,
    viewExplicit,
  }
}

export function cityExplorerSearchParams(
  current: URLSearchParams,
  state: CityExplorerState,
): URLSearchParams {
  const params = new URLSearchParams(current)

  if (state.query) params.set('q', state.query)
  else params.delete('q')

  if (state.region !== 'all') params.set('region', state.region)
  else params.delete('region')

  if (state.sort !== 'universities') params.set('sort', state.sort)
  else params.delete('sort')

  if (state.viewExplicit) params.set('view', state.view)
  else params.delete('view')

  return params
}
