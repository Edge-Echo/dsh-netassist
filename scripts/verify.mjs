// Verify the plugin beyond "the file exports a function".
//
// The previous check only asserted that the default export is a function with `inject`. That would
// pass with every tool silently unregistered, every output schema wrong and every render template
// broken. This drives the plugin with a fake context, inspects what it registers, and executes the
// checks that have no side effects.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const mod = await import(new URL(`file://${path.join(root, pkg.main).replace(/\\/g, '/')}`).href)

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
  if (!ok) failures++
}

const plugin = mod.default
check('default export is a function', typeof plugin === 'function', typeof plugin)
check('declares inject: ["tools"]', Array.isArray(plugin.inject) && plugin.inject.includes('tools'))

// Drive the plugin with the smallest context that satisfies it.
const registered = []
plugin({ tools: { register: (definition) => registered.push(definition) } }, {})

const EXPECTED = [
  'net_github_status',
  'net_proxy_status',
  'net_proxy_probe',
  'net_diag',
  'net_hosts_check',
  'net_doctor',
  'net_dns_compare',
  'net_registry_check',
]
const names = registered.map((d) => d.name).sort()
check('registers every tool', names.length === EXPECTED.length, names.join(', '))
check('registers the expected names', EXPECTED.every((n) => names.includes(n)))
check(
  'every tool has a description long enough to be useful',
  registered.every((d) => typeof d.description === 'string' && d.description.length > 30),
)
check(
  'every tool declares an output schema and a renderer',
  registered.every((d) => d.output?.schema && typeof d.output.render === 'function'),
)
check(
  'every tool has call and result presentations',
  registered.every((d) => typeof d.presentCall === 'function' && typeof d.presentResult === 'function'),
)
check('every tool is executable', registered.every((d) => typeof d.execute === 'function'))

const byName = Object.fromEntries(registered.map((d) => [d.name, d]))

// ── DNS comparison: shape only, because the network result depends on the environment ──
try {
  const result = await byName.net_dns_compare.execute({ host: 'github.com' })
  check('net_dns_compare returns a result', Boolean(result) && typeof result === 'object')
  check(
    'net_dns_compare queried every server',
    Array.isArray(result.answers) && result.answers.length === 4,
    String(result.answers?.length),
  )
  check('net_dns_compare reports a consistency verdict', typeof result.consistent === 'boolean', String(result.consistent))
  check(
    'net_dns_compare answers carry server, timing and outcome',
    result.answers.every(
      (a) => typeof a.name === 'string' && typeof a.server === 'string' && typeof a.ms === 'number' && Array.isArray(a.addresses),
    ),
  )
  // At least one server should answer on any normal network. If none does, the report must not
  // claim agreement over an empty set without saying why.
  if (result.responding === 0) {
    check('net_dns_compare admits no server answered', result.answers.every((a) => a.error))
  } else {
    check('net_dns_compare returns addresses', result.answers.some((a) => a.addresses.length > 0))
  }
  const rendered = byName.net_dns_compare.output.render({ host: 'github.com' }, result)
  check('net_dns_compare renders text', Array.isArray(rendered) && rendered[0]?.text?.length > 20)
} catch (err) {
  check('net_dns_compare executes', false, err instanceof Error ? err.message : String(err))
}

// ── registry check ───────────────────────────────────────────────────────
try {
  const result = await byName.net_registry_check.execute({})
  check('net_registry_check returns a result', Boolean(result) && typeof result === 'object')
  check(
    'net_registry_check names the configured registry',
    typeof result.configured === 'string' && result.configured.startsWith('http'),
    result.configured,
  )
  check(
    'net_registry_check probed at least one registry',
    Array.isArray(result.probes) && result.probes.length >= 1,
    String(result.probes?.length),
  )
  check(
    'net_registry_check probes carry tcp, http and timing',
    result.probes.every((p) => typeof p.tcp === 'string' && typeof p.http === 'number' && typeof p.ms === 'number'),
  )
  const rendered = byName.net_registry_check.output.render({}, result)
  check('net_registry_check renders text', Array.isArray(rendered) && rendered[0]?.text?.length > 10)
} catch (err) {
  check('net_registry_check executes', false, err instanceof Error ? err.message : String(err))
}

// The PowerShell boundary must preserve non-ASCII output, or Chinese hosts comments and
// localised registry values would arrive mangled. ps() is exported for exactly this kind of check.
const { ps: probePs } = await import('../lib/checks.js')
const echoed = await probePs('Write-Output "中文测试 · ünïcode"')
check('PowerShell output preserves non-ASCII text', echoed === '中文测试 · ünïcode', JSON.stringify(echoed))

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
