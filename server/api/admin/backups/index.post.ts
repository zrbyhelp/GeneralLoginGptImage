import { requireAdmin } from '../../../utils/auth'
import { startBackup } from '../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event).catch(() => ({})) as { expireDays?: unknown }
  setResponseStatus(event, 202)
  return startBackup('manual', Math.max(0, Math.floor(Number(body?.expireDays ?? 14) || 0)))
})
