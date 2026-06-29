import { requireAdmin } from '../../../utils/auth'
import { listBackupRecords } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { items: await listBackupRecords() }
})
