import { useEffect } from 'react'
import { useStore } from '../store'
import { fetchSiteGenerationStats, parseSiteGenerationStats } from '../lib/siteStats'

const FALLBACK_POLL_MS = 15_000

export function useSiteGenerationStats(enabled: boolean) {
  const setSiteGeneratedImageCount = useStore((state) => state.setSiteGeneratedImageCount)

  useEffect(() => {
    if (!enabled) return
    let fallbackTimer: number | null = null
    let disposed = false

    const refresh = async () => {
      try {
        const stats = await fetchSiteGenerationStats()
        if (!disposed) setSiteGeneratedImageCount(stats.totalGeneratedImages)
      } catch {
        // Keep the most recent count while the connection recovers.
      }
    }
    const stopFallback = () => {
      if (fallbackTimer != null) window.clearInterval(fallbackTimer)
      fallbackTimer = null
    }
    const startFallback = () => {
      if (fallbackTimer != null) return
      void refresh()
      fallbackTimer = window.setInterval(() => void refresh(), FALLBACK_POLL_MS)
    }

    void refresh()
    if (typeof EventSource === 'undefined') {
      startFallback()
      return () => {
        disposed = true
        stopFallback()
      }
    }

    const source = new EventSource('/api/stats/generation-stream')
    source.addEventListener('generation-total', (event) => {
      try {
        const stats = parseSiteGenerationStats(JSON.parse((event as MessageEvent<string>).data))
        if (stats) setSiteGeneratedImageCount(stats.totalGeneratedImages)
      } catch {
        // Ignore malformed events and wait for the next authoritative value.
      }
    })
    source.onopen = stopFallback
    source.onerror = startFallback

    return () => {
      disposed = true
      stopFallback()
      source.close()
    }
  }, [enabled, setSiteGeneratedImageCount])
}
