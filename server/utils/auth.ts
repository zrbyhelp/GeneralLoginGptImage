import { createError, deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { generateToken, sha256 } from './crypto'
import { getDb } from './db'

export interface AppUser {
  id: string
  account: string | null
  email: string | null
  username: string | null
  name: string | null
  avatarUrl: string | null
  status: string
}

interface AppSession {
  tokenHash: string
  user: AppUser
  expiresAt: string
  createdAt: string
  lastSeenAt: string
}

const SESSION_COOKIE = 'gip_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

interface SessionRow {
  token_hash: string
  user_id: string
  user_account: string | null
  user_email: string | null
  user_username: string | null
  user_name: string | null
  user_avatar_url: string | null
  user_status: string
  created_at: string
  last_seen_at: string
  expires_at: string
}

function rowToSession(row: SessionRow): AppSession {
  return {
    tokenHash: row.token_hash,
    user: {
      id: row.user_id,
      account: row.user_account,
      email: row.user_email,
      username: row.user_username,
      name: row.user_name,
      avatarUrl: row.user_avatar_url,
      status: row.user_status,
    },
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  }
}

function deleteExpiredSessions(nowIso = new Date().toISOString()) {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso)
}

function splitRuntimeList(value: unknown) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminUser(user: AppUser | null | undefined) {
  if (!user) return false
  const config = useRuntimeConfig()
  const accounts = splitRuntimeList(config.adminAccounts)
  const emails = splitRuntimeList(config.adminEmails)
  const account = (user.account || '').toLowerCase()
  const email = (user.email || '').toLowerCase()
  return Boolean((account && accounts.includes(account)) || (email && emails.includes(email)))
}

export async function createAppSession(event: H3Event, user: AppUser) {
  const token = generateToken(32)
  const now = new Date()
  const session: AppSession = {
    tokenHash: sha256(token),
    user,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  }

  const db = getDb()
  deleteExpiredSessions(now.toISOString())
  db.prepare(`
    INSERT INTO sessions (
      token_hash,
      user_id,
      user_account,
      user_email,
      user_username,
      user_name,
      user_avatar_url,
      user_status,
      created_at,
      last_seen_at,
      expires_at
    ) VALUES (
      @tokenHash,
      @userId,
      @userAccount,
      @userEmail,
      @userUsername,
      @userName,
      @userAvatarUrl,
      @userStatus,
      @createdAt,
      @lastSeenAt,
      @expiresAt
    )
  `).run({
    tokenHash: session.tokenHash,
    userId: user.id,
    userAccount: user.account,
    userEmail: user.email,
    userUsername: user.username,
    userName: user.name,
    userAvatarUrl: user.avatarUrl,
    userStatus: user.status,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
  })

  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function clearAppSession(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) {
    const tokenHash = sha256(token)
    const db = getDb()
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    deleteExpiredSessions()
  }
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export async function getCurrentUser(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null

  const tokenHash = sha256(token)
  const nowIso = new Date().toISOString()
  const db = getDb()
  deleteExpiredSessions(nowIso)
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, nowIso) as SessionRow | undefined
  const session = row ? rowToSession(row) : null
  if (!session) return null

  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(nowIso, tokenHash)

  return session.user
}

export async function requireUser(event: H3Event) {
  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  if (user.status === 'SUSPENDED') {
    throw createError({ statusCode: 403, statusMessage: '账号已停用' })
  }
  return user
}

export async function requireAdmin(event: H3Event) {
  const user = await requireUser(event)
  if (!isAdminUser(user)) {
    throw createError({ statusCode: 403, statusMessage: '无管理员权限' })
  }
  return user
}
