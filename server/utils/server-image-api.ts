import { fal } from '@fal-ai/client'
import { GoogleGenAI, Modality, type Content, type GenerateContentConfig, type GoogleGenAIOptions } from '@google/genai'
import type {
  FalApiResponse,
  GeminiAdminDefaults,
  GeminiSafetyLevel,
  GeminiThinkingMode,
  GeminiUserParams,
  ImageApiResponse,
  ResponsesApiResponse,
  TaskParams,
} from '../../src/types'
import type { ServerApiConfig } from './admin-settings'

export interface ServerImageApiResult {
  images: string[]
  actualParams?: Partial<TaskParams>
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  revisedPrompts?: Array<string | undefined>
  partialError?: string | null
  searchGroundingCount?: number
}

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}
const PROMPT_REWRITE_GUARD_PREFIX = 'Use the following text as the complete prompt. Do not rewrite it:'

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function normalizeGeminiSdkBaseUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl)
  return normalized.replace(/\/v1(?:beta)?$/i, '')
}

function buildApiUrl(baseUrl: string, path: string) {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function normalizeBase64Image(value: string, fallbackMime: string) {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

function dataUrlToBlob(dataUrl: string, fallbackType = 'image/png') {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) throw new Error('图片数据格式无效')
  const mime = match[1] || fallbackType
  const payload = match[3] || ''
  const bytes = match[2]
    ? Uint8Array.from(Buffer.from(payload, 'base64'))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return new Blob([bytes], { type: mime || fallbackType })
}

function getBlobExtension(blob: Blob) {
  const type = blob.type.toLowerCase()
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/webp') return 'webp'
  return 'png'
}

async function blobToDataUrl(blob: Blob, fallbackMime: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const base64 = Buffer.from(bytes).toString('base64')
  return `data:${blob.type || fallbackMime};base64,${base64}`
}

async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal) {
  if (isDataUrl(url)) return url
  const response = await fetch(url, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  return blobToDataUrl(await response.blob(), fallbackMime)
}

async function getApiErrorMessage(response: Response) {
  let message = `HTTP ${response.status}`
  let text = ''
  try {
    text = await response.text()
  } catch {
    return message
  }

  if (!text) return message

  try {
    const body = JSON.parse(text)
    if (body?.error?.message) message = body.error.message
    else if (typeof body?.detail === 'string') message = body.detail
    else if (Array.isArray(body?.detail)) message = body.detail.map((item: unknown) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    else if (typeof body?.error === 'string') message = body.error
    else if (typeof body?.message === 'string') message = body.message
  } catch {
    message = text
  }
  return message
}

function createReadableErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (!/<html[\s>]/i.test(message) && !/<!doctype html/i.test(message)) return message
  const withoutTags = message
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return withoutTags ? withoutTags.slice(0, 500) : '上游返回 HTML 错误页面'
}

function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}
  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high') actualParams.quality = record.quality
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp') actualParams.output_format = record.output_format
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n
  return actualParams
}

function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>) {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged as Partial<TaskParams> : undefined
}

function dataUrlToInlineData(dataUrl: string, fallbackType = 'image/png') {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) throw new Error('图片数据格式无效')
  const mimeType = match[1] || fallbackType
  const payload = match[3] || ''
  const data = match[2]
    ? payload
    : Buffer.from(decodeURIComponent(payload)).toString('base64')
  return { mimeType, data }
}

function mergeConcurrentResults(results: PromiseSettledResult<ServerImageApiResult>[]) {
  const successful = results
    .filter((result): result is PromiseFulfilledResult<ServerImageApiResult> => result.status === 'fulfilled')
    .map((result) => result.value)
  const errors = results
    .map((result, index) => {
      if (result.status === 'fulfilled') return null
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      return `第 ${index + 1} 张生成失败：${message}`
    })
    .filter((message): message is string => Boolean(message))

  if (!successful.length) {
    const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (firstError) throw firstError.reason
    throw new Error('所有并发请求均失败')
  }

  const images = successful.flatMap((result) => result.images)
  return {
    images,
    actualParams: mergeActualParams(successful[0].actualParams, { n: images.length }),
    actualParamsList: successful.flatMap((result) => result.actualParamsList ?? result.images.map(() => result.actualParams)),
    revisedPrompts: successful.flatMap((result) => result.revisedPrompts ?? result.images.map(() => undefined)),
    partialError: errors.length ? errors.join('\n') : null,
    searchGroundingCount: successful.reduce((sum, result) => sum + Math.max(0, Math.floor(Number(result.searchGroundingCount) || 0)), 0),
  }
}

function createRequestHeaders(config: ServerApiConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Cache-Control': 'no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
  }
}

function createResponsesImageTool(params: TaskParams, isEdit: boolean, config: ServerApiConfig, maskDataUrl?: string) {
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    action: isEdit ? 'edit' : 'generate',
  }
  if (!config.codexCompatible) {
    tool.size = params.size
    tool.output_format = params.output_format
    tool.quality = params.quality
  }
  if (!config.codexCompatible && params.output_format !== 'png' && params.output_compression != null) {
    tool.output_compression = params.output_compression
  }
  if (maskDataUrl) {
    tool.input_image_mask = { image_url: maskDataUrl }
  }
  return tool
}

function createResponsesInput(prompt: string, inputImageDataUrls: string[]) {
  const text = `${PROMPT_REWRITE_GUARD_PREFIX}\n${prompt}`
  if (!inputImageDataUrls.length) return text
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text },
        ...inputImageDataUrls.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl })),
      ],
    },
  ]
}

function parseResponsesImageResults(payload: ResponsesApiResponse, fallbackMime: string) {
  const output = payload.output
  if (!Array.isArray(output) || !output.length) throw new Error('接口未返回图片数据')

  const results: Array<{ image: string; actualParams?: Partial<TaskParams>; revisedPrompt?: string }> = []
  for (const item of output) {
    if (item?.type !== 'image_generation_call') continue
    if (typeof item.result === 'string' && item.result.trim()) {
      results.push({
        image: normalizeBase64Image(item.result, fallbackMime),
        actualParams: mergeActualParams(pickActualParams(item)),
        revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
      })
    }
  }
  if (!results.length) throw new Error('接口未返回可用图片数据')
  return results
}

export async function callServerImageApi(opts: {
  config: ServerApiConfig
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
}): Promise<ServerImageApiResult> {
  if (opts.config.provider === 'fal') return callFalImageApi(opts)
  if (opts.config.provider === 'google-gemini') return callGeminiGenerateContentApi(opts)
  return opts.config.apiMode === 'responses'
    ? callResponsesImageApi(opts)
    : callImagesApi(opts)
}

function mapGeminiMediaResolution(value: GeminiUserParams['mediaResolution'] | undefined) {
  if (value === 'low') return 'MEDIA_RESOLUTION_LOW'
  if (value === 'medium') return 'MEDIA_RESOLUTION_MEDIUM'
  if (value === 'high') return 'MEDIA_RESOLUTION_HIGH'
  return undefined
}

function mapGeminiThinkingConfig(mode: GeminiThinkingMode | undefined) {
  if (mode === 'off') return { thinkingLevel: 'minimal' }
  if (mode === 'low') return { thinkingLevel: 'low' }
  if (mode === 'high') return { thinkingLevel: 'high' }
  return undefined
}

function mapGeminiSafetySettings(level: GeminiSafetyLevel | undefined) {
  const threshold = level === 'strict'
    ? 'BLOCK_LOW_AND_ABOVE'
    : level === 'balanced'
      ? 'BLOCK_MEDIUM_AND_ABOVE'
      : level === 'relaxed'
        ? 'BLOCK_ONLY_HIGH'
        : null
  if (!threshold) return undefined
  return [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map((category) => ({ category, threshold }))
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) =>
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && !value.trim()) &&
      !(Array.isArray(value) && value.length === 0),
    ),
  )
}

function createGeminiGenerationConfig(params: TaskParams, defaults?: GeminiAdminDefaults, options: { vertexMode?: boolean } = {}): GenerateContentConfig {
  const gemini = params.gemini
  const mediaResolution = mapGeminiMediaResolution(gemini?.mediaResolution)
  const generationConfig: Record<string, unknown> = {
    ...(defaults?.generationConfig ?? {}),
    responseModalities: [Modality.TEXT, Modality.IMAGE],
    candidateCount: 1,
    mediaResolution,
  }

  if (gemini?.temperature != null) generationConfig.temperature = gemini.temperature
  if (defaults?.topP != null) generationConfig.topP = defaults.topP
  if (defaults?.topK != null) generationConfig.topK = defaults.topK
  if (defaults?.maxOutputTokens != null) generationConfig.maxOutputTokens = defaults.maxOutputTokens
  if (defaults?.seed != null) generationConfig.seed = defaults.seed
  if (defaults?.responseMimeType) generationConfig.responseMimeType = defaults.responseMimeType
  if (defaults?.imageConfig) generationConfig.imageConfig = defaults.imageConfig

  if (!options.vertexMode) {
    const userThinkingConfig = mapGeminiThinkingConfig(gemini?.thinkingMode)
    const thinkingConfig = userThinkingConfig ?? defaults?.thinkingConfig
    if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig
  }

  return compactRecord(generationConfig) as GenerateContentConfig
}

function createGeminiSafetySettings(params: TaskParams, defaults?: GeminiAdminDefaults) {
  return mapGeminiSafetySettings(params.gemini?.safetyLevel) ?? defaults?.safetySettings ?? undefined
}

function readGeminiInlineImagePart(part: unknown, fallbackMime = 'image/png') {
  if (!part || typeof part !== 'object') return null
  const record = part as Record<string, unknown>
  const inlineData = (record.inlineData ?? record.inline_data) as Record<string, unknown> | undefined
  if (!inlineData || typeof inlineData !== 'object') return null
  const data = inlineData.data
  if (typeof data !== 'string' || !data.trim()) return null
  const mimeType = typeof inlineData.mimeType === 'string'
    ? inlineData.mimeType
    : typeof inlineData.mime_type === 'string'
      ? inlineData.mime_type
      : fallbackMime
  return normalizeBase64Image(data, mimeType || fallbackMime)
}

function parseGeminiImageResults(payload: unknown, maxImages = Number.POSITIVE_INFINITY) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const candidates = Array.isArray(record.candidates) ? record.candidates : []
  const parts: unknown[] = []
  for (const candidate of candidates) {
    const candidateRecord = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
    const content = candidateRecord.content && typeof candidateRecord.content === 'object'
      ? candidateRecord.content as Record<string, unknown>
      : {}
    if (Array.isArray(content.parts)) parts.push(...content.parts)
  }
  if (!parts.length && Array.isArray(record.parts)) parts.push(...record.parts)

  const images = parts
    .map((part) => readGeminiInlineImagePart(part))
    .filter((image): image is string => Boolean(image))
    .slice(0, maxImages)
  if (!images.length) throw new Error('Gemini 未返回可用图片数据')
  return images
}

function parseGeminiSearchGroundingCount(payload: unknown) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const candidates = Array.isArray(record.candidates) ? record.candidates : []
  const queries = new Set<string>()
  for (const candidate of candidates) {
    const candidateRecord = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
    const metadata = candidateRecord.groundingMetadata && typeof candidateRecord.groundingMetadata === 'object'
      ? candidateRecord.groundingMetadata as Record<string, unknown>
      : candidateRecord.grounding_metadata && typeof candidateRecord.grounding_metadata === 'object'
        ? candidateRecord.grounding_metadata as Record<string, unknown>
        : null
    const webSearchQueries = metadata
      ? metadata.webSearchQueries ?? metadata.web_search_queries
      : undefined
    if (!Array.isArray(webSearchQueries)) continue
    for (const query of webSearchQueries) {
      if (typeof query === 'string' && query.trim()) queries.add(query.trim())
    }
  }
  return queries.size
}

async function callGeminiGenerateContentApi(opts: {
  config: ServerApiConfig
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
}): Promise<ServerImageApiResult> {
  if (opts.maskDataUrl) throw new Error('Google Gemini 暂不支持遮罩编辑')

  const n = Math.max(1, opts.params.n || 1)
  if (n > 1) {
    const single = { ...opts, params: { ...opts.params, n: 1 } }
    const results = await Promise.allSettled(
      Array.from({ length: n }, () => callGeminiGenerateContentApi(single)),
    )
    return mergeConcurrentResults(results)
  }

  const parts: Content['parts'] = [
    { text: opts.prompt },
    ...opts.inputImageDataUrls.map((dataUrl) => ({
      inlineData: dataUrlToInlineData(dataUrl),
    })),
  ]
  const safetySettings = createGeminiSafetySettings(opts.params, opts.config.geminiDefaults)
  const config = compactRecord({
    ...createGeminiGenerationConfig(opts.params, opts.config.geminiDefaults, { vertexMode: opts.config.apiMode === 'geminiVertex' }),
    safetySettings,
    tools: opts.params.gemini?.networkSearch ? [{ googleSearch: {} }] : undefined,
  }) as GenerateContentConfig
  const clientOptions: GoogleGenAIOptions = {
    apiKey: opts.config.apiKey,
    vertexai: opts.config.apiMode === 'geminiVertex' ? true : undefined,
    httpOptions: {
      baseUrl: normalizeGeminiSdkBaseUrl(opts.config.baseUrl),
      apiVersion: opts.config.apiMode === 'geminiVertex' ? 'v1' : 'v1beta',
      timeout: opts.config.timeout * 1000,
    },
  }

  try {
    const client = new GoogleGenAI(clientOptions)
    const payload = await client.models.generateContent({
      model: opts.config.model,
      contents: {
        role: 'user',
        parts,
      },
      config,
    })
    const images = parseGeminiImageResults(payload, 1)
    const searchGroundingCount = opts.params.gemini?.networkSearch
      ? parseGeminiSearchGroundingCount(payload)
      : 0
    const actualParams = mergeActualParams({ n: images.length, gemini: opts.params.gemini })
    return {
      images,
      actualParams,
      actualParamsList: images.map(() => actualParams),
      revisedPrompts: images.map(() => undefined),
      searchGroundingCount,
    }
  } catch (error) {
    throw new Error(createReadableErrorMessage(error))
  }
}

async function callImagesApi(opts: {
  config: ServerApiConfig
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
}) {
  const n = Math.max(1, opts.params.n || 1)
  if (n > 1) {
    const single = { ...opts, params: { ...opts.params, n: 1 } }
    const results = await Promise.allSettled(
      Array.from({ length: n }, () => callImagesApi(single)),
    )
    return mergeConcurrentResults(results)
  }

  const prompt = opts.config.codexCompatible
    ? `${PROMPT_REWRITE_GUARD_PREFIX}\n${opts.prompt}`
    : opts.prompt
  const isEdit = opts.inputImageDataUrls.length > 0
  const mime = opts.config.codexCompatible ? 'image/png' : MIME_MAP[opts.params.output_format] || 'image/png'
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.config.timeout * 1000)

  try {
    let response: Response
    if (isEdit) {
      const formData = new FormData()
      formData.append('model', opts.config.model)
      formData.append('prompt', prompt)
      if (!opts.config.codexCompatible) {
        formData.append('size', opts.params.size)
        formData.append('output_format', opts.params.output_format)
        formData.append('moderation', opts.params.moderation)
        formData.append('quality', opts.params.quality)
      }
      if (!opts.config.codexCompatible && opts.params.output_format !== 'png' && opts.params.output_compression != null) {
        formData.append('output_compression', String(opts.params.output_compression))
      }
      if (opts.params.n > 1) formData.append('n', String(opts.params.n))

      opts.inputImageDataUrls.forEach((dataUrl, index) => {
        const blob = dataUrlToBlob(dataUrl)
        formData.append('image[]', blob, `input-${index + 1}.${getBlobExtension(blob)}`)
      })
      if (opts.maskDataUrl) {
        formData.append('mask', dataUrlToBlob(opts.maskDataUrl, 'image/png'), 'mask.png')
      }

      response = await fetch(buildApiUrl(opts.config.baseUrl, 'images/edits'), {
        method: 'POST',
        headers: createRequestHeaders(opts.config),
        body: formData,
        signal: controller.signal,
        cache: 'no-store',
      })
    } else {
      const body: Record<string, unknown> = {
        model: opts.config.model,
        prompt,
      }
      if (!opts.config.codexCompatible) {
        body.size = opts.params.size
        body.output_format = opts.params.output_format
        body.moderation = opts.params.moderation
        body.quality = opts.params.quality
      }
      if (!opts.config.codexCompatible && opts.params.output_format !== 'png' && opts.params.output_compression != null) {
        body.output_compression = opts.params.output_compression
      }
      if (opts.params.n > 1) body.n = opts.params.n

      response = await fetch(buildApiUrl(opts.config.baseUrl, 'images/generations'), {
        method: 'POST',
        headers: {
          ...createRequestHeaders(opts.config),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      })
    }

    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    const payload = await response.json() as ImageApiResponse
    const data = payload.data
    if (!Array.isArray(data) || !data.length) throw new Error('接口未返回图片数据')

    const images: string[] = []
    const revisedPrompts: Array<string | undefined> = []
    for (const item of data) {
      if (item.b64_json) {
        images.push(normalizeBase64Image(item.b64_json, mime))
        revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
      } else if (isHttpUrl(item.url) || isDataUrl(item.url)) {
        images.push(await fetchImageUrlAsDataUrl(item.url, mime, controller.signal))
        revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
      }
    }
    if (!images.length) throw new Error('接口未返回可用图片数据')

    const actualParams = mergeActualParams(pickActualParams(payload), { n: images.length })
    return {
      images,
      actualParams,
      actualParamsList: images.map(() => actualParams),
      revisedPrompts,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function callResponsesImageApi(opts: {
  config: ServerApiConfig
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
}): Promise<ServerImageApiResult> {
  const n = Math.max(1, opts.params.n || 1)
  if (n > 1) {
    const single = { ...opts, params: { ...opts.params, n: 1 } }
    const results = await Promise.allSettled(
      Array.from({ length: n }, () => callResponsesImageApi(single)),
    )
    return mergeConcurrentResults(results)
  }

  const mime = opts.config.codexCompatible ? 'image/png' : MIME_MAP[opts.params.output_format] || 'image/png'
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.config.timeout * 1000)
  try {
    const response = await fetch(buildApiUrl(opts.config.baseUrl, 'responses'), {
      method: 'POST',
      headers: {
        ...createRequestHeaders(opts.config),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.config.model,
        input: createResponsesInput(opts.prompt, opts.inputImageDataUrls),
        tools: [createResponsesImageTool(opts.params, opts.inputImageDataUrls.length > 0, opts.config, opts.maskDataUrl)],
        tool_choice: 'required',
      }),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    const imageResults = parseResponsesImageResults(await response.json() as ResponsesApiResponse, mime)
    const actualParams = mergeActualParams(imageResults[0]?.actualParams, { n: imageResults.length })
    return {
      images: imageResults.map((result) => result.image),
      actualParams,
      actualParamsList: imageResults.map((result) => result.actualParams),
      revisedPrompts: imageResults.map((result) => result.revisedPrompt),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function mapFalEndpoint(model: string, isEdit: boolean) {
  const normalized = model.trim().replace(/^\/+/, '').replace(/\/+$/, '') || 'openai/gpt-image-2'
  return isEdit && !normalized.endsWith('/edit') ? `${normalized}/edit` : normalized
}

async function mapFalImageSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/)
  if (match) return { width: Number(match[1]), height: Number(match[2]) }
  return { width: 1360, height: 1024 }
}

function mapFalQuality(quality: TaskParams['quality']) {
  return quality === 'auto' ? 'high' : quality
}

function readFalImageValue(value: unknown, fallbackMime: string) {
  if (typeof value === 'string') {
    if (isHttpUrl(value) || isDataUrl(value)) return value
    return normalizeBase64Image(value, fallbackMime)
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (isHttpUrl(record.url) || isDataUrl(record.url)) return record.url
  if (typeof record.b64_json === 'string') return normalizeBase64Image(record.b64_json, fallbackMime)
  if (typeof record.base64 === 'string') return normalizeBase64Image(record.base64, fallbackMime)
  if (typeof record.data === 'string') return normalizeBase64Image(record.data, fallbackMime)
  return null
}

async function parseFalImages(payload: FalApiResponse, fallbackMime: string) {
  const candidates: unknown[] = []
  if (Array.isArray(payload.images)) candidates.push(...payload.images)
  if (payload.image) candidates.push(payload.image)
  if (payload.url) candidates.push(payload.url)

  const images: string[] = []
  for (const candidate of candidates) {
    const value = readFalImageValue(candidate, fallbackMime)
    if (!value) continue
    images.push(isHttpUrl(value) ? await fetchImageUrlAsDataUrl(value, fallbackMime) : value)
  }
  if (!images.length) throw new Error('fal.ai 未返回可用图片数据')
  return images
}

async function callFalImageApi(opts: {
  config: ServerApiConfig
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
}): Promise<ServerImageApiResult> {
  fal.config({
    credentials: opts.config.apiKey,
    suppressLocalCredentialsWarning: true,
  })

  const isEdit = opts.inputImageDataUrls.length > 0
  const imageSize = await mapFalImageSize(opts.params.size)
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    image_size: imageSize,
    quality: mapFalQuality(opts.params.quality),
    num_images: Math.min(3, Math.max(1, opts.params.n || 1)),
    output_format: opts.params.output_format,
  }
  if (isEdit) input.image_urls = opts.inputImageDataUrls
  if (opts.maskDataUrl) input.mask_url = opts.maskDataUrl

  const endpoint = mapFalEndpoint(opts.config.model, isEdit)
  const result = await fal.subscribe(endpoint, { input, logs: true })
  const images = await parseFalImages(result.data as FalApiResponse, MIME_MAP[opts.params.output_format] || 'image/png')
  const actualParams = mergeActualParams({
    size: `${imageSize.width}x${imageSize.height}`,
    quality: mapFalQuality(opts.params.quality) as TaskParams['quality'],
    output_format: opts.params.output_format,
    n: images.length,
  })
  return {
    images,
    actualParams,
    actualParamsList: images.map(() => actualParams),
    revisedPrompts: images.map(() => undefined),
  }
}
