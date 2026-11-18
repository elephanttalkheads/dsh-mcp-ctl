/**
 * Discovery tests for dsh-mcp-ctl's host half.
 *
 * Pins the two mount shapes /mcp must see:
 *   1. standard `@deepseek-ai/dsh-mcp-client` rows (togglable);
 *   2. adapter-mounted servers (a bundle plugin bridging through the same
 *      package, e.g. dsh-computer-use-win → `wincu`) discovered from the
 *      `mcp__<server>__*` tool namespace, read-only in /mcp.
 * Run with `node test/discovery.test.mjs` from the repo root.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectServers, makeHandler } from '../lib/index.js'

const updates = []
const loaderEntries = [
  {
    options: {
      id: 'include:mcp-rhtv',
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'rhtv', transport: 'stdio' },
    },
    disabled: false,
    fiber: { state: 2 },
    async update(next) {
      updates.push(next)
      // Mirror the loader: Entry.update merges the patch into the live options.
      if (next.disabled !== undefined) this.disabled = next.disabled
    },
  },
]
const toolSchemas = [
  { name: 'bash' },
  { name: 'mcp__rhtv__canvas_query' },
  { name: 'mcp__rhtv__canvas_list' },
  { name: 'mcp__wincu__windows_computer_use_health' },
  { name: 'mcp__wincu__windows_computer_use_screenshot' },
  { name: 'mcp__wincu__windows_computer_use_list_windows' },
]
const makeCtx = (tools) => ({
  get: (key) => key === 'loader'
    ? { entries: () => loaderEntries }
    : key === 'tools'
      ? tools
      : undefined,
  logger: { warn() {} },
})

// 1. standard rows + adapter discovery from tool prefixes
const { servers, byId } = collectServers(makeCtx({ schemas: () => toolSchemas }))
assert.equal(servers.length, 2, 'one row server + one adapter server')

const rhtv = servers.find((s) => s.serverName === 'rhtv')
assert.ok(rhtv, 'standard row discovered')
assert.equal(rhtv.mountedBy, 'row', 'row source')
assert.equal(rhtv.id, 'mcp-rhtv', 'patch row id kept')
assert.equal(rhtv.toolCount, 2, 'row tool count')
assert.equal(rhtv.enabled, true, 'row enablement')
assert.equal(rhtv.phase, 'active', 'row fiber phase')
assert.ok(byId.has('mcp-rhtv'), 'entry kept for toggling')

const wincu = servers.find((s) => s.serverName === 'wincu')
assert.ok(wincu, 'adapter-mounted server discovered')
assert.equal(wincu.mountedBy, 'adapter', 'adapter source')
assert.equal(wincu.id, null, 'adapter has no patch row')
assert.equal(wincu.transport, 'adapter', 'adapter transport label')
assert.equal(wincu.toolCount, 3, 'adapter tool count')
assert.equal(wincu.enabled, true, 'adapter is live when tools exist')
assert.equal(wincu.phase, 'active', 'adapter phase')
assert.equal(byId.has('wincu'), false, 'adapter has no loader entry')

// 2. a host without a tools registry degrades gracefully (rows only)
const rowOnly = collectServers(makeCtx(undefined))
assert.equal(rowOnly.servers.length, 1, 'row-only fallback')
assert.equal(rowOnly.servers[0].serverName, 'rhtv')

// 3. a throwing tools registry must not break /mcp either
const throwing = collectServers(makeCtx({ schemas: () => { throw new Error('gone') } }))
assert.equal(throwing.servers.length, 1, 'throwing registry fallback')

// 4. handler: bare /mcp snapshots both mounts; adapter toggle is refused;
//    row toggle persists the flag and updates the live entry
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-ctl-discovery-'))
const patch = path.join(tmp, 'cordis.patch.yml')
fs.writeFileSync(patch, [
  '- insert:',
  '    - id: mcp-rhtv',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: rhtv',
  '',
].join('\n'))
const ctx = makeCtx({ schemas: () => toolSchemas })
ctx.baseUrl = undefined
const handler = makeHandler(ctx, { patchFile: patch })

let res = await handler({ rawInput: '' })
assert.equal(res.kind, 'success', 'bare /mcp succeeds')
const state = JSON.parse(res.text)
assert.equal(state.servers.length, 2, 'snapshot carries both mounts')
assert.equal(state.servers.find((s) => s.serverName === 'wincu').mountedBy, 'adapter')

res = await handler({ rawInput: 'off wincu' })
assert.equal(res.kind, 'error', 'adapter toggle refused')
assert.match(res.text, /适配器/, 'adapter refusal explains the mount')
assert.equal(updates.length, 0, 'refusal must not touch the loader')

res = await handler({ rawInput: 'off rhtv' })
assert.equal(res.kind, 'success', 'row toggle succeeds')
assert.deepEqual(updates[0], { disabled: true }, 'live entry disabled')
assert.match(fs.readFileSync(patch, 'utf8'), /disabled: true/, 'patch file persisted')

res = await handler({ rawInput: 'on rhtv' })
assert.equal(res.kind, 'success', 'row re-enable succeeds')
assert.deepEqual(updates[1], { disabled: false }, 'live entry enabled')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('all discovery tests passed')
