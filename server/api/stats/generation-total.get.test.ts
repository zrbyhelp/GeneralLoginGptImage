import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }))
const usageMocks = vi.hoisted(() => ({ countTotalGeneratedImages: vi.fn() }))

vi.mock('../../utils/auth', () => authMocks)
vi.mock('../../utils/generation-usage', () => usageMocks)

async function loadHandler() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  return (await import('./generation-total.get')).default as (event: unknown) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireUser.mockResolvedValue({ id: 'user' })
  usageMocks.countTotalGeneratedImages.mockReturnValue(123)
})

describe('/api/stats/generation-total', () => {
  it('requires authentication and returns the site-wide image total', async () => {
    const event = {}
    const handler = await loadHandler()

    await expect(handler(event)).resolves.toEqual({ totalGeneratedImages: 123 })
    expect(authMocks.requireUser).toHaveBeenCalledWith(event)
    expect(usageMocks.countTotalGeneratedImages).toHaveBeenCalledOnce()
  })
})
