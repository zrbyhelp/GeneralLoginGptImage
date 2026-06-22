// ===== 设置 =====

export type ApiMode = 'images' | 'responses' | 'generateContent' | 'geminiDeveloper' | 'geminiVertex'
export type ApiProvider = 'openai' | 'fal' | 'google-gemini'
export type PricingMode = 'flat' | 'tiered'
export type SizePriceTier = '1K' | '2K' | '4K'
export type QualityPricePoints = Record<TaskParams['quality'], number>
export type GeminiMediaResolution = 'auto' | 'low' | 'medium' | 'high'
export type GeminiMediaResolutionPoints = Record<GeminiMediaResolution, number>
export type GeminiThinkingMode = 'auto' | 'off' | 'low' | 'high'
export type GeminiSafetyLevel = 'default' | 'strict' | 'balanced' | 'relaxed'

export interface GeminiUserParams {
  mediaResolution: GeminiMediaResolution
  temperature: number | null
  thinkingMode: GeminiThinkingMode
  safetyLevel: GeminiSafetyLevel
  networkSearch: boolean
}

export interface GeminiAdminDefaults {
  topP?: number | null
  topK?: number | null
  maxOutputTokens?: number | null
  seed?: number | null
  responseMimeType?: string
  imageConfig?: Record<string, unknown> | null
  generationConfig?: Record<string, unknown> | null
  thinkingConfig?: Record<string, unknown> | null
  safetySettings?: unknown[] | null
}

export interface TieredPricingRules {
  sizeQualityPoints: Record<SizePriceTier, QualityPricePoints>
  referenceImagePoints: number
  maskEditPoints: number
  minimumPoints: number
}

export interface GeminiPricingRules {
  mediaResolutionPoints: GeminiMediaResolutionPoints
  referenceImagePoints: number
  minimumPoints: number
  searchGroundingPointsPerCount: number
  searchGroundingEstimatedCountPerImage: number
}

export type ModelPricingRules = TieredPricingRules | GeminiPricingRules

export interface PricingBreakdown {
  mode: PricingMode
  sizeTier?: SizePriceTier
  quality?: TaskParams['quality']
  mediaResolution?: GeminiMediaResolution
  basePoints: number
  referenceImageCount: number
  referenceImagePoints: number
  searchGroundingEnabled?: boolean
  searchGroundingEstimatedCount?: number
  searchGroundingActualCount?: number
  searchGroundingPointsPerCount?: number
  searchGroundingEstimatedPoints?: number
  searchGroundingActualPoints?: number
  maskEditApplied: boolean
  maskEditPoints: number
  minimumPoints: number
  pointsPerImage: number
  imageCount: number
  totalPoints: number
}

export interface AdminModelConfig {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCompatible: boolean
  geminiDefaults?: GeminiAdminDefaults
  enabled: boolean
  pricingMode: PricingMode
  pricingRules: ModelPricingRules
}

export interface PublicGenerationModel {
  id: string
  name: string
  provider: ApiProvider
  model: string
  apiMode: ApiMode
  codexCompatible: boolean
  pricingMode: PricingMode
  pricingPreviewRules: ModelPricingRules
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
}

export interface AppSettings {
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  clearInputAfterSubmit: boolean
  profiles: ApiProfile[]
  activeProfileId: string
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
  gemini?: GeminiUserParams
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
  gemini: {
    mediaResolution: 'auto',
    temperature: null,
    thinkingMode: 'auto',
    safetyLevel: 'default',
    networkSearch: false,
  },
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'queued' | 'running' | 'done' | 'error'

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams
  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时选择的管理员模型配置 ID */
  modelId?: string
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** 生成时使用的模型是否为 Codex 兼容 */
  apiCodexCompatible?: boolean
  /** fal.ai 队列请求 ID，用于连接断开后的结果恢复 */
  falRequestId?: string
  /** fal.ai 队列 endpoint，用于连接断开后的状态和结果查询 */
  falEndpoint?: string
  /** fal.ai 任务连接断开后是否等待自动恢复 */
  falRecoverable?: boolean
  /** 服务端生成队列 job id，用于刷新后恢复排队/生成状态 */
  queueJobId?: string
  /** 服务端队列位置，1 表示下一张等待启动 */
  queuePosition?: number | null
  /** 服务端队列已结束的图片单元数（成功或失败） */
  queueCompletedImages?: number
  /** 服务端队列总图片单元数 */
  queueTotalImages?: number
  /** 是否上传第三方图集 */
  uploadToGallery?: boolean
  /** 旧字段：是否使用 2K-4K 专用 API 和高档位积分 */
  usePremiumApi?: boolean
  /** 旧字段：true 表示跳过第三方图集上传 */
  privacyMode?: boolean
  /** 本次实际扣除积分 */
  chargedPoints?: number
  /** 本次失败图片退款积分 */
  refundedPoints?: number
  /** 本次计费方式 */
  billingMode?: PricingMode
  /** 提交任务时预估总积分 */
  estimatedPoints?: number
  /** 本次计费拆分 */
  pricingBreakdown?: PricingBreakdown
  /** 结算后的最新积分余额 */
  pointsBalance?: number
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 部分生成失败原因。任务仍为完成状态，但请求数量可能少于用户提交数量。 */
  partialError?: string | null
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  type?: string
  result?: string | {
    b64_json?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  tasks: TaskRecord[]
  /** imageId → 图片信息 */
  imageFiles: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
  }>
}
