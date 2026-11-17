import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FEED_BRANCH, emptyProgress, loadProgramFeed, writeProgramFeed } from './program-catalog-feed.mjs'

export function seedProgramCatalogFeed({ feedDir, contentDirectory = resolve('content/third-party') }) {
  const root = resolve(feedDir)
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (resolve(git(['rev-parse', '--show-toplevel'])) !== root || git(['branch', '--show-current']) !== FEED_BRANCH) throw new Error('feed_seed_checkout_invalid')
  if (existsSync(join(root, 'manifest.json'))) throw new Error('feed_already_seeded')
  const directory = JSON.parse(readFileSync(join(contentDirectory, 'directory.json'), 'utf8'))
  const details = JSON.parse(readFileSync(join(contentDirectory, 'details.json'), 'utf8'))
  const schools = new Map(directory.schools.map(school => [school.id, school]))
  const captured = new Map(details.programs.map(program => [program.id, program]))
  const records = directory.programs.map(([id, schoolId, name, sourceUrl, sourceUpdatedAt]) => {
    if (captured.has(id)) return captured.get(id)
    const school = schools.get(schoolId)
    if (!school) throw new Error('feed_seed_school_invalid')
    return { id, provider: school.provider, sourceId: id.replace(/^[^-]+-/, ''), schoolId, schoolName: school.name,
      name, sourceUrl, ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}), status: 'link_only', official: false, admissionYear: null, fields: {} }
  })
  writeFileSync(join(root, 'vercel.json'), JSON.stringify({ git: { deploymentEnabled: false } }) + '\n')
  const manifest = writeProgramFeed(root, { records, state: emptyProgress(), generatedAt: new Date().toISOString() })
  loadProgramFeed(root)
  return { revision: manifest.revision, counts: manifest.counts, branch: FEED_BRANCH, committed: false, pushed: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), at = args.indexOf('--feed-dir')
  if (!args.includes('--execute') || at < 0 || !args[at + 1]) throw new Error('Usage: node seed-program-catalog-feed.mjs --execute --feed-dir <precreated-data-branch-checkout>')
  console.log(JSON.stringify(seedProgramCatalogFeed({ feedDir: args[at + 1] })))
}
