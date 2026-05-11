import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskParams } from '../../src/types'
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

vi.mock('./server-image-api', () => apiMocks)
vi.mock('./generation-usage', () => usageMocks)
vi.mock('./gallery-upload', () => galleryMocks)

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
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'gpt-image-2',
  timeout: 10,
  apiMode: 'images',
  codexCli: false,
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
    apiConfig,
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
      privacyMode: true,
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
      privacyMode: true,
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
      privacyMode: true,
    })
    const secondJobStatus = await createImageGenerationJob({
      user: otherUser,
      isAdmin: false,
      settings: settings({ userConcurrentImageLimit: 5 }),
      apiConfig,
      prompt: 'second',
      params,
      inputImageDataUrls: [],
      privacyMode: true,
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
      privacyMode: true,
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
      privacyMode: true,
    })
    await flushPromises()

    expect(apiMocks.callServerImageApi).toHaveBeenCalledTimes(3)
  })
})
