import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

type ApiProvider = 'openai' | 'fal'
type ApiMode = 'images' | 'responses'

type AdminSettings = {
  apiConfig: {
    provider: ApiProvider
    baseUrl: string
    apiKey: string
    model: string
    timeout: number
    apiMode: ApiMode
    codexCli: boolean
  }
  hourlyImageLimit: number
  privacyHourlyImageLimit: number
  galleryUploadUrl: string
  galleryUploadToken: string
  updatedAt: string | null
}

const DEFAULT_SETTINGS: AdminSettings = {
  apiConfig: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-2',
    timeout: 600,
    apiMode: 'images',
    codexCli: false,
  },
  hourlyImageLimit: 20,
  privacyHourlyImageLimit: 5,
  galleryUploadUrl: 'https://imglist.zrbyhelp.com/api/uploads/third-party',
  galleryUploadToken: '',
  updatedAt: null,
}

export default function AdminAuditModal() {
  const showAdminAudit = useStore((s) => s.showAdminAudit)
  const setShowAdminAudit = useStore((s) => s.setShowAdminAudit)
  const showToast = useStore((s) => s.showToast)
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)

  useCloseOnEscape(showAdminAudit, () => setShowAdminAudit(false))

  useEffect(() => {
    if (!showAdminAudit) return
    void loadSettings()
  }, [showAdminAudit])

  async function loadSettings() {
    const response = await fetch('/api/admin/settings', { cache: 'no-store' })
    if (!response.ok) {
      showToast('加载管理员设置失败', 'error')
      return
    }
    setSettings(await response.json())
  }

  async function saveSettings() {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!response.ok) throw new Error(await response.text())
      setSettings(await response.json())
      showToast('管理员设置已保存', 'success')
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!showAdminAudit) return null

  return (
    <div data-no-drag-select className="fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in dark:bg-black/50" onClick={() => setShowAdminAudit(false)} />
      <div className="relative z-10 flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">管理设置</h3>
          <button
            onClick={() => setShowAdminAudit(false)}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">服务商类型</span>
              <select
                value={settings.apiConfig.provider}
                onChange={(event) => setSettings((prev) => ({
                  ...prev,
                  apiConfig: {
                    ...prev.apiConfig,
                    provider: event.target.value as ApiProvider,
                    apiMode: event.target.value === 'fal' ? 'images' : prev.apiConfig.apiMode,
                    codexCli: event.target.value === 'openai' ? prev.apiConfig.codexCli : false,
                  },
                }))}
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              >
                <option value="openai">OpenAI 兼容接口</option>
                <option value="fal">fal.ai</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每小时每用户最多生成图片数</span>
              <input
                value={settings.hourlyImageLimit}
                onChange={(event) => setSettings((prev) => ({ ...prev, hourlyImageLimit: Math.max(1, Number(event.target.value) || 1) }))}
                min={1}
                max={1000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每小时每用户最多隐私图片数</span>
              <input
                value={settings.privacyHourlyImageLimit}
                onChange={(event) => setSettings((prev) => ({ ...prev, privacyHourlyImageLimit: Math.max(1, Number(event.target.value) || 1) }))}
                min={1}
                max={1000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            {settings.apiConfig.provider === 'openai' && (
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
                <input
                  value={settings.apiConfig.baseUrl}
                  onChange={(event) => setSettings((prev) => ({ ...prev, apiConfig: { ...prev.apiConfig, baseUrl: event.target.value } }))}
                  className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API Key</span>
              <input
                value={settings.apiConfig.apiKey}
                onChange={(event) => setSettings((prev) => ({ ...prev, apiConfig: { ...prev.apiConfig, apiKey: event.target.value } }))}
                type="password"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">模型 ID</span>
              <input
                value={settings.apiConfig.model}
                onChange={(event) => setSettings((prev) => ({ ...prev, apiConfig: { ...prev.apiConfig, model: event.target.value } }))}
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            {settings.apiConfig.provider === 'openai' && (
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API 接口</span>
                <select
                  value={settings.apiConfig.apiMode}
                  onChange={(event) => setSettings((prev) => ({ ...prev, apiConfig: { ...prev.apiConfig, apiMode: event.target.value as ApiMode } }))}
                  className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                >
                  <option value="images">Images API</option>
                  <option value="responses">Responses API</option>
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">请求超时 (秒)</span>
              <input
                value={settings.apiConfig.timeout}
                onChange={(event) => setSettings((prev) => ({ ...prev, apiConfig: { ...prev.apiConfig, timeout: Math.max(10, Number(event.target.value) || 600) } }))}
                min={10}
                max={3600}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">图集上传 URL</span>
              <input
                value={settings.galleryUploadUrl}
                onChange={(event) => setSettings((prev) => ({ ...prev, galleryUploadUrl: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">图集上传 Token</span>
              <input
                value={settings.galleryUploadToken}
                onChange={(event) => setSettings((prev) => ({ ...prev, galleryUploadToken: event.target.value }))}
                type="password"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            {settings.apiConfig.provider === 'openai' && (
              <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <span className="text-sm text-gray-600 dark:text-gray-300">Codex CLI 兼容模式</span>
                <button
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, apiConfig: { ...prev.apiConfig, codexCli: !prev.apiConfig.codexCli } }))}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${settings.apiConfig.codexCli ? 'bg-blue-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${settings.apiConfig.codexCli ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end">
            <button
              disabled={saving}
              onClick={() => void saveSettings()}
              className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
