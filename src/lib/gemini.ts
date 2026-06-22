import type { GeminiAdminDefaults } from '../types'

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_GEMINI_SDK_BASE_URL = 'https://generativelanguage.googleapis.com'
export const DEFAULT_GEMINI_VERTEX_BASE_URL = 'https://zenmux.ai/api/vertex-ai'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-image'
export const DEFAULT_GEMINI_VERTEX_MODEL = 'google/gemini-3-pro-image'

export const DEFAULT_GEMINI_ADMIN_DEFAULTS: GeminiAdminDefaults = {
  topP: null,
  topK: null,
  maxOutputTokens: null,
  seed: null,
  responseMimeType: '',
  imageConfig: null,
  generationConfig: null,
  thinkingConfig: null,
  safetySettings: null,
}

function parseNullableNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(max, Math.max(min, number))
}

function parseNullableInteger(value: unknown, min: number, max: number): number | null {
  const number = parseNullableNumber(value, min, max)
  return number == null ? null : Math.floor(number)
}

function parseObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

export function normalizeGeminiAdminDefaults(input: unknown): GeminiAdminDefaults {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  return {
    topP: parseNullableNumber(record.topP, 0, 1),
    topK: parseNullableInteger(record.topK, 1, 1000),
    maxOutputTokens: parseNullableInteger(record.maxOutputTokens, 1, 1_000_000),
    seed: parseNullableInteger(record.seed, 0, 2_147_483_647),
    responseMimeType: typeof record.responseMimeType === 'string' ? record.responseMimeType.trim() : '',
    imageConfig: parseObject(record.imageConfig),
    generationConfig: parseObject(record.generationConfig),
    thinkingConfig: parseObject(record.thinkingConfig),
    safetySettings: parseArray(record.safetySettings),
  }
}
