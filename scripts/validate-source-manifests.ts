import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  SOURCE_CATEGORIES,
  sourceManifestSchema,
} from '../workers/ingestion/src/manifest-schema'
import { validateManifest } from '../workers/ingestion/src/security'
import type {
  SourceCategory,
  SourceManifestV1,
} from '../workers/ingestion/src/types'

export { SOURCE_CATEGORIES, sourceManifestSchema }

const EXPECTED_CATALOG_STATUS = {
  'uni-tsinghua-university': 'existing',
  'uni-peking-university': 'existing',
  'uni-fudan-university': 'existing',
  'uni-shanghai-jiao-tong-university': 'existing',
  'uni-zhejiang-university': 'existing',
  'uni-university-of-science-and-technology-of-china': 'planned_addition',
  'uni-nanjing-university': 'existing',
  'uni-wuhan-university': 'existing',
  'uni-sun-yat-sen-university': 'existing',
  'uni-harbin-institute-of-technology': 'existing',
} as const

const LOCKED_EXISTING_CATALOG_SIZE = 40
const RESERVED_USTC_ID =
  'uni-university-of-science-and-technology-of-china'

export const EXPECTED_PILOT_INSTITUTION_IDS = Object.keys(
  EXPECTED_CATALOG_STATUS,
) as Array<keyof typeof EXPECTED_CATALOG_STATUS>

export const INSTITUTION_HOST_ALLOWLISTS: Record<
  keyof typeof EXPECTED_CATALOG_STATUS,
  readonly string[]
> = {
  'uni-tsinghua-university': [
    'international.join-tsinghua.edu.cn',
    'apply.join-tsinghua.edu.cn',
    'yz.tsinghua.edu.cn',
    'yzbm.tsinghua.edu.cn',
  ],
  'uni-peking-university': [
    'www.isd.pku.edu.cn',
    'isd.pku.edu.cn',
    'www.studyatpku.com',
    'admission.pku.edu.cn',
  ],
  'uni-fudan-university': [
    'iso.fudan.edu.cn',
    'istudent.fudan.edu.cn',
  ],
  'uni-shanghai-jiao-tong-university': [
    'isc.sjtu.edu.cn',
    'apply.sjtu.edu.cn',
  ],
  'uni-zhejiang-university': [
    'iczu.zju.edu.cn',
    'intlstudent.zju.edu.cn',
  ],
  'uni-university-of-science-and-technology-of-china': [
    'ic.ustc.edu.cn',
    'isa.ustc.edu.cn',
  ],
  'uni-nanjing-university': [
    'hwxy.nju.edu.cn',
    'istudy.nju.edu.cn',
    'nju.17gz.org',
  ],
  'uni-wuhan-university': ['en.whu.edu.cn', 'admission.whu.edu.cn'],
  'uni-sun-yat-sen-university': ['iso.sysu.edu.cn', 'apply.sysu.edu.cn'],
  'uni-harbin-institute-of-technology': [
    'studyathit.hit.edu.cn',
    'hit.at0086.cn',
  ],
}

const coverageSchema = z
  .object({
    sourceCategory: z.enum(SOURCE_CATEGORIES),
    status: z.enum([
      'registered',
      'parser_pending',
      'source_unavailable',
      'discovery_pending',
      'officially_not_provided',
    ]),
    sourceIds: z.array(z.string().min(1)).optional(),
    note: z.string().min(1).optional(),
  })
  .strict()

export const pilotSourceManifestSchema = z
  .object({
    version: z.literal(1),
    institutionId: z.string().min(1),
    catalogStatus: z.enum(['existing', 'planned_addition']),
    checkedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
        message: 'checkedAt must be a real ISO calendar date',
      }),
    sources: z.array(sourceManifestSchema).min(1),
    coverage: z.array(coverageSchema).length(SOURCE_CATEGORIES.length),
  })
  .strict()

export type PilotSourceManifest = z.infer<typeof pilotSourceManifestSchema>

export type LoadedPilotSourceManifest = {
  filePath: string
  value: unknown
}

function errorMessage(filePath: string, message: string): string {
  return `${basename(filePath)}: ${message}`
}

export function loadPilotSourceManifestFiles(
  directory = join(process.cwd(), 'content', 'source-manifests', 'pilot'),
): LoadedPilotSourceManifest[] {
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const filePath = join(directory, fileName)
      return {
        filePath,
        value: JSON.parse(readFileSync(filePath, 'utf8')) as unknown,
      }
    })
}

export function validatePilotSourceManifests(
  inputs: LoadedPilotSourceManifest[],
): PilotSourceManifest[] {
  const errors: string[] = []
  const records: PilotSourceManifest[] = []

  for (const input of inputs) {
    const parsed = pilotSourceManifestSchema.safeParse(input.value)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(
          errorMessage(
            input.filePath,
            `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          ),
        )
      }
      continue
    }
    records.push(parsed.data)
  }

  const expectedIds = new Set<string>(EXPECTED_PILOT_INSTITUTION_IDS)
  const actualIds = new Set(records.map((record) => record.institutionId))
  if (records.length !== EXPECTED_PILOT_INSTITUTION_IDS.length) {
    errors.push(
      `Expected ${EXPECTED_PILOT_INSTITUTION_IDS.length} pilot manifests, found ${records.length}`,
    )
  }
  for (const institutionId of EXPECTED_PILOT_INSTITUTION_IDS) {
    if (!actualIds.has(institutionId)) errors.push(`Missing pilot institution: ${institutionId}`)
  }
  for (const institutionId of actualIds) {
    if (!expectedIds.has(institutionId)) errors.push(`Unexpected pilot institution: ${institutionId}`)
  }

  const institutionIds = new Set<string>()
  const sourceIds = new Map<string, string>()
  for (const record of records) {
    const filePath =
      inputs.find(
        (input) =>
          typeof input.value === 'object' &&
          input.value !== null &&
          'institutionId' in input.value &&
          input.value.institutionId === record.institutionId,
      )?.filePath ?? record.institutionId

    if (institutionIds.has(record.institutionId)) {
      errors.push(errorMessage(filePath, `duplicate institutionId ${record.institutionId}`))
    }
    institutionIds.add(record.institutionId)

    const expectedStatus = EXPECTED_CATALOG_STATUS[
      record.institutionId as keyof typeof EXPECTED_CATALOG_STATUS
    ]
    if (!expectedStatus) {
      errors.push(errorMessage(filePath, `institutionId is outside the locked pilot set`))
      continue
    }
    if (record.catalogStatus !== expectedStatus) {
      errors.push(
        errorMessage(
          filePath,
          `catalogStatus must be ${expectedStatus} for ${record.institutionId}`,
        ),
      )
    }

    const approvedHosts = new Set(
      INSTITUTION_HOST_ALLOWLISTS[
        record.institutionId as keyof typeof EXPECTED_CATALOG_STATUS
      ],
    )
    const sourcesById = new Map(record.sources.map((source) => [source.id, source]))
    const coverageByCategory = new Map<SourceCategory, typeof record.coverage[number]>()

    for (const source of record.sources) {
      if (source.institutionId !== record.institutionId) {
        errors.push(
          errorMessage(filePath, `${source.id} has a mismatched institutionId`),
        )
      }
      if (sourceIds.has(source.id)) {
        errors.push(
          errorMessage(
            filePath,
            `duplicate source id ${source.id}; first seen in ${sourceIds.get(source.id)}`,
          ),
        )
      } else {
        sourceIds.set(source.id, basename(filePath))
      }

      try {
        validateManifest(source as SourceManifestV1)
      } catch (error) {
        errors.push(
          errorMessage(
            filePath,
            `${source.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      }

      const sourceHost = new URL(source.officialUrl).hostname.toLowerCase()
      if (!approvedHosts.has(sourceHost)) {
        errors.push(
          errorMessage(filePath, `${source.id} uses unapproved host ${sourceHost}`),
        )
      }
      for (const host of [
        ...source.allowedHosts,
        ...(source.allowedRedirectHosts ?? []),
      ]) {
        if (!approvedHosts.has(host.toLowerCase())) {
          errors.push(
            errorMessage(filePath, `${source.id} allowlists unapproved host ${host}`),
          )
        }
      }
    }

    for (const coverage of record.coverage) {
      if (coverageByCategory.has(coverage.sourceCategory)) {
        errors.push(
          errorMessage(
            filePath,
            `duplicate coverage category ${coverage.sourceCategory}`,
          ),
        )
      }
      coverageByCategory.set(coverage.sourceCategory, coverage)

      const hasKnownSource = [
        'registered',
        'parser_pending',
        'source_unavailable',
      ].includes(coverage.status)
      if (hasKnownSource) {
        if (!coverage.sourceIds?.length) {
          errors.push(
            errorMessage(
              filePath,
              `${coverage.sourceCategory} ${coverage.status} coverage requires sourceIds`,
            ),
          )
          continue
        }
        if (coverage.status === 'registered' && coverage.note !== undefined) {
          errors.push(
            errorMessage(
              filePath,
              `${coverage.sourceCategory} registered coverage must not include a note`,
            ),
          )
        }
        if (coverage.status !== 'registered' && !coverage.note) {
          errors.push(
            errorMessage(
              filePath,
              `${coverage.sourceCategory} ${coverage.status} coverage requires a note`,
            ),
          )
        }
        const seenCoverageSourceIds = new Set<string>()
        for (const sourceId of coverage.sourceIds) {
          if (seenCoverageSourceIds.has(sourceId)) {
            errors.push(
              errorMessage(filePath, `${coverage.sourceCategory} repeats ${sourceId}`),
            )
          }
          seenCoverageSourceIds.add(sourceId)
          const source = sourcesById.get(sourceId)
          if (!source) {
            errors.push(
              errorMessage(
                filePath,
                `${coverage.sourceCategory} references unknown source ${sourceId}`,
              ),
            )
          } else if (source.sourceCategory !== coverage.sourceCategory) {
            errors.push(
              errorMessage(
                filePath,
                `${sourceId} is ${source.sourceCategory}, not ${coverage.sourceCategory}`,
              ),
            )
          } else if (coverage.status !== 'registered' && source.enabled) {
            errors.push(
              errorMessage(
                filePath,
                `${sourceId} must be disabled while coverage is ${coverage.status}`,
              ),
            )
          } else if (coverage.status === 'registered' && !source.enabled) {
            errors.push(
              errorMessage(
                filePath,
                `${sourceId} is disabled and cannot claim registered coverage`,
              ),
            )
          }
        }
      } else {
        if (coverage.sourceIds !== undefined) {
          errors.push(
            errorMessage(
              filePath,
              `${coverage.sourceCategory} missing coverage must omit sourceIds`,
            ),
          )
        }
        if (!coverage.note) {
          errors.push(
            errorMessage(
              filePath,
              `${coverage.sourceCategory} missing coverage requires a note`,
            ),
          )
        }
      }
    }

    for (const category of SOURCE_CATEGORIES) {
      const coverage = coverageByCategory.get(category)
      if (!coverage) {
        errors.push(errorMessage(filePath, `missing coverage category ${category}`))
        continue
      }
      const categorySourceIds = record.sources
        .filter((source) => source.sourceCategory === category)
        .map((source) => source.id)
        .sort()
      const coveredSourceIds = [...(coverage.sourceIds ?? [])].sort()
      if (categorySourceIds.join('|') !== coveredSourceIds.join('|')) {
        errors.push(
          errorMessage(
            filePath,
            `${category} coverage must reference every and only source in that category`,
          ),
        )
      }
    }

    for (const requiredCategory of [
      'international_admissions_home',
      'application_portal',
    ] as const) {
      const requiredCoverage = coverageByCategory.get(requiredCategory)
      if (
        !requiredCoverage ||
        !['registered', 'parser_pending', 'source_unavailable'].includes(
          requiredCoverage.status,
        )
      ) {
        errors.push(
          errorMessage(
            filePath,
            `${requiredCategory} must have a confirmed official source for every pilot school`,
          ),
        )
      }
    }
  }

  const universities = JSON.parse(
    readFileSync(join(process.cwd(), 'content', 'data', 'universities.json'), 'utf8'),
  ) as Array<{ id?: unknown }>
  const catalogIds = new Set(
    universities
      .map((university) => university.id)
      .filter((id): id is string => typeof id === 'string'),
  )
  if (catalogIds.size !== LOCKED_EXISTING_CATALOG_SIZE) {
    errors.push(
      `universities.json must retain the locked ${LOCKED_EXISTING_CATALOG_SIZE}-institution catalog; found ${catalogIds.size}`,
    )
  }
  if (catalogIds.has(RESERVED_USTC_ID)) {
    errors.push(
      `${RESERVED_USTC_ID}: reserved planned_addition id must not appear in universities.json`,
    )
  }
  for (const record of records) {
    if (record.catalogStatus === 'existing' && !catalogIds.has(record.institutionId)) {
      errors.push(
        `${record.institutionId}: catalogStatus is existing but the institution is absent from universities.json`,
      )
    }
    if (
      record.catalogStatus === 'planned_addition' &&
      record.institutionId !== RESERVED_USTC_ID
    ) {
      errors.push(`${record.institutionId}: only the reserved USTC id may be planned_addition`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`Source manifest validation failed:\n${errors.join('\n')}`)
  }
  return records
}

export function validatePilotSourceManifestDirectory(
  directory?: string,
): PilotSourceManifest[] {
  return validatePilotSourceManifests(loadPilotSourceManifestFiles(directory))
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const records = validatePilotSourceManifestDirectory()
    const sourceCount = records.reduce((total, record) => total + record.sources.length, 0)
    console.log(
      `Validated ${records.length} pilot institution manifests and ${sourceCount} official sources.`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
