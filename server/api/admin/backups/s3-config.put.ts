import { requireAdmin } from '../../../utils/auth'
import { updateBackupS3Config } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event)
  return updateBackupS3Config(body)
})
