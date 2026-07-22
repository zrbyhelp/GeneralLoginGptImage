export type GenerationTotalListener = (totalGeneratedImages: number) => void | Promise<void>

const listeners = new Set<GenerationTotalListener>()

function reportListenerError(error: unknown) {
  console.error('[generation-total] subscriber failed:', error)
}

export function subscribeToGenerationTotal(listener: GenerationTotalListener) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function publishGenerationTotal(totalGeneratedImages: number) {
  const total = Math.max(0, Math.floor(Number(totalGeneratedImages) || 0))

  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(total)).catch(reportListenerError)
    } catch (error) {
      reportListenerError(error)
    }
  }
}
