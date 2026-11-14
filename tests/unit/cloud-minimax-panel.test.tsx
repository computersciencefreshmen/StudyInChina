import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudMiniMaxPanel } from '../../src/components/admin/CloudMiniMaxPanel'
import { AdminDashboard } from '../../src/components/admin/AdminDashboard'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'
import { adminSnapshot } from '../fixtures/admin-workbench'
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('mobile cloud MiniMax panel', () => {
  it('shows live quota, unlimited weekly status and actual Flash ledger independently of a disconnected desktop executor', () => {
    const data = adminSnapshot(); data.generatedAt = new Date(CLOUD_NOW).toISOString(); data.telemetry = { source: 'unavailable', observedAt: null, stale: true }; data.cloudMiniMax = cloudSnapshot()
    render(<AdminDashboard snapshot={data} connection="polling" />)
    const panel = screen.getByRole('region', { name: '云端 MiniMax' })
    expect(within(panel).getByText('云端账本已连接')).toBeVisible(); expect(within(panel).getByText('72%')).toBeVisible(); expect(within(panel).getByText('∞')).toBeVisible()
    expect(within(panel).getByText('今日实际尝试').closest('div')).toHaveTextContent('3')
    expect(within(panel).getByRole('table')).toHaveTextContent('MiniMax-M3.1-Flash')
    expect(within(panel).getByText(/积分余额未由此接口提供/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    expect(screen.getByRole('region', { name: '云端 MiniMax' })).toBeVisible()
  })
  it('does not turn unknown quota, usage or coverage into zeros or an invented credit balance', () => {
    render(<CloudMiniMaxPanel value={null} now={CLOUD_NOW} />)
    expect(screen.getByText('云端账本暂不可用')).toBeVisible()
    expect(screen.getAllByText('未知').length).toBe(2)
    expect(screen.queryByText('0%')).toBeNull(); expect(screen.queryByText('9,482')).toBeNull()
    cleanup()
    const value = cloudSnapshot(); value.ledger!.periods[0].totals.tokens.input = null
    render(<CloudMiniMaxPanel value={value} now={CLOUD_NOW} />)
    const table = screen.getByRole('table')
    expect(table).toHaveTextContent('未知')
    expect(screen.getByText(/不能据维护学校数认定已覆盖/)).toBeVisible()
  })
  it('shows the original observation with stale labels after a failed refresh or quota reset', () => {
    const value = cloudSnapshot(); value.quota.state = 'stale'; value.ledgerState = 'stale'
    const { rerender } = render(<CloudMiniMaxPanel value={value} now={CLOUD_NOW + 200_000} />)
    expect(screen.getByText('账本缓存 · 待更新')).toBeVisible()
    expect(screen.getByText(/历史观测 · 已过期或读取失败/)).toBeVisible()
    expect(screen.getByText(/历史套餐观测为不限周额度/)).toBeVisible()
    const fresh = cloudSnapshot()
    rerender(<CloudMiniMaxPanel value={fresh} now={Date.parse(fresh.quota.fiveHour!.resetAt)} />)
    expect(screen.getByText(/额度未知或待更新/)).toBeVisible()
  })
  it('ages the last observation even if no later server snapshot can arrive', async () => {
    vi.useFakeTimers(); vi.setSystemTime(CLOUD_NOW)
    render(<CloudMiniMaxPanel value={cloudSnapshot()} now={CLOUD_NOW} />)
    expect(screen.getByText('云端账本已连接')).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(135_000) })
    expect(screen.getByText('账本缓存 · 待更新')).toBeVisible()
    expect(screen.getByText(/历史观测 · 已过期或读取失败/)).toBeVisible()
  })
})
