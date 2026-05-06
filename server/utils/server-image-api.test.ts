import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerApiConfig } from './admin-settings'
import { callServerImageApi } from './server-image-api'

const config: ServerApiConfig = {
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'gpt-5.5',
  timeout: 10,
  apiMode: 'responses',
  codexCli: false,
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

describe('server image API Responses mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates multiple images serially and keeps successes after a failure', async () => {
    let activeRequests = 0
    let maxActiveRequests = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await Promise.resolve()
      activeRequests -= 1

      const callIndex = fetchMock.mock.calls.length
      if (callIndex === 2) return new Response('gateway timeout', { status: 504 })
      return responsesImage(callIndex === 1 ? 'image-a' : 'image-c')
    })

    const result = await callServerImageApi({
      config,
      prompt: 'prompt',
      params: {
        size: '1024x1024',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 3,
      },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(maxActiveRequests).toBe(1)
    expect(result.images).toEqual([
      'data:image/png;base64,image-a',
      'data:image/png;base64,image-c',
    ])
    expect(result.actualParams).toMatchObject({ n: 2 })
    expect(result.revisedPrompts).toEqual(['revised-image-a', 'revised-image-c'])
    expect(result.partialError).toContain('第 2 张生成失败：gateway timeout')
  })

  it('tries every requested image before failing when all serial attempts fail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('first failure', { status: 500 }))
      .mockResolvedValueOnce(new Response('second failure', { status: 502 }))
      .mockResolvedValueOnce(new Response('third failure', { status: 504 }))

    await expect(callServerImageApi({
      config,
      prompt: 'prompt',
      params: {
        size: '1024x1024',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 3,
      },
      inputImageDataUrls: [],
    })).rejects.toThrow('first failure')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
