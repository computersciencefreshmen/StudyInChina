import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import {
  DEFAULT_SCHOLARSHIP_INDEX_SOURCES,
  assertOfficialHttpsUrl,
} from './scholarship-index-harvester'

type JsonRecord = Record<string, unknown>

const ZJU_PDF_PARSER_VERSION = 'zju-pdf-tsv-v1'
const PKU_PDF_DIRECTORY_PARSER_VERSION = 'pku-pdf-directory-v1'
const SCHOLARSHIP_SOURCE_MODES = new Set(['live', 'fixture', 'dry-run'])
const SCHOLARSHIP_SCHEME_TYPES = new Set([
  'government',
  'university',
  'language',
  'donation',
  'exchange',
  'program_specific',
  'other',
])
const DEGREE_LEVELS = new Set(['bachelor', 'master', 'doctorate'])
const INSTRUCTION_LANGUAGES = new Set(['Chinese', 'English'])

function scholarshipInstitutionOfficialHosts():
Readonly<Record<string, readonly string[]>> {
  const hostsByInstitution = new Map<string, Set<string>>()
  for (const source of DEFAULT_SCHOLARSHIP_INDEX_SOURCES) {
    const hosts = hostsByInstitution.get(source.institutionId) ?? new Set<string>()
    for (const host of source.allowedHosts) hosts.add(host)
    hostsByInstitution.set(source.institutionId, hosts)
  }
  return Object.fromEntries(
    [...hostsByInstitution.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([institutionId, hosts]) => [
        institutionId,
        [...hosts].sort((left, right) => left.localeCompare(right, 'en')),
      ]),
  )
}

export const SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS:
Readonly<Record<string, readonly string[]>> = scholarshipInstitutionOfficialHosts()

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return nonEmptyString(value, label)
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`)
  }
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

function isoTimestamp(value: unknown, label: string): string {
  const text = nonEmptyString(value, label)
  const timestamp = new Date(text)
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return timestamp.toISOString()
}

function exactOfficialUrl(
  value: unknown,
  allowedHosts: readonly string[],
  label: string,
): string {
  try {
    return assertOfficialHttpsUrl(
      nonEmptyString(value, label),
      allowedHosts,
    ).href
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} is not on the exact official host allowlist: ${detail}`)
  }
}

function zjuOfficialUrl(value: unknown, label: string): string {
  let url: URL
  try {
    url = new URL(nonEmptyString(value, label))
  } catch {
    throw new Error(`${label} must be a valid official HTTPS URL`)
  }
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || (hostname !== 'zju.edu.cn' && !hostname.endsWith('.zju.edu.cn'))
  ) {
    throw new Error(`${label} must be an HTTPS Zhejiang University URL`)
  }
  url.hash = ''
  return url.href
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function zjuPdfLocator(evidence: JsonRecord, label: string): string {
  const page = integer(evidence.page, `${label}.page`)
  const lineStart = integer(evidence.lineStart, `${label}.lineStart`)
  const lineEnd = integer(evidence.lineEnd, `${label}.lineEnd`)
  if (page < 1 || lineStart < 1 || lineEnd < lineStart) {
    throw new Error(`${label} has invalid PDF page or line bounds`)
  }
  const bbox = asRecord(evidence.bbox, `${label}.bbox`)
  const left = finiteNumber(bbox.left, `${label}.bbox.left`)
  const top = finiteNumber(bbox.top, `${label}.bbox.top`)
  const width = finiteNumber(bbox.width, `${label}.bbox.width`)
  const height = finiteNumber(bbox.height, `${label}.bbox.height`)
  if (left < 0 || top < 0 || width <= 0 || height <= 0) {
    throw new Error(`${label}.bbox must describe a positive PDF region`)
  }
  const expected = [
    `pdf:page=${page}`,
    `lines=${lineStart}-${lineEnd}`,
    `bbox=${left},${top},${width},${height}`,
  ].join(';')
  const locator = nonEmptyString(evidence.locator, `${label}.locator`)
  if (locator !== expected) {
    throw new Error(`${label}.locator does not match its page, lines, and bbox`)
  }
  return locator
}

function pkuOfficialUrl(value: unknown, label: string): URL {
  let url: URL
  try {
    url = new URL(nonEmptyString(value, label))
  } catch {
    throw new Error(`${label} must be a valid official PKU HTTPS URL`)
  }
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'admission.pku.edu.cn'
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error(`${label} must use the registered admission.pku.edu.cn HTTPS host`)
  }
  url.hash = ''
  return url
}

function pkuMasterChineseIndexUrl(value: unknown): URL {
  const url = pkuOfficialUrl(value, 'input.indexUrl')
  if (!/^\/zsxx\/lxszs\/lxszyml\/\d{4}\/ss\/zsml_ss_lxs_cn\.html$/u.test(url.pathname)) {
    throw new Error('PKU harvest indexUrl is not a master Chinese catalog index')
  }
  return url
}

function pkuMasterChinesePdfUrl(
  value: unknown,
  indexUrl: URL,
  label: string,
): string {
  const url = pkuOfficialUrl(value, label)
  const expectedDirectory = indexUrl.pathname.slice(
    0,
    indexUrl.pathname.lastIndexOf('/') + 1,
  )
  const actualDirectory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
  const fileName = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  if (
    actualDirectory !== expectedDirectory
    || !/^zsml_ss_lxs_cn_[0-9]{5}\.pdf$/u.test(fileName)
  ) {
    throw new Error(`${label} has a catalog prefix or directory mismatch`)
  }
  return url.href
}

function normalizePkuIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:)\]])/gu, '$1')
    .replace(/([(\[])\s+/gu, '$1')
    .replace(/\s*([?????])\s*/gu, '$1')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    .trim()
    .toLowerCase()
    .replace(/[\s()[\]{}????????,?.?:?;?'?"??/_-]+/gu, '')
}

function pkuDepartmentFingerprint(value: string): string {
  let hash = 2_166_136_261
  for (const character of normalizePkuIdentity(value)) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

function pkuProgramEntityKey(department: string, programCode: string): string {
  return [
    'pku',
    'master',
    'chinese',
    pkuDepartmentFingerprint(department),
    programCode.toLowerCase(),
  ].join(':')
}

function pkuPdfLocator(
  evidence: JsonRecord,
  programCode: string,
  label: string,
): string {
  const page = integer(evidence.page, `${label}.page`)
  const lineStart = integer(evidence.lineStart, `${label}.lineStart`)
  const lineEnd = integer(evidence.lineEnd, `${label}.lineEnd`)
  if (page < 1 || lineStart < 1 || lineEnd < lineStart) {
    throw new Error(`${label} has invalid PDF page or line bounds`)
  }
  const expected = `pdf:page=${page};lines=${lineStart}-${lineEnd};code=${programCode}`
  const locator = nonEmptyString(evidence.locator, `${label}.locator`)
  if (locator !== expected) {
    throw new Error(`${label}.locator does not match page, lines, and programCode`)
  }
  return locator
}

function adaptPkuPdfDirectoryHarvest(root: JsonRecord): JsonRecord {
  if (root.sourceType !== 'official_pdf_directory') {
    throw new Error('PKU PDF harvest sourceType must be official_pdf_directory')
  }
  if (root.institutionId !== 'uni-peking-university') {
    throw new Error('PKU PDF harvest institutionId must be uni-peking-university')
  }
  if (root.degreeLevel !== 'master') {
    throw new Error('PKU PDF harvest degreeLevel must be master')
  }
  if (root.instructionLanguage !== 'Chinese') {
    throw new Error('PKU PDF harvest instructionLanguage must be Chinese')
  }
  const checkedAt = isoTimestamp(root.checkedAt, 'input.checkedAt')
  const indexUrl = pkuMasterChineseIndexUrl(root.indexUrl)
  const values = array(root.entities, 'input.entities')
  const reconciliation = asRecord(root.reconciliation, 'input.reconciliation')
  const verifiedRows = integer(
    reconciliation.verifiedRows,
    'input.reconciliation.verifiedRows',
  )
  const uniqueVerifiedPrograms = integer(
    reconciliation.uniqueVerifiedPrograms,
    'input.reconciliation.uniqueVerifiedPrograms',
  )
  const indexAnchors = integer(
    reconciliation.indexAnchors,
    'input.reconciliation.indexAnchors',
  )
  const acceptedDocuments = integer(
    reconciliation.acceptedDocuments,
    'input.reconciliation.acceptedDocuments',
  )
  const loadedDocuments = integer(
    reconciliation.loadedDocuments,
    'input.reconciliation.loadedDocuments',
  )
  const missingDocuments = integer(
    reconciliation.missingDocuments,
    'input.reconciliation.missingDocuments',
  )
  const quarantinedIndexAnchors = integer(
    reconciliation.quarantinedIndexAnchors,
    'input.reconciliation.quarantinedIndexAnchors',
  )
  const quarantinedDocuments = integer(
    reconciliation.quarantinedDocuments,
    'input.reconciliation.quarantinedDocuments',
  )
  const documentCoverageRate = finiteNumber(
    reconciliation.documentCoverageRate,
    'input.reconciliation.documentCoverageRate',
  )
  if (verifiedRows !== values.length || uniqueVerifiedPrograms !== values.length) {
    throw new Error('PKU PDF harvest verified reconciliation does not equal entities.length')
  }
  if (
    acceptedDocuments <= 0
    || loadedDocuments !== acceptedDocuments
    || missingDocuments !== 0
    || quarantinedDocuments !== 0
    || documentCoverageRate !== 100
    || indexAnchors !== acceptedDocuments + quarantinedIndexAnchors
  ) {
    throw new Error(
      'PKU PDF harvest document coverage is incomplete and cannot be materialized',
    )
  }

  const quarantinedPrefixUrls = new Set<string>()
  for (const [index, value] of array(root.quarantined, 'input.quarantined').entries()) {
    const label = `input.quarantined[${index}]`
    const item = asRecord(value, label)
    if (item.status !== 'quarantined') {
      throw new Error(`${label}.status must be quarantined`)
    }
    if (item.scope !== 'index') {
      throw new Error(`${label}.scope must be index for an explained catalog mismatch`)
    }
    const reasons = array(item.reasons, `${label}.reasons`)
      .map((reason, reasonIndex) => nonEmptyString(
        reason,
        `${label}.reasons[${reasonIndex}]`,
      ))
    if (reasons.length === 0) throw new Error(`${label}.reasons must not be empty`)
    if (reasons.some((reason) => reason !== 'catalog_prefix_mismatch')) {
      throw new Error(`${label}.reasons contains an unexplained quarantine reason`)
    }
    const url = pkuOfficialUrl(item.officialUrl, `${label}.officialUrl`).href
    if (reasons.includes('catalog_prefix_mismatch')) quarantinedPrefixUrls.add(url)
  }
  if (quarantinedPrefixUrls.size !== quarantinedIndexAnchors) {
    throw new Error('PKU PDF harvest quarantined index reconciliation is inconsistent')
  }

  const entities = values.map((value, index) => {
    const label = `input.entities[${index}]`
    const entity = asRecord(value, label)
    if (
      entity.entityType !== 'program'
      || entity.programType !== 'degree'
      || entity.degreeLevel !== 'master'
      || entity.instructionLanguage !== 'Chinese'
      || entity.verificationStatus !== 'verified'
    ) {
      throw new Error(`${label} must be a verified Chinese-taught master degree program`)
    }
    if (entity.institutionId !== 'uni-peking-university') {
      throw new Error(`${label}.institutionId conflicts with the PKU harvest`)
    }
    const programCode = nonEmptyString(entity.programCode, `${label}.programCode`)
    if (!/^[A-Z0-9]{6,8}$/u.test(programCode)) {
      throw new Error(`${label}.programCode is invalid`)
    }
    const department = nonEmptyString(entity.department, `${label}.department`)
    const expectedEntityKey = pkuProgramEntityKey(department, programCode)
    const entityKey = nonEmptyString(entity.entityKey, `${label}.entityKey`)
    if (entityKey !== expectedEntityKey) {
      throw new Error(
        `${label}.entityKey must be derived from department and programCode`,
      )
    }
    const entityCheckedAt = isoTimestamp(entity.sourceCheckedAt, `${label}.sourceCheckedAt`)
    if (entityCheckedAt !== checkedAt) {
      throw new Error(`${label}.sourceCheckedAt conflicts with the PKU harvest`)
    }
    const entityUrl = pkuMasterChinesePdfUrl(
      entity.officialUrl,
      indexUrl,
      `${label}.officialUrl`,
    )
    if (quarantinedPrefixUrls.has(entityUrl)) {
      throw new Error(`${label}.officialUrl is quarantined for catalog_prefix_mismatch`)
    }
    const evidence = asRecord(entity.evidence, `${label}.evidence`)
    const evidenceUrl = pkuMasterChinesePdfUrl(
      evidence.officialUrl,
      indexUrl,
      `${label}.evidence.officialUrl`,
    )
    if (evidenceUrl !== entityUrl) {
      throw new Error(`${label}.evidence.officialUrl conflicts with the program PDF`)
    }
    const evidenceCheckedAt = isoTimestamp(
      evidence.checkedAt,
      `${label}.evidence.checkedAt`,
    )
    if (evidenceCheckedAt !== checkedAt) {
      throw new Error(`${label}.evidence.checkedAt conflicts with the PKU harvest`)
    }
    return {
      entityType: 'program',
      entityKey,
      institutionId: 'uni-peking-university',
      programType: 'degree',
      degreeLevel: 'master',
      nameZh: nonEmptyString(entity.name, `${label}.name`),
      officialUrl: entityUrl,
      sourceCheckedAt: entityCheckedAt,
      evidence: {
        locatorType: 'pdf_page',
        locator: pkuPdfLocator(evidence, programCode, `${label}.evidence`),
        quote: nonEmptyString(evidence.quote, `${label}.evidence.quote`),
        officialUrl: evidenceUrl,
        checkedAt: evidenceCheckedAt,
      },
    }
  })

  return {
    format: 'studyinchina.official-entities',
    formatVersion: 1,
    checkedAt,
    source: {
      title: "Peking University Official Master's Program Catalog (Chinese)",
      publisher: 'Peking University',
      reviewedBy: PKU_PDF_DIRECTORY_PARSER_VERSION,
      languageCode: 'zh',
      officialHosts: ['admission.pku.edu.cn'],
    },
    entities,
  }
}

function adaptZjuPdfHarvest(root: JsonRecord): JsonRecord {
  if (root.sourceType !== 'official_pdf') {
    throw new Error('ZJU PDF harvest sourceType must be official_pdf')
  }
  const institutionId = nonEmptyString(root.institutionId, 'input.institutionId')
  if (institutionId !== 'uni-zhejiang-university') {
    throw new Error('ZJU PDF harvest institutionId must be uni-zhejiang-university')
  }
  const checkedAt = isoTimestamp(root.checkedAt, 'input.checkedAt')
  const degreeLevel = nonEmptyString(root.degreeLevel, 'input.degreeLevel')
  if (!DEGREE_LEVELS.has(degreeLevel)) {
    throw new Error('ZJU PDF harvest degreeLevel is unsupported')
  }
  const instructionLanguage = nonEmptyString(
    root.instructionLanguage,
    'input.instructionLanguage',
  )
  if (!INSTRUCTION_LANGUAGES.has(instructionLanguage)) {
    throw new Error('ZJU PDF harvest instructionLanguage is unsupported')
  }
  const sourceUrl = zjuOfficialUrl(root.officialUrl, 'input.officialUrl')
  const entities = array(root.entities, 'input.entities')
  const reconciliation = asRecord(root.reconciliation, 'input.reconciliation')
  const verifiedRows = integer(
    reconciliation.verifiedRows,
    'input.reconciliation.verifiedRows',
  )
  if (verifiedRows !== entities.length) {
    throw new Error('ZJU PDF harvest verifiedRows does not equal entities.length')
  }

  return {
    format: 'studyinchina.official-entities',
    formatVersion: 1,
    checkedAt,
    source: {
      title:
        `Zhejiang University Official ${degreeLevel} Program Catalog (${instructionLanguage})`,
      publisher: 'Zhejiang University',
      reviewedBy: ZJU_PDF_PARSER_VERSION,
      languageCode: instructionLanguage === 'English' ? 'en' : 'zh',
      officialHosts: ['zju.edu.cn'],
    },
    entities: entities.map((value, index) => {
      const label = `input.entities[${index}]`
      const entity = asRecord(value, label)
      if (
        entity.entityType !== 'program'
        || entity.programType !== 'degree'
        || entity.verificationStatus !== 'verified'
      ) {
        throw new Error(`${label} must be a verified degree program`)
      }
      if (entity.institutionId !== institutionId) {
        throw new Error(`${label}.institutionId conflicts with the harvest`)
      }
      if (entity.degreeLevel !== degreeLevel) {
        throw new Error(`${label}.degreeLevel conflicts with the harvest`)
      }
      if (entity.instructionLanguage !== instructionLanguage) {
        throw new Error(`${label}.instructionLanguage conflicts with the harvest`)
      }
      const entityCheckedAt = isoTimestamp(entity.sourceCheckedAt, `${label}.sourceCheckedAt`)
      if (entityCheckedAt !== checkedAt) {
        throw new Error(`${label}.sourceCheckedAt conflicts with the harvest`)
      }
      const entityUrl = zjuOfficialUrl(entity.officialUrl, `${label}.officialUrl`)
      if (entityUrl !== sourceUrl) {
        throw new Error(`${label}.officialUrl conflicts with the official PDF URL`)
      }
      const evidence = asRecord(entity.evidence, `${label}.evidence`)
      const evidenceUrl = zjuOfficialUrl(
        evidence.officialUrl,
        `${label}.evidence.officialUrl`,
      )
      if (evidenceUrl !== sourceUrl) {
        throw new Error(`${label}.evidence.officialUrl conflicts with the official PDF URL`)
      }
      const evidenceCheckedAt = isoTimestamp(
        evidence.checkedAt,
        `${label}.evidence.checkedAt`,
      )
      if (evidenceCheckedAt !== checkedAt) {
        throw new Error(`${label}.evidence.checkedAt conflicts with the harvest`)
      }
      const name = nonEmptyString(entity.name, `${label}.name`)
      return {
        entityType: 'program',
        entityKey: nonEmptyString(entity.entityKey, `${label}.entityKey`),
        institutionId,
        programType: 'degree',
        degreeLevel,
        ...(instructionLanguage === 'English' ? { nameEn: name } : { nameZh: name }),
        officialUrl: entityUrl,
        sourceCheckedAt: entityCheckedAt,
        evidence: {
          locatorType: 'pdf_region',
          locator: zjuPdfLocator(evidence, `${label}.evidence`),
          quote: nonEmptyString(evidence.quote, `${label}.evidence.quote`),
          officialUrl: evidenceUrl,
          checkedAt: evidenceCheckedAt,
        },
      }
    }),
  }
}

function scholarshipHosts(institutionId: string, label: string): readonly string[] {
  const hosts = SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS[institutionId]
  if (!hosts) throw new Error(`${label} is not one of the six allowlisted institutions`)
  return hosts
}

function materializedScholarshipScheme(value: unknown, label: string): string {
  const scheme = nonEmptyString(value, label)
  if (!SCHOLARSHIP_SCHEME_TYPES.has(scheme)) {
    throw new Error(`${label} is unsupported`)
  }
  return scheme === 'government' || scheme === 'university' ? scheme : 'other'
}

function adaptScholarshipIndexHarvest(root: JsonRecord): JsonRecord {
  const sourceMode = nonEmptyString(root.sourceMode, 'input.sourceMode')
  if (!SCHOLARSHIP_SOURCE_MODES.has(sourceMode)) {
    throw new Error('Scholarship index harvest sourceMode is unsupported')
  }
  const checkedAt = isoTimestamp(root.checkedAt, 'input.checkedAt')
  const entities = array(root.entities, 'input.entities')
  const verifiedCandidateCount = integer(
    root.verifiedCandidateCount,
    'input.verifiedCandidateCount',
  )
  if (verifiedCandidateCount !== entities.length) {
    throw new Error(
      'Scholarship index harvest verifiedCandidateCount does not equal entities.length',
    )
  }
  for (const [index, value] of array(root.sources, 'input.sources').entries()) {
    const source = asRecord(value, `input.sources[${index}]`)
    const institutionId = nonEmptyString(
      source.institutionId,
      `input.sources[${index}].institutionId`,
    )
    exactOfficialUrl(
      source.officialUrl,
      scholarshipHosts(institutionId, `input.sources[${index}].institutionId`),
      `input.sources[${index}].officialUrl`,
    )
  }
  for (const [index, value] of array(
    root.institutionsCovered,
    'input.institutionsCovered',
  ).entries()) {
    const institutionId = nonEmptyString(value, `input.institutionsCovered[${index}]`)
    scholarshipHosts(institutionId, `input.institutionsCovered[${index}]`)
  }

  return {
    format: 'studyinchina.official-entities',
    formatVersion: 1,
    checkedAt,
    source: {
      title: 'Official Scholarship Index Harvest',
      reviewedBy: 'scholarship-index-harvester',
      languageCode: 'other',
      officialHosts: [],
    },
    entities: entities.map((value, index) => {
      const label = `input.entities[${index}]`
      const entity = asRecord(value, label)
      if (entity.entityType !== 'scholarship') {
        throw new Error(`${label}.entityType must be scholarship`)
      }
      const institutionId = nonEmptyString(entity.institutionId, `${label}.institutionId`)
      const hosts = scholarshipHosts(institutionId, `${label}.institutionId`)
      const entityCheckedAt = isoTimestamp(entity.sourceCheckedAt, `${label}.sourceCheckedAt`)
      if (entityCheckedAt !== checkedAt) {
        throw new Error(`${label}.sourceCheckedAt conflicts with the harvest`)
      }
      const evidence = asRecord(entity.evidence, `${label}.evidence`)
      const evidenceCheckedAt = isoTimestamp(
        evidence.checkedAt,
        `${label}.evidence.checkedAt`,
      )
      if (evidenceCheckedAt !== checkedAt) {
        throw new Error(`${label}.evidence.checkedAt conflicts with the harvest`)
      }
      return {
        entityType: 'scholarship',
        entityKey: nonEmptyString(entity.entityKey, `${label}.entityKey`),
        providerOrganizationId: institutionId,
        schemeType: materializedScholarshipScheme(
          entity.schemeType,
          `${label}.schemeType`,
        ),
        nameZh: nullableString(entity.nameZh, `${label}.nameZh`),
        nameEn: nullableString(entity.nameEn, `${label}.nameEn`),
        officialUrl: exactOfficialUrl(entity.officialUrl, hosts, `${label}.officialUrl`),
        sourceCheckedAt: entityCheckedAt,
        evidence: {
          locator: nonEmptyString(evidence.locator, `${label}.evidence.locator`),
          quote: nonEmptyString(evidence.quote, `${label}.evidence.quote`),
          officialUrl: exactOfficialUrl(
            evidence.officialUrl,
            hosts,
            `${label}.evidence.officialUrl`,
          ),
          checkedAt: evidenceCheckedAt,
        },
      }
    }),
  }
}

function looksLikeScholarshipIndexHarvest(root: JsonRecord): boolean {
  return (
    typeof root.sourceMode === 'string'
    && root.verifiedCandidateCount !== undefined
    && root.sources !== undefined
    && root.institutionsCovered !== undefined
  )
}

export function adaptOfficialEntityInput(input: unknown): JsonRecord {
  const root = asRecord(input, 'input')
  if (root.parserVersion === PKU_PDF_DIRECTORY_PARSER_VERSION) {
    return adaptPkuPdfDirectoryHarvest(root)
  }
  if (root.parserVersion === ZJU_PDF_PARSER_VERSION) return adaptZjuPdfHarvest(root)
  if (looksLikeScholarshipIndexHarvest(root)) return adaptScholarshipIndexHarvest(root)
  return root
}

export function officialEntityInputDocuments(input: unknown): JsonRecord[] {
  const inputs = Array.isArray(input) ? input : [input]
  if (inputs.length === 0) throw new Error('at least one official entity input is required')
  return inputs.map(adaptOfficialEntityInput)
}

function flagValues(args: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    values.push(value)
    index += 1
  }
  return values
}

export function resolveOfficialEntityInputPaths(
  args: readonly string[],
  cwd = process.cwd(),
): string[] {
  const explicitInputs = flagValues(args, '--input')
  const inputDirectories = flagValues(args, '--input-directory')
  if (inputDirectories.length > 1) {
    throw new Error('--input-directory may be provided only once')
  }
  if (explicitInputs.length > 0 && inputDirectories.length > 0) {
    throw new Error('use repeated --input or one --input-directory, not both')
  }
  if (explicitInputs.length === 0 && inputDirectories.length === 0) {
    throw new Error('at least one --input or --input-directory is required')
  }
  if (explicitInputs.length > 0) {
    return explicitInputs.map((value) => {
      const path = resolve(cwd, value)
      if (!existsSync(path) || !statSync(path).isFile()) {
        throw new Error(`Input file does not exist: ${path}`)
      }
      return path
    })
  }

  const directory = resolve(cwd, inputDirectories[0]!)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Input directory does not exist: ${directory}`)
  }
  const paths = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
    .map((entry) => resolve(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en'))
  if (paths.length === 0) throw new Error(`Input directory contains no JSON files: ${directory}`)
  return paths
}
