import { createError, getQuery, getRequestURL, sendRedirect, setCookie } from 'h3'
import { generateToken } from '../../utils/crypto'

const STATE_COOKIE = 'gip_login_state'
const RETURN_COOKIE = 'gip_login_return'

function normalizeReturnTo(value: unknown) {
  const raw = typeof value === 'string' ? value : '/'
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const portalBaseUrl = String(config.portalBaseUrl || '').replace(/\/+$/, '')
  const clientId = String(config.serviceClientId || '')
  const appUrl = String(config.public.appUrl || getRequestURL(event).origin).replace(/\/+$/, '')

  if (!portalBaseUrl || !clientId) {
    throw createError({ statusCode: 500, statusMessage: '统一登录服务未配置' })
  }

  const state = generateToken(24)
  const returnTo = normalizeReturnTo(getQuery(event).returnTo)
  setCookie(event, STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 })
  setCookie(event, RETURN_COOKIE, returnTo, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 })

  const loginUrl = new URL('/login', portalBaseUrl)
  loginUrl.searchParams.set('client_id', clientId)
  loginUrl.searchParams.set('callback', `${appUrl}/api/auth/callback`)
  loginUrl.searchParams.set('state', state)

  return sendRedirect(event, loginUrl.toString(), 302)
})
