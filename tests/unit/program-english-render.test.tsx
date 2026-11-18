import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { AdmissionTrackCards } from '@/components/features/AdmissionTrackCards'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { localize } from '@/lib/data/format'
import { parseProgramCatalogFilters, selectProgramCatalogItems } from '@/lib/program-catalog'

const day = '2026-11-18'
const bundle = getPublicCatalogSnapshot(loadMaintenanceBundle(process.cwd()), day).directory
const program = bundle.programs.find(row => row.slug === 'xiamen-university-bachelor-chinese-020302')!

describe('English rendering of programmes published in Chinese', () => {
  it('finds Financial Engineering in either language under the same university and stable ID', () => {
    expect(localize(program.name, 'en')).toBe('Financial Engineering')
    expect(localize(program.name, 'zh')).toBe('金融工程')
    for (const q of ['Financial Engineering', '金融工程']) {
      const rows = selectProgramCatalogItems(bundle, parseProgramCatalogFilters({ q, institution: 'xiamen-university' }), day)
      expect(rows.map(row => row.program.id)).toContain(program.id)
    }
  })

  it('renders the HSK threshold and both alternatives in English while the Chinese version retains its source', () => {
    const props = { program, cycles: bundle.admissionCycles, sources: bundle.sources, today: day }
    const markup = renderToStaticMarkup(<AdmissionTrackCards {...props} locale="en" />)
    const container = document.createElement('div')
    container.innerHTML = markup
    const text = container.textContent
    expect(text).toMatch(/Level 5.*210/i)
    expect(text).toMatch(/language of instruction/i)
    expect(text).toContain('UEC')
    expect(text).not.toMatch(/\p{Script=Han}/u)
    expect(renderToStaticMarkup(<AdmissionTrackCards {...props} locale="zh" />)).toContain('5级210分及以上')
  })
})
