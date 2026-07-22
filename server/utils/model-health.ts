import { MODEL_HEALTH_WINDOW_MINUTES, deriveModelHealth } from '../../src/lib/modelHealth'
import type { ModelHealth } from '../../src/types'
import { generateId } from './crypto'
import { getDb } from './db'

const MODEL_HEALTH_RETENTION_MS = 48 * 60 * 60 * 1000

export async function recordModelGenerationHealth(input: {
  modelId: string
  success: boolean
  generationMs: number
  finishedAt?: string
}) {
  const now = new Date()
  const record = {
    id: generateId('model-health'),
    modelId: input.modelId,
    success: input.success ? 1 : 0,
    generationMs: Math.max(0, Math.floor(Number(input.generationMs) || 0)),
    finishedAt: input.finishedAt ?? now.toISOString(),
  }
  const cutoff = new Date(now.getTime() - MODEL_HEALTH_RETENTION_MS).toISOString()
  const db = getDb()

  db.transaction(() => {
    db.prepare('DELETE FROM model_generation_health WHERE finished_at < ?').run(cutoff)
    db.prepare(`
      INSERT INTO model_generation_health (
        id,
        model_id,
        success,
        generation_ms,
        finished_at
      ) VALUES (
        @id,
        @modelId,
        @success,
        @generationMs,
        @finishedAt
      )
    `).run(record)
  })()

  return record
}

export async function getModelHealthById(modelIds: string[], now = Date.now()): Promise<Record<string, ModelHealth>> {
  const uniqueModelIds = [...new Set(modelIds.map((id) => id.trim()).filter(Boolean))]
  const empty = Object.fromEntries(uniqueModelIds.map((modelId) => [
    modelId,
    deriveModelHealth({ modelId, sampleCount: 0, successCount: 0, averageGenerationMs: null }),
  ])) as Record<string, ModelHealth>
  if (!uniqueModelIds.length) return empty

  const cutoff = new Date(now - MODEL_HEALTH_WINDOW_MINUTES * 60 * 1000).toISOString()
  const placeholders = uniqueModelIds.map(() => '?').join(', ')
  const rows = getDb().prepare(`
    SELECT
      model_id,
      COUNT(*) AS sample_count,
      COALESCE(SUM(success), 0) AS success_count,
      AVG(generation_ms) AS average_generation_ms
    FROM model_generation_health
    WHERE finished_at >= ?
      AND model_id IN (${placeholders})
    GROUP BY model_id
  `).all(cutoff, ...uniqueModelIds) as Array<{
    model_id: string
    sample_count: number
    success_count: number
    average_generation_ms: number | null
  }>

  for (const row of rows) {
    empty[row.model_id] = deriveModelHealth({
      modelId: row.model_id,
      sampleCount: Number(row.sample_count) || 0,
      successCount: Number(row.success_count) || 0,
      averageGenerationMs: row.average_generation_ms == null ? null : Number(row.average_generation_ms),
    })
  }

  return empty
}
