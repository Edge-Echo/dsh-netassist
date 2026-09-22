# dsh-netassist

![dsh-netassist](https://raw.githubusercontent.com/Edge-Echo/dsh-netassist/main/banner.svg)

> Part of the **dsh-toolkit family**: [dsh-mcp-bridge](https://github.com/Edge-Echo/dsh-mcp-bridge) · [dsh-win-toolkit](https://github.com/Edge-Echo/dsh-win-toolkit) · [dsh-netassist](https://github.com/Edge-Echo/dsh-netassist) · [dsh-driftwatch](https://github.com/Edge-Echo/dsh-driftwatch)

[![npm version](https://img.shields.io/npm/v/dsh-netassist?color=14b8a6&logo=npm)](https://www.npmjs.com/package/dsh-netassist)
[![npm downloads](https://img.shields.io/npm/dm/dsh-netassist?color=22d3ee)](https://www.npmjs.com/package/dsh-netassist)
[![license](https://img.shields.io/npm/l/dsh-netassist?color=14b8a6)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Edge-Echo/dsh-netassist?color=22d3ee)](https://github.com/Edge-Echo/dsh-netassist)

**Network & proxy assistant for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).**

Born from real-world China-network pain: GitHub flaky, proxies everywhere, hosts conflicts, TUN vs system proxy confusion. This plugin gives your agent one-shot answers to "is GitHub reachable?", "what proxy is my system using?", "is my proxy port alive?", plus a full diagnosis chain — all read-only, all injection-safe.

> 中文文档见 [README.zh.md](README.zh.md)。

## Tools

| Tool | What it answers |
|---|---|
| `net_github_status` | Is GitHub reachable right now? (DNS + TCP 443) |
| `net_proxy_status` | System proxy config: registry `ProxyEnable/ProxyServer/ProxyOverride` + proxy env vars |
| `net_proxy_probe` | Which common local proxy ports are alive? (default 10808/10809/7890/7897/8888/1080) |
| `net_diag` | Full chain for any host: DNS → TCP → HTTPS status code |
| `net_hosts_check` | GitHub entries pinned in the hosts file (proxy conflict scan) |

## Install

```sh
dsh plugin --profile web add dsh-netassist
dsh web   # restart
```

Then ask your agent:
- "check if github.com is reachable" → `net_github_status`
- "what proxy is my system using?" → `net_proxy_status`
- "is my proxy running?" → `net_proxy_probe`
- "why can't I reach api.example.com:8443?" → `net_diag` host=api.example.com port=8443
- "any github entries in my hosts?" → `net_hosts_check`

## How it works

Every tool runs a short read-only PowerShell snippet through `powershell.exe -NoProfile -NonInteractive`. All user input crosses the script boundary as **Base64** — injection-proof by construction. No writes, no admin rights, no dependencies.

- Config: `psTimeoutMs` (default 25000) — per-call PowerShell timeout, settable in your profile's `cordis.patch.yml` under the `netassist` entry.
- Windows-only: tools fail loudly on non-Windows platforms.

## Real-world example (this machine)

```
net_github_status → DNS: 20.205.243.166, TCP 443: OPEN
net_proxy_status  → ProxyEnable: 1, ProxyServer: 127.0.0.1:10808
net_proxy_probe   → 10808 OPEN, 10809/7890/7897/8888/1080 CLOSED
net_hosts_check   → no github entries in hosts (clean)
```

## Troubleshooting

- "PowerShell failed": usually execution-policy or anti-virus interference. The plugin uses `-NoProfile -NonInteractive`; check `Get-ExecutionPolicy` — it does not require RemoteSigned.
- Port probes use a 5s connect timeout each, so a full probe takes ~5-10s worst case.

## Links

- npm: <https://www.npmjs.com/package/dsh-netassist>
- GitHub: <https://github.com/Edge-Echo/dsh-netassist>
- License: MIT
