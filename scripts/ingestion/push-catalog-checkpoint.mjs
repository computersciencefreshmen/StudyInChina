import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BRANCH = 'catalog-program-feed'
const SHA = /^[a-f0-9]{40}$/
export const harvestPath = path => path === 'manifest.json' || /^(?:indexes|details|state|receipts)\//u.test(path)
const translationPath = path => path.startsWith('translations/')

// Normal fast-forward pushes are the single atomic publication boundary.
// If the other pipeline pushed while we computed, transplant only our local
// unpublished commit when every intervening path belongs to the other lane.
export function pushCatalogCheckpoint(git, lane) {
  for (let attempt = 0; ; attempt++) {
    try { git(['push', 'origin', `HEAD:refs/heads/${BRANCH}`]); return }
    catch (pushError) {
      if (attempt >= 2) throw pushError
      const base = git(['rev-parse', 'HEAD^']), local = git(['rev-parse', 'HEAD'])
      if (!SHA.test(base) || !SHA.test(local)) throw pushError
      git(['fetch', '--no-tags', 'origin', `refs/heads/${BRANCH}`])
      const remote = git(['rev-parse', 'FETCH_HEAD'])
      if (remote === local) return
      if (!SHA.test(remote) || remote === base || git(['status', '--porcelain', '--untracked-files=no'])) throw pushError
      git(['merge-base', '--is-ancestor', base, remote])
      const changes = git(['diff', '--no-renames', '--name-only', '-z', base, remote]).split('\0').filter(Boolean)
      const otherLane = lane === 'harvest' ? translationPath : harvestPath
      if (!changes.length || !changes.every(otherLane)) throw new Error('catalog_writer_namespace_conflict')
      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'rebase', '--no-autostash', '--onto', remote, base])
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lane = process.argv[2]
  if (!['harvest', 'translation'].includes(lane)) throw new Error('invalid_catalog_checkpoint_lane')
  pushCatalogCheckpoint(args => execFileSync('git', args, { encoding: 'utf8' }).trim(), lane)
}
