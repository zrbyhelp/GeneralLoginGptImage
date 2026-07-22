import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSiteGenerationStats, getCounterAnimationStart, parseSiteGenerationStats } from './siteStats'

describe('site generation stats', () => {
  afterEach(() => vi.restoreAllMocks())

  it('normalizes a valid total and rejects invalid payloads', () => {
    expect(parseSiteGenerationStats({ totalGeneratedImages: 12.8 })).toEqual({ totalGeneratedImages: 12 })
    expect(parseSiteGenerationStats({ totalGeneratedImages: -1 })).toBeNull()
    expect(parseSiteGenerationStats({ totalGeneratedImages: 'invalid' })).toBeNull()
  })

  it('limits large counter updates to the final twenty animated steps', () => {
    expect(getCounterAnimationStart(null, 1000)).toBe(1000)
    expect(getCounterAnimationStart(10, 11)).toBe(10)
    expect(getCounterAnimationStart(10, 13)).toBe(10)
    expect(getCounterAnimationStart(10, 1000)).toBe(980)
    expect(getCounterAnimationStart(20, 15)).toBe(15)
    expect(getCounterAnimationStart(10, 1000, 20, true)).toBe(1000)
  })

  it('fetches the authoritative total without caching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      totalGeneratedImages: 42,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(fetchSiteGenerationStats()).resolves.toEqual({ totalGeneratedImages: 42 })
    expect(fetchMock).toHaveBeenCalledWith('/api/stats/generation-total', { cache: 'no-store' })
  })
})
