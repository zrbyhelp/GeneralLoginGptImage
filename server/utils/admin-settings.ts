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
  hourlyImageLimit: number
  updatedAt: string | null
}

export type AdminSettingsPatch = Partial<Omit<AdminSettings, 'apiConfig'>> & {
  apiConfig?: Partial<ServerApiConfig>
}

interface AdminSettingsRow {
  provider: string
  base_url: string
  api_key: string
  model: string
  timeout: number
  api_mode: string
  codex_cli: number
  hourly_image_limit: number
  updated_at: string | null
}

function parseProvider(value: unknown): ApiProvider {
  return value === 'fal' ? 'fal' : 'openai'
}

function parseApiMode(value: unknown): ApiMode {
  return value === 'responses' ? 'responses' : 'images'
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = 1000) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function parseBoolean(value: unknown) {
  return value === true || String(value).toLowerCase() === 'true'
}

export function getDefaultAdminSettings(): AdminSettings {
  const config = useRuntimeConfig()
  const provider = parseProvider(config.apiProvider)
  const fallbackModel = provider === 'fal' ? 'openai/gpt-image-2' : 'gpt-image-2'

  return {
    apiConfig: {
      provider,
      baseUrl: String(config.apiBaseUrl || (provider === 'fal' ? 'https://fal.run' : 'https://api.openai.com/v1')),
      apiKey: String(config.apiKey || ''),
      model: String(config.apiModel || fallbackModel),
      timeout: parsePositiveInt(config.apiTimeout, 600, 10, 3600),
      apiMode: parseApiMode(config.apiMode),
      codexCli: parseBoolean(config.apiCodexCli),
    },
    hourlyImageLimit: parsePositiveInt(config.defaultHourlyImageLimit, 20, 1, 1000),
    updatedAt: null,
  }
}

function normalizeSettings(input: Partial<AdminSettings> | null | undefined): AdminSettings {
  const defaults = getDefaultAdminSettings()
  const api = input?.apiConfig ?? {}
  const provider = parseProvider(api.provider ?? defaults.apiConfig.provider)
  const fallbackModel = provider === 'fal' ? 'openai/gpt-image-2' : 'gpt-image-2'

  return {
    apiConfig: {
      provider,
      baseUrl: String(api.baseUrl ?? defaults.apiConfig.baseUrl).trim(),
      apiKey: String(api.apiKey ?? defaults.apiConfig.apiKey),
      model: String(api.model ?? fallbackModel).trim() || fallbackModel,
      timeout: parsePositiveInt(api.timeout, defaults.apiConfig.timeout, 10, 3600),
      apiMode: provider === 'fal' ? 'images' : parseApiMode(api.apiMode ?? defaults.apiConfig.apiMode),
      codexCli: provider === 'openai' ? Boolean(api.codexCli ?? defaults.apiConfig.codexCli) : false,
    },
    hourlyImageLimit: parsePositiveInt(input?.hourlyImageLimit, defaults.hourlyImageLimit, 1, 1000),
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
    hourlyImageLimit: row.hourly_image_limit,
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
      hourly_image_limit,
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
      @hourlyImageLimit,
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
      hourly_image_limit = excluded.hourly_image_limit,
      updated_at = excluded.updated_at
  `).run({
    provider: merged.apiConfig.provider,
    baseUrl: merged.apiConfig.baseUrl,
    apiKey: merged.apiConfig.apiKey,
    model: merged.apiConfig.model,
    timeout: merged.apiConfig.timeout,
    apiMode: merged.apiConfig.apiMode,
    codexCli: merged.apiConfig.codexCli ? 1 : 0,
    hourlyImageLimit: merged.hourlyImageLimit,
    updatedAt: merged.updatedAt,
  })

  return merged
}

export function assertApiConfigUsable(config: ServerApiConfig) {
  if (config.provider === 'openai' && !config.baseUrl.trim()) {
    throw createError({ statusCode: 500, statusMessage: '管理员尚未配置 API URL' })
  }
  if (!config.apiKey.trim()) {
    throw createError({ statusCode: 500, statusMessage: '管理员尚未配置 API Key' })
  }
  if (!config.model.trim()) {
    throw createError({ statusCode: 500, statusMessage: '管理员尚未配置模型 ID' })
  }
}
