import { createError } from 'h3'
import { requireUser } from '../../utils/auth'
import { getAdminSettings } from '../../utils/admin-settings'
import { redeemCode } from '../../utils/points'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<Record<string, unknown>>(event)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: '请输入兑换码' })
  }

  const settings = await getAdminSettings()
  const result = await redeemCode({
    userId: user.id,
    code,
    dailyTarget: settings.dailyPointsTarget,
  })

  return {
    code: result.code,
    addedPoints: result.addedPoints,
    pointsBalance: result.balance,
  }
})
