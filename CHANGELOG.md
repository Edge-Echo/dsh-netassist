# Changelog

## [0.1.0] - 2026-08-30

### Added

- Network & proxy assistant for DeepSeek Harness:
  - `net_github_status` — DNS + TCP 443 one-shot GitHub reachability
  - `net_proxy_status` — system proxy registry settings + proxy env vars
  - `net_proxy_probe` — local proxy port probing (defaults: 10808/10809/7890/7897/8888/1080)
  - `net_diag` — full diagnosis chain (DNS → TCP → HTTPS status)
  - `net_hosts_check` — GitHub entries scan in the hosts file
- All input crosses the PowerShell boundary as Base64 (injection-proof by construction).
- Bilingual docs, MIT license, verify script.
- End-to-end verified on Windows via headless profile: github status, proxy status, proxy probe and hosts check all passed.
