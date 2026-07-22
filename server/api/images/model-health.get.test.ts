import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPENAI_TIERED_PRICING_RULES } from '../../../src/lib/pricing'
import type { AdminSettings } from '../../utils/admin-settings'

const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }))
const settingsMocks = vi.hoisted(() => ({ getAdminSettings: vi.fn() }))
const healthMocks = vi.hoisted(() => ({ getModelHealthById: vi.fn() }))

vi.mock('../../utils/auth', () => authMocks)
vi.mock('../../utils/admin-settings', () => settingsMocks)
vi.mock('../../utils/model-health', () => healthMocks)

function settings(): AdminSettings {
  const baseModel = {
    name: '模型',
    provider: 'openai' as const,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key',
    model: 'gpt-image-2',
    timeout: 600,
    apiMode: 'images' as const,
    codexCompatible: false,
    pricingMode: 'flat' as const,
    pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
  }
  return {
    models: [
      { ...baseModel, id: 'enabled', enabled: true },
      { ...baseModel, id: 'disabled', enabled: false },
    ],
    defaultModelId: 'enabled',
    dailyPointsTarget: 100,
    standardPointCost: 1,
    galleryUploadDefault: false,
    hourlyImageLimit: 20,
    privacyHourlyImageLimit: 5,
    serviceConcurrentImageLimit: 3,
    userConcurrentImageLimit: 3,
    galleryUploadUrl: '',
    galleryUploadToken: '',
    updatedAt: null,
  }
}

async function loadHandler() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  return (await import('./model-health.get')).default as (event: unknown) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireUser.mockResolvedValue({ id: 'user' })
  settingsMocks.getAdminSettings.mockResolvedValue(settings())
  healthMocks.getModelHealthById.mockResolvedValue({ enabled: { modelId: 'enabled', bars: 0 } })
})

describe('/api/images/model-health', () => {
  it('requires authentication and returns health only for enabled models', async () => {
    const handler = await loadHandler()
    await expect(handler({})).resolves.toMatchObject({
      windowMinutes: 60,
      modelHealthById: { enabled: { modelId: 'enabled', bars: 0 } },
    })

    expect(authMocks.requireUser).toHaveBeenCalledWith({})
    expect(healthMocks.getModelHealthById).toHaveBeenCalledWith(['enabled'])
  })
})
