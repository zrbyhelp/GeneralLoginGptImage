import { useEffect, useState } from 'react'
import type { AdminModelConfig, ApiMode, ApiProvider, GeminiAdminDefaults, GeminiMediaResolution, GeminiPricingRules, SizePriceTier, TaskParams, TieredPricingRules } from '../types'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { DEFAULT_GEMINI_TIERED_PRICING_RULES, DEFAULT_OPENAI_TIERED_PRICING_RULES, normalizeGeminiPricingRules, normalizeTieredPricingRules } from '../lib/pricing'
import { DEFAULT_GEMINI_ADMIN_DEFAULTS, DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_SDK_BASE_URL, DEFAULT_GEMINI_VERTEX_BASE_URL, DEFAULT_GEMINI_VERTEX_MODEL, normalizeGeminiAdminDefaults } from '../lib/gemini'

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

type BackupS3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  secretAccessKeyConfigured?: boolean
  prefix: string
  forcePathStyle: boolean
}

type BackupScheduleConfig = {
  enabled: boolean
  cronExpr: string
  timezone: string
  retainDays: number
  retainCount: number
}

type BackupRecord = {
  id: string
  status: 'running' | 'completed' | 'failed'
  backupType: string
  fileName: string
  s3Key: string
  sizeBytes: number
  triggeredBy: 'manual' | 'scheduled' | 'pre_restore' | 'imported'
  progress: string | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  expiresAt: string | null
  restoreStatus: '' | 'running' | 'completed' | 'failed'
  restoreError: string | null
  restoredAt: string | null
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

const DEFAULT_BACKUP_S3_CONFIG: BackupS3Config = {
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  prefix: 'backups',
  forcePathStyle: false,
}

const DEFAULT_BACKUP_SCHEDULE: BackupScheduleConfig = {
  enabled: false,
  cronExpr: '0 2 * * *',
  timezone: 'Asia/Shanghai',
  retainDays: 14,
  retainCount: 10,
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
    const switchedProvider = patch.provider && patch.provider !== model.provider
    const isGemini = provider === 'google-gemini'
    const previousGeminiMode = model.apiMode === 'geminiVertex' ? 'geminiVertex' : 'geminiDeveloper'
    const nextGeminiMode = patch.apiMode === 'geminiVertex' ? 'geminiVertex' : 'geminiDeveloper'
    const switchedGeminiMode = isGemini && patch.apiMode && nextGeminiMode !== previousGeminiMode
    return {
      ...model,
      ...patch,
      apiMode: provider === 'fal' ? 'images' : isGemini ? nextGeminiMode : patch.apiMode ?? model.apiMode,
      codexCompatible: provider === 'openai' ? patch.codexCompatible ?? model.codexCompatible : false,
      baseUrl: switchedProvider
        ? provider === 'fal'
          ? 'https://fal.run'
          : isGemini
            ? DEFAULT_GEMINI_SDK_BASE_URL
            : 'https://api.openai.com/v1'
        : switchedGeminiMode
          ? nextGeminiMode === 'geminiVertex'
            ? DEFAULT_GEMINI_VERTEX_BASE_URL
            : DEFAULT_GEMINI_SDK_BASE_URL
        : patch.baseUrl ?? model.baseUrl,
      model: switchedProvider
        ? provider === 'fal'
          ? 'openai/gpt-image-2'
          : isGemini
            ? DEFAULT_GEMINI_MODEL
            : 'gpt-image-2'
        : switchedGeminiMode
          ? nextGeminiMode === 'geminiVertex'
            ? DEFAULT_GEMINI_VERTEX_MODEL
            : DEFAULT_GEMINI_MODEL
        : patch.model ?? model.model,
      geminiDefaults: isGemini
        ? normalizeGeminiAdminDefaults(patch.geminiDefaults ?? model.geminiDefaults ?? DEFAULT_GEMINI_ADMIN_DEFAULTS)
        : undefined,
      pricingMode: switchedProvider && isGemini ? 'tiered' : patch.pricingMode ?? model.pricingMode,
      pricingRules: switchedProvider && isGemini ? DEFAULT_GEMINI_TIERED_PRICING_RULES : patch.pricingRules ?? model.pricingRules,
    }
  })
}

const PRICE_TIERS: SizePriceTier[] = ['1K', '2K', '4K']
const PRICE_QUALITIES: Array<TaskParams['quality']> = ['auto', 'low', 'medium', 'high']
const GEMINI_MEDIA_RESOLUTION_OPTIONS: Array<{ value: GeminiMediaResolution; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

function patchOpenAIPricingRules(
  rules: AdminModelConfig['pricingRules'],
  updater: (rules: TieredPricingRules) => TieredPricingRules,
) {
  return updater(normalizeTieredPricingRules(rules))
}

function patchGeminiPricingRules(
  rules: AdminModelConfig['pricingRules'],
  updater: (rules: GeminiPricingRules) => GeminiPricingRules,
) {
  return updater(normalizeGeminiPricingRules(rules))
}

function pricingNumber(value: string) {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function nullableNumber(value: string) {
  if (!value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseJsonValue(value: string) {
  if (!value.trim()) return null
  return JSON.parse(value)
}

function formatJsonValue(value: unknown) {
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
}

function formatBackupSize(bytes: number) {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatBackupDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function backupStatusLabel(record: BackupRecord) {
  if (record.status === 'running') {
    if (record.progress === 'snapshotting') return '快照中'
    if (record.progress === 'compressing') return '压缩中'
    if (record.progress === 'uploading') return '上传中'
    return '进行中'
  }
  if (record.status === 'completed') return '完成'
  return '失败'
}

function backupStatusClass(status: BackupRecord['status']) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (status === 'running') return 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
  return 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300'
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
  const [backupS3Config, setBackupS3Config] = useState<BackupS3Config>(DEFAULT_BACKUP_S3_CONFIG)
  const [backupSchedule, setBackupSchedule] = useState<BackupScheduleConfig>(DEFAULT_BACKUP_SCHEDULE)
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [savingBackupS3, setSavingBackupS3] = useState(false)
  const [testingBackupS3, setTestingBackupS3] = useState(false)
  const [savingBackupSchedule, setSavingBackupSchedule] = useState(false)
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [manualExpireDays, setManualExpireDays] = useState(14)
  const [restoringBackupId, setRestoringBackupId] = useState('')
  const [deletingBackupId, setDeletingBackupId] = useState('')
  const [importingR2Backups, setImportingR2Backups] = useState(false)
  const [uploadRestoreFile, setUploadRestoreFile] = useState<File | null>(null)
  const [restoringUpload, setRestoringUpload] = useState(false)

  useCloseOnEscape(showAdminAudit, () => setShowAdminAudit(false))

  useEffect(() => {
    if (!showAdminAudit) return
    void loadSettings()
    void loadBackupDashboard()
  }, [showAdminAudit])

  useEffect(() => {
    if (!showAdminAudit) return
    const hasActiveBackup = backups.some((record) => record.status === 'running' || record.restoreStatus === 'running')
    if (!hasActiveBackup) return
    const timer = window.setInterval(() => {
      void loadBackupRecords(true)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [showAdminAudit, backups])

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

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { cache: 'no-store', ...init })
    if (!response.ok) throw new Error(await getResponseErrorMessage(response))
    return response.json() as Promise<T>
  }

  async function loadBackupDashboard() {
    await Promise.all([
      loadBackupS3Config(),
      loadBackupSchedule(),
      loadBackupRecords(true),
    ])
  }

  async function loadBackupS3Config() {
    try {
      const payload = await fetchJson<BackupS3Config>('/api/admin/backups/s3-config')
      setBackupS3Config({
        ...DEFAULT_BACKUP_S3_CONFIG,
        ...payload,
        secretAccessKey: '',
      })
    } catch (error) {
      showToast(`加载备份存储配置失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function saveBackupS3Config() {
    setSavingBackupS3(true)
    try {
      const payload = await fetchJson<BackupS3Config>('/api/admin/backups/s3-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupS3Config),
      })
      setBackupS3Config({ ...DEFAULT_BACKUP_S3_CONFIG, ...payload, secretAccessKey: '' })
      showToast('备份存储配置已保存', 'success')
    } catch (error) {
      showToast(`保存备份存储配置失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setSavingBackupS3(false)
    }
  }

  async function testBackupS3Config() {
    setTestingBackupS3(true)
    try {
      const payload = await fetchJson<{ ok: boolean; message: string }>('/api/admin/backups/s3-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupS3Config),
      })
      showToast(payload.ok ? '备份存储连接正常' : `备份存储连接失败：${payload.message}`, payload.ok ? 'success' : 'error')
    } catch (error) {
      showToast(`备份存储连接失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setTestingBackupS3(false)
    }
  }

  async function loadBackupSchedule() {
    try {
      const payload = await fetchJson<BackupScheduleConfig>('/api/admin/backups/schedule')
      setBackupSchedule({ ...DEFAULT_BACKUP_SCHEDULE, ...payload })
    } catch (error) {
      showToast(`加载自动备份计划失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function saveBackupSchedule() {
    setSavingBackupSchedule(true)
    try {
      const payload = await fetchJson<BackupScheduleConfig>('/api/admin/backups/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupSchedule),
      })
      setBackupSchedule(payload)
      showToast('自动备份计划已保存', 'success')
    } catch (error) {
      showToast(`保存自动备份计划失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setSavingBackupSchedule(false)
    }
  }

  async function loadBackupRecords(silent = false) {
    if (!silent) setLoadingBackups(true)
    try {
      const payload = await fetchJson<{ items: BackupRecord[] }>('/api/admin/backups')
      setBackups(payload.items || [])
      setCreatingBackup(Boolean(payload.items?.some((record) => record.status === 'running')))
      setRestoringBackupId(payload.items?.find((record) => record.restoreStatus === 'running')?.id || '')
    } catch (error) {
      if (!silent) showToast(`加载备份记录失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      if (!silent) setLoadingBackups(false)
    }
  }

  async function createManualBackup() {
    setCreatingBackup(true)
    try {
      const record = await fetchJson<BackupRecord>('/api/admin/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expireDays: manualExpireDays }),
      })
      setBackups((prev) => [record, ...prev.filter((item) => item.id !== record.id)])
      showToast('备份任务已创建', 'success')
    } catch (error) {
      setCreatingBackup(false)
      showToast(`创建备份失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function importR2Backups() {
    setImportingR2Backups(true)
    try {
      const payload = await fetchJson<{ imported: number; updated: number; skipped: number; items: BackupRecord[] }>('/api/admin/backups/import-r2', {
        method: 'POST',
      })
      await loadBackupRecords(true)
      showToast(`扫描完成：导入 ${payload.imported}，更新 ${payload.updated}，跳过 ${payload.skipped}`, 'success')
    } catch (error) {
      showToast(`扫描 R2 失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setImportingR2Backups(false)
    }
  }

  async function downloadBackup(id: string) {
    try {
      const payload = await fetchJson<{ url: string }>(`/api/admin/backups/${encodeURIComponent(id)}/download-url`)
      window.open(payload.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      showToast(`获取下载地址失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function restoreBackup(record: BackupRecord) {
    const confirmationId = window.prompt(`输入备份 ID 以确认恢复：${record.id}`)
    if (confirmationId !== record.id) {
      if (confirmationId) showToast('备份 ID 确认不匹配', 'error')
      return
    }
    setRestoringBackupId(record.id)
    try {
      const updated = await fetchJson<BackupRecord>(`/api/admin/backups/${encodeURIComponent(record.id)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationId }),
      })
      setBackups((prev) => prev.map((item) => item.id === updated.id ? updated : item))
      showToast('恢复任务已创建', 'success')
    } catch (error) {
      setRestoringBackupId('')
      showToast(`恢复失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function restoreUploadedBackup() {
    if (!uploadRestoreFile) {
      showToast('请选择 .db.gz 备份文件', 'error')
      return
    }
    if (!uploadRestoreFile.name.endsWith('.db.gz')) {
      showToast('只能上传 .db.gz 备份文件', 'error')
      return
    }
    const confirmationFileName = window.prompt(`输入完整文件名以确认恢复：${uploadRestoreFile.name}`)
    if (confirmationFileName !== uploadRestoreFile.name) {
      if (confirmationFileName) showToast('备份文件名确认不匹配', 'error')
      return
    }

    setRestoringUpload(true)
    try {
      const formData = new FormData()
      formData.append('file', uploadRestoreFile)
      formData.append('confirmationFileName', confirmationFileName)
      await fetchJson<{ ok: true; fileName: string; sizeBytes: number; preRestoreBackupId: string }>('/api/admin/backups/restore-upload', {
        method: 'POST',
        body: formData,
      })
      showToast('上传备份已恢复，页面将刷新', 'success')
      window.setTimeout(() => window.location.reload(), 800)
    } catch (error) {
      showToast(`上传恢复失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setRestoringUpload(false)
    }
  }

  async function removeBackupRecord(record: BackupRecord) {
    if (!window.confirm(`删除备份 ${record.id}？`)) return
    setDeletingBackupId(record.id)
    try {
      await fetchJson<{ deleted: boolean }>(`/api/admin/backups/${encodeURIComponent(record.id)}`, { method: 'DELETE' })
      setBackups((prev) => prev.filter((item) => item.id !== record.id))
      showToast('备份记录已删除', 'success')
    } catch (error) {
      showToast(`删除备份失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setDeletingBackupId('')
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

  function updateOpenAIPricingRule(id: string, patcher: (rules: TieredPricingRules) => TieredPricingRules) {
    setSettings((prev) => ({
      ...prev,
      models: prev.models.map((model) =>
        model.id === id
          ? { ...model, pricingRules: patchOpenAIPricingRules(model.pricingRules, patcher) }
          : model,
      ),
    }))
  }

  function updateGeminiPricingRule(id: string, patcher: (rules: GeminiPricingRules) => GeminiPricingRules) {
    setSettings((prev) => ({
      ...prev,
      models: prev.models.map((model) =>
        model.id === id
          ? { ...model, pricingRules: patchGeminiPricingRules(model.pricingRules, patcher) }
          : model,
      ),
    }))
  }

  function updateGeminiDefaults(id: string, patch: Partial<GeminiAdminDefaults>) {
    setSettings((prev) => ({
      ...prev,
      models: prev.models.map((model) =>
        model.id === id
          ? {
              ...model,
              geminiDefaults: normalizeGeminiAdminDefaults({
                ...(model.geminiDefaults ?? DEFAULT_GEMINI_ADMIN_DEFAULTS),
                ...patch,
              }),
            }
          : model,
      ),
    }))
  }

  function updateTierPrice(id: string, tier: SizePriceTier, quality: TaskParams['quality'], value: string) {
    updateOpenAIPricingRule(id, (rules) => ({
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
    updateOpenAIPricingRule(id, (rules) => ({
      ...rules,
      [key]: key === 'minimumPoints'
        ? Math.max(1, pricingNumber(value))
        : pricingNumber(value),
    }))
  }

  function updateGeminiMediaResolutionPrice(id: string, resolution: GeminiMediaResolution, value: string) {
    updateGeminiPricingRule(id, (rules) => ({
      ...rules,
      mediaResolutionPoints: {
        ...rules.mediaResolutionPoints,
        [resolution]: Math.max(1, pricingNumber(value)),
      },
    }))
  }

  function updateGeminiPricingNumber(id: string, key: keyof Pick<GeminiPricingRules, 'referenceImagePoints' | 'minimumPoints' | 'searchGroundingPointsPerCount' | 'searchGroundingEstimatedCountPerImage'>, value: string) {
    updateGeminiPricingRule(id, (rules) => ({
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
                const isGemini = model.provider === 'google-gemini'
                const openAIPricingRules = normalizeTieredPricingRules(model.pricingRules)
                const geminiPricingRules = normalizeGeminiPricingRules(model.pricingRules)
                const geminiDefaults = normalizeGeminiAdminDefaults(model.geminiDefaults)
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
                        <option value="google-gemini">Google Gemini</option>
                      </select>
                    </label>
                    {(model.provider === 'openai' || model.provider === 'google-gemini') && (
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
                    {model.provider === 'google-gemini' && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">调用方式</span>
                        <select value={model.apiMode === 'geminiVertex' ? 'geminiVertex' : 'geminiDeveloper'} onChange={(event) => updateModel(model.id, { apiMode: event.target.value as ApiMode })} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100">
                          <option value="geminiDeveloper">Gemini Developer API</option>
                          <option value="geminiVertex">Gemini Vertex SDK</option>
                        </select>
                      </label>
                    )}
                    {model.provider === 'google-gemini' && model.apiMode === 'geminiVertex' && (
                      <div className="rounded-xl border border-blue-200/70 bg-blue-50/70 px-3 py-2 text-xs text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-200">
                        ZenMux 示例：API URL 使用 https://zenmux.ai/api/vertex-ai，模型 ID 使用 google/gemini-3-pro-image。
                      </div>
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
                  {model.provider === 'google-gemini' && (
                    <div className="mt-4 border-t border-gray-200/70 pt-4 dark:border-white/[0.08]">
                      <div className="mb-3">
                        <h5 className="text-xs font-medium text-gray-700 dark:text-gray-200">Gemini 默认高级参数</h5>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <label className="block">
                          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">topP</span>
                          <input value={geminiDefaults.topP ?? ''} onChange={(event) => updateGeminiDefaults(model.id, { topP: nullableNumber(event.target.value) })} type="number" min={0} max={1} step={0.01} placeholder="空为不提交" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">topK</span>
                          <input value={geminiDefaults.topK ?? ''} onChange={(event) => updateGeminiDefaults(model.id, { topK: nullableNumber(event.target.value) })} type="number" min={1} max={1000} placeholder="空为不提交" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">maxOutputTokens</span>
                          <input value={geminiDefaults.maxOutputTokens ?? ''} onChange={(event) => updateGeminiDefaults(model.id, { maxOutputTokens: nullableNumber(event.target.value) })} type="number" min={1} placeholder="空为不提交" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">seed</span>
                          <input value={geminiDefaults.seed ?? ''} onChange={(event) => updateGeminiDefaults(model.id, { seed: nullableNumber(event.target.value) })} type="number" min={0} placeholder="空为不提交" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">responseMimeType</span>
                          <input value={geminiDefaults.responseMimeType ?? ''} onChange={(event) => updateGeminiDefaults(model.id, { responseMimeType: event.target.value })} placeholder="例如 image/png" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                        </label>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {([
                          ['imageConfig', 'imageConfig JSON'],
                          ['generationConfig', 'generationConfig JSON'],
                          ['thinkingConfig', 'thinkingConfig JSON'],
                          ['safetySettings', 'safetySettings JSON'],
                        ] as const).map(([key, label]) => (
                          <label key={key} className="block">
                            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{label}</span>
                            <textarea
                              key={`${model.id}-${key}-${formatJsonValue(geminiDefaults[key])}`}
                              defaultValue={formatJsonValue(geminiDefaults[key])}
                              onBlur={(event) => {
                                try {
                                  updateGeminiDefaults(model.id, { [key]: parseJsonValue(event.target.value) } as Partial<GeminiAdminDefaults>)
                                } catch (error) {
                                  showToast(`${label} 不是有效 JSON`, 'error')
                                }
                              }}
                              rows={3}
                              className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 font-mono text-xs dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 border-t border-gray-200/70 pt-4 dark:border-white/[0.08]">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h5 className="text-xs font-medium text-gray-700 dark:text-gray-200">计费方式</h5>
                        <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                          固定单价使用上方“单张消耗”；阶梯计费按当前供应商的规格表预扣。
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
                            onClick={() => updateModel(model.id, {
                              pricingRules: isGemini
                                ? DEFAULT_GEMINI_TIERED_PRICING_RULES
                                : DEFAULT_OPENAI_TIERED_PRICING_RULES,
                            })}
                            className="rounded-lg border border-blue-200 bg-white/70 px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-50 dark:border-blue-400/20 dark:bg-white/[0.04] dark:text-blue-300 dark:hover:bg-blue-500/10"
                          >
                            填充{isGemini ? ' Gemini 媒体精度' : '官方 OpenAI'}保守模板
                          </button>
                        </div>
                        {isGemini ? (
                          <>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              {GEMINI_MEDIA_RESOLUTION_OPTIONS.map((option) => (
                                <label key={option.value} className="block">
                                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">媒体精度：{option.label}</span>
                                  <input
                                    value={geminiPricingRules.mediaResolutionPoints[option.value]}
                                    onChange={(event) => updateGeminiMediaResolutionPrice(model.id, option.value, event.target.value)}
                                    min={1}
                                    max={1000000}
                                    type="number"
                                    className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
                                  />
                                </label>
                              ))}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <label className="block">
                                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">每张参考图加价</span>
                                <input value={geminiPricingRules.referenceImagePoints} onChange={(event) => updateGeminiPricingNumber(model.id, 'referenceImagePoints', event.target.value)} min={0} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">最低扣费</span>
                                <input value={geminiPricingRules.minimumPoints} onChange={(event) => updateGeminiPricingNumber(model.id, 'minimumPoints', event.target.value)} min={1} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">网络搜索每 count 积分</span>
                                <input value={geminiPricingRules.searchGroundingPointsPerCount} onChange={(event) => updateGeminiPricingNumber(model.id, 'searchGroundingPointsPerCount', event.target.value)} min={0} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">网络搜索预估次数/张</span>
                                <input value={geminiPricingRules.searchGroundingEstimatedCountPerImage} onChange={(event) => updateGeminiPricingNumber(model.id, 'searchGroundingEstimatedCountPerImage', event.target.value)} min={0} max={1000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                              </label>
                            </div>
                          </>
                        ) : (
                          <>
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
                                            value={openAIPricingRules.sizeQualityPoints[tier][quality]}
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
                                <input value={openAIPricingRules.referenceImagePoints} onChange={(event) => updatePricingNumber(model.id, 'referenceImagePoints', event.target.value)} min={0} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">遮罩编辑加价</span>
                                <input value={openAIPricingRules.maskEditPoints} onChange={(event) => updatePricingNumber(model.id, 'maskEditPoints', event.target.value)} min={0} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">最低扣费</span>
                                <input value={openAIPricingRules.minimumPoints} onChange={(event) => updatePricingNumber(model.id, 'minimumPoints', event.target.value)} min={1} max={1000000} type="number" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                              </label>
                            </div>
                          </>
                        )}
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
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">数据备份</h4>
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                  备份服务端 SQLite 数据库，不包含浏览器本地记录和图片文件。
                </p>
              </div>
              <button type="button" onClick={() => void loadBackupRecords()} disabled={loadingBackups} className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-200 disabled:opacity-50 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]">
                {loadingBackups ? '刷新中...' : '刷新记录'}
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h5 className="text-xs font-medium text-gray-700 dark:text-gray-200">S3/R2 存储</h5>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void testBackupS3Config()} disabled={testingBackupS3} className="rounded-lg border border-gray-200 bg-white/70 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-white disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300">
                      {testingBackupS3 ? '测试中...' : '测试连接'}
                    </button>
                    <button type="button" onClick={() => void saveBackupS3Config()} disabled={savingBackupS3} className="rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50">
                      {savingBackupS3 ? '保存中...' : '保存存储'}
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Endpoint</span>
                    <input value={backupS3Config.endpoint} onChange={(event) => setBackupS3Config((prev) => ({ ...prev, endpoint: event.target.value }))} placeholder="https://<account_id>.r2.cloudflarestorage.com" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Region</span>
                    <input value={backupS3Config.region} onChange={(event) => setBackupS3Config((prev) => ({ ...prev, region: event.target.value }))} placeholder="auto" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Bucket</span>
                    <input value={backupS3Config.bucket} onChange={(event) => setBackupS3Config((prev) => ({ ...prev, bucket: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Access Key ID</span>
                    <input value={backupS3Config.accessKeyId} onChange={(event) => setBackupS3Config((prev) => ({ ...prev, accessKeyId: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Secret Access Key</span>
                    <input value={backupS3Config.secretAccessKey} onChange={(event) => setBackupS3Config((prev) => ({ ...prev, secretAccessKey: event.target.value }))} type="password" placeholder={backupS3Config.secretAccessKeyConfigured ? '已配置，留空保留' : ''} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Prefix</span>
                    <input value={backupS3Config.prefix} onChange={(event) => setBackupS3Config((prev) => ({ ...prev, prefix: event.target.value }))} placeholder="backups" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                    <span className="text-sm text-gray-600 dark:text-gray-300">Path-style</span>
                    <button type="button" onClick={() => setBackupS3Config((prev) => ({ ...prev, forcePathStyle: !prev.forcePathStyle }))} className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${backupS3Config.forcePathStyle ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${backupS3Config.forcePathStyle ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h5 className="text-xs font-medium text-gray-700 dark:text-gray-200">自动备份</h5>
                  <button type="button" onClick={() => void saveBackupSchedule()} disabled={savingBackupSchedule} className="rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50">
                    {savingBackupSchedule ? '保存中...' : '保存计划'}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                    <span className="text-sm text-gray-600 dark:text-gray-300">启用</span>
                    <button type="button" onClick={() => setBackupSchedule((prev) => ({ ...prev, enabled: !prev.enabled }))} className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${backupSchedule.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${backupSchedule.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Cron</span>
                    <input value={backupSchedule.cronExpr} onChange={(event) => setBackupSchedule((prev) => ({ ...prev, cronExpr: event.target.value }))} placeholder="0 2 * * *" className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">时区</span>
                    <input value={backupSchedule.timezone} onChange={(event) => setBackupSchedule((prev) => ({ ...prev, timezone: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">保留天数</span>
                    <input value={backupSchedule.retainDays} onChange={(event) => setBackupSchedule((prev) => ({ ...prev, retainDays: Math.max(0, Number(event.target.value) || 0) }))} type="number" min={0} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">保留份数</span>
                    <input value={backupSchedule.retainCount} onChange={(event) => setBackupSchedule((prev) => ({ ...prev, retainCount: Math.max(0, Number(event.target.value) || 0) }))} type="number" min={0} className="w-full rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h5 className="text-xs font-medium text-gray-700 dark:text-gray-200">备份记录</h5>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void importR2Backups()} disabled={importingR2Backups} className="rounded-lg border border-gray-200 bg-white/70 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-white disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300">
                      {importingR2Backups ? '扫描中...' : '扫描 R2'}
                    </button>
                    <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      过期天数
                      <input value={manualExpireDays} onChange={(event) => setManualExpireDays(Math.max(0, Number(event.target.value) || 0))} type="number" min={0} className="w-20 rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                    </label>
                    <button type="button" onClick={() => void createManualBackup()} disabled={creatingBackup} className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50">
                      {creatingBackup ? '备份中...' : '立即备份'}
                    </button>
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 dark:border-amber-400/20 dark:bg-amber-400/10">
                  <span className="text-xs text-amber-700 dark:text-amber-200">上传备份文件恢复</span>
                  <input type="file" accept=".db.gz,application/gzip" onChange={(event) => setUploadRestoreFile(event.target.files?.[0] || null)} className="max-w-full text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-white file:px-2 file:py-1 file:text-xs file:text-gray-600 dark:text-gray-300 dark:file:bg-white/[0.08] dark:file:text-gray-200" />
                  <button type="button" onClick={() => void restoreUploadedBackup()} disabled={!uploadRestoreFile || restoringUpload || Boolean(restoringBackupId)} className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-amber-600 disabled:opacity-50">
                    {restoringUpload ? '恢复中...' : '上传恢复'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                        <th className="py-2 pr-3 font-medium">ID</th>
                        <th className="py-2 pr-3 font-medium">状态</th>
                        <th className="py-2 pr-3 font-medium">文件</th>
                        <th className="py-2 pr-3 font-medium">大小</th>
                        <th className="py-2 pr-3 font-medium">来源</th>
                        <th className="py-2 pr-3 font-medium">开始时间</th>
                        <th className="py-2 pr-3 font-medium">恢复</th>
                        <th className="py-2 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((record) => (
                        <tr key={record.id} className="border-b border-gray-100 align-top dark:border-white/[0.06]">
                          <td className="py-2 pr-3 font-mono text-[11px] text-gray-600 dark:text-gray-300">{record.id}</td>
                          <td className="py-2 pr-3">
                            <span className={`rounded px-2 py-0.5 ${backupStatusClass(record.status)}`}>{backupStatusLabel(record)}</span>
                            {record.errorMessage && <div className="mt-1 max-w-44 truncate text-[11px] text-red-500" title={record.errorMessage}>{record.errorMessage}</div>}
                          </td>
                          <td className="py-2 pr-3 max-w-52 truncate text-gray-500 dark:text-gray-400" title={record.s3Key}>{record.fileName}</td>
                          <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{formatBackupSize(record.sizeBytes)}</td>
                          <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{record.triggeredBy === 'scheduled' ? '自动' : record.triggeredBy === 'pre_restore' ? '恢复前' : record.triggeredBy === 'imported' ? '导入' : '手动'}</td>
                          <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{formatBackupDate(record.startedAt)}</td>
                          <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">
                            {record.restoreStatus === 'running' ? '恢复中' : record.restoreStatus === 'completed' ? `完成 ${formatBackupDate(record.restoredAt)}` : record.restoreStatus === 'failed' ? (record.restoreError || '失败') : '-'}
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-1">
                              <button type="button" onClick={() => void downloadBackup(record.id)} disabled={record.status !== 'completed'} className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] text-gray-600 transition hover:bg-gray-200 disabled:opacity-40 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]">下载</button>
                              <button type="button" onClick={() => void restoreBackup(record)} disabled={record.status !== 'completed' || Boolean(restoringBackupId)} className="rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-amber-600 disabled:opacity-40">{restoringBackupId === record.id ? '恢复中' : '恢复'}</button>
                              <button type="button" onClick={() => void removeBackupRecord(record)} disabled={deletingBackupId === record.id || record.status === 'running'} className="rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-500 transition hover:bg-red-100 disabled:opacity-40 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20">{deletingBackupId === record.id ? '删除中' : '删除'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!backups.length && (
                        <tr>
                          <td colSpan={8} className="py-5 text-center text-xs text-gray-400 dark:text-gray-500">暂无备份记录</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
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
