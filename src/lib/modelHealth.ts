import type { ModelHealth, ModelHealthState } from '../types'

export const MODEL_HEALTH_WINDOW_MINUTES = 60

type ModelHealthMetrics = {
  modelId: string
  sampleCount: number
  successCount: number
  averageGenerationMs: number | null
}

export function deriveModelHealth(metrics: ModelHealthMetrics): ModelHealth {
  const sampleCount = Math.max(0, Math.floor(metrics.sampleCount))
  const successCount = Math.min(sampleCount, Math.max(0, Math.floor(metrics.successCount)))
  const failureCount = sampleCount - successCount
  const successRate = sampleCount ? successCount / sampleCount : null
  const averageGenerationMs = metrics.averageGenerationMs == null
    ? null
    : Math.max(0, Math.round(metrics.averageGenerationMs))

  let state: ModelHealthState = 'unknown'
  let bars: ModelHealth['bars'] = 0

  if (sampleCount > 0 && successRate != null && averageGenerationMs != null) {
    if (sampleCount >= 3 && successRate >= 0.8 && averageGenerationMs <= 90_000) {
      state = 'healthy'
      bars = 3
    } else if (successRate >= 0.5 && averageGenerationMs <= 180_000) {
      state = 'degraded'
      bars = 2
    } else {
      state = 'unavailable'
      bars = 1
    }
  }

  return {
    modelId: metrics.modelId,
    state,
    bars,
    sampleCount,
    successCount,
    failureCount,
    successRate,
    averageGenerationMs,
  }
}

export function getModelHealthDescription(health?: ModelHealth) {
  if (!health || health.state === 'unknown') return `近 ${MODEL_HEALTH_WINDOW_MINUTES} 小时暂无生成样本`

  const stateLabel: Record<Exclude<ModelHealthState, 'unknown'>, string> = {
    healthy: '可用且响应稳定',
    degraded: '可用但响应较慢或稳定性下降',
    unavailable: '近期生成不可用',
  }
  const successRate = `${Math.round((health.successRate ?? 0) * 100)}%`
  const seconds = Math.max(1, Math.round((health.averageGenerationMs ?? 0) / 1000))
  const confidence = health.sampleCount < 3 ? '，样本有限' : ''
  return `近 ${MODEL_HEALTH_WINDOW_MINUTES} 小时：${stateLabel[health.state]}，成功率 ${successRate}，平均生成 ${seconds} 秒（${health.sampleCount} 个样本${confidence}）`
}
