import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type PublicGenerationModel } from '../types'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'
import { DEFAULT_OPENAI_TIERED_PRICING_RULES } from './pricing'

const openAIModel: PublicGenerationModel = {
  id: 'openai',
  name: 'OpenAI',
  provider: 'openai',
  model: 'gpt-image-2',
  apiMode: 'images',
  codexCompatible: false,
  pricingMode: 'flat',
  pricingPreviewRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
}

const falModel: PublicGenerationModel = {
  id: 'fal',
  name: 'fal',
  provider: 'fal',
  model: 'openai/gpt-image-2',
  apiMode: 'images',
  codexCompatible: false,
  pricingMode: 'flat',
  pricingPreviewRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
}

describe('parameter compatibility', () => {
  it('limits OpenAI output count to 3', () => {
    expect(getOutputImageLimitForSettings(openAIModel)).toBe(3)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, openAIModel).n).toBe(3)
  })

  it('limits fal.ai output count to 3', () => {
    expect(getOutputImageLimitForSettings(falModel)).toBe(3)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 8 }, falModel).n).toBe(3)
  })

  it('resets unsupported params for Codex compatible models', () => {
    const result = normalizeParamsForSettings({
      size: '2048x2048',
      quality: 'high',
      output_format: 'webp',
      output_compression: 80,
      moderation: 'low',
      n: 2,
    }, {
      ...openAIModel,
      codexCompatible: true,
    })

    expect(result).toEqual({ ...DEFAULT_PARAMS, n: 2 })
  })
})
