// dsh-netassist — network & proxy assistant for DeepSeek Harness.
//
// Tools delegate to the shared checks module (also used by the CLI); every
// tool returns STRUCTURED output with presentationMeta projection and
// presentCall/presentResult UI cards. All user input crosses the PowerShell
// boundary as Base64 (injection-proof by construction).
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import {
  checkDiag, checkGithub, checkHosts, checkProxyPorts, checkProxyStatus,
} from './checks.js'
import { runDoctor, type DoctorReport } from './doctor.js'

/** Plugin config: per-call PowerShell timeout. */
export interface NetassistConfig {
  psTimeoutMs?: number
}

function meta<T>(result: { meta?: unknown }): T | undefined {
  return result.meta as T | undefined
}

export default Object.assign(
  function netassist(ctx: Context, config: NetassistConfig = {}) {
    const timeoutMs = config.psTimeoutMs ?? 25000

    // ── 1. net_github_status ──────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_github_status',
      description: 'One-shot GitHub connectivity check: DNS resolution, TCP 443 reachability and the HTTPS status code for github.com. Direct answer to "is GitHub reachable right now?".',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dns: { type: 'array', items: { type: 'string' }, required: true },
            tcp443: { type: 'string', required: true },
            reachable: { type: 'boolean', required: true },
            httpStatus: { type: 'integer', required: true },
            tcpMs: { type: 'integer', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: `GitHub reachable: ${value.reachable} | DNS: ${value.dns.join(', ')} | TCP 443: ${value.tcp443} (${value.tcpMs} ms) | HTTPS: ${value.httpStatus > 0 ? `HTTP ${value.httpStatus}` : 'failed'}`,
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
        const m = meta<{ dns?: string[]; tcp443?: string; reachable?: boolean; httpStatus?: number; tcpMs?: number }>(result)
        return {
          card: 'generic',
          title: m?.reachable ? `GitHub: reachable (HTTP ${m.httpStatus ?? '?'}, ${m.tcpMs ?? '?'} ms)` : 'GitHub: unreachable',
          content: [{ type: 'text', text: `TCP 443: ${m?.tcp443 ?? '?'} | DNS: ${m?.dns?.join(', ') ?? '?'}` }],
        }
      },
      async execute() {
        const s = await checkGithub(timeoutMs)
        return { dns: s.dns, tcp443: s.tcp443, reachable: s.reachable, httpStatus: s.httpStatus ?? 0, tcpMs: s.tcpMs ?? 0 }
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
      presentCall: (): ToolCallView => ({ card: 'generic', title: 'Reading system proxy settings', kind: 'read' }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ enabled?: boolean; server?: string; override?: string; envHttp?: string; envHttps?: string }>(result)
        return {
          card: 'generic',
          title: m?.enabled ? `Proxy: ${m.server ?? '?'}` : 'Proxy: disabled',
          content: [{ type: 'text', text: `Override: ${m?.override || '(none)'} | env HTTP: ${m?.envHttp || '(none)'} | env HTTPS: ${m?.envHttps || '(none)'}` }],
        }
      },
      async execute() {
        const p = await checkProxyStatus(timeoutMs)
        return { enabled: p.enabled, server: p.server, override: p.override, envHttp: p.envHttp, envHttps: p.envHttps }
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
        render: (_a, value) => [{ type: 'text', text: value.ports.map((p) => `${p.port}:${p.status}`).join(' ') }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({ card: 'generic', title: 'Probing local proxy ports', kind: 'search' }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ ports?: { port: number; status: string }[] }>(result)
        const open = m?.ports?.filter((p) => p.status === 'OPEN') ?? []
        return {
          card: 'generic',
          title: `Proxy ports: ${open.length} open`,
          content: [{ type: 'text', text: open.length ? `Open: ${open.map((p) => p.port).join(', ')}` : 'No common proxy port is open' }],
        }
      },
      async execute(args) {
        const ports = (args.ports as number[] | undefined) ?? [10808, 10809, 7890, 7897, 8888, 1080]
        const probes = await checkProxyPorts(ports, timeoutMs)
        return { ports: probes.map((p) => ({ port: p.port, status: p.status })) }
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
        render: (_a, value) => [{ type: 'text', text: `${value.host} | DNS: ${value.dns.join(', ')} | TCP: ${value.tcp} | ${value.http}` }],
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
        return checkDiag(host, port, path, timeoutMs)
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
          text: value.hasGithub ? `Found ${value.entries.length} GitHub entries in hosts:\n${value.entries.join('\n')}` : 'No GitHub entries in hosts (clean)',
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({ card: 'generic', title: 'Scanning hosts file for GitHub entries', kind: 'search' }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ entries?: string[]; hasGithub?: boolean }>(result)
        return {
          card: 'generic',
          title: m?.hasGithub ? `Hosts: ${m.entries?.length ?? 0} GitHub entries` : 'Hosts: clean',
          content: [{ type: 'text', text: m?.hasGithub ? (m.entries ?? []).join('\n') : 'No GitHub entries in hosts' }],
        }
      },
      async execute() {
        return checkHosts(timeoutMs)
      },
    }))

    // ── 6. net_doctor ─────────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'net_doctor',
      description: 'Full network preflight for a China-style network: system proxy, proxy-port reachability, TUN-adapter detection, GitHub reachability and hosts conflicts — each with concrete suggestions about what to change. Use this before blaming the network for a failure.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            findings: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  level: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  detail: { type: 'string', required: true },
                },
              },
            },
            suggestions: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: [
            ...value.findings.map((f) => `${f.level === 'ok' ? '✔' : f.level === 'warn' ? '⚠' : '✖'} ${f.title}${f.detail ? ` — ${f.detail}` : ''}`),
            ...(value.suggestions.length ? ['', 'Suggested fix:', ...value.suggestions.map((s) => `- ${s}`)] : []),
          ].join('\n'),
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({ card: 'generic', title: 'Running network doctor', kind: 'search' }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ ok?: boolean; findings?: { level: string; title: string }[]; suggestions?: string[] }>(result)
        const errors = m?.findings?.filter((f) => f.level === 'error').length ?? 0
        const warns = m?.findings?.filter((f) => f.level === 'warn').length ?? 0
        return {
          card: 'generic',
          title: m?.ok
            ? `Network doctor: OK${warns ? ` (${warns} warning${warns === 1 ? '' : 's'})` : ''}`
            : `Network doctor: ${errors} problem${errors === 1 ? '' : 's'}`,
          content: [{
            type: 'text',
            text: m?.suggestions?.length ? `Suggested fix:\n${m.suggestions.map((s) => `- ${s}`).join('\n')}` : 'Configuration looks self-consistent.',
          }],
        }
      },
      async execute() {
        const report: DoctorReport = await runDoctor({ timeoutMs })
        return {
          ok: report.ok,
          findings: report.findings.map((f) => ({ level: f.level, title: f.title, detail: f.detail ?? '' })),
          suggestions: report.suggestions,
        }
      },
    }))
  },
  { inject: ['tools'] },
)
