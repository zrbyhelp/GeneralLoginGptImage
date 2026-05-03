import { createHash, randomBytes } from 'node:crypto'

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

export function generateToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function generateId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString('hex')}`
}
