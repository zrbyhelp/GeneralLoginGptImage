import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskParams } from '../../src/types'
import { DEFAULT_OPENAI_TIERED_PRICING_RULES } from '../../src/lib/pricing'
import { getAdminSettings, updateAdminSettings } from './admin-settings'
import { buildAuditExportZip } from './audit-export'
import {
  createAuditId,
  countRecentRequestedImages,
  createAudit,
  createCompletedAudit,
  deleteAllAudits,
  deleteAudit,
  findAuditImage,
  readCompletedAudits,
  readAudits,
  updateAudit,
  type GenerationAuditImage,
} from './audits'
import { setDatabasePathForTests } from './db'
import { countRecentGeneratedImages, recordGenerationUsage } from './generation-usage'

type TestDatabase = {
  exec: (source: string) => void
  close: () => void
}

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (filename: string) => TestDatabase

const params: TaskParams = {
  size: '1024x1024',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 2,
}

let tempRoot = ''

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'gip-sqlite-'))
  setDatabasePathForTests(join(tempRoot, 'app.db'))
  vi.stubGlobal('useRuntimeConfig', () => ({
    apiProvider: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: 'env-key',
    apiModel: 'gpt-image-2',
    apiMode: 'images',
    apiTimeout: '600',
    apiCodexCli: 'false',
    defaultHourlyImageLimit: '20',
    defaultServiceConcurrentImageLimit: '3',
    defaultUserConcurrentImageLimit: '3',
    appDataDir: tempRoot,
    storageDir: join(tempRoot, 'generated-images'),
  }))
})

afterEach(() => {
  setDatabasePathForTests(null)
  vi.unstubAllGlobals()
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('SQLite-backed server storage', () => {
  it('persists admin settings without writing JSON files', async () => {
    expect((await getAdminSettings()).models[0].apiKey).toBe('env-key')

    await updateAdminSettings({
      models: [{
        id: 'custom-model',
        name: 'Custom',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'db-key',
        model: 'custom-image-model',
        apiMode: 'responses',
        codexCompatible: true,
        timeout: 600,
        enabled: true,
        pricingMode: 'flat',
        pricingRules: DEFAULT_OPENAI_TIERED_PRICING_RULES,
      }],
      defaultModelId: 'custom-model',
      hourlyImageLimit: 7,
      privacyHourlyImageLimit: 3,
      serviceConcurrentImageLimit: 4,
      userConcurrentImageLimit: 2,
      galleryUploadUrl: 'https://imglist.example.com/api/uploads/third-party',
      galleryUploadToken: 'upload-token',
    })

    setDatabasePathForTests(join(tempRoot, 'app.db'))
    const persisted = await getAdminSettings()

    expect(persisted.models[0]).toMatchObject({
      id: 'custom-model',
      apiKey: 'db-key',
      model: 'custom-image-model',
      apiMode: 'responses',
      codexCompatible: true,
    })
    expect(persisted.defaultModelId).toBe('custom-model')
    expect(persisted.hourlyImageLimit).toBe(7)
    expect(persisted.privacyHourlyImageLimit).toBe(3)
    expect(persisted.serviceConcurrentImageLimit).toBe(4)
    expect(persisted.userConcurrentImageLimit).toBe(2)
    expect(persisted.galleryUploadUrl).toBe('https://imglist.example.com/api/uploads/third-party')
    expect(persisted.galleryUploadToken).toBe('upload-token')
    expect(readdirSync(tempRoot).filter((fileName) => fileName.endsWith('.json'))).toEqual([])
  })

  it('tracks generation usage without prompt or image file metadata', async () => {
    await recordGenerationUsage({ userId: 'user-usage', imageCount: 2, privacyMode: false })
    await recordGenerationUsage({ userId: 'user-usage', imageCount: 3, privacyMode: true })
    await recordGenerationUsage({ userId: 'user-other', imageCount: 5, privacyMode: true })

    expect(await countRecentGeneratedImages('user-usage', false)).toBe(2)
    expect(await countRecentGeneratedImages('user-usage', true)).toBe(3)

    const db = new Database(join(tempRoot, 'app.db')) as unknown as {
      prepare: (source: string) => { all: () => Array<Record<string, unknown>> }
      close: () => void
    }
    const usageColumns = db.prepare('PRAGMA table_info(generation_usage)').all().map((column) => String(column.name))
    db.close()

    expect(usageColumns).toEqual(['id', 'user_id', 'image_count', 'privacy_mode', 'created_at'])
  })

  it('migrates legacy audit tables to include username and name', async () => {
    const legacyDb = new Database(join(tempRoot, 'app.db'))
    legacyDb.exec(`
      CREATE TABLE generation_audits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_account TEXT,
        user_email TEXT,
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
    `)
    legacyDb.close()

    const audit = await createCompletedAudit({
      user: {
        id: 'legacy-user',
        account: null,
        email: null,
        username: 'legacy-name',
        name: 'Legacy User',
        avatarUrl: null,
        status: 'ACTIVE',
      },
      prompt: 'legacy migration',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: [],
    })

    const audits = await readAudits()

    expect(audits[0]).toMatchObject({
      id: audit.id,
      userUsername: 'legacy-name',
      userName: 'Legacy User',
    })
  })

  it('persists generation audits and image file metadata in SQLite', async () => {
    const auditId = createAuditId()
    const image: GenerationAuditImage = {
      id: 'img_test',
      auditId,
      fileName: 'image.png',
      relativePath: '20260503/image.png',
      mime: 'image/png',
      size: 1234,
      hash: 'hash',
      createdAt: new Date().toISOString(),
    }
    const secondImage: GenerationAuditImage = {
      id: 'img_test_2',
      auditId,
      fileName: 'image-2.png',
      relativePath: '20260503/image-2.png',
      mime: 'image/png',
      size: 2345,
      hash: 'hash-2',
      createdAt: new Date().toISOString(),
    }
    const audit = await createCompletedAudit({
      id: auditId,
      user: {
        id: 'user-1',
        account: 'q19946502',
        email: 'user@example.com',
        username: 'tester',
        name: 'Tester',
        avatarUrl: null,
        status: 'ACTIVE',
      },
      prompt: 'test prompt',
      params,
      requestedImageCount: 2,
      inputImageCount: 1,
      maskUsed: true,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: [image, secondImage],
      actualParams: { size: '1024x1024' },
      revisedPrompts: ['revised prompt'],
      finishedAt: new Date().toISOString(),
      elapsed: 321,
    })

    const audits = await readAudits()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      id: audit.id,
      userId: 'user-1',
      userAccount: 'q19946502',
      userEmail: 'user@example.com',
      userUsername: 'tester',
      userName: 'Tester',
      prompt: 'test prompt',
      status: 'done',
      requestedImageCount: 2,
    })
    expect(audits[0].outputImages).toEqual([image, secondImage])
    expect(await countRecentRequestedImages('user-1')).toBe(2)
    expect((await findAuditImage('img_test'))?.audit.id).toBe(audit.id)

    const deleted = await deleteAudit(audit.id)
    expect(deleted?.outputImages).toEqual([image, secondImage])
    expect(await readAudits()).toEqual([])
    expect(await findAuditImage('img_test')).toBeNull()
    expect(readdirSync(tempRoot).filter((fileName) => fileName.endsWith('.json'))).toEqual([])
  })

  it('persists audit username and name when account and email are absent', async () => {
    const audit = await createCompletedAudit({
      user: {
        id: 'user-2',
        account: null,
        email: null,
        username: 'portal-user',
        name: 'Portal User',
        avatarUrl: null,
        status: 'ACTIVE',
      },
      prompt: 'fallback identity',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: [],
    })

    const audits = await readAudits()

    expect(audits[0]).toMatchObject({
      id: audit.id,
      userId: 'user-2',
      userAccount: null,
      userEmail: null,
      userUsername: 'portal-user',
      userName: 'Portal User',
    })
  })

  it('reads and counts only completed audits for admin-facing views', async () => {
    const user = {
      id: 'user-3',
      account: 'q19946502',
      email: 'user@example.com',
      username: 'tester',
      name: 'Tester',
      avatarUrl: null,
      status: 'ACTIVE',
    }
    const running = await createAudit({
      user,
      prompt: 'running',
      params,
      requestedImageCount: 4,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
    })
    const failed = await createAudit({
      user,
      prompt: 'failed',
      params,
      requestedImageCount: 3,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
    })
    await updateAudit(failed.id, { status: 'error', error: 'failed' })
    const doneId = createAuditId()
    const doneImages: GenerationAuditImage[] = [
      {
        id: 'img_done_1',
        auditId: doneId,
        fileName: 'done-1.png',
        relativePath: '20260503/done-1.png',
        mime: 'image/png',
        size: 100,
        hash: 'hash-1',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'img_done_2',
        auditId: doneId,
        fileName: 'done-2.png',
        relativePath: '20260503/done-2.png',
        mime: 'image/png',
        size: 200,
        hash: 'hash-2',
        createdAt: new Date().toISOString(),
      },
    ]
    const done = await createCompletedAudit({
      id: doneId,
      user,
      prompt: 'done',
      params,
      requestedImageCount: 2,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: doneImages,
    })

    expect((await readAudits()).map((audit) => audit.id).sort()).toEqual([running.id, failed.id, done.id].sort())
    expect(await readCompletedAudits()).toMatchObject([{ id: done.id, status: 'done' }])
    expect(await countRecentRequestedImages(user.id)).toBe(2)
  })

  it('exports completed audit manifests with image files in a ZIP archive', async () => {
    const user = {
      id: 'user-4',
      account: 'q19946502',
      email: 'user@example.com',
      username: 'tester',
      name: 'Tester',
      avatarUrl: null,
      status: 'ACTIVE',
    }
    const auditId = createAuditId()
    const relativePath = '20260503/gallery.png'
    const image: GenerationAuditImage = {
      id: 'img_gallery',
      auditId,
      fileName: 'gallery.png',
      relativePath,
      mime: 'image/png',
      size: 10,
      hash: 'hash',
      createdAt: new Date().toISOString(),
    }
    mkdirSync(join(tempRoot, 'generated-images', '20260503'), { recursive: true })
    writeFileSync(join(tempRoot, 'generated-images', relativePath), Buffer.from('image-data'))
    await createCompletedAudit({
      id: auditId,
      user,
      prompt: 'zip export',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: [image],
    })

    const zip = await buildAuditExportZip(await readCompletedAudits())
    const files = unzipSync(new Uint8Array(zip))
    const manifest = JSON.parse(strFromU8(files['manifest.json']))

    expect(strFromU8(files['images/gallery.png'])).toBe('image-data')
    expect(manifest).toMatchObject({
      total: 1,
      items: [{
        id: auditId,
        prompt: 'zip export',
        outputImages: [{
          fileName: 'gallery.png',
          exportPath: 'images/gallery.png',
        }],
      }],
    })
    expect(manifest.items[0].outputImages[0].missing).toBeUndefined()
  })

  it('marks missing audit image files in the ZIP manifest', async () => {
    const user = {
      id: 'user-5',
      account: 'q19946502',
      email: 'user@example.com',
      username: 'tester',
      name: 'Tester',
      avatarUrl: null,
      status: 'ACTIVE',
    }
    const auditId = createAuditId()
    const image: GenerationAuditImage = {
      id: 'img_missing',
      auditId,
      fileName: 'missing.png',
      relativePath: '20260503/missing.png',
      mime: 'image/png',
      size: 10,
      hash: 'hash',
      createdAt: new Date().toISOString(),
    }
    await createCompletedAudit({
      id: auditId,
      user,
      prompt: 'missing export',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: [image],
    })

    const zip = await buildAuditExportZip(await readCompletedAudits())
    const files = unzipSync(new Uint8Array(zip))
    const manifest = JSON.parse(strFromU8(files['manifest.json']))

    expect(files['images/missing.png']).toBeUndefined()
    expect(manifest.items[0].outputImages[0]).toMatchObject({
      fileName: 'missing.png',
      exportPath: 'images/missing.png',
      missing: true,
    })
  })

  it('deletes all generation audits and image metadata', async () => {
    const user = {
      id: 'user-1',
      account: 'q19946502',
      email: 'user@example.com',
      username: 'tester',
      name: 'Tester',
      avatarUrl: null,
      status: 'ACTIVE',
    }
    const first = await createCompletedAudit({
      user,
      prompt: 'first',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: [],
    })
    const secondId = createAuditId()
    const image: GenerationAuditImage = {
      id: 'img_bulk',
      auditId: secondId,
      fileName: 'bulk.png',
      relativePath: '20260503/bulk.png',
      mime: 'image/png',
      size: 4321,
      hash: 'hash',
      createdAt: new Date().toISOString(),
    }
    const second = await createCompletedAudit({
      id: secondId,
      user,
      prompt: 'second',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
      outputImages: [image],
    })

    const deleted = await deleteAllAudits()

    expect(deleted.map((audit) => audit.id).sort()).toEqual([first.id, second.id].sort())
    expect(deleted.find((audit) => audit.id === second.id)?.outputImages).toEqual([image])
    expect(await readAudits()).toEqual([])
    expect(await findAuditImage('img_bulk')).toBeNull()
  })
})
