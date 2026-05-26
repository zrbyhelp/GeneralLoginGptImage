import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  ApiProvider,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
  ExportData,
} from './types'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS, getActiveApiProfile, normalizeSettings } from './lib/apiProfiles'
import {
  getAllTasks,
  putTask,
  deleteTask as dbDeleteTask,
  clearTasks as dbClearTasks,
  getImage,
  getAllImages,
  putImage,
  deleteImage,
  clearImages,
  storeImage,
} from './lib/db'
import { callImageApi, ImageApiError, pollImageGenerationJob } from './lib/api'
import type { CallApiResult, ImageGenerationJobStatus } from './lib/imageApiShared'
import { getFalErrorMessage, getFalQueuedImageResult, getFalQueueStatus } from './lib/falAiImageApi'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { orderInputImagesForMask } from './lib/mask'
import { getChangedParams, normalizeParamsForSettings } from './lib/paramCompatibility'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { getInitialDisplayPreferences, type AppLocale, type AppTheme } from './lib/i18n'

// ===== Image cache =====
// 内存缓存，id → dataUrl，避免每次从 IndexedDB 读取

const imageCache = new Map<string, string>()
const FAL_RECOVERY_POLL_MS = 10_000
const falRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const OPENAI_INTERRUPTED_ERROR = '请求中断'

type SubmitTaskOptions = {
  allowFullMask?: boolean
  confirmed?: boolean
}

export function getCachedImage(id: string): string | undefined {
  return imageCache.get(id)
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  if (imageCache.has(id)) return imageCache.get(id)
  const rec = await getImage(id)
  if (rec) {
    imageCache.set(id, rec.dataUrl)
    return rec.dataUrl
  }
  return undefined
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function sanitizeClientSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const normalized = normalizeSettings(input)
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    clearInputAfterSubmit: normalized.clearInputAfterSubmit,
  })
}

// ===== Store 类型 =====

interface AppState {
  auth: {
    loading: boolean
    authenticated: boolean
    isAdmin: boolean
    user: {
      id: string
      account: string | null
      email: string | null
      username: string | null
      name: string | null
      avatarUrl: string | null
      status: string
      pointsBalance?: number
    } | null
    generationDefaults: {
      dailyPointsTarget: number
      standardPointCost: number
      premiumPointCost: number
      galleryUploadDefault: boolean
    }
  }
  setAuth: (auth: Partial<AppState['auth']>) => void

  // Display preferences
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  lastSeenLoginNoticeToken: string
  setLastSeenLoginNoticeToken: (token: string) => void
  dismissedAnnouncementIds: string[]
  dismissAnnouncement: (id: string) => void

  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  uploadToGallery: boolean
  setUploadToGallery: (uploadToGallery: boolean) => void
  usePremiumApi: boolean
  setUsePremiumApi: (usePremiumApi: boolean) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[]) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'queued' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  showAdminAudit: boolean
  setShowAdminAudit: (v: boolean) => void

  // Toast
  toast: { message: string; type: 'info' | 'success' | 'error' } | null
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    confirmText?: string
    showCancel?: boolean
    icon?: 'info'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action: () => void
    cancelAction?: () => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...(() => {
        const initial = getInitialDisplayPreferences()
        return {
          theme: initial.theme,
          locale: initial.locale,
          lastSeenLoginNoticeToken: '',
          dismissedAnnouncementIds: [],
        }
      })(),
      auth: {
        loading: true,
        authenticated: false,
        isAdmin: false,
        user: null,
        generationDefaults: {
          dailyPointsTarget: 100,
          standardPointCost: 1,
          premiumPointCost: 300,
          galleryUploadDefault: false,
        },
      },
      setAuth: (auth) => set((state) => ({ auth: { ...state.auth, ...auth } })),

      // Display preferences
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setLastSeenLoginNoticeToken: (lastSeenLoginNoticeToken) => set({ lastSeenLoginNoticeToken }),
      dismissAnnouncement: (id) => set((state) => {
        const normalizedId = id.trim()
        if (!normalizedId || state.dismissedAnnouncementIds.includes(normalizedId)) return state
        return { dismissedAnnouncementIds: [...state.dismissedAnnouncementIds, normalizedId] }
      }),

      // Settings
      settings: sanitizeClientSettings(DEFAULT_SETTINGS),
      setSettings: (s) => set((st) => {
        return { settings: sanitizeClientSettings({ ...st.settings, clearInputAfterSubmit: s.clearInputAfterSubmit ?? st.settings.clearInputAfterSubmit }) }
      }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set({ prompt }),
      uploadToGallery: false,
      setUploadToGallery: (uploadToGallery) => set({ uploadToGallery }),
      usePremiumApi: false,
      setUsePremiumApi: (usePremiumApi) => set({ usePremiumApi }),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return { inputImages: [...s.inputImages, img] }
        }),
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return {
            inputImages: s.inputImages.filter((_, i) => i !== idx),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) imageCache.delete(img.id)
          return { inputImages: [], maskDraft: null, maskEditorImageId: null }
        }),
      setInputImages: (imgs) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return {
            inputImages,
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return { inputImages: images }
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => ({
          maskDraft,
          inputImages: orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId),
        })),
      clearMaskDraft: () => set({ maskDraft: null }),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => set({ maskEditorImageId }),

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set({ filterFavorite }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) => set((s) => ({
        selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
      })),
      toggleTaskSelection: (id, force) => set((s) => {
        const isSelected = s.selectedTaskIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedTaskIds: shouldSelect
            ? [...s.selectedTaskIds, id]
            : s.selectedTaskIds.filter((x) => x !== id)
        }
      }),
      clearSelection: () => set({ selectedTaskIds: [] }),

      // UI
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => set({ detailTaskId }),
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) =>
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) }),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),
      showAdminAudit: false,
      setShowAdminAudit: (showAdminAudit) => set({ showAdminAudit }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        set({ toast: { message, type } })
        setTimeout(() => {
          set((s) => (s.toast?.message === message ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
    }),
    {
      name: 'gpt-image-playground',
      partialize: (state) => ({
        settings: sanitizeClientSettings(state.settings),
        params: state.params,
        prompt: state.prompt,
        inputImages: state.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
        dismissedCodexCliPrompts: [],
        theme: state.theme,
        locale: state.locale,
        lastSeenLoginNoticeToken: state.lastSeenLoginNoticeToken,
        dismissedAnnouncementIds: state.dismissedAnnouncementIds,
      }),
    },
  ),
)

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${profile.baseUrl}\n${profile.apiKey}`
}

function isOpenAITask(task: TaskRecord) {
  return (task.apiProvider ?? 'openai') === 'openai'
}

function isTaskInFlight(task: TaskRecord) {
  return task.status === 'queued' || task.status === 'running'
}

function getTaskUploadToGallery(task: TaskRecord) {
  if (typeof task.uploadToGallery === 'boolean') return task.uploadToGallery
  if (typeof task.privacyMode === 'boolean') return !task.privacyMode
  return false
}

function isRunningOpenAITask(task: TaskRecord) {
  return isTaskInFlight(task) && !task.queueJobId && isOpenAITask(task)
}

function applyQueueStatusToTask(taskId: string, status: ImageGenerationJobStatus) {
  if (status.status !== 'queued' && status.status !== 'running') return
  const current = useStore.getState().tasks.find((task) => task.id === taskId)
  if (!current || !isTaskInFlight(current)) return
  updateTaskInStore(taskId, {
    queueJobId: status.jobId,
    queuePosition: status.queuePosition,
    queueCompletedImages: status.completedImages,
    queueTotalImages: status.totalImages,
    status: status.status,
    error: null,
  })
}

function isUserConcurrentLimitError(error: unknown) {
  if (!(error instanceof ImageApiError) || error.statusCode !== 429) return false
  const record = error.data && typeof error.data === 'object' ? error.data as Record<string, unknown> : {}
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  return data.reason === 'userConcurrentImageLimit' || error.message.includes('目前最大同时生成张数')
}

function isPointsInsufficientError(error: unknown) {
  if (!(error instanceof ImageApiError) || error.statusCode !== 429) return false
  const record = error.data && typeof error.data === 'object' ? error.data as Record<string, unknown> : {}
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  return data.reason === 'pointsInsufficient' || error.message.includes('积分不足')
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningOpenAITask(task)) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      falRecoverable: false,
      queuePosition: null,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: '开启',
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

function getFalRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const normalized = normalizeSettings(settings)
  const active = getActiveApiProfile(normalized)
  if (active.provider === 'fal') return active
  return normalized.profiles.find((profile) =>
    profile.provider === 'fal' &&
    (profile.name === task.apiProfileName || profile.model === task.apiModel),
  ) ?? normalized.profiles.find((profile) => profile.provider === 'fal') ?? null
}

function isFalConnectionRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function clearFalRecoveryTimer(taskId: string) {
  const timer = falRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  falRecoveryTimers.delete(taskId)
}

function scheduleFalRecovery(taskId: string, delayMs = FAL_RECOVERY_POLL_MS) {
  if (falRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    falRecoveryTimers.delete(taskId)
    recoverFalTask(taskId)
  }, delayMs)
  falRecoveryTimers.set(taskId, timer)
}

async function completeRecoveredFalTask(task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return

  const outputIds: string[] = []
  for (const dataUrl of result.images) {
    const imgId = await storeImage(dataUrl, 'generated')
    imageCache.set(imgId, dataUrl)
    outputIds.push(imgId)
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    actualParams: undefined,
    actualParamsByImage: undefined,
    revisedPromptByImage: undefined,
    partialError: null,
    status: 'done',
    error: null,
    falRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(`fal.ai 任务已恢复，共 ${outputIds.length} 张图片`, 'success')
}

async function recoverFalTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || task.apiProvider !== 'fal' || !task.falRequestId || !task.falEndpoint || task.status === 'done') return

  const profile = getFalRecoveryProfile(settings, task)
  if (!profile) {
    scheduleFalRecovery(taskId)
    return
  }

  try {
    const status = await getFalQueueStatus(profile, task.falEndpoint, task.falRequestId)
    if (status.status === 'COMPLETED') {
      clearFalRecoveryTimer(taskId)
      const result = await getFalQueuedImageResult(profile, task.falEndpoint, task.falRequestId, task.params)
      await completeRecoveredFalTask(task, result)
      return
    }

    if (task.status !== 'running') {
      updateTaskInStore(taskId, {
        status: 'running',
        error: null,
        falRecoverable: true,
        finishedAt: null,
        elapsed: null,
      })
    }
    scheduleFalRecovery(taskId)
  } catch (err) {
    if (isFalConnectionRecoverableError(err)) {
      scheduleFalRecovery(taskId)
      return
    }

    clearFalRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: getFalErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)),
      falRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
  }
}

/** 初始化：从 IndexedDB 加载任务和图片缓存，清理孤立图片 */
export async function initStore() {
  useStore.setState({
    settings: sanitizeClientSettings(useStore.getState().settings),
    dismissedCodexCliPrompts: [],
  })
  const storedTasks = await getAllTasks()
  const { tasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(storedTasks)
  await Promise.all(interruptedTasks.map((task) => putTask(task)))
  useStore.getState().setTasks(tasks)
  for (const task of tasks) {
    if (task.queueJobId && isTaskInFlight(task)) {
      void resumeQueuedImageJob(task.id)
      continue
    }
    if (
      task.apiProvider === 'fal' &&
      task.falRequestId &&
      task.falEndpoint &&
      (task.status === 'running' || task.falRecoverable)
    ) {
      scheduleFalRecovery(task.id, 0)
    }
  }

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  const persistedInputImages = useStore.getState().inputImages
  for (const img of persistedInputImages) referencedIds.add(img.id)
  for (const t of tasks) {
    for (const id of t.inputImageIds || []) referencedIds.add(id)
    if (t.maskImageId) referencedIds.add(t.maskImageId)
    for (const id of t.outputImages || []) {
      referencedIds.add(id)
    }
  }

  // 预加载所有图片到缓存，同时清理孤立图片
  const images = await getAllImages()
  const imageById = new Map(images.map((img) => [img.id, img]))
  for (const img of images) {
    if (referencedIds.has(img.id)) {
      imageCache.set(img.id, img.dataUrl)
    } else {
      await deleteImage(img.id)
    }
  }
  const restoredInputImages = persistedInputImages
    .map((img) => ({ ...img, dataUrl: img.dataUrl || imageById.get(img.id)?.dataUrl || '' }))
    .filter((img) => img.dataUrl)
  if (restoredInputImages.length !== persistedInputImages.length || restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)) {
    useStore.getState().setInputImages(restoredInputImages)
  }
}

async function finishTaskWithResult(
  taskId: string,
  task: TaskRecord,
  result: CallApiResult,
  maskDataUrl?: string,
) {
  const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!latestBeforeSuccess || !isTaskInFlight(latestBeforeSuccess)) return

  const outputIds: string[] = []
  for (const dataUrl of result.images) {
    const imgId = await storeImage(dataUrl, 'generated')
    imageCache.set(imgId, dataUrl)
    outputIds.push(imgId)
  }

  const taskProvider = task.apiProvider ?? result.apiProvider ?? 'openai'
  const shouldStoreApiResponseMetadata = taskProvider !== 'fal'
  const actualParamsByImage = shouldStoreApiResponseMetadata ? result.actualParamsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && params && Object.keys(params).length > 0) acc[imgId] = params
    return acc
  }, {}) : undefined
  const revisedPromptByImage = shouldStoreApiResponseMetadata ? result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
    const imgId = outputIds[index]
    if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
    return acc
  }, {}) : undefined

  const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!latestBeforeUpdate || !isTaskInFlight(latestBeforeUpdate)) return
  updateTaskInStore(taskId, {
    apiProvider: result.apiProvider ?? task.apiProvider,
    apiProfileName: result.apiProfileName ?? task.apiProfileName,
    apiModel: result.apiModel ?? task.apiModel,
    uploadToGallery: result.uploadToGallery ?? task.uploadToGallery,
    usePremiumApi: result.usePremiumApi ?? task.usePremiumApi,
    privacyMode: result.privacyMode ?? task.privacyMode,
    chargedPoints: result.chargedPoints,
    refundedPoints: result.refundedPoints,
    pointsBalance: result.pointsBalance,
    outputImages: outputIds,
    actualParams: shouldStoreApiResponseMetadata ? { ...result.actualParams, n: outputIds.length } : undefined,
    actualParamsByImage: actualParamsByImage && Object.keys(actualParamsByImage).length > 0 ? actualParamsByImage : undefined,
    revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
    partialError: result.partialError || null,
    status: 'done',
    queuePosition: null,
    queueCompletedImages: result.images.length,
    queueTotalImages: task.params.n,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
    falRecoverable: false,
  })

  useStore.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
  if (result.partialError) {
    useStore.getState().showToast('部分图片生成失败，已保留成功结果', 'error')
  }
  if (result.galleryUploadError) {
    useStore.getState().showToast(`图集上传失败：${result.galleryUploadError}`, 'error')
  }

  if (typeof result.pointsBalance === 'number') {
    const currentUser = useStore.getState().auth.user
    if (currentUser) {
      useStore.getState().setAuth({
        user: {
          ...currentUser,
          pointsBalance: result.pointsBalance,
        },
      })
    }
  }

  const currentMask = useStore.getState().maskDraft
  if (
    maskDataUrl &&
    currentMask &&
    currentMask.targetImageId === task.maskTargetImageId &&
    currentMask.maskDataUrl === maskDataUrl
  ) {
    useStore.getState().clearMaskDraft()
  }
}

/** 提交新任务 */
export async function submitTask(options: SubmitTaskOptions = {}) {
  const { auth, settings, prompt, uploadToGallery, usePremiumApi, inputImages, maskDraft, params, showToast, setConfirmDialog } =
    useStore.getState()

  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  const costPerImage = usePremiumApi
    ? auth.generationDefaults.premiumPointCost
    : auth.generationDefaults.standardPointCost
  const requiredPoints = costPerImage * Math.max(1, Math.floor(Number(params.n) || 1))
  const pointsBalance = typeof auth.user?.pointsBalance === 'number' ? auth.user.pointsBalance : null
  if (pointsBalance != null && pointsBalance < requiredPoints) {
    showToast(`积分不足，需要 ${requiredPoints} 积分，当前 ${pointsBalance} 积分`, 'error')
    return
  }

  if (!options.confirmed) {
    setConfirmDialog({
      title: '确认生成图片？',
      message: `将提交当前提示词和参数生成图片，预计消耗 ${requiredPoints} 积分。是否继续？`,
      confirmText: '确认生成',
      icon: 'info',
      action: () => {
        void submitTask({ ...options, confirmed: true })
      },
    })
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => {
            void submitTask({ ...options, allowFullMask: true, confirmed: true })
          },
        })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      imageCache.set(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  const normalizedParams = normalizeParamsForSettings(params, settings)
  const normalizedParamPatch = getChangedParams(params, normalizedParams)
  if (Object.keys(normalizedParamPatch).length) {
    useStore.getState().setParams(normalizedParamPatch)
  }

  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: normalizedParams,
    apiProvider: 'openai',
    apiProfileName: usePremiumApi ? '1K+ 专用配置' : '统一配置',
    apiModel: '服务端模型',
    uploadToGallery,
    usePremiumApi,
    privacyMode: !uploadToGallery,
    inputImageIds: orderedInputImages.map((i) => i.id),
    maskTargetImageId,
    maskImageId,
    outputImages: [],
    status: 'queued',
    error: null,
    queuePosition: null,
    queueCompletedImages: 0,
    queueTotalImages: normalizedParams.n,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  await putTask(task)

  // 异步调用 API
  executeTask(taskId)
}

async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return
  let falRequestInfo: { requestId: string; endpoint: string } | null = task.falRequestId && task.falEndpoint
    ? { requestId: task.falRequestId, endpoint: task.falEndpoint }
    : null
  let clearedSubmittedInput = false

  const clearSubmittedInputIfUnchanged = () => {
    if (clearedSubmittedInput || !settings.clearInputAfterSubmit) return
    const state = useStore.getState()
    const currentInputIds = state.inputImages.map((image) => image.id)
    const samePrompt = state.prompt.trim() === task.prompt
    const sameImages =
      currentInputIds.length === task.inputImageIds.length &&
      currentInputIds.every((id, index) => id === task.inputImageIds[index])
    if (!samePrompt || !sameImages) return

    state.setPrompt('')
    state.clearInputImages()
    clearedSubmittedInput = true
  }

  try {
    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    const result = await callImageApi({
      settings,
      prompt: task.prompt,
      params: task.params,
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
      uploadToGallery: getTaskUploadToGallery(task),
      usePremiumApi: Boolean(task.usePremiumApi),
      privacyMode: task.privacyMode ?? !getTaskUploadToGallery(task),
      onFalRequestEnqueued: (request) => {
        falRequestInfo = request
        updateTaskInStore(taskId, {
          falRequestId: request.requestId,
          falEndpoint: request.endpoint,
          falRecoverable: false,
        })
      },
      onQueueStatusChange: (status) => {
        clearSubmittedInputIfUnchanged()
        applyQueueStatusToTask(taskId, status)
      },
    })
    clearSubmittedInputIfUnchanged()

    await finishTaskWithResult(taskId, task, result, maskDataUrl)
  } catch (err) {
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId) ?? task
    if (!isTaskInFlight(latestTask)) return
    if (isUserConcurrentLimitError(err) || isPointsInsufficientError(err)) {
      useStore.getState().setTasks(useStore.getState().tasks.filter((item) => item.id !== taskId))
      await dbDeleteTask(taskId)
      useStore.getState().showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
    const latestFalRequestInfo = falRequestInfo ?? (latestTask.falRequestId && latestTask.falEndpoint
      ? { requestId: latestTask.falRequestId, endpoint: latestTask.falEndpoint }
      : null)
    if (latestTask.apiProvider === 'fal' && latestFalRequestInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与 fal.ai 的连接已断开，连接恢复后会自动查询任务结果。',
        falRequestId: latestFalRequestInfo.requestId,
        falEndpoint: latestFalRequestInfo.endpoint,
        falRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleFalRecovery(taskId)
    } else {
      updateTaskInStore(taskId, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        queuePosition: null,
        falRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      useStore.getState().setDetailTaskId(taskId)
    }
  } finally {
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      imageCache.delete(imgId)
    }
  }
}

async function resumeQueuedImageJob(taskId: string) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task?.queueJobId || !isTaskInFlight(task)) return

  try {
    const result = await pollImageGenerationJob(task.queueJobId, {
      onQueueStatusChange: (status) => applyQueueStatusToTask(taskId, status),
    })
    const latest = useStore.getState().tasks.find((item) => item.id === taskId) ?? task
    await finishTaskWithResult(taskId, latest, result)
  } catch (err) {
    const latest = useStore.getState().tasks.find((item) => item.id === taskId) ?? task
    if (!isTaskInFlight(latest)) return
    updateTaskInStore(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      queuePosition: null,
      falRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - latest.createdAt,
    })
  }
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch } : t,
  )
  setTasks(updated)
  const task = updated.find((t) => t.id === taskId)
  if (task) putTask(task)
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord, options: { confirmed?: boolean } = {}) {
  const { settings, setConfirmDialog } = useStore.getState()
  if (!options.confirmed) {
    setConfirmDialog({
      title: '确认重试生成？',
      message: '将使用这条记录的提示词和参数重新生成图片。是否继续？',
      confirmText: '确认重试',
      icon: 'info',
      action: () => {
        void retryTask(task, { confirmed: true })
      },
    })
    return
  }

  const normalizedParams = normalizeParamsForSettings(task.params, settings)
  const uploadToGallery = getTaskUploadToGallery(task)
  const usePremiumApi = Boolean(task.usePremiumApi)
  const taskId = genId()
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    params: normalizedParams,
    apiProvider: 'openai',
    apiProfileName: usePremiumApi ? '1K+ 专用配置' : '统一配置',
    apiModel: '服务端模型',
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    uploadToGallery,
    usePremiumApi,
    privacyMode: !uploadToGallery,
    outputImages: [],
    status: 'queued',
    error: null,
    queuePosition: null,
    queueCompletedImages: 0,
    queueTotalImages: normalizedParams.n,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  await putTask(newTask)

  executeTask(taskId)
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { settings, setPrompt, setParams, setInputImages, setMaskDraft, clearMaskDraft, setUploadToGallery, setUsePremiumApi, showToast } = useStore.getState()
  setPrompt(task.prompt)
  setParams(normalizeParamsForSettings(task.params, settings))
  setUploadToGallery(getTaskUploadToGallery(task))
  setUsePremiumApi(Boolean(task.usePremiumApi))

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }
  setInputImages(imgs)
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageCached(task.maskImageId)
    if (maskDataUrl) {
      setMaskDraft({
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
    } else {
      clearMaskDraft()
    }
  } else {
    clearMaskDraft()
  }
  showToast('已复用配置到输入框', 'success')
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, inputImages, showToast, clearSelection, selectedTaskIds } = useStore.getState()
  
  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const remaining = tasks.filter(t => !toDelete.has(t.id))

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      for (const id of t.inputImageIds || []) deletedImageIds.add(id)
      if (t.maskImageId) deletedImageIds.add(t.maskImageId)
      for (const id of t.outputImages || []) deletedImageIds.add(id)
    }
  }

  setTasks(remaining)
  for (const id of taskIds) {
    await dbDeleteTask(id)
  }

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of deletedImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
    }
  }

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter(id => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  showToast(`已删除 ${taskIds.length} 条记录`, 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, showToast } = useStore.getState()

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)
  await dbDeleteTask(task.id)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
    }
  }

  showToast('记录已删除', 'success')
}

/** 清空所有数据（含配置重置） */
export async function clearAllData() {
  await dbClearTasks()
  await clearImages()
  imageCache.clear()
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, setUploadToGallery, setUsePremiumApi, showToast } = useStore.getState()
  setTasks([])
  clearInputImages()
  useStore.setState({ dismissedCodexCliPrompts: [] })
  clearMaskDraft()
  setSettings({ ...DEFAULT_SETTINGS })
  setParams({ ...DEFAULT_PARAMS })
  setUploadToGallery(false)
  setUsePremiumApi(false)
  showToast('所有数据已清空', 'success')
}

/** 从 dataUrl 解析出 MIME 扩展名和二进制数据 */
function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

/** 将二进制数据还原为 dataUrl */
function bytesToDataUrl(bytes: Uint8Array, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const mime = mimeMap[ext] ?? 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

/** 导出数据为 ZIP */
export async function exportData() {
  try {
    const tasks = await getAllTasks()
    const images = await getAllImages()
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()

    for (const task of tasks) {
      for (const id of [
        ...(task.inputImageIds || []),
        ...(task.maskImageId ? [task.maskImageId] : []),
        ...(task.outputImages || []),
      ]) {
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}

    for (const img of images) {
      const { ext, bytes } = dataUrlToBytes(img.dataUrl)
      const path = `images/${img.id}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
      imageFiles[img.id] = { path, createdAt, source: img.source }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
    }

    const manifest: ExportData = {
      version: 2,
      exportedAt: new Date(exportedAt).toISOString(),
      tasks,
      imageFiles,
    }

    zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

    const zipped = zipSync(zipFiles, { level: 6 })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gpt-image-playground-${Date.now()}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 导入 ZIP 数据 */
export async function importData(file: File): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!data.tasks || !data.imageFiles) throw new Error('无效的数据格式')

    // 还原图片
    for (const [id, info] of Object.entries(data.imageFiles)) {
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const dataUrl = bytesToDataUrl(bytes, info.path)
      await putImage({ id, dataUrl, createdAt: info.createdAt, source: info.source })
      imageCache.set(id, dataUrl)
    }

    for (const task of data.tasks) {
      await putTask(task)
    }

    const tasks = await getAllTasks()
    useStore.getState().setTasks(tasks)
    useStore
      .getState()
      .showToast(`已导入 ${data.tasks.length} 条记录`, 'success')
    return true
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    return false
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return
  const dataUrl = await fileToDataUrl(file)
  const id = await storeImage(dataUrl, 'upload')
  imageCache.set(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  const dataUrl = await blobToDataUrl(blob)
  const id = await storeImage(dataUrl, 'upload')
  imageCache.set(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
