import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../../src/types'
import type { AdminSettings } from '../../utils/admin-settings'
import type { AppUser } from '../../utils/auth'

const readBodyMock = vi.hoisted(() => vi.fn())
const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }))
const settingsMocks = vi.hoisted(() => ({ getAdminSettings: vi.fn() }))
const galleryMocks = vi.hoisted(() => ({ uploadThirdPartyGalleryContent: vi.fn() }))
const payloadMocks = vi.hoisted(() => ({ getDataUrlDecodedByteSize: vi.fn() }))

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQ'
const WEBP_DATA_URL = 'data:image/webp;base64,UklGRgAAAABXRUJQ'

vi.mock('../../utils/auth', () => authMocks)
vi.mock('../../utils/admin-settings', () => settingsMocks)
vi.mock('../../utils/gallery-upload', () => galleryMocks)
vi.mock('../../../src/lib/imageApiShared', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/imageApiShared')>(),
  getDataUrlDecodedByteSize: payloadMocks.getDataUrlDecodedByteSize,
}))

const user: AppUser = {
  id: 'user-a',
  account: 'account-a',
  email: 'user@example.com',
  username: 'user-name',
  name: '测试用户',
  avatarUrl: null,
  status: 'ACTIVE',
}

const configuredModel = {
  id: 'configured-model',
  name: '服务端模型',
  provider: 'google-gemini' as const,
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'model-key',
  model: 'gemini-3.1-flash-image',
  timeout: 321,
  apiMode: 'geminiDeveloper' as const,
  codexCompatible: false,
  enabled: true,
  pricingMode: 'flat' as const,
  pricingRules: {
    mediaResolutionPoints: { auto: 1, low: 1, medium: 1, high: 1 },
    referenceImagePoints: 0,
    minimumPoints: 1,
    searchGroundingPointsPerCount: 0,
    searchGroundingEstimatedCountPerImage: 0,
  },
}

function createSettings(): AdminSettings {
  return {
    models: [configuredModel],
    defaultModelId: configuredModel.id,
    dailyPointsTarget: 100,
    standardPointCost: 1,
    galleryUploadDefault: false,
    hourlyImageLimit: 20,
    privacyHourlyImageLimit: 5,
    serviceConcurrentImageLimit: 3,
    userConcurrentImageLimit: 3,
    galleryUploadUrl: 'https://gallery.example.com/api/uploads/third-party',
    galleryUploadToken: 'server-upload-token',
    updatedAt: null,
  }
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    prompt: '生成一张海报',
    params: { ...DEFAULT_PARAMS, n: 2 },
    modelId: configuredModel.id,
    apiProvider: 'openai',
    apiModel: 'client-spoofed-model',
    imageDataUrls: [
      PNG_DATA_URL,
      WEBP_DATA_URL,
    ],
    referenceImageDataUrls: [
      JPEG_DATA_URL,
      PNG_DATA_URL,
    ],
    ...overrides,
  }
}

async function loadHandler() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', readBodyMock)
  return (await import('./gallery-upload.post')).default as (event: unknown) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireUser.mockResolvedValue(user)
  settingsMocks.getAdminSettings.mockResolvedValue(createSettings())
  galleryMocks.uploadThirdPartyGalleryContent.mockResolvedValue({ ok: true })
  payloadMocks.getDataUrlDecodedByteSize.mockReturnValue(16)
  readBodyMock.mockResolvedValue(validBody())
})

describe('/api/images/gallery-upload', () => {
  it('requires authentication before reading or uploading content', async () => {
    const authError = Object.assign(new Error('未登录'), { statusCode: 401 })
    authMocks.requireUser.mockRejectedValue(authError)
    const handler = await loadHandler()

    await expect(handler({ request: true })).rejects.toBe(authError)
    expect(readBodyMock).not.toHaveBeenCalled()
    expect(galleryMocks.uploadThirdPartyGalleryContent).not.toHaveBeenCalled()
  })

  it('uploads all outputs and references with server model, credentials, and user identity', async () => {
    const event = { request: true }
    const handler = await loadHandler()

    await expect(handler(event)).resolves.toEqual({ ok: true })
    expect(authMocks.requireUser).toHaveBeenCalledWith(event)
    expect(galleryMocks.uploadThirdPartyGalleryContent).toHaveBeenCalledWith({
      uploadUrl: 'https://gallery.example.com/api/uploads/third-party',
      uploadToken: 'server-upload-token',
      prompt: '生成一张海报',
      params: expect.objectContaining({ n: 2, output_format: 'png' }),
      provider: 'google-gemini',
      model: 'gemini-3.1-flash-image',
      images: validBody().imageDataUrls,
      referenceImages: validBody().referenceImageDataUrls,
      user,
      timeoutSeconds: 321,
    })
  })

  it('uses validated historical model metadata when the configured model no longer exists', async () => {
    readBodyMock.mockResolvedValue(validBody({
      modelId: 'deleted-model',
      apiProvider: 'fal',
      apiModel: 'fal-ai/flux-pro/v1.1',
    }))
    const handler = await loadHandler()

    await expect(handler({})).resolves.toEqual({ ok: true })
    expect(galleryMocks.uploadThirdPartyGalleryContent).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'fal',
      model: 'fal-ai/flux-pro/v1.1',
      timeoutSeconds: 321,
    }))
  })

  it.each([
    ['missing outputs', { imageDataUrls: [] }, '没有可上传的生成图片'],
    ['too many outputs', { imageDataUrls: Array(4).fill('data:image/png;base64,YQ==') }, '生成图片最多允许 3 张'],
    ['too many references', { referenceImageDataUrls: Array(17).fill('data:image/png;base64,YQ==') }, '参考图片最多允许 16 张'],
    ['invalid output data URL', { imageDataUrls: ['https://example.com/image.png'] }, '不是有效的图片 data URL'],
    ['invalid reference data URL', { referenceImageDataUrls: ['data:text/plain;base64,YQ=='] }, '不是有效的图片 data URL'],
    ['invalid base64 image', { imageDataUrls: ['data:image/png;base64,%%%'] }, 'base64 编码无效'],
    ['non-base64 image', { imageDataUrls: ['data:image/png,%89PNG'] }, '必须是 base64 图片 data URL'],
    ['unsupported image format', { imageDataUrls: ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='] }, '图片格式不受支持'],
    ['spoofed image content', { imageDataUrls: ['data:image/png;base64,bm90LWFuLWltYWdl'] }, '内容与声明格式不匹配'],
    ['invalid historical provider', { modelId: 'deleted', apiProvider: 'custom' }, '缺少有效的 Provider 信息'],
    ['invalid historical model', { modelId: 'deleted', apiModel: '<script>alert(1)</script>' }, '缺少有效的模型信息'],
    ['sensitive URL override', { uploadUrl: 'https://attacker.example.com/upload' }, '请求包含不支持的字段：uploadUrl'],
    ['sensitive token override', { uploadToken: 'attacker-token' }, '请求包含不支持的字段：uploadToken'],
    ['sensitive user override', { user: { id: 'other-user' } }, '请求包含不支持的字段：user'],
  ])('rejects %s', async (_label, overrides, message) => {
    readBodyMock.mockResolvedValue(validBody(overrides))
    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({ statusCode: 400, statusMessage: expect.stringContaining(message) })
    expect(galleryMocks.uploadThirdPartyGalleryContent).not.toHaveBeenCalled()
  })

  it('rejects image payloads above the shared 512 MiB limit', async () => {
    payloadMocks.getDataUrlDecodedByteSize.mockReturnValue(512 * 1024 * 1024 + 1)
    readBodyMock.mockResolvedValue(validBody({
      imageDataUrls: [PNG_DATA_URL],
      referenceImageDataUrls: [],
    }))
    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({ statusCode: 413 })
    expect(galleryMocks.uploadThirdPartyGalleryContent).not.toHaveBeenCalled()
  })

  it('reports missing server gallery configuration without accepting a client token', async () => {
    settingsMocks.getAdminSettings.mockResolvedValue({ ...createSettings(), galleryUploadToken: '' })
    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: '管理员尚未配置图集上传 Token',
    })
    expect(galleryMocks.uploadThirdPartyGalleryContent).not.toHaveBeenCalled()
  })

  it('maps third-party failures to a clear upstream error', async () => {
    galleryMocks.uploadThirdPartyGalleryContent.mockRejectedValue(new Error('上游拒绝上传'))
    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: '图集上传失败：上游拒绝上传',
    })
  })

  it('maps gallery timeouts to 504', async () => {
    galleryMocks.uploadThirdPartyGalleryContent.mockRejectedValue(new Error('上传图集超时'))
    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({
      statusCode: 504,
      statusMessage: '图集上传失败：上传图集超时',
    })
  })
})
