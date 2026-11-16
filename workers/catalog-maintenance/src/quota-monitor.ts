import { WorkerEntrypoint } from 'cloudflare:workers'
import type { MaintenanceEnv } from './types'
import { readQuotaSnapshot } from './quota-monitor-reader'
import { readRefillStatus } from './refill-client'
export { readQuotaSnapshot } from './quota-monitor-reader'

/** Same-account named RPC exposes bounded read-only observations, not model execution.
 * https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/ */
export class MaintenanceMonitor extends WorkerEntrypoint<MaintenanceEnv> {
  readQuota() { return readQuotaSnapshot(this.env) }
  readRefill() { return readRefillStatus(this.env) }
}
