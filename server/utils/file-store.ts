import { rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export function resolveConfiguredPath(value: string, fallback = process.cwd()) {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return isAbsolute(trimmed) ? trimmed : resolve(fallback, trimmed)
}

export function getAppDataRoot() {
  const config = useRuntimeConfig()
  return resolveConfiguredPath(String(config.appDataDir || 'storage/app-data'))
}

export function getGeneratedImageRoot() {
  const config = useRuntimeConfig()
  return resolveConfiguredPath(String(config.storageDir || 'storage/generated-images'))
}

export function appDataPath(fileName: string) {
  return join(getAppDataRoot(), fileName)
}

export async function removeFileIfExists(filePath: string) {
  await rm(filePath, { force: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
}
