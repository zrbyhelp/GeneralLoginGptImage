import { requireAdmin } from '../../../utils/auth'
import { importBackupRecordsFromR2 } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return importBackupRecordsFromR2()
})
