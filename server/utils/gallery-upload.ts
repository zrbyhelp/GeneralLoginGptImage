import type { TaskParams } from '../../src/types'

const DEFAULT_UPLOAD_URL = 'https://imglist.zrbyhelp.com/api/uploads/third-party'

export interface GalleryUploadUser {
  id?: string | null
  account?: string | null
  email?: string | null
  username?: string | null
  name?: string | null
}

function dataUrlToBlob(dataUrl: string, fallbackType = 'image/png') {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) throw new Error('图片数据格式无效')
  const mime = match[1] || fallbackType
  const payload = match[3] || ''
  const bytes = match[2]
    ? new Uint8Array(Buffer.from(payload, 'base64'))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return new Blob([bytes], { type: mime || fallbackType })
}

function getBlobExtension(blob: Blob) {
  const type = blob.type.toLowerCase()
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/webp') return 'webp'
  return 'png'
}

async function getUploadErrorMessage(response: Response) {
  try {
    const body = await response.json()
    if (typeof body?.statusMessage === 'string') return body.statusMessage
    if (typeof body?.message === 'string') return body.message
    if (typeof body?.error === 'string') return body.error
    if (typeof body?.error?.message === 'string') return body.error.message
  } catch {
    try {
      const text = await response.text()
      if (text.trim()) return text
    } catch {
      /* ignore */
    }
  }
  return `HTTP ${response.status}`
}

function appendOptionalFormField(formData: FormData, key: string, value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized) formData.append(key, normalized)
}

export async function uploadThirdPartyGalleryContent(input: {
  uploadUrl: string
  uploadToken: string
  prompt: string
  images: string[]
  referenceImages: string[]
  provider: string
  model: string
  params: TaskParams
  user?: GalleryUploadUser | null
  timeoutSeconds: number
}) {
  const uploadUrl = input.uploadUrl.trim() || DEFAULT_UPLOAD_URL
  const uploadToken = input.uploadToken.trim()
  if (!uploadToken) throw new Error('管理员尚未配置图集上传 Token')
  if (!input.images.length) throw new Error('没有可上传的生成图片')

  const formData = new FormData()
  formData.append('prompt', input.prompt)
  formData.append('provider', input.provider)
  formData.append('model', input.model)
  formData.append('params', JSON.stringify(input.params))
  appendOptionalFormField(formData, 'userId', input.user?.id)
  appendOptionalFormField(formData, 'userAccount', input.user?.account)
  appendOptionalFormField(formData, 'userEmail', input.user?.email)
  appendOptionalFormField(formData, 'userUsername', input.user?.username)
  appendOptionalFormField(formData, 'userName', input.user?.name)

  input.images.forEach((dataUrl, index) => {
    const blob = dataUrlToBlob(dataUrl)
    formData.append('images[]', blob, `result-${index + 1}.${getBlobExtension(blob)}`)
  })
  input.referenceImages.forEach((dataUrl, index) => {
    const blob = dataUrlToBlob(dataUrl)
    formData.append('referenceImages[]', blob, `reference-${index + 1}.${getBlobExtension(blob)}`)
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutSeconds * 1000)
  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${uploadToken}`,
      },
      body: formData,
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(await getUploadErrorMessage(response))
    return response.json().catch(() => ({ ok: true })) as Promise<unknown>
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('上传图集超时')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
