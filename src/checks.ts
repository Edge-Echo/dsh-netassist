// dsh-netassist — reusable diagnostic checks.
//
// The plugin tools and the CLI share these; every check is a pure async
// function returning structured data. All user input crosses the PowerShell
// boundary as Base64 (injection-proof by construction).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// A cold powershell.exe on a fresh Windows machine can take ~20s to start, which is most
// of a check's wall time. Measured on a GitHub windows-latest runner: every tool hit a 25s
// timeout on a registry read that takes milliseconds once the process is warm.
export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_PROXY_PORTS = [10808, 10809, 7890, 7897, 8888, 1080]

export async function ps(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout.trim()
  } catch (err) {
        // Surface what the child process actually said. The previous message printed the whole
        // script and dropped stderr, which is the only part that says why it failed.
        const e = err as { stderr?: string; code?: number | string; signal?: string; killed?: boolean }
        const stderr = (e?.stderr ?? "").trim()
        const detail = stderr
          ? stderr.split(/\r?\n/).slice(0, 12).join("\n").slice(0, 1200)
          : "(no stderr)"
        const status = e?.killed
          ? `timed out after ${timeoutMs}ms`
          : e?.signal
            ? `killed by ${e.signal}`
            : `exit ${String(e?.code ?? "?")}`
        const preview = script.replace(/\s+/g, " ").slice(0, 160)
        throw new Error(
          `PowerShell failed (${status})\n  stderr: ${detail}\n  script: ${preview}${script.length > 160 ? "…" : ""}`
        )
  }
}

export function psJson<T>(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return ps(script, timeoutMs).then((s) => JSON.parse(s) as T)
}

export function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

export function psStr(base64: string): string {
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}'))`
}

/** PowerShell expression: TCP connect test; wrap in `$()` at the call site. */
export function tcpTestExpr(hostExpr: string, port: number | string, timeoutMs = 5000): string {
  return `$c = New-Object System.Net.Sockets.TcpClient; try { $t = $c.ConnectAsync(${hostExpr}, ${port}); if ($t.Wait(${timeoutMs})) { "OPEN" } else { "TIMEOUT" } } catch { "CLOSED" } finally { $c.Dispose() }`
}

const HOSTS_PATH = "$env:WINDIR + '\\System32\\drivers\\etc\\hosts'"
const PROXY_REG = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

export interface GithubStatus {
  dns: string[]
  tcp443: string
  reachable: boolean
  /** HTTP status code when the HTTPS probe succeeded. */
  httpStatus?: number
  /** Round-trip milliseconds for the TCP probe. */
  tcpMs?: number
}

/** DNS + TCP (+ optional HTTPS) reachability of github.com. */
export async function checkGithub(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GithubStatus> {
  const script = [
    '$ErrorActionPreference = "Continue"',
    'try { $dns = [System.Net.Dns]::GetHostAddresses("github.com") | ForEach-Object { $_.IPAddressToString } } catch { $dns = @("DNS_FAILED") }',
    '$sw = [System.Diagnostics.Stopwatch]::StartNew()',
    `$tcp = $(${tcpTestExpr('"github.com"', 443)})`,
    '$sw.Stop()',
    '$http = 0',
    'if ($tcp -eq "OPEN") {',
    '  $h = New-Object System.Net.Http.HttpClient; $h.Timeout = [TimeSpan]::FromSeconds(10)',
    '  try { $r = $h.GetAsync("https://github.com").GetAwaiter().GetResult(); $http = [int]$r.StatusCode } catch { $http = -1 }',
    '  $h.Dispose()',
    '}',
    '$out = [ordered]@{ dns = @($dns); tcp443 = $tcp; reachable = ($tcp -eq "OPEN"); httpStatus = $http; tcpMs = [int]$sw.ElapsedMilliseconds }',
    '$out | ConvertTo-Json -Compress',
  ].join('; ')
  return psJson<GithubStatus>(script, timeoutMs)
}

export interface ProxyStatus {
  enabled: boolean
  server: string
  override: string
  envHttp: string
  envHttps: string
  /** Parsed `host:port` of the effective proxy (system proxy when enabled, else env vars). */
  hostPort?: { host: string; port: number }
  /** Registry holds a proxy address while the Windows proxy switch is OFF. */
  staleServer?: string
}

function parseHostPort(candidate: string | undefined): { host: string; port: number } | undefined {
  if (!candidate) return undefined
  const cleaned = candidate.replace(/^[a-z]+:\/\//i, '').split(';')[0] ?? ''
  const [host, portText] = cleaned.split(':')
  const port = Number(portText)
  return host && Number.isFinite(port) ? { host, port } : undefined
}

export async function checkProxyStatus(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProxyStatus> {
  const script = [
    `$k = Get-ItemProperty '${PROXY_REG}' -ErrorAction SilentlyContinue`,
    '$out = [ordered]@{ enabled = ([bool]$k.ProxyEnable); server = "$($k.ProxyServer)"; override = "$($k.ProxyOverride)"; envHttp = "$env:HTTP_PROXY"; envHttps = "$env:HTTPS_PROXY" }',
    '$out | ConvertTo-Json -Compress',
  ].join('; ')
  const raw = await psJson<Omit<ProxyStatus, 'hostPort' | 'staleServer'>>(script, timeoutMs)
  const status: ProxyStatus = { ...raw }
  if (raw.enabled) {
    // An enabled system proxy wins; env vars are only relevant when it is off.
    status.hostPort = parseHostPort(raw.server) ?? parseHostPort(raw.envHttps) ?? parseHostPort(raw.envHttp)
  } else {
    const env = parseHostPort(raw.envHttps) ?? parseHostPort(raw.envHttp)
    if (env) status.hostPort = env
    else if (raw.server) status.staleServer = raw.server
  }
  return status
}

export interface PortProbe {
  port: number
  status: string
}

/** TCP probe of candidate local proxy ports. */
export async function checkProxyPorts(
  ports: number[] = DEFAULT_PROXY_PORTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PortProbe[]> {
  const script = [
    '$ErrorActionPreference = "Continue"',
    '$results = @()',
    `foreach ($p in @(${ports.join(',')})) {`,
    `  $st = $(${tcpTestExpr('"127.0.0.1"', '$p')})`,
    '  $results += [ordered]@{ port = [int]$p; status = $st }',
    '}',
    '$out = [ordered]@{ ports = @($results) }',
    '$out | ConvertTo-Json -Compress',
  ].join('; ')
  const r = await psJson<{ ports: PortProbe[] }>(script, timeoutMs)
  return r.ports ?? []
}

export interface HostsCheck {
  entries: string[]
  hasGithub: boolean
}

export async function checkHosts(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HostsCheck> {
  const script = [
    `$hits = @(Select-String -Path (${HOSTS_PATH}) -Pattern 'github' -ErrorAction SilentlyContinue)`,
    '$entries = @($hits | ForEach-Object { ($_.Line).Trim() })',
    '$out = [ordered]@{ entries = $entries; hasGithub = ($entries.Count -gt 0) }',
    '$out | ConvertTo-Json -Compress',
  ].join('; ')
  return psJson<HostsCheck>(script, timeoutMs)
}

export interface TunCheck {
  /** Names of virtual/TUN-style adapters that are up. */
  adapters: string[]
  detected: boolean
}

/** Detect TUN/TAP-style virtual adapters (system proxy is often bypassed under TUN). */
export async function checkTunAdapters(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TunCheck> {
  const script = [
    '$ErrorActionPreference = "Continue"',
    '$pat = "tun|tap|wintun|wireguard|clash|sing-box|singbox|utun|v2ray|xray|mihomo"',
    '$names = @()',
    'try {',
    '  $names = @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq "Up" -and ($_.Name -match $pat -or $_.InterfaceDescription -match $pat) } | ForEach-Object { $_.Name })',
    '} catch {',
    '  $names = @(Get-WmiObject Win32_NetworkAdapter -ErrorAction SilentlyContinue | Where-Object { $_.NetEnabled -eq $true -and ($_.Name -match $pat -or $_.Description -match $pat) } | ForEach-Object { $_.Name })',
    '}',
    '$out = [ordered]@{ adapters = @($names); detected = ($names.Count -gt 0) }',
    '$out | ConvertTo-Json -Compress',
  ].join('; ')
  return psJson<TunCheck>(script, timeoutMs)
}

export interface DiagResult {
  host: string
  dns: string[]
  tcp: string
  http: string
}

/** Full diagnosis chain for an arbitrary host. */
export async function checkDiag(host: string, port = 443, path = '/', timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DiagResult> {
  const scheme = port === 80 ? 'http' : 'https'
  const url = `${scheme}://${host}:${port}${path}`
  const hostExpr = psStr(b64(host))
  const urlExpr = psStr(b64(url))
  const script = [
    '$ErrorActionPreference = "Continue"',
    `try { $dns = [System.Net.Dns]::GetHostAddresses(${hostExpr}) | ForEach-Object { $_.IPAddressToString } } catch { $dns = @("DNS_FAILED") }`,
    `$tcp = $(${tcpTestExpr(hostExpr, port)})`,
    '$h = New-Object System.Net.Http.HttpClient; $h.Timeout = [TimeSpan]::FromSeconds(10)',
    `try { $r = $h.GetAsync(${urlExpr}).GetAwaiter().GetResult(); $http = "HTTP " + [int]$r.StatusCode } catch { $http = "FAILED" }`,
    '$h.Dispose()',
    `$out = [ordered]@{ host = ${psStr(b64(host))}; dns = @($dns); tcp = $tcp; http = $http }`,
    '$out | ConvertTo-Json -Compress',
  ].join('; ')
  return psJson<DiagResult>(script, timeoutMs)
}
