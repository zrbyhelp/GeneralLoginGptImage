import {
  getApiErrorMessage,
  type CallApiOptions,
  type CallApiResult,
  type ImageGenerationJobStatus,
} from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export class ImageApiError extends Error {
  statusCode: number
  data: unknown

  constructor(message: string, statusCode: number, data?: unknown) {
    super(message)
    this.name = 'ImageApiError'
    this.statusCode = statusCode
    this.data = data
  }
}

const JOB_POLL_INTERVAL_MS = 1500

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

async function parseApiError(response: Response) {
  let data: unknown
  let message = `HTTP ${response.status}`
  try {
    const text = await response.text()
    if (text) {
      try {
        data = JSON.parse(text)
        const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
        const errorRecord = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null
        if (errorRecord && typeof errorRecord.message === 'string') message = errorRecord.message
        else if (typeof record.statusMessage === 'string') message = record.statusMessage
        else if (typeof record.message === 'string') message = record.message
        else if (typeof record.error === 'string') message = record.error
      } catch {
        message = text
      }
    }
  } catch {
    message = await getApiErrorMessage(response)
  }
  return new ImageApiError(message, response.status, data)
}

function isJobStatus(payload: unknown): payload is ImageGenerationJobStatus {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  return typeof record.jobId === 'string' && typeof record.status === 'string'
}

function isImmediateResult(payload: unknown): payload is CallApiResult {
  return Boolean(payload && typeof payload === 'object' && Array.isArray((payload as { images?: unknown }).images))
}

async function readJsonResponse(response: Response) {
  if (!response.ok) throw await parseApiError(response)
  return response.json() as Promise<unknown>
}

export async function pollImageGenerationJob(
  jobId: string,
  opts: Pick<CallApiOptions, 'onQueueStatusChange'> = {},
): Promise<CallApiResult> {
  while (true) {
    const response = await fetch(`/api/images/jobs/${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
    })
    const payload = await readJsonResponse(response)

    if (!isJobStatus(payload)) {
      throw new Error('生成任务状态响应无效')
    }

    opts.onQueueStatusChange?.(payload)

    if (payload.status === 'done') {
      if (!isImmediateResult(payload)) throw new Error('生成任务完成但未返回图片')
      return payload
    }

    if (payload.status === 'error') {
      throw new Error(payload.error || '生成失败')
    }

    await delay(JOB_POLL_INTERVAL_MS)
  }
}

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const response = await fetch('/api/images/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      prompt: opts.prompt,
      params: opts.params,
      inputImageDataUrls: opts.inputImageDataUrls,
      maskDataUrl: opts.maskDataUrl,
      privacyMode: Boolean(opts.privacyMode),
    }),
  })

  const payload = await readJsonResponse(response)

  if (isImmediateResult(payload)) return payload
  if (!isJobStatus(payload)) throw new Error('生成任务响应无效')

  opts.onQueueStatusChange?.(payload)
  if (payload.status === 'done') {
    if (!isImmediateResult(payload)) throw new Error('生成任务完成但未返回图片')
    return payload
  }
  if (payload.status === 'error') {
    throw new Error(payload.error || '生成失败')
  }

  return pollImageGenerationJob(payload.jobId, opts)
}
