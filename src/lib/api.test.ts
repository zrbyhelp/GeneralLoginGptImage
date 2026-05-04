import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from './api'

describe('callImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts generation requests to the unified server endpoint only', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      images: ['data:image/png;base64,aW1hZ2U='],
      apiProvider: 'openai',
      apiProfileName: '统一配置',
      apiModel: 'gpt-image-2',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'http://api.example.com/v1',
        apiKey: 'test-key',
        apiProxy: true,
        apiMode: 'responses',
        codexCli: true,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: ['data:image/png;base64,input'],
      maskDataUrl: 'data:image/png;base64,mask',
      privacyMode: true,
    })

    expect(result).toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
      apiProvider: 'openai',
      apiProfileName: '统一配置',
      apiModel: 'gpt-image-2',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/images/generate',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toEqual({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: ['data:image/png;base64,input'],
      maskDataUrl: 'data:image/png;base64,mask',
      privacyMode: true,
    })
  })

  it('does not include client API configuration in the request body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      images: ['data:image/png;base64,aW1hZ2U='],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'http://api.example.com/v1',
        apiKey: 'test-key',
        model: 'client-model',
        timeout: 30,
        apiMode: 'responses',
        codexCli: true,
        apiProxy: true,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('settings')
    expect(body).not.toHaveProperty('apiKey')
    expect(body).not.toHaveProperty('apiUrl')
    expect(body).not.toHaveProperty('baseUrl')
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('provider')
    expect(body).not.toHaveProperty('apiMode')
    expect(body).not.toHaveProperty('codexCli')
    expect(body.params).not.toHaveProperty('apiKey')
    expect(body.privacyMode).toBe(false)
  })

  it('returns server generation metadata unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      images: ['data:image/png;base64,aW1hZ2U='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
      revisedPrompts: ['revised'],
      apiProvider: 'fal',
      apiProfileName: '统一配置',
      apiModel: 'openai/gpt-image-2',
      galleryUploadError: null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result).toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
      revisedPrompts: ['revised'],
      apiProvider: 'fal',
      apiProfileName: '统一配置',
      apiModel: 'openai/gpt-image-2',
      galleryUploadError: null,
    })
  })

  it('throws server error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      message: '每小时生成次数已达上限',
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(callImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toThrow('每小时生成次数已达上限')
  })
})
