import { createError } from 'h3'
import type { TaskParams } from '../../../src/types'
import { requireUser, isAdminUser } from '../../utils/auth'
import { assertApiConfigUsable, getAdminSettings } from '../../utils/admin-settings'
import { callServerImageApi } from '../../utils/server-image-api'
import { countRecentRequestedImages, createAudit, updateAudit } from '../../utils/audits'
import { saveGeneratedImages } from '../../utils/local-images'

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
])

const ALLOWED_PARAM_KEYS = new Set(['size', 'quality', 'output_format', 'output_compression', 'moderation', 'n'])

function assertNoApiOverrides(record: Record<string, unknown>, label = '请求') {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_API_KEYS.has(key)) {
      throw createError({ statusCode: 400, statusMessage: `${label}不能包含 API 配置字段：${key}` })
    }
  }
}

function normalizeParams(input: unknown, provider: string): TaskParams {
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
  const maxImages = provider === 'fal' ? 4 : 10
  const n = Math.min(maxImages, Math.max(1, Math.floor(Number(record.n || DEFAULT_PARAMS.n)) || 1))
  const compression = typeof record.output_compression === 'number' && Number.isFinite(record.output_compression)
    ? Math.max(0, Math.min(100, Math.floor(record.output_compression)))
    : null

  return {
    size: typeof record.size === 'string' && record.size.trim() ? record.size.trim() : DEFAULT_PARAMS.size,
    quality,
    output_format: outputFormat,
    output_compression: outputFormat === 'png' ? null : compression,
    moderation,
    n,
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
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
  const apiConfig = settings.apiConfig
  assertApiConfigUsable(apiConfig)
  const params = normalizeParams(body.params, apiConfig.provider)

  if (!isAdminUser(user)) {
    const used = await countRecentRequestedImages(user.id)
    const remaining = Math.max(0, settings.hourlyImageLimit - used)
    if (params.n > remaining) {
      throw createError({
        statusCode: 429,
        statusMessage: `已超过每小时生成限制，剩余额度 ${remaining} 张`,
        data: { remaining, hourlyImageLimit: settings.hourlyImageLimit },
      })
    }
  }

  const startedAt = Date.now()
  const audit = await createAudit({
    user,
    prompt,
    params,
    requestedImageCount: params.n,
    inputImageCount: inputImageDataUrls.length,
    maskUsed: Boolean(maskDataUrl),
    apiProvider: apiConfig.provider,
    apiModel: apiConfig.model,
  })

  try {
    const result = await callServerImageApi({
      config: apiConfig,
      prompt,
      params,
      inputImageDataUrls,
      maskDataUrl,
    })

    let auditSaveError: string | null = null
    let outputImages = []
    try {
      outputImages = await saveGeneratedImages(audit.id, result.images)
    } catch (error) {
      auditSaveError = error instanceof Error ? error.message : String(error)
    }

    await updateAudit(audit.id, {
      status: 'done',
      outputImages,
      actualParams: result.actualParams,
      revisedPrompts: result.revisedPrompts,
      auditSaveError,
      finishedAt: new Date().toISOString(),
      elapsed: Date.now() - startedAt,
    })

    return {
      ...result,
      apiProvider: apiConfig.provider,
      apiProfileName: '统一配置',
      apiModel: apiConfig.model,
      auditSaveError,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateAudit(audit.id, {
      status: 'error',
      error: message,
      finishedAt: new Date().toISOString(),
      elapsed: Date.now() - startedAt,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
