import { requireAdmin } from '../../../utils/auth'
import { getBackupRecord } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return getBackupRecord(getRouterParam(event, 'id') || '')
})
