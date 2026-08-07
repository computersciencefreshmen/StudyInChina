import { Buffer } from 'node:buffer'
import { CatalogRepositoryError } from './types'

type JsonListCursor = {
  v: 1
  backend: 'json'
  resource: 'institutions' | 'programs' | 'scholarships'
  fingerprint: string
  page: number
}

type ShadowListCursor = {
  v: 1
  backend: 'shadow'
  resource: 'institutions' | 'programs' | 'scholarships'
  primary: string | null
  shadow: string | null
}

type ListCursor = JsonListCursor | ShadowListCursor

const MAX_CURSOR_LENGTH = 1_024

function fail(): never {
  throw new CatalogRepositoryError('INVALID_LIST_CURSOR', 'Catalog list cursor is invalid.')
}

function encode(value: ListCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decode(value: string): ListCursor {
  if (!value || value.length > MAX_CURSOR_LENGTH) fail()
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ListCursor>
    if (parsed.v !== 1 || (parsed.backend !== 'json' && parsed.backend !== 'shadow')) fail()
    return parsed as ListCursor
  } catch (error) {
    if (error instanceof CatalogRepositoryError) throw error
    return fail()
  }
}

export function encodeJsonListCursor(
  resource: JsonListCursor['resource'],
  fingerprint: string,
  page: number,
): string {
  if (!Number.isSafeInteger(page) || page < 1) fail()
  return encode({ v: 1, backend: 'json', resource, fingerprint, page })
}

export function decodeJsonListCursor(
  value: string,
  resource: JsonListCursor['resource'],
  fingerprint: string,
): number {
  const parsed = decode(value)
  if (
    parsed.backend !== 'json'
    || parsed.resource !== resource
    || parsed.fingerprint !== fingerprint
    || !Number.isSafeInteger(parsed.page)
    || parsed.page < 1
  ) fail()
  return parsed.page
}

export function encodeShadowListCursor(
  resource: ShadowListCursor['resource'],
  primary: string | null,
  shadow: string | null,
): string {
  if (!primary) fail()
  return encode({ v: 1, backend: 'shadow', resource, primary, shadow })
}

export function decodeShadowListCursor(
  value: string,
  resource: ShadowListCursor['resource'],
): { primary: string | null; shadow: string | null } {
  const parsed = decode(value)
  if (
    parsed.backend !== 'shadow'
    || parsed.resource !== resource
    || (parsed.primary !== null && typeof parsed.primary !== 'string')
    || (parsed.shadow !== null && typeof parsed.shadow !== 'string')
  ) fail()
  return { primary: parsed.primary, shadow: parsed.shadow }
}
