import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../../src/types'
import { DEFAULT_GEMINI_TIERED_PRICING_RULES, DEFAULT_OPENAI_TIERED_PRICING_RULES } from '../../../src/lib/pricing'
import type { AdminSettings } from '../../utils/admin-settings'
import type { AppUser } from '../../utils/auth'

const readBodyMock = vi.hoisted(() => vi.fn())
const authMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isAdminUser: vi.fn(),
}))
const adminSettingsMocks = vi.hoisted(() => ({
  assertApiConfigUsable: vi.fn(),
  getAdminSettings: vi.fn(),
  selectGenerationModel: vi.fn(),
}))
const usageMocks = vi.hoisted(() => ({
  countRecentGeneratedImages: vi.fn(),
}))
const queueMocks = vi.hoisted(() => ({
  createImageGenerationJob: vi.fn(),
}))

vi.mock('../../utils/auth', () => authMocks)
vi.mock('../../utils/admin-settings', () => adminSettingsMocks)
vi.mock('../../utils/generation-usage', () => usageMocks)
vi.mock('../../utils/image-generation-queue', () => queueMocks)

const user: AppUser = {
  id: 'user-a',
  account: 'user-a',
  email: null,
  username: null,
  name: null,
  avatarUrl: null,
  status: 'ACTIVE',
}

const flatModel = {
  id: 'flat',
  name: '固定模型',
  provider: 'openai' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'key',
  model: 'gpt-image-2',
  timeout: 600,
  apiMode: 'images' as const,
  codexCompatible: false,
  enabled: true,
  pricingMode: 'flat' as const,
  pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
}

const tieredModel = {
  ...flatModel,
  id: 'tiered',
  name: '官方 OpenAI',
  pricingMode: 'tiered' as const,
}

const geminiModel = {
  ...flatModel,
  id: 'gemini',
  name: 'Google Gemini',
  provider: 'google-gemini' as const,
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-3.1-flash-image',
  apiMode: 'generateContent' as const,
  pricingMode: 'tiered' as const,
  pricingRules: DEFAULT_GEMINI_TIERED_PRICING_RULES,
  geminiDefaults: {
    topP: null,
    topK: null,
    maxOutputTokens: null,
    seed: null,
    responseMimeType: '',
    imageConfig: null,
    generationConfig: null,
    thinkingConfig: null,
    safetySettings: null,
  },
}

function settings(): AdminSettings {
  return {
    models: [flatModel, tieredModel, geminiModel],
    defaultModelId: flatModel.id,
    dailyPointsTarget: 100,
    standardPointCost: 9,
    galleryUploadDefault: false,
    hourlyImageLimit: 20,
    privacyHourlyImageLimit: 5,
    serviceConcurrentImageLimit: 3,
    userConcurrentImageLimit: 3,
    galleryUploadUrl: 'https://imglist.example.com/api/uploads/third-party',
    galleryUploadToken: '',
    updatedAt: null,
  }
}

async function loadHandler() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', readBodyMock)
  return (await import('./generate.post')).default as (event: unknown) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireUser.mockResolvedValue(user)
  authMocks.isAdminUser.mockReturnValue(false)
  const adminSettings = settings()
  adminSettingsMocks.getAdminSettings.mockResolvedValue(adminSettings)
  adminSettingsMocks.selectGenerationModel.mockImplementation((input: AdminSettings, modelId?: unknown) =>
    input.models.find((model) => model.id === modelId) ?? input.models[0],
  )
  adminSettingsMocks.assertApiConfigUsable.mockReturnValue(undefined)
  usageMocks.countRecentGeneratedImages.mockResolvedValue(0)
  queueMocks.createImageGenerationJob.mockImplementation((input) => input)
})

describe('/api/images/generate', () => {
  it('recalculates tiered pricing from the selected server model', async () => {
    readBodyMock.mockResolvedValue({
      prompt: 'prompt',
      modelId: tieredModel.id,
      params: {
        ...DEFAULT_PARAMS,
        size: '2048x2048',
        quality: 'high',
        n: 2,
      },
      inputImageDataUrls: ['data:image/png;base64,input'],
      maskDataUrl: 'data:image/png;base64,mask',
      uploadToGallery: false,
    })

    const handler = await loadHandler()
    const result = await handler({})

    expect(adminSettingsMocks.selectGenerationModel).toHaveBeenCalledWith(expect.any(Object), tieredModel.id)
    expect(queueMocks.createImageGenerationJob).toHaveBeenCalledWith(expect.objectContaining({
      apiConfig: tieredModel,
      dailyPointsTarget: 100,
      pricing: expect.objectContaining({
        mode: 'tiered',
        sizeTier: '2K',
        quality: 'high',
        basePoints: 72000,
        referenceImageCount: 1,
        referenceImagePoints: 4000,
        maskEditApplied: true,
        maskEditPoints: 2000,
        pointsPerImage: 78000,
        imageCount: 2,
        totalPoints: 156000,
      }),
    }))
    expect(result).toMatchObject({
      pricing: expect.objectContaining({
        pointsPerImage: 78000,
        totalPoints: 156000,
      }),
    })
  })

  it('rejects client supplied pricing fields', async () => {
    readBodyMock.mockResolvedValue({
      prompt: 'prompt',
      modelId: tieredModel.id,
      estimatedPoints: 1,
      params: { ...DEFAULT_PARAMS },
    })

    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('estimatedPoints'),
    })
    expect(queueMocks.createImageGenerationJob).not.toHaveBeenCalled()
  })

  it('ignores legacy usePremiumApi from cached clients', async () => {
    readBodyMock.mockResolvedValue({
      prompt: 'prompt',
      modelId: flatModel.id,
      usePremiumApi: true,
      params: { ...DEFAULT_PARAMS, usePremiumApi: true },
    })

    const handler = await loadHandler()
    await handler({})

    expect(queueMocks.createImageGenerationJob).toHaveBeenCalledWith(expect.objectContaining({
      apiConfig: flatModel,
      pricing: expect.objectContaining({
        mode: 'flat',
        pointsPerImage: 9,
        totalPoints: 9,
      }),
    }))
  })

  it('accepts only simplified Gemini params and recalculates Gemini pricing', async () => {
    readBodyMock.mockResolvedValue({
      prompt: 'prompt',
      modelId: geminiModel.id,
      params: {
        ...DEFAULT_PARAMS,
        size: '4096x4096',
        quality: 'high',
        output_format: 'webp',
        output_compression: 90,
        moderation: 'low',
        n: 2,
        gemini: {
          mediaResolution: 'high',
          temperature: 0.7,
          thinkingMode: 'low',
          safetyLevel: 'balanced',
        },
      },
      inputImageDataUrls: ['data:image/png;base64,input'],
      uploadToGallery: false,
    })

    const handler = await loadHandler()
    await handler({})

    expect(queueMocks.createImageGenerationJob).toHaveBeenCalledWith(expect.objectContaining({
      apiConfig: geminiModel,
      params: expect.objectContaining({
        size: 'auto',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 2,
        gemini: {
          mediaResolution: 'high',
          temperature: 0.7,
          thinkingMode: 'low',
          safetyLevel: 'balanced',
        },
      }),
      pricing: expect.objectContaining({
        mode: 'tiered',
        sizeTier: '4K',
        quality: 'auto',
        basePoints: 160000,
        referenceImagePoints: 4000,
        pointsPerImage: 164000,
        totalPoints: 328000,
      }),
    }))
  })

  it('rejects unsupported Gemini advanced params from clients', async () => {
    readBodyMock.mockResolvedValue({
      prompt: 'prompt',
      modelId: geminiModel.id,
      params: {
        ...DEFAULT_PARAMS,
        gemini: {
          mediaResolution: 'auto',
          topP: 0.9,
        },
      },
    })

    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('topP'),
    })
    expect(queueMocks.createImageGenerationJob).not.toHaveBeenCalled()
  })

  it('rejects Gemini mask editing before queue reservation', async () => {
    readBodyMock.mockResolvedValue({
      prompt: 'prompt',
      modelId: geminiModel.id,
      params: { ...DEFAULT_PARAMS },
      maskDataUrl: 'data:image/png;base64,mask',
    })

    const handler = await loadHandler()

    await expect(handler({})).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('不支持遮罩编辑'),
    })
    expect(queueMocks.createImageGenerationJob).not.toHaveBeenCalled()
  })
})
