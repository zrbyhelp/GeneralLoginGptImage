import { requireAdmin } from '../../utils/auth'
import { getAdminSettings } from '../../utils/admin-settings'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return getAdminSettings()
})
