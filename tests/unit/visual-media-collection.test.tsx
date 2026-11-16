import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VisualMediaCollection } from '@/components/features/VisualMediaCollection'
import {
  filterVisualMediaPrograms,
  isVisualMediaQuery,
  parseVisualMediaFilters,
  type VisualMediaCollection as Collection,
  type VisualMediaFilters,
  type VisualMediaProgram,
} from '@/lib/visual-media'

const emptyFilters: VisualMediaFilters = { query: '', region: '', language: '', category: '' }
const baseProgram: VisualMediaProgram = {
  id: 'test-film',
  university: { en: 'Example Arts University', zh: '示例艺术大学' },
  city: { en: 'Shanghai', zh: '上海' },
  name: { en: 'MA Film and Animation', zh: '电影与动画硕士' },
  category: 'film-animation', region: 'mainland', fit: 'direct',
  teachingLanguages: ['English'], language: { en: 'English', zh: '英语' },
  duration: { en: 'Two years', zh: '两年' },
  tuition: { en: 'Unconfirmed; contact admissions', zh: '未确认，请咨询招生办' },
  application: { en: '2027 deadline not confirmed', zh: '2027 截止日未确认' },
  portfolio: { en: 'Portfolio required', zh: '须提交作品集' },
  internationalEligibility: { en: 'International applicants accepted', zh: '接受国际学生申请' },
  evidenceStatus: 'confirmed', cycle: { en: '2026 source; next intake unconfirmed', zh: '2026 来源；下一轮未确认' },
  notes: { en: 'Animation production route', zh: '动画制作方向' },
  sources: [{ label: 'Official programme', url: 'https://example.edu.cn/programme' }],
}
const collection: Collection = {
  checkedOn: '2026-11-16',
  scope: { en: 'Official-source research collection', zh: '官方来源研究专题' },
  programs: [
    baseProgram,
    { ...baseProgram, id: 'test-mixed', name: { en: 'Interactive Media' }, category: 'new-media', region: 'hong-kong', teachingLanguages: ['Bilingual'], language: { en: 'Bilingual; confirm course requirements' } },
    { ...baseProgram, id: 'test-unknown', teachingLanguages: [], language: { en: 'Unknown; English completion not confirmed' } },
    { ...baseProgram, id: 'test-unconfirmed', evidenceStatus: 'needs-confirmation' },
    { ...baseProgram, id: 'test-no-source', sources: [] },
  ],
}

describe('Visual Media research collection', () => {
  it('publishes only confirmed routes with evidence, keeping the main catalogue policy separate', () => {
    expect(filterVisualMediaPrograms(collection, emptyFilters).map(program => program.id)).toEqual(['test-film', 'test-mixed', 'test-unknown'])
  })

  it('keeps bilingual and unconfirmed languages out of the English-only filter', () => {
    expect(filterVisualMediaPrograms(collection, { ...emptyFilters, language: 'English' }).map(program => program.id)).toEqual(['test-film'])
    expect(filterVisualMediaPrograms(collection, { ...emptyFilters, language: 'Bilingual' }).map(program => program.id)).toEqual(['test-mixed'])
  })

  it('combines region, subject and keyword filters, including Chinese titles', () => {
    expect(filterVisualMediaPrograms(collection, { ...emptyFilters, region: 'hong-kong', category: 'new-media' }).map(program => program.id)).toEqual(['test-mixed'])
    expect(filterVisualMediaPrograms(collection, { ...emptyFilters, query: '电影', language: 'English' }).map(program => program.id)).toEqual(['test-film'])
    expect(filterVisualMediaPrograms(collection, { ...emptyFilters, query: 'animation Beijing' })).toEqual([])
    expect(filterVisualMediaPrograms(collection, { ...emptyFilters, query: "visual media master's programmes" })).toHaveLength(3)
  })

  it('bounds query inputs and ignores unsupported enum or array values', () => {
    expect(parseVisualMediaFilters({ q: 'x'.repeat(200), region: 'abroad', language: ['English'], category: 'medicine' })).toEqual({ ...emptyFilters, query: 'x'.repeat(160) })
  })

  it.each(['visual media', 'Visual-Media master', 'digital media', 'visual communication', '动画', '视觉传达', 'визуальные медиа'])('recognizes a relevant catalogue shortcut: %s', query => {
    expect(isVisualMediaQuery(query)).toBe(true)
  })

  it.each(['', 'media studies', 'engineering', 'medical imaging', 'Computer Science'])('does not advertise the collection for unrelated queries: %s', query => {
    expect(isVisualMediaQuery(query)).toBe(false)
  })

  it('shows official sources and unknown deadlines without promising applications are open', () => {
    render(<VisualMediaCollection collection={{ ...collection, programs: [baseProgram] }} filters={emptyFilters} locale="en" />)
    expect(screen.getByRole('heading', { name: 'MA Film and Animation' })).toBeVisible()
    expect(screen.getByText(/This does not mean applications are currently open/)).toBeVisible()
    expect(screen.getByText('2027 deadline not confirmed')).toBeVisible()
    expect(screen.getByRole('link', { name: /Official programme/ })).toHaveAttribute('href', 'https://example.edu.cn/programme')
    expect(screen.getByRole('searchbox')).toHaveAttribute('name', 'q')
    expect(screen.getByRole('form')).toHaveAttribute('method', 'get')
    expect(within(screen.getByRole('combobox', { name: 'Teaching language' })).getByRole('option', { name: /Bilingual/ })).toBeVisible()
  })

  it('uses Chinese data on the Chinese page and explicitly labels Russian fallback', () => {
    const { unmount } = render(<VisualMediaCollection collection={{ ...collection, programs: [baseProgram] }} filters={emptyFilters} locale="zh" />)
    expect(screen.getByRole('heading', { name: '电影与动画硕士' })).toBeVisible()
    expect(screen.getByText('2027 截止日未确认')).toBeVisible()
    unmount()
    render(<VisualMediaCollection collection={{ ...collection, programs: [baseProgram] }} filters={emptyFilters} locale="ru" />)
    expect(screen.getByText(/перевод на русский пока не подготовлен/)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'MA Film and Animation' })).toBeVisible()
  })
})
