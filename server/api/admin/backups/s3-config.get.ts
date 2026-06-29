import { requireAdmin } from '../../../utils/auth'
import { getBackupS3Config } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return getBackupS3Config()
})
