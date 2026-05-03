import { createPortal } from 'react-dom'

interface Props {
  onAcknowledge: () => void
}

export default function LoginNoticeModal({ onAcknowledge }: Props) {
  return createPortal(
    <div data-no-drag-select className="fixed inset-0 z-[115] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-md animate-overlay-in dark:bg-black/50" />
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/60 bg-white/95 p-6 shadow-2xl ring-1 ring-black/5 animate-confirm-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
          <svg className="h-5 w-5 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <h3>提示</h3>
        </div>
        <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
          目前服务器资源有限，生成记录和图片资源会优先保存在当前浏览器中。切换账号不会改变本机已有内容；如果需要为不同账号隔离数据，建议使用不同的浏览器用户配置或独立浏览器。
        </p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onAcknowledge}
            className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

