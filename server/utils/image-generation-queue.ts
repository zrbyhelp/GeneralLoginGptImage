import { createError } from 'h3'
import type { TaskParams } from '../../src/types'
import type { AppUser } from './auth'
import { generateId } from './crypto'
import type { AdminSettings, ServerApiConfig } from './admin-settings'
import { callServerImageApi, type ServerImageApiResult } from './server-image-api'
import { recordGenerationUsage } from './generation-usage'
import { uploadThirdPartyGalleryContent } from './gallery-upload'

type UnitStatus = 'queued' | 'running' | 'done' | 'error'
export type ImageGenerationJobStatus = 'queued' | 'running' | 'done' | 'error'

interface ImageGenerationUnit {
  index: number
  status: UnitStatus
  startedAt: number | null
  finishedAt: number | null
  result: ServerImageApiResult | null
  error: string | null
}

interface ImageGenerationJob {
  id: string
  user: AppUser
  isAdmin: boolean
  settings: AdminSettings
  apiConfig: ServerApiConfig
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
  privacyMode: boolean
  units: ImageGenerationUnit[]
  status: ImageGenerationJobStatus
  error: string | null
  result: (ServerImageApiResult & {
    apiProvider: ServerApiConfig['provider']
    apiProfileName: string
    apiModel: string
    privacyMode: boolean
    galleryUploadError: string | null
  }) | null
  createdAt: number
  finishedAt: number | null
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

export interface PublicImageGenerationJobStatus {
  jobId: string
  status: ImageGenerationJobStatus
  queuePosition: number | null
  totalImages: number
  completedImages: number
  runningImages: number
  queuedImages: number
  error: string | null
  images?: string[]
  actualParams?: Partial<TaskParams>
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  revisedPrompts?: Array<string | undefined>
  partialError?: string | null
  apiProvider?: ServerApiConfig['provider']
  apiProfileName?: string
  apiModel?: string
  galleryUploadError?: string | null
  privacyMode?: boolean
}

const JOB_CLEANUP_MS = 30 * 60 * 1000
const jobs = new Map<string, ImageGenerationJob>()
let scheduling = false
let scheduleAgain = false
let serviceConcurrentImageLimit = 3

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createUnits(count: number): ImageGenerationUnit[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  }))
}

function getCompletedUnitCount(job: ImageGenerationJob) {
  return job.units.filter((unit) => unit.status === 'done' || unit.status === 'error').length
}

function getRunningUnitCount(job: ImageGenerationJob) {
  return job.units.filter((unit) => unit.status === 'running').length
}

function getQueuedUnitCount(job: ImageGenerationJob) {
  return job.units.filter((unit) => unit.status === 'queued').length
}

function countNormalActiveUnits() {
  let count = 0
  for (const job of jobs.values()) {
    if (job.isAdmin) continue
    count += getRunningUnitCount(job)
  }
  return count
}

function countUserUnfinishedUnits(userId: string) {
  let count = 0
  for (const job of jobs.values()) {
    if (job.user.id !== userId) continue
    if (job.status === 'done' || job.status === 'error') continue
    count += job.units.filter((unit) => unit.status === 'queued' || unit.status === 'running').length
  }
  return count
}

function getFirstQueuedNormalUnit() {
  for (const job of jobs.values()) {
    if (job.isAdmin || job.status === 'done' || job.status === 'error') continue
    const unit = job.units.find((item) => item.status === 'queued')
    if (unit) return { job, unit }
  }
  return null
}

function getQueuePosition(job: ImageGenerationJob) {
  if (job.isAdmin) return null
  const ownQueuedUnit = job.units.find((unit) => unit.status === 'queued')
  if (!ownQueuedUnit) return null

  let position = 1
  for (const candidateJob of jobs.values()) {
    if (candidateJob.isAdmin || candidateJob.status === 'done' || candidateJob.status === 'error') continue
    for (const unit of candidateJob.units) {
      if (unit.status !== 'queued') continue
      if (candidateJob.id === job.id && unit.index === ownQueuedUnit.index) return position
      position += 1
    }
  }
  return null
}

function refreshJobStatus(job: ImageGenerationJob) {
  if (job.status === 'done' || job.status === 'error') return
  const running = getRunningUnitCount(job)
  const queued = getQueuedUnitCount(job)
  if (running > 0) {
    job.status = 'running'
  } else if (queued > 0) {
    job.status = 'queued'
  }
}

function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>) {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged as Partial<TaskParams> : undefined
}

async function finishJobIfComplete(job: ImageGenerationJob) {
  if (job.status === 'done' || job.status === 'error') return
  if (job.units.some((unit) => unit.status === 'queued' || unit.status === 'running')) {
    refreshJobStatus(job)
    return
  }

  const successful = job.units
    .filter((unit) => unit.status === 'done' && unit.result)
    .sort((a, b) => a.index - b.index)
  const errors = job.units
    .filter((unit) => unit.status === 'error')
    .sort((a, b) => a.index - b.index)
    .map((unit) => `第 ${unit.index + 1} 张生成失败：${unit.error || '未知错误'}`)

  job.finishedAt = Date.now()
  if (!successful.length) {
    job.status = 'error'
    job.error = errors[0] || '生成失败'
    scheduleCleanup(job)
    return
  }

  const images = successful.flatMap((unit) => unit.result?.images ?? [])
  const actualParamsList = successful.flatMap((unit) =>
    unit.result?.actualParamsList ?? (unit.result?.images ?? []).map(() => unit.result?.actualParams),
  )
  const revisedPrompts = successful.flatMap((unit) =>
    unit.result?.revisedPrompts ?? (unit.result?.images ?? []).map(() => undefined),
  )
  const firstActualParams = successful[0]?.result?.actualParams
  let galleryUploadError: string | null = null

  if (images.length > 0) {
    await recordGenerationUsage({
      userId: job.user.id,
      imageCount: images.length,
      privacyMode: job.privacyMode,
    })
  }

  if (!job.privacyMode && images.length > 0) {
    try {
      await uploadThirdPartyGalleryContent({
        uploadUrl: job.settings.galleryUploadUrl,
        uploadToken: job.settings.galleryUploadToken,
        prompt: job.prompt,
        params: job.params,
        provider: job.apiConfig.provider,
        model: job.apiConfig.model,
        images,
        referenceImages: job.inputImageDataUrls,
        user: job.user,
        timeoutSeconds: job.apiConfig.timeout,
      })
    } catch (error) {
      galleryUploadError = getMessage(error)
    }
  }

  job.status = 'done'
  job.error = null
  job.result = {
    images,
    actualParams: mergeActualParams(firstActualParams, { n: images.length }),
    actualParamsList,
    revisedPrompts,
    partialError: errors.length ? errors.join('\n') : null,
    apiProvider: job.apiConfig.provider,
    apiProfileName: '统一配置',
    apiModel: job.apiConfig.model,
    privacyMode: job.privacyMode,
    galleryUploadError,
  }
  scheduleCleanup(job)
}

function scheduleCleanup(job: ImageGenerationJob) {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer)
  job.cleanupTimer = setTimeout(() => {
    jobs.delete(job.id)
  }, JOB_CLEANUP_MS)
}

async function runUnit(job: ImageGenerationJob, unit: ImageGenerationUnit) {
  try {
    const result = await callServerImageApi({
      config: job.apiConfig,
      prompt: job.prompt,
      params: { ...job.params, n: 1 },
      inputImageDataUrls: job.inputImageDataUrls,
      maskDataUrl: job.maskDataUrl,
    })

    if (!result.images.length) throw new Error('接口未返回可用图片数据')
    unit.result = result
    unit.status = 'done'
    unit.error = null
  } catch (error) {
    unit.status = 'error'
    unit.error = getMessage(error)
  } finally {
    unit.finishedAt = Date.now()
    await finishJobIfComplete(job)
    void scheduleImageGenerationQueue()
  }
}

function startUnit(job: ImageGenerationJob, unit: ImageGenerationUnit) {
  unit.status = 'running'
  unit.startedAt = Date.now()
  job.status = 'running'
  void runUnit(job, unit)
}

async function scheduleImageGenerationQueue() {
  if (scheduling) {
    scheduleAgain = true
    return
  }

  scheduling = true
  try {
    for (const job of jobs.values()) {
      if (!job.isAdmin || job.status === 'done' || job.status === 'error') continue
      for (const unit of job.units.filter((item) => item.status === 'queued')) {
        startUnit(job, unit)
      }
    }

    while (countNormalActiveUnits() < serviceConcurrentImageLimit) {
      const next = getFirstQueuedNormalUnit()
      if (!next) break
      startUnit(next.job, next.unit)
    }

    for (const job of jobs.values()) refreshJobStatus(job)
  } finally {
    scheduling = false
    if (scheduleAgain) {
      scheduleAgain = false
      void scheduleImageGenerationQueue()
    }
  }
}

export async function createImageGenerationJob(input: {
  user: AppUser
  isAdmin: boolean
  settings: AdminSettings
  apiConfig: ServerApiConfig
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
  privacyMode: boolean
}) {
  const totalImages = Math.max(1, Math.floor(Number(input.params.n) || 1))
  serviceConcurrentImageLimit = input.settings.serviceConcurrentImageLimit
  if (!input.isAdmin) {
    const unfinished = countUserUnfinishedUnits(input.user.id)
    if (unfinished + totalImages > input.settings.userConcurrentImageLimit) {
      throw createError({
        statusCode: 429,
        statusMessage: `目前最大同时生成张数是 ${input.settings.userConcurrentImageLimit}，请等待生成完成后继续`,
        data: {
          reason: 'userConcurrentImageLimit',
          current: unfinished,
          requested: totalImages,
          limit: input.settings.userConcurrentImageLimit,
        },
      })
    }
  }

  const job: ImageGenerationJob = {
    id: generateId('job'),
    user: input.user,
    isAdmin: input.isAdmin,
    settings: input.settings,
    apiConfig: input.apiConfig,
    prompt: input.prompt,
    params: { ...input.params, n: totalImages },
    inputImageDataUrls: input.inputImageDataUrls,
    maskDataUrl: input.maskDataUrl,
    privacyMode: input.privacyMode,
    units: createUnits(totalImages),
    status: 'queued',
    error: null,
    result: null,
    createdAt: Date.now(),
    finishedAt: null,
    cleanupTimer: null,
  }

  jobs.set(job.id, job)
  void scheduleImageGenerationQueue()
  return serializeImageGenerationJob(job)
}

export function getImageGenerationJob(jobId: string) {
  return jobs.get(jobId) ?? null
}

export function canReadImageGenerationJob(user: AppUser, job: ImageGenerationJob) {
  return job.user.id === user.id
}

export function serializeImageGenerationJob(job: ImageGenerationJob): PublicImageGenerationJobStatus {
  refreshJobStatus(job)
  const payload: PublicImageGenerationJobStatus = {
    jobId: job.id,
    status: job.status,
    queuePosition: getQueuePosition(job),
    totalImages: job.units.length,
    completedImages: getCompletedUnitCount(job),
    runningImages: getRunningUnitCount(job),
    queuedImages: getQueuedUnitCount(job),
    error: job.error,
  }

  if (job.status === 'done' && job.result) {
    return {
      ...payload,
      ...job.result,
    }
  }

  return payload
}

export function resetImageGenerationQueueForTests() {
  for (const job of jobs.values()) {
    if (job.cleanupTimer) clearTimeout(job.cleanupTimer)
  }
  jobs.clear()
  scheduling = false
  scheduleAgain = false
  serviceConcurrentImageLimit = 3
}
