import { getCurrentUser, isAdminUser } from '../../utils/auth'
import { getAdminSettings, getPublicGenerationModels } from '../../utils/admin-settings'
import { ensureDailyPointsBalance } from '../../utils/points'

export default defineEventHandler(async (event) => {
  const user = await getCurrentUser(event)
  if (!user) {
    return {
      authenticated: false,
      user,
      isAdmin: false,
    }
  }

  const settings = await getAdminSettings()
  const points = await ensureDailyPointsBalance(user.id, settings.dailyPointsTarget)
  return {
    authenticated: true,
    user: {
      ...user,
      pointsBalance: points.balance,
    },
    isAdmin: isAdminUser(user),
    generationDefaults: {
      dailyPointsTarget: settings.dailyPointsTarget,
      standardPointCost: settings.standardPointCost,
      galleryUploadDefault: settings.galleryUploadDefault,
      models: getPublicGenerationModels(settings),
      defaultModelId: settings.defaultModelId,
    },
  }
})
