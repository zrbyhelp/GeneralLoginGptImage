import { createError } from 'h3'
import { randomBytes } from 'node:crypto'
import { generateId } from './crypto'
import { getDb } from './db'

interface PointAccountRow {
  user_id: string
  balance: number
  last_daily_refill_date: string | null
  created_at: string
  updated_at: string
}

interface RedeemCodeRow {
  code: string
  points: number
  created_by_user_id: string
  redeemed_by_user_id: string | null
  created_at: string
  redeemed_at: string | null
}

export interface DailyPointState {
  balance: number
  lastDailyRefillDate: string | null
  dailyRefilled: boolean
}

export interface PointReservationResult extends DailyPointState {
  reservedPoints: number
}

export interface PointSettlementResult {
  balance: number
  chargedPoints: number
  refundedPoints: number
}

export interface RedeemResult extends DailyPointState {
  code: string
  addedPoints: number
}

function nowIso(now = new Date()) {
  return now.toISOString()
}

function serviceDate(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = 1_000_000) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function getOrCreateAccount(db: ReturnType<typeof getDb>, userId: string, createdAt = nowIso()) {
  let row = db.prepare('SELECT * FROM user_points WHERE user_id = ?').get(userId) as PointAccountRow | undefined
  if (row) return row

  db.prepare(`
    INSERT INTO user_points (
      user_id,
      balance,
      last_daily_refill_date,
      created_at,
      updated_at
    ) VALUES (
      ?,
      0,
      NULL,
      ?,
      ?
    )
  `).run(userId, createdAt, createdAt)

  row = db.prepare('SELECT * FROM user_points WHERE user_id = ?').get(userId) as PointAccountRow | undefined
  if (!row) throw new Error('积分账户初始化失败')
  return row
}

function insertLedger(db: ReturnType<typeof getDb>, input: {
  userId: string
  delta: number
  balanceAfter: number
  reason: string
  referenceId?: string | null
  note?: string | null
  createdAt?: string
}) {
  db.prepare(`
    INSERT INTO point_ledger (
      id,
      user_id,
      delta,
      balance_after,
      reason,
      reference_id,
      note,
      created_at
    ) VALUES (
      @id,
      @userId,
      @delta,
      @balanceAfter,
      @reason,
      @referenceId,
      @note,
      @createdAt
    )
  `).run({
    id: generateId('point'),
    userId: input.userId,
    delta: input.delta,
    balanceAfter: input.balanceAfter,
    reason: input.reason,
    referenceId: input.referenceId ?? null,
    note: input.note ?? null,
    createdAt: input.createdAt ?? nowIso(),
  })
}

function setAccountBalance(db: ReturnType<typeof getDb>, userId: string, balance: number, lastDailyRefillDate: string | null, updatedAt: string) {
  db.prepare(`
    UPDATE user_points
    SET balance = ?,
        last_daily_refill_date = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(balance, lastDailyRefillDate, updatedAt, userId)
}

function refillAccountIfNeeded(db: ReturnType<typeof getDb>, userId: string, dailyTarget: number, createdAt = new Date()) {
  const account = getOrCreateAccount(db, userId, nowIso(createdAt))
  const today = serviceDate(createdAt)
  const currentBalance = Number(account.balance || 0)
  if (account.last_daily_refill_date === today) {
    return {
      balance: currentBalance,
      lastDailyRefillDate: account.last_daily_refill_date,
      dailyRefilled: false,
    }
  }

  const now = nowIso(createdAt)
  let nextBalance = currentBalance
  if (nextBalance < dailyTarget) {
    const delta = dailyTarget - nextBalance
    nextBalance = dailyTarget
    insertLedger(db, {
      userId,
      delta,
      balanceAfter: nextBalance,
      reason: 'daily_refill',
      referenceId: today,
      note: `每日补满到 ${dailyTarget} 积分`,
      createdAt: now,
    })
  }

  setAccountBalance(db, userId, nextBalance, today, now)
  return {
    balance: nextBalance,
    lastDailyRefillDate: today,
    dailyRefilled: true,
  }
}

function changeBalance(db: ReturnType<typeof getDb>, userId: string, delta: number, reason: string, referenceId?: string | null, note?: string | null, createdAt = nowIso()) {
  const account = getOrCreateAccount(db, userId, createdAt)
  const nextBalance = Number(account.balance || 0) + delta
  if (nextBalance < 0) {
    throw createError({
      statusCode: 429,
      statusMessage: '积分不足，无法生成图片',
      data: {
        reason: 'pointsInsufficient',
        balance: Number(account.balance || 0),
        required: Math.abs(delta),
      },
    })
  }

  setAccountBalance(db, userId, nextBalance, account.last_daily_refill_date, createdAt)
  insertLedger(db, {
    userId,
    delta,
    balanceAfter: nextBalance,
    reason,
    referenceId,
    note,
    createdAt,
  })
  return nextBalance
}

export async function ensureDailyPointsBalance(userId: string, dailyTarget: number, now = Date.now()) {
  const target = parsePositiveInt(dailyTarget, 100, 1, 1_000_000)
  const date = new Date(now)
  const db = getDb()
  const transaction = db.transaction(() => refillAccountIfNeeded(db, userId, target, date))
  return transaction()
}

export async function reserveGenerationPoints(input: {
  userId: string
  requestedImages: number
  costPerImage: number
  dailyTarget: number
  referenceId?: string
}) {
  const requestedImages = Math.max(1, Math.floor(Number(input.requestedImages) || 0))
  const costPerImage = parsePositiveInt(input.costPerImage, 1, 1, 1_000_000)
  const requiredPoints = requestedImages * costPerImage
  const dailyTarget = parsePositiveInt(input.dailyTarget, 100, 1, 1_000_000)
  const now = new Date()
  const db = getDb()

  const transaction = db.transaction(() => {
    const refill = refillAccountIfNeeded(db, input.userId, dailyTarget, now)
    const account = getOrCreateAccount(db, input.userId, nowIso(now))
    if (account.balance < requiredPoints) {
      throw createError({
        statusCode: 429,
        statusMessage: '积分不足，无法生成图片',
        data: {
          reason: 'pointsInsufficient',
          balance: account.balance,
          required: requiredPoints,
          requestedImages,
          costPerImage,
        },
      })
    }

    const nextBalance = account.balance - requiredPoints
    setAccountBalance(db, input.userId, nextBalance, refill.lastDailyRefillDate, nowIso(now))
    insertLedger(db, {
      userId: input.userId,
      delta: -requiredPoints,
      balanceAfter: nextBalance,
      reason: 'generation_reserve',
      referenceId: input.referenceId ?? null,
      note: `预扣 ${requiredPoints} 积分`,
      createdAt: nowIso(now),
    })

    return {
      balance: nextBalance,
      lastDailyRefillDate: refill.lastDailyRefillDate,
      dailyRefilled: refill.dailyRefilled,
      reservedPoints: requiredPoints,
    }
  })

  return transaction() as PointReservationResult
}

export async function settleGenerationPoints(input: {
  userId: string
  reservedPoints: number
  actualImages: number
  costPerImage: number
  referenceId?: string
}) {
  const reservedPoints = Math.max(0, Math.floor(Number(input.reservedPoints) || 0))
  const actualImages = Math.max(0, Math.floor(Number(input.actualImages) || 0))
  const costPerImage = parsePositiveInt(input.costPerImage, 1, 1, 1_000_000)
  const actualPoints = actualImages * costPerImage
  const nowIsoValue = nowIso()
  const db = getDb()

  const transaction = db.transaction(() => {
    const account = getOrCreateAccount(db, input.userId, nowIsoValue)
    let balance = account.balance
    let chargedPoints = reservedPoints
    let refundedPoints = 0

    if (actualPoints > reservedPoints) {
      const extra = actualPoints - reservedPoints
      if (balance < extra) {
        throw createError({
          statusCode: 500,
          statusMessage: '积分结算失败',
        })
      }
      balance -= extra
      chargedPoints = actualPoints
      insertLedger(db, {
        userId: input.userId,
        delta: -extra,
        balanceAfter: balance,
        reason: 'generation_overage',
        referenceId: input.referenceId ?? null,
        note: '生成结果数量超出预扣值，补扣差额',
        createdAt: nowIsoValue,
      })
    } else if (actualPoints < reservedPoints) {
      refundedPoints = reservedPoints - actualPoints
      balance += refundedPoints
      insertLedger(db, {
        userId: input.userId,
        delta: refundedPoints,
        balanceAfter: balance,
        reason: 'generation_refund',
        referenceId: input.referenceId ?? null,
        note: `按实际成功 ${actualImages} 张图片退款`,
        createdAt: nowIsoValue,
      })
    }

    setAccountBalance(db, input.userId, balance, account.last_daily_refill_date, nowIsoValue)
    return { balance, chargedPoints, refundedPoints }
  })

  return transaction() as PointSettlementResult
}

function normalizeRedeemCode(code: string) {
  return code.replace(/[^0-9A-Z]/gi, '').toUpperCase()
}

function generateRedeemCodeValue(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length]
  }
  return code
}

export function formatRedeemCodeForExport(code: string) {
  const normalized = normalizeRedeemCode(code)
  return normalized.replace(/(.{4})(?=.)/g, '$1-')
}

export async function createRedeemCodes(input: {
  createdByUserId: string
  count: number
  pointsPerCode: number
}) {
  const count = parsePositiveInt(input.count, 1, 1, 1000)
  const pointsPerCode = parsePositiveInt(input.pointsPerCode, 1, 1, 1_000_000)
  const createdAt = nowIso()
  const db = getDb()
  const existingCodes = new Set(
    (db.prepare('SELECT code FROM redeem_codes').all() as Array<{ code: string }>).map((row) => row.code),
  )

  const transaction = db.transaction(() => {
    const codes: string[] = []
    const insert = db.prepare(`
      INSERT OR IGNORE INTO redeem_codes (
        code,
        points,
        created_by_user_id,
        redeemed_by_user_id,
        created_at,
        redeemed_at
      ) VALUES (
        @code,
        @points,
        @createdByUserId,
        NULL,
        @createdAt,
        NULL
      )
    `)

    while (codes.length < count) {
      const code = generateRedeemCodeValue()
      if (existingCodes.has(code)) continue
      const result = insert.run({
        code,
        points: pointsPerCode,
        createdByUserId: input.createdByUserId,
        createdAt,
      })
      if (result.changes > 0) {
        existingCodes.add(code)
        codes.push(code)
      }
    }

    return codes
  })

  return transaction()
}

export async function redeemCode(input: {
  userId: string
  code: string
  dailyTarget: number
}) {
  const normalizedCode = normalizeRedeemCode(input.code)
  if (!normalizedCode) {
    throw createError({ statusCode: 400, statusMessage: '兑换码无效' })
  }

  const dailyTarget = parsePositiveInt(input.dailyTarget, 100, 1, 1_000_000)
  const now = new Date()
  const nowValue = nowIso(now)
  const db = getDb()

  const transaction = db.transaction(() => {
    const refill = refillAccountIfNeeded(db, input.userId, dailyTarget, now)
    const redeemRow = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(normalizedCode) as RedeemCodeRow | undefined
    if (!redeemRow) {
      throw createError({ statusCode: 400, statusMessage: '兑换码无效' })
    }
    if (redeemRow.redeemed_by_user_id) {
      throw createError({ statusCode: 409, statusMessage: '兑换码已被使用' })
    }

    const points = Math.max(0, Math.floor(Number(redeemRow.points) || 0))
    if (points <= 0) {
      throw createError({ statusCode: 400, statusMessage: '兑换码无效' })
    }

    const account = getOrCreateAccount(db, input.userId, nowValue)
    const nextBalance = account.balance + points
    setAccountBalance(db, input.userId, nextBalance, refill.lastDailyRefillDate, nowValue)
    db.prepare(`
      UPDATE redeem_codes
      SET redeemed_by_user_id = ?,
          redeemed_at = ?
      WHERE code = ?
    `).run(input.userId, nowValue, normalizedCode)
    insertLedger(db, {
      userId: input.userId,
      delta: points,
      balanceAfter: nextBalance,
      reason: 'redeem_code',
      referenceId: normalizedCode,
      note: '兑换码兑换积分',
      createdAt: nowValue,
    })

    return {
      code: normalizedCode,
      addedPoints: points,
      balance: nextBalance,
      lastDailyRefillDate: refill.lastDailyRefillDate,
      dailyRefilled: refill.dailyRefilled,
    }
  })

  return transaction() as RedeemResult
}

export function getRedeemCodeExportText(codes: string[], pointsPerCode: number) {
  return [
    `points=${pointsPerCode}`,
    `count=${codes.length}`,
    ...codes.map(formatRedeemCodeForExport),
  ].join('\n')
}
