import { requireAdmin } from '../../utils/auth'
import { deleteAllAudits } from '../../utils/audits'
import { deleteGeneratedImages } from '../../utils/local-images'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const deleted = await deleteAllAudits()
  const images = deleted.flatMap((audit) => audit.outputImages)
  await deleteGeneratedImages(images)
  return { ok: true, deleted: deleted.length, images: images.length }
})

