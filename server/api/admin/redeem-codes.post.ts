import { createError, setHeader } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { createRedeemCodes, getRedeemCodeExportText } from '../../utils/points'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readBody<Record<string, unknown>>(event)
  const rawCount = Number(body?.count)
  const rawPointsPerCode = Number(body?.pointsPerCode)
  if (!Number.isFinite(rawCount) || rawCount <= 0) {
    throw createError({ statusCode: 400, statusMessage: '请输入发放数量' })
  }
  if (!Number.isFinite(rawPointsPerCode) || rawPointsPerCode <= 0) {
    throw createError({ statusCode: 400, statusMessage: '请输入每个兑换码的积分数量' })
  }
  const count = Math.min(1000, Math.max(1, Math.floor(rawCount)))
  const pointsPerCode = Math.min(1_000_000, Math.max(1, Math.floor(rawPointsPerCode)))

  const codes = await createRedeemCodes({
    createdByUserId: admin.id,
    count,
    pointsPerCode,
  })
  const text = getRedeemCodeExportText(codes, pointsPerCode)
  const filename = `redeem-codes-${count}x${pointsPerCode}-${Date.now()}.txt`
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  return text
})
