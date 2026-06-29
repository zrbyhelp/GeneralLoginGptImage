import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import Busboy from 'busboy'
import { createError, getRequestHeader, type H3Event } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { restoreUploadedBackupNow } from '../../../utils/backup'

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

type UploadedBackup = {
  filePath: string
  fileName: string
  sizeBytes: number
  confirmationFileName: string
}

function parseContentLength(value: string | undefined) {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function readUploadedBackup(event: H3Event): Promise<UploadedBackup> {
  const contentType = getRequestHeader(event, 'content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    throw createError({ statusCode: 400, statusMessage: '请求必须为 multipart/form-data' })
  }
  const contentLength = parseContentLength(getRequestHeader(event, 'content-length'))
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '备份文件超过 512MiB 限制' })
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'gip-upload-restore-'))
  mkdirSync(tempRoot, { recursive: true })

  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: event.node.req.headers,
      limits: {
        files: 1,
        fileSize: MAX_UPLOAD_BYTES,
        fields: 4,
      },
    })
    let filePath = ''
    let fileName = ''
    let sizeBytes = 0
    let confirmationFileName = ''
    let fileWritePromise: Promise<void> | null = null
    let settled = false

    function fail(error: unknown) {
      if (settled) return
      settled = true
      rmSync(tempRoot, { recursive: true, force: true })
      reject(error)
    }

    busboy.on('field', (name, value) => {
      if (name === 'confirmationFileName') confirmationFileName = String(value || '')
    })

    busboy.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.resume()
        return
      }
      fileName = basename(info.filename || '')
      if (!fileName) {
        file.resume()
        fail(createError({ statusCode: 400, statusMessage: '缺少备份文件名' }))
        return
      }
      if (!fileName.endsWith('.db.gz')) {
        file.resume()
        fail(createError({ statusCode: 400, statusMessage: '只能上传 .db.gz 备份文件' }))
        return
      }

      filePath = join(tempRoot, 'uploaded.db.gz')
      file.on('data', (chunk: Buffer) => {
        sizeBytes += chunk.byteLength
      })
      file.on('limit', () => {
        fail(createError({ statusCode: 413, statusMessage: '备份文件超过 512MiB 限制' }))
      })
      fileWritePromise = pipeline(file, createWriteStream(filePath))
        .then(() => undefined)
        .catch(fail)
    })

    busboy.on('error', fail)
    busboy.on('finish', async () => {
      if (settled) return
      try {
        if (!fileWritePromise || !filePath || !fileName) {
          throw createError({ statusCode: 400, statusMessage: '缺少备份文件' })
        }
        await fileWritePromise
        if (sizeBytes <= 0) {
          throw createError({ statusCode: 400, statusMessage: '备份文件为空' })
        }
        settled = true
        resolve({ filePath, fileName, sizeBytes, confirmationFileName })
      } catch (error) {
        fail(error)
      }
    })

    event.node.req.pipe(busboy)
  })
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const uploaded = await readUploadedBackup(event)
  try {
    return await restoreUploadedBackupNow(uploaded)
  } finally {
    rmSync(dirname(uploaded.filePath), { recursive: true, force: true })
  }
})
