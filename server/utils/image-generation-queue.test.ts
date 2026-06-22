import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PricingBreakdown, TaskParams } from '../../src/types'
import { DEFAULT_OPENAI_TIERED_PRICING_RULES } from '../../src/lib/pricing'
import type { AdminSettings, ServerApiConfig } from './admin-settings'
import type { AppUser } from './auth'
import {
  createImageGenerationJob,
  getImageGenerationJob,
  resetImageGenerationQueueForTests,
  serializeImageGenerationJob,
} from './image-generation-queue'

const apiMocks = vi.hoisted(() => ({
  callServerImageApi: vi.fn(),
}))
const usageMocks = vi.hoisted(() => ({
  recordGenerationUsage: vi.fn(),
}))
const galleryMocks = vi.hoisted(() => ({
  uploadThirdPartyGalleryContent: vi.fn(),
}))
const pointMocks = vi.hoisted(() => ({
  ensureDailyPointsBalance: vi.fn(),
  reserveGenerationPoints: vi.fn(),
  settleGenerationPoints: vi.fn(),
}))

vi.mock('./server-image-api', () => apiMocks)
vi.mock('./generation-usage', () => usageMocks)
vi.mock('./gallery-upload', () => galleryMocks)
vi.mock('./points', () => pointMocks)

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushPromises(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

const apiConfig: ServerApiConfig = {
  id: 'model-default',
  name: '默认模型',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'gpt-image-2',
  timeout: 10,
  apiMode: 'images',
  codexCompatible: false,
  pricingMode: 'flat',
  pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
}

const params: TaskParams = {
  size: '1024x1024',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

const user: AppUser = {
  id: 'user-a',
  account: 'user-a',
  email: null,
  username: null,
  name: null,
  avatarUrl: null,
  status: 'ACTIVE',
}

function pricing(pointsPerImage = 1, imageCount = 1): PricingBreakdown {
  return {
    mode: 'flat',
    basePoints: pointsPerImage,
    referenceImageCount: 0,
    referenceImagePoints: 0,
    maskEditApplied: false,
    maskEditPoints: 0,
    minimumPoints: pointsPerImage,
    pointsPerImage,
    imageCount,
    totalPoints: pointsPerImage * imageCount,
  }
}

const otherUser: AppUser = {
  ...user,
  id: 'user-b',
  account: 'user-b',
}

const adminUser: AppUser = {
  ...user,
  id: 'admin',
  account: 'admin',
}

function settings(overrides: Partial<AdminSettings> = {}): AdminSettings {
  return {
    models: [{ ...apiConfig, enabled: true }],
    defaultModelId: apiConfig.id,
    dailyPointsTarget: 100,
    standardPointCost: 1,
    galleryUploadDefault: false,
    hourlyImageLimit: 20,
    privacyHourlyImageLimit: 5,
    serviceConcurrentImageLimit: 1,
    userConcurrentImageLimit: 3,
    galleryUploadUrl: 'https://imglist.example.com/api/uploads/third-party',
    galleryUploadToken: '',
    updatedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({
    apiProvider: 'openai',
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    apiModel: 'gpt-image-2',
    apiMode: 'images',
    apiTimeout: '10',
    apiCodexCli: 'false',
    defaultHourlyImageLimit: '20',
    defaultPrivacyHourlyImageLimit: '5',
    defaultServiceConcurrentImageLimit: '1',
    defaultUserConcurrentImageLimit: '3',
    appDataDir: 'storage/app-data',
    storageDir: 'storage/generated-images',
  }))
  vi.clearAllMocks()
  usageMocks.recordGenerationUsage.mockResolvedValue(null)
  galleryMocks.uploadThirdPartyGalleryContent.mockResolvedValue(undefined)
  pointMocks.reserveGenerationPoints.mockResolvedValue({
    balance: 99,
    lastDailyRefillDate: '2026-05-26',
    dailyRefilled: false,
    reservedPoints: 1,
  })
  pointMocks.settleGenerationPoints.mockResolvedValue({
    balance: 98,
    chargedPoints: 1,
    refundedPoints: 0,
  })
  pointMocks.ensureDailyPointsBalance.mockResolvedValue({
    balance: 98,
    lastDailyRefillDate: '2026-05-26',
    dailyRefilled: false,
  })
  resetImageGenerationQueueForTests()
})

afterEach(() => {
  resetImageGenerationQueueForTests()
  vi.unstubAllGlobals()
})

describe('image generation queue', () => {
  it('rejects a normal user when queued and running images would exceed the account limit', async () => {
    const deferred = createDeferred({ images: ['data:image/png;base64,a'] })
    apiMocks.callServerImageApi.mockReturnValue(deferred.promise)

    await createImageGenerationJob({
      user,
      isAdmin: false,
      settings: settings({ userConcurrentImageLimit: 3 }),
      apiConfig,

      prompt: 'prompt',
      params: { ...params, n: 2 },
      inputImageDataUrls: [],
      uploadToGallery: false,
      dailyPointsTarget: 100,
      pricing: pricing(1, 2),
    })
    await flushPromises()

    await expect(createImageGenerationJob({
      user,
      isAdmin: false,
      settings: settings({ userConcurrentImageLimit: 3 }),
      apiConfig,

      prompt: 'prompt',
      params: { ...params, n: 2 },
      inputImageDataUrls: [],
      uploadToGallery: false,
      dailyPointsTarget: 100,
      pricing: pricing(1, 2),
    })).rejects.toMatchObject({
      statusCode: 429,
      statusMessage: '目前最大同时生成张数是 3，请等待生成完成后继续',
    })
  })

  it('queues normal-user images beyond the service concurrency limit and starts them FIFO', async () => {
    const first = createDeferred({ images: ['data:image/png;base64,a'] })
    const second = createDeferred({ images: ['data:image/png;base64,b'] })
    apiMocks.callServerImageApi
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstJobStatus = await createImageGenerationJob({
      user,
      isAdmin: false,
      settings: settings({ userConcurrentImageLimit: 5 }),
      apiConfig,

      prompt: 'first',
      params,
      inputImageDataUrls: [],
      uploadToGallery: false,
      dailyPointsTarget: 100,
      pricing: pricing(),
    })
    const secondJobStatus = await createImageGenerationJob({
      user: otherUser,
      isAdmin: false,
      settings: settings({ userConcurrentImageLimit: 5 }),
      apiConfig,

      prompt: 'second',
      params,
      inputImageDataUrls: [],
      uploadToGallery: false,
      dailyPointsTarget: 100,
      pricing: pricing(),
    })
    await flushPromises()

    expect(apiMocks.callServerImageApi).toHaveBeenCalledTimes(1)
    expect(serializeImageGenerationJob(getImageGenerationJob(firstJobStatus.jobId)!)).toMatchObject({
      status: 'running',
      runningImages: 1,
    })
    expect(serializeImageGenerationJob(getImageGenerationJob(secondJobStatus.jobId)!)).toMatchObject({
      status: 'queued',
      queuePosition: 1,
    })

    first.resolve({ images: ['data:image/png;base64,a'] })
    await flushPromises()

    expect(apiMocks.callServerImageApi).toHaveBeenCalledTimes(2)
    expect(serializeImageGenerationJob(getImageGenerationJob(secondJobStatus.jobId)!)).toMatchObject({
      status: 'running',
      runningImages: 1,
    })
  })

  it('does not apply service concurrency limits to admins', async () => {
    const deferred = createDeferred({ images: ['data:image/png;base64,a'] })
    apiMocks.callServerImageApi.mockReturnValue(deferred.promise)

    await createImageGenerationJob({
      user,
      isAdmin: false,
      settings: settings(),
      apiConfig,

      prompt: 'normal',
      params,
      inputImageDataUrls: [],
      uploadToGallery: false,
      dailyPointsTarget: 100,
      pricing: pricing(),
    })
    await flushPromises()

    await createImageGenerationJob({
      user: adminUser,
      isAdmin: true,
      settings: settings({ userConcurrentImageLimit: 1 }),
      apiConfig,

      prompt: 'admin',
      params: { ...params, n: 2 },
      inputImageDataUrls: [],
      uploadToGallery: false,
      dailyPointsTarget: 100,
      pricing: pricing(1, 2),
    })
    await flushPromises()

    expect(apiMocks.callServerImageApi).toHaveBeenCalledTimes(3)
  })

  it('reserves and refunds using the tiered per-image price', async () => {
    const tieredPricing: PricingBreakdown = {
      ...pricing(72000, 2),
      mode: 'tiered',
      sizeTier: '2K',
      quality: 'high',
      basePoints: 72000,
      minimumPoints: 1000,
      totalPoints: 144000,
    }
    pointMocks.reserveGenerationPoints.mockResolvedValueOnce({
      balance: 1000,
      lastDailyRefillDate: '2026-05-26',
      dailyRefilled: false,
      reservedPoints: 144000,
    })
    pointMocks.settleGenerationPoints.mockResolvedValueOnce({
      balance: 73000,
      chargedPoints: 72000,
      refundedPoints: 72000,
    })
    apiMocks.callServerImageApi
      .mockResolvedValueOnce({ images: ['data:image/png;base64,a'] })
      .mockRejectedValueOnce(new Error('HTTP 504'))

    const status = await createImageGenerationJob({
      user,
      isAdmin: false,
      settings: settings({ serviceConcurrentImageLimit: 2, userConcurrentImageLimit: 3 }),
      apiConfig,
      prompt: 'prompt',
      params: { ...params, n: 2 },
      inputImageDataUrls: [],
      uploadToGallery: false,
      dailyPointsTarget: 100,
      pricing: tieredPricing,
    })
    await flushPromises()

    expect(pointMocks.reserveGenerationPoints).toHaveBeenCalledWith(expect.objectContaining({
      requestedImages: 2,
      costPerImage: 72000,
    }))
    expect(pointMocks.settleGenerationPoints).toHaveBeenCalledWith(expect.objectContaining({
      actualImages: 1,
      costPerImage: 72000,
      reservedPoints: 144000,
    }))
    expect(serializeImageGenerationJob(getImageGenerationJob(status.jobId)!)).toMatchObject({
      status: 'done',
      chargedPoints: 72000,
      refundedPoints: 72000,
      billingMode: 'tiered',
      estimatedPoints: 144000,
      pricingBreakdown: expect.objectContaining({
        pointsPerImage: 72000,
        totalPoints: 144000,
      }),
    })
  })
})
