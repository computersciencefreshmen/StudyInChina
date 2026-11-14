declare module 'cloudflare:workers' {
  export class WorkerEntrypoint<Env = unknown> {
    protected env: Env
    protected ctx: unknown
    constructor(ctx: unknown, env: Env)
  }
}
