/** Cloudflare's numeric 7500 is not specific to daily D1 quota exhaustion.
 * Require an explicit daily/per-day allowance and exhausted-limit wording. */
export function isDailyD1QuotaError(error:unknown):boolean{
  const message=error instanceof Error?error.message:String(error)
  return /\b(?:daily|per[ -]day)\b/iu.test(message)
    && /\b(?:quota|limit|allowance|maximum)\b/iu.test(message)
    && /\b(?:exceed(?:ed|s)?|exhaust(?:ed)?|reach(?:ed)?)\b/iu.test(message)
    && /\b(?:D1|database|rows?|reads?|writes?|queries)\b/iu.test(message)
}
export function backendErrorKind(error:unknown):'daily_quota'|'sql_error'|'backend_error'{
  if(isDailyD1QuotaError(error))return'daily_quota'
  const message=error instanceof Error?error.message:String(error)
  return /no such (?:table|column)|syntax error|SQLITE_|too many (?:SQL variables|queries|parameters)|(?:SQL|query|statement).{0,50}(?:error|invalid|limit)/iu.test(message)?'sql_error':'backend_error'
}
export const backendState=(error:unknown):'quota_wait'|'backend_unavailable'=>isDailyD1QuotaError(error)?'quota_wait':'backend_unavailable'
