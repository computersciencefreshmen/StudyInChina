export function programWithdrawalReason(record: {
  id: string
  name: string
  schoolId: string
  provider: string
}): 'withdrawn_listing' | 'test_listing' | 'administrative_service' | null
