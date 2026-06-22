import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type PublicGenerationModel } from '../types'
import {
  calculateGenerationPricing,
  DEFAULT_GEMINI_TIERED_PRICING_RULES,
  DEFAULT_OPENAI_TIERED_PRICING_RULES,
  getSizePricingTier,
} from './pricing'

const flatModel: PublicGenerationModel = {
  id: 'flat',
  name: 'Flat',
  provider: 'openai',
  model: 'gpt-image-2',
  apiMode: 'images',
  codexCompatible: false,
  pricingMode: 'flat',
  pricingPreviewRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
}

const tieredModel: PublicGenerationModel = {
  ...flatModel,
  id: 'tiered',
  pricingMode: 'tiered',
}

const geminiModel: PublicGenerationModel = {
  id: 'gemini',
  name: 'Gemini',
  provider: 'google-gemini',
  model: 'gemini-3.1-flash-image',
  apiMode: 'generateContent',
  codexCompatible: false,
  pricingMode: 'tiered',
  pricingPreviewRules: DEFAULT_GEMINI_TIERED_PRICING_RULES,
}

describe('generation pricing', () => {
  it('keeps flat pricing compatible with the standard per-image price', () => {
    expect(calculateGenerationPricing({
      model: flatModel,
      standardPointCost: 9,
      params: { ...DEFAULT_PARAMS, n: 3 },
    })).toMatchObject({
      mode: 'flat',
      pointsPerImage: 9,
      totalPoints: 27,
    })
  })

  it('prices official OpenAI tiered template by size and quality', () => {
    expect(calculateGenerationPricing({
      model: tieredModel,
      standardPointCost: 1,
      params: { ...DEFAULT_PARAMS, size: '1024x1024', quality: 'low', n: 1 },
    })).toMatchObject({ sizeTier: '1K', pointsPerImage: 1000 })

    expect(calculateGenerationPricing({
      model: tieredModel,
      standardPointCost: 1,
      params: { ...DEFAULT_PARAMS, size: '2048x2048', quality: 'medium', n: 1 },
    })).toMatchObject({ sizeTier: '2K', pointsPerImage: 20000 })

    expect(calculateGenerationPricing({
      model: tieredModel,
      standardPointCost: 1,
      params: { ...DEFAULT_PARAMS, size: '3840x2160', quality: 'high', n: 1 },
    })).toMatchObject({ sizeTier: '4K', pointsPerImage: 145000 })
  })

  it('buckets custom sizes by pixel count', () => {
    expect(getSizePricingTier('1200x1200')).toBe('1K')
    expect(getSizePricingTier('2048x2048')).toBe('2K')
    expect(getSizePricingTier('3000x2000')).toBe('4K')
  })

  it('adds reference image and mask edit surcharges per requested image', () => {
    expect(calculateGenerationPricing({
      model: tieredModel,
      standardPointCost: 1,
      params: { ...DEFAULT_PARAMS, size: '1024x1024', quality: 'medium', n: 2 },
      inputImageCount: 2,
      hasMask: true,
    })).toMatchObject({
      basePoints: 5000,
      referenceImageCount: 2,
      referenceImagePoints: 8000,
      maskEditPoints: 2000,
      pointsPerImage: 15000,
      totalPoints: 30000,
    })
  })

  it('applies the minimum charge for tiny custom rules', () => {
    expect(calculateGenerationPricing({
      model: {
        ...tieredModel,
        pricingPreviewRules: {
          sizeQualityPoints: {
            '1K': { auto: 1, low: 1, medium: 1, high: 1 },
            '2K': { auto: 1, low: 1, medium: 1, high: 1 },
            '4K': { auto: 1, low: 1, medium: 1, high: 1 },
          },
          referenceImagePoints: 0,
          maskEditPoints: 0,
          minimumPoints: 1000,
        },
      },
      standardPointCost: 1,
      params: { ...DEFAULT_PARAMS, n: 1 },
    })).toMatchObject({
      pointsPerImage: 1000,
      totalPoints: 1000,
    })
  })

  it('prices Gemini tiered template by media resolution instead of exact size', () => {
    expect(calculateGenerationPricing({
      model: geminiModel,
      standardPointCost: 1,
      params: {
        ...DEFAULT_PARAMS,
        size: '4096x4096',
        quality: 'high',
        n: 2,
        gemini: { mediaResolution: 'high', temperature: null, thinkingMode: 'auto', safetyLevel: 'default' },
      },
      inputImageCount: 1,
    })).toMatchObject({
      sizeTier: '4K',
      quality: 'auto',
      basePoints: 160000,
      referenceImagePoints: 4000,
      pointsPerImage: 164000,
      totalPoints: 328000,
    })
  })
})
