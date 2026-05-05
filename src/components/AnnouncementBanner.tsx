export interface ServiceAnnouncement {
  id: string
  title: string
  content: string
  scope: 'global' | 'service'
  serviceId: string | null
  sortOrder: number
  createdAt: string | null
  updatedAt: string | null
}

interface Props {
  announcements: ServiceAnnouncement[]
  onDismiss: (id: string) => void
}

export default function AnnouncementBanner({ announcements, onDismiss }: Props) {
  const announcement = announcements[0]
  if (!announcement) return null

  const hasTitle = Boolean(announcement.title)
  const title = hasTitle ? announcement.title : '公告'
  const content = announcement.content

  return (
    <div data-no-drag-select className="safe-area-x mx-auto max-w-7xl pt-3">
      <section className="animate-fade-in rounded-lg border border-sky-200/70 bg-white/90 px-3 py-3 shadow-sm shadow-slate-900/[0.04] ring-1 ring-sky-100/70 backdrop-blur-xl dark:border-sky-400/20 dark:bg-gray-950/85 dark:ring-sky-400/10 sm:px-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300">
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
              <path d="M10 2v2" />
              <path d="M14 2v2" />
              <path d="M4 7h16" />
              <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
              <path d="M8 11h8" />
              <path d="M8 15h5" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 data-i18n-skip={hasTitle ? '' : undefined} className="text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">
                {title}
              </h2>
              {announcements.length > 1 && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium leading-4 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
                  1 / {announcements.length}
                </span>
              )}
            </div>
            {content && (
              <p data-i18n-skip className="mt-1 max-h-24 overflow-y-auto whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">
                {content}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(announcement.id)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
            title="关闭公告"
            aria-label="关闭公告"
          >
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </section>
    </div>
  )
}
