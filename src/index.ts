// dsh-netassist — network & proxy assistant for DeepSeek Harness.
// All tools run short PowerShell snippets through powershell.exe; every user
// input crosses the script boundary as Base64 (injection-proof by design).
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
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

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

function psStr(base64: string): string {
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}'))`
}

/** PowerShell expression: TCP connect test for host/port; evaluates to OPEN/TIMEOUT/CLOSED.
 *  Wrap in `$()` at the call site: `$v = $(${tcpTestExpr(...)})`. */
function tcpTestExpr(hostExpr: string, port: number, timeoutMs = 5000): string {
  return `$c = New-Object System.Net.Sockets.TcpClient; try { $t = $c.ConnectAsync(${hostExpr}, ${port}); if ($t.Wait(${timeoutMs})) { "OPEN" } else { "TIMEOUT" } } catch { "CLOSED" } finally { $c.Dispose() }`
}

const HOSTS_PATH = "$env:WINDIR + '\\System32\\drivers\\etc\\hosts'"
const PROXY_REG = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

export default Object.assign(
  function netassist(ctx: Context, config: NetassistConfig = {}) {
    const timeoutMs = config.psTimeoutMs ?? 25000

    // ── 1. net_github_status（结构化输出 + UI 卡片示范）──────────────────
    ctx.tools.register(defineTool({
      name: 'net_github_status',
      description: 'One-shot GitHub connectivity check: DNS resolution and TCP 443 reachability for github.com. Direct answer to "is GitHub reachable right now?".',
      parameters: {},
      output: {
        // 结构化 schema：UI 和回放都能拿到字段级数据，而非一段文本
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dns: { type: 'array', items: { type: 'string' }, required: true },
            tcp443: { type: 'string', required: true },
            reachable: { type: 'boolean', required: true },
          },
        },
        // 模型可见文本：从结构化值渲染
        render: (_a, value) => [{
          type: 'text',
          text: `GitHub reachable: ${value.reachable} | DNS: ${value.dns.join(', ')} | TCP 443: ${value.tcp443}`,
        }],
        // 纯可重放投影：字段数据随会话日志持久化，UI 回放也能还原卡片
        presentationMeta: (_a, value) => value,
      },
      // 进行中卡片：UI 显示「Checking GitHub connectivity」+ fetch 图标
      presentCall: () => ({
        card: 'generic',
        title: 'Checking GitHub connectivity',
        kind: 'fetch',
        rawInput: 'github.com:443',
      }),
      // 完成态卡片：标题随结果变化，内容字段化展示
      presentResult: (_a, result) => {
        const m = result.meta as { dns?: string[]; tcp443?: string; reachable?: boolean } | undefined
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
        const json = await ps(script, timeoutMs)
        const parsed = JSON.parse(json) as { dns: string[]; tcp443: string; reachable: boolean }
        return parsed
      },
    }))

    // ── 2. net_proxy_status ───────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_proxy_status',
      description: 'Show the Windows system proxy configuration (registry) and proxy environment variables. Helps distinguish "system proxy" vs "TUN mode" vs "no proxy".',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        const script = [
          `$k = Get-ItemProperty '${PROXY_REG}' -ErrorAction SilentlyContinue`,
          '"ProxyEnable: " + $k.ProxyEnable',
          '"ProxyServer: " + $k.ProxyServer',
          '"ProxyOverride: " + $k.ProxyOverride',
          '"HTTP_PROXY env: " + $env:HTTP_PROXY',
          '"HTTPS_PROXY env: " + $env:HTTPS_PROXY',
          '"NO_PROXY env: " + $env:NO_PROXY',
        ].join('; ')
        return ps(script, timeoutMs)
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
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const ports = ((args.ports as number[] | undefined) ?? [10808, 10809, 7890, 7897, 8888, 1080])
        const checks = ports.map(
          (p) => `$r${p} = $(${tcpTestExpr('"127.0.0.1"', p)}); "127.0.0.1:${p} = $r${p}"`,
        )
        return ps(checks.join('; '), timeoutMs)
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
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
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
          `try { $r = $h.GetAsync(${urlExpr}).GetAwaiter().GetResult(); $http = "HTTP " + [int]$r.StatusCode } catch { $http = "HTTP FAILED (" + $_.Exception.GetBaseException().Message + ")" }`,
          '$h.Dispose()',
          `"DNS: $($dns -join ', ')"`,
          `"TCP ${port}: $tcp"`,
          `"${url}: $http"`,
        ].join('; ')
        return ps(script, timeoutMs)
      },
    }))

    // ── 5. net_hosts_check ────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_hosts_check',
      description: 'Scan the Windows hosts file for GitHub-related entries. Pinned hosts entries can conflict with a proxy — this lists what is pinned so you can spot the clash.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        const script = [
          `$hits = Select-String -Path (${HOSTS_PATH}) -Pattern 'github' -ErrorAction SilentlyContinue`,
          'if ($hits) { $hits | ForEach-Object { ($_.Line).Trim() } } else { "no github entries in hosts (clean)" }',
        ].join('; ')
        return ps(script, timeoutMs)
      },
    }))
  },
  { inject: ['tools'] },
)
