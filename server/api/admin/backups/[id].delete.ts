import { requireAdmin } from '../../../utils/auth'
import { deleteBackup } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await deleteBackup(getRouterParam(event, 'id') || '')
  return { deleted: true }
})
