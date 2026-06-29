import { requireAdmin } from '../../../../utils/auth'
import { testBackupS3Connection } from '../../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event)
  try {
    await testBackupS3Connection(body)
    return { ok: true, message: 'connection successful' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
})
