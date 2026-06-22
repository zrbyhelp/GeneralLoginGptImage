import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultAdminSettings, getPublicGenerationModels, selectGenerationModel, updateAdminSettings, getAdminSettings } from './admin-settings'
import { DEFAULT_GEMINI_TIERED_PRICING_RULES, DEFAULT_OPENAI_TIERED_PRICING_RULES } from '../../src/lib/pricing'
import { setDatabasePathForTests } from './db'

describe('admin settings models', () => {
  let tempRoot = ''

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'gip-admin-settings-'))
    setDatabasePathForTests(join(tempRoot, 'app.db'))
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiProvider: 'openai',
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'env-key',
      apiModel: 'gpt-image-2',
      apiMode: 'images',
      apiTimeout: '600',
      apiCodexCli: 'false',
      defaultHourlyImageLimit: '20',
      defaultPrivacyHourlyImageLimit: '5',
      defaultServiceConcurrentImageLimit: '3',
      defaultUserConcurrentImageLimit: '3',
    }))
  })

  afterEach(() => {
    setDatabasePathForTests(null)
    vi.unstubAllGlobals()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('creates a default model from runtime API config', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiProvider: 'openai',
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'env-key',
      apiModel: 'gpt-image-2',
      apiMode: 'images',
      apiTimeout: '600',
      apiCodexCli: 'true',
      defaultHourlyImageLimit: '20',
      defaultPrivacyHourlyImageLimit: '5',
      defaultServiceConcurrentImageLimit: '3',
      defaultUserConcurrentImageLimit: '3',
    }))
    const settings = getDefaultAdminSettings()

    expect(settings.models[0]).toMatchObject({
      id: 'default-model',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'env-key',
      model: 'gpt-image-2',
      codexCompatible: true,
      enabled: true,
      pricingMode: 'flat',
    })
    expect(getPublicGenerationModels(settings)[0]).not.toHaveProperty('apiKey')
    expect(getPublicGenerationModels(settings)[0]).toMatchObject({
      pricingMode: 'flat',
      pricingPreviewRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
    })
  })

  it('selects the default model and rejects disabled models', () => {
    const defaults = getDefaultAdminSettings()
    const settings = {
      ...defaults,
      models: [
        { ...defaults.models[0], id: 'a', enabled: true },
        { ...defaults.models[0], id: 'b', enabled: false },
      ],
      defaultModelId: 'a',
    }

    expect(selectGenerationModel(settings).id).toBe('a')
    expect(() => selectGenerationModel(settings, 'b')).toThrow('所选模型已禁用')
    expect(() => selectGenerationModel(settings, 'missing')).toThrow('所选模型不存在')
  })

  it('falls back to an enabled default model when the saved default is disabled', async () => {
    const defaults = getDefaultAdminSettings()
    const settings = await updateAdminSettings({
      models: [
        { ...defaults.models[0], id: 'disabled-default', enabled: false },
        { ...defaults.models[0], id: 'enabled-fallback', enabled: true },
      ],
      defaultModelId: 'disabled-default',
    })

    expect(settings.defaultModelId).toBe('enabled-fallback')
    expect(selectGenerationModel(settings).id).toBe('enabled-fallback')
  })

  it('persists model list through SQLite admin settings', async () => {
    const model = {
      id: 'model-a',
      name: 'Model A',
      provider: 'openai' as const,
      baseUrl: 'https://api.a.test/v1',
      apiKey: 'key-a',
      model: 'gpt-image-2',
      timeout: 120,
      apiMode: 'responses' as const,
      codexCompatible: true,
      enabled: true,
      pricingMode: 'tiered' as const,
      pricingRules: {
        ...DEFAULT_OPENAI_TIERED_PRICING_RULES,
        referenceImagePoints: 1234,
      },
    }
    await updateAdminSettings({ models: [model], defaultModelId: model.id })

    const settings = await getAdminSettings()
    expect(settings.models).toHaveLength(1)
    expect(settings.models[0]).toMatchObject(model)
    expect(settings.defaultModelId).toBe(model.id)
    expect(getPublicGenerationModels(settings)[0]).toMatchObject({
      pricingMode: 'tiered',
      pricingPreviewRules: expect.objectContaining({
        referenceImagePoints: 1234,
      }),
    })
    expect(getPublicGenerationModels(settings)[0]).not.toHaveProperty('pricingRules')
  })

  it('persists Gemini models with generateContent mode and hidden admin defaults', async () => {
    const defaults = getDefaultAdminSettings()
    const model = {
      ...defaults.models[0],
      id: 'gemini',
      name: 'Google Gemini',
      provider: 'google-gemini' as const,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gemini-key',
      model: 'gemini-3.1-flash-image',
      apiMode: 'generateContent' as const,
      codexCompatible: true,
      enabled: true,
      pricingMode: 'tiered' as const,
      pricingRules: DEFAULT_GEMINI_TIERED_PRICING_RULES,
      geminiDefaults: {
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 8192,
        seed: 123,
        responseMimeType: 'image/png',
        imageConfig: { aspectRatio: '16:9' },
        generationConfig: null,
        thinkingConfig: null,
        safetySettings: null,
      },
    }
    await updateAdminSettings({ models: [model], defaultModelId: model.id })

    const settings = await getAdminSettings()
    expect(settings.models[0]).toMatchObject({
      id: 'gemini',
      provider: 'google-gemini',
      apiMode: 'generateContent',
      codexCompatible: false,
      pricingMode: 'tiered',
      pricingRules: DEFAULT_GEMINI_TIERED_PRICING_RULES,
      geminiDefaults: expect.objectContaining({
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 8192,
        seed: 123,
        responseMimeType: 'image/png',
        imageConfig: { aspectRatio: '16:9' },
      }),
    })
    const publicModel = getPublicGenerationModels(settings)[0]
    expect(publicModel).toMatchObject({
      id: 'gemini',
      provider: 'google-gemini',
      apiMode: 'generateContent',
      pricingPreviewRules: DEFAULT_GEMINI_TIERED_PRICING_RULES,
    })
    expect(publicModel).not.toHaveProperty('apiKey')
    expect(publicModel).not.toHaveProperty('baseUrl')
    expect(publicModel).not.toHaveProperty('geminiDefaults')
  })
})
