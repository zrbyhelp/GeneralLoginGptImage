import { requireAdmin } from '../../../../utils/auth'
import { getBackupDownloadUrl } from '../../../../utils/backup'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { url: await getBackupDownloadUrl(getRouterParam(event, 'id') || '') }
})
