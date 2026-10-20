// Portable network primitives.
//
// These use Node itself (dns, net, http, https) rather than PowerShell. Not a style preference:
// the same primitives work on Linux and macOS, so a future port of this plugin does not have to
// rewrite every check, and the DNS-server comparison below is only possible with an explicit
// resolver — PowerShell's Resolve-DnsName needs a different code path per platform.
import { Resolver } from 'node:dns/promises'
import { connect } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export interface TcpResult {
  state: 'OPEN' | 'CLOSED' | 'TIMEOUT'
  ms: number
}

/** TCP connect test with a bounded wait; never rejects. */
export function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<TcpResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const socket = connect({ host, port })
    const finish = (state: TcpResult['state']) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ state, ms: Date.now() - started })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish('OPEN'))
    socket.once('timeout', () => finish('TIMEOUT'))
    socket.once('error', () => finish('CLOSED'))
  })
}

/** HTTP status code for a URL, or -1 when the request could not complete. */
export function httpStatus(url: string, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve) => {
    let settled = false
    const done = (code: number) => {
      if (settled) return
      settled = true
      resolve(code)
    }
    try {
      const u = new URL(url)
      const doRequest = u.protocol === 'http:' ? httpRequest : httpsRequest
      const req = doRequest(url, { timeout: timeoutMs, method: 'GET' }, (res) => {
        res.resume()
        done(res.statusCode ?? 0)
      })
      req.on('timeout', () => {
        req.destroy()
        done(-1)
      })
      req.on('error', () => done(-1))
      req.end()
    } catch {
      done(-1)
    }
  })
}

export interface ResolveResult {
  addresses: string[]
  ms: number
  error?: string
}

/**
 * Resolve a host through one specific DNS server.
 *
 * The system resolver cannot answer "which DNS server would work here", which is the actual
 * question when GitHub resolves to a stale address.
 */
export async function resolveVia(server: string, host: string, timeoutMs = 4000): Promise<ResolveResult> {
  const started = Date.now()
  try {
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 })
    resolver.setServers([server])
    const addresses = (await resolver.resolve4(host)).sort()
    return { addresses, ms: Date.now() - started }
  } catch (err) {
    return {
      addresses: [],
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
