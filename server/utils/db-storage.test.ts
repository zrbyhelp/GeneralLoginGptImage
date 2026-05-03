import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskParams } from '../../src/types'
import { getAdminSettings, updateAdminSettings } from './admin-settings'
import {
  countRecentRequestedImages,
  createAudit,
  deleteAllAudits,
  deleteAudit,
  findAuditImage,
  readAudits,
  updateAudit,
  type GenerationAuditImage,
} from './audits'
import { setDatabasePathForTests } from './db'

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
  }))
})

afterEach(() => {
  setDatabasePathForTests(null)
  vi.unstubAllGlobals()
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('SQLite-backed server storage', () => {
  it('persists admin settings without writing JSON files', async () => {
    expect((await getAdminSettings()).apiConfig.apiKey).toBe('env-key')

    await updateAdminSettings({
      apiConfig: {
        apiKey: 'db-key',
        model: 'custom-image-model',
        apiMode: 'responses',
        codexCli: true,
      },
      hourlyImageLimit: 7,
    })

    setDatabasePathForTests(join(tempRoot, 'app.db'))
    const persisted = await getAdminSettings()

    expect(persisted.apiConfig.apiKey).toBe('db-key')
    expect(persisted.apiConfig.model).toBe('custom-image-model')
    expect(persisted.apiConfig.apiMode).toBe('responses')
    expect(persisted.apiConfig.codexCli).toBe(true)
    expect(persisted.hourlyImageLimit).toBe(7)
    expect(readdirSync(tempRoot).filter((fileName) => fileName.endsWith('.json'))).toEqual([])
  })

  it('persists generation audits and image file metadata in SQLite', async () => {
    const audit = await createAudit({
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
    })
    const image: GenerationAuditImage = {
      id: 'img_test',
      auditId: audit.id,
      fileName: 'image.png',
      relativePath: '20260503/image.png',
      mime: 'image/png',
      size: 1234,
      hash: 'hash',
      createdAt: new Date().toISOString(),
    }

    await updateAudit(audit.id, {
      status: 'done',
      outputImages: [image],
      actualParams: { size: '1024x1024' },
      revisedPrompts: ['revised prompt'],
      finishedAt: new Date().toISOString(),
      elapsed: 321,
    })

    const audits = await readAudits()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      id: audit.id,
      prompt: 'test prompt',
      status: 'done',
      requestedImageCount: 2,
    })
    expect(audits[0].outputImages).toEqual([image])
    expect(await countRecentRequestedImages('user-1')).toBe(2)
    expect((await findAuditImage('img_test'))?.audit.id).toBe(audit.id)

    const deleted = await deleteAudit(audit.id)
    expect(deleted?.outputImages).toEqual([image])
    expect(await readAudits()).toEqual([])
    expect(await findAuditImage('img_test')).toBeNull()
    expect(readdirSync(tempRoot).filter((fileName) => fileName.endsWith('.json'))).toEqual([])
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
    const first = await createAudit({
      user,
      prompt: 'first',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
    })
    const second = await createAudit({
      user,
      prompt: 'second',
      params,
      requestedImageCount: 1,
      inputImageCount: 0,
      maskUsed: false,
      apiProvider: 'openai',
      apiModel: 'gpt-image-2',
    })
    const image: GenerationAuditImage = {
      id: 'img_bulk',
      auditId: second.id,
      fileName: 'bulk.png',
      relativePath: '20260503/bulk.png',
      mime: 'image/png',
      size: 4321,
      hash: 'hash',
      createdAt: new Date().toISOString(),
    }
    await updateAudit(second.id, { status: 'done', outputImages: [image] })

    const deleted = await deleteAllAudits()

    expect(deleted.map((audit) => audit.id).sort()).toEqual([first.id, second.id].sort())
    expect(deleted.find((audit) => audit.id === second.id)?.outputImages).toEqual([image])
    expect(await readAudits()).toEqual([])
    expect(await findAuditImage('img_bulk')).toBeNull()
  })
})
