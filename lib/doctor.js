// dsh-netassist — the `doctor` diagnosis: detect, then advise.
//
// A diagnostic tool earns its keep by answering "what should I change?", not
// by printing numbers. Every finding carries a level; every non-ok finding
// contributes a concrete, conservative suggestion (never an auto-fix).
import { checkGithub, checkHosts, checkProxyPorts, checkProxyStatus, checkTunAdapters, DEFAULT_PROXY_PORTS, } from './checks.js';
function ms(v) {
    return typeof v === 'number' ? `${v} ms` : 'n/a';
}
/** Run the full preflight diagnosis and derive suggestions. */
export async function runDoctor(opts = {}) {
    const timeoutMs = opts.timeoutMs;
    const [proxy, github, hosts, tun] = await Promise.all([
        checkProxyStatus(timeoutMs),
        checkGithub(timeoutMs),
        checkHosts(timeoutMs),
        checkTunAdapters(timeoutMs),
    ]);
    const probePorts = [...new Set([
            ...(proxy.hostPort ? [proxy.hostPort.port] : []),
            ...(opts.extraPorts ?? []),
            ...DEFAULT_PROXY_PORTS,
        ])];
    const ports = await checkProxyPorts(probePorts, timeoutMs);
    const findings = [];
    const suggestions = [];
    // ── system proxy ────────────────────────────────────────────────────────
    const proxyPort = proxy.hostPort;
    const proxyPortProbe = proxyPort ? ports.find((p) => p.port === proxyPort.port) : undefined;
    if (proxy.enabled && proxy.server) {
        findings.push({ level: 'ok', title: `System proxy: ${proxy.server}` });
    }
    else if (proxy.envHttps || proxy.envHttp) {
        findings.push({
            level: 'ok',
            title: `No system proxy, but proxy env vars are set (HTTPS_PROXY=${proxy.envHttps || '(unset)'})`,
        });
    }
    else if (proxy.staleServer) {
        findings.push({
            level: 'warn',
            title: `System proxy is OFF, but the registry still holds ${proxy.staleServer}`,
            detail: 'The Windows proxy switch is off, so traffic goes direct (or via TUN mode). The leftover value is harmless but misleading.',
        });
    }
    else {
        findings.push({
            level: 'warn',
            title: 'No system proxy configured',
            detail: 'Direct connections only — fine if your network reaches GitHub directly or you use TUN mode.',
        });
    }
    // ── proxy port reachability ─────────────────────────────────────────────
    const openPorts = ports.filter((p) => p.status === 'OPEN').map((p) => p.port);
    if (proxyPortProbe) {
        if (proxyPortProbe.status === 'OPEN') {
            findings.push({ level: 'ok', title: `Proxy port ${proxyPort.port} responding` });
        }
        else {
            findings.push({
                level: 'error',
                title: `Proxy port ${proxyPort.port} not responding (${proxyPortProbe.status})`,
                detail: proxy.server ? `System proxy points at ${proxy.server}` : undefined,
            });
            const alternative = openPorts[0];
            suggestions.push(alternative
                ? `Start your proxy client, or point the system proxy at port ${alternative} (the only common proxy port currently listening).`
                : 'Start your proxy client — the configured system proxy port is not listening.');
        }
    }
    else if (proxy.enabled && proxy.server && !proxy.hostPort) {
        findings.push({
            level: 'warn',
            title: `Could not parse the system proxy value: ${proxy.server}`,
            detail: 'Expected host:port (or a semicolon-separated list).',
        });
    }
    if (openPorts.length && !proxy.enabled) {
        findings.push({
            level: 'warn',
            title: `A local proxy is listening (port ${openPorts.join(', ')}) but no system proxy is configured`,
            detail: proxy.staleServer
                ? `The registry still names ${proxy.staleServer} while the proxy switch is off.`
                : 'Traffic will not use it unless the app respects TUN mode or you set env vars.',
        });
        suggestions.push(proxy.staleServer
            ? `Turn the Windows system proxy back on (it still points at ${proxy.staleServer}) or rely on TUN mode.`
            : 'Set the Windows system proxy to that port, or use TUN mode, or export HTTP(S)_PROXY for the tools that need it.');
    }
    // ── TUN mode ────────────────────────────────────────────────────────────
    if (tun.detected) {
        findings.push({
            level: proxy.enabled ? 'warn' : 'ok',
            title: `TUN-style adapter detected: ${tun.adapters.join(', ')}`,
            detail: proxy.enabled
                ? 'Under TUN mode the system proxy setting is usually ignored — the two can fight each other.'
                : 'TUN mode captures traffic at the network layer.',
        });
        if (proxy.enabled) {
            suggestions.push('Under TUN mode, clear the Windows system proxy (or exclude github.com) so traffic is not double-handled.');
        }
    }
    // ── GitHub reachability ─────────────────────────────────────────────────
    if (github.reachable && (github.httpStatus ?? 0) > 0) {
        findings.push({
            level: 'ok',
            title: `GitHub reachable (HTTP ${github.httpStatus}, TCP ${ms(github.tcpMs)})`,
            detail: `DNS: ${github.dns.join(', ')}`,
        });
    }
    else if (github.reachable) {
        findings.push({
            level: 'warn',
            title: 'GitHub TCP 443 reachable but the HTTPS request failed',
            detail: `DNS: ${github.dns.join(', ')}`,
        });
        suggestions.push('TCP works but TLS does not: usually the proxy does not cover github.com, or SNI is being interfered with. ' +
            'Route github.com through your proxy (or check the proxy rules) and retry.');
    }
    else {
        findings.push({
            level: 'error',
            title: `GitHub unreachable (TCP 443: ${github.tcp443})`,
            detail: `DNS: ${github.dns.join(', ')}`,
        });
        if (proxy.enabled && proxyPortProbe?.status === 'OPEN') {
            suggestions.push('The proxy is up but GitHub is still unreachable — verify the proxy rules cover github.com and that the upstream node is healthy.');
        }
        else if (!proxy.enabled && !tun.detected) {
            suggestions.push('No proxy and no TUN adapter is active while GitHub is unreachable — configure a proxy or check your network.');
        }
    }
    // ── hosts file ──────────────────────────────────────────────────────────
    if (hosts.hasGithub) {
        findings.push({
            level: proxy.enabled || tun.detected ? 'warn' : 'ok',
            title: `hosts file pins ${hosts.entries.length} GitHub entr${hosts.entries.length === 1 ? 'y' : 'ies'}`,
            detail: hosts.entries.slice(0, 3).join(' | '),
        });
        if (proxy.enabled || tun.detected) {
            suggestions.push('Pinned GitHub IPs in the hosts file bypass your proxy and can go stale — back them up and remove them while a proxy is active.');
        }
    }
    else {
        findings.push({ level: 'ok', title: 'hosts file clean (no GitHub entries)' });
    }
    const ok = !findings.some((f) => f.level === 'error');
    return { ok, findings, suggestions, raw: { proxy, ports, github, hosts, tun } };
}
const ICON = { ok: '✔', warn: '⚠', error: '✖' };
/** Render the doctor report for the terminal. */
export function renderDoctor(report) {
    const lines = [];
    for (const f of report.findings) {
        lines.push(`${ICON[f.level]} ${f.title}`);
        if (f.detail)
            lines.push(`   ${f.detail}`);
    }
    if (report.suggestions.length) {
        lines.push('');
        lines.push('Suggested fix:');
        for (const s of report.suggestions)
            lines.push(`- ${s}`);
    }
    else {
        lines.push('');
        lines.push('No action needed — configuration looks self-consistent.');
    }
    return lines.join('\n');
}
