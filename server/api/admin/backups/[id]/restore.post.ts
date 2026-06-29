import { requireAdmin } from '../../../../utils/auth'
import { startRestoreBackup } from '../../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id') || ''
  const body = await readBody(event) as { confirmationId?: unknown }
  setResponseStatus(event, 202)
  return startRestoreBackup(id, String(body?.confirmationId || ''))
})
