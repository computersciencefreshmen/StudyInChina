import { REVIEW_RESPONSE_CONTRACT } from './minimax-translation-provider.ts'
export const CANARY_REVIEW_CONTRACT = REVIEW_RESPONSE_CONTRACT
export const SAMPLES = [
  { id: 'sicas-243', schoolId: 'sicas-220', field: 'requirements', sourceHash: 'a15494bae3247e491bb796630aa34e76da79294d14da6e331e89ff73404bd328' },
  { id: 'sicas-4074', schoolId: 'sicas-199', field: 'requirements', sourceHash: 'f5cf64c3c03f59978992c354cd8316a6afe2ce66bd980d827959a155396c304d' },
  { id: 'sicas-28538', schoolId: 'sicas-362', field: 'materials', sourceHash: 'abfd32b16dc8d8bc392e79f9548b4a5f84c8b80e51f16755b6c1f2e84e70b4ad' },
  { id: 'program-xiamen-university-bachelor-chinese-020302', schoolId: 'uni-xiamen-university', field: 'title', sourceHash: 'a61c807dcd642fce7950deb21b9dac21224bb9ebc9481821999a2dca55b51dc7',
    referenceEnglishTitle: 'Financial Engineering', referenceUrl: 'https://admissions.xmu.edu.cn/Programs/Chinese_Medium_Bachelor_s.htm', programCode: '020302' },
]

export function manualCanaryRetryContext(environment) {
  if (environment.CANARY_RETRY_LEGACY_FAILED !== 'true' || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || environment.GITHUB_REF !== 'refs/heads/main' || !/^\d+$/.test(environment.GITHUB_RUN_ID || '')
    || !/^\d+$/.test(environment.GITHUB_RUN_ATTEMPT || '')) throw new Error('translation_canary_retry_manual_main_required')
  return { contract: CANARY_REVIEW_CONTRACT, runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT }
}
