import { loadAndApplyBackupSchedule, recoverStaleBackupRecords, stopBackupSchedule } from '../utils/backup'

export default defineNitroPlugin((nitroApp) => {
  recoverStaleBackupRecords()
  void loadAndApplyBackupSchedule().catch((error) => {
    console.error('[backup] load schedule failed:', error)
  })

  nitroApp.hooks.hook('close', () => {
    stopBackupSchedule()
  })
})
