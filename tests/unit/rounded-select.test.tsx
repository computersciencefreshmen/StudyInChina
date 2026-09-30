import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RoundedSelect } from '@/components/ui/RoundedSelect'

function Options() {
  return <>
    <option value="">All</option>
    <option value="100">Top 100</option>
    <option value="200" disabled>Top 200 unavailable</option>
    <option value="500">Top 500</option>
  </>
}

// Pass concrete native options, as server-rendered catalogue filters do.
const options = Options()

describe('rounded select', () => {
  it('opens a custom listbox and submits exactly one selected form value', () => {
    const onChange = vi.fn()
    const { container } = render(<form>
      <label htmlFor="rank">Ranking</label>
      <RoundedSelect id="rank" name="ranking" defaultValue="" onChange={onChange}>{options}</RoundedSelect>
    </form>)
    const field = screen.getByRole('combobox', { name: 'Ranking' })
    expect(field).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(field)
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.click(screen.getByRole('option', { name: 'Top 100' }))
    expect(field).toHaveValue('100')
    expect(field).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    const data = new FormData(container.querySelector('form')!)
    expect(data.getAll('ranking')).toEqual(['100'])
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('supports keyboard selection, skips disabled options, and cancels with Escape', () => {
    render(<><label htmlFor="rank">Ranking</label><RoundedSelect id="rank" defaultValue="100">{options}</RoundedSelect></>)
    const field = screen.getByRole('combobox', { name: 'Ranking' })
    field.focus()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Top 500' }).id)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field).toHaveValue('100')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'End' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(field).toHaveValue('500')
    fireEvent.keyDown(field, { key: 'Home' })
    fireEvent.keyDown(field, { key: ' ' })
    expect(field).toHaveValue('')
  })

  it('keeps typed selection and controlled native change handlers synchronized', () => {
    function Controlled() {
      const [value, setValue] = useState('')
      return <><label htmlFor="city">City</label><RoundedSelect id="city" value={value} onChange={(event) => setValue(event.target.value)}>
        <option value="">All cities</option><option value="beijing">Beijing</option><option value="hefei">Hefei</option><option value="hangzhou">Hangzhou</option>
      </RoundedSelect><output>{value}</output></>
    }
    render(<Controlled />)
    const field = screen.getByRole('combobox', { name: 'City' })
    fireEvent.keyDown(field, { key: 'h' })
    fireEvent.keyDown(field, { key: 'a' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(field).toHaveValue('hangzhou')
    expect(screen.getByRole('status')).toHaveTextContent('hangzhou')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on outside pointer, outside focus, and Tab without stealing focus', () => {
    render(<><label htmlFor="rank">Ranking</label><RoundedSelect id="rank">{options}</RoundedSelect><button type="button">Outside</button></>)
    const field = screen.getByRole('combobox', { name: 'Ranking' })
    const outside = screen.getByRole('button', { name: 'Outside' })
    fireEvent.click(field)
    fireEvent.pointerDown(outside)
    expect(field).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(field)
    act(() => outside.focus())
    expect(field).toHaveAttribute('aria-expanded', 'false')
    expect(outside).toHaveFocus()
    fireEvent.click(field)
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(field).toHaveAttribute('aria-expanded', 'false')
  })

  it('preserves bubbling change and requestSubmit filter forms', () => {
    const submitted: string[] = []
    render(<form onChange={(event) => event.currentTarget.requestSubmit()} onSubmit={(event) => {
      event.preventDefault()
      submitted.push(String(new FormData(event.currentTarget).get('ranking')))
    }}>
      <label htmlFor="rank">Ranking</label><RoundedSelect id="rank" name="ranking">{options}</RoundedSelect>
    </form>)
    fireEvent.click(screen.getByRole('combobox', { name: 'Ranking' }))
    fireEvent.click(screen.getByRole('option', { name: 'Top 500' }))
    expect(submitted).toEqual(['500'])
  })

  it('restores the visible value after a native form reset', async () => {
    const { container } = render(<form><label htmlFor="rank">Ranking</label><RoundedSelect id="rank" name="ranking" defaultValue="100">{options}</RoundedSelect></form>)
    const field = screen.getByRole('combobox', { name: 'Ranking' })
    fireEvent.click(field)
    fireEvent.click(screen.getByRole('option', { name: 'Top 500' }))
    await act(async () => container.querySelector('form')!.reset())
    expect(field).toHaveValue('100')
    expect(new FormData(container.querySelector('form')!).get('ranking')).toBe('100')
  })

  it('moves required validation to the visible control and leaves disabled controls inert', () => {
    const { container } = render(<form>
      <label htmlFor="rank">Ranking</label><RoundedSelect id="rank" name="ranking" required>{options}</RoundedSelect>
      <label htmlFor="locked">Locked</label><RoundedSelect id="locked" disabled>{options}</RoundedSelect>
    </form>)
    act(() => { expect(container.querySelector('form')!.checkValidity()).toBe(false) })
    expect(screen.getByRole('combobox', { name: 'Ranking' })).toHaveFocus()
    expect(screen.getByRole('combobox', { name: 'Ranking' })).toHaveAttribute('aria-invalid', 'true')
    const locked = screen.getByRole('combobox', { name: 'Locked' })
    expect(locked).toBeDisabled()
    fireEvent.click(locked)
    expect(locked).toHaveAttribute('aria-expanded', 'false')
  })
})
