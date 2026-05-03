import { useEffect, useMemo, useState } from 'react'
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
  updatedAt: string | null
}

type AuditImage = {
  id: string
  url: string
  fileName?: string
  mime: string
  size: number
}

type AuditItem = {
  id: string
  userId: string
  userAccount: string | null
  userEmail: string | null
  userUsername: string | null
  userName: string | null
  prompt: string
  params: Record<string, unknown>
  requestedImageCount: number
  inputImageCount: number
  maskUsed: boolean
  apiProvider: string
  apiModel: string
  status: 'done'
  error: string | null
  auditSaveError?: string | null
  outputImages: AuditImage[]
  createdAt: string
  finishedAt: string | null
  elapsed: number | null
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
  updatedAt: null,
}

function formatDate(value: string | null, locale: 'zh' | 'en') {
  if (!value) return '-'
  return new Date(value).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function auditUserLabel(item: AuditItem) {
  return item.userAccount || item.userEmail || item.userName || item.userUsername || item.userId
}

export default function AdminAuditModal() {
  const showAdminAudit = useStore((s) => s.showAdminAudit)
  const setShowAdminAudit = useStore((s) => s.setShowAdminAudit)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const locale = useStore((s) => s.locale)
  const [activeTab, setActiveTab] = useState<'list' | 'settings'>('list')
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS)
  const [items, setItems] = useState<AuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ item: AuditItem; index: number } | null>(null)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [filters, setFilters] = useState({ q: '', model: '' })

  useCloseOnEscape(showAdminAudit, () => setShowAdminAudit(false))
  useCloseOnEscape(Boolean(preview), () => setPreview(null))

  useEffect(() => {
    if (!preview) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        switchPreviewImage(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        switchPreviewImage(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview])

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (filters.q.trim()) params.set('q', filters.q.trim())
    if (filters.model.trim()) params.set('model', filters.model.trim())
    return params.toString()
  }, [filters, page, pageSize])

  useEffect(() => {
    if (!showAdminAudit) return
    void loadSettings()
    void loadItems()
  }, [showAdminAudit])

  useEffect(() => {
    if (!showAdminAudit || activeTab !== 'list') return
    void loadItems()
  }, [activeTab, queryString, showAdminAudit])

  async function loadSettings() {
    const response = await fetch('/api/admin/settings', { cache: 'no-store' })
    if (!response.ok) {
      showToast('加载管理员设置失败', 'error')
      return
    }
    setSettings(await response.json())
  }

  async function loadItems() {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/generations?${queryString}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await response.text())
      const payload = await response.json()
      setItems(payload.items ?? [])
      setTotal(payload.total ?? 0)
    } catch (error) {
      showToast(`加载审计列表失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setLoading(false)
    }
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

  function deleteItem(item: AuditItem) {
    setConfirmDialog({
      title: '删除审计记录',
      message: '只会删除服务器保存的审计记录和图片文件，不会影响用户本地任务记录。',
      tone: 'danger',
      action: async () => {
        const response = await fetch(`/api/admin/generations/${item.id}`, { method: 'DELETE' })
        if (!response.ok) {
          showToast('删除审计记录失败', 'error')
          return
        }
        showToast('审计记录已删除', 'success')
        void loadItems()
      },
    })
  }

  function deleteAllItems() {
    setConfirmDialog({
      title: '删除全部审计记录',
      message: '确定要删除服务器保存的全部审计记录和图片文件吗？此操作不会影响用户浏览器里的本地任务记录。',
      tone: 'danger',
      confirmText: '全部删除',
      action: async () => {
        const response = await fetch('/api/admin/generations', { method: 'DELETE' })
        if (!response.ok) {
          showToast('删除全部审计记录失败', 'error')
          return
        }
        showToast('全部审计记录已删除', 'success')
        setItems([])
        setTotal(0)
        setPage(1)
        void loadItems()
      },
    })
  }

  function exportItems() {
    const params = new URLSearchParams(queryString)
    params.delete('page')
    params.delete('pageSize')
    window.location.href = `/api/admin/generations/export?${params}`
  }

  function openPreview(item: AuditItem, index = 0) {
    if (!item.outputImages[index]) return
    setPreview({ item, index })
    setPreviewZoom(1)
  }

  function switchPreviewImage(delta: number) {
    setPreview((current) => {
      if (!current) return current
      const totalImages = current.item.outputImages.length
      if (totalImages <= 0) return current
      return {
        item: current.item,
        index: (current.index + delta + totalImages) % totalImages,
      }
    })
    setPreviewZoom(1)
  }

  if (!showAdminAudit) return null

  return (
    <div data-no-drag-select className="fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in dark:bg-black/50" onClick={() => setShowAdminAudit(false)} />
      <div className="relative z-10 flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">生成审计</h3>
            <div className="flex rounded-xl bg-gray-100 p-1 text-sm dark:bg-white/[0.06]">
              <button
                className={`rounded-lg px-3 py-1.5 ${activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}
                onClick={() => setActiveTab('list')}
              >
                列表
              </button>
              <button
                className={`rounded-lg px-3 py-1.5 ${activeTab === 'settings' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}
                onClick={() => setActiveTab('settings')}
              >
                管理设置
              </button>
            </div>
          </div>
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

        {activeTab === 'list' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08]">
              <input
                value={filters.q}
                onChange={(event) => {
                  setPage(1)
                  setFilters((prev) => ({ ...prev, q: event.target.value }))
                }}
                className="min-w-64 flex-1 rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                placeholder="搜索提示词、用户..."
              />
              <input
                value={filters.model}
                onChange={(event) => {
                  setPage(1)
                  setFilters((prev) => ({ ...prev, model: event.target.value }))
                }}
                className="w-40 rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                placeholder="模型"
              />
              <button className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]" onClick={() => void loadItems()}>
                刷新
              </button>
              <button className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-600 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20" onClick={exportItems}>
                导出
              </button>
              <button className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20" onClick={deleteAllItems}>
                全部删除
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {loading ? (
                <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">加载中...</div>
              ) : items.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">暂无记录</div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => {
                    const expanded = expandedId === item.id
                    const coverImage = item.outputImages[0]
                    return (
                      <article key={item.id} className="rounded-2xl border border-gray-200/70 bg-white/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.04]">
                        <div className="flex flex-col gap-4 sm:flex-row">
                          <div className="h-28 w-full shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 sm:w-28 dark:border-white/[0.08] dark:bg-white/[0.03]">
                            {coverImage ? (
                              <button
                                type="button"
                                onClick={() => openPreview(item, 0)}
                                className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-gray-100 dark:bg-white/[0.04]"
                                title="查看图片"
                              >
                                <img src={coverImage.url} className="h-full w-full object-contain transition-transform group-hover:scale-105" alt="" />
                                {item.outputImages.length > 1 && (
                                  <span className="absolute right-1.5 top-1.5 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white shadow-sm">
                                    {item.outputImages.length}
                                  </span>
                                )}
                              </button>
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                                无图片
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                  <span>{formatDate(item.createdAt, locale)}</span>
                                  <span>{auditUserLabel(item)}</span>
                                  <span>{item.apiProvider} / {item.apiModel}</span>
                                  <span>{item.requestedImageCount} 张</span>
                                  {item.outputImages.length > 0 && <span>{item.outputImages.length} 个文件</span>}
                                </div>
                                <p data-i18n-skip className="line-clamp-2 text-sm leading-6 text-gray-800 dark:text-gray-100">{item.prompt}</p>
                                {item.error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{item.error}</p>}
                                {item.auditSaveError && <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">审计图片保存失败：{item.auditSaveError}</p>}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]" onClick={() => setExpandedId(expanded ? null : item.id)}>
                                  {expanded ? '收起' : '详情'}
                                </button>
                                <button className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20" onClick={() => deleteItem(item)}>
                                  删除
                                </button>
                              </div>
                            </div>
                            {expanded && (
                              <div className="mt-4 border-t border-gray-100 pt-4 dark:border-white/[0.08]">
                                <div className="mb-3">
                                  <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">完整提示词</p>
                                  <p data-selectable-text data-i18n-skip className="whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-700 dark:bg-white/[0.04] dark:text-gray-200">
                                    {item.prompt}
                                  </p>
                                </div>
                                <pre data-selectable-text className="max-h-52 overflow-auto rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
                                  {JSON.stringify({ params: item.params, inputImageCount: item.inputImageCount, maskUsed: item.maskUsed }, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-sm text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
              <span>共 {total} 条</span>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} className="rounded-lg bg-gray-100 px-3 py-1.5 disabled:opacity-40 dark:bg-white/[0.06]" onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                  上一页
                </button>
                <span>第 {page} 页</span>
                <button disabled={page * pageSize >= total} className="rounded-lg bg-gray-100 px-3 py-1.5 disabled:opacity-40 dark:bg-white/[0.06]" onClick={() => setPage((prev) => prev + 1)}>
                  下一页
                </button>
              </div>
            </div>
          </div>
        ) : (
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
        )}
      </div>
      {preview && (
        <div className="fixed inset-0 z-[95] flex flex-col bg-black/82 backdrop-blur-sm" onClick={() => setPreview(null)}>
          {(() => {
            const image = preview.item.outputImages[preview.index]
            if (!image) return null
            const totalImages = preview.item.outputImages.length
            return (
              <>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
            <div className="min-w-0">
              <p data-i18n-skip className="truncate text-sm font-medium">{preview.item.prompt}</p>
              <p className="mt-0.5 text-xs text-white/65">
                {image.fileName || image.mime} · {formatBytes(image.size)} · {preview.index + 1}/{totalImages} · {Math.round(previewZoom * 100)}%
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {totalImages > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      switchPreviewImage(-1)
                    }}
                    className="rounded-lg bg-white/12 px-3 py-1.5 text-sm hover:bg-white/20"
                  >
                    上一张
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      switchPreviewImage(1)
                    }}
                    className="rounded-lg bg-white/12 px-3 py-1.5 text-sm hover:bg-white/20"
                  >
                    下一张
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setPreviewZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))
                }}
                className="rounded-lg bg-white/12 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-40"
                disabled={previewZoom <= 0.5}
              >
                缩小
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setPreviewZoom(1)
                }}
                className="rounded-lg bg-white/12 px-3 py-1.5 text-sm hover:bg-white/20"
              >
                100%
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setPreviewZoom((value) => Math.min(4, Number((value + 0.25).toFixed(2))))
                }}
                className="rounded-lg bg-white/12 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-40"
                disabled={previewZoom >= 4}
              >
                放大
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg bg-white/12 px-3 py-1.5 text-sm hover:bg-white/20"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-full items-center justify-center">
              {totalImages > 1 && (
                <button
                  type="button"
                  onClick={() => switchPreviewImage(-1)}
                  className="fixed left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/12 text-2xl text-white hover:bg-white/20"
                  aria-label="上一张"
                >
                  ‹
                </button>
              )}
              <img
                src={image.url}
                alt=""
                className="select-none rounded-lg object-contain shadow-2xl"
                style={{
                  maxWidth: `${90 * previewZoom}vw`,
                  maxHeight: `${78 * previewZoom}vh`,
                }}
                draggable={false}
              />
              {totalImages > 1 && (
                <button
                  type="button"
                  onClick={() => switchPreviewImage(1)}
                  className="fixed right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/12 text-2xl text-white hover:bg-white/20"
                  aria-label="下一张"
                >
                  ›
                </button>
              )}
            </div>
          </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
