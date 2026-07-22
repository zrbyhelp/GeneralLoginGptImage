import type { ModelHealth } from '../types'
import { getModelHealthDescription } from '../lib/modelHealth'

interface ModelHealthSignalProps {
  health?: ModelHealth
}

const activeColorClasses = {
  healthy: 'bg-emerald-500 dark:bg-emerald-400',
  degraded: 'bg-amber-500 dark:bg-amber-400',
  unavailable: 'bg-rose-500 dark:bg-rose-400',
  unknown: 'bg-slate-400 dark:bg-slate-500',
}

export default function ModelHealthSignal({ health }: ModelHealthSignalProps) {
  const state = health?.state ?? 'unknown'
  const bars = health?.bars ?? 0
  const description = getModelHealthDescription(health)

  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-end justify-center gap-[2px]"
      title={description}
      aria-label={description}
      role="img"
    >
      {[1, 2, 3].map((level) => (
        <span
          key={level}
          className={`w-1 rounded-sm transition-colors duration-200 ${
            level <= bars
              ? activeColorClasses[state]
              : 'bg-gray-200 dark:bg-white/[0.12]'
          } ${level === 1 ? 'h-1.5' : level === 2 ? 'h-2.5' : 'h-3.5'}`}
        />
      ))}
    </span>
  )
}
