import { NextResponse } from 'next/server'
import { CatalogRepositoryError } from '@/lib/catalog'
import { InvalidCursorError } from './cursor'

const responseHeaders = {
  'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
  'Content-Type': 'application/json; charset=utf-8',
}

export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidQueryError'
  }
}

export function stringParam(
  params: URLSearchParams,
  name: string,
  options: { maxLength?: number } = {},
): string | undefined {
  const value = params.get(name)?.trim()
  if (value && value.length > (options.maxLength ?? 200)) {
    throw new InvalidQueryError(`${name} is too long.`)
  }
  return value || undefined
}

export function integerParam(
  params: URLSearchParams,
  name: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const raw = stringParam(params, name)
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw)) throw new InvalidQueryError(`${name} must be an integer.`)
  const value = Number(raw)
  if (options.min !== undefined && value < options.min) throw new InvalidQueryError(`${name} is below the minimum.`)
  if (options.max !== undefined && value > options.max) throw new InvalidQueryError(`${name} exceeds the maximum.`)
  return value
}

export function numberParam(
  params: URLSearchParams,
  name: string,
  options: { min?: number } = {},
): number | undefined {
  const raw = stringParam(params, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new InvalidQueryError(`${name} must be a number.`)
  if (options.min !== undefined && value < options.min) throw new InvalidQueryError(`${name} is below the minimum.`)
  return value
}

export function ok<T>(payload: T) {
  return NextResponse.json(payload, { status: 200, headers: responseHeaders })
}

export function notFound(resource: string) {
  return NextResponse.json(
    { error: { code: 'not_found', message: `${resource} was not found.` } },
    { status: 404, headers: responseHeaders },
  )
}

export async function handleCatalogRequest(operation: () => Promise<NextResponse> | NextResponse) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof InvalidCursorError || error instanceof InvalidQueryError) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: error.message } },
        { status: 400, headers: { ...responseHeaders, 'Cache-Control': 'no-store' } },
      )
    }
    if (error instanceof CatalogRepositoryError) {
      return NextResponse.json(
        { error: { code: 'catalog_unavailable', message: 'The catalog is temporarily unavailable.' } },
        { status: 503, headers: { ...responseHeaders, 'Cache-Control': 'no-store', 'Retry-After': '60' } },
      )
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'The request could not be completed.' } },
      { status: 500, headers: { ...responseHeaders, 'Cache-Control': 'no-store' } },
    )
  }
}
