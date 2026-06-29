import { requireAdmin } from '../../../utils/auth'
import { getBackupSchedule } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return getBackupSchedule()
})
