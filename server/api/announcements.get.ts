import { createError } from 'h3'
import { requireUser } from '../utils/auth'
import { fetchServiceAnnouncements } from '../utils/announcements'

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const config = useRuntimeConfig()
  try {
    const announcements = await fetchServiceAnnouncements({
      portalBaseUrl: String(config.portalBaseUrl || ''),
      clientId: String(config.serviceClientId || ''),
      clientSecret: String(config.serviceClientSecret || ''),
    })
    return { announcements }
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: error instanceof Error ? error.message : '公告获取失败',
    })
  }
})
