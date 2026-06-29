import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import Database from 'better-sqlite3'
import { createError } from 'h3'
import cron from 'node-cron'
import { generateId } from './crypto'
import { backupDatabaseTo, getDb, replaceDatabaseFile } from './db'

type BackupStatus = 'running' | 'completed' | 'failed'
type RestoreStatus = '' | 'running' | 'completed' | 'failed'
type BackupTrigger = 'manual' | 'scheduled' | 'pre_restore'

export interface BackupS3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  secretAccessKeyConfigured?: boolean
  prefix: string
  forcePathStyle: boolean
}

export interface BackupScheduleConfig {
  enabled: boolean
  cronExpr: string
  timezone: string
  retainDays: number
  retainCount: number
}

export interface BackupRecord {
  id: string
  status: BackupStatus
  backupType: string
  fileName: string
  s3Key: string
  sizeBytes: number
  triggeredBy: BackupTrigger
  progress: string | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  expiresAt: string | null
  restoreStatus: RestoreStatus
  restoreError: string | null
  restoredAt: string | null
}

export interface BackupObjectStore {
  uploadObject: (key: string, filePath: string, contentType: string) => Promise<number>
  downloadObject: (key: string, destinationPath: string) => Promise<number>
  deleteObject: (key: string) => Promise<void>
  getDownloadUrl: (key: string, expiresInSeconds: number) => Promise<string>
  headBucket: () => Promise<void>
}

type BackupS3ConfigRow = {
  endpoint: string
  region: string
  bucket: string
  access_key_id: string
  secret_access_key: string
  prefix: string
  force_path_style: number
  updated_at: string | null
}

type BackupScheduleRow = {
  enabled: number
  cron_expr: string
  timezone: string
  retain_days: number
  retain_count: number
  updated_at: string | null
}

type BackupRecordRow = {
  id: string
  status: BackupStatus
  backup_type: string
  file_name: string
  s3_key: string
  size_bytes: number
  triggered_by: BackupTrigger
  progress: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
  expires_at: string | null
  restore_status: RestoreStatus | null
  restore_error: string | null
  restored_at: string | null
}

type ValidationStatement = {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
}

type ValidationDatabase = {
  prepare: (source: string) => ValidationStatement
  pragma: (source: string, options?: { simple?: boolean }) => unknown
  close: () => void
}

const ValidationSqliteDatabase = Database as unknown as new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => ValidationDatabase

const DEFAULT_BACKUP_CRON = '0 2 * * *'
const DEFAULT_BACKUP_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_RETAIN_DAYS = 14
const DEFAULT_RETAIN_COUNT = 10
const SQLITE_BACKUP_TYPE = 'sqlite'
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60
const CORE_TABLES = [
  'sessions',
  'admin_settings',
  'user_points',
  'point_ledger',
  'redeem_codes',
  'generation_usage',
  'generation_audits',
  'generation_audit_images',
]

let backupInProgress = false
let restoreInProgress = false
let scheduledTask: ReturnType<typeof cron.schedule> | null = null
let testObjectStoreFactory: ((config: BackupS3Config) => BackupObjectStore) | null = null

function getRuntimeConfigValue(key: string) {
  try {
    return (useRuntimeConfig() as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function parseBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
}

function parseInteger(value: unknown, fallback: number, min = 0, max = 1_000_000) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function normalizePrefix(value: unknown) {
  return String(value || 'backups').trim().replace(/^\/+|\/+$/g, '') || 'backups'
}

function defaultS3ConfigFromRuntime(): BackupS3Config {
  return {
    endpoint: String(getRuntimeConfigValue('backupS3Endpoint') || '').trim(),
    region: String(getRuntimeConfigValue('backupS3Region') || 'auto').trim() || 'auto',
    bucket: String(getRuntimeConfigValue('backupS3Bucket') || '').trim(),
    accessKeyId: String(getRuntimeConfigValue('backupS3AccessKeyId') || '').trim(),
    secretAccessKey: String(getRuntimeConfigValue('backupS3SecretAccessKey') || ''),
    prefix: normalizePrefix(getRuntimeConfigValue('backupS3Prefix')),
    forcePathStyle: parseBoolean(getRuntimeConfigValue('backupS3ForcePathStyle'), false),
  }
}

function defaultScheduleFromRuntime(): BackupScheduleConfig {
  return {
    enabled: parseBoolean(getRuntimeConfigValue('backupScheduleEnabled'), false),
    cronExpr: String(getRuntimeConfigValue('backupScheduleCron') || DEFAULT_BACKUP_CRON).trim() || DEFAULT_BACKUP_CRON,
    timezone: String(getRuntimeConfigValue('backupScheduleTimezone') || DEFAULT_BACKUP_TIMEZONE).trim() || DEFAULT_BACKUP_TIMEZONE,
    retainDays: parseInteger(getRuntimeConfigValue('backupScheduleRetainDays'), DEFAULT_RETAIN_DAYS, 0),
    retainCount: parseInteger(getRuntimeConfigValue('backupScheduleRetainCount'), DEFAULT_RETAIN_COUNT, 0),
  }
}

function s3ConfigFromRow(row: BackupS3ConfigRow): BackupS3Config {
  return {
    endpoint: row.endpoint,
    region: row.region || 'auto',
    bucket: row.bucket,
    accessKeyId: row.access_key_id,
    secretAccessKey: row.secret_access_key,
    prefix: normalizePrefix(row.prefix),
    forcePathStyle: Boolean(row.force_path_style),
  }
}

function publicS3Config(config: BackupS3Config): BackupS3Config {
  return {
    ...config,
    secretAccessKey: '',
    secretAccessKeyConfigured: Boolean(config.secretAccessKey),
  }
}

function scheduleFromRow(row: BackupScheduleRow): BackupScheduleConfig {
  return {
    enabled: Boolean(row.enabled),
    cronExpr: row.cron_expr || DEFAULT_BACKUP_CRON,
    timezone: row.timezone || DEFAULT_BACKUP_TIMEZONE,
    retainDays: Math.max(0, Number(row.retain_days) || 0),
    retainCount: Math.max(0, Number(row.retain_count) || 0),
  }
}

function recordFromRow(row: BackupRecordRow): BackupRecord {
  return {
    id: row.id,
    status: row.status,
    backupType: row.backup_type,
    fileName: row.file_name,
    s3Key: row.s3_key,
    sizeBytes: Number(row.size_bytes) || 0,
    triggeredBy: row.triggered_by,
    progress: row.progress,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    expiresAt: row.expires_at,
    restoreStatus: row.restore_status || '',
    restoreError: row.restore_error,
    restoredAt: row.restored_at,
  }
}

function recordSqlParams(record: BackupRecord) {
  return {
    id: record.id,
    status: record.status,
    backupType: record.backupType,
    fileName: record.fileName,
    s3Key: record.s3Key,
    sizeBytes: record.sizeBytes,
    triggeredBy: record.triggeredBy,
    progress: record.progress,
    errorMessage: record.errorMessage,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    expiresAt: record.expiresAt,
    restoreStatus: record.restoreStatus || null,
    restoreError: record.restoreError,
    restoredAt: record.restoredAt,
  }
}

function isS3Configured(config: BackupS3Config) {
  return Boolean(config.bucket && config.accessKeyId && config.secretAccessKey)
}

function assertS3Configured(config: BackupS3Config) {
  if (!isS3Configured(config)) {
    throw createError({ statusCode: 400, statusMessage: '备份 S3/R2 尚未配置完整' })
  }
}

function assertValidSchedule(schedule: BackupScheduleConfig) {
  if (schedule.enabled && !schedule.cronExpr.trim()) {
    throw createError({ statusCode: 400, statusMessage: '启用自动备份时必须填写 Cron 表达式' })
  }
  if (schedule.cronExpr.trim() && !cron.validate(schedule.cronExpr.trim())) {
    throw createError({ statusCode: 400, statusMessage: 'Cron 表达式无效' })
  }
}

function buildS3Key(config: BackupS3Config, fileName: string, now = new Date()) {
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  return `${normalizePrefix(config.prefix)}/${year}/${month}/${day}/${fileName}`
}

function formatTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function createBackupRecord(triggeredBy: BackupTrigger, expireDays = DEFAULT_RETAIN_DAYS, now = new Date(), config: BackupS3Config): BackupRecord {
  const id = generateId('bkp')
  const fileName = `gpt-image-playground-sqlite-${formatTimestamp(now)}-${id}.db.gz`
  return {
    id,
    status: 'running',
    backupType: SQLITE_BACKUP_TYPE,
    fileName,
    s3Key: buildS3Key(config, fileName, now),
    sizeBytes: 0,
    triggeredBy,
    progress: 'pending',
    errorMessage: null,
    startedAt: now.toISOString(),
    finishedAt: null,
    expiresAt: expireDays > 0 ? new Date(now.getTime() + expireDays * 24 * 60 * 60 * 1000).toISOString() : null,
    restoreStatus: '',
    restoreError: null,
    restoredAt: null,
  }
}

function bodyToReadable(body: unknown): Readable {
  if (body instanceof Readable) return body
  if (body && typeof (body as { pipe?: unknown }).pipe === 'function') return body as Readable
  if (body && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === 'function') {
    return Readable.fromWeb((body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream())
  }
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    return Readable.from(body as AsyncIterable<Uint8Array>)
  }
  if (body instanceof Uint8Array) return Readable.from(body)
  if (typeof body === 'string') return Readable.from(Buffer.from(body))
  throw new Error('S3 返回了不支持的响应体')
}

class S3BackupObjectStore implements BackupObjectStore {
  private client: S3Client

  constructor(private config: BackupS3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint || undefined,
      region: config.region || 'auto',
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async uploadObject(key: string, filePath: string, contentType: string) {
    const info = await stat(filePath)
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
      ContentLength: info.size,
    }))
    return info.size
  }

  async downloadObject(key: string, destinationPath: string) {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }))
    if (!response.Body) throw new Error('S3 未返回备份文件内容')
    mkdirSync(dirname(destinationPath), { recursive: true })
    await pipeline(bodyToReadable(response.Body), createWriteStream(destinationPath))
    return (await stat(destinationPath)).size
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }))
  }

  async getDownloadUrl(key: string, expiresInSeconds: number) {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }), { expiresIn: expiresInSeconds })
  }

  async headBucket() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }))
  }
}

function createObjectStore(config: BackupS3Config) {
  return testObjectStoreFactory ? testObjectStoreFactory(config) : new S3BackupObjectStore(config)
}

async function gzipFile(sourcePath: string, destinationPath: string) {
  await pipeline(createReadStream(sourcePath), createGzip({ level: 6 }), createWriteStream(destinationPath))
}

async function gunzipFile(sourcePath: string, destinationPath: string) {
  await pipeline(createReadStream(sourcePath), createGunzip(), createWriteStream(destinationPath))
}

function validateRestoredDatabase(filePath: string) {
  const db = new ValidationSqliteDatabase(filePath, { readonly: true, fileMustExist: true })
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${String(integrity)}`)
    }

    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const tables = new Set(rows.map((row) => row.name))
    const missing = CORE_TABLES.filter((table) => !tables.has(table))
    if (missing.length) {
      throw new Error(`SQLite 备份缺少核心表: ${missing.join(', ')}`)
    }
  } finally {
    db.close()
  }
}

function saveBackupRecord(record: BackupRecord) {
  getDb().prepare(`
    INSERT INTO backup_records (
      id,
      status,
      backup_type,
      file_name,
      s3_key,
      size_bytes,
      triggered_by,
      progress,
      error_message,
      started_at,
      finished_at,
      expires_at,
      restore_status,
      restore_error,
      restored_at
    ) VALUES (
      @id,
      @status,
      @backupType,
      @fileName,
      @s3Key,
      @sizeBytes,
      @triggeredBy,
      @progress,
      @errorMessage,
      @startedAt,
      @finishedAt,
      @expiresAt,
      @restoreStatus,
      @restoreError,
      @restoredAt
    )
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      backup_type = excluded.backup_type,
      file_name = excluded.file_name,
      s3_key = excluded.s3_key,
      size_bytes = excluded.size_bytes,
      triggered_by = excluded.triggered_by,
      progress = excluded.progress,
      error_message = excluded.error_message,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      expires_at = excluded.expires_at,
      restore_status = excluded.restore_status,
      restore_error = excluded.restore_error,
      restored_at = excluded.restored_at
  `).run(recordSqlParams(record))
}

function deleteBackupRecord(id: string) {
  getDb().prepare('DELETE FROM backup_records WHERE id = ?').run(id)
}

function acquireBackupSlot() {
  if (backupInProgress) {
    throw createError({ statusCode: 409, statusMessage: '已有备份正在进行中' })
  }
  backupInProgress = true
}

function releaseBackupSlot() {
  backupInProgress = false
}

function acquireRestoreSlot() {
  if (restoreInProgress) {
    throw createError({ statusCode: 409, statusMessage: '已有恢复正在进行中' })
  }
  restoreInProgress = true
}

function releaseRestoreSlot() {
  restoreInProgress = false
}

async function executeBackupRecord(record: BackupRecord, config: BackupS3Config, store: BackupObjectStore) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'gip-backup-'))
  const snapshotPath = join(tempRoot, 'snapshot.db')
  const gzipPath = join(tempRoot, record.fileName)
  try {
    record.progress = 'snapshotting'
    saveBackupRecord(record)
    await backupDatabaseTo(snapshotPath)

    record.progress = 'compressing'
    saveBackupRecord(record)
    await gzipFile(snapshotPath, gzipPath)

    record.progress = 'uploading'
    saveBackupRecord(record)
    record.sizeBytes = await store.uploadObject(record.s3Key, gzipPath, 'application/gzip')

    record.status = 'completed'
    record.progress = null
    record.errorMessage = null
    record.finishedAt = new Date().toISOString()
    saveBackupRecord(record)
    return record
  } catch (error) {
    record.status = 'failed'
    record.progress = null
    record.errorMessage = error instanceof Error ? error.message : String(error)
    record.finishedAt = new Date().toISOString()
    saveBackupRecord(record)
    throw error
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
    void config
  }
}

async function createBackupNow(triggeredBy: BackupTrigger, expireDays = DEFAULT_RETAIN_DAYS) {
  acquireBackupSlot()
  try {
    const config = await getPrivateS3Config()
    assertS3Configured(config)
    const store = createObjectStore(config)
    const record = createBackupRecord(triggeredBy, expireDays, new Date(), config)
    saveBackupRecord(record)
    return await executeBackupRecord(record, config, store)
  } finally {
    releaseBackupSlot()
  }
}

async function executeRestoreRecord(record: BackupRecord, store: BackupObjectStore) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'gip-restore-'))
  const gzipPath = join(tempRoot, 'restore.db.gz')
  const restoredDbPath = join(tempRoot, 'restore.db')
  let preRestoreRecord: BackupRecord | null = null
  try {
    preRestoreRecord = await createBackupNow('pre_restore', DEFAULT_RETAIN_DAYS)
    await store.downloadObject(record.s3Key, gzipPath)
    await gunzipFile(gzipPath, restoredDbPath)
    validateRestoredDatabase(restoredDbPath)
    replaceDatabaseFile(restoredDbPath)
    if (preRestoreRecord) saveBackupRecord(preRestoreRecord)

    record.restoreStatus = 'completed'
    record.restoreError = null
    record.restoredAt = new Date().toISOString()
    saveBackupRecord(record)
  } catch (error) {
    record.restoreStatus = 'failed'
    record.restoreError = error instanceof Error ? error.message : String(error)
    saveBackupRecord(record)
    throw error
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

export function setBackupObjectStoreFactoryForTests(factory: ((config: BackupS3Config) => BackupObjectStore) | null) {
  testObjectStoreFactory = factory
}

export async function getPrivateS3Config() {
  const row = getDb().prepare('SELECT * FROM backup_s3_config WHERE id = ?').get('default') as BackupS3ConfigRow | undefined
  return row ? s3ConfigFromRow(row) : defaultS3ConfigFromRuntime()
}

export async function getBackupS3Config() {
  return publicS3Config(await getPrivateS3Config())
}

export async function updateBackupS3Config(input: Partial<BackupS3Config>) {
  const current = await getPrivateS3Config()
  const next: BackupS3Config = {
    endpoint: String(input.endpoint ?? current.endpoint ?? '').trim(),
    region: String(input.region ?? current.region ?? 'auto').trim() || 'auto',
    bucket: String(input.bucket ?? current.bucket ?? '').trim(),
    accessKeyId: String(input.accessKeyId ?? current.accessKeyId ?? '').trim(),
    secretAccessKey: String(input.secretAccessKey || current.secretAccessKey || ''),
    prefix: normalizePrefix(input.prefix ?? current.prefix),
    forcePathStyle: typeof input.forcePathStyle === 'boolean' ? input.forcePathStyle : Boolean(current.forcePathStyle),
  }
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO backup_s3_config (
      id,
      endpoint,
      region,
      bucket,
      access_key_id,
      secret_access_key,
      prefix,
      force_path_style,
      updated_at
    ) VALUES (
      'default',
      @endpoint,
      @region,
      @bucket,
      @accessKeyId,
      @secretAccessKey,
      @prefix,
      @forcePathStyle,
      @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      endpoint = excluded.endpoint,
      region = excluded.region,
      bucket = excluded.bucket,
      access_key_id = excluded.access_key_id,
      secret_access_key = excluded.secret_access_key,
      prefix = excluded.prefix,
      force_path_style = excluded.force_path_style,
      updated_at = excluded.updated_at
  `).run({
    endpoint: next.endpoint,
    region: next.region,
    bucket: next.bucket,
    accessKeyId: next.accessKeyId,
    secretAccessKey: next.secretAccessKey,
    prefix: next.prefix,
    forcePathStyle: next.forcePathStyle ? 1 : 0,
    updatedAt: now,
  })
  return publicS3Config(next)
}

export async function testBackupS3Connection(input: Partial<BackupS3Config>) {
  const current = await getPrivateS3Config()
  const config: BackupS3Config = {
    endpoint: String(input.endpoint ?? current.endpoint ?? '').trim(),
    region: String(input.region ?? current.region ?? 'auto').trim() || 'auto',
    bucket: String(input.bucket ?? current.bucket ?? '').trim(),
    accessKeyId: String(input.accessKeyId ?? current.accessKeyId ?? '').trim(),
    secretAccessKey: String(input.secretAccessKey || current.secretAccessKey || ''),
    prefix: normalizePrefix(input.prefix ?? current.prefix),
    forcePathStyle: typeof input.forcePathStyle === 'boolean' ? input.forcePathStyle : Boolean(current.forcePathStyle),
  }
  assertS3Configured(config)
  await createObjectStore(config).headBucket()
}

export async function getBackupSchedule() {
  const row = getDb().prepare('SELECT * FROM backup_schedule WHERE id = ?').get('default') as BackupScheduleRow | undefined
  return row ? scheduleFromRow(row) : defaultScheduleFromRuntime()
}

export async function updateBackupSchedule(input: Partial<BackupScheduleConfig>) {
  const current = await getBackupSchedule()
  const next: BackupScheduleConfig = {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
    cronExpr: String(input.cronExpr ?? current.cronExpr ?? DEFAULT_BACKUP_CRON).trim() || DEFAULT_BACKUP_CRON,
    timezone: String(input.timezone ?? current.timezone ?? DEFAULT_BACKUP_TIMEZONE).trim() || DEFAULT_BACKUP_TIMEZONE,
    retainDays: parseInteger(input.retainDays, current.retainDays, 0),
    retainCount: parseInteger(input.retainCount, current.retainCount, 0),
  }
  assertValidSchedule(next)
  getDb().prepare(`
    INSERT INTO backup_schedule (
      id,
      enabled,
      cron_expr,
      timezone,
      retain_days,
      retain_count,
      updated_at
    ) VALUES (
      'default',
      @enabled,
      @cronExpr,
      @timezone,
      @retainDays,
      @retainCount,
      @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      cron_expr = excluded.cron_expr,
      timezone = excluded.timezone,
      retain_days = excluded.retain_days,
      retain_count = excluded.retain_count,
      updated_at = excluded.updated_at
  `).run({
    enabled: next.enabled ? 1 : 0,
    cronExpr: next.cronExpr,
    timezone: next.timezone,
    retainDays: next.retainDays,
    retainCount: next.retainCount,
    updatedAt: new Date().toISOString(),
  })
  applyBackupSchedule(next)
  return next
}

export function stopBackupSchedule() {
  if (scheduledTask) {
    scheduledTask.stop()
    scheduledTask.destroy?.()
    scheduledTask = null
  }
}

export function applyBackupSchedule(schedule: BackupScheduleConfig) {
  stopBackupSchedule()
  if (!schedule.enabled) return
  assertValidSchedule(schedule)
  scheduledTask = cron.schedule(schedule.cronExpr, () => {
    void runScheduledBackup()
  }, {
    timezone: schedule.timezone || DEFAULT_BACKUP_TIMEZONE,
  })
}

export async function loadAndApplyBackupSchedule() {
  applyBackupSchedule(await getBackupSchedule())
}

export async function startBackup(triggeredBy: BackupTrigger = 'manual', expireDays = DEFAULT_RETAIN_DAYS) {
  acquireBackupSlot()
  let launched = false
  try {
    const config = await getPrivateS3Config()
    assertS3Configured(config)
    const record = createBackupRecord(triggeredBy, expireDays, new Date(), config)
    saveBackupRecord(record)
    launched = true
    void executeBackupRecord(record, config, createObjectStore(config))
      .catch((error) => {
        console.error('[backup] backup failed:', error)
      })
      .finally(() => releaseBackupSlot())
    return record
  } finally {
    if (!launched) releaseBackupSlot()
  }
}

export async function runScheduledBackup() {
  const schedule = await getBackupSchedule()
  if (!schedule.enabled) return null
  try {
    const record = await createBackupNow('scheduled', schedule.retainDays)
    await cleanupOldBackups(schedule)
    return record
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 409) {
      console.error('[backup] scheduled backup failed:', error)
    }
    return null
  }
}

export async function listBackupRecords() {
  const rows = getDb()
    .prepare('SELECT * FROM backup_records ORDER BY started_at DESC')
    .all() as BackupRecordRow[]
  return rows.map(recordFromRow)
}

export async function getBackupRecord(id: string) {
  const row = getDb().prepare('SELECT * FROM backup_records WHERE id = ?').get(id) as BackupRecordRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: '备份记录不存在' })
  return recordFromRow(row)
}

export async function deleteBackup(id: string) {
  const record = await getBackupRecord(id)
  if (record.status === 'completed' && record.s3Key) {
    try {
      const config = await getPrivateS3Config()
      if (isS3Configured(config)) await createObjectStore(config).deleteObject(record.s3Key)
    } catch (error) {
      console.error('[backup] delete S3 object failed:', error)
    }
  }
  deleteBackupRecord(id)
}

export async function getBackupDownloadUrl(id: string) {
  const record = await getBackupRecord(id)
  if (record.status !== 'completed') {
    throw createError({ statusCode: 400, statusMessage: '只能下载已完成的备份' })
  }
  const config = await getPrivateS3Config()
  assertS3Configured(config)
  return createObjectStore(config).getDownloadUrl(record.s3Key, DOWNLOAD_URL_TTL_SECONDS)
}

export async function startRestoreBackup(id: string, confirmationId: string) {
  if (confirmationId !== id) {
    throw createError({ statusCode: 400, statusMessage: '备份 ID 确认不匹配' })
  }
  acquireRestoreSlot()
  let launched = false
  try {
    const record = await getBackupRecord(id)
    if (record.status !== 'completed') {
      throw createError({ statusCode: 400, statusMessage: '只能从已完成的备份恢复' })
    }
    const config = await getPrivateS3Config()
    assertS3Configured(config)
    record.restoreStatus = 'running'
    record.restoreError = null
    record.restoredAt = null
    saveBackupRecord(record)
    launched = true
    void executeRestoreRecord(record, createObjectStore(config))
      .catch((error) => {
        console.error('[backup] restore failed:', error)
      })
      .finally(() => releaseRestoreSlot())
    return record
  } finally {
    if (!launched) releaseRestoreSlot()
  }
}

export async function restoreBackupNowForTests(id: string, confirmationId: string) {
  if (confirmationId !== id) {
    throw createError({ statusCode: 400, statusMessage: '备份 ID 确认不匹配' })
  }
  acquireRestoreSlot()
  try {
    const record = await getBackupRecord(id)
    if (record.status !== 'completed') {
      throw createError({ statusCode: 400, statusMessage: '只能从已完成的备份恢复' })
    }
    const config = await getPrivateS3Config()
    assertS3Configured(config)
    record.restoreStatus = 'running'
    record.restoreError = null
    record.restoredAt = null
    saveBackupRecord(record)
    await executeRestoreRecord(record, createObjectStore(config))
    return await getBackupRecord(id)
  } finally {
    releaseRestoreSlot()
  }
}

export async function createBackupNowForTests(triggeredBy: BackupTrigger = 'manual', expireDays = DEFAULT_RETAIN_DAYS) {
  return createBackupNow(triggeredBy, expireDays)
}

export function recoverStaleBackupRecords() {
  const now = new Date().toISOString()
  getDb().prepare(`
    UPDATE backup_records
    SET status = 'failed',
        progress = NULL,
        error_message = COALESCE(error_message, 'interrupted by server restart'),
        finished_at = COALESCE(finished_at, @now)
    WHERE status = 'running'
  `).run({ now })
  getDb().prepare(`
    UPDATE backup_records
    SET restore_status = 'failed',
        restore_error = COALESCE(restore_error, 'interrupted by server restart')
    WHERE restore_status = 'running'
  `).run()
}

export async function cleanupOldBackups(schedule: BackupScheduleConfig) {
  if (!schedule.retainCount && !schedule.retainDays) return
  const records = await listBackupRecords()
  const completed = records.filter((record) => record.status === 'completed')
  const toDelete = new Set<string>()
  const now = Date.now()

  if (schedule.retainCount > 0) {
    completed.slice(schedule.retainCount).forEach((record) => toDelete.add(record.id))
  }

  if (schedule.retainDays > 0) {
    const maxAgeMs = schedule.retainDays * 24 * 60 * 60 * 1000
    for (const record of completed) {
      if (now - Date.parse(record.startedAt) > maxAgeMs) toDelete.add(record.id)
    }
  }

  for (const id of toDelete) {
    await deleteBackup(id)
  }
}
