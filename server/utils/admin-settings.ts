import type { AdminModelConfig, ApiMode, ApiProvider, PublicGenerationModel } from '../../src/types'
import { createError } from 'h3'
import { getDb } from './db'

export type ServerApiConfig = Omit<AdminModelConfig, 'enabled'>

export interface AdminSettings {
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

export type AdminSettingsPatch = Partial<AdminSettings>

interface AdminSettingsRow {
  provider: string
  base_url: string
  api_key: string
  model: string
  timeout: number
  api_mode: string
  codex_cli: number
  premium_provider: string
  premium_base_url: string
  premium_api_key: string
  premium_model: string
  premium_timeout: number
  premium_api_mode: string
  premium_codex_cli: number
  daily_points_target: number
  standard_point_cost: number
  premium_point_cost: number
  gallery_upload_default: number
  hourly_image_limit: number
  privacy_hourly_image_limit: number
  service_concurrent_image_limit: number
  user_concurrent_image_limit: number
  gallery_upload_url: string
  gallery_upload_token: string
  models_json?: string | null
  default_model_id?: string | null
  updated_at: string | null
}

function parseProvider(value: unknown): ApiProvider {
  return value === 'fal' ? 'fal' : 'openai'
}

function parseApiMode(value: unknown): ApiMode {
  return value === 'responses' ? 'responses' : 'images'
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = 1000) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function parseBoolean(value: unknown) {
  return value === true || String(value).toLowerCase() === 'true'
}

function createModelId(prefix = 'model') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createServerApiConfig(defaults: Partial<ServerApiConfig> & { provider: ApiProvider }): ServerApiConfig {
  const provider = parseProvider(defaults.provider)
  const fallbackModel = provider === 'fal' ? 'openai/gpt-image-2' : 'gpt-image-2'
  return {
    id: typeof defaults.id === 'string' && defaults.id.trim() ? defaults.id : createModelId(provider),
    name: typeof defaults.name === 'string' && defaults.name.trim() ? defaults.name.trim() : '默认模型',
    provider,
    baseUrl: String(defaults.baseUrl || (provider === 'fal' ? 'https://fal.run' : 'https://api.openai.com/v1')).trim(),
    apiKey: String(defaults.apiKey || ''),
    model: String(defaults.model || fallbackModel).trim() || fallbackModel,
    timeout: parsePositiveInt(defaults.timeout, 600, 10, 3600),
    apiMode: provider === 'fal' ? 'images' : parseApiMode(defaults.apiMode),
    codexCompatible: provider === 'openai' ? Boolean(defaults.codexCompatible) : false,
  }
}

function createAdminModel(defaults: Partial<AdminModelConfig> & { provider: ApiProvider }): AdminModelConfig {
  return {
    ...createServerApiConfig(defaults),
    enabled: typeof defaults.enabled === 'boolean' ? defaults.enabled : true,
  }
}

function legacyApiConfigFromRuntime() {
  const config = useRuntimeConfig()
  const provider = parseProvider(config.apiProvider)
  return createAdminModel({
    id: 'default-model',
    name: '默认模型',
    provider,
    baseUrl: String(config.apiBaseUrl || (provider === 'fal' ? 'https://fal.run' : 'https://api.openai.com/v1')),
    apiKey: String(config.apiKey || ''),
    model: String(config.apiModel || (provider === 'fal' ? 'openai/gpt-image-2' : 'gpt-image-2')),
    timeout: parsePositiveInt(config.apiTimeout, 600, 10, 3600),
    apiMode: parseApiMode(config.apiMode),
    codexCompatible: parseBoolean(config.apiCodexCli),
    enabled: true,
  })
}

function legacyModelFromRow(row: AdminSettingsRow) {
  return createAdminModel({
    id: 'default-model',
    name: '默认模型',
    provider: parseProvider(row.provider),
    baseUrl: row.base_url,
    apiKey: row.api_key,
    model: row.model,
    timeout: row.timeout,
    apiMode: parseApiMode(row.api_mode),
    codexCompatible: Boolean(row.codex_cli),
    enabled: true,
  })
}

function dedupeModelId(id: string, usedIds: Set<string>, provider: ApiProvider) {
  let nextId = id.trim() || createModelId(provider)
  while (usedIds.has(nextId)) nextId = createModelId(provider)
  usedIds.add(nextId)
  return nextId
}

function normalizeModels(input: unknown, fallbackModels: AdminModelConfig[]): AdminModelConfig[] {
  const records = Array.isArray(input) ? input : []
  const source = records.length ? records : fallbackModels
  const usedIds = new Set<string>()
  const models = source.map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const provider = parseProvider(record.provider)
    const id = dedupeModelId(typeof record.id === 'string' ? record.id : '', usedIds, provider)
    return createAdminModel({
      id,
      name: typeof record.name === 'string' ? record.name : '',
      provider,
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : undefined,
      apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
      model: typeof record.model === 'string' ? record.model : undefined,
      timeout: typeof record.timeout === 'number' ? record.timeout : undefined,
      apiMode: record.apiMode,
      codexCompatible: Boolean(record.codexCompatible ?? record.codexCli),
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    })
  })
  return models.length ? models : [legacyApiConfigFromRuntime()]
}

function readModelsJson(value: unknown, fallbackModels: AdminModelConfig[]) {
  if (typeof value !== 'string' || !value.trim()) return fallbackModels
  try {
    return normalizeModels(JSON.parse(value), fallbackModels)
  } catch {
    return fallbackModels
  }
}

function normalizeSettings(input: Partial<AdminSettings> | null | undefined, fallbackModels?: AdminModelConfig[]): AdminSettings {
  const config = useRuntimeConfig()
  const defaultModels = fallbackModels?.length ? fallbackModels : [legacyApiConfigFromRuntime()]
  const models = normalizeModels(input?.models, defaultModels)
  const requestedDefaultId = typeof input?.defaultModelId === 'string' ? input.defaultModelId : ''
  const defaultModelId = models.find((model) => model.id === requestedDefaultId && model.enabled)?.id ??
    models.find((model) => model.enabled)?.id ??
    models[0].id

  return {
    models,
    defaultModelId,
    dailyPointsTarget: parsePositiveInt(input?.dailyPointsTarget ?? config.defaultDailyPointsTarget, 100, 1, 1_000_000),
    standardPointCost: parsePositiveInt(input?.standardPointCost ?? config.defaultStandardPointCost, 1, 1, 1_000_000),
    galleryUploadDefault: typeof input?.galleryUploadDefault === 'boolean'
      ? input.galleryUploadDefault
      : parseBoolean(config.defaultGalleryUploadDefault),
    hourlyImageLimit: parsePositiveInt(input?.hourlyImageLimit ?? config.defaultHourlyImageLimit, 20, 1, 1000),
    privacyHourlyImageLimit: parsePositiveInt(input?.privacyHourlyImageLimit ?? config.defaultPrivacyHourlyImageLimit, 5, 1, 1000),
    serviceConcurrentImageLimit: parsePositiveInt(input?.serviceConcurrentImageLimit ?? config.defaultServiceConcurrentImageLimit, 3, 1, 1000),
    userConcurrentImageLimit: parsePositiveInt(input?.userConcurrentImageLimit ?? config.defaultUserConcurrentImageLimit, 3, 1, 1000),
    galleryUploadUrl: String(input?.galleryUploadUrl ?? config.galleryUploadUrl ?? 'https://imglist.zrbyhelp.com/api/uploads/third-party').trim() || 'https://imglist.zrbyhelp.com/api/uploads/third-party',
    galleryUploadToken: String(input?.galleryUploadToken ?? config.galleryUploadToken ?? ''),
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : null,
  }
}

export function getDefaultAdminSettings(): AdminSettings {
  return normalizeSettings(null)
}

function rowToSettings(row: AdminSettingsRow): AdminSettings {
  const fallbackModels = [legacyModelFromRow(row)]
  const models = readModelsJson(row.models_json, fallbackModels)
  return normalizeSettings({
    models,
    defaultModelId: row.default_model_id ?? models.find((model) => model.enabled)?.id ?? models[0]?.id,
    dailyPointsTarget: row.daily_points_target,
    standardPointCost: row.standard_point_cost,
    galleryUploadDefault: Boolean(row.gallery_upload_default),
    hourlyImageLimit: row.hourly_image_limit,
    privacyHourlyImageLimit: row.privacy_hourly_image_limit,
    serviceConcurrentImageLimit: row.service_concurrent_image_limit,
    userConcurrentImageLimit: row.user_concurrent_image_limit,
    galleryUploadUrl: row.gallery_upload_url,
    galleryUploadToken: row.gallery_upload_token,
    updatedAt: row.updated_at,
  }, fallbackModels)
}

export async function getAdminSettings() {
  const row = getDb().prepare('SELECT * FROM admin_settings WHERE id = ?').get('default') as AdminSettingsRow | undefined
  return row ? rowToSettings(row) : getDefaultAdminSettings()
}

export function getPublicGenerationModels(settings: AdminSettings): PublicGenerationModel[] {
  return settings.models
    .filter((model) => model.enabled)
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      model: model.model,
      apiMode: model.apiMode,
      codexCompatible: model.codexCompatible,
    }))
}

export function selectGenerationModel(settings: AdminSettings, modelId?: unknown): AdminModelConfig {
  const requestedId = typeof modelId === 'string' ? modelId.trim() : ''
  const model = requestedId
    ? settings.models.find((item) => item.id === requestedId)
    : settings.models.find((item) => item.id === settings.defaultModelId && item.enabled) ?? settings.models.find((item) => item.enabled)

  if (!model) {
    if (requestedId) {
      throw createError({ statusCode: 400, statusMessage: '所选模型不存在' })
    }
    throw createError({ statusCode: 500, statusMessage: '管理员尚未配置可用模型' })
  }
  if (!model.enabled) {
    throw createError({ statusCode: 400, statusMessage: '所选模型已禁用' })
  }
  return model
}

export async function updateAdminSettings(patch: AdminSettingsPatch) {
  const current = await getAdminSettings()
  const merged = normalizeSettings({
    ...current,
    ...patch,
    models: patch.models ?? current.models,
    defaultModelId: patch.defaultModelId ?? current.defaultModelId,
    updatedAt: new Date().toISOString(),
  }, current.models)
  const defaultModel = merged.models.find((model) => model.id === merged.defaultModelId) ?? merged.models[0]

  getDb().prepare(`
    INSERT INTO admin_settings (
      id,
      provider,
      base_url,
      api_key,
      model,
      timeout,
      api_mode,
      codex_cli,
      premium_provider,
      premium_base_url,
      premium_api_key,
      premium_model,
      premium_timeout,
      premium_api_mode,
      premium_codex_cli,
      daily_points_target,
      standard_point_cost,
      premium_point_cost,
      gallery_upload_default,
      hourly_image_limit,
      privacy_hourly_image_limit,
      service_concurrent_image_limit,
      user_concurrent_image_limit,
      gallery_upload_url,
      gallery_upload_token,
      models_json,
      default_model_id,
      updated_at
    ) VALUES (
      'default',
      @provider,
      @baseUrl,
      @apiKey,
      @model,
      @timeout,
      @apiMode,
      @codexCli,
      @provider,
      @baseUrl,
      @apiKey,
      @model,
      @timeout,
      @apiMode,
      @codexCli,
      @dailyPointsTarget,
      @standardPointCost,
      @standardPointCost,
      @galleryUploadDefault,
      @hourlyImageLimit,
      @privacyHourlyImageLimit,
      @serviceConcurrentImageLimit,
      @userConcurrentImageLimit,
      @galleryUploadUrl,
      @galleryUploadToken,
      @modelsJson,
      @defaultModelId,
      @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      model = excluded.model,
      timeout = excluded.timeout,
      api_mode = excluded.api_mode,
      codex_cli = excluded.codex_cli,
      premium_provider = excluded.premium_provider,
      premium_base_url = excluded.premium_base_url,
      premium_api_key = excluded.premium_api_key,
      premium_model = excluded.premium_model,
      premium_timeout = excluded.premium_timeout,
      premium_api_mode = excluded.premium_api_mode,
      premium_codex_cli = excluded.premium_codex_cli,
      daily_points_target = excluded.daily_points_target,
      standard_point_cost = excluded.standard_point_cost,
      premium_point_cost = excluded.premium_point_cost,
      gallery_upload_default = excluded.gallery_upload_default,
      hourly_image_limit = excluded.hourly_image_limit,
      privacy_hourly_image_limit = excluded.privacy_hourly_image_limit,
      service_concurrent_image_limit = excluded.service_concurrent_image_limit,
      user_concurrent_image_limit = excluded.user_concurrent_image_limit,
      gallery_upload_url = excluded.gallery_upload_url,
      gallery_upload_token = excluded.gallery_upload_token,
      models_json = excluded.models_json,
      default_model_id = excluded.default_model_id,
      updated_at = excluded.updated_at
  `).run({
    provider: defaultModel.provider,
    baseUrl: defaultModel.baseUrl,
    apiKey: defaultModel.apiKey,
    model: defaultModel.model,
    timeout: defaultModel.timeout,
    apiMode: defaultModel.apiMode,
    codexCli: defaultModel.codexCompatible ? 1 : 0,
    dailyPointsTarget: merged.dailyPointsTarget,
    standardPointCost: merged.standardPointCost,
    galleryUploadDefault: merged.galleryUploadDefault ? 1 : 0,
    hourlyImageLimit: merged.hourlyImageLimit,
    privacyHourlyImageLimit: merged.privacyHourlyImageLimit,
    serviceConcurrentImageLimit: merged.serviceConcurrentImageLimit,
    userConcurrentImageLimit: merged.userConcurrentImageLimit,
    galleryUploadUrl: merged.galleryUploadUrl,
    galleryUploadToken: merged.galleryUploadToken,
    modelsJson: JSON.stringify(merged.models),
    defaultModelId: merged.defaultModelId,
    updatedAt: merged.updatedAt,
  })

  return merged
}

export function assertApiConfigUsable(config: ServerApiConfig, label = 'API') {
  if (config.provider === 'openai' && !config.baseUrl.trim()) {
    throw createError({ statusCode: 500, statusMessage: `管理员尚未配置 ${label} URL` })
  }
  if (!config.apiKey.trim()) {
    throw createError({ statusCode: 500, statusMessage: `管理员尚未配置 ${label} Key` })
  }
  if (!config.model.trim()) {
    throw createError({ statusCode: 500, statusMessage: `管理员尚未配置 ${label} 模型 ID` })
  }
}
