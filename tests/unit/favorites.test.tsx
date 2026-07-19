import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FavoriteButton } from '@/components/features/FavoriteButton'
import { FAVORITES_KEY, parseFavorites } from '@/lib/favorites'

describe('favorites', () => {
  it('recovers safely from absent, malformed and non-array storage values', () => {
    expect(parseFavorites(null)).toEqual([])
    expect(parseFavorites('{broken')).toEqual([])
    expect(parseFavorites('{"id":"program-1"}')).toEqual([])
  })

  it('deduplicates stable ids and ignores other values', () => {
    expect(parseFavorites('["program-1", 4, "program-1", null, "program-2"]'))
      .toEqual(['program-1', 'program-2'])
  })

  it('persists a stable program id and can remove it again', async () => {
    const user = userEvent.setup()
    render(<FavoriteButton programId="program-1" saveLabel="Save" savedLabel="Saved" />)

    const button = await screen.findByRole('button', { name: /save/i })
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await user.click(button)
    expect(parseFavorites(window.localStorage.getItem(FAVORITES_KEY))).toEqual(['program-1'])
    expect(button).toHaveAttribute('aria-pressed', 'true')

    await user.click(button)
    expect(parseFavorites(window.localStorage.getItem(FAVORITES_KEY))).toEqual([])
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })
})
