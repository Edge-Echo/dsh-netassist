## [0.2.0] - 2026-09-22

### Added

- `doctor` command: full network preflight (system proxy, proxy port reachability, TUN-adapter detection, GitHub reachability, hosts conflicts) with concrete suggestions about what to change.
- Full CLI: `doctor`, `github`, `proxy`, `hosts`, `diag` — every command supports `--json`.
- `net_doctor` agent tool, so the model can run the preflight itself.
- Shared `checks.ts` module: one implementation behind both the CLI and the plugin tools.
- Screenshots and `screenshots.json` for storefronts.

# Changelog

## [0.1.0] - 2026-08-30

### Added

- Network & proxy assistant for DeepSeek Harness:
  - `net_github_status` 鈥?DNS + TCP 443 one-shot GitHub reachability
  - `net_proxy_status` 鈥?system proxy registry settings + proxy env vars
  - `net_proxy_probe` 鈥?local proxy port probing (defaults: 10808/10809/7890/7897/8888/1080)
  - `net_diag` 鈥?full diagnosis chain (DNS 鈫?TCP 鈫?HTTPS status)
  - `net_hosts_check` 鈥?GitHub entries scan in the hosts file
- All input crosses the PowerShell boundary as Base64 (injection-proof by construction).
- Bilingual docs, MIT license, verify script.
- End-to-end verified on Windows via headless profile: github status, proxy status, proxy probe and hosts check all passed.

## [0.1.2] - 2026-08-30

### Changed

- net_github_status upgraded to structured output: object schema (dns/tcp443/reachable), presentationMeta projection, and presentCall/presentResult UI cards (pending + completed states).