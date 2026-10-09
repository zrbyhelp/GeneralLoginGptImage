import { getCookie, getHeader, getMethod, getRequestURL, sendRedirect, setCookie, setResponseHeaders } from 'h3'
import { ENTER_SITE_COOKIE, decideWelcomeGate } from '../utils/welcome-gate'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const decision = decideWelcomeGate({
    method: getMethod(event),
    pathname: url.pathname,
    search: url.search,
    accept: getHeader(event, 'accept'),
    secFetchDest: getHeader(event, 'sec-fetch-dest'),
    upgrade: getHeader(event, 'upgrade'),
    entered: getCookie(event, ENTER_SITE_COOKIE) === '1',
  })

  if (decision.type === 'pass') return

  setResponseHeaders(event, { 'cache-control': 'no-store' })

  if (decision.type === 'enter') {
    setCookie(event, ENTER_SITE_COOKIE, '1', {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: url.protocol === 'https:',
    })
    return sendRedirect(event, decision.location, 302)
  }

  return sendRedirect(event, '/welcome.html', 302)
})
