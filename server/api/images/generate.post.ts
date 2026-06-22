import { createError } from 'h3'
import type { TaskParams } from '../../../src/types'
import { requireUser, isAdminUser } from '../../utils/auth'
import { assertApiConfigUsable, getAdminSettings, selectGenerationModel } from '../../utils/admin-settings'
import { countRecentGeneratedImages } from '../../utils/generation-usage'
import { createImageGenerationJob } from '../../utils/image-generation-queue'
import { calculateGenerationPricing } from '../../../src/lib/pricing'

const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

const FORBIDDEN_API_KEYS = new Set([
  'settings',
  'apiKey',
  'baseUrl',
  'apiUrl',
  'model',
  'provider',
  'apiMode',
  'codexCli',
  'apiProxy',
  'profiles',
  'activeProfileId',
  'timeout',
  'usePremiumApi',
  'pricingMode',
  'pricingRules',
  'pricingPreviewRules',
  'pricingBreakdown',
  'billingMode',
  'estimatedPoints',
  'costPerImage',
  'pointsPerImage',
  'reservedPoints',
  'chargedPoints',
  'refundedPoints',
  'price',
  'points',
])

const ALLOWED_PARAM_KEYS = new Set(['size', 'quality', 'output_format', 'output_compression', 'moderation', 'n'])

function assertNoApiOverrides(record: Record<string, unknown>, label = '请求') {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_API_KEYS.has(key)) {
      throw createError({ statusCode: 400, statusMessage: `${label}不能包含 API 配置字段：${key}` })
    }
  }
}

function normalizeParams(input: unknown, provider: string, codexCompatible: boolean): TaskParams {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  assertNoApiOverrides(record, '参数')
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PARAM_KEYS.has(key)) {
      throw createError({ statusCode: 400, statusMessage: `不支持的生成参数：${key}` })
    }
  }

  const quality = record.quality === 'low' || record.quality === 'medium' || record.quality === 'high' || record.quality === 'auto'
    ? record.quality
    : DEFAULT_PARAMS.quality
  const outputFormat = record.output_format === 'jpeg' || record.output_format === 'webp' || record.output_format === 'png'
    ? record.output_format
    : DEFAULT_PARAMS.output_format
  const moderation = record.moderation === 'low' || record.moderation === 'auto'
    ? record.moderation
    : DEFAULT_PARAMS.moderation
  const n = Math.min(3, Math.max(1, Math.floor(Number(record.n || DEFAULT_PARAMS.n)) || 1))
  const compression = typeof record.output_compression === 'number' && Number.isFinite(record.output_compression)
    ? Math.max(0, Math.min(100, Math.floor(record.output_compression)))
    : null

  return {
    size: typeof record.size === 'string' && record.size.trim() ? record.size.trim() : DEFAULT_PARAMS.size,
    quality: codexCompatible ? DEFAULT_PARAMS.quality : quality,
    output_format: codexCompatible ? DEFAULT_PARAMS.output_format : outputFormat,
    output_compression: codexCompatible || outputFormat === 'png' ? null : compression,
    moderation: codexCompatible ? DEFAULT_PARAMS.moderation : moderation,
    n,
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const isAdmin = isAdminUser(user)
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: '请求体无效' })
  }
  assertNoApiOverrides(body)

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) throw createError({ statusCode: 400, statusMessage: '请输入提示词' })

  const inputImageDataUrls = Array.isArray(body.inputImageDataUrls)
    ? body.inputImageDataUrls.filter((item): item is string => typeof item === 'string' && item.startsWith('data:image/'))
    : []
  const maskDataUrl = typeof body.maskDataUrl === 'string' && body.maskDataUrl.startsWith('data:image/')
    ? body.maskDataUrl
    : undefined

  const settings = await getAdminSettings()
  const uploadToGallery = body.uploadToGallery === true || body.privacyMode === false
  const privacyMode = !uploadToGallery
  const apiConfig = selectGenerationModel(settings, body.modelId)
  const params = normalizeParams(body.params, apiConfig.provider, apiConfig.codexCompatible)
  const pricing = calculateGenerationPricing({
    model: apiConfig,
    standardPointCost: settings.standardPointCost,
    params,
    imageCount: params.n,
    inputImageCount: inputImageDataUrls.length,
    hasMask: Boolean(maskDataUrl),
  })
  assertApiConfigUsable(apiConfig, apiConfig.name || 'API')

  if (!isAdmin) {
    const hourlyImageLimit = privacyMode ? settings.privacyHourlyImageLimit : settings.hourlyImageLimit
    const used = await countRecentGeneratedImages(user.id, privacyMode)
    const remaining = Math.max(0, hourlyImageLimit - used)
    if (params.n > remaining) {
      throw createError({
        statusCode: 429,
        statusMessage: `已超过每小时生成限制，剩余额度 ${remaining} 张`,
        data: { remaining, hourlyImageLimit, privacyMode },
      })
    }
  }

  return createImageGenerationJob({
    user,
    isAdmin,
    settings,
    apiConfig,
    prompt,
    params,
    inputImageDataUrls,
    maskDataUrl,
    uploadToGallery,
    dailyPointsTarget: settings.dailyPointsTarget,
    pricing,
  })
})
