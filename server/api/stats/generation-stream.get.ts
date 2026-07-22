import { createEventStream } from 'h3'
import { requireUser } from '../../utils/auth'
import { subscribeToGenerationTotal } from '../../utils/generation-total-events'
import { countTotalGeneratedImages } from '../../utils/generation-usage'

const HEARTBEAT_INTERVAL_MS = 20_000
const RETRY_INTERVAL_MS = 3_000

function generationTotalEvent(totalGeneratedImages: number, retry?: number) {
  return {
    event: 'generation-total',
    ...(retry === undefined ? {} : { retry }),
    data: JSON.stringify({ totalGeneratedImages }),
  }
}

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const eventStream = createEventStream(event)
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe = () => undefined

  const cleanup = () => {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    unsubscribe()
  }

  const pushTotal = (totalGeneratedImages: number) => {
    if (closed) return
    void eventStream.push(generationTotalEvent(totalGeneratedImages)).catch(cleanup)
  }

  unsubscribe = subscribeToGenerationTotal(pushTotal)
  const initialTotal = countTotalGeneratedImages()
  heartbeat = setInterval(() => {
    if (closed) return
    void eventStream.push({
      event: 'heartbeat',
      data: JSON.stringify({ timestamp: Date.now() }),
    }).catch(cleanup)
  }, HEARTBEAT_INTERVAL_MS)

  eventStream.onClosed(cleanup)
  void eventStream.push(generationTotalEvent(initialTotal, RETRY_INTERVAL_MS)).catch(cleanup)

  return eventStream.send()
})
