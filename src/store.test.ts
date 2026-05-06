import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS } from './lib/apiProfiles'
import type { TaskRecord } from './types'
import { editOutputs, markInterruptedOpenAIRunningTasks, submitTask, useStore } from './store'

const dbMocks = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  putTask: vi.fn(),
  deleteTask: vi.fn(),
  clearTasks: vi.fn(),
  getImage: vi.fn(),
  getAllImages: vi.fn(),
  putImage: vi.fn(),
  deleteImage: vi.fn(),
  clearImages: vi.fn(),
  storeImage: vi.fn(),
}))

const apiMocks = vi.hoisted(() => ({
  callImageApi: vi.fn(),
}))

vi.mock('./lib/db', () => dbMocks)
vi.mock('./lib/api', () => apiMocks)

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }

async function flushPromises(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    dbMocks.putTask.mockResolvedValue('task-key')
    dbMocks.storeImage.mockResolvedValue('stored-image')
    dbMocks.getImage.mockResolvedValue(undefined)
    apiMocks.callImageApi.mockResolvedValue({ images: [] })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask({ confirmed: true })

    expect(useStore.getState().maskDraft).toBeNull()
  })
})

describe('submit task safeguards', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    dbMocks.putTask.mockResolvedValue('task-key')
    dbMocks.storeImage.mockResolvedValue('stored-image')
    dbMocks.getImage.mockResolvedValue(undefined)
    apiMocks.callImageApi.mockResolvedValue({ images: [] })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a confirmation before creating a generation task', async () => {
    await submitTask()

    expect(dbMocks.putTask).not.toHaveBeenCalled()
    expect(useStore.getState().setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '确认生成图片？',
      confirmText: '确认生成',
    }))
  })

  it('creates a task only after the confirmation action runs', async () => {
    await submitTask()

    const setConfirmDialog = vi.mocked(useStore.getState().setConfirmDialog)
    const dialog = setConfirmDialog.mock.calls[0][0]
    dialog?.action()
    await Promise.resolve()
    await Promise.resolve()

    expect(dbMocks.putTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'prompt',
      status: 'running',
    }))
    expect(useStore.getState().prompt).toBe('')
  })

  it('keeps successful output images and partial errors on a partially failed generation', async () => {
    apiMocks.callImageApi.mockResolvedValue({
      images: ['data:image/png;base64,output'],
      partialError: '第 2 张生成失败：HTTP 504',
    })

    await submitTask({ confirmed: true })
    await flushPromises()

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'done',
      outputImages: ['stored-image'],
      partialError: '第 2 张生成失败：HTTP 504',
    })
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      '部分图片生成失败，已保留成功结果',
      'error',
    )
  })

  it('does not fail OpenAI tasks with a client-side timeout while the server request is still pending', async () => {
    const deferred = createDeferred<{ images: string[] }>()
    apiMocks.callImageApi.mockReturnValue(deferred.promise)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 10 },
      params: { ...DEFAULT_PARAMS, n: 3 },
    })

    await submitTask({ confirmed: true })
    await flushPromises()
    vi.advanceTimersByTime(60_000)
    await flushPromises()

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'running',
      error: null,
    })

    deferred.resolve({ images: [] })
    await flushPromises()
  })

  it('blocks submission while another image is generating', async () => {
    useStore.setState({
      tasks: [task({ id: 'running-task', status: 'running', finishedAt: null, elapsed: null })],
    })

    await submitTask()

    expect(dbMocks.putTask).not.toHaveBeenCalled()
    expect(useStore.getState().setConfirmDialog).not.toHaveBeenCalled()
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      '请等待当前图片生成完成后再继续生成',
      'info',
    )
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const falRunning = task({ id: 'fal-running', apiProvider: 'fal', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, falRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('announcement dismissal state', () => {
  beforeEach(() => {
    useStore.setState({ dismissedAnnouncementIds: [] })
  })

  it('stores each dismissed announcement id once', () => {
    useStore.getState().dismissAnnouncement(' announcement-a ')
    useStore.getState().dismissAnnouncement('announcement-a')
    useStore.getState().dismissAnnouncement('')

    expect(useStore.getState().dismissedAnnouncementIds).toEqual(['announcement-a'])
  })
})
