import {
  DEFAULT_PARAMS,
  type AppSettings,
  type GeminiSafetyLevel,
  type GeminiThinkingMode,
  type GeminiMediaResolution,
  type GeminiUserParams,
  type TaskParams,
} from '../types'
import type { PublicGenerationModel } from '../types'
import { normalizeImageSize } from './size'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_OUTPUT_IMAGES = 3
export const MAX_FAL_OUTPUT_IMAGES = MAX_OUTPUT_IMAGES
export const MAX_OPENAI_OUTPUT_IMAGES = MAX_OUTPUT_IMAGES

type CompatibilityContext = AppSettings | PublicGenerationModel | null | undefined

function getProvider(context: CompatibilityContext) {
  return context && 'provider' in context ? context.provider : 'openai'
}

function getCodexCompatible(context: CompatibilityContext) {
  return Boolean(context && 'codexCompatible' in context && context.codexCompatible)
}

function normalizeGeminiMediaResolution(value: unknown): GeminiMediaResolution {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'auto' ? value : 'auto'
}

function normalizeGeminiThinkingMode(value: unknown): GeminiThinkingMode {
  return value === 'off' || value === 'low' || value === 'high' || value === 'auto' ? value : 'auto'
}

function normalizeGeminiSafetyLevel(value: unknown): GeminiSafetyLevel {
  return value === 'strict' || value === 'balanced' || value === 'relaxed' || value === 'default' ? value : 'default'
}

function normalizeGeminiTemperature(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.round(Math.min(2, Math.max(0, number)) * 100) / 100
}

export function normalizeGeminiUserParams(input: unknown, fallback: GeminiUserParams = DEFAULT_PARAMS.gemini!): GeminiUserParams {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const next: GeminiUserParams = {
    mediaResolution: normalizeGeminiMediaResolution(record.mediaResolution ?? fallback.mediaResolution),
    temperature: normalizeGeminiTemperature(record.temperature ?? fallback.temperature),
    thinkingMode: normalizeGeminiThinkingMode(record.thinkingMode ?? fallback.thinkingMode),
    safetyLevel: normalizeGeminiSafetyLevel(record.safetyLevel ?? fallback.safetyLevel),
  }

  return next.mediaResolution === fallback.mediaResolution &&
    next.temperature === fallback.temperature &&
    next.thinkingMode === fallback.thinkingMode &&
    next.safetyLevel === fallback.safetyLevel
    ? fallback
    : next
}

export function getOutputImageLimitForSettings(context: CompatibilityContext) {
  return getProvider(context) === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeParamsForSettings(params: TaskParams, context: CompatibilityContext): TaskParams {
  const provider = getProvider(context)
  const codexCompatible = getCodexCompatible(context)
  const outputImageLimit = getOutputImageLimitForSettings(context)
  const nextParams: TaskParams = {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
    gemini: normalizeGeminiUserParams(params.gemini),
  }

  if (provider === 'openai' && codexCompatible) {
    nextParams.size = DEFAULT_PARAMS.size
    nextParams.quality = DEFAULT_PARAMS.quality
    nextParams.output_format = DEFAULT_PARAMS.output_format
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
    nextParams.moderation = DEFAULT_PARAMS.moderation
  }

  if (provider === 'google-gemini') {
    nextParams.size = DEFAULT_PARAMS.size
    nextParams.quality = DEFAULT_PARAMS.quality
    nextParams.output_format = DEFAULT_PARAMS.output_format
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.gemini = normalizeGeminiUserParams(params.gemini)
  }

  if (provider === 'fal') {
    if (nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    const currentValue = current[key]
    const nextValue = next[key]
    const changed = typeof currentValue === 'object' || typeof nextValue === 'object'
      ? JSON.stringify(currentValue) !== JSON.stringify(nextValue)
      : currentValue !== nextValue
    if (changed) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
