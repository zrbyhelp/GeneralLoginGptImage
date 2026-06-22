import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type PublicGenerationModel, type TaskParams } from '../types'
import {
  calculateGenerationPricing,
  calculateActualGenerationPricing,
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
        gemini: { mediaResolution: 'high', temperature: null, thinkingMode: 'auto', safetyLevel: 'default', networkSearch: false },
      },
      inputImageCount: 1,
    })).toMatchObject({
      mediaResolution: 'high',
      basePoints: 65000,
      referenceImagePoints: 1500,
      maskEditApplied: false,
      maskEditPoints: 0,
      pointsPerImage: 66500,
      totalPoints: 133000,
    })
  })

  it('resets legacy Gemini size-quality pricing rules to the media-resolution defaults', () => {
    const pricing = calculateGenerationPricing({
      model: {
        ...geminiModel,
        pricingPreviewRules: {
          sizeQualityPoints: {
            '1K': { auto: 1, low: 1, medium: 1, high: 1 },
            '2K': { auto: 1, low: 1, medium: 1, high: 1 },
            '4K': { auto: 999999, low: 999999, medium: 999999, high: 999999 },
          },
          referenceImagePoints: 999999,
          maskEditPoints: 999999,
          minimumPoints: 999999,
        },
      },
      standardPointCost: 1,
      params: {
        ...DEFAULT_PARAMS,
        n: 1,
        gemini: { mediaResolution: 'auto', temperature: null, thinkingMode: 'auto', safetyLevel: 'default', networkSearch: false },
      },
    })

    expect(pricing).toMatchObject({
      mediaResolution: 'auto',
      basePoints: 35000,
      referenceImagePoints: 0,
      minimumPoints: 10000,
      pointsPerImage: 35000,
      totalPoints: 35000,
    })
  })

  it('applies custom Gemini media-resolution rules and minimum charge', () => {
    expect(calculateGenerationPricing({
      model: {
        ...geminiModel,
        pricingPreviewRules: {
          mediaResolutionPoints: { auto: 5, low: 5, medium: 5, high: 5 },
          referenceImagePoints: 2,
          minimumPoints: 100,
          searchGroundingPointsPerCount: 10,
          searchGroundingEstimatedCountPerImage: 5,
        },
      },
      standardPointCost: 1,
      params: {
        ...DEFAULT_PARAMS,
        n: 3,
        gemini: { mediaResolution: 'low', temperature: null, thinkingMode: 'auto', safetyLevel: 'default', networkSearch: false },
      },
      inputImageCount: 4,
    })).toMatchObject({
      mediaResolution: 'low',
      basePoints: 5,
      referenceImagePoints: 8,
      pointsPerImage: 100,
      totalPoints: 300,
    })
  })

  it('adds Gemini network search estimated points and recalculates by actual count', () => {
    const params = {
      ...DEFAULT_PARAMS,
      n: 2,
      gemini: { mediaResolution: 'medium', temperature: null, thinkingMode: 'auto', safetyLevel: 'default', networkSearch: true },
    } satisfies TaskParams
    const preview = calculateGenerationPricing({
      model: geminiModel,
      standardPointCost: 1,
      params,
      inputImageCount: 0,
    })

    expect(preview).toMatchObject({
      mediaResolution: 'medium',
      basePoints: 35000,
      searchGroundingEnabled: true,
      searchGroundingEstimatedCount: 5,
      searchGroundingPointsPerCount: 1200,
      searchGroundingEstimatedPoints: 6000,
      pointsPerImage: 41000,
      totalPoints: 82000,
    })

    expect(calculateActualGenerationPricing({
      model: geminiModel,
      standardPointCost: 1,
      params,
      inputImageCount: 0,
      successfulImageCount: 2,
      actualSearchGroundingCount: 3,
    })).toMatchObject({
      imageCount: 2,
      searchGroundingActualCount: 3,
      searchGroundingActualPoints: 3600,
      totalPoints: 73600,
    })
  })
})
