import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { getAppDataRoot, resolveConfiguredPath } from './file-store'

type Statement = {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint }
}

type SqliteDatabase = {
  open: boolean
  exec: (source: string) => SqliteDatabase
  prepare: (source: string) => Statement
  pragma: (source: string) => unknown
  transaction: <T extends (...params: never[]) => unknown>(fn: T) => T
  backup: (destinationFile: string, options?: { progress?: (info: { totalPages: number; remainingPages: number }) => number }) => Promise<{ totalPages: number; remainingPages: number }>
  close: () => SqliteDatabase
}

type DatabaseConstructor = new (filename: string) => SqliteDatabase

const SqliteDatabase = Database as unknown as DatabaseConstructor

let activeDb: SqliteDatabase | null = null
let activePath: string | null = null
let testPath: string | null = null

function getRuntimeConfigValue(key: string) {
  try {
    return (useRuntimeConfig() as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

export function getDatabasePath() {
  if (testPath) return testPath
  const configured = String(getRuntimeConfigValue('dbPath') || '')
  if (configured.trim()) return resolveConfiguredPath(configured)
  return join(getAppDataRoot(), 'app.db')
}

function initSchema(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_account TEXT,
      user_email TEXT,
      user_username TEXT,
      user_name TEXT,
      user_avatar_url TEXT,
      user_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
      ON sessions (expires_at);

    CREATE TABLE IF NOT EXISTS admin_settings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      timeout INTEGER NOT NULL,
      api_mode TEXT NOT NULL,
      codex_cli INTEGER NOT NULL,
      premium_provider TEXT NOT NULL,
      premium_base_url TEXT NOT NULL,
      premium_api_key TEXT NOT NULL,
      premium_model TEXT NOT NULL,
      premium_timeout INTEGER NOT NULL,
      premium_api_mode TEXT NOT NULL,
      premium_codex_cli INTEGER NOT NULL,
      daily_points_target INTEGER NOT NULL DEFAULT 100,
      standard_point_cost INTEGER NOT NULL DEFAULT 1,
      premium_point_cost INTEGER NOT NULL DEFAULT 300,
      gallery_upload_default INTEGER NOT NULL DEFAULT 0,
      hourly_image_limit INTEGER NOT NULL,
      privacy_hourly_image_limit INTEGER NOT NULL,
      service_concurrent_image_limit INTEGER NOT NULL,
      user_concurrent_image_limit INTEGER NOT NULL,
      gallery_upload_url TEXT NOT NULL,
      gallery_upload_token TEXT NOT NULL,
      models_json TEXT,
      default_model_id TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_points (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL,
      last_daily_refill_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS point_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS point_ledger_user_created_at_idx
      ON point_ledger (user_id, created_at);

    CREATE TABLE IF NOT EXISTS redeem_codes (
      code TEXT PRIMARY KEY,
      points INTEGER NOT NULL,
      created_by_user_id TEXT NOT NULL,
      redeemed_by_user_id TEXT,
      created_at TEXT NOT NULL,
      redeemed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS redeem_codes_redeemed_by_idx
      ON redeem_codes (redeemed_by_user_id);

    CREATE TABLE IF NOT EXISTS generation_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      image_count INTEGER NOT NULL,
      privacy_mode INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS generation_usage_user_privacy_created_at_idx
      ON generation_usage (user_id, privacy_mode, created_at);

    CREATE TABLE IF NOT EXISTS generation_audits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_account TEXT,
      user_email TEXT,
      user_username TEXT,
      user_name TEXT,
      prompt TEXT NOT NULL,
      params_json TEXT NOT NULL,
      requested_image_count INTEGER NOT NULL,
      input_image_count INTEGER NOT NULL,
      mask_used INTEGER NOT NULL,
      api_provider TEXT NOT NULL,
      api_model TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      audit_save_error TEXT,
      actual_params_json TEXT,
      revised_prompts_json TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      elapsed INTEGER
    );

    CREATE INDEX IF NOT EXISTS generation_audits_created_at_idx
      ON generation_audits (created_at);

    CREATE INDEX IF NOT EXISTS generation_audits_user_created_at_idx
      ON generation_audits (user_id, created_at);

    CREATE TABLE IF NOT EXISTS generation_audit_images (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (audit_id) REFERENCES generation_audits(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS generation_audit_images_audit_id_idx
      ON generation_audit_images (audit_id);

    CREATE TABLE IF NOT EXISTS backup_s3_config (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      region TEXT NOT NULL,
      bucket TEXT NOT NULL,
      access_key_id TEXT NOT NULL,
      secret_access_key TEXT NOT NULL,
      prefix TEXT NOT NULL,
      force_path_style INTEGER NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_schedule (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      cron_expr TEXT NOT NULL,
      timezone TEXT NOT NULL,
      retain_days INTEGER NOT NULL,
      retain_count INTEGER NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      backup_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      triggered_by TEXT NOT NULL,
      progress TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      expires_at TEXT,
      restore_status TEXT,
      restore_error TEXT,
      restored_at TEXT
    );

    CREATE INDEX IF NOT EXISTS backup_records_started_at_idx
      ON backup_records (started_at);
  `)

  const auditColumns = new Set(
    (db.prepare('PRAGMA table_info(generation_audits)').all() as Array<{ name: string }>).map((column) => column.name),
  )
  if (!auditColumns.has('user_username')) {
    db.exec('ALTER TABLE generation_audits ADD COLUMN user_username TEXT')
  }
  if (!auditColumns.has('user_name')) {
    db.exec('ALTER TABLE generation_audits ADD COLUMN user_name TEXT')
  }

  const adminSettingColumns = new Set(
    (db.prepare('PRAGMA table_info(admin_settings)').all() as Array<{ name: string }>).map((column) => column.name),
  )
  if (!adminSettingColumns.has('privacy_hourly_image_limit')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN privacy_hourly_image_limit INTEGER NOT NULL DEFAULT 5')
  }
  if (!adminSettingColumns.has('service_concurrent_image_limit')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN service_concurrent_image_limit INTEGER NOT NULL DEFAULT 3')
  }
  if (!adminSettingColumns.has('user_concurrent_image_limit')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN user_concurrent_image_limit INTEGER NOT NULL DEFAULT 3')
  }
  if (!adminSettingColumns.has('premium_provider')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN premium_provider TEXT NOT NULL DEFAULT 'openai'")
  }
  if (!adminSettingColumns.has('premium_base_url')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN premium_base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1'")
  }
  if (!adminSettingColumns.has('premium_api_key')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN premium_api_key TEXT NOT NULL DEFAULT ''")
  }
  if (!adminSettingColumns.has('premium_model')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN premium_model TEXT NOT NULL DEFAULT 'gpt-image-2'")
  }
  if (!adminSettingColumns.has('premium_timeout')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN premium_timeout INTEGER NOT NULL DEFAULT 600')
  }
  if (!adminSettingColumns.has('premium_api_mode')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN premium_api_mode TEXT NOT NULL DEFAULT 'images'")
  }
  if (!adminSettingColumns.has('premium_codex_cli')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN premium_codex_cli INTEGER NOT NULL DEFAULT 0')
  }
  if (!adminSettingColumns.has('daily_points_target')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN daily_points_target INTEGER NOT NULL DEFAULT 100')
  }
  if (!adminSettingColumns.has('standard_point_cost')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN standard_point_cost INTEGER NOT NULL DEFAULT 1')
  }
  if (!adminSettingColumns.has('premium_point_cost')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN premium_point_cost INTEGER NOT NULL DEFAULT 300')
  }
  if (!adminSettingColumns.has('gallery_upload_default')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN gallery_upload_default INTEGER NOT NULL DEFAULT 0')
  }
  if (!adminSettingColumns.has('gallery_upload_url')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN gallery_upload_url TEXT NOT NULL DEFAULT 'https://imglist.zrbyhelp.com/api/uploads/third-party'")
  }
  if (!adminSettingColumns.has('gallery_upload_token')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN gallery_upload_token TEXT NOT NULL DEFAULT ''")
  }
  if (!adminSettingColumns.has('models_json')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN models_json TEXT')
  }
  if (!adminSettingColumns.has('default_model_id')) {
    db.exec('ALTER TABLE admin_settings ADD COLUMN default_model_id TEXT')
  }
}

export function getDb() {
  const dbPath = getDatabasePath()
  if (activeDb?.open && activePath === dbPath) return activeDb
  if (activeDb?.open) activeDb.close()

  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new SqliteDatabase(dbPath)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  initSchema(db)

  activeDb = db
  activePath = dbPath
  return db
}

export function closeDbForTests() {
  if (activeDb?.open) activeDb.close()
  activeDb = null
  activePath = null
}

export function setDatabasePathForTests(dbPath: string | null) {
  closeDbForTests()
  testPath = dbPath
}

export async function backupDatabaseTo(destinationFile: string) {
  const db = getDb()
  mkdirSync(dirname(destinationFile), { recursive: true })
  await db.backup(destinationFile)
}

export function replaceDatabaseFile(sourceFile: string) {
  const dbPath = getDatabasePath()
  closeDbForTests()
  mkdirSync(dirname(dbPath), { recursive: true })
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  rmSync(dbPath, { force: true })
  copyFileSync(sourceFile, dbPath)
  rmSync(sourceFile, { force: true })
  getDb()
}
