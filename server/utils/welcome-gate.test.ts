import { describe, expect, it } from 'vitest'
import { decideWelcomeGate } from './welcome-gate'

const documentHeaders = { secFetchDest: 'document', accept: 'text/html' }

describe('welcome gate', () => {
  it('shows the welcome page for a fresh document visit', () => {
    expect(decideWelcomeGate({
      method: 'GET',
      pathname: '/',
      search: '',
      entered: false,
      ...documentHeaders,
    })).toEqual({ type: 'welcome' })
  })

  it('lets a browser without fetch metadata through when it asks for html', () => {
    expect(decideWelcomeGate({
      method: 'GET',
      pathname: '/',
      search: '',
      entered: false,
      accept: '*/*',
    })).toEqual({ type: 'welcome' })
  })

  it('passes the original site after the visitor has chosen to continue', () => {
    expect(decideWelcomeGate({
      method: 'GET',
      pathname: '/',
      search: '',
      entered: true,
      ...documentHeaders,
    })).toEqual({ type: 'pass' })
  })

  it('turns the continue link into a same-path entry and drops only that flag', () => {
    expect(decideWelcomeGate({
      method: 'GET',
      pathname: '/',
      search: '?continue=1&tab=gallery',
      entered: false,
      ...documentHeaders,
    })).toEqual({ type: 'enter', location: '/?tab=gallery' })
  })

  it('does not replace api, assets, or subresource requests', () => {
    expect(decideWelcomeGate({
      method: 'GET',
      pathname: '/api/auth/me',
      search: '',
      entered: false,
      ...documentHeaders,
    })).toEqual({ type: 'pass' })

    expect(decideWelcomeGate({
      method: 'GET',
      pathname: '/sw.js',
      search: '',
      entered: false,
      secFetchDest: 'script',
    })).toEqual({ type: 'pass' })

    expect(decideWelcomeGate({
      method: 'GET',
      pathname: '/',
      search: '',
      entered: false,
      secFetchDest: 'empty',
      accept: '*/*',
    })).toEqual({ type: 'pass' })

    expect(decideWelcomeGate({
      method: 'POST',
      pathname: '/',
      search: '',
      entered: false,
      ...documentHeaders,
    })).toEqual({ type: 'pass' })
  })
})
