import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync,readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

const verifier = join(process.cwd(), 'scripts', 'cloudflare', 'verify-restored-d1.mjs')
const temporaryDirectories: string[] = []

function catalogFixture(declaredCycles: number) {
  const root = mkdtempSync(join(tmpdir(), 'studyinchina-local-d1-verify-'))
  temporaryDirectories.push(root)
  const stateDirectory = join(root, 'state', 'nested')
  mkdirSync(stateDirectory, { recursive: true })
  const databasePath = join(stateDirectory, 'catalog.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE catalog_releases (
      release_id TEXT PRIMARY KEY,
      release_status TEXT NOT NULL,
      data_date TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      counts_json TEXT NOT NULL
    );
    CREATE TABLE release_pointer (singleton_id INTEGER PRIMARY KEY, current_release_id TEXT);
    CREATE TABLE catalog_records (id TEXT PRIMARY KEY);
    CREATE TABLE institutions (release_id TEXT NOT NULL);
    CREATE TABLE programs (release_id TEXT NOT NULL);
    CREATE TABLE program_cycles (release_id TEXT NOT NULL);
    CREATE TABLE scholarships (release_id TEXT NOT NULL);
    CREATE TABLE search_documents (id INTEGER PRIMARY KEY);
    CREATE TABLE search_fts (id INTEGER PRIMARY KEY);
    CREATE TRIGGER validate_catalog_record
    BEFORE INSERT ON catalog_records
    WHEN NEW.id = ''
    BEGIN
      SELECT RAISE(ABORT, 'id is required');
    END;
    INSERT INTO catalog_releases VALUES (
      'release-1',
      'active',
      '2026-08-10',
      '2026-08-10T00:00:00.000Z',
      '{"universities":1,"programs":1,"admissionCycles":${declaredCycles},"scholarships":1}'
    );
    INSERT INTO release_pointer VALUES (1, 'release-1');
    INSERT INTO institutions VALUES ('release-1');
    INSERT INTO programs VALUES ('release-1');
    INSERT INTO scholarships VALUES ('release-1');
    INSERT INTO search_documents VALUES (1);
    INSERT INTO search_fts VALUES (1);
  `)
  database.close()
  return stateDirectory
}

function runVerifier(stateDirectory: string,kind='catalog') {
  const env = { ...process.env }
  delete env.CLOUDFLARE_API_TOKEN
  delete env.CLOUDFLARE_ACCOUNT_ID
  delete env.CLOUDFLARE_D1_BACKUP_TOKEN
  delete env.CLOUDFLARE_D1_RESTORE_TOKEN
  return spawnSync(
    process.execPath,
    ['--no-warnings', verifier, stateDirectory, kind],
    { encoding: 'utf8', env },
  )
}

function pipelineFixture(mode:'complete'|'legacy'|'empty'|'bad-ack'|'orphan'='complete'){
  const root=mkdtempSync(join(tmpdir(),'studyinchina-pipeline-restore-'));temporaryDirectories.push(root)
  const database=new DatabaseSync(join(root,'pipeline.sqlite'))
  for(const name of ['records','source_documents','claims','ingestion_sources','ingestion_jobs','ingestion_snapshots','ingestion_candidates'])database.exec(`CREATE TABLE ${name}(id TEXT PRIMARY KEY)`)
  database.exec("CREATE TRIGGER validate_records BEFORE INSERT ON records WHEN NEW.id='' BEGIN SELECT RAISE(ABORT,'id required'); END;")
  if(mode!=='legacy')database.exec(readFileSync(join(process.cwd(),'infra/d1/pipeline/migrations/0019_catalog_maintenance.sql'),'utf8'))
  if(mode!=='legacy'&&mode!=='empty'){
    const hash='a'.repeat(64),now='2026-10-25T00:00:00.000Z'
    database.prepare('INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,seed_complete,targets_complete,updated_at) VALUES(1,?,?,?,?,1,1,?)').run(hash,hash,hash,hash,now)
    for(let index=0;index<272;index++)database.prepare("INSERT INTO maintenance_schools VALUES(?,'{}','{}',?,NULL)").run(`uni-${index}`,hash)
    database.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES('source','https://test.edu.cn','[\"test.edu.cn\"]','current_guide',1,168,?)").run(now)
    database.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at) VALUES('job','source','maintain','unknown',?,?,?)").run(now,now,now)
    database.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,'attempt','source',?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(hash,hash,hash,now)
    const ack=JSON.stringify({batchId:'published-batch',outcome:'published',sourceCommit:'b'.repeat(40),receiptSha256:hash,newInputCatalogSha256:hash,acceptedProposalIds:['proposal'],heldProposalIds:[],deploymentId:'dpl_verified',stableProofSha256:hash})
    database.prepare("INSERT INTO maintenance_exports VALUES('published-batch',?,?,?, ?,?,'published',?,?)").run(hash,hash,'maintenance/exports/proof.json',hash,now,mode==='bad-ack'?'c'.repeat(64):createHash('sha256').update(ack).digest('hex'),ack)
    if(mode==='orphan')database.exec('DELETE FROM maintenance_control')
  }
  database.close();return root
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('isolated D1 restore verifier', () => {
  it('restores maintenance unknown reservations and publication receipts without clearing or replaying them',()=>{
    const result=runVerifier(pipelineFixture(),'pipeline');expect(result.status,result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).maintenance).toMatchObject({seedComplete:true,schools:272,jobs:[{status:'unknown',count:1}],modelAttempts:[{status:'unknown',count:1}],exports:[{status:'published',count:1}],evidenceObjectsVerified:false,durableObjectReservationsVerified:false})
  })
  it('reports legitimate unseeded/old core recovery without pretending maintenance recovery was proved',()=>{
    const result=runVerifier(pipelineFixture('empty'),'pipeline');expect(result.status,result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).maintenance).toMatchObject({state:'not_initialized',resumable:false,checkpointValidated:false})
  })
  it.each(['legacy','bad-ack','orphan']as const)('fails closed for %s maintenance recovery proof',mode=>{
    const result=runVerifier(pipelineFixture(mode),'pipeline');expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/missing core table|publication acknowledgement failed|state exists without its control/)
  })
  it('accepts a zero-cycle release when the versioned count contract declares zero', () => {
    const result = runVerifier(catalogFixture(0))
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).currentRelease).toMatchObject({
      id: 'release-1',
      institutions: 1,
      programs: 1,
      programCycles: 0,
      scholarships: 1,
    })
  })

  it('fails closed when restored rows disagree with the release count contract', () => {
    const result = runVerifier(catalogFixture(1))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Catalog current release program_cycles count mismatch: expected 1, restored 0',
    )
  })
})
