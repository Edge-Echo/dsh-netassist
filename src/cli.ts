#!/usr/bin/env node
// dsh-netassist CLI — diagnose the network path your agent actually uses.
//
//   dsh-netassist doctor [--json]        full preflight + suggestions
//   dsh-netassist github [--json]        GitHub reachability only
//   dsh-netassist proxy [--json]         system proxy + port probe
//   dsh-netassist hosts [--json]         GitHub entries in the hosts file
//   dsh-netassist diag <host> [--port N] [--path /] [--json]
//
// Exit codes: 0 = healthy, 1 = a problem was found, 2 = usage error.
import { readFileSync } from 'node:fs'
import { checkDiag, checkGithub, checkHosts, checkProxyPorts, checkProxyStatus } from './checks.js'
import { renderDoctor, runDoctor } from './doctor.js'

interface Args {
  command: string
  positional: string[]
  json: boolean
  port?: number
  path: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = { command: '', positional: [], json: false, path: '/' }
  const rest = [...argv]
  out.command = rest.shift() ?? ''
  while (rest.length) {
    const token = rest.shift()!
    switch (token) {
      case '--json': out.json = true; break
      case '--port': out.port = Number(rest.shift()); break
      case '--path': out.path = rest.shift() ?? '/'; break
      case '--help': case '-h': out.command = '--help'; break
      case '--version': case '-v': out.command = '--version'; break
      default:
        if (token.startsWith('--')) { console.error(`Unknown option: ${token}`); process.exit(2) }
        out.positional.push(token)
    }
  }
  return out
}

const HELP = `dsh-netassist — network & proxy diagnostics for DeepSeek Harness

Usage:
  dsh-netassist doctor [--json]
      Full preflight: system proxy, proxy port reachability, TUN detection,
      GitHub reachability and hosts conflicts — then concrete suggestions.

  dsh-netassist github [--json]
      GitHub reachability only (DNS, TCP 443, HTTPS status).

  dsh-netassist proxy [--json]
      System proxy settings plus a probe of common local proxy ports.

  dsh-netassist hosts [--json]
      GitHub-related entries in the Windows hosts file.

  dsh-netassist diag <host> [--port 443] [--path /] [--json]
      Full chain for any host: DNS → TCP → HTTP status.

Exit codes: 0 healthy · 1 problem found · 2 usage error.

Examples:
  dsh-netassist doctor
  dsh-netassist doctor --json > doctor.json
  dsh-netassist diag api.github.com --port 443
`

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === '--version') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    console.log(pkg.version)
    return 0
  }
  if (args.command === '' || args.command === '--help' || args.command === 'help') {
    console.log(HELP)
    return args.command === '' ? 2 : 0
  }

  if (args.command === 'doctor') {
    const report = await runDoctor()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(renderDoctor(report))
    }
    return report.ok ? 0 : 1
  }

  if (args.command === 'github') {
    const status = await checkGithub()
    if (args.json) console.log(JSON.stringify(status, null, 2))
    else {
      console.log(`DNS: ${status.dns.join(', ')}`)
      console.log(`TCP 443: ${status.tcp443}${status.tcpMs !== undefined ? ` (${status.tcpMs} ms)` : ''}`)
      if (status.httpStatus !== undefined) console.log(`HTTPS: ${status.httpStatus > 0 ? `HTTP ${status.httpStatus}` : 'failed'}`)
    }
    return status.reachable ? 0 : 1
  }

  if (args.command === 'proxy') {
    const [proxy, ports] = await Promise.all([checkProxyStatus(), checkProxyPorts()])
    if (args.json) console.log(JSON.stringify({ proxy, ports }, null, 2))
    else {
      console.log(`System proxy: ${proxy.enabled ? (proxy.server || '(enabled, no server)') : 'disabled'}`)
      console.log(`Override: ${proxy.override || '(none)'}`)
      console.log(`env HTTP_PROXY: ${proxy.envHttp || '(unset)'}`)
      console.log(`env HTTPS_PROXY: ${proxy.envHttps || '(unset)'}`)
      console.log('')
      console.log('Local proxy ports:')
      for (const p of ports) console.log(`  ${String(p.port).padStart(5)}  ${p.status}`)
    }
    return 0
  }

  if (args.command === 'hosts') {
    const hosts = await checkHosts()
    if (args.json) console.log(JSON.stringify(hosts, null, 2))
    else if (!hosts.hasGithub) console.log('No GitHub entries in the hosts file (clean).')
    else { console.log(`${hosts.entries.length} GitHub entry(ies):`); for (const e of hosts.entries) console.log(`  ${e}`) }
    return 0
  }

  if (args.command === 'diag') {
    const host = args.positional[0]
    if (!host) { console.error('Usage: dsh-netassist diag <host> [--port 443] [--path /]'); return 2 }
    const result = await checkDiag(host, args.port ?? 443, args.path)
    if (args.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(`DNS: ${result.dns.join(', ')}`)
      console.log(`TCP: ${result.tcp}`)
      console.log(result.http)
    }
    return result.tcp === 'OPEN' ? 0 : 1
  }

  console.error(`Unknown command: ${args.command}\n`)
  console.log(HELP)
  return 2
}

process.exit(await main())
