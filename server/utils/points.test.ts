import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDatabasePathForTests } from './db'
import {
  createRedeemCodes,
  ensureDailyPointsBalance,
  redeemCode,
  reserveGenerationPoints,
  settleGenerationPoints,
} from './points'

let tempRoot = ''

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'gip-points-'))
  setDatabasePathForTests(join(tempRoot, 'app.db'))
})

afterEach(() => {
  setDatabasePathForTests(null)
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('points utilities', () => {
  it('tops users up to the daily target once per day', async () => {
    const first = await ensureDailyPointsBalance('user-a', 100)
    const second = await ensureDailyPointsBalance('user-a', 100)

    expect(first.balance).toBe(100)
    expect(first.dailyRefilled).toBe(true)
    expect(second.balance).toBe(100)
    expect(second.dailyRefilled).toBe(false)
  })

  it('reserves points for generation and refunds unused points', async () => {
    const reservation = await reserveGenerationPoints({
      userId: 'user-b',
      requestedImages: 2,
      costPerImage: 1,
      dailyTarget: 100,
      referenceId: 'job-1',
    })
    const settlement = await settleGenerationPoints({
      userId: 'user-b',
      reservedPoints: reservation.reservedPoints,
      actualImages: 1,
      costPerImage: 1,
      referenceId: 'job-1',
    })

    expect(reservation.reservedPoints).toBe(2)
    expect(reservation.balance).toBe(98)
    expect(settlement.chargedPoints).toBe(2)
    expect(settlement.refundedPoints).toBe(1)
    expect(settlement.balance).toBe(99)
  })

  it('creates one-time redeem codes that add points to the account', async () => {
    const codes = await createRedeemCodes({
      createdByUserId: 'admin-a',
      count: 2,
      pointsPerCode: 50,
    })

    expect(codes).toHaveLength(2)
    expect(codes[0]).toMatch(/^[A-Z0-9]{16}$/)

    const first = await redeemCode({
      userId: 'user-c',
      code: codes[0],
      dailyTarget: 100,
    })
    expect(first.addedPoints).toBe(50)
    expect(first.balance).toBe(150)

    await expect(redeemCode({
      userId: 'user-d',
      code: codes[0],
      dailyTarget: 100,
    })).rejects.toMatchObject({
      statusCode: 409,
    })
  })
})
