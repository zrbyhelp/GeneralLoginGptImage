import { useEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { applyTheme, getInitialDisplayPreferences, getLoginNoticeToken, setDomLocale } from './lib/i18n'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import PortalBackground from './components/PortalBackground'
import AdminAuditModal from './components/AdminAuditModal'
import LoginNoticeModal from './components/LoginNoticeModal'
import AnnouncementBanner, { type ServiceAnnouncement } from './components/AnnouncementBanner'

export default function App() {
  const auth = useStore((s) => s.auth)
  const setAuth = useStore((s) => s.setAuth)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  const lastSeenLoginNoticeToken = useStore((s) => s.lastSeenLoginNoticeToken)
  const setLastSeenLoginNoticeToken = useStore((s) => s.setLastSeenLoginNoticeToken)
  const setUploadToGallery = useStore((s) => s.setUploadToGallery)
  const dismissedAnnouncementIds = useStore((s) => s.dismissedAnnouncementIds)
  const dismissAnnouncement = useStore((s) => s.dismissAnnouncement)
  const [loginNoticeToken, setLoginNoticeToken] = useState<string | null>(null)
  const [announcements, setAnnouncements] = useState<ServiceAnnouncement[]>([])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const blockedQueryKeys = ['apiUrl', 'apiKey', 'codexCli', 'apiMode', 'provider']
    let removedApiQuery = false
    for (const key of blockedQueryKeys) {
      if (searchParams.has(key)) {
        searchParams.delete(key)
        removedApiQuery = true
      }
    }

    if (removedApiQuery) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${searchParams.toString() ? `?${searchParams}` : ''}${window.location.hash}`,
      )
    }

    initStore()

    const displayPreferences = getInitialDisplayPreferences()
    setTheme(displayPreferences.theme)
    setLocale(displayPreferences.locale)
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    setDomLocale(locale)
  }, [locale])

  useEffect(() => {
    let cancelled = false

    async function loadAuth() {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        const payload = await response.json()
        if (cancelled) return
        if (!payload.authenticated) {
          const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
          window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
          return
        }
        setAuth({
          loading: false,
          authenticated: true,
          isAdmin: Boolean(payload.isAdmin),
          user: payload.user,
          generationDefaults: payload.generationDefaults ?? {
            dailyPointsTarget: 100,
            standardPointCost: 1,
            premiumPointCost: 300,
            galleryUploadDefault: false,
          },
        })
        setUploadToGallery(Boolean(payload.generationDefaults?.galleryUploadDefault))
      } catch {
        if (!cancelled) {
          setAuth({ loading: false, authenticated: false, isAdmin: false, user: null })
        }
      }
    }

    loadAuth()
    return () => {
      cancelled = true
    }
  }, [setAuth, setUploadToGallery])

  useEffect(() => {
    if (!auth.authenticated) {
      setLoginNoticeToken(null)
      return
    }

    const token = getLoginNoticeToken()
    if (token && token !== lastSeenLoginNoticeToken) {
      setLoginNoticeToken(token)
    }
  }, [auth.authenticated, lastSeenLoginNoticeToken])

  useEffect(() => {
    if (!auth.authenticated) {
      setAnnouncements([])
      return
    }

    const controller = new AbortController()
    async function loadAnnouncements() {
      try {
        const response = await fetch('/api/announcements', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(await response.text())
        const payload = await response.json() as { announcements?: ServiceAnnouncement[] }
        if (!controller.signal.aborted) {
          setAnnouncements(Array.isArray(payload.announcements) ? payload.announcements : [])
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Failed to load announcements:', error)
          setAnnouncements([])
        }
      }
    }

    loadAnnouncements()
    return () => controller.abort()
  }, [auth.authenticated, auth.user?.id])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  if (auth.loading) {
    return (
      <>
        <PortalBackground />
        <div className="relative z-10 flex min-h-screen items-center justify-center text-sm text-gray-500">
          正在验证登录...
        </div>
      </>
    )
  }

  if (!auth.authenticated) {
    return (
      <>
        <PortalBackground />
        <div className="relative z-10 flex min-h-screen items-center justify-center text-sm text-gray-500">
          正在跳转统一登录...
        </div>
      </>
    )
  }

  return (
    <>
      <PortalBackground />
      <div className="relative z-10 min-h-screen">
        <Header />
        <AnnouncementBanner
          announcements={announcements.filter((announcement) => !dismissedAnnouncementIds.includes(announcement.id))}
          onDismiss={dismissAnnouncement}
        />
        <main data-home-main data-drag-select-surface className="pb-48">
          <div className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            <TaskGrid />
          </div>
        </main>
        <InputBar />
        <DetailModal />
        <Lightbox />
        <SettingsModal />
        <AdminAuditModal />
        <ConfirmDialog />
        <Toast />
        <MaskEditorModal />
        <ImageContextMenu />
        {loginNoticeToken && (
          <LoginNoticeModal
            onAcknowledge={() => {
              setLastSeenLoginNoticeToken(loginNoticeToken)
              setLoginNoticeToken(null)
            }}
          />
        )}
      </div>
    </>
  )
}
