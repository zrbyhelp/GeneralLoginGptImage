import { requireAdmin } from '../../utils/auth'
import { updateAdminSettings } from '../../utils/admin-settings'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event)
  return updateAdminSettings(body)
})
