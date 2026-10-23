import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraftDebouncer, retryDelayMs } from './syncService'

describe('draft sync timing', () => {
  afterEach(() => vi.useRealTimers())

  it('uses the latest snapshot callback after debounce', () => {
    vi.useFakeTimers()
    const debouncer = new DraftDebouncer()
    const calls: string[] = []
    debouncer.schedule(() => calls.push('old'))
    vi.advanceTimersByTime(200)
    debouncer.schedule(() => calls.push('latest'))
    vi.advanceTimersByTime(499)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['latest'])
  })

  it('caps continuous input at three seconds and follows the backoff ceiling', () => {
    vi.useFakeTimers()
    const debouncer = new DraftDebouncer()
    const calls: string[] = []
    for (let index = 0; index < 8; index += 1) {
      debouncer.schedule(() => calls.push('latest'))
      vi.advanceTimersByTime(400)
    }
    expect(calls).toEqual(['latest'])
    expect(retryDelayMs(20)).toBeGreaterThanOrEqual(30_000)
  })
})
