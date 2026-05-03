const DEFAULT_FEEDBACK_SERVICE_SLUG = 'gpt-image-playground'

export function getFeedbackServiceSlug(value: unknown) {
  const slug = String(value || '').trim()
  return slug || DEFAULT_FEEDBACK_SERVICE_SLUG
}

export function buildFeedbackUrl(input: {
  portalBaseUrl: string
  serviceSlug?: string | null
  sourceUrl?: string | null
  userId?: string | null
}) {
  const portalBaseUrl = input.portalBaseUrl.replace(/\/+$/, '')
  const url = new URL('/feedback', portalBaseUrl)
  url.searchParams.set('service_slug', getFeedbackServiceSlug(input.serviceSlug))
  url.searchParams.set('embed', '1')
  if (input.sourceUrl) url.searchParams.set('source_url', input.sourceUrl)
  if (input.userId) url.searchParams.set('user_id', input.userId)
  return url.toString()
}
