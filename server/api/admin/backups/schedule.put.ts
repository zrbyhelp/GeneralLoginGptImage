import { requireAdmin } from '../../../utils/auth'
import { updateBackupSchedule } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event)
  return updateBackupSchedule(body)
})
