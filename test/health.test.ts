import { describe, expect, it } from 'vitest'

import { healthCheck } from '../src/worker/health'

describe('healthCheck', () => {
  it('answers GET /healthz with an uncached plain-text ok', async () => {
    const response = healthCheck(new Request('https://tend.n8builds.dev/healthz'))
    expect(response?.status).toBe(200)
    expect(await response?.text()).toBe('ok')
    expect(response?.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response?.headers.get('Cache-Control')).toBe('no-store')
    expect(response?.headers.get('Set-Cookie')).toBeNull()
  })

  it('answers HEAD without a body', async () => {
    const response = healthCheck(new Request('https://tend.n8builds.dev/healthz', { method: 'HEAD' }))
    expect(response?.status).toBe(200)
    expect(await response?.text()).toBe('')
  })

  it('leaves every other path and method to the app', () => {
    expect(healthCheck(new Request('https://tend.n8builds.dev/'))).toBeNull()
    expect(healthCheck(new Request('https://tend.n8builds.dev/healthz/x'))).toBeNull()
    expect(healthCheck(new Request('https://tend.n8builds.dev/healthz', { method: 'POST' }))).toBeNull()
  })
})
