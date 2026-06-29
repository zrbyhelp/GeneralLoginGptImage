import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPENAI_TIERED_PRICING_RULES } from '../../src/lib/pricing'
import { updateAdminSettings } from './admin-settings'
import {
  cleanupOldBackups,
  createBackupNowForTests,
  deleteBackup,
  getBackupS3Config,
  getBackupSchedule,
  getPrivateS3Config,
  importBackupRecordsFromR2,
  listBackupRecords,
  restoreUploadedBackupNow,
  restoreBackupNowForTests,
  setBackupObjectStoreFactoryForTests,
  stopBackupSchedule,
  updateBackupS3Config,
  updateBackupSchedule,
  type BackupObjectStore,
  type BackupObjectInfo,
  type BackupS3Config,
} from './backup'
import { closeDbForTests, getDb, setDatabasePathForTests } from './db'

type TestDatabase = {
  prepare: (source: string) => {
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
  }
  close: () => void
}

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (filename: string, options?: { readonly?: boolean }) => TestDatabase

class MemoryObjectStore implements BackupObjectStore {
  objects = new Map<string, Buffer>()
  objectInfo = new Map<string, BackupObjectInfo>()
  deletedKeys: string[] = []
  headBucketCalls = 0

  async uploadObject(key: string, filePath: string) {
    const bytes = readFileSync(filePath)
    this.objects.set(key, bytes)
    this.objectInfo.set(key, {
      key,
      sizeBytes: bytes.byteLength,
      lastModified: new Date(),
    })
    return bytes.byteLength
  }

  async downloadObject(key: string, destinationPath: string) {
    const bytes = this.objects.get(key)
    if (!bytes) throw new Error(`missing object: ${key}`)
    await writeFile(destinationPath, bytes)
    return bytes.byteLength
  }

  async deleteObject(key: string) {
    this.deletedKeys.push(key)
    this.objects.delete(key)
    this.objectInfo.delete(key)
  }

  async getDownloadUrl(key: string) {
    return `memory://${key}`
  }

  async headBucket() {
    this.headBucketCalls += 1
  }

  async listObjects(prefix: string) {
    return Array.from(this.objectInfo.values()).filter((object) => object.key.startsWith(prefix))
  }
}

let tempRoot = ''
let objectStore: MemoryObjectStore

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'gip-backup-test-'))
  setDatabasePathForTests(join(tempRoot, 'app.db'))
  objectStore = new MemoryObjectStore()
  setBackupObjectStoreFactoryForTests((_config: BackupS3Config) => objectStore)
  vi.stubGlobal('useRuntimeConfig', () => ({
    apiProvider: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: 'env-key',
    apiModel: 'gpt-image-2',
    apiMode: 'images',
    apiTimeout: '600',
    apiCodexCli: 'false',
    defaultHourlyImageLimit: '20',
    defaultPrivacyHourlyImageLimit: '5',
    defaultServiceConcurrentImageLimit: '3',
    defaultUserConcurrentImageLimit: '3',
    defaultDailyPointsTarget: '100',
    defaultStandardPointCost: '1',
    defaultGalleryUploadDefault: 'false',
    galleryUploadUrl: 'https://imglist.example.com/api/uploads/third-party',
    galleryUploadToken: '',
    appDataDir: tempRoot,
    storageDir: join(tempRoot, 'generated-images'),
    backupS3Endpoint: 'https://r2.example.com',
    backupS3Region: 'auto',
    backupS3Bucket: 'bucket',
    backupS3AccessKeyId: 'runtime-access',
    backupS3SecretAccessKey: 'runtime-secret',
    backupS3Prefix: 'backups',
    backupS3ForcePathStyle: 'false',
    backupScheduleEnabled: 'false',
    backupScheduleCron: '0 2 * * *',
    backupScheduleTimezone: 'Asia/Shanghai',
    backupScheduleRetainDays: '14',
    backupScheduleRetainCount: '10',
  }))
})

afterEach(() => {
  stopBackupSchedule()
  closeDbForTests()
  setBackupObjectStoreFactoryForTests(null)
  vi.unstubAllGlobals()
  rmSync(tempRoot, { recursive: true, force: true })
})

function seedServerData() {
  const db = getDb()
  db.prepare(`
    INSERT INTO sessions (
      token_hash,
      user_id,
      user_account,
      user_email,
      user_username,
      user_name,
      user_avatar_url,
      user_status,
      created_at,
      last_seen_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'token-hash',
    'user-a',
    'account-a',
    'user@example.com',
    'tester',
    'Tester',
    null,
    'ACTIVE',
    '2026-06-29T00:00:00.000Z',
    '2026-06-29T00:00:00.000Z',
    '2026-07-29T00:00:00.000Z',
  )
  db.prepare(`
    INSERT INTO user_points (
      user_id,
      balance,
      last_daily_refill_date,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run('user-a', 321, '2026-06-29', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z')
}

function readSnapshotTables(bytes: Buffer) {
  const snapshotPath = join(tempRoot, 'snapshot-read.db')
  rmSync(snapshotPath, { force: true })
  rmSync(`${snapshotPath}-wal`, { force: true })
  rmSync(`${snapshotPath}-shm`, { force: true })
  const unzipped = gunzipSync(bytes)
  require('node:fs').writeFileSync(snapshotPath, unzipped)
  const db = new Database(snapshotPath, { readonly: true })
  try {
    return {
      tables: (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
      adminSettings: db.prepare('SELECT * FROM admin_settings').all(),
      sessions: db.prepare('SELECT * FROM sessions').all(),
      userPoints: db.prepare('SELECT * FROM user_points').all(),
    }
  } finally {
    db.close()
  }
}

describe('server backup service', () => {
  it('hides S3 secrets and keeps the existing secret when an update leaves it blank', async () => {
    await updateBackupS3Config({
      endpoint: 'https://r2.example.com',
      region: 'auto',
      bucket: 'bucket-a',
      accessKeyId: 'access-a',
      secretAccessKey: 'secret-a',
      prefix: 'custom',
      forcePathStyle: true,
    })

    const publicConfig = await getBackupS3Config()
    expect(publicConfig.secretAccessKey).toBe('')
    expect(publicConfig.secretAccessKeyConfigured).toBe(true)

    await updateBackupS3Config({
      bucket: 'bucket-b',
      accessKeyId: 'access-b',
      secretAccessKey: '',
    })

    const privateConfig = await getPrivateS3Config()
    expect(privateConfig.bucket).toBe('bucket-b')
    expect(privateConfig.accessKeyId).toBe('access-b')
    expect(privateConfig.secretAccessKey).toBe('secret-a')
  })

  it('creates a gzip SQLite backup that contains config, sessions, and user point data', async () => {
    seedServerData()
    await updateAdminSettings({
      models: [{
        id: 'model-a',
        name: 'Model A',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'db-key',
        model: 'gpt-image-2',
        timeout: 600,
        apiMode: 'images',
        codexCompatible: false,
        enabled: true,
        pricingMode: 'flat',
        pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
      }],
      defaultModelId: 'model-a',
    })

    const record = await createBackupNowForTests('manual', 14)
    const uploaded = objectStore.objects.get(record.s3Key)
    expect(uploaded).toBeTruthy()
    expect(record.status).toBe('completed')
    expect(record.sizeBytes).toBe(uploaded?.byteLength)

    const snapshot = readSnapshotTables(uploaded as Buffer)
    expect(snapshot.tables).toEqual(expect.arrayContaining(['admin_settings', 'sessions', 'user_points', 'backup_records']))
    expect(snapshot.adminSettings).toHaveLength(1)
    expect(snapshot.sessions).toMatchObject([{ user_id: 'user-a', token_hash: 'token-hash' }])
    expect(snapshot.userPoints).toMatchObject([{ user_id: 'user-a', balance: 321 }])
  })

  it('restores a backup, preserves backed-up sessions, and creates a pre-restore safety backup record', async () => {
    seedServerData()
    const original = await createBackupNowForTests('manual', 14)

    getDb().prepare('UPDATE user_points SET balance = ? WHERE user_id = ?').run(1, 'user-a')
    getDb().prepare('DELETE FROM sessions').run()

    const restored = await restoreBackupNowForTests(original.id, original.id)

    expect(restored.restoreStatus).toBe('completed')
    const point = getDb().prepare('SELECT balance FROM user_points WHERE user_id = ?').get('user-a') as { balance: number }
    const session = getDb().prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get('user-a') as { token_hash: string }
    expect(point.balance).toBe(321)
    expect(session.token_hash).toBe('token-hash')
    expect((await listBackupRecords()).some((record) => record.triggeredBy === 'pre_restore' && record.status === 'completed')).toBe(true)
  })

  it('rejects restore when the confirmation id does not match', async () => {
    seedServerData()
    const record = await createBackupNowForTests('manual', 14)
    await expect(restoreBackupNowForTests(record.id, 'wrong-id')).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('rejects invalid cron and applies valid schedule defaults', async () => {
    await expect(updateBackupSchedule({ enabled: true, cronExpr: 'not cron' })).rejects.toMatchObject({
      statusCode: 400,
    })

    const schedule = await updateBackupSchedule({
      enabled: true,
      cronExpr: '0 3 * * *',
      timezone: 'Asia/Shanghai',
      retainDays: 7,
      retainCount: 2,
    })
    expect(schedule).toMatchObject({
      enabled: true,
      cronExpr: '0 3 * * *',
      retainDays: 7,
      retainCount: 2,
    })
    expect(await getBackupSchedule()).toMatchObject(schedule)
  })

  it('cleans completed backups by retain count', async () => {
    seedServerData()
    const first = await createBackupNowForTests('manual', 14)
    getDb().prepare('UPDATE backup_records SET started_at = ? WHERE id = ?').run('2026-06-28T00:00:00.000Z', first.id)
    const second = await createBackupNowForTests('manual', 14)
    expect(objectStore.objects.has(first.s3Key)).toBe(true)
    expect(objectStore.objects.has(second.s3Key)).toBe(true)

    await cleanupOldBackups({
      enabled: true,
      cronExpr: '0 2 * * *',
      timezone: 'Asia/Shanghai',
      retainDays: 0,
      retainCount: 1,
    })

    const records = await listBackupRecords()
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe(second.id)
    expect(objectStore.objects.has(first.s3Key)).toBe(false)
    expect(objectStore.objects.has(second.s3Key)).toBe(true)
  })

  it('imports valid R2 backup objects and updates duplicate records by key', async () => {
    seedServerData()
    const backup = await createBackupNowForTests('manual', 14)
    const bytes = objectStore.objects.get(backup.s3Key) as Buffer
    const importKey = 'backups/2026/06/29/gpt-image-playground-sqlite-20260629_010203-imported.db.gz'
    objectStore.objects.set(importKey, bytes)
    objectStore.objectInfo.set(importKey, {
      key: importKey,
      sizeBytes: bytes.byteLength,
      lastModified: new Date('2026-06-29T01:02:03.000Z'),
    })
    objectStore.objectInfo.set('backups/2026/06/29/not-a-backup.txt', {
      key: 'backups/2026/06/29/not-a-backup.txt',
      sizeBytes: 10,
      lastModified: new Date('2026-06-29T01:02:04.000Z'),
    })

    getDb().prepare('DELETE FROM backup_records').run()
    objectStore.objectInfo.delete(backup.s3Key)
    const first = await importBackupRecordsFromR2()
    expect(first.imported).toBe(1)
    expect(first.updated).toBe(0)
    expect(first.skipped).toBe(1)
    expect(first.items[0]).toMatchObject({
      s3Key: importKey,
      triggeredBy: 'imported',
      status: 'completed',
      startedAt: '2026-06-29T01:02:03.000Z',
    })

    objectStore.objectInfo.set(importKey, {
      key: importKey,
      sizeBytes: bytes.byteLength + 7,
      lastModified: new Date('2026-06-30T01:02:03.000Z'),
    })
    const second = await importBackupRecordsFromR2()
    expect(second.imported).toBe(0)
    expect(second.updated).toBe(1)
    const records = await listBackupRecords()
    expect(records.filter((record) => record.s3Key === importKey)).toHaveLength(1)
    expect(records.find((record) => record.s3Key === importKey)?.sizeBytes).toBe(bytes.byteLength + 7)
  })

  it('restores an imported R2 record and deletes the imported object when deleted', async () => {
    seedServerData()
    const backup = await createBackupNowForTests('manual', 14)
    const bytes = objectStore.objects.get(backup.s3Key) as Buffer
    const importKey = 'backups/2026/06/29/gpt-image-playground-sqlite-20260629_020304-imported.db.gz'
    objectStore.objects.set(importKey, bytes)
    objectStore.objectInfo.set(importKey, {
      key: importKey,
      sizeBytes: bytes.byteLength,
      lastModified: new Date('2026-06-29T02:03:04.000Z'),
    })
    getDb().prepare('DELETE FROM backup_records').run()
    const imported = (await importBackupRecordsFromR2()).items.find((record) => record.s3Key === importKey)
    expect(imported).toBeTruthy()

    getDb().prepare('UPDATE user_points SET balance = ? WHERE user_id = ?').run(9, 'user-a')
    const restored = await restoreBackupNowForTests(imported!.id, imported!.id)
    expect(restored.restoreStatus).toBe('completed')
    expect((getDb().prepare('SELECT balance FROM user_points WHERE user_id = ?').get('user-a') as { balance: number }).balance).toBe(321)
    expect(objectStore.objects.has(importKey)).toBe(true)

    await deleteBackup(imported!.id)
    expect(objectStore.deletedKeys).toContain(importKey)
  })

  it('restores an uploaded gzip backup and creates a pre-restore safety backup', async () => {
    seedServerData()
    const original = await createBackupNowForTests('manual', 14)
    const uploadPath = join(tempRoot, 'upload.db.gz')
    await writeFile(uploadPath, objectStore.objects.get(original.s3Key) as Buffer)

    getDb().prepare('UPDATE user_points SET balance = ? WHERE user_id = ?').run(2, 'user-a')
    const result = await restoreUploadedBackupNow({
      filePath: uploadPath,
      fileName: 'gpt-image-playground-sqlite-upload.db.gz',
      sizeBytes: (await stat(uploadPath)).size,
      confirmationFileName: 'gpt-image-playground-sqlite-upload.db.gz',
    })

    expect(result.ok).toBe(true)
    expect(result.preRestoreBackupId).toMatch(/^bkp_/)
    expect((getDb().prepare('SELECT balance FROM user_points WHERE user_id = ?').get('user-a') as { balance: number }).balance).toBe(321)
    expect((await listBackupRecords()).some((record) => record.id === result.preRestoreBackupId && record.triggeredBy === 'pre_restore')).toBe(true)
  })

  it('rejects invalid uploaded backup requests without replacing the current database', async () => {
    seedServerData()
    const before = (getDb().prepare('SELECT balance FROM user_points WHERE user_id = ?').get('user-a') as { balance: number }).balance
    const badPath = join(tempRoot, 'bad.db.gz')
    await writeFile(badPath, Buffer.from('not gzip'))

    await expect(restoreUploadedBackupNow({
      filePath: badPath,
      fileName: 'bad.txt',
      sizeBytes: 8,
      confirmationFileName: 'bad.txt',
    })).rejects.toMatchObject({ statusCode: 400 })

    await expect(restoreUploadedBackupNow({
      filePath: badPath,
      fileName: 'bad.db.gz',
      sizeBytes: 8,
      confirmationFileName: 'wrong.db.gz',
    })).rejects.toMatchObject({ statusCode: 400 })

    await expect(restoreUploadedBackupNow({
      filePath: badPath,
      fileName: 'bad.db.gz',
      sizeBytes: 8,
      confirmationFileName: 'bad.db.gz',
    })).rejects.toBeTruthy()

    const after = (getDb().prepare('SELECT balance FROM user_points WHERE user_id = ?').get('user-a') as { balance: number }).balance
    expect(after).toBe(before)
  })
})
