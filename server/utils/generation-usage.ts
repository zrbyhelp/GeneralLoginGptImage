import { generateId } from './crypto'
import { getDb } from './db'

export async function recordGenerationUsage(input: {
  userId: string
  imageCount: number
  privacyMode: boolean
  createdAt?: string
}) {
  const imageCount = Math.max(0, Math.floor(Number(input.imageCount) || 0))
  if (imageCount <= 0) return null

  const record = {
    id: generateId('usage'),
    userId: input.userId,
    imageCount,
    privacyMode: input.privacyMode ? 1 : 0,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }

  getDb().prepare(`
    INSERT INTO generation_usage (
      id,
      user_id,
      image_count,
      privacy_mode,
      created_at
    ) VALUES (
      @id,
      @userId,
      @imageCount,
      @privacyMode,
      @createdAt
    )
  `).run(record)

  return record
}

export async function countRecentGeneratedImages(userId: string, privacyMode: boolean, now = Date.now()) {
  const cutoff = new Date(now - 60 * 60 * 1000).toISOString()
  const row = getDb()
    .prepare(`
      SELECT COALESCE(SUM(image_count), 0) AS total
      FROM generation_usage
      WHERE user_id = ?
        AND privacy_mode = ?
        AND created_at >= ?
    `)
    .get(userId, privacyMode ? 1 : 0, cutoff) as { total?: number | null } | undefined
  return Math.max(0, Number(row?.total ?? 0))
}
