import { describe, expect, it, vi } from 'vitest'
import { fetchServiceAnnouncements, normalizeServiceAnnouncement } from './announcements'

describe('announcement helpers', () => {
  it('posts service credentials and normalizes announcements', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      announcements: [
        {
          id: 'announcement-a',
          title: ' 系统维护通知 ',
          content: ' 今晚 23:00-23:30 进行维护。 ',
          scope: 'service',
          serviceId: 'service-a',
          sortOrder: 2,
          createdAt: '2026-05-04T00:00:00.000Z',
          updatedAt: '2026-05-04T01:00:00.000Z',
        },
        { id: '' },
      ],
    })))

    const announcements = await fetchServiceAnnouncements({
      portalBaseUrl: 'https://zrg.zrbyhelp.com/',
      clientId: 'svc_xxx',
      clientSecret: 'sk_xxx',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith('https://zrg.zrbyhelp.com/api/service-auth/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'svc_xxx', clientSecret: 'sk_xxx' }),
    })
    expect(announcements).toEqual([
      {
        id: 'announcement-a',
        title: '系统维护通知',
        content: '今晚 23:00-23:30 进行维护。',
        scope: 'service',
        serviceId: 'service-a',
        sortOrder: 2,
        createdAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T01:00:00.000Z',
      },
    ])
  })

  it('returns an empty list when service auth config is incomplete', async () => {
    const fetchImpl = vi.fn()

    await expect(fetchServiceAnnouncements({
      portalBaseUrl: 'https://zrg.zrbyhelp.com',
      clientId: 'svc_xxx',
      clientSecret: '',
      fetchImpl,
    })).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns an empty list for a response without announcements', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })))

    await expect(fetchServiceAnnouncements({
      portalBaseUrl: 'https://zrg.zrbyhelp.com',
      clientId: 'svc_xxx',
      clientSecret: 'sk_xxx',
      fetchImpl,
    })).resolves.toEqual([])
  })

  it('throws when the portal rejects the announcement request', async () => {
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403, statusText: 'Forbidden' }))

    await expect(fetchServiceAnnouncements({
      portalBaseUrl: 'https://zrg.zrbyhelp.com',
      clientId: 'svc_xxx',
      clientSecret: 'sk_xxx',
      fetchImpl,
    })).rejects.toThrow('公告获取失败：forbidden')
  })

  it('defaults unknown announcement fields safely', () => {
    expect(normalizeServiceAnnouncement({
      id: 'announcement-a',
      scope: 'other',
      sortOrder: Number.NaN,
    })).toEqual({
      id: 'announcement-a',
      title: '',
      content: '',
      scope: 'global',
      serviceId: null,
      sortOrder: 0,
      createdAt: null,
      updatedAt: null,
    })
  })
})
