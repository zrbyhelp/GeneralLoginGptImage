import type { TaskParams } from '../../src/types'
import { generateId } from './crypto'
import type { AppUser } from './auth'
import { getDb } from './db'

export type AuditStatus = 'running' | 'done' | 'error'

export interface GenerationAuditImage {
  id: string
  auditId: string
  fileName: string
  relativePath: string
  mime: string
  size: number
  hash: string
  createdAt: string
}

export interface GenerationAudit {
  id: string
  userId: string
  userAccount: string | null
  userEmail: string | null
  userUsername: string | null
  userName: string | null
  prompt: string
  params: TaskParams
  requestedImageCount: number
  inputImageCount: number
  maskUsed: boolean
  apiProvider: string
  apiModel: string
  status: AuditStatus
  error: string | null
  auditSaveError?: string | null
  actualParams?: Partial<TaskParams>
  revisedPrompts?: Array<string | undefined>
  outputImages: GenerationAuditImage[]
  createdAt: string
  finishedAt: string | null
  elapsed: number | null
}

export interface AuditQuery {
  q?: string
  status?: string
  model?: string
  from?: string
  to?: string
}

interface AuditRow {
  id: string
  user_id: string
  user_account: string | null
  user_email: string | null
  user_username: string | null
  user_name: string | null
  prompt: string
  params_json: string
  requested_image_count: number
  input_image_count: number
  mask_used: number
  api_provider: string
  api_model: string
  status: AuditStatus
  error: string | null
  audit_save_error: string | null
  actual_params_json: string | null
  revised_prompts_json: string | null
  created_at: string
  finished_at: string | null
  elapsed: number | null
}

interface ImageRow {
  id: string
  audit_id: string
  file_name: string
  relative_path: string
  mime: string
  size: number
  hash: string
  created_at: string
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseOptionalJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function jsonOrNull(value: unknown) {
  return value === undefined ? null : JSON.stringify(value)
}

function rowToImage(row: ImageRow): GenerationAuditImage {
  return {
    id: row.id,
    auditId: row.audit_id,
    fileName: row.file_name,
    relativePath: row.relative_path,
    mime: row.mime,
    size: row.size,
    hash: row.hash,
    createdAt: row.created_at,
  }
}

function rowToAudit(row: AuditRow, outputImages: GenerationAuditImage[]): GenerationAudit {
  const audit: GenerationAudit = {
    id: row.id,
    userId: row.user_id,
    userAccount: row.user_account,
    userEmail: row.user_email,
    userUsername: row.user_username,
    userName: row.user_name,
    prompt: row.prompt,
    params: parseJson<TaskParams>(row.params_json, {} as TaskParams),
    requestedImageCount: row.requested_image_count,
    inputImageCount: row.input_image_count,
    maskUsed: Boolean(row.mask_used),
    apiProvider: row.api_provider,
    apiModel: row.api_model,
    status: row.status,
    error: row.error,
    outputImages,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    elapsed: row.elapsed,
  }
  const actualParams = parseOptionalJson<Partial<TaskParams>>(row.actual_params_json)
  const revisedPrompts = parseOptionalJson<Array<string | undefined>>(row.revised_prompts_json)
  if (actualParams !== undefined) audit.actualParams = actualParams
  if (revisedPrompts !== undefined) audit.revisedPrompts = revisedPrompts
  if (row.audit_save_error !== null) audit.auditSaveError = row.audit_save_error
  return audit
}

function auditSqlParams(audit: GenerationAudit) {
  return {
    id: audit.id,
    userId: audit.userId,
    userAccount: audit.userAccount,
    userEmail: audit.userEmail,
    userUsername: audit.userUsername,
    userName: audit.userName,
    prompt: audit.prompt,
    paramsJson: JSON.stringify(audit.params),
    requestedImageCount: audit.requestedImageCount,
    inputImageCount: audit.inputImageCount,
    maskUsed: audit.maskUsed ? 1 : 0,
    apiProvider: audit.apiProvider,
    apiModel: audit.apiModel,
    status: audit.status,
    error: audit.error,
    auditSaveError: audit.auditSaveError ?? null,
    actualParamsJson: jsonOrNull(audit.actualParams),
    revisedPromptsJson: jsonOrNull(audit.revisedPrompts),
    createdAt: audit.createdAt,
    finishedAt: audit.finishedAt,
    elapsed: audit.elapsed,
  }
}

function imageSqlParams(image: GenerationAuditImage) {
  return {
    id: image.id,
    auditId: image.auditId,
    fileName: image.fileName,
    relativePath: image.relativePath,
    mime: image.mime,
    size: image.size,
    hash: image.hash,
    createdAt: image.createdAt,
  }
}

function readAllImages() {
  const rows = getDb()
    .prepare('SELECT * FROM generation_audit_images ORDER BY created_at ASC')
    .all() as ImageRow[]
  const grouped = new Map<string, GenerationAuditImage[]>()
  for (const row of rows) {
    const images = grouped.get(row.audit_id) ?? []
    images.push(rowToImage(row))
    grouped.set(row.audit_id, images)
  }
  return grouped
}

function getAuditById(id: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM generation_audits WHERE id = ?').get(id) as AuditRow | undefined
  if (!row) return null
  const images = db
    .prepare('SELECT * FROM generation_audit_images WHERE audit_id = ? ORDER BY created_at ASC')
    .all(id) as ImageRow[]
  return rowToAudit(row, images.map(rowToImage))
}

function insertAuditImages(images: GenerationAuditImage[]) {
  const insertImage = getDb().prepare(`
    INSERT INTO generation_audit_images (
      id,
      audit_id,
      file_name,
      relative_path,
      mime,
      size,
      hash,
      created_at
    ) VALUES (
      @id,
      @auditId,
      @fileName,
      @relativePath,
      @mime,
      @size,
      @hash,
      @createdAt
    )
  `)
  for (const image of images) {
    insertImage.run(imageSqlParams(image))
  }
}

function insertAudit(audit: GenerationAudit) {
  getDb().prepare(`
    INSERT INTO generation_audits (
      id,
      user_id,
      user_account,
      user_email,
      user_username,
      user_name,
      prompt,
      params_json,
      requested_image_count,
      input_image_count,
      mask_used,
      api_provider,
      api_model,
      status,
      error,
      audit_save_error,
      actual_params_json,
      revised_prompts_json,
      created_at,
      finished_at,
      elapsed
    ) VALUES (
      @id,
      @userId,
      @userAccount,
      @userEmail,
      @userUsername,
      @userName,
      @prompt,
      @paramsJson,
      @requestedImageCount,
      @inputImageCount,
      @maskUsed,
      @apiProvider,
      @apiModel,
      @status,
      @error,
      @auditSaveError,
      @actualParamsJson,
      @revisedPromptsJson,
      @createdAt,
      @finishedAt,
      @elapsed
    )
  `).run(auditSqlParams(audit))
}

function rowsToAudits(rows: AuditRow[]) {
  const imagesByAuditId = readAllImages()
  return rows.map((row) => rowToAudit(row, imagesByAuditId.get(row.id) ?? []))
}

export function createAuditId() {
  return generateId('gen')
}

export async function readAudits() {
  const rows = getDb()
    .prepare('SELECT * FROM generation_audits ORDER BY created_at DESC')
    .all() as AuditRow[]
  return rowsToAudits(rows)
}

export async function readCompletedAudits() {
  const rows = getDb()
    .prepare("SELECT * FROM generation_audits WHERE status = 'done' ORDER BY created_at DESC")
    .all() as AuditRow[]
  return rowsToAudits(rows)
}

export async function createAudit(input: {
  id?: string
  user: AppUser
  prompt: string
  params: TaskParams
  requestedImageCount: number
  inputImageCount: number
  maskUsed: boolean
  apiProvider: string
  apiModel: string
}) {
  const now = new Date().toISOString()
  const audit: GenerationAudit = {
    id: input.id ?? createAuditId(),
    userId: input.user.id,
    userAccount: input.user.account,
    userEmail: input.user.email,
    userUsername: input.user.username,
    userName: input.user.name,
    prompt: input.prompt,
    params: input.params,
    requestedImageCount: input.requestedImageCount,
    inputImageCount: input.inputImageCount,
    maskUsed: input.maskUsed,
    apiProvider: input.apiProvider,
    apiModel: input.apiModel,
    status: 'running',
    error: null,
    outputImages: [],
    createdAt: now,
    finishedAt: null,
    elapsed: null,
  }

  insertAudit(audit)
  return audit
}

export async function createCompletedAudit(input: {
  id?: string
  user: AppUser
  prompt: string
  params: TaskParams
  requestedImageCount: number
  inputImageCount: number
  maskUsed: boolean
  apiProvider: string
  apiModel: string
  outputImages: GenerationAuditImage[]
  actualParams?: Partial<TaskParams>
  revisedPrompts?: Array<string | undefined>
  createdAt?: string
  finishedAt?: string
  elapsed?: number | null
}) {
  const now = new Date().toISOString()
  const audit: GenerationAudit = {
    id: input.id ?? createAuditId(),
    userId: input.user.id,
    userAccount: input.user.account,
    userEmail: input.user.email,
    userUsername: input.user.username,
    userName: input.user.name,
    prompt: input.prompt,
    params: input.params,
    requestedImageCount: input.requestedImageCount,
    inputImageCount: input.inputImageCount,
    maskUsed: input.maskUsed,
    apiProvider: input.apiProvider,
    apiModel: input.apiModel,
    status: 'done',
    error: null,
    outputImages: input.outputImages,
    createdAt: input.createdAt ?? now,
    finishedAt: input.finishedAt ?? now,
    elapsed: input.elapsed ?? null,
  }
  if (input.actualParams !== undefined) audit.actualParams = input.actualParams
  if (input.revisedPrompts !== undefined) audit.revisedPrompts = input.revisedPrompts

  const db = getDb()
  const transaction = db.transaction(() => {
    insertAudit(audit)
    insertAuditImages(audit.outputImages)
  })
  transaction()
  return audit
}

export async function updateAudit(id: string, patch: Partial<GenerationAudit>) {
  const current = getAuditById(id)
  if (!current) return null

  const updated: GenerationAudit = { ...current, ...patch }
  const hasOutputImagesPatch = Object.prototype.hasOwnProperty.call(patch, 'outputImages')
  const db = getDb()
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE generation_audits SET
        user_id = @userId,
        user_account = @userAccount,
        user_email = @userEmail,
        user_username = @userUsername,
        user_name = @userName,
        prompt = @prompt,
        params_json = @paramsJson,
        requested_image_count = @requestedImageCount,
        input_image_count = @inputImageCount,
        mask_used = @maskUsed,
        api_provider = @apiProvider,
        api_model = @apiModel,
        status = @status,
        error = @error,
        audit_save_error = @auditSaveError,
        actual_params_json = @actualParamsJson,
        revised_prompts_json = @revisedPromptsJson,
        created_at = @createdAt,
        finished_at = @finishedAt,
        elapsed = @elapsed
      WHERE id = @id
    `).run(auditSqlParams(updated))

    if (hasOutputImagesPatch) {
      db.prepare('DELETE FROM generation_audit_images WHERE audit_id = ?').run(id)
      insertAuditImages(updated.outputImages)
    }
  })
  transaction()
  return updated
}

export async function deleteAudit(id: string) {
  const deleted = getAuditById(id)
  if (!deleted) return null
  getDb().prepare('DELETE FROM generation_audits WHERE id = ?').run(id)
  return deleted
}

export async function deleteAllAudits() {
  const deleted = await readAudits()
  getDb().prepare('DELETE FROM generation_audits').run()
  return deleted
}

export function filterAudits(audits: GenerationAudit[], query: AuditQuery) {
  const q = query.q?.trim().toLowerCase()
  const status = query.status?.trim()
  const model = query.model?.trim().toLowerCase()
  const fromTime = query.from ? Date.parse(query.from) : null
  const toTime = query.to ? Date.parse(query.to) : null

  return audits
    .filter((audit) => {
      const createdAt = Date.parse(audit.createdAt)
      if (q) {
        const text = [
          audit.prompt,
          audit.userAccount,
          audit.userEmail,
          audit.userName,
          audit.userUsername,
          audit.userId,
          audit.apiProvider,
          audit.apiModel,
          audit.error,
          audit.auditSaveError,
        ].filter(Boolean).join('\n').toLowerCase()
        if (!text.includes(q)) return false
      }
      if (status && audit.status !== status) return false
      if (model && !audit.apiModel.toLowerCase().includes(model)) return false
      if (fromTime && createdAt < fromTime) return false
      if (toTime && createdAt > toTime) return false
      return true
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export async function countRecentRequestedImages(userId: string, now = Date.now()) {
  const cutoff = new Date(now - 60 * 60 * 1000).toISOString()
  const row = getDb()
    .prepare(`
      SELECT COALESCE(COUNT(generation_audit_images.id), 0) AS total
      FROM generation_audits
      LEFT JOIN generation_audit_images ON generation_audit_images.audit_id = generation_audits.id
      WHERE generation_audits.user_id = ?
        AND generation_audits.status = 'done'
        AND generation_audits.created_at >= ?
    `)
    .get(userId, cutoff) as { total?: number | null } | undefined
  return Math.max(0, Number(row?.total ?? 0))
}

export async function findAuditImage(imageId: string) {
  const imageRow = getDb()
    .prepare('SELECT * FROM generation_audit_images WHERE id = ?')
    .get(imageId) as ImageRow | undefined
  if (!imageRow) return null
  const audit = getAuditById(imageRow.audit_id)
  if (!audit) return null
  return { audit, image: rowToImage(imageRow) }
}
