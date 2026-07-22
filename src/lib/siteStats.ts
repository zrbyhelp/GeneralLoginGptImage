export interface SiteGenerationStats {
  totalGeneratedImages: number
}

export function parseSiteGenerationStats(value: unknown): SiteGenerationStats | null {
  if (!value || typeof value !== 'object') return null
  const count = Number((value as Record<string, unknown>).totalGeneratedImages)
  if (!Number.isFinite(count) || count < 0) return null
  return { totalGeneratedImages: Math.floor(count) }
}

export function getCounterAnimationStart(
  current: number | null,
  target: number,
  maxAnimatedSteps = 20,
  reduceMotion = false,
) {
  const normalizedTarget = Math.max(0, Math.floor(target))
  if (current == null || normalizedTarget <= current || reduceMotion) return normalizedTarget
  return Math.max(current, normalizedTarget - Math.max(1, Math.floor(maxAnimatedSteps)))
}

export async function fetchSiteGenerationStats() {
  const response = await fetch('/api/stats/generation-total', { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const stats = parseSiteGenerationStats(await response.json())
  if (!stats) throw new Error('全站生成统计响应无效')
  return stats
}
