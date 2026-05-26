import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import HelpModal from './HelpModal'

export default function Header() {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)
  const auth = useStore((s) => s.auth)
  const setShowAdminAudit = useStore((s) => s.setShowAdminAudit)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const userLabel = auth.user?.name || auth.user?.account || auth.user?.username || auth.user?.email || '用户'
  const pointsBalance = typeof auth.user?.pointsBalance === 'number' ? auth.user.pointsBalance : null
  const userTitle = pointsBalance == null ? userLabel : `${userLabel} · ${pointsBalance} 积分`
  const avatarInitial = userLabel.trim().slice(0, 1).toUpperCase() || 'U'
  const avatarUrl = avatarFailed ? '' : auth.user?.avatarUrl

  useEffect(() => {
    if (!showUserMenu) return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowUserMenu(false)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showUserMenu])

  async function logoutAndLogin() {
    if (loggingOut) return
    setLoggingOut(true)
    setShowUserMenu(false)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (response.ok) {
        const payload = await response.json() as { logoutUrl?: string }
        if (payload.logoutUrl) {
          window.location.href = payload.logoutUrl
          return
        }
      }
    } catch {
      // Fall through to the local login route if the logout request itself fails.
    }
    window.location.href = '/api/auth/login'
  }

  async function openFeedback() {
    const popup = window.open('', 'zr-feedback', 'width=680,height=720')
    try {
      const sourceUrl = window.location.href
      const response = await fetch(`/api/feedback/url?sourceUrl=${encodeURIComponent(sourceUrl)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await response.text())
      const payload = await response.json() as { url?: string }
      if (!payload.url) throw new Error('反馈地址无效')
      if (popup) {
        popup.location.href = payload.url
      } else {
        window.location.href = payload.url
      }
    } catch (error) {
      popup?.close()
      showToast(`打开投诉建议失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  return (
    <header data-no-drag-select className="safe-area-top sticky top-0 z-40 border-b border-white/60 bg-white/65 backdrop-blur-xl shadow-sm shadow-slate-900/[0.03] dark:border-white/[0.08] dark:bg-gray-950/65 dark:shadow-black/20">
      <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-end">
        <div className="flex items-center gap-1">
          {hasUpdate && latestRelease && (
            <a
              href={latestRelease.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="mr-1 rounded border border-red-500/30 bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transition-colors animate-fade-in hover:bg-red-600"
              title={`新版本 ${latestRelease.tag}`}
            >
              NEW
            </a>
          )}
          {auth.isAdmin && (
            <button
              onClick={() => setShowAdminAudit(true)}
              className="rounded-lg p-2 transition-colors hover:bg-white/80 dark:hover:bg-white/[0.08]"
              title="管理设置"
            >
              <svg
                className="h-5 w-5 text-gray-600 dark:text-gray-300"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M9 11h6" />
                <path d="M9 15h6" />
                <path d="M9 7h6" />
                <path d="M5 3h14a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => void openFeedback()}
            className="rounded-lg p-2 transition-colors hover:bg-white/80 dark:hover:bg-white/[0.08]"
            title="投诉建议"
            aria-label="投诉建议"
          >
            <svg
              className="h-5 w-5 text-gray-600 dark:text-gray-300"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
              <path d="M12 7v5" />
              <path d="M12 15h.01" />
            </svg>
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="rounded-lg p-2 transition-colors hover:bg-white/80 dark:hover:bg-white/[0.08]"
            title="操作指南"
          >
            <svg
              className="h-5 w-5 text-gray-600 dark:text-gray-300"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg p-2 transition-colors hover:bg-white/80 dark:hover:bg-white/[0.08]"
            title="设置"
          >
            <svg
              className="h-5 w-5 text-gray-600 dark:text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
          <a
            href="https://github.com/CookSleep/gpt_image_playground"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            title="GitHub"
            className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-white/80 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 7c.85 0 1.71.12 2.51.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.19 10.19 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
              />
            </svg>
          </a>
          <div ref={userMenuRef} className="relative ml-1">
            <button
              type="button"
              onClick={() => setShowUserMenu((value) => !value)}
              title={userTitle}
              aria-label="用户菜单"
              aria-haspopup="menu"
              aria-expanded={showUserMenu}
              className="flex h-9 max-w-52 items-center gap-2 rounded-full border border-white/70 bg-white/75 py-1 pl-1 pr-2 text-slate-700 shadow-sm shadow-slate-900/[0.04] transition-colors hover:bg-white dark:border-white/[0.1] dark:bg-white/[0.08] dark:text-slate-200 dark:hover:bg-white/[0.12]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <span>{avatarInitial}</span>
                )}
              </span>
              <span data-i18n-skip className="max-w-20 truncate text-xs font-medium sm:max-w-28 sm:text-sm">{userLabel}</span>
              {pointsBalance != null && (
                <span data-i18n-skip className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  {pointsBalance}积分
                </span>
              )}
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${showUserMenu ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {showUserMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-lg border border-white/70 bg-white/95 py-1 shadow-lg shadow-slate-900/10 backdrop-blur-xl dark:border-white/[0.1] dark:bg-gray-900/95 dark:shadow-black/30"
              >
                <div data-i18n-skip className="border-b border-gray-100 px-3 py-2 dark:border-white/[0.08]">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{userLabel}</p>
                  {pointsBalance != null && (
                    <p className="mt-0.5 text-xs font-medium text-blue-600 dark:text-blue-300">
                      积分：{pointsBalance}
                    </p>
                  )}
                  {(auth.user?.account || auth.user?.email) && (
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {auth.user?.account || auth.user?.email}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setTheme(theme === 'dark' ? 'light' : 'dark')
                    setShowUserMenu(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.06]"
                >
                  <svg
                    className="h-4 w-4 text-slate-500 dark:text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    {theme === 'dark' ? (
                      <>
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2" />
                        <path d="M12 20v2" />
                        <path d="m4.93 4.93 1.41 1.41" />
                        <path d="m17.66 17.66 1.41 1.41" />
                        <path d="M2 12h2" />
                        <path d="M20 12h2" />
                        <path d="m6.34 17.66-1.41 1.41" />
                        <path d="m19.07 4.93-1.41 1.41" />
                      </>
                    ) : (
                      <path d="M12 3a6 6 0 0 0 9 7.5A9 9 0 1 1 12 3Z" />
                    )}
                  </svg>
                  <span>{theme === 'dark' ? '切换浅色模式' : '切换深色模式'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLocale(locale === 'zh' ? 'en' : 'zh')
                    setShowUserMenu(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.06]"
                >
                  <svg
                    className="h-4 w-4 text-slate-500 dark:text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="m5 8 6 6" />
                    <path d="m4 14 6-6 2-3" />
                    <path d="M2 5h12" />
                    <path d="M7 2h1" />
                    <path d="m22 22-5-10-5 10" />
                    <path d="M14 18h6" />
                  </svg>
                  <span>{locale === 'zh' ? 'English' : '中文'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={logoutAndLogin}
                  disabled={loggingOut}
                  className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70 dark:border-white/[0.08] dark:text-slate-200 dark:hover:bg-white/[0.06]"
                >
                  <svg
                    className="h-4 w-4 text-slate-500 dark:text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="m16 17 5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  <span>{loggingOut ? '正在退出...' : '退出系统'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </header>
  )
}
