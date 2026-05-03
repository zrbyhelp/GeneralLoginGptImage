import { describe, expect, it } from 'vitest'
import { buildFeedbackUrl, getFeedbackServiceSlug } from './feedback'

describe('feedback URL helpers', () => {
  it('builds the portal feedback popup URL with service and user context', () => {
    const url = new URL(buildFeedbackUrl({
      portalBaseUrl: 'https://zrg.zrbyhelp.com/',
      serviceSlug: 'gpt-image',
      sourceUrl: 'http://localhost:3003/?x=1',
      userId: 'user-1',
    }))

    expect(url.origin).toBe('https://zrg.zrbyhelp.com')
    expect(url.pathname).toBe('/feedback')
    expect(url.searchParams.get('service_slug')).toBe('gpt-image')
    expect(url.searchParams.get('embed')).toBe('1')
    expect(url.searchParams.get('source_url')).toBe('http://localhost:3003/?x=1')
    expect(url.searchParams.get('user_id')).toBe('user-1')
  })

  it('uses the default service slug when config is empty', () => {
    expect(getFeedbackServiceSlug('')).toBe('gpt-image-playground')
    expect(buildFeedbackUrl({ portalBaseUrl: 'https://zrg.zrbyhelp.com', serviceSlug: '' }))
      .toBe('https://zrg.zrbyhelp.com/feedback?service_slug=gpt-image-playground&embed=1')
  })
})
