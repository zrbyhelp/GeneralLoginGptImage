import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GEMINI_TIERED_PRICING_RULES, DEFAULT_OPENAI_TIERED_PRICING_RULES } from '../../src/lib/pricing'
import type { ServerApiConfig } from './admin-settings'
import { callServerImageApi } from './server-image-api'

const config: ServerApiConfig = {
  id: 'model-responses',
  name: 'Responses model',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'gpt-5.5',
  timeout: 10,
  apiMode: 'responses',
  codexCompatible: false,
  pricingMode: 'flat',
  pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
}

const imagesConfig: ServerApiConfig = {
  ...config,
  model: 'gpt-image-2',
  apiMode: 'images',
}

const geminiConfig: ServerApiConfig = {
  id: 'model-gemini',
  name: 'Gemini model',
  provider: 'google-gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'gemini-key',
  model: 'gemini-3.1-flash-image',
  timeout: 10,
  apiMode: 'generateContent',
  codexCompatible: false,
  pricingMode: 'tiered',
  pricingRules: DEFAULT_GEMINI_TIERED_PRICING_RULES,
  geminiDefaults: {
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 8192,
    seed: 123,
    responseMimeType: 'image/png',
    imageConfig: { aspectRatio: '16:9' },
    generationConfig: { stopSequences: ['END'] },
    thinkingConfig: { thinkingBudget: 128 },
    safetySettings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }],
  },
}

const params = {
  size: '1024x1024',
  quality: 'auto' as const,
  output_format: 'png' as const,
  output_compression: null,
  moderation: 'auto' as const,
  n: 3,
  gemini: {
    mediaResolution: 'high' as const,
    temperature: 0.8,
    thinkingMode: 'low' as const,
    safetyLevel: 'balanced' as const,
    networkSearch: false,
  },
}

function responsesImage(result: string) {
  return new Response(JSON.stringify({
    output: [
      {
        type: 'image_generation_call',
        result,
        revised_prompt: `revised-${result}`,
      },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function imagesImage(result: string) {
  return new Response(JSON.stringify({
    data: [
      {
        b64_json: result,
        revised_prompt: `revised-${result}`,
      },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('server image API Responses mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates multiple images concurrently and keeps successes after a failure', async () => {
    let activeRequests = 0
    let maxActiveRequests = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await Promise.resolve()
      activeRequests -= 1

      if (callIndex === 2) return new Response('gateway timeout', { status: 504 })
      return responsesImage(callIndex === 1 ? 'image-a' : 'image-c')
    })

    const result = await callServerImageApi({
      config,
      prompt: 'prompt',
      params,
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(maxActiveRequests).toBe(3)
    expect(result.images).toEqual([
      'data:image/png;base64,image-a',
      'data:image/png;base64,image-c',
    ])
    expect(result.actualParams).toMatchObject({ n: 2 })
    expect(result.revisedPrompts).toEqual(['revised-image-a', 'revised-image-c'])
    expect(result.partialError).toContain('第 2 张生成失败：gateway timeout')
  })

  it('tries every requested image before failing when all concurrent attempts fail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('first failure', { status: 500 }))
      .mockResolvedValueOnce(new Response('second failure', { status: 502 }))
      .mockResolvedValueOnce(new Response('third failure', { status: 504 }))

    await expect(callServerImageApi({
      config,
      prompt: 'prompt',
      params,
      inputImageDataUrls: [],
    })).rejects.toThrow('first failure')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('server image API Images mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates multiple images concurrently and keeps successes after a failure', async () => {
    let activeRequests = 0
    let maxActiveRequests = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await Promise.resolve()
      activeRequests -= 1

      if (callIndex === 2) return new Response('gateway timeout', { status: 504 })
      return imagesImage(callIndex === 1 ? 'image-a' : 'image-c')
    })

    const result = await callServerImageApi({
      config: imagesConfig,
      prompt: 'prompt',
      params,
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(maxActiveRequests).toBe(3)
    expect(result.images).toEqual([
      'data:image/png;base64,image-a',
      'data:image/png;base64,image-c',
    ])
    expect(result.actualParams).toMatchObject({ n: 2 })
    expect(result.revisedPrompts).toEqual(['revised-image-a', 'revised-image-c'])
    expect(result.partialError).toContain('第 2 张生成失败：gateway timeout')

    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body).not.toHaveProperty('n')
    }
  })

  it('tries every requested image before failing when all concurrent attempts fail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('first failure', { status: 500 }))
      .mockResolvedValueOnce(new Response('second failure', { status: 502 }))
      .mockResolvedValueOnce(new Response('third failure', { status: 504 }))

    await expect(callServerImageApi({
      config: imagesConfig,
      prompt: 'prompt',
      params,
      inputImageDataUrls: [],
    })).rejects.toThrow('first failure')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('omits unsupported image parameters for Codex compatible models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imagesImage('image-a'))

    await callServerImageApi({
      config: { ...imagesConfig, codexCompatible: true },
      prompt: 'prompt',
      params: { ...params, output_format: 'webp', output_compression: 80, moderation: 'low' },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      model: imagesConfig.model,
      prompt: expect.stringContaining('Do not rewrite it'),
    })
    expect(body).not.toHaveProperty('size')
    expect(body).not.toHaveProperty('quality')
    expect(body).not.toHaveProperty('output_format')
    expect(body).not.toHaveProperty('output_compression')
    expect(body).not.toHaveProperty('moderation')
  })
})

describe('server image API Codex compatible Responses mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('omits unsupported tool parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(responsesImage('image-a'))

    await callServerImageApi({
      config: { ...config, codexCompatible: true },
      prompt: 'prompt',
      params: { ...params, output_format: 'webp', output_compression: 80, moderation: 'low' },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'generate',
    })
    expect(body.tools[0]).not.toHaveProperty('size')
    expect(body.tools[0]).not.toHaveProperty('quality')
    expect(body.tools[0]).not.toHaveProperty('output_format')
    expect(body.tools[0]).not.toHaveProperty('output_compression')
    expect(body.tools[0]).not.toHaveProperty('moderation')
  })
})

describe('server image API Gemini generateContent mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls Google generateContent with simplified user params and admin defaults', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'gemini-image',
                },
              },
            ],
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callServerImageApi({
      config: geminiConfig,
      prompt: 'prompt',
      params: { ...params, n: 1 },
      inputImageDataUrls: ['data:image/jpeg;base64,input-image'],
    })

    expect(result.images).toEqual(['data:image/png;base64,gemini-image'])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.contents[0].parts).toEqual([
      { text: 'prompt' },
      { inlineData: { mimeType: 'image/jpeg', data: 'input-image' } },
    ])
    expect(body.generationConfig).toMatchObject({
      candidateCount: 1,
      responseModalities: ['TEXT', 'IMAGE'],
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      temperature: 0.8,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 8192,
      seed: 123,
      responseMimeType: 'image/png',
      imageConfig: { aspectRatio: '16:9' },
      stopSequences: ['END'],
      thinkingConfig: { thinkingLevel: 'low' },
    })
    expect(body.safetySettings).toEqual([
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ])
    expect(body.generationConfig).not.toHaveProperty('tools')
  })

  it('calls Gemini Vertex SDK mode with ZenMux style base URL and model ID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'vertex-image',
                },
              },
            ],
          },
        },
      ],
    }), { status: 200 }))

    const result = await callServerImageApi({
      config: {
        ...geminiConfig,
        baseUrl: 'https://zenmux.ai/api/vertex-ai',
        model: 'google/gemini-3-pro-image',
        apiMode: 'geminiVertex',
      },
      prompt: 'prompt',
      params: { ...params, n: 1 },
      inputImageDataUrls: [],
    })

    expect(result.images).toEqual(['data:image/png;base64,vertex-image'])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models/gemini-3-pro-image:generateContent',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('enables Gemini Google Search grounding and returns actual query count', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [
        {
          groundingMetadata: {
            webSearchQueries: ['query a', 'query b', 'query a'],
          },
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'gemini-image',
                },
              },
            ],
          },
        },
      ],
    }), { status: 200 }))

    const result = await callServerImageApi({
      config: geminiConfig,
      prompt: 'prompt',
      params: { ...params, n: 1, gemini: { ...params.gemini, networkSearch: true } },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual([{ googleSearch: {} }])
    expect(result.searchGroundingCount).toBe(2)
  })

  it('parses snake_case inline image responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inline_data: {
                  mime_type: 'image/webp',
                  data: 'snake-image',
                },
              },
            ],
          },
        },
      ],
    }), { status: 200 }))

    const result = await callServerImageApi({
      config: geminiConfig,
      prompt: 'prompt',
      params: { ...params, n: 1 },
      inputImageDataUrls: [],
    })

    expect(result.images).toEqual(['data:image/webp;base64,snake-image'])
  })
})
