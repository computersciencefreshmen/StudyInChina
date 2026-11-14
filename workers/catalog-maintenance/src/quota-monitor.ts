import { WorkerEntrypoint } from 'cloudflare:workers'
import type { MaintenanceEnv } from './types'
import { readQuotaSnapshot } from './quota-monitor-reader'
export { readQuotaSnapshot } from './quota-monitor-reader'

/** Same-account named RPC has one read-only capability and no public HTTP route.
 * https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/ */
export class MaintenanceMonitor extends WorkerEntrypoint<MaintenanceEnv> {
  readQuota() { return readQuotaSnapshot(this.env) }
}
