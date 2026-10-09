export const ENTER_SITE_COOKIE = 'gip_enter_site'

export interface WelcomeGateInput {
  method: string
  pathname: string
  search: string
  accept?: string
  secFetchDest?: string
  upgrade?: string
  entered: boolean
}

export type WelcomeGateDecision =
  | { type: 'pass' }
  | { type: 'welcome' }
  | { type: 'enter'; location: string }

function isBypassedPath(pathname: string) {
  if (pathname === '/api' || pathname.startsWith('/api/')) return true
  if (pathname.startsWith('/_nuxt') || pathname.startsWith('/__nuxt') || pathname.startsWith('/@')) return true
  if (pathname.startsWith('/node_modules/')) return true
  const lastSegment = pathname.split('/').pop() || ''
  return lastSegment.includes('.')
}

function isDocumentNavigation(accept: string | undefined, secFetchDest: string | undefined) {
  const dest = secFetchDest?.trim().toLowerCase()
  if (dest === 'document') return true
  if (dest) return false

  const header = (accept || '').toLowerCase()
  if (!header || header.includes('*/*')) return true
  return header.includes('text/html') || header.includes('application/xhtml+xml')
}

function enterLocation(pathname: string, search: string) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (params.get('continue') !== '1') return null
  params.delete('continue')
  const query = params.toString()
  return `${pathname || '/'}${query ? `?${query}` : ''}`
}

export function decideWelcomeGate(input: WelcomeGateInput): WelcomeGateDecision {
  const method = input.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return { type: 'pass' }
  if ((input.upgrade || '').toLowerCase() === 'websocket') return { type: 'pass' }
  if (isBypassedPath(input.pathname || '/')) return { type: 'pass' }

  const location = enterLocation(input.pathname || '/', input.search || '')
  if (location && isDocumentNavigation(input.accept, input.secFetchDest)) {
    return { type: 'enter', location }
  }
  if (input.entered) return { type: 'pass' }
  if (isDocumentNavigation(input.accept, input.secFetchDest)) return { type: 'welcome' }
  return { type: 'pass' }
}
