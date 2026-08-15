/**
 * Smoke tests for the pure helpers of dsh-mcp-ctl's host half.
 * Run with `node test/patch.test.mjs` from the repo root.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

// 1. disabling an enabled row inserts a `disabled: true` key after `name:`
const disabled = setRowDisabled(sample, 'mcp-chrome-devtools', false)
assert.ok(disabled.includes("      disabled: true"), 'disabled: true inserted')
assert.ok(!disabled.includes('disabled: false'), 'no stray false')
assert.match(
  disabled,
  /      name: '@deepseek-ai\/dsh-mcp-client'\n      disabled: true\n      config:/,
  'inserted right after name:',
)
assert.equal(setRowDisabled(sample, 'mcp-chrome-devtools', false), disabled, 'idempotent')

// 2. flipping an existing `disabled:` line
const enabled = setRowDisabled(sample, 'mcp-context-mode', true)
assert.ok(enabled.includes('      disabled: false'), 'disabled: false set')
assert.ok(!enabled.includes('      disabled: true'), 'old flag replaced')
assert.ok(enabled.includes('        serverName: context-mode'), 'rest of row intact')

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
assert.throws(() => setRowDisabled(sample, 'mcp-unknown', true), /找不到服务器行/)

// 6. defaultPatchFile: prefers ctx.baseUrl when a patch exists there
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-ctl-'))
fs.writeFileSync(path.join(tmp, 'cordis.patch.yml'), '[]')
assert.equal(defaultPatchFile({ baseUrl: tmp }), path.join(tmp, 'cordis.patch.yml'))
// falls back to DSH_HOME when the baseUrl has no patch
assert.equal(
  defaultPatchFile({ baseUrl: path.join(tmp, 'nope') }),
  path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml'),
)
fs.rmSync(tmp, { recursive: true, force: true })

// 7. real-world: the current web profile patch round-trips every mcp row
const real = 'C:\\Users\\zyf\\.dsh\\profiles\\web\\cordis.patch.yml'
if (fs.existsSync(real)) {
  const text = fs.readFileSync(real, 'utf8')
  for (const id of ['mcp-chrome-devtools', 'mcp-context-mode', 'mcp-github', 'mcp-gitee']) {
    for (const want of [true, false]) {
      const next = setRowDisabled(text, id, want)
      assert.ok(setRowDisabled(next, id, want) === next, `idempotent for ${id} want=${want}`)
      assert.match(next, /disabled: (true|false)/, 'sane output')
      assert.ok(next.startsWith(text.split('\n')[0]), 'header preserved')
    }
  }
}

// 8. patchRowId always returns the last id segment (options.id itself may
// carry the include-tree prefix)
assert.equal(patchRowId({ options: { id: 'mcp-github' }, id: 'include:mcp-github' }), 'mcp-github')
assert.equal(patchRowId({ options: { id: 'include:mcp-context-mode' }, id: 'include:mcp-context-mode' }), 'mcp-context-mode')
assert.equal(patchRowId({ options: {}, id: 'include:mcp-gitee' }), 'mcp-gitee')
assert.equal(patchRowId({ options: {}, id: 'mcp-top' }), 'mcp-top')

console.log('all patch tests passed')
