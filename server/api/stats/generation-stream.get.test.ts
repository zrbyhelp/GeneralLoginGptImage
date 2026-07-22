import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }))
const usageMocks = vi.hoisted(() => ({ countTotalGeneratedImages: vi.fn() }))
const eventMocks = vi.hoisted(() => ({ subscribeToGenerationTotal: vi.fn() }))
const h3Mocks = vi.hoisted(() => ({ createEventStream: vi.fn() }))

vi.mock('../../utils/auth', () => authMocks)
vi.mock('../../utils/generation-usage', () => usageMocks)
vi.mock('../../utils/generation-total-events', () => eventMocks)
vi.mock('h3', () => h3Mocks)

async function loadHandler() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  return (await import('./generation-stream.get')).default as (event: unknown) => Promise<unknown>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  authMocks.requireUser.mockResolvedValue({ id: 'user' })
  usageMocks.countTotalGeneratedImages.mockReturnValue(41)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('/api/stats/generation-stream', () => {
  it('authenticates, streams totals and heartbeat events, and cleans up on close', async () => {
    const push = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const unsubscribe = vi.fn()
    let closeHandler: (() => void) | undefined
    let totalListener: ((total: number) => void) | undefined

    h3Mocks.createEventStream.mockReturnValue({
      push,
      send,
      onClosed: vi.fn((callback: () => void) => {
        closeHandler = callback
      }),
    })
    eventMocks.subscribeToGenerationTotal.mockImplementation((listener: (total: number) => void) => {
      totalListener = listener
      return unsubscribe
    })

    const event = {}
    const handler = await loadHandler()
    await handler(event)

    expect(authMocks.requireUser).toHaveBeenCalledWith(event)
    expect(h3Mocks.createEventStream).toHaveBeenCalledWith(event)
    expect(eventMocks.subscribeToGenerationTotal.mock.invocationCallOrder[0])
      .toBeLessThan(usageMocks.countTotalGeneratedImages.mock.invocationCallOrder[0])
    expect(push).toHaveBeenCalledWith({
      event: 'generation-total',
      retry: 3000,
      data: JSON.stringify({ totalGeneratedImages: 41 }),
    })

    totalListener?.(42)
    expect(push).toHaveBeenCalledWith({
      event: 'generation-total',
      data: JSON.stringify({ totalGeneratedImages: 42 }),
    })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(push).toHaveBeenCalledWith({
      event: 'heartbeat',
      data: expect.stringContaining('"timestamp"'),
    })

    const callsBeforeClose = push.mock.calls.length
    closeHandler?.()
    expect(unsubscribe).toHaveBeenCalledOnce()

    totalListener?.(43)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(push).toHaveBeenCalledTimes(callsBeforeClose)
  })
})
