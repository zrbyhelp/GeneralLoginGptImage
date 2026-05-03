import { createError } from 'h3'
import { clearAppSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await clearAppSession(event)

  const config = useRuntimeConfig()
  const portalBaseUrl = String(config.portalBaseUrl || '').replace(/\/+$/, '')

  if (!portalBaseUrl) {
    throw createError({ statusCode: 500, statusMessage: '统一登录服务未配置' })
  }

  const logoutUrl = new URL('/relogin', portalBaseUrl)

  return { ok: true, logoutUrl: logoutUrl.toString() }
})
