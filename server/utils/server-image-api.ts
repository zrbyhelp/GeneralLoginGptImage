import { fal } from '@fal-ai/client'
import type {
  FalApiResponse,
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
    size: params.size,
    output_format: params.output_format,
  }
  if (!config.codexCli) tool.quality = params.quality
  if (params.output_format !== 'png' && params.output_compression != null) {
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
  return opts.config.apiMode === 'responses'
    ? callResponsesImageApi(opts)
    : callImagesApi(opts)
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
    const successful: ServerImageApiResult[] = []
    const errors: string[] = []
    let firstError: unknown = null

    for (let index = 0; index < n; index += 1) {
      try {
        successful.push(await callImagesApi(single))
      } catch (error) {
        if (firstError == null) firstError = error
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`第 ${index + 1} 张生成失败：${message}`)
      }
    }

    if (!successful.length) {
      if (firstError) throw firstError
      throw new Error('所有串行请求均失败')
    }

    const images = successful.flatMap((result) => result.images)
    return {
      images,
      actualParams: mergeActualParams(successful[0].actualParams, { n: images.length }),
      actualParamsList: successful.flatMap((result) => result.actualParamsList ?? result.images.map(() => result.actualParams)),
      revisedPrompts: successful.flatMap((result) => result.revisedPrompts ?? result.images.map(() => undefined)),
      partialError: errors.length ? errors.join('\n') : null,
    }
  }

  const prompt = opts.config.codexCli
    ? `${PROMPT_REWRITE_GUARD_PREFIX}\n${opts.prompt}`
    : opts.prompt
  const isEdit = opts.inputImageDataUrls.length > 0
  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.config.timeout * 1000)

  try {
    let response: Response
    if (isEdit) {
      const formData = new FormData()
      formData.append('model', opts.config.model)
      formData.append('prompt', prompt)
      formData.append('size', opts.params.size)
      formData.append('output_format', opts.params.output_format)
      formData.append('moderation', opts.params.moderation)
      if (!opts.config.codexCli) formData.append('quality', opts.params.quality)
      if (opts.params.output_format !== 'png' && opts.params.output_compression != null) {
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
        size: opts.params.size,
        output_format: opts.params.output_format,
        moderation: opts.params.moderation,
      }
      if (!opts.config.codexCli) body.quality = opts.params.quality
      if (opts.params.output_format !== 'png' && opts.params.output_compression != null) {
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
    const successful: ServerImageApiResult[] = []
    const errors: string[] = []
    let firstError: unknown = null

    for (let index = 0; index < n; index += 1) {
      try {
        successful.push(await callResponsesImageApi(single))
      } catch (error) {
        if (firstError == null) firstError = error
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`第 ${index + 1} 张生成失败：${message}`)
      }
    }

    if (!successful.length) {
      if (firstError) throw firstError
      throw new Error('所有串行请求均失败')
    }

    const images = successful.flatMap((result) => result.images)
    return {
      images,
      actualParams: mergeActualParams(successful[0].actualParams, { n: images.length }),
      actualParamsList: successful.flatMap((result) => result.actualParamsList ?? result.images.map(() => result.actualParams)),
      revisedPrompts: successful.flatMap((result) => result.revisedPrompts ?? result.images.map(() => undefined)),
      partialError: errors.length ? errors.join('\n') : null,
    }
  }

  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
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
