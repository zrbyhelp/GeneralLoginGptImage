import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
  close: () => SqliteDatabase
}

type DatabaseConstructor = new (filename: string) => SqliteDatabase

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as DatabaseConstructor

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
      hourly_image_limit INTEGER NOT NULL,
      privacy_hourly_image_limit INTEGER NOT NULL,
      gallery_upload_url TEXT NOT NULL,
      gallery_upload_token TEXT NOT NULL,
      updated_at TEXT
    );

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
  if (!adminSettingColumns.has('gallery_upload_url')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN gallery_upload_url TEXT NOT NULL DEFAULT 'https://imglist.zrbyhelp.com/api/uploads/third-party'")
  }
  if (!adminSettingColumns.has('gallery_upload_token')) {
    db.exec("ALTER TABLE admin_settings ADD COLUMN gallery_upload_token TEXT NOT NULL DEFAULT ''")
  }
}

export function getDb() {
  const dbPath = getDatabasePath()
  if (activeDb?.open && activePath === dbPath) return activeDb
  if (activeDb?.open) activeDb.close()

  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
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
