/**
 * Smoke tests for the pure helpers of dsh-mcp-ctl's host half.
 * Run with `node test/patch.test.mjs` from the repo root.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setRowDisabled, defaultPatchFile, patchRowId } from '../lib/index.js'

const sample = [
  '# ── External MCP servers ────────────────────────────────────────',
  '- insert:',
  '    # Chrome DevTools: browser automation via chrome-devtools-mcp.',
  '    - id: mcp-chrome-devtools',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: chrome-devtools',
  '        transport: stdio',
  '',
  '    - id: mcp-context-mode',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      disabled: true',
  '      config:',
  '        serverName: context-mode',
  '',
  '# ── Web search provider ─────────────────────────────────────────',
  '- insert:',
  '    - id: web-search-exa',
  "      name: '@deepseek-ai/dsh-web-search-exa'",
  '',
  '- id: web',
  '  config:',
  '    searchProvider: exa',
  '',
].join('\n')

/**
 * The `disabled:` value the loader's patch layer would end up with, mirroring
 * `@deepseek-ai/cordis-plugin-include`'s rule: patches apply in file order, so
 * the LAST block mentioning the row id owns its effective fields.
 */
function effectiveDisabled(text, id) {
  const lines = text.split(/\r?\n/)
  const idLine = new RegExp(`^(\\s*)- id: ${id}\\s*$`)
  let rowIndex = -1
  let rowIndent = -1
  for (let i = 0; i < lines.length; i += 1) {
    const m = idLine.exec(lines[i])
    if (m) {
      rowIndex = i
      rowIndent = m[1].length
    }
  }
  if (rowIndex === -1) return null
  for (let i = rowIndex + 1; i < lines.length; i += 1) {
    const list = /^(\s*)- /.exec(lines[i])
    if (list && list[1].length <= rowIndent) break
    const m = /^\s*disabled:\s*(\S+)\s*$/.exec(lines[i])
    if (m) return m[1]
  }
  return null
}

// 1. disabling an enabled row inserts a `disabled: true` key after `name:`
const disabled = setRowDisabled(sample, 'mcp-chrome-devtools', false)
assert.ok(disabled.includes('      disabled: true'), 'disabled: true inserted')
assert.ok(!disabled.includes('disabled: false'), 'no stray false')
assert.match(
  disabled,
  /      name: '@deepseek-ai\/dsh-mcp-client'\n      disabled: true\n      config:/,
  'inserted right after name:',
)
assert.equal(setRowDisabled(sample, 'mcp-chrome-devtools', false), disabled, 'idempotent')
assert.equal(effectiveDisabled(disabled, 'mcp-chrome-devtools'), 'true', 'effective flag is true')

// 2. flipping an existing `disabled:` line
const enabled = setRowDisabled(sample, 'mcp-context-mode', true)
assert.ok(enabled.includes('      disabled: false'), 'disabled: false set')
assert.ok(!enabled.includes('      disabled: true'), 'old flag replaced')
assert.ok(enabled.includes('        serverName: context-mode'), 'rest of row intact')
assert.equal(effectiveDisabled(enabled, 'mcp-context-mode'), 'false', 'effective flag is false')

// 3. re-disabling the previously disabled row works both ways
assert.ok(setRowDisabled(enabled, 'mcp-context-mode', false).includes('      disabled: true'))

// 4. top-level (non-insert) rows are handled at indent 0
const topLevel = [
  '- id: mcp-top',
  "  name: '@deepseek-ai/dsh-mcp-client'",
  '  config:',
  '    serverName: top',
  '',
].join('\n')
assert.ok(setRowDisabled(topLevel, 'mcp-top', false).includes('  disabled: true'))

// 5. comments and unrelated sections are byte-preserved except the edited row
const comment = '# keep me'
const withComment = comment + '\n' + sample
const edited = setRowDisabled(withComment, 'mcp-chrome-devtools', false)
assert.ok(edited.startsWith(comment), 'leading comment preserved')
assert.equal(edited.split('\n').length, withComment.split('\n').length + 1, 'exactly one line added')

// 6. an override block below an insert row owns the effective flag: the edit
//    must land on the LAST mention (a manager such as dshmarket writes these)
const layered = sample + '\n# disabled by the plugin manager\n- id: mcp-context-mode\n  disabled: true\n'
const reEnabled = setRowDisabled(layered, 'mcp-context-mode', true)
assert.match(reEnabled, /- id: mcp-context-mode\n  disabled: false\n$/, 'trailing override flipped')
assert.equal(effectiveDisabled(reEnabled, 'mcp-context-mode'), 'false', 'effective flag flipped')
assert.equal(effectiveDisabled(setRowDisabled(reEnabled, 'mcp-context-mode', false), 'mcp-context-mode'), 'true')

// 6b. an id no layer in this file defines gets a new top-level override block
const orphan = setRowDisabled(layered, 'mcp-from-a-bundle', false)
assert.match(orphan, /\n- id: mcp-from-a-bundle\n  disabled: true\n$/, 'override appended at the end')
assert.equal(effectiveDisabled(orphan, 'mcp-from-a-bundle'), 'true')
assert.ok(orphan.startsWith('# ── External MCP servers'), 'existing content untouched')

// 6c. CRLF patch files keep their line endings
const crlf = sample.replace(/\n/g, '\r\n')
const crlfOut = setRowDisabled(crlf, 'mcp-chrome-devtools', false)
assert.ok(crlfOut.includes('\r\n      disabled: true\r\n'), 'CRLF preserved on edit')
assert.ok(!/[^\r]\n/.test(crlfOut), 'no bare LF introduced')

// 6d. a `disabled` key inside the row's own config block is a plugin option,
//     not the loader flag, and must not be touched
const nested = [
  '- insert:',
  '    - id: mcp-nested',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        disabled: false',
  '        serverName: nested',
  '',
].join('\n')
const nestedOut = setRowDisabled(nested, 'mcp-nested', false)
assert.match(nestedOut, /\n        disabled: false\n/, 'config-level key untouched')
assert.match(nestedOut, /\n      disabled: true\n/, 'row-level flag inserted')

// 7. defaultPatchFile: accepts the profile directory as a plain path or as the
//    `file://` URL DSH puts on ctx.baseUrl
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-ctl-'))
const patch = path.join(tmp, 'cordis.patch.yml')
fs.writeFileSync(patch, '[]')
assert.equal(defaultPatchFile({ baseUrl: tmp }), patch, 'plain directory path')
assert.equal(defaultPatchFile({ baseUrl: pathToFileURL(tmp).href + '/' }), patch, 'file:// directory URL')
assert.equal(defaultPatchFile({ baseUrl: pathToFileURL(patch).href }), patch, 'file:// config file URL')
// falls back to DSH_HOME when the baseUrl has no patch
assert.equal(
  defaultPatchFile({ baseUrl: path.join(tmp, 'nope') }),
  path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml'),
)
fs.rmSync(tmp, { recursive: true, force: true })

// 8. real-world: the resolved web profile patch round-trips every mcp row
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const real = defaultPatchFile({ baseUrl: pathToFileURL(path.join(home, 'profiles', 'web')).href + '/' })
if (fs.existsSync(real)) {
  const text = fs.readFileSync(real, 'utf8')
  const ids = [...text.matchAll(/^\s*- id: (mcp-[A-Za-z0-9_-]+)\s*$/gm)].map((m) => m[1])
  assert.ok(ids.length > 0, 'found at least one mcp row in the real profile patch')
  for (const id of new Set(ids)) {
    for (const want of [true, false]) {
      const next = setRowDisabled(text, id, want)
      assert.equal(setRowDisabled(next, id, want), next, `idempotent for ${id} want=${want}`)
      assert.equal(effectiveDisabled(next, id), String(!want), `effective flag for ${id} want=${want}`)
      assert.equal(next.split(/\r?\n/)[0], text.split(/\r?\n/)[0], 'header preserved')
    }
  }
  console.log(`real profile patch exercised read-only: ${real} (${new Set(ids).size} mcp rows)`)
}

// 9. patchRowId always returns the last id segment (options.id itself may
// carry the include-tree prefix)
assert.equal(patchRowId({ options: { id: 'mcp-github' }, id: 'include:mcp-github' }), 'mcp-github')
assert.equal(patchRowId({ options: { id: 'include:mcp-context-mode' }, id: 'include:mcp-context-mode' }), 'mcp-context-mode')
assert.equal(patchRowId({ options: {}, id: 'include:mcp-gitee' }), 'mcp-gitee')
assert.equal(patchRowId({ options: {}, id: 'mcp-top' }), 'mcp-top')

console.log('all patch tests passed')
