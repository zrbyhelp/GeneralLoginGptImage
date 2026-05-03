import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createError, sendStream, setHeader } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { findAuditImage } from '../../../utils/audits'
import { getGeneratedImageRoot } from '../../../utils/file-store'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = event.context.params?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少图片 ID' })
  const found = await findAuditImage(id)
  if (!found) throw createError({ statusCode: 404, statusMessage: '图片不存在' })
  setHeader(event, 'Content-Type', found.image.mime)
  setHeader(event, 'Cache-Control', 'private, max-age=60')
  return sendStream(event, createReadStream(join(getGeneratedImageRoot(), found.image.relativePath)))
})
