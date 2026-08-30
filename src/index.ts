// dsh-netassist — network & proxy assistant for DeepSeek Harness.
// All tools run short PowerShell snippets through powershell.exe; every user
// input crosses the script boundary as Base64 (injection-proof by design).
// Every tool returns STRUCTURED output (object schema) with presentationMeta
// projection and presentCall/presentResult UI cards.
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Plugin config: per-call PowerShell timeout. */
export interface NetassistConfig {
  psTimeoutMs?: number
}

async function ps(script: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout.trim()
  } catch (err) {
    const e = err as { message?: string }
    throw new Error(`PowerShell failed: ${e?.message ?? String(err)}`)
  }
}

/** Parse PS JSON output into a typed value. */
function psJson<T>(script: string, timeoutMs: number): Promise<T> {
  return ps(script, timeoutMs).then((s) => JSON.parse(s) as T)
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

function psStr(base64: string): string {
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}'))`
}

/** PowerShell expression: TCP connect test; evaluates to OPEN/TIMEOUT/CLOSED inside `$()`. */
function tcpTestExpr(hostExpr: string, port: number, timeoutMs = 5000): string {
  return `$c = New-Object System.Net.Sockets.TcpClient; try { $t = $c.ConnectAsync(${hostExpr}, ${port}); if ($t.Wait(${timeoutMs})) { "OPEN" } else { "TIMEOUT" } } catch { "CLOSED" } finally { $c.Dispose() }`
}

/** Read presentation meta from a result, typed. */
function meta<T>(result: { meta?: unknown }): T | undefined {
  return result.meta as T | undefined
}

const HOSTS_PATH = "$env:WINDIR + '\\System32\\drivers\\etc\\hosts'"
const PROXY_REG = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

export default Object.assign(
  function netassist(ctx: Context, config: NetassistConfig = {}) {
    const timeoutMs = config.psTimeoutMs ?? 25000

    // ── 1. net_github_status ──────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_github_status',
      description: 'One-shot GitHub connectivity check: DNS resolution and TCP 443 reachability for github.com. Direct answer to "is GitHub reachable right now?".',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dns: { type: 'array', items: { type: 'string' }, required: true },
            tcp443: { type: 'string', required: true },
            reachable: { type: 'boolean', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: `GitHub reachable: ${value.reachable} | DNS: ${value.dns.join(', ')} | TCP 443: ${value.tcp443}`,
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Checking GitHub connectivity',
        kind: 'fetch',
        rawInput: 'github.com:443',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ dns?: string[]; tcp443?: string; reachable?: boolean }>(result)
        return {
          card: 'generic',
          title: m?.reachable ? 'GitHub: reachable' : 'GitHub: unreachable',
          content: [{ type: 'text', text: `TCP 443: ${m?.tcp443 ?? '?'} | DNS: ${m?.dns?.join(', ') ?? '?'}` }],
        }
      },
      async execute() {
        const script = [
          '$ErrorActionPreference = "Continue"',
          'try { $dns = [System.Net.Dns]::GetHostAddresses("github.com") | ForEach-Object { $_.IPAddressToString } } catch { $dns = @("DNS_FAILED") }',
          `$tcp = $(${tcpTestExpr('"github.com"', 443)})`,
          '$out = [ordered]@{ dns = @($dns); tcp443 = $tcp; reachable = ($tcp -eq "OPEN") }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))

    // ── 2. net_proxy_status ───────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_proxy_status',
      description: 'Show the Windows system proxy configuration (registry) and proxy environment variables. Helps distinguish "system proxy" vs "TUN mode" vs "no proxy".',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', required: true },
            server: { type: 'string', required: true },
            override: { type: 'string', required: true },
            envHttp: { type: 'string', required: true },
            envHttps: { type: 'string', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: `System proxy: ${value.enabled ? value.server : 'disabled'} | env HTTP: ${value.envHttp || '(none)'} | env HTTPS: ${value.envHttps || '(none)'}`,
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Reading system proxy settings',
        kind: 'read',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ enabled?: boolean; server?: string; override?: string; envHttp?: string; envHttps?: string }>(result)
        return {
          card: 'generic',
          title: m?.enabled ? `Proxy: ${m.server ?? '?'}` : 'Proxy: disabled',
          content: [{
            type: 'text',
            text: `Override: ${m?.override || '(none)'} | env HTTP: ${m?.envHttp || '(none)'} | env HTTPS: ${m?.envHttps || '(none)'}`,
          }],
        }
      },
      async execute() {
        const script = [
          `$k = Get-ItemProperty '${PROXY_REG}' -ErrorAction SilentlyContinue`,
          '$out = [ordered]@{ enabled = ([bool]$k.ProxyEnable); server = "$($k.ProxyServer)"; override = "$($k.ProxyOverride)"; envHttp = "$env:HTTP_PROXY"; envHttps = "$env:HTTPS_PROXY" }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))

    // ── 3. net_proxy_probe ────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_proxy_probe',
      description: 'Probe common local proxy ports (socks/http) for TCP reachability. Default ports: 10808, 10809, 7890, 7897, 8888, 1080. Pass custom ports to override.',
      parameters: {
        ports: {
          type: 'array',
          items: { type: 'integer', description: 'TCP port' },
          description: 'Ports to probe (default: 10808, 10809, 7890, 7897, 8888, 1080)',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ports: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  port: { type: 'integer', required: true },
                  status: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: value.ports.map((p) => `${p.port}:${p.status}`).join(' '),
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (_a): ToolCallView => ({
        card: 'generic',
        title: 'Probing local proxy ports',
        kind: 'search',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ ports?: { port: number; status: string }[] }>(result)
        const open = m?.ports?.filter((p) => p.status === 'OPEN') ?? []
        return {
          card: 'generic',
          title: `Proxy ports: ${open.length} open`,
          content: [{
            type: 'text',
            text: open.length
              ? `Open: ${open.map((p) => p.port).join(', ')}`
              : 'No common proxy port is open',
          }],
        }
      },
      async execute(args) {
        const ports = ((args.ports as number[] | undefined) ?? [10808, 10809, 7890, 7897, 8888, 1080])
        const portsLit = ports.join(',')
        const probeExpr = tcpTestExpr('"127.0.0.1"', 0).replace(', 0)', ', $p)')
        const script = [
          '$ErrorActionPreference = "Continue"',
          '$results = @()',
          `foreach ($p in @(${portsLit})) {`,
          `  $st = $(${probeExpr})`,
          '  $results += [ordered]@{ port = [int]$p; status = $st }',
          '}',
          '$out = [ordered]@{ ports = @($results) }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson<{ ports: { port: number; status: string }[] }>(script, timeoutMs)
      },
    }))

    // ── 4. net_diag ───────────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_diag',
      description: 'Full reachability diagnosis for any host: DNS resolution, TCP port test, then an HTTPS status check. Use port 80 for plain HTTP.',
      parameters: {
        host: { type: 'string', description: 'Hostname or IP address', required: true },
        port: { type: 'integer', description: 'TCP port to test (default 443)' },
        path: { type: 'string', description: 'URL path for the HTTP check (default /)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            host: { type: 'string', required: true },
            dns: { type: 'array', items: { type: 'string' }, required: true },
            tcp: { type: 'string', required: true },
            http: { type: 'string', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: `${value.host} | DNS: ${value.dns.join(', ')} | TCP: ${value.tcp} | ${value.http}`,
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (args): ToolCallView => ({
        card: 'generic',
        title: `Diagnosing ${(args as { host?: string }).host ?? 'host'}`,
        kind: 'fetch',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ host?: string; dns?: string[]; tcp?: string; http?: string }>(result)
        return {
          card: 'generic',
          title: `${m?.host ?? 'Host'}: ${m?.tcp ?? '?'} / ${m?.http ?? '?'}`,
          content: [{ type: 'text', text: `DNS: ${m?.dns?.join(', ') ?? '?'}` }],
        }
      },
      async execute(args) {
        const host = args.host as string
        const port = (args.port ?? 443) as number
        const path = (args.path as string | undefined) ?? '/'
        const scheme = port === 80 ? 'http' : 'https'
        const url = `${scheme}://${host}:${port}${path}`
        const hostExpr = psStr(b64(host))
        const urlExpr = psStr(b64(url))
        const script = [
          '$ErrorActionPreference = "Continue"',
          `try { $dns = [System.Net.Dns]::GetHostAddresses(${hostExpr}) | ForEach-Object { $_.IPAddressToString } } catch { $dns = @("DNS_FAILED") }`,
          `$tcp = $(${tcpTestExpr(hostExpr, port)})`,
          `$h = New-Object System.Net.Http.HttpClient; $h.Timeout = [TimeSpan]::FromSeconds(10)`,
          `try { $r = $h.GetAsync(${urlExpr}).GetAwaiter().GetResult(); $http = "HTTP " + [int]$r.StatusCode } catch { $http = "FAILED" }`,
          '$h.Dispose()',
          `$out = [ordered]@{ host = ${psStr(b64(host))}; dns = @($dns); tcp = $tcp; http = $http }`,
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))

    // ── 5. net_hosts_check ────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_hosts_check',
      description: 'Scan the Windows hosts file for GitHub-related entries. Pinned hosts entries can conflict with a proxy — this lists what is pinned so you can spot the clash.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entries: { type: 'array', items: { type: 'string' }, required: true },
            hasGithub: { type: 'boolean', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: value.hasGithub
            ? `Found ${value.entries.length} GitHub entries in hosts:\n${value.entries.join('\n')}`
            : 'No GitHub entries in hosts (clean)',
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Scanning hosts file for GitHub entries',
        kind: 'search',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ entries?: string[]; hasGithub?: boolean }>(result)
        return {
          card: 'generic',
          title: m?.hasGithub ? `Hosts: ${m.entries?.length ?? 0} GitHub entries` : 'Hosts: clean',
          content: [{
            type: 'text',
            text: m?.hasGithub ? (m.entries ?? []).join('\n') : 'No GitHub entries in hosts',
          }],
        }
      },
      async execute() {
        const script = [
          `$hits = @(Select-String -Path (${HOSTS_PATH}) -Pattern 'github' -ErrorAction SilentlyContinue)`,
          '$entries = @($hits | ForEach-Object { ($_.Line).Trim() })',
          '$out = [ordered]@{ entries = $entries; hasGithub = ($entries.Count -gt 0) }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))
  },
  { inject: ['tools'] },
)
