import { createError, getQuery } from 'h3'
import { requireUser } from '../../utils/auth'
import { buildFeedbackUrl, getFeedbackServiceSlug } from '../../utils/feedback'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const config = useRuntimeConfig()
  const portalBaseUrl = String(config.portalBaseUrl || '').trim()
  if (!portalBaseUrl) {
    throw createError({ statusCode: 500, statusMessage: '未配置统一门户地址' })
  }

  const query = getQuery(event)
  const sourceUrl = typeof query.sourceUrl === 'string' ? query.sourceUrl : ''
  return {
    url: buildFeedbackUrl({
      portalBaseUrl,
      serviceSlug: getFeedbackServiceSlug(config.feedbackServiceSlug),
      sourceUrl,
      userId: user.id,
    }),
  }
})
