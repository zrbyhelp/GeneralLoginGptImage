import { useEffect, useState } from 'react'
import type { AdminModelConfig, ApiMode, ApiProvider, SizePriceTier, TaskParams, TieredPricingRules } from '../types'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { DEFAULT_OPENAI_TIERED_PRICING_RULES, normalizeTieredPricingRules } from '../lib/pricing'

type AdminSettings = {
  models: AdminModelConfig[]
  defaultModelId: string
  dailyPointsTarget: number
  standardPointCost: number
  galleryUploadDefault: boolean
  hourlyImageLimit: number
  privacyHourlyImageLimit: number
  serviceConcurrentImageLimit: number
  userConcurrentImageLimit: number
  galleryUploadUrl: string
  galleryUploadToken: string
  updatedAt: string | null
}

const DEFAULT_MODEL: AdminModelConfig = {
  id: 'default-model',
  name: '默认模型',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-2',
  timeout: 600,
  apiMode: 'images',
  codexCompatible: false,
  enabled: true,
  pricingMode: 'flat',
  pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
}

const DEFAULT_SETTINGS: AdminSettings = {
  models: [DEFAULT_MODEL],
  defaultModelId: DEFAULT_MODEL.id,
  dailyPointsTarget: 100,
  standardPointCost: 1,
  galleryUploadDefault: false,
  hourlyImageLimit: 20,
  privacyHourlyImageLimit: 5,
  serviceConcurrentImageLimit: 3,
  userConcurrentImageLimit: 3,
  galleryUploadUrl: 'https://imglist.zrbyhelp.com/api/uploads/third-party',
  galleryUploadToken: '',
  updatedAt: null,
}

function createModel(): AdminModelConfig {
  return {
    ...DEFAULT_MODEL,
    id: `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: '新模型',
  }
}

function patchModel(models: AdminModelConfig[], id: string, patch: Partial<AdminModelConfig>) {
  return models.map((model) => {
    if (model.id !== id) return model
    const provider = patch.provider ?? model.provider
    return {
      ...model,
      ...patch,
      apiMode: provider === 'fal' ? 'images' : patch.apiMode ?? model.apiMode,
      codexCompatible: provider === 'openai' ? patch.codexCompatible ?? model.codexCompatible : false,
      baseUrl: patch.provider === 'fal' ? 'https://fal.run' : patch.baseUrl ?? model.baseUrl,
      model: patch.provider === 'fal' && !model.model.trim() ? 'openai/gpt-image-2' : patch.model ?? model.model,
    }
  })
}

const PRICE_TIERS: SizePriceTier[] = ['1K', '2K', '4K']
const PRICE_QUALITIES: Array<TaskParams['quality']> = ['auto', 'low', 'medium', 'high']

function patchPricingRules(
  rules: TieredPricingRules,
  updater: (rules: TieredPricingRules) => TieredPricingRules,
) {
  return updater(normalizeTieredPricingRules(rules))
}

function pricingNumber(value: string) {
  return Math.max(0, Math.floor(Number(value) || 0))
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
        body: JSON.stringify({ count: redeemCount, pointsPerCode: redeemPoints }),
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

  function updateModel(id: string, patch: Partial<AdminModelConfig>) {
    setSettings((prev) => {
      const models = patchModel(prev.models, id, patch)
      const defaultModel = models.find((model) => model.id === prev.defaultModelId)
      return {
        ...prev,
        models,
        defaultModelId: defaultModel?.enabled
          ? prev.defaultModelId
          : models.find((model) => model.enabled)?.id ?? models[0].id,
      }
    })
  }

  function updateModelPricingRule(id: string, patcher: (rules: TieredPricingRules) => TieredPricingRules) {
    setSettings((prev) => ({
      ...prev,
      models: prev.models.map((model) =>
        model.id === id
          ? { ...model, pricingRules: patchPricingRules(model.pricingRules, patcher) }
          : model,
      ),
    }))
  }

  function updateTierPrice(id: string, tier: SizePriceTier, quality: TaskParams['quality'], value: string) {
    updateModelPricingRule(id, (rules) => ({
      ...rules,
      sizeQualityPoints: {
        ...rules.sizeQualityPoints,
        [tier]: {
          ...rules.sizeQualityPoints[tier],
          [quality]: Math.max(1, pricingNumber(value)),
        },
      },
    }))
  }

  function updatePricingNumber(id: string, key: keyof Pick<TieredPricingRules, 'referenceImagePoints' | 'maskEditPoints' | 'minimumPoints'>, value: string) {
    updateModelPricingRule(id, (rules) => ({
      ...rules,
      [key]: key === 'minimumPoints'
        ? Math.max(1, pricingNumber(value))
        : pricingNumber(value),
    }))
  }

  function addModel() {
    const model = createModel()
    setSettings((prev) => ({
      ...prev,
      models: [...prev.models, model],
      defaultModelId: prev.defaultModelId || model.id,
    }))
  }

  function removeModel(id: string) {
    setSettings((prev) => {
      if (prev.models.length <= 1) return prev
      const models = prev.models.filter((model) => model.id !== id)
      return {
        ...prev,
        models,
        defaultModelId: prev.defaultModelId === id ? models.find((model) => model.enabled)?.id ?? models[0].id : prev.defaultModelId,
      }
    })
  }

  if (!showAdminAudit) return null

  return (
    <div data-no-drag-select className="fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in dark:bg-black/50" onClick={() => setShowAdminAudit(false)} />
      <div className="relative z-10 flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每小时每用户最多生成图片数</span>
              <input value={settings.hourlyImageLimit} onChange={(event) => setSettings((prev) => ({ ...prev, hourlyImageLimit: Math.max(1, Number(event.target.value) || 1) }))} min={1} max={1000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">关闭图集上传时每小时最多生成图片数</span>
              <input value={settings.privacyHourlyImageLimit} onChange={(event) => setSettings((prev) => ({ ...prev, privacyHourlyImageLimit: Math.max(1, Number(event.target.value) || 1) }))} min={1} max={1000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">全服务同时生成图片数</span>
              <input value={settings.serviceConcurrentImageLimit} onChange={(event) => setSettings((prev) => ({ ...prev, serviceConcurrentImageLimit: Math.max(1, Number(event.target.value) || 1) }))} min={1} max={1000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">单账号同时生成图片数</span>
              <input value={settings.userConcurrentImageLimit} onChange={(event) => setSettings((prev) => ({ ...prev, userConcurrentImageLimit: Math.max(1, Number(event.target.value) || 1) }))} min={1} max={1000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每日补满积分</span>
              <input value={settings.dailyPointsTarget} onChange={(event) => setSettings((prev) => ({ ...prev, dailyPointsTarget: Math.max(1, Number(event.target.value) || 100) }))} min={1} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">单张消耗</span>
              <input value={settings.standardPointCost} onChange={(event) => setSettings((prev) => ({ ...prev, standardPointCost: Math.max(1, Number(event.target.value) || 1) }))} min={1} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            </label>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
              <span className="text-sm text-gray-600 dark:text-gray-300">默认上传图集</span>
              <button type="button" onClick={() => setSettings((prev) => ({ ...prev, galleryUploadDefault: !prev.galleryUploadDefault }))} className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${settings.galleryUploadDefault ? 'bg-blue-500' : 'bg-gray-300'}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${settings.galleryUploadDefault ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          <section className="mt-6 border-t border-gray-100 pt-5 dark:border-white/[0.08]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">模型列表</h4>
              <button type="button" onClick={addModel} className="rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600">
                添加模型
              </button>
            </div>
            <div className="space-y-4">
              {settings.models.map((model, index) => {
                const pricingRules = normalizeTieredPricingRules(model.pricingRules)
                return (
                <div key={model.id} className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500 shadow-sm dark:bg-white/[0.06] dark:text-gray-300">#{index + 1}</span>
                      <button type="button" onClick={() => model.enabled && setSettings((prev) => ({ ...prev, defaultModelId: model.id }))} disabled={!model.enabled} className={`rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed ${settings.defaultModelId === model.id ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 dark:bg-white/[0.06] dark:text-gray-300'}`}>
                        默认
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => updateModel(model.id, { enabled: !model.enabled })} className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${model.enabled ? 'bg-blue-500' : 'bg-gray-300'}`} aria-label="启用模型">
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${model.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                      </button>
                      <button type="button" onClick={() => removeModel(model.id)} disabled={settings.models.length <= 1} className="rounded-lg px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-500/10">
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">名称</span>
                      <input value={model.name} onChange={(event) => updateModel(model.id, { name: event.target.value })} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">服务商类型</span>
                      <select value={model.provider} onChange={(event) => updateModel(model.id, { provider: event.target.value as ApiProvider })} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100">
                        <option value="openai">OpenAI 兼容接口</option>
                        <option value="fal">fal.ai</option>
                      </select>
                    </label>
                    {model.provider === 'openai' && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
                        <input value={model.baseUrl} onChange={(event) => updateModel(model.id, { baseUrl: event.target.value })} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API Key</span>
                      <input value={model.apiKey} onChange={(event) => updateModel(model.id, { apiKey: event.target.value })} type="password" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">模型 ID</span>
                      <input value={model.model} onChange={(event) => updateModel(model.id, { model: event.target.value })} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                    </label>
                    {model.provider === 'openai' && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API 接口</span>
                        <select value={model.apiMode} onChange={(event) => updateModel(model.id, { apiMode: event.target.value as ApiMode })} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100">
                          <option value="images">Images API</option>
                          <option value="responses">Responses API</option>
                        </select>
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">请求超时 (秒)</span>
                      <input value={model.timeout} onChange={(event) => updateModel(model.id, { timeout: Math.max(10, Number(event.target.value) || 600) })} min={10} max={3600} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                    </label>
                    {model.provider === 'openai' && (
                      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                        <span className="text-sm text-gray-600 dark:text-gray-300">Codex 兼容</span>
                        <button type="button" onClick={() => updateModel(model.id, { codexCompatible: !model.codexCompatible })} className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${model.codexCompatible ? 'bg-blue-500' : 'bg-gray-300'}`}>
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${model.codexCompatible ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 border-t border-gray-200/70 pt-4 dark:border-white/[0.08]">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h5 className="text-xs font-medium text-gray-700 dark:text-gray-200">计费方式</h5>
                        <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                          固定单价使用上方“单张消耗”；阶梯计费按尺寸、质量、参考图和遮罩预扣。
                        </p>
                      </div>
                      <div className="flex rounded-xl bg-white/70 p-1 text-xs dark:bg-white/[0.04]">
                        <button
                          type="button"
                          onClick={() => updateModel(model.id, { pricingMode: 'flat' })}
                          className={`rounded-lg px-3 py-1.5 transition ${model.pricingMode === 'tiered' ? 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200' : 'bg-blue-500 text-white shadow-sm'}`}
                        >
                          固定单价
                        </button>
                        <button
                          type="button"
                          onClick={() => updateModel(model.id, { pricingMode: 'tiered' })}
                          className={`rounded-lg px-3 py-1.5 transition ${model.pricingMode === 'tiered' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        >
                          阶梯计费
                        </button>
                      </div>
                    </div>

                    {model.pricingMode === 'tiered' && (
                      <div className="space-y-3">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => updateModel(model.id, { pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES })}
                            className="rounded-lg border border-blue-200 bg-white/70 px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-50 dark:border-blue-400/20 dark:bg-white/[0.04] dark:text-blue-300 dark:hover:bg-blue-500/10"
                          >
                            填充官方 OpenAI 保守模板
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-xs">
                            <thead>
                              <tr className="text-left text-gray-400 dark:text-gray-500">
                                <th className="px-2 py-1 font-medium">尺寸档</th>
                                {PRICE_QUALITIES.map((quality) => (
                                  <th key={quality} className="px-2 py-1 font-medium">{quality}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {PRICE_TIERS.map((tier) => (
                                <tr key={tier}>
                                  <td className="px-2 py-1.5 font-medium text-gray-600 dark:text-gray-300">{tier}</td>
                                  {PRICE_QUALITIES.map((quality) => (
                                    <td key={`${tier}-${quality}`} className="px-2 py-1.5">
                                      <input
                                        value={pricingRules.sizeQualityPoints[tier][quality]}
                                        onChange={(event) => updateTierPrice(model.id, tier, quality, event.target.value)}
                                        min={1}
                                        max={1000000}
                                        type="number"
                                        className="w-full rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                                      />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="block">
                            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每张参考图加价</span>
                            <input value={pricingRules.referenceImagePoints} onChange={(event) => updatePricingNumber(model.id, 'referenceImagePoints', event.target.value)} min={0} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">遮罩编辑加价</span>
                            <input value={pricingRules.maskEditPoints} onChange={(event) => updatePricingNumber(model.id, 'maskEditPoints', event.target.value)} min={0} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">最低扣费</span>
                            <input value={pricingRules.minimumPoints} onChange={(event) => updatePricingNumber(model.id, 'minimumPoints', event.target.value)} min={1} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          </section>

          <section className="mt-6 border-t border-gray-100 pt-5 dark:border-white/[0.08]">
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200">图集上传</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">图集上传 URL</span>
                <input value={settings.galleryUploadUrl} onChange={(event) => setSettings((prev) => ({ ...prev, galleryUploadUrl: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">图集上传 Token</span>
                <input value={settings.galleryUploadToken} onChange={(event) => setSettings((prev) => ({ ...prev, galleryUploadToken: event.target.value }))} type="password" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
              </label>
            </div>
          </section>

          <section className="mt-6 border-t border-gray-100 pt-5 dark:border-white/[0.08]">
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200">兑换码发放</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">发放数量</span>
                <input value={redeemCount} onChange={(event) => setRedeemCount(Math.max(1, Number(event.target.value) || 1))} min={1} max={1000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每个可兑换积分</span>
                <input value={redeemPoints} onChange={(event) => setRedeemPoints(Math.max(1, Number(event.target.value) || 1))} min={1} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => void issueRedeemCodes()} disabled={redeemLoading} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50">
                {redeemLoading ? '生成中...' : '生成兑换码'}
              </button>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <button type="button" onClick={() => setShowAdminAudit(false)} className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]">
            取消
          </button>
          <button type="button" onClick={() => void saveSettings()} disabled={saving} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50">
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}
