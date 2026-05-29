import { createError, deleteCookie, getCookie, getQuery, sendRedirect, setCookie } from 'h3'
import { createAppSession, type AppUser } from '../../utils/auth'
import { generateToken } from '../../utils/crypto'

const STATE_COOKIE = 'gip_login_state'
const RETURN_COOKIE = 'gip_login_return'
const THEME_COOKIE = 'gip_theme'
const LOCALE_COOKIE = 'gip_locale'
const LOGIN_NOTICE_COOKIE = 'gip_login_notice'
const DISPLAY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function normalizeReturnTo(value: string | undefined) {
  const raw = value || '/'
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

function normalizeTheme(value: unknown) {
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  return raw === 'dark' || raw === 'light' ? raw : null
}

function normalizeLocale(value: unknown) {
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  if (raw.startsWith('en')) return 'en'
  if (raw.startsWith('zh') || raw === 'cn') return 'zh'
  return null
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const code = typeof query.code === 'string' ? query.code : ''
  const state = typeof query.state === 'string' ? query.state : ''
  const expectedState = getCookie(event, STATE_COOKIE)
  const storedReturnTo = normalizeReturnTo(getCookie(event, RETURN_COOKIE))
  const hasMatchingState = Boolean(expectedState && state && state === expectedState)
  const returnTo = hasMatchingState ? storedReturnTo : '/'

  deleteCookie(event, STATE_COOKIE, { path: '/' })
  deleteCookie(event, RETURN_COOKIE, { path: '/' })

  if (!code) {
    return sendRedirect(event, `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`, 302)
  }

  if (expectedState && state && state !== expectedState) {
    console.warn('统一登录回调 state 与本地登录 state 不一致，按门户直接跳转处理。')
  }

  const config = useRuntimeConfig()
  const portalBaseUrl = String(config.portalBaseUrl || '').replace(/\/+$/, '')
  const clientId = String(config.serviceClientId || '')
  const clientSecret = String(config.serviceClientSecret || '')
  if (!portalBaseUrl || !clientId || !clientSecret) {
    throw createError({ statusCode: 500, statusMessage: '统一登录服务未配置' })
  }

  const response = await fetch(new URL('/api/service-auth/token', portalBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, code }),
  })
  if (!response.ok) {
    throw createError({ statusCode: 401, statusMessage: `统一登录认证失败：${await response.text()}` })
  }

  const payload = await response.json() as { user?: Partial<AppUser> }
  if (!payload.user?.id) {
    throw createError({ statusCode: 401, statusMessage: '统一登录未返回用户信息' })
  }

  await createAppSession(event, {
    id: String(payload.user.id),
    account: payload.user.account ?? null,
    email: payload.user.email ?? null,
    username: payload.user.username ?? null,
    name: payload.user.name ?? null,
    avatarUrl: payload.user.avatarUrl ?? null,
    status: payload.user.status ?? 'ACTIVE',
  })

  const theme = normalizeTheme(query.theme)
  const locale = normalizeLocale(query.locale)
  const cookieOptions = {
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DISPLAY_COOKIE_MAX_AGE,
  }
  if (theme) setCookie(event, THEME_COOKIE, theme, cookieOptions)
  if (locale) setCookie(event, LOCALE_COOKIE, locale, cookieOptions)
  setCookie(event, LOGIN_NOTICE_COOKIE, generateToken(16), cookieOptions)

  return sendRedirect(event, returnTo, 302)
})
