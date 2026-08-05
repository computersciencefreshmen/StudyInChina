import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readlink, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export type UntrackedContentClass =
  | 'raw_evidence'
  | 'structured_candidate'
  | 'source_code'
  | 'test'
  | 'database_migration'
  | 'configuration'
  | 'documentation'
  | 'temporary'
  | 'symlink'
  | 'unclassified'

export type UntrackedSuggestedStatus =
  | 'private_r2_raw_evidence'
  | 'quarantine_candidate'
  | 'code_test_review'
  | 'temp_ignore'

export type UntrackedClassification = {
  contentClass: UntrackedContentClass
  suggestedStatus: UntrackedSuggestedStatus
  classificationReason: string
}

export type UntrackedInventoryEntry = UntrackedClassification & {
  path: string
  extension: string
  byteSize: number
  sha256: string
}

export type UntrackedInventory = {
  schemaVersion: 1
  generatedAt: string
  repositoryRoot: string
  summary: {
    totalFiles: number
    totalBytes: number
    byContentClass: Record<string, number>
    bySuggestedStatus: Record<string, number>
  }
  files: UntrackedInventoryEntry[]
}

type InventoryOptions = {
  repositoryPath: string
  excludedRepositoryPaths?: ReadonlySet<string>
  generatedAt?: string
}

type CliOptions = {
  repositoryPath: string
  outputPath: string
}

const CODE_EXTENSIONS = new Set([
  '.cjs', '.css', '.js', '.jsx', '.mjs', '.scss', '.sh', '.ps1', '.ts', '.tsx',
])
const CONFIG_EXTENSIONS = new Set([
  '.env', '.ini', '.jsonc', '.toml', '.yaml', '.yml',
])
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst'])
const RAW_EVIDENCE_EXTENSIONS = new Set([
  '.doc', '.docx', '.gif', '.htm', '.html', '.jpeg', '.jpg', '.pdf', '.png',
  '.tif', '.tiff', '.webp', '.xls', '.xlsx',
])

function normalizeRepositoryPath(filePath: string): string {
  return filePath.replaceAll('\\', '/')
}

function pathSegments(filePath: string): string[] {
  return normalizeRepositoryPath(filePath).toLowerCase().split('/').filter(Boolean)
}

function hasSegmentMatching(segments: string[], pattern: RegExp): boolean {
  return segments.some((segment) => pattern.test(segment))
}

export function classifyUntrackedPath(filePath: string): UntrackedClassification {
  const normalized = normalizeRepositoryPath(filePath)
  const lowerPath = normalized.toLowerCase()
  const segments = pathSegments(normalized)
  const baseName = segments.at(-1) ?? ''
  const extension = extname(baseName).toLowerCase()

  const isTemporary = baseName.startsWith('.tmp')
    || baseName.startsWith('~')
    || baseName.endsWith('~')
    || ['.bak', '.log', '.swp', '.temp', '.tmp'].includes(extension)
    || hasSegmentMatching(segments, /^(?:\.cache|\.next|coverage|temp|tmp)$/u)
  if (isTemporary) {
    return {
      contentClass: 'temporary',
      suggestedStatus: 'temp_ignore',
      classificationReason: 'Temporary output, cache, log, or editor artifact',
    }
  }

  const isTest = segments.includes('tests')
    || /(?:^|\.)test\.[^.]+$/u.test(baseName)
    || /(?:^|\.)spec\.[^.]+$/u.test(baseName)
  if (isTest) {
    return {
      contentClass: 'test',
      suggestedStatus: 'code_test_review',
      classificationReason: 'Test asset requires normal code review',
    }
  }

  const isCodeArea = ['.github', 'infra', 'scripts', 'src', 'workers'].includes(segments[0] ?? '')
    || lowerPath.startsWith('content/source-manifests/')
  if (isCodeArea || CODE_EXTENSIONS.has(extension)) {
    const contentClass: UntrackedContentClass = extension === '.sql'
      ? 'database_migration'
      : CONFIG_EXTENSIONS.has(extension)
        ? 'configuration'
        : DOCUMENT_EXTENSIONS.has(extension)
          ? 'documentation'
          : 'source_code'
    return {
      contentClass,
      suggestedStatus: 'code_test_review',
      classificationReason: 'Repository implementation or reviewed configuration asset',
    }
  }

  const hasRawEvidenceMarker = hasSegmentMatching(
    segments,
    /^(?:capture|captures|evidence|raw|snapshot|snapshots|screenshots?)$/u,
  )
  if (hasRawEvidenceMarker || RAW_EVIDENCE_EXTENSIONS.has(extension)) {
    return {
      contentClass: 'raw_evidence',
      suggestedStatus: 'private_r2_raw_evidence',
      classificationReason: 'Raw source evidence belongs in private R2 archival storage',
    }
  }

  const isQuarantineCandidate = segments.includes('quality')
    || segments.includes('claims')
    || segments.includes('completed')
    || hasSegmentMatching(segments, /^(?:minimax-(?:expansion|harvest|recapture)|pending|quarantined?.*)$/u)
    || lowerPath.startsWith('content/data/')
  if (isQuarantineCandidate || extension === '.json' || extension === '.jsonl') {
    return {
      contentClass: 'structured_candidate',
      suggestedStatus: 'quarantine_candidate',
      classificationReason: 'Structured data must pass validation before promotion',
    }
  }

  if (CONFIG_EXTENSIONS.has(extension)) {
    return {
      contentClass: 'configuration',
      suggestedStatus: 'code_test_review',
      classificationReason: 'Configuration asset requires normal code review',
    }
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      contentClass: 'documentation',
      suggestedStatus: 'code_test_review',
      classificationReason: 'Documentation asset requires normal review',
    }
  }

  return {
    contentClass: 'unclassified',
    suggestedStatus: 'quarantine_candidate',
    classificationReason: 'Unknown asset type defaults to quarantine for manual review',
  }
}

function runGit(repositoryPath: string, args: string[], encoding: BufferEncoding | 'buffer'): string | Buffer {
  const result = spawnSync('git', args, {
    cwd: repositoryPath,
    encoding: encoding === 'buffer' ? undefined : encoding,
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr ?? '')
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }
  return result.stdout ?? (encoding === 'buffer' ? Buffer.alloc(0) : '')
}

export function resolveRepositoryRoot(repositoryPath: string): string {
  return String(runGit(resolve(repositoryPath), ['rev-parse', '--show-toplevel'], 'utf8')).trim()
}

export function listUntrackedPaths(repositoryRoot: string): string[] {
  const stdout = runGit(
    repositoryRoot,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    'buffer',
  )
  return (stdout as Buffer)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepositoryPath)
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function resolveSafeRepositoryFile(repositoryRoot: string, repositoryPath: string): string {
  const absolutePath = resolve(repositoryRoot, repositoryPath)
  const relativePath = relative(repositoryRoot, absolutePath)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Refusing to read a path outside the repository: ${repositoryPath}`)
  }
  return absolutePath
}

async function sha256RegularFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

export async function createUntrackedInventoryEntry(
  repositoryRoot: string,
  repositoryPath: string,
): Promise<UntrackedInventoryEntry> {
  const normalizedPath = normalizeRepositoryPath(repositoryPath)
  const absolutePath = resolveSafeRepositoryFile(repositoryRoot, normalizedPath)
  const metadata = await lstat(absolutePath)
  const extension = extname(normalizedPath).toLowerCase() || '[none]'

  if (metadata.isSymbolicLink()) {
    const linkTarget = await readlink(absolutePath)
    return {
      path: normalizedPath,
      extension,
      byteSize: metadata.size,
      sha256: createHash('sha256').update(linkTarget, 'utf8').digest('hex'),
      contentClass: 'symlink',
      suggestedStatus: 'quarantine_candidate',
      classificationReason: 'Symlink target text hashed without following the link',
    }
  }
  if (!metadata.isFile()) {
    throw new Error(`Untracked path is not a regular file: ${normalizedPath}`)
  }

  return {
    path: normalizedPath,
    extension,
    byteSize: metadata.size,
    sha256: await sha256RegularFile(absolutePath),
    ...classifyUntrackedPath(normalizedPath),
  }
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1
}

export function assembleUntrackedInventory(
  repositoryRoot: string,
  files: UntrackedInventoryEntry[],
  generatedAt = new Date().toISOString(),
): UntrackedInventory {
  const byContentClass: Record<string, number> = {}
  const bySuggestedStatus: Record<string, number> = {}
  let totalBytes = 0

  for (const file of files) {
    totalBytes += file.byteSize
    increment(byContentClass, file.contentClass)
    increment(bySuggestedStatus, file.suggestedStatus)
  }

  return {
    schemaVersion: 1,
    generatedAt,
    repositoryRoot,
    summary: {
      totalFiles: files.length,
      totalBytes,
      byContentClass,
      bySuggestedStatus,
    },
    files,
  }
}

export async function buildUntrackedInventory(options: InventoryOptions): Promise<UntrackedInventory> {
  const repositoryRoot = resolveRepositoryRoot(options.repositoryPath)
  const excludedPaths = options.excludedRepositoryPaths ?? new Set<string>()
  const paths = listUntrackedPaths(repositoryRoot).filter((filePath) => !excludedPaths.has(filePath))
  const files: UntrackedInventoryEntry[] = []

  // Sequential hashing keeps disk pressure predictable on developer machines and CI runners.
  for (const filePath of paths) {
    files.push(await createUntrackedInventoryEntry(repositoryRoot, filePath))
  }
  return assembleUntrackedInventory(repositoryRoot, files, options.generatedAt)
}

function usage(): string {
  return `Usage: tsx scripts/quality/inventory-untracked-assets.ts --output <report.json> [--repo <path>]

Creates a read-only inventory of git-untracked files. The command only writes the
explicit JSON output file; it never deletes, moves, uploads, stages, or commits assets.

Options:
  --output <path>  Required JSON report path. Its parent directory must exist.
  --repo <path>    Repository or subdirectory to inspect (default: current directory).
  --help           Show this help.
`
}

export function parseInventoryArgs(argv: string[]): CliOptions {
  let repositoryPath = process.cwd()
  let outputPath = ''

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const nextValue = (): string => {
      index += 1
      if (index >= argv.length || argv[index].startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      return argv[index]
    }

    switch (argument) {
      case '--output':
        outputPath = nextValue()
        break
      case '--repo':
        repositoryPath = nextValue()
        break
      case '--help':
      case '-h':
        throw new Error(usage())
      default:
        throw new Error(`Unknown argument: ${argument}\n\n${usage()}`)
    }
  }

  if (!outputPath) throw new Error(`--output is required\n\n${usage()}`)
  if (extname(outputPath).toLowerCase() !== '.json') {
    throw new Error('--output must use a .json extension')
  }
  return { repositoryPath, outputPath }
}

function repositoryRelativePath(repositoryRoot: string, filePath: string): string | null {
  const relativePath = relative(repositoryRoot, filePath)
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null
  }
  return normalizeRepositoryPath(relativePath)
}

function assertOutputIsSafe(repositoryRoot: string, outputPath: string): string | null {
  const relativeOutputPath = repositoryRelativePath(repositoryRoot, outputPath)
  if (!relativeOutputPath) return null
  if (relativeOutputPath === '.git' || relativeOutputPath.startsWith('.git/')) {
    throw new Error('Refusing to write the report inside .git')
  }

  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', relativeOutputPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (tracked.status === 0) {
    throw new Error(`Refusing to overwrite a tracked repository file: ${relativeOutputPath}`)
  }
  return relativeOutputPath
}

export async function runUntrackedInventoryCli(argv: string[]): Promise<void> {
  const options = parseInventoryArgs(argv)
  const repositoryRoot = resolveRepositoryRoot(options.repositoryPath)
  const outputPath = resolve(options.outputPath)
  const relativeOutputPath = assertOutputIsSafe(repositoryRoot, outputPath)
  const excludedPaths = relativeOutputPath
    ? new Set([relativeOutputPath])
    : new Set<string>()
  const inventory = await buildUntrackedInventory({
    repositoryPath: repositoryRoot,
    excludedRepositoryPaths: excludedPaths,
  })

  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'w',
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runUntrackedInventoryCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `Untracked asset inventory failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 2
  })
}
