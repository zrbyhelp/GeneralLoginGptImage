interface ChatwootRunOptions {
  websiteToken: string
  baseUrl: string
}

interface ChatwootSettings {
  position: 'left' | 'right'
  type: 'standard' | 'expanded_bubble'
  launcherTitle: string
  hideMessageBubble: boolean
  showUnreadMessagesDialog: boolean
  showPopoutButton: boolean
  darkMode: 'light' | 'auto' | 'dark'
  useBrowserLanguage: boolean
}

declare global {
  interface Window {
    $chatwoot?: unknown
    chatwootSDK?: {
      run: (options: ChatwootRunOptions) => void
    }
    chatwootSettings?: ChatwootSettings
  }
}

const SDK_SCRIPT_ID = 'chatwoot-sdk'

function keepLauncherClearOfInputBar() {
  const root = document.documentElement
  let inputBar: Element | null = null
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null

  const updateOffset = () => {
    if (!inputBar?.isConnected) {
      inputBar = document.querySelector('[data-input-bar]')
      if (inputBar && resizeObserver) {
        resizeObserver.observe(inputBar)
        mutationObserver?.disconnect()
      }
    }

    if (!inputBar) return
    const { top } = inputBar.getBoundingClientRect()
    const offset = Math.max(96, Math.ceil(window.innerHeight - top + 12))
    root.style.setProperty('--chatwoot-bottom-offset', `${offset}px`)
  }

  resizeObserver = new ResizeObserver(updateOffset)
  mutationObserver = new MutationObserver(updateOffset)
  mutationObserver.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', updateOffset, { passive: true })
  window.visualViewport?.addEventListener('resize', updateOffset, { passive: true })
  updateOffset()
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const baseUrl = String(config.public.chatwootBaseUrl || '').replace(/\/+$/, '')
  const websiteToken = String(config.public.chatwootWebsiteToken || '')

  if (!baseUrl || !websiteToken) return

  keepLauncherClearOfInputBar()
  window.chatwootSettings = {
    position: 'right',
    type: 'standard',
    launcherTitle: '在线客服',
    hideMessageBubble: false,
    showUnreadMessagesDialog: false,
    showPopoutButton: true,
    darkMode: 'auto',
    useBrowserLanguage: true,
  }

  const startChatwoot = () => {
    if (window.$chatwoot) return
    window.chatwootSDK?.run({ websiteToken, baseUrl })
  }

  if (window.chatwootSDK) {
    startChatwoot()
    return
  }

  const existingScript = document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null
  if (existingScript) {
    existingScript.addEventListener('load', startChatwoot, { once: true })
    return
  }

  const script = document.createElement('script')
  script.id = SDK_SCRIPT_ID
  script.src = `${baseUrl}/packs/js/sdk.js`
  script.async = true
  script.addEventListener('load', startChatwoot, { once: true })
  script.addEventListener('error', () => {
    console.warn('Chatwoot SDK failed to load')
  }, { once: true })
  document.head.appendChild(script)
})
