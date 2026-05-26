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
        <div className="space-y-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
          <p>
            目前每日会自动补满至 100 积分，平台已完全开放使用，无需申请。
          </p>
          <p>
            如需生成 4K 图片或更高频生成，可前往商店购买卡密补充积分：5 元可兑换 50000 积分。
            <a
              href="https://pay.ldxp.cn/shop/QEJABMGR"
              target="_blank"
              rel="noreferrer"
              className="ml-1 font-medium text-blue-600 underline underline-offset-2 transition hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
            >
              前往商店购买卡密
            </a>
          </p>
        </div>
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

