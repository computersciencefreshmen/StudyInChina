import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MiniMaxActivityCharts, appendSessionObservation, type SessionObservation } from '../../src/components/minimax/MiniMaxActivityCharts'
import { projectPublicMiniMax } from '../../src/lib/minimax/public-monitor'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'

describe('actual MiniMax charts without invented history', () => {
  it('starts with one actual point and no curve, then adds only new fresh observations', () => {
    const value = projectPublicMiniMax(cloudSnapshot(), CLOUD_NOW)
    const one = appendSessionObservation([], value, CLOUD_NOW)
    expect(one).toHaveLength(1)
    expect(appendSessionObservation(one, value, CLOUD_NOW + 45000)).toBe(one)
    expect(appendSessionObservation(one, { ...value, state: 'stale' }, CLOUD_NOW + 45000)).toBe(one)
    const next = { ...value, observedAt: new Date(CLOUD_NOW + 45000).toISOString() }
    const two = appendSessionObservation(one, next, CLOUD_NOW + 45000)
    expect(two).toHaveLength(2)
    render(<MiniMaxActivityCharts value={value} observations={one} />)
    expect(screen.getByRole('img', { name: /1个真实观测点/u }).querySelector('[stroke-linejoin]')).toBeNull()
    expect(screen.getByText('上界 1')).toBeVisible(); expect(screen.getByText('下界 1')).toBeVisible()
    expect(screen.getByText(/不含打开前的历史趋势/u)).toBeVisible()
  })
  it('segments a day/window reset, a decreasing counter, and bounds the browser session to20 points', () => {
    const value = projectPublicMiniMax(cloudSnapshot(), CLOUD_NOW)
    let points: SessionObservation[] = []
    for (let n = 0; n < 25; n++) points = appendSessionObservation(points, { ...value, observedAt: new Date(CLOUD_NOW + n * 1000).toISOString() }, CLOUD_NOW + n * 1000)
    expect(points).toHaveLength(20)
    const next = structuredClone(value); next.observedAt = new Date(CLOUD_NOW + 30000).toISOString(); next.periods[0].startAt = new Date(CLOUD_NOW).toISOString()
    expect(appendSessionObservation(points, next, CLOUD_NOW + 30000)).toHaveLength(1)
    next.periods[0].startAt = value.periods[0].startAt; next.periods[0].completed = 0
    expect(appendSessionObservation(points, next, CLOUD_NOW + 30000)).toHaveLength(1)
    expect(appendSessionObservation(points, { ...value, observedAt: new Date(CLOUD_NOW - 121000).toISOString() }, CLOUD_NOW)).toBe(points)
  })
  it('renders exact outcome values with separate unknowns and keeps absent observations unknown', () => {
    const value = projectPublicMiniMax(cloudSnapshot(), CLOUD_NOW)
    const { rerender } = render(<MiniMaxActivityCharts value={value} observations={[]} />)
    expect(screen.getByRole('img', { name: '今日3次尝试，完成1，确认失败1，结果未知1' })).toBeVisible()
    expect(screen.getByText('33.3%')).toBeVisible()
    rerender(<MiniMaxActivityCharts value={null} observations={[]} />)
    expect(screen.getByText('状态未观测，不显示为零')).toBeVisible()
    expect(screen.getByText('任务数量未知')).toBeVisible()
    expect(screen.queryByText('0%')).toBeNull()
  })
})
