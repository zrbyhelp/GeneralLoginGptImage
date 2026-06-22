import type {
  AdminModelConfig,
  ApiProvider,
  GeminiMediaResolution,
  GeminiPricingRules,
  ModelPricingRules,
  PricingBreakdown,
  PricingMode,
  PublicGenerationModel,
  SizePriceTier,
  TaskParams,
  TieredPricingRules,
} from '../types'
import { DEFAULT_PARAMS } from '../types'
import { normalizeImageSize } from './size'

const QUALITIES: Array<TaskParams['quality']> = ['auto', 'low', 'medium', 'high']
const SIZE_TIERS: SizePriceTier[] = ['1K', '2K', '4K']
const GEMINI_MEDIA_RESOLUTIONS: GeminiMediaResolution[] = ['auto', 'low', 'medium', 'high']

export const DEFAULT_OPENAI_TIERED_PRICING_RULES: TieredPricingRules = {
  sizeQualityPoints: {
    '1K': { low: 1000, medium: 5000, high: 18000, auto: 5000 },
    '2K': { low: 4000, medium: 20000, high: 72000, auto: 20000 },
    '4K': { low: 8000, medium: 40000, high: 145000, auto: 40000 },
  },
  referenceImagePoints: 4000,
  maskEditPoints: 2000,
  minimumPoints: 1000,
}

export const DEFAULT_GEMINI_TIERED_PRICING_RULES: GeminiPricingRules = {
  mediaResolutionPoints: {
    auto: 35000,
    low: 15000,
    medium: 35000,
    high: 65000,
  },
  referenceImagePoints: 1500,
  minimumPoints: 10000,
  searchGroundingPointsPerCount: 1200,
  searchGroundingEstimatedCountPerImage: 5,
}

type PricedModel = Pick<AdminModelConfig | PublicGenerationModel, 'pricingMode'> & {
  provider?: AdminModelConfig['provider'] | PublicGenerationModel['provider']
  pricingRules?: ModelPricingRules
  pricingPreviewRules?: ModelPricingRules
}

export interface PricingInput {
  model?: PricedModel | null
  standardPointCost: number
  params: TaskParams
  imageCount?: number
  inputImageCount?: number
  hasMask?: boolean
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = 1_000_000) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function normalizeQualityPoints(input: unknown, fallback: Record<TaskParams['quality'], number>) {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  return QUALITIES.reduce((acc, quality) => {
    acc[quality] = parsePositiveInt(record[quality], fallback[quality], 1, 1_000_000)
    return acc
  }, {} as Record<TaskParams['quality'], number>)
}

export function normalizePricingMode(value: unknown): PricingMode {
  return value === 'tiered' ? 'tiered' : 'flat'
}

export function normalizeTieredPricingRules(
  input: unknown,
  fallbackRules: TieredPricingRules = DEFAULT_OPENAI_TIERED_PRICING_RULES,
): TieredPricingRules {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const sizeQualityRecord = record.sizeQualityPoints && typeof record.sizeQualityPoints === 'object'
    ? record.sizeQualityPoints as Record<string, unknown>
    : {}

  return {
    sizeQualityPoints: SIZE_TIERS.reduce((acc, tier) => {
      acc[tier] = normalizeQualityPoints(sizeQualityRecord[tier], fallbackRules.sizeQualityPoints[tier])
      return acc
    }, {} as TieredPricingRules['sizeQualityPoints']),
    referenceImagePoints: parsePositiveInt(record.referenceImagePoints, fallbackRules.referenceImagePoints, 0, 1_000_000),
    maskEditPoints: parsePositiveInt(record.maskEditPoints, fallbackRules.maskEditPoints, 0, 1_000_000),
    minimumPoints: parsePositiveInt(record.minimumPoints, fallbackRules.minimumPoints, 1, 1_000_000),
  }
}

function normalizeGeminiMediaResolutionPoints(input: unknown, fallback: GeminiPricingRules['mediaResolutionPoints']) {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  return GEMINI_MEDIA_RESOLUTIONS.reduce((acc, resolution) => {
    acc[resolution] = parsePositiveInt(record[resolution], fallback[resolution], 1, 1_000_000)
    return acc
  }, {} as GeminiPricingRules['mediaResolutionPoints'])
}

export function normalizeGeminiPricingRules(input: unknown): GeminiPricingRules {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  if (!record.mediaResolutionPoints || typeof record.mediaResolutionPoints !== 'object') {
    return DEFAULT_GEMINI_TIERED_PRICING_RULES
  }

  return {
    mediaResolutionPoints: normalizeGeminiMediaResolutionPoints(
      record.mediaResolutionPoints,
      DEFAULT_GEMINI_TIERED_PRICING_RULES.mediaResolutionPoints,
    ),
    referenceImagePoints: parsePositiveInt(
      record.referenceImagePoints,
      DEFAULT_GEMINI_TIERED_PRICING_RULES.referenceImagePoints,
      0,
      1_000_000,
    ),
    minimumPoints: parsePositiveInt(
      record.minimumPoints,
      DEFAULT_GEMINI_TIERED_PRICING_RULES.minimumPoints,
      1,
      1_000_000,
    ),
    searchGroundingPointsPerCount: parsePositiveInt(
      record.searchGroundingPointsPerCount,
      DEFAULT_GEMINI_TIERED_PRICING_RULES.searchGroundingPointsPerCount,
      0,
      1_000_000,
    ),
    searchGroundingEstimatedCountPerImage: parsePositiveInt(
      record.searchGroundingEstimatedCountPerImage,
      DEFAULT_GEMINI_TIERED_PRICING_RULES.searchGroundingEstimatedCountPerImage,
      0,
      1000,
    ),
  }
}

export function normalizePricingRulesForProvider(input: unknown, provider?: ApiProvider): ModelPricingRules {
  return provider === 'google-gemini'
    ? normalizeGeminiPricingRules(input)
    : normalizeTieredPricingRules(input)
}

function parseSizePixels(size: string) {
  const normalized = normalizeImageSize(size)
  const match = normalized.match(/^(\d+)x(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return width * height
}

export function getSizePricingTier(size: string): SizePriceTier {
  const pixels = parseSizePixels(size)
  if (pixels == null) return '1K'
  if (pixels <= 1_500_000) return '1K'
  if (pixels <= 4_500_000) return '2K'
  return '4K'
}

function normalizeTieredPricingRulesWithFallback(input: unknown, fallback: TieredPricingRules): TieredPricingRules {
  const normalized = normalizeTieredPricingRules(input, fallback)
  if (input == null) return fallback
  return normalized
}

function getOpenAIPricingRules(model?: PricedModel | null) {
  return normalizeTieredPricingRulesWithFallback(
    model?.pricingRules ?? model?.pricingPreviewRules,
    DEFAULT_OPENAI_TIERED_PRICING_RULES,
  )
}

function getGeminiPricingRules(model?: PricedModel | null) {
  return normalizeGeminiPricingRules(model?.pricingRules ?? model?.pricingPreviewRules)
}

function getGeminiMediaResolution(params: TaskParams): GeminiMediaResolution {
  return params.gemini?.mediaResolution ?? DEFAULT_PARAMS.gemini?.mediaResolution ?? 'auto'
}

function createGeminiPricingBreakdown(input: {
  mode: PricingMode
  rules: GeminiPricingRules
  params: TaskParams
  imageCount: number
  referenceImageCount: number
  actualSearchGroundingCount?: number
}): PricingBreakdown {
  const mediaResolution = getGeminiMediaResolution(input.params)
  const basePoints = parsePositiveInt(
    input.rules.mediaResolutionPoints[mediaResolution],
    DEFAULT_GEMINI_TIERED_PRICING_RULES.mediaResolutionPoints[mediaResolution],
    1,
    1_000_000,
  )
  const referenceImagePoints = input.referenceImageCount * input.rules.referenceImagePoints
  const searchGroundingEnabled = Boolean(input.params.gemini?.networkSearch)
  const searchGroundingPointsPerCount = input.rules.searchGroundingPointsPerCount
  const searchGroundingEstimatedCount = searchGroundingEnabled
    ? input.rules.searchGroundingEstimatedCountPerImage
    : 0
  const hasActualSearchGroundingCount = typeof input.actualSearchGroundingCount === 'number'
  const searchGroundingActualCount = searchGroundingEnabled && hasActualSearchGroundingCount
    ? Math.max(0, Math.floor(Number(input.actualSearchGroundingCount) || 0))
    : undefined
  const chargedSearchGroundingCount = hasActualSearchGroundingCount
    ? searchGroundingActualCount ?? 0
    : searchGroundingEstimatedCount
  const searchGroundingEstimatedPoints = searchGroundingEstimatedCount * searchGroundingPointsPerCount
  const searchGroundingActualPoints = searchGroundingActualCount == null
    ? undefined
    : searchGroundingActualCount * searchGroundingPointsPerCount
  const fixedSubtotal = basePoints + referenceImagePoints
  const searchGroundingPoints = chargedSearchGroundingCount * searchGroundingPointsPerCount
  const estimatedSubtotal = fixedSubtotal + searchGroundingEstimatedPoints
  const estimatedPointsPerImage = Math.max(input.rules.minimumPoints, estimatedSubtotal)
  const actualTotalPoints = hasActualSearchGroundingCount
    ? input.imageCount > 0
      ? Math.max(input.rules.minimumPoints * input.imageCount, fixedSubtotal * input.imageCount + searchGroundingPoints)
      : 0
    : estimatedPointsPerImage * input.imageCount
  const pointsPerImage = hasActualSearchGroundingCount && input.imageCount > 0
    ? Math.ceil(actualTotalPoints / input.imageCount)
    : estimatedPointsPerImage

  return {
    mode: input.mode,
    mediaResolution,
    basePoints,
    referenceImageCount: input.referenceImageCount,
    referenceImagePoints,
    searchGroundingEnabled,
    searchGroundingEstimatedCount,
    searchGroundingActualCount,
    searchGroundingPointsPerCount,
    searchGroundingEstimatedPoints,
    searchGroundingActualPoints,
    maskEditApplied: false,
    maskEditPoints: 0,
    minimumPoints: input.rules.minimumPoints,
    pointsPerImage,
    imageCount: input.imageCount,
    totalPoints: actualTotalPoints,
  }
}

export function calculateGenerationPricing(input: PricingInput): PricingBreakdown {
  const mode = normalizePricingMode(input.model?.pricingMode)
  const imageCount = Math.max(1, Math.floor(Number(input.imageCount ?? input.params.n) || 1))
  const referenceImageCount = Math.max(0, Math.floor(Number(input.inputImageCount) || 0))
  const maskEditApplied = Boolean(input.hasMask)

  if (mode === 'flat') {
    const pointsPerImage = parsePositiveInt(input.standardPointCost, 1, 1, 1_000_000)
    return {
      mode,
      basePoints: pointsPerImage,
      referenceImageCount,
      referenceImagePoints: 0,
      maskEditApplied,
      maskEditPoints: 0,
      minimumPoints: pointsPerImage,
      pointsPerImage,
      imageCount,
      totalPoints: pointsPerImage * imageCount,
    }
  }

  if (input.model?.provider === 'google-gemini') {
    const rules = getGeminiPricingRules(input.model)
    return createGeminiPricingBreakdown({
      mode,
      rules,
      params: input.params,
      imageCount,
      referenceImageCount,
    })
  }

  const rules = getOpenAIPricingRules(input.model)
  const quality = input.params.quality || DEFAULT_PARAMS.quality
  const sizeTier = getSizePricingTier(input.params.size || DEFAULT_PARAMS.size)
  const basePoints = parsePositiveInt(
    rules.sizeQualityPoints[sizeTier]?.[quality],
    DEFAULT_OPENAI_TIERED_PRICING_RULES.sizeQualityPoints[sizeTier][quality],
    1,
    1_000_000,
  )
  const referenceImagePoints = referenceImageCount * rules.referenceImagePoints
  const maskEditPoints = maskEditApplied ? rules.maskEditPoints : 0
  const subtotal = basePoints + referenceImagePoints + maskEditPoints
  const pointsPerImage = Math.max(rules.minimumPoints, subtotal)

  return {
    mode,
    sizeTier,
    quality,
    basePoints,
    referenceImageCount,
    referenceImagePoints,
    maskEditApplied,
    maskEditPoints,
    minimumPoints: rules.minimumPoints,
    pointsPerImage,
    imageCount,
    totalPoints: pointsPerImage * imageCount,
  }
}

export function calculateActualGenerationPricing(input: PricingInput & {
  successfulImageCount: number
  actualSearchGroundingCount?: number
}): PricingBreakdown {
  const imageCount = Math.max(0, Math.floor(Number(input.successfulImageCount) || 0))
  if (input.model?.provider !== 'google-gemini' || normalizePricingMode(input.model?.pricingMode) !== 'tiered') {
    if (imageCount === 0) {
      return {
        ...calculateGenerationPricing({ ...input, imageCount: 1 }),
        imageCount: 0,
        totalPoints: 0,
      }
    }
    return {
      ...calculateGenerationPricing({ ...input, imageCount }),
      imageCount,
    }
  }

  return createGeminiPricingBreakdown({
    mode: 'tiered',
    rules: getGeminiPricingRules(input.model),
    params: input.params,
    imageCount,
    referenceImageCount: Math.max(0, Math.floor(Number(input.inputImageCount) || 0)),
    actualSearchGroundingCount: input.actualSearchGroundingCount,
  })
}
