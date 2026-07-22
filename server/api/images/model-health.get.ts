import { requireUser } from '../../utils/auth'
import { getAdminSettings } from '../../utils/admin-settings'
import { getModelHealthById } from '../../utils/model-health'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const settings = await getAdminSettings()
  const modelIds = settings.models.filter((model) => model.enabled).map((model) => model.id)

  return {
    windowMinutes: 60,
    modelHealthById: await getModelHealthById(modelIds),
  }
})
