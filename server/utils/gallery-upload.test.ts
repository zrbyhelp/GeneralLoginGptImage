import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadThirdPartyGalleryContent } from './gallery-upload'
import type { TaskParams } from '../../src/types'

const params: TaskParams = {
  size: '1024x1024',
  quality: 'high',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

describe('third-party gallery upload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends generated and reference images as multipart form data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      id: 'image_set_id',
      reviewStatus: 'PENDING',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await uploadThirdPartyGalleryContent({
      uploadUrl: 'https://imglist.example.com/api/uploads/third-party',
      uploadToken: 'upload-token',
      prompt: '一张高质量商业海报，主体清晰，光影自然，背景干净，适合产品展示',
      images: ['data:image/png;base64,aW1hZ2U='],
      referenceImages: ['data:image/webp;base64,cmVm'],
      provider: 'openai',
      model: 'gpt-image-2',
      params,
      user: {
        id: 'portal-user-123',
        account: 'zhangsan',
        email: 'zhangsan@example.com',
        username: 'zs',
        name: '张三',
      },
      timeoutSeconds: 10,
    })

    const [, init] = fetchMock.mock.calls[0]
    const formData = (init as RequestInit).body as FormData

    expect(fetchMock).toHaveBeenCalledWith(
      'https://imglist.example.com/api/uploads/third-party',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer upload-token' },
        cache: 'no-store',
      }),
    )
    expect(String(formData.get('prompt'))).toContain('商业海报')
    expect(String(formData.get('provider'))).toBe('openai')
    expect(String(formData.get('model'))).toBe('gpt-image-2')
    expect(JSON.parse(String(formData.get('params')))).toMatchObject({ size: '1024x1024', quality: 'high' })
    expect(String(formData.get('userId'))).toBe('portal-user-123')
    expect(String(formData.get('userAccount'))).toBe('zhangsan')
    expect(String(formData.get('userEmail'))).toBe('zhangsan@example.com')
    expect(String(formData.get('userUsername'))).toBe('zs')
    expect(String(formData.get('userName'))).toBe('张三')
    expect(formData.getAll('images[]')).toHaveLength(1)
    expect(formData.getAll('referenceImages[]')).toHaveLength(1)
  })

  it('omits empty optional user fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      id: 'image_set_id',
      reviewStatus: 'PUBLISHED',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await uploadThirdPartyGalleryContent({
      uploadUrl: 'https://imglist.example.com/api/uploads/third-party',
      uploadToken: 'upload-token',
      prompt: '一张高质量商业海报，主体清晰，光影自然，背景干净，适合产品展示',
      images: ['data:image/png;base64,aW1hZ2U='],
      referenceImages: [],
      provider: 'openai',
      model: 'gpt-image-2',
      params,
      user: {
        id: 'portal-user-123',
        account: '',
        email: null,
        username: '  ',
        name: '张三',
      },
      timeoutSeconds: 10,
    })

    const [, init] = fetchMock.mock.calls[0]
    const formData = (init as RequestInit).body as FormData

    expect(String(formData.get('userId'))).toBe('portal-user-123')
    expect(formData.has('userAccount')).toBe(false)
    expect(formData.has('userEmail')).toBe(false)
    expect(formData.has('userUsername')).toBe(false)
    expect(String(formData.get('userName'))).toBe('张三')
  })

  it('requires a server-side upload token', async () => {
    await expect(uploadThirdPartyGalleryContent({
      uploadUrl: 'https://imglist.example.com/api/uploads/third-party',
      uploadToken: '',
      prompt: '一张高质量商业海报，主体清晰，光影自然，背景干净，适合产品展示',
      images: ['data:image/png;base64,aW1hZ2U='],
      referenceImages: [],
      provider: 'openai',
      model: 'gpt-image-2',
      params,
      timeoutSeconds: 10,
    })).rejects.toThrow('管理员尚未配置图集上传 Token')
  })
})
