// Keep confirmed withdrawals effective when an older feed or bundled fallback is read.
const withdrawn = new Set([
  'sicas-27165', 'sicas-27166', 'sicas-27167', 'sicas-27170', 'sicas-27171',
  'sicas-27172', 'sicas-27173', 'sicas-27174', 'sicas-27169', 'sicas-28797',
])

export function programWithdrawalReason(record) {
  if (withdrawn.has(record.id)) return 'withdrawn_listing'
  const name = record.name.normalize('NFKC').trim()
  if (/^test\s*\d+$/iu.test(name)) return 'test_listing'
  if (record.provider === 'SICAS' && record.schoolId === 'sicas-352'
      && /^extension letter(?: from university)?$/iu.test(name)) return 'administrative_service'
  return null
}
