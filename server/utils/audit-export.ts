import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import type { GenerationAudit, GenerationAuditImage } from './audits'
import { getGeneratedImageRoot } from './file-store'

type ExportAuditImage = GenerationAuditImage & {
  exportPath: string
  missing?: boolean
}

type ExportAudit = Omit<GenerationAudit, 'outputImages'> & {
  outputImages: ExportAuditImage[]
}

export interface AuditExportManifest {
  exportedAt: string
  total: number
  items: ExportAudit[]
}

function imageExportPath(image: GenerationAuditImage) {
  return `images/${image.fileName.replace(/[\\/]/g, '_')}`
}

export async function buildAuditExportZip(audits: GenerationAudit[]) {
  const exportedAt = new Date()
  const root = getGeneratedImageRoot()
  const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}
  const items: ExportAudit[] = []

  for (const audit of audits) {
    const outputImages: ExportAuditImage[] = []
    for (const image of audit.outputImages) {
      const exportPath = imageExportPath(image)
      const exportImage: ExportAuditImage = { ...image, exportPath }
      try {
        const bytes = await readFile(join(root, image.relativePath))
        zipFiles[exportPath] = [new Uint8Array(bytes), { mtime: new Date(image.createdAt) }]
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
        exportImage.missing = true
      }
      outputImages.push(exportImage)
    }
    items.push({ ...audit, outputImages })
  }

  const manifest: AuditExportManifest = {
    exportedAt: exportedAt.toISOString(),
    total: items.length,
    items,
  }
  zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: exportedAt }]

  return Buffer.from(zipSync(zipFiles, { level: 6 }))
}
