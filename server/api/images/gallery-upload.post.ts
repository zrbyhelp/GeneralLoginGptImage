import { createError } from 'h3'
import { DEFAULT_PARAMS, type ApiProvider, type TaskParams } from '../../../src/types'
import {
  assertImageInputPayloadSize,
  getDataUrlDecodedByteSize,
} from '../../../src/lib/imageApiShared'
import { normalizeGeminiUserParams } from '../../../src/lib/paramCompatibility'
import { requireUser } from '../../utils/auth'
import { getAdminSettings } from '../../utils/admin-settings'
import { uploadThirdPartyGalleryContent } from '../../utils/gallery-upload'

const MAX_OUTPUT_IMAGES = 3
const MAX_REFERENCE_IMAGES = 16
const ALLOWED_BODY_KEYS = new Set([
  'prompt',
  'params',
  'modelId',
  'apiProvider',
  'apiModel',
  'imageDataUrls',
  'referenceImageDataUrls',
])
const ALLOWED_PARAM_KEYS = new Set([
  'size',
  'quality',
  'output_format',
  'output_compression',
  'moderation',
  'n',
  'gemini',
])
const ALLOWED_GEMINI_PARAM_KEYS = new Set([
  'mediaResolution',
  'temperature',
  'thinkingMode',
  'safetyLevel',
  'networkSearch',
])
const SAFE_MODEL_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._:/@+\- ]{0,199}$/u
const IMAGE_SIGNATURE_VALIDATORS: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/png': (bytes) => hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (bytes) => hasSignature(bytes, [0xff, 0xd8, 0xff]),
  'image/webp': (bytes) => hasSignature(bytes, [0x52, 0x49, 0x46, 0x46]) && hasSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8),
  'image/gif': (bytes) => hasSignature(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasSignature(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
}

function hasSignature(bytes: Uint8Array, signature: number[], offset = 0) {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte)
}

function badRequest(statusMessage: string): never {
  throw createError({ statusCode: 400, statusMessage })
}

function assertAllowedKeys(record: Record<string, unknown>, allowed: Set<string>, label: string) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) badRequest(`${label}包含不支持的字段：${key}`)
  }
}

function normalizeImageDataUrls(input: unknown, label: string, max: number, required = false) {
  if (input === undefined && !required) return []
  if (!Array.isArray(input)) badRequest(`${label}必须是数组`)
  if (required && input.length === 0) badRequest('没有可上传的生成图片')
  if (input.length > max) badRequest(`${label}最多允许 ${max} 张`)

  return input.map((item, index) => {
    if (typeof item !== 'string') {
      badRequest(`${label}第 ${index + 1} 张不是有效的图片 data URL`)
    }
    if (!/^data:image\//i.test(item)) {
      badRequest(`${label}第 ${index + 1} 张不是有效的图片 data URL`)
    }
    const match = item.match(/^data:([^;,]+);base64,([\s\S]+)$/i)
    if (!match) badRequest(`${label}第 ${index + 1} 张必须是 base64 图片 data URL`)

    const mime = match[1].toLowerCase()
    const validateSignature = IMAGE_SIGNATURE_VALIDATORS[mime]
    if (!validateSignature) {
      badRequest(`${label}第 ${index + 1} 张的图片格式不受支持`)
    }

    const normalized = match[2].replace(/\s/g, '')
    if (!/^[a-z0-9+/]*={0,2}$/i.test(normalized) || normalized.length % 4 === 1) {
      badRequest(`${label}第 ${index + 1} 张的 base64 编码无效`)
    }
    const header = Buffer.from(normalized.slice(0, 64), 'base64')
    if (!validateSignature(header)) {
      badRequest(`${label}第 ${index + 1} 张的内容与声明格式不匹配`)
    }
    return item
  })
}

function normalizeParams(input: unknown): TaskParams {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    badRequest('生成参数无效')
  }
  const record = input as Record<string, unknown>
  assertAllowedKeys(record, ALLOWED_PARAM_KEYS, '生成参数')

  let gemini = DEFAULT_PARAMS.gemini
  if (record.gemini !== undefined) {
    if (!record.gemini || typeof record.gemini !== 'object' || Array.isArray(record.gemini)) {
      badRequest('Gemini 生成参数无效')
    }
    assertAllowedKeys(record.gemini as Record<string, unknown>, ALLOWED_GEMINI_PARAM_KEYS, 'Gemini 生成参数')
    gemini = normalizeGeminiUserParams(record.gemini)
  }

  const size = typeof record.size === 'string' && record.size.trim()
    ? record.size.trim().slice(0, 100)
    : DEFAULT_PARAMS.size
  const quality = record.quality === 'low' || record.quality === 'medium' || record.quality === 'high' || record.quality === 'auto'
    ? record.quality
    : DEFAULT_PARAMS.quality
  const outputFormat = record.output_format === 'jpeg' || record.output_format === 'webp' || record.output_format === 'png'
    ? record.output_format
    : DEFAULT_PARAMS.output_format
  const moderation = record.moderation === 'low' || record.moderation === 'auto'
    ? record.moderation
    : DEFAULT_PARAMS.moderation
  const outputCompression = typeof record.output_compression === 'number' && Number.isFinite(record.output_compression)
    ? Math.max(0, Math.min(100, Math.floor(record.output_compression)))
    : null
  const n = Math.min(MAX_OUTPUT_IMAGES, Math.max(1, Math.floor(Number(record.n)) || DEFAULT_PARAMS.n))

  return {
    size,
    quality,
    output_format: outputFormat,
    output_compression: outputFormat === 'png' ? null : outputCompression,
    moderation,
    n,
    gemini,
  }
}

function normalizeHistoricalProvider(value: unknown): ApiProvider {
  if (value === 'openai' || value === 'fal' || value === 'google-gemini') return value
  badRequest('历史任务缺少有效的 Provider 信息')
}

function normalizeHistoricalModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : ''
  if (!SAFE_MODEL_ID_RE.test(model)) badRequest('历史任务缺少有效的模型信息')
  return model
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('请求体无效')
  assertAllowedKeys(body, ALLOWED_BODY_KEYS, '请求')

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) badRequest('请输入提示词')

  const images = normalizeImageDataUrls(body.imageDataUrls, '生成图片', MAX_OUTPUT_IMAGES, true)
  const referenceImages = normalizeImageDataUrls(body.referenceImageDataUrls, '参考图片', MAX_REFERENCE_IMAGES)
  try {
    assertImageInputPayloadSize(
      [...images, ...referenceImages].reduce((sum, dataUrl) => sum + getDataUrlDecodedByteSize(dataUrl), 0),
    )
  } catch (error) {
    throw createError({ statusCode: 413, statusMessage: getErrorMessage(error) })
  }

  const params = normalizeParams(body.params)
  const settings = await getAdminSettings()
  if (!settings.galleryUploadToken.trim()) {
    throw createError({ statusCode: 503, statusMessage: '管理员尚未配置图集上传 Token' })
  }

  const requestedModelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
  const configuredModel = requestedModelId
    ? settings.models.find((model) => model.id === requestedModelId)
    : undefined
  const provider = configuredModel?.provider ?? normalizeHistoricalProvider(body.apiProvider)
  const model = configuredModel?.model ?? normalizeHistoricalModel(body.apiModel)
  const timeoutSeconds = configuredModel?.timeout ??
    settings.models.find((item) => item.id === settings.defaultModelId)?.timeout ??
    600

  try {
    await uploadThirdPartyGalleryContent({
      uploadUrl: settings.galleryUploadUrl,
      uploadToken: settings.galleryUploadToken,
      prompt,
      params,
      provider,
      model,
      images,
      referenceImages,
      user,
      timeoutSeconds,
    })
  } catch (error) {
    const message = getErrorMessage(error)
    throw createError({
      statusCode: message === '上传图集超时' ? 504 : 502,
      statusMessage: `图集上传失败：${message}`,
    })
  }

  return { ok: true }
})
