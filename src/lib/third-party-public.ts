import type { ThirdPartyProgram } from './third-party-programs'

/** Explicit projection prevents source evidence blobs or private receipt paths leaking through structural casts. */
export function publicThirdPartyProgram(program: ThirdPartyProgram, detail = false) {
  const fields = program.fields || {}
  return {
    id: program.id,
    provider: program.provider,
    sourceId: program.sourceId,
    schoolId: program.schoolId,
    schoolName: program.schoolName,
    name: program.name,
    sourceUrl: program.sourceUrl,
    sourceUpdatedAt: program.sourceUpdatedAt,
    fetchedAt: program.fetchedAt,
    status: program.status,
    official: false,
    admissionYear: null,
    ...(detail ? { evidenceHash: program.evidenceHash, fieldSources: program.fieldSources } : {}),
    fields: {
      degree: fields.degree,
      language: fields.language,
      duration: fields.duration,
      startDate: fields.startDate,
      deadline: fields.deadline,
      tuition: fields.tuition,
      applicationFee: fields.applicationFee,
      providerServiceFee: fields.providerServiceFee,
      ...(detail ? {
        requirements: fields.requirements,
        materials: fields.materials,
        description: fields.description,
        fees: fields.fees,
      } : {}),
    },
  }
}
