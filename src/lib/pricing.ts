import type {
  AdminModelConfig,
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

export const DEFAULT_GEMINI_TIERED_PRICING_RULES: TieredPricingRules = {
  sizeQualityPoints: {
    '1K': { low: 4000, medium: 12000, high: 72000, auto: 20000 },
    '2K': { low: 16000, medium: 48000, high: 288000, auto: 80000 },
    '4K': { low: 32000, medium: 96000, high: 580000, auto: 160000 },
  },
  referenceImagePoints: 4000,
  maskEditPoints: 0,
  minimumPoints: 4000,
}

type PricedModel = Pick<AdminModelConfig | PublicGenerationModel, 'pricingMode'> & {
  provider?: AdminModelConfig['provider'] | PublicGenerationModel['provider']
  pricingRules?: TieredPricingRules
  pricingPreviewRules?: TieredPricingRules
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

function getDefaultPricingRules(model?: PricedModel | null) {
  return model?.provider === 'google-gemini'
    ? DEFAULT_GEMINI_TIERED_PRICING_RULES
    : DEFAULT_OPENAI_TIERED_PRICING_RULES
}

function normalizeTieredPricingRulesWithFallback(input: unknown, fallback: TieredPricingRules): TieredPricingRules {
  const normalized = normalizeTieredPricingRules(input, fallback)
  if (input == null) return fallback
  return normalized
}

function getPricingRules(model?: PricedModel | null) {
  return normalizeTieredPricingRulesWithFallback(
    model?.pricingRules ?? model?.pricingPreviewRules,
    getDefaultPricingRules(model),
  )
}

function getGeminiMediaResolutionPricingTier(params: TaskParams): SizePriceTier {
  const mediaResolution = params.gemini?.mediaResolution ?? DEFAULT_PARAMS.gemini?.mediaResolution ?? 'auto'
  if (mediaResolution === 'low') return '1K'
  if (mediaResolution === 'high') return '4K'
  return '2K'
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

  const rules = getPricingRules(input.model)
  const quality = input.model?.provider === 'google-gemini'
    ? DEFAULT_PARAMS.quality
    : input.params.quality || DEFAULT_PARAMS.quality
  const sizeTier = input.model?.provider === 'google-gemini'
    ? getGeminiMediaResolutionPricingTier(input.params)
    : getSizePricingTier(input.params.size || DEFAULT_PARAMS.size)
  const basePoints = parsePositiveInt(
    rules.sizeQualityPoints[sizeTier]?.[quality],
    getDefaultPricingRules(input.model).sizeQualityPoints[sizeTier][quality],
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
