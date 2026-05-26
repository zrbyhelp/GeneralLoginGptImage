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
  premiumApiConfig: {
    provider: ApiProvider
    baseUrl: string
    apiKey: string
    model: string
    timeout: number
    apiMode: ApiMode
    codexCli: boolean
  }
  dailyPointsTarget: number
  standardPointCost: number
  premiumPointCost: number
  galleryUploadDefault: boolean
  hourlyImageLimit: number
  privacyHourlyImageLimit: number
  serviceConcurrentImageLimit: number
  userConcurrentImageLimit: number
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
  premiumApiConfig: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-2',
    timeout: 600,
    apiMode: 'images',
    codexCli: false,
  },
  dailyPointsTarget: 100,
  standardPointCost: 1,
  premiumPointCost: 300,
  galleryUploadDefault: false,
  hourlyImageLimit: 20,
  privacyHourlyImageLimit: 5,
  serviceConcurrentImageLimit: 3,
  userConcurrentImageLimit: 3,
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
  const [redeemCount, setRedeemCount] = useState(10)
  const [redeemPoints, setRedeemPoints] = useState(100)
  const [redeemLoading, setRedeemLoading] = useState(false)

  useCloseOnEscape(showAdminAudit, () => setShowAdminAudit(false))

  useEffect(() => {
    if (!showAdminAudit) return
    void loadSettings()
  }, [showAdminAudit])

  async function getResponseErrorMessage(response: Response) {
    try {
      const text = await response.text()
      if (!text.trim()) return `HTTP ${response.status}`
      try {
        const payload = JSON.parse(text) as Record<string, unknown>
        if (typeof payload.statusMessage === 'string') return payload.statusMessage
        if (typeof payload.message === 'string') return payload.message
        if (typeof payload.error === 'string') return payload.error
        if (payload.error && typeof payload.error === 'object') {
          const errorRecord = payload.error as Record<string, unknown>
          if (typeof errorRecord.message === 'string') return errorRecord.message
        }
      } catch {
        return text
      }
    } catch {
      return `HTTP ${response.status}`
    }
  }

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
      if (!response.ok) throw new Error(await getResponseErrorMessage(response))
      setSettings(await response.json())
      showToast('管理员设置已保存', 'success')
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function issueRedeemCodes() {
    setRedeemLoading(true)
    try {
      const response = await fetch('/api/admin/redeem-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: redeemCount,
          pointsPerCode: redeemPoints,
        }),
      })
      if (!response.ok) throw new Error(await getResponseErrorMessage(response))
      const text = await response.text()
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `redeem-codes-${redeemCount}x${redeemPoints}.txt`
      a.click()
      URL.revokeObjectURL(url)
      showToast('兑换码已生成', 'success')
    } catch (error) {
      showToast(`兑换码发放失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setRedeemLoading(false)
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
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">关闭图集上传时每小时最多生成图片数</span>
              <input
                value={settings.privacyHourlyImageLimit}
                onChange={(event) => setSettings((prev) => ({ ...prev, privacyHourlyImageLimit: Math.max(1, Number(event.target.value) || 1) }))}
                min={1}
                max={1000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">全服务同时生成图片数</span>
              <input
                value={settings.serviceConcurrentImageLimit}
                onChange={(event) => setSettings((prev) => ({ ...prev, serviceConcurrentImageLimit: Math.max(1, Number(event.target.value) || 1) }))}
                min={1}
                max={1000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">单账号同时生成图片数</span>
              <input
                value={settings.userConcurrentImageLimit}
                onChange={(event) => setSettings((prev) => ({ ...prev, userConcurrentImageLimit: Math.max(1, Number(event.target.value) || 1) }))}
                min={1}
                max={1000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每日补满积分</span>
              <input
                value={settings.dailyPointsTarget}
                onChange={(event) => setSettings((prev) => ({ ...prev, dailyPointsTarget: Math.max(1, Number(event.target.value) || 100) }))}
                min={1}
                max={1000000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">1K 档单张消耗</span>
              <input
                value={settings.standardPointCost}
                onChange={(event) => setSettings((prev) => ({ ...prev, standardPointCost: Math.max(1, Number(event.target.value) || 1) }))}
                min={1}
                max={1000000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">2K-4K 档单张消耗</span>
              <input
                value={settings.premiumPointCost}
                onChange={(event) => setSettings((prev) => ({ ...prev, premiumPointCost: Math.max(1, Number(event.target.value) || 300) }))}
                min={1}
                max={1000000}
                type="number"
                className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
              />
            </label>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
              <span className="text-sm text-gray-600 dark:text-gray-300">默认上传图集</span>
              <button
                type="button"
                onClick={() => setSettings((prev) => ({ ...prev, galleryUploadDefault: !prev.galleryUploadDefault }))}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${settings.galleryUploadDefault ? 'bg-blue-500' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${settings.galleryUploadDefault ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
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
            <div className="sm:col-span-2 rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">2K-4K 专用 API</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">开启后按高档位消耗积分</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">服务商类型</span>
                  <select
                    value={settings.premiumApiConfig.provider}
                    onChange={(event) => setSettings((prev) => ({
                      ...prev,
                      premiumApiConfig: {
                        ...prev.premiumApiConfig,
                        provider: event.target.value as ApiProvider,
                        apiMode: event.target.value === 'fal' ? 'images' : prev.premiumApiConfig.apiMode,
                        codexCli: event.target.value === 'openai' ? prev.premiumApiConfig.codexCli : false,
                      },
                    }))}
                    className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                  >
                    <option value="openai">OpenAI 兼容接口</option>
                    <option value="fal">fal.ai</option>
                  </select>
                </label>
                {settings.premiumApiConfig.provider === 'openai' && (
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
                    <input
                      value={settings.premiumApiConfig.baseUrl}
                      onChange={(event) => setSettings((prev) => ({
                        ...prev,
                        premiumApiConfig: { ...prev.premiumApiConfig, baseUrl: event.target.value },
                      }))}
                      className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API Key</span>
                  <input
                    value={settings.premiumApiConfig.apiKey}
                    onChange={(event) => setSettings((prev) => ({
                      ...prev,
                      premiumApiConfig: { ...prev.premiumApiConfig, apiKey: event.target.value },
                    }))}
                    type="password"
                    className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">模型 ID</span>
                  <input
                    value={settings.premiumApiConfig.model}
                    onChange={(event) => setSettings((prev) => ({
                      ...prev,
                      premiumApiConfig: { ...prev.premiumApiConfig, model: event.target.value },
                    }))}
                    className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                  />
                </label>
                {settings.premiumApiConfig.provider === 'openai' && (
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API 接口</span>
                    <select
                      value={settings.premiumApiConfig.apiMode}
                      onChange={(event) => setSettings((prev) => ({
                        ...prev,
                        premiumApiConfig: { ...prev.premiumApiConfig, apiMode: event.target.value as ApiMode },
                      }))}
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
                    value={settings.premiumApiConfig.timeout}
                    onChange={(event) => setSettings((prev) => ({
                      ...prev,
                      premiumApiConfig: { ...prev.premiumApiConfig, timeout: Math.max(10, Number(event.target.value) || 600) },
                    }))}
                    min={10}
                    max={3600}
                    type="number"
                    className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                  />
                </label>
                {settings.premiumApiConfig.provider === 'openai' && (
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                    <span className="text-sm text-gray-600 dark:text-gray-300">Codex CLI 兼容模式</span>
                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({
                        ...prev,
                        premiumApiConfig: {
                          ...prev.premiumApiConfig,
                          codexCli: !prev.premiumApiConfig.codexCli,
                        },
                      }))}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${settings.premiumApiConfig.codexCli ? 'bg-blue-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${settings.premiumApiConfig.codexCli ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                )}
              </div>
            </div>
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
          <section className="mt-6 border-t border-gray-100 pt-5 dark:border-white/[0.08]">
            <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
              <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h10" />
              </svg>
              兑换码发放
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">发放数量</span>
                <input
                  value={redeemCount}
                  onChange={(event) => setRedeemCount(Math.max(1, Number(event.target.value) || 1))}
                  min={1}
                  max={1000}
                  type="number"
                  className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每个可兑换积分</span>
                <input
                  value={redeemPoints}
                  onChange={(event) => setRedeemPoints(Math.max(1, Number(event.target.value) || 1))}
                  min={1}
                  max={1000000}
                  type="number"
                  className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void issueRedeemCodes()}
                disabled={redeemLoading}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
              >
                {redeemLoading ? '生成中...' : '生成并下载 TXT'}
              </button>
            </div>
          </section>
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
