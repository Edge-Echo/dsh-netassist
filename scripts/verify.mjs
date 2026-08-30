// Lightweight sanity check: the built module must export a plugin function.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const mod = await import(new URL(`file://${path.join(root, pkg.main).replace(/\\/g, '/')}`).href)

const fn = mod.default
if (typeof fn !== 'function') {
  console.error(`FAIL: default export is not a function (got ${typeof fn})`)
  process.exit(1)
}
if (!fn.inject || !fn.inject.includes('tools')) {
  console.error('FAIL: plugin does not declare inject: ["tools"]')
  process.exit(1)
}
console.log(`PASS: ${pkg.name}@${pkg.version} default export is a Cordis plugin (inject: ${JSON.stringify(fn.inject)})`)
