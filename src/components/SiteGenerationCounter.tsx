import { useEffect, useRef, useState } from 'react'
import { getCounterAnimationStart } from '../lib/siteStats'

interface SiteGenerationCounterProps {
  value: number | null
}

export default function SiteGenerationCounter({ value }: SiteGenerationCounterProps) {
  const [displayValue, setDisplayValue] = useState<number | null>(value)
  const [tick, setTick] = useState(0)
  const displayRef = useRef<number | null>(value)

  useEffect(() => {
    if (value == null) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const current = displayRef.current
    const start = getCounterAnimationStart(current, value, 20, reduceMotion)
    if (start === value) {
      displayRef.current = value
      setDisplayValue(value)
      return
    }

    displayRef.current = start
    setDisplayValue(start)
    let next = start
    const steps = Math.max(1, value - start)
    const delay = Math.max(55, Math.min(120, Math.floor(900 / steps)))
    const timer = window.setInterval(() => {
      next += 1
      displayRef.current = next
      setDisplayValue(next)
      setTick((previous) => previous + 1)
      if (next >= value) window.clearInterval(timer)
    }, delay)
    return () => window.clearInterval(timer)
  }, [value])

  const formatted = displayValue == null ? '--' : displayValue.toLocaleString('zh-CN')

  return (
    <div
      className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200/70 bg-emerald-50/75 px-2 text-emerald-700 shadow-sm shadow-emerald-950/[0.03] dark:border-emerald-400/15 dark:bg-emerald-400/[0.08] dark:text-emerald-300"
      title="全站累计成功生成图片"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
      <span className="hidden whitespace-nowrap text-xs font-medium sm:inline">全站已生成</span>
      <span className="relative inline-flex min-w-[2.5ch] justify-end overflow-visible font-mono text-xs font-semibold tabular-nums sm:text-sm">
        <span key={tick} className={tick ? 'animate-site-count-tick' : ''} aria-hidden="true">{formatted}</span>
      </span>
      <span className="hidden text-xs font-medium sm:inline">张</span>
      <span className="sr-only" aria-live="polite">全站已生成 {value ?? 0} 张图片</span>
    </div>
  )
}
