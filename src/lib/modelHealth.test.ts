import { describe, expect, it } from 'vitest'
import { deriveModelHealth, getModelHealthDescription } from './modelHealth'

describe('model health rating', () => {
  it('shows unknown when no recent generations exist', () => {
    const health = deriveModelHealth({ modelId: 'empty', sampleCount: 0, successCount: 0, averageGenerationMs: null })
    expect(health).toMatchObject({ state: 'unknown', bars: 0 })
    expect(getModelHealthDescription(health)).toContain('暂无生成样本')
  })

  it('caps a successful low-sample model at two bars', () => {
    expect(deriveModelHealth({
      modelId: 'new',
      sampleCount: 2,
      successCount: 2,
      averageGenerationMs: 10_000,
    })).toMatchObject({ state: 'degraded', bars: 2 })
  })

  it('shows three green bars for stable, fast models', () => {
    expect(deriveModelHealth({
      modelId: 'healthy',
      sampleCount: 5,
      successCount: 4,
      averageGenerationMs: 90_000,
    })).toMatchObject({ state: 'healthy', bars: 3 })
  })

  it('marks slow or unreliable models unavailable', () => {
    expect(deriveModelHealth({
      modelId: 'slow',
      sampleCount: 5,
      successCount: 5,
      averageGenerationMs: 180_001,
    })).toMatchObject({ state: 'unavailable', bars: 1 })
    expect(deriveModelHealth({
      modelId: 'failing',
      sampleCount: 4,
      successCount: 1,
      averageGenerationMs: 10_000,
    })).toMatchObject({ state: 'unavailable', bars: 1 })
  })
})
