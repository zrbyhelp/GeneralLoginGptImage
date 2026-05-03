import { createError } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { deleteAudit } from '../../../utils/audits'
import { deleteGeneratedImages } from '../../../utils/local-images'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = event.context.params?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少记录 ID' })
  const deleted = await deleteAudit(id)
  if (!deleted) throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  await deleteGeneratedImages(deleted.outputImages)
  return { ok: true }
})
