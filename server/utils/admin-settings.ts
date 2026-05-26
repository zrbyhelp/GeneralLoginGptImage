import type { ApiMode, ApiProvider } from '../../src/types'
import { createError } from 'h3'
import { getDb } from './db'

export interface ServerApiConfig {
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
}

export interface AdminSettings {
  apiConfig: ServerApiConfig
  premiumApiConfig: ServerApiConfig
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

export type AdminSettingsPatch = Partial<Omit<AdminSettings, 'apiConfig' | 'premiumApiConfig'>> & {
  apiConfig?: Partial<ServerApiConfig>
  premiumApiConfig?: Partial<ServerApiConfig>
}

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

function createServerApiConfig(defaults: Partial<ServerApiConfig> & { provider: ApiProvider }) {
  const provider = parseProvider(defaults.provider)
  const fallbackModel = provider === 'fal' ? 'openai/gpt-image-2' : 'gpt-image-2'
  return {
    provider,
    baseUrl: String(defaults.baseUrl || (provider === 'fal' ? 'https://fal.run' : 'https://api.openai.com/v1')),
    apiKey: String(defaults.apiKey || ''),
    model: String(defaults.model || fallbackModel),
    timeout: parsePositiveInt(defaults.timeout, 600, 10, 3600),
    apiMode: provider === 'fal' ? 'images' : parseApiMode(defaults.apiMode),
    codexCli: provider === 'openai' ? Boolean(defaults.codexCli) : false,
  } satisfies ServerApiConfig
}

export function getDefaultAdminSettings(): AdminSettings {
  const config = useRuntimeConfig()
  const provider = parseProvider(config.apiProvider)
  const apiConfig = createServerApiConfig({
    provider,
    baseUrl: String(config.apiBaseUrl || (provider === 'fal' ? 'https://fal.run' : 'https://api.openai.com/v1')),
    apiKey: String(config.apiKey || ''),
    model: String(config.apiModel || (provider === 'fal' ? 'openai/gpt-image-2' : 'gpt-image-2')),
    timeout: parsePositiveInt(config.apiTimeout, 600, 10, 3600),
    apiMode: parseApiMode(config.apiMode),
    codexCli: parseBoolean(config.apiCodexCli),
  })
  const premiumProvider = parseProvider(config.premiumApiProvider || apiConfig.provider)

  return {
    apiConfig,
    premiumApiConfig: createServerApiConfig({
      provider: premiumProvider,
      baseUrl: String(config.premiumApiBaseUrl || apiConfig.baseUrl),
      apiKey: String(config.premiumApiKey || apiConfig.apiKey),
      model: String(config.premiumApiModel || apiConfig.model),
      timeout: parsePositiveInt(config.premiumApiTimeout, apiConfig.timeout, 10, 3600),
      apiMode: parseApiMode(config.premiumApiMode || apiConfig.apiMode),
      codexCli: parseBoolean(config.premiumApiCodexCli || apiConfig.codexCli),
    }),
    dailyPointsTarget: parsePositiveInt(config.defaultDailyPointsTarget, 100, 1, 1_000_000),
    standardPointCost: parsePositiveInt(config.defaultStandardPointCost, 1, 1, 1_000_000),
    premiumPointCost: parsePositiveInt(config.defaultPremiumPointCost, 300, 1, 1_000_000),
    galleryUploadDefault: parseBoolean(config.defaultGalleryUploadDefault),
    hourlyImageLimit: parsePositiveInt(config.defaultHourlyImageLimit, 20, 1, 1000),
    privacyHourlyImageLimit: parsePositiveInt(config.defaultPrivacyHourlyImageLimit, 5, 1, 1000),
    serviceConcurrentImageLimit: parsePositiveInt(config.defaultServiceConcurrentImageLimit, 3, 1, 1000),
    userConcurrentImageLimit: parsePositiveInt(config.defaultUserConcurrentImageLimit, 3, 1, 1000),
    galleryUploadUrl: String(config.galleryUploadUrl || 'https://imglist.zrbyhelp.com/api/uploads/third-party').trim(),
    galleryUploadToken: String(config.galleryUploadToken || ''),
    updatedAt: null,
  }
}

function normalizeSettings(input: Partial<AdminSettings> | null | undefined): AdminSettings {
  const defaults = getDefaultAdminSettings()
  const normalizeApi = (api: Partial<ServerApiConfig> | undefined, fallback: ServerApiConfig) => {
    const provider = parseProvider(api?.provider ?? fallback.provider)
    const fallbackModel = provider === 'fal' ? 'openai/gpt-image-2' : 'gpt-image-2'
    return {
      provider,
      baseUrl: String(api?.baseUrl ?? fallback.baseUrl).trim(),
      apiKey: String(api?.apiKey ?? fallback.apiKey),
      model: String(api?.model ?? fallbackModel).trim() || fallbackModel,
      timeout: parsePositiveInt(api?.timeout, fallback.timeout, 10, 3600),
      apiMode: provider === 'fal' ? 'images' : parseApiMode(api?.apiMode ?? fallback.apiMode),
      codexCli: provider === 'openai' ? Boolean(api?.codexCli ?? fallback.codexCli) : false,
    } satisfies ServerApiConfig
  }

  return {
    apiConfig: normalizeApi(input?.apiConfig, defaults.apiConfig),
    premiumApiConfig: normalizeApi(input?.premiumApiConfig, defaults.premiumApiConfig),
    dailyPointsTarget: parsePositiveInt(input?.dailyPointsTarget, defaults.dailyPointsTarget, 1, 1_000_000),
    standardPointCost: parsePositiveInt(input?.standardPointCost, defaults.standardPointCost, 1, 1_000_000),
    premiumPointCost: parsePositiveInt(input?.premiumPointCost, defaults.premiumPointCost, 1, 1_000_000),
    galleryUploadDefault: typeof input?.galleryUploadDefault === 'boolean' ? input.galleryUploadDefault : defaults.galleryUploadDefault,
    hourlyImageLimit: parsePositiveInt(input?.hourlyImageLimit, defaults.hourlyImageLimit, 1, 1000),
    privacyHourlyImageLimit: parsePositiveInt(input?.privacyHourlyImageLimit, defaults.privacyHourlyImageLimit, 1, 1000),
    serviceConcurrentImageLimit: parsePositiveInt(input?.serviceConcurrentImageLimit, defaults.serviceConcurrentImageLimit, 1, 1000),
    userConcurrentImageLimit: parsePositiveInt(input?.userConcurrentImageLimit, defaults.userConcurrentImageLimit, 1, 1000),
    galleryUploadUrl: String(input?.galleryUploadUrl ?? defaults.galleryUploadUrl).trim() || defaults.galleryUploadUrl,
    galleryUploadToken: String(input?.galleryUploadToken ?? defaults.galleryUploadToken),
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : defaults.updatedAt,
  }
}

function rowToSettings(row: AdminSettingsRow): AdminSettings {
  return normalizeSettings({
    apiConfig: {
      provider: row.provider as ApiProvider,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      model: row.model,
      timeout: row.timeout,
      apiMode: row.api_mode as ApiMode,
      codexCli: Boolean(row.codex_cli),
    },
    premiumApiConfig: {
      provider: row.premium_provider as ApiProvider,
      baseUrl: row.premium_base_url,
      apiKey: row.premium_api_key,
      model: row.premium_model,
      timeout: row.premium_timeout,
      apiMode: row.premium_api_mode as ApiMode,
      codexCli: Boolean(row.premium_codex_cli),
    },
    dailyPointsTarget: row.daily_points_target,
    standardPointCost: row.standard_point_cost,
    premiumPointCost: row.premium_point_cost,
    galleryUploadDefault: Boolean(row.gallery_upload_default),
    hourlyImageLimit: row.hourly_image_limit,
    privacyHourlyImageLimit: row.privacy_hourly_image_limit,
    serviceConcurrentImageLimit: row.service_concurrent_image_limit,
    userConcurrentImageLimit: row.user_concurrent_image_limit,
    galleryUploadUrl: row.gallery_upload_url,
    galleryUploadToken: row.gallery_upload_token,
    updatedAt: row.updated_at,
  })
}

export async function getAdminSettings() {
  const row = getDb().prepare('SELECT * FROM admin_settings WHERE id = ?').get('default') as AdminSettingsRow | undefined
  return row ? rowToSettings(row) : getDefaultAdminSettings()
}

export async function updateAdminSettings(patch: AdminSettingsPatch) {
  const current = await getAdminSettings()
  const merged = normalizeSettings({
    ...current,
    ...patch,
    apiConfig: {
      ...current.apiConfig,
      ...(patch.apiConfig ?? {}),
    },
    premiumApiConfig: {
      ...current.premiumApiConfig,
      ...(patch.premiumApiConfig ?? {}),
    },
    updatedAt: new Date().toISOString(),
  })

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
      @premiumProvider,
      @premiumBaseUrl,
      @premiumApiKey,
      @premiumModel,
      @premiumTimeout,
      @premiumApiMode,
      @premiumCodexCli,
      @dailyPointsTarget,
      @standardPointCost,
      @premiumPointCost,
      @galleryUploadDefault,
      @hourlyImageLimit,
      @privacyHourlyImageLimit,
      @serviceConcurrentImageLimit,
      @userConcurrentImageLimit,
      @galleryUploadUrl,
      @galleryUploadToken,
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
      updated_at = excluded.updated_at
  `).run({
    provider: merged.apiConfig.provider,
    baseUrl: merged.apiConfig.baseUrl,
    apiKey: merged.apiConfig.apiKey,
    model: merged.apiConfig.model,
    timeout: merged.apiConfig.timeout,
    apiMode: merged.apiConfig.apiMode,
    codexCli: merged.apiConfig.codexCli ? 1 : 0,
    premiumProvider: merged.premiumApiConfig.provider,
    premiumBaseUrl: merged.premiumApiConfig.baseUrl,
    premiumApiKey: merged.premiumApiConfig.apiKey,
    premiumModel: merged.premiumApiConfig.model,
    premiumTimeout: merged.premiumApiConfig.timeout,
    premiumApiMode: merged.premiumApiConfig.apiMode,
    premiumCodexCli: merged.premiumApiConfig.codexCli ? 1 : 0,
    dailyPointsTarget: merged.dailyPointsTarget,
    standardPointCost: merged.standardPointCost,
    premiumPointCost: merged.premiumPointCost,
    galleryUploadDefault: merged.galleryUploadDefault ? 1 : 0,
    hourlyImageLimit: merged.hourlyImageLimit,
    privacyHourlyImageLimit: merged.privacyHourlyImageLimit,
    serviceConcurrentImageLimit: merged.serviceConcurrentImageLimit,
    userConcurrentImageLimit: merged.userConcurrentImageLimit,
    galleryUploadUrl: merged.galleryUploadUrl,
    galleryUploadToken: merged.galleryUploadToken,
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
