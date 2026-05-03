import { useRef } from 'react'
import { useStore, exportData, importData, clearAllData } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleClose = () => setShowSettings(false)
  useCloseOnEscape(showSettings, handleClose)

  if (!showSettings) return null

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await importData(file)
    event.target.value = ''
  }

  return (
    <div data-no-drag-select className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="select-none font-mono text-xs text-gray-400 dark:text-gray-500">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <section>
            <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
              <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
              </svg>
              习惯配置
            </h4>
            <div className="block">
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs text-gray-500 dark:text-gray-400">提交任务后清空输入框</span>
                <button
                  type="button"
                  onClick={() => setSettings({ clearInputAfterSubmit: !settings.clearInputAfterSubmit })}
                  className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${settings.clearInputAfterSubmit ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  role="switch"
                  aria-checked={settings.clearInputAfterSubmit}
                  aria-label="提交任务后清空输入框"
                >
                  <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ${settings.clearInputAfterSubmit ? 'translate-x-[11px]' : 'translate-x-[2px]'}`} />
                </button>
              </div>
              <div data-selectable-text className="text-[10px] text-gray-400 dark:text-gray-500">
                开启后，提交成功创建任务时会清空提示词和参考图。
              </div>
            </div>
          </section>

          <section className="border-t border-gray-100 pt-6 dark:border-white/[0.08]">
            <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
              <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              本地数据管理
            </h4>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => exportData()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                >
                  导出
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                >
                  导入
                </button>
                <input ref={importInputRef} type="file" accept=".zip" className="hidden" onChange={handleImport} />
              </div>
              <button
                onClick={() =>
                  setConfirmDialog({
                    title: '清空本地数据',
                    message: '确定要清空当前浏览器里的任务记录和图片数据吗？此操作不会删除服务器审计副本。',
                    action: () => clearAllData(),
                  })
                }
                className="w-full rounded-xl border border-red-200/80 bg-red-50/50 px-4 py-2.5 text-sm text-red-500 transition hover:bg-red-100/80 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
              >
                清空本地数据
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
