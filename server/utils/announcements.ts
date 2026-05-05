export interface ServiceAnnouncement {
  id: string
  title: string
  content: string
  scope: 'global' | 'service'
  serviceId: string | null
  sortOrder: number
  createdAt: string | null
  updatedAt: string | null
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableString(value: unknown) {
  const normalized = normalizeString(value)
  return normalized || null
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeScope(value: unknown): ServiceAnnouncement['scope'] {
  return value === 'service' ? 'service' : 'global'
}

export function normalizeServiceAnnouncement(input: unknown): ServiceAnnouncement | null {
  if (!input || typeof input !== 'object') return null
  const item = input as Record<string, unknown>
  const id = normalizeString(item.id)
  if (!id) return null

  return {
    id,
    title: normalizeString(item.title),
    content: normalizeString(item.content),
    scope: normalizeScope(item.scope),
    serviceId: normalizeNullableString(item.serviceId),
    sortOrder: normalizeNumber(item.sortOrder),
    createdAt: normalizeNullableString(item.createdAt),
    updatedAt: normalizeNullableString(item.updatedAt),
  }
}

export async function fetchServiceAnnouncements(input: {
  portalBaseUrl: string
  clientId: string
  clientSecret: string
  fetchImpl?: FetchLike
}) {
  const portalBaseUrl = input.portalBaseUrl.trim().replace(/\/+$/, '')
  const clientId = input.clientId.trim()
  const clientSecret = input.clientSecret.trim()
  if (!portalBaseUrl || !clientId || !clientSecret) return []

  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(`${portalBaseUrl}/api/service-auth/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`公告获取失败：${message || response.statusText || response.status}`)
  }

  const payload = await response.json() as { announcements?: unknown }
  if (!Array.isArray(payload.announcements)) return []

  return payload.announcements
    .map(normalizeServiceAnnouncement)
    .filter((item): item is ServiceAnnouncement => Boolean(item))
}
