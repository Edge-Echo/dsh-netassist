# Changelog

## 0.4.0

**`net_doctor` now runs the DNS comparison and the npm registry check too.**

The whole point of the preflight is a complete "what should I change" answer, and the two most common
failures it could not see were a resolver returning a stale answer and a configured npm mirror that
does not respond. Both are now part of the parallel run, and the report says which servers answered
what and whether the registry is reachable:

```
✔ DNS: all 4/4 responding servers agree
   AliDNS: 140.82.113.3 | DNSPod: 140.82.113.3 | Cloudflare: 140.82.113.3 | Google: 140.82.113.3
✔ npm registry reachable: https://registry.npmmirror.com
   OPEN TCP, HTTP 200 in 21 ms
```

The DNS and registry checks use Node's network stack, so they add well under a second to a
preflight whose Windows checks each cost a cold PowerShell start.

Tests: 19 → 24 assertions, including an executed `net_doctor` that must contain both findings.
The README screenshot was regenerated from a real run.

## 0.3.1

**Fixed: non-ASCII output from PowerShell was corrupted.** PowerShell 5.1 writes stdout in the OEM
code page while Node decodes UTF-8, so a hosts-file comment or a localised registry string came back
mangled. The PowerShell boundary now forces the child's stdout to UTF-8, and the test suite asserts a
round-trip of non-ASCII text through `ps()`.

## [0.3.0] - 2026-10-20

### Added

- `net_dns_compare` — asks AliDNS, DNSPod, Cloudflare and Google the same question and compares the answers. `net_github_status` can say GitHub is unreachable *now*; it cannot say whether the system resolver is the reason. A poisoned or stale answer only becomes visible when another server disagrees.
- `net_registry_check` — probes the npm registry npm is actually configured to use (env var, then `~/.npmrc`, then the official default) plus the official one for comparison. Every "npm install failed" starts here, and nothing checked it before.
- Both use Node's own `dns` / `net` / `https` rather than PowerShell, so they are portable and do not pay the cold-start cost.

### Changed

- The test suite went from 2 assertions to 19. It used to check only that the module exported a function, which would pass with every tool unregistered; it now drives the plugin with a fake context, verifies all eight tool registrations and their schemas, executes both new checks and renders their output.

### Fixed

- This file: entries were out of order with the `# Changelog` heading in the middle, and the 0.1.0 section had double-encoded characters where `—` and `→` should be.

## [0.2.1] - 2026-09-22

### Fixed

- Re-release of 0.2.0, which npm left in a staged state (E409 on any re-publish of the same version). No code changes.

## [0.2.0] - 2026-09-22

### Added

- `doctor` command: full network preflight (system proxy, proxy port reachability, TUN-adapter detection, GitHub reachability, hosts conflicts) with concrete suggestions about what to change.
- Full CLI: `doctor`, `github`, `proxy`, `hosts`, `diag` — every command supports `--json`.
- `net_doctor` agent tool, so the model can run the preflight itself.
- Shared `checks.ts` module: one implementation behind both the CLI and the plugin tools.
- Screenshots and `screenshots.json` for storefronts.

## [0.1.2] - 2026-08-30

### Changed

- `net_github_status` upgraded to structured output: object schema (dns/tcp443/reachable), presentationMeta projection, and presentCall/presentResult UI cards (pending + completed states).

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
