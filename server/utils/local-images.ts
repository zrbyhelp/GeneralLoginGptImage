import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createError } from 'h3'
import { getGeneratedImageRoot, removeFileIfExists } from './file-store'
import { generateId, sha256 } from './crypto'
import type { GenerationAuditImage } from './audits'

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) {
    throw createError({ statusCode: 400, statusMessage: '图片数据格式无效' })
  }
  const mime = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
  return { mime, buffer }
}

function datePartition() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

export async function saveGeneratedImages(auditId: string, dataUrls: string[]) {
  const root = getGeneratedImageRoot()
  const partition = datePartition()
  const dir = join(root, partition)
  await mkdir(dir, { recursive: true })

  const records: GenerationAuditImage[] = []
  const writtenRelativePaths: string[] = []
  try {
    for (let index = 0; index < dataUrls.length; index += 1) {
      const { mime, buffer } = dataUrlToBuffer(dataUrls[index])
      const id = generateId('img')
      const ext = MIME_EXT[mime] ?? 'bin'
      const fileName = `${auditId}-${index + 1}-${id}.${ext}`
      const relativePath = `${partition}/${fileName}`
      writtenRelativePaths.push(relativePath)
      await writeFile(join(root, relativePath), buffer)
      records.push({
        id,
        auditId,
        fileName,
        relativePath,
        mime,
        size: buffer.byteLength,
        hash: sha256(buffer),
        createdAt: new Date().toISOString(),
      })
    }
  } catch (error) {
    await Promise.all(writtenRelativePaths.map((relativePath) => removeFileIfExists(join(root, relativePath))))
    throw error
  }

  return records
}

export async function deleteGeneratedImages(images: GenerationAuditImage[]) {
  const root = getGeneratedImageRoot()
  await Promise.all(images.map((image) => removeFileIfExists(join(root, image.relativePath))))
}
