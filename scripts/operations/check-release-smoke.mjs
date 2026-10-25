#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_RELEASE_SMOKE_BYTES = 64 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value)
export function chinaCalendarDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = type => parts.find(part => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value
}

/** Directory identity may remain useful after every current fact or opportunity expires. */
export function assertReleaseSmoke(payload, expectedCommitSha, now = new Date()) {
  const data = object(payload) && payload.data
  if (!commit(expectedCommitSha) || !object(data) || data.deploymentSha !== expectedCommitSha
    || typeof data.id !== 'string' || !data.id.trim() || data.id.length > 200 || /[\u0000-\u001f\u007f]/u.test(data.id)
    || !calendarDate(data.evaluatedForDate) || data.evaluatedForDate !== chinaCalendarDay(now)
    || typeof data.directoryRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(data.directoryRevision)
    || !object(data.directoryCounts) || !count(data.directoryCounts.programs) || data.directoryCounts.programs === 0
    || !object(data.publicCounts) || !count(data.publicCounts.programs)
    || !object(data.currentOpportunityCounts) || !count(data.currentOpportunityCounts.programs)) throw new Error('release_smoke_invalid')
}

export async function checkReleaseSmokeInput(input, expectedCommitSha, now) {
  if (!commit(expectedCommitSha)) throw new Error('release_smoke_invalid')
  const chunks = []
  let bytes = 0
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_RELEASE_SMOKE_BYTES) throw new Error('release_smoke_too_large')
    chunks.push(buffer)
  }
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  assertReleaseSmoke(payload, expectedCommitSha, now)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Release smoke failed: expected one commit SHA and a bounded release response on stdin.')
    process.exitCode = 1
  } else {
    checkReleaseSmokeInput(process.stdin, process.argv[2]).catch(() => {
      console.error('Release smoke failed: invalid commit, release identity, date, or projected catalogue counts.')
      process.exitCode = 1
    })
  }
}
