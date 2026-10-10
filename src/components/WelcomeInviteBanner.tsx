export default function WelcomeInviteBanner() {
  return (
    <div data-no-drag-select className="safe-area-x mx-auto max-w-7xl pt-3">
      <a
        href="/welcome.html"
        className="group flex items-start gap-3 rounded-lg border border-violet-200/80 bg-gradient-to-r from-violet-50/95 via-white/90 to-orange-50/80 px-3 py-3 shadow-sm shadow-violet-900/[0.04] ring-1 ring-violet-100/80 backdrop-blur-xl transition hover:border-violet-300 hover:shadow-md dark:border-violet-400/25 dark:from-violet-950/70 dark:via-gray-950/85 dark:to-orange-950/40 dark:ring-violet-400/15 sm:px-4"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300">
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">
              新产品内测邀请
            </h2>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium leading-4 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200">
              点击查看
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            本站每日赠送已暂时关闭。欢迎参与全新产品内测：注册赠送 10000 积分，建议下载客户端体验。
          </p>
        </div>
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-violet-500 transition group-hover:bg-violet-100 group-hover:text-violet-700 dark:text-violet-300 dark:group-hover:bg-violet-400/15 dark:group-hover:text-violet-100"
          aria-hidden="true"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </span>
      </a>
    </div>
  )
}
