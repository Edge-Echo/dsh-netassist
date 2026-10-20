// Two checks that answer the questions the original set could not.
//
// `net_github_status` says whether GitHub is reachable *now*; it cannot say whether a different
// DNS server would have worked. And every "npm install failed" in this environment comes down to
// the registry, which nothing checked. Both are portable: they use Node primitives only.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { httpStatus, resolveVia, tcpProbe } from './probe.js'

/** Public resolvers worth comparing from mainland China, plus the two global ones. */
export const DEFAULT_DNS_SERVERS = [
  { name: 'AliDNS', ip: '223.5.5.5' },
  { name: 'DNSPod', ip: '119.29.29.29' },
  { name: 'Cloudflare', ip: '1.1.1.1' },
  { name: 'Google', ip: '8.8.8.8' },
] as const

export interface DnsServerAnswer {
  name: string
  server: string
  addresses: string[]
  ms: number
  error?: string
}

export interface DnsCompareResult {
  host: string
  answers: DnsServerAnswer[]
  /** True when every server that answered returned the same address set. */
  consistent: boolean
  /** Servers that answered at all. */
  responding: number
}

/**
 * Ask several DNS servers the same question and compare.
 *
 * A stale or poisoned answer from the system resolver is invisible until you see what other
 * resolvers return for the same name.
 */
export async function checkDnsCompare(host = 'github.com', timeoutMs = 4000): Promise<DnsCompareResult> {
  const answers = await Promise.all(
    DEFAULT_DNS_SERVERS.map(async (s) => {
      const r = await resolveVia(s.ip, host, timeoutMs)
      return { name: s.name, server: s.ip, addresses: r.addresses, ms: r.ms, ...(r.error ? { error: r.error } : {}) }
    }),
  )
  const answered = answers.filter((a) => a.addresses.length > 0)
  const distinct = new Set(answered.map((a) => a.addresses.join(',')))
  return {
    host,
    answers,
    consistent: distinct.size <= 1,
    responding: answered.length,
  }
}

export interface RegistryProbe {
  registry: string
  host: string
  tcp: string
  http: number
  ms: number
}

export interface RegistryCheck {
  /** The registry npm would use right now. */
  configured: string
  probes: RegistryProbe[]
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** What registry npm would actually use: env var, then ~/.npmrc, then the default. */
export function configuredRegistry(): string {
  if (process.env.npm_config_registry) return process.env.npm_config_registry
  try {
    const npmrc = readFileSync(join(homedir(), '.npmrc'), 'utf8')
    const match = npmrc.match(/^\s*registry\s*=\s*(\S+)\s*$/m)
    if (match) return match[1]
  } catch {
    /* no user npmrc */
  }
  return DEFAULT_REGISTRY
}

/** Probe the npm registry npm is configured to use, plus the official one when they differ. */
export async function checkRegistry(timeoutMs = 5000): Promise<RegistryCheck> {
  const configured = configuredRegistry()
  const targets = [...new Set([DEFAULT_REGISTRY, configured])]
  const probes = await Promise.all(
    targets.map(async (registry) => {
      let host = ''
      try {
        host = new URL(registry).host
      } catch {
        return { registry, host: '', tcp: 'INVALID', http: -1, ms: 0 }
      }
      const [tcp, http] = await Promise.all([
        tcpProbe(host, 443, timeoutMs),
        httpStatus(`https://${host}`, timeoutMs),
      ])
      return { registry, host, tcp: tcp.state, http, ms: tcp.ms }
    }),
  )
  return { configured, probes }
}
