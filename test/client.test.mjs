/**
 * Behaviour tests for dsh-mcp-ctl's client half, driven through a stub React
 * and a stub slot runtime. They pin the two contracts that change between DSH
 * releases: which standard prop carries the live conversation nodes, and what
 * the command row does when it cannot read a newer state.
 * Run with `node test/client.test.mjs` from the repo root.
 */
import assert from 'node:assert/strict'

// ── stub React ──────────────────────────────────────────────────────────────
// The card is a pure function of props plus useState/useMemo, so a single-render
// stub is enough: hooks reset on every call and function components are invoked
// directly while the traversal records host elements.
const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useMemo(factory) {
    return factory()
  },
  memo(component) {
    return component
  },
}

/** Expand one element tree into its rendered text and the host elements it holds. */
function walk(element, host = []) {
  if (element === null || element === undefined || typeof element === 'boolean') return { text: '', host }
  if (Array.isArray(element)) {
    let text = ''
    for (const child of element) text += walk(child, host).text
    return { text, host }
  }
  if (typeof element === 'string' || typeof element === 'number') return { text: String(element), host }
  const { type, props, children } = element
  if (typeof type === 'function') {
    const next = { ...props }
    if (children.length === 1) next.children = children[0]
    else if (children.length > 1) next.children = children
    return walk(type(next), host)
  }
  host.push({ type, props })
  let text = ''
  for (const child of children) text += walk(child, host).text
  return { text, host }
}

// ── materialize the bundle ──────────────────────────────────────────────────
let definition
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      definition = def
      return def
    },
  },
}
await import('../lib/client.js')
assert.equal(definition.id, 'dsh-mcp-ctl', 'bundle registers under the package name')

const exported = definition.factory((id) => {
  if (id === 'react') return reactStub
  throw new Error(`unexpected require(${id})`)
})
assert.deepEqual(exported.inject, ['remote', 'remote.commands'], 'declared client services')
assert.equal(typeof exported.apply, 'function', 'client half exports apply')

let registration
const calls = []
const ctx = {
  inject: (deps, callback) => callback({
    slots: {
      inject: (key, cb) => cb(),
      register: (options, component) => {
        registration = { options, component }
        return () => {}
      },
    },
  }),
  remote: {
    commands: {
      execute: async (...args) => {
        calls.push(args)
        return { ok: true, value: { result: { kind: 'success' } } }
      },
    },
  },
}
exported.apply(ctx)
assert.deepEqual(registration.options, { name: 'conversation.chat.commandview', key: 'mcp' }, 'slot registration')

// ── fixtures ────────────────────────────────────────────────────────────────
const state = {
  v: 1,
  patchFile: 'C:\\Users\\me\\.dsh\\profiles\\web\\cordis.patch.yml',
  servers: [
    { id: 'mcp-github', serverName: 'github', transport: 'streamable-http', enabled: true, phase: 'active', toolCount: 5 },
    { id: 'mcp-gitee', serverName: 'gitee', transport: 'stdio', enabled: false, phase: null, toolCount: 0 },
  ],
}
const commandNode = (args, outcome) => ({ kind: 'command', name: 'mcp', args, outcome })
const okNode = () => commandNode('', { kind: 'success', text: JSON.stringify(state) })

/** Pre-0.1.5 shape: the chat slice hung off the Session snapshot. */
const legacySessionSnapshot = { chat: { legacy: { nodes: [okNode()] } } }
/** 0.1.5 Session snapshot: it carries no chat slice at all. */
const modernSessionSnapshot = { sessionId: 's1', running: false }
/** 0.1.5 Chat snapshot, as contributed through the Chat view's `useChat` hook. */
const chatSnapshot = { legacy: { nodes: [okNode()] } }

// ── 1. the modern path: nodes come from the `useChat` session hook ──────────
const modern = walk(registration.component({
  ctx,
  sessionId: 's1',
  node: commandNode('', { kind: 'success', text: '{}' }),
  useChat: (selector) => selector(chatSnapshot),
  useSession: (selector) => selector(modernSessionSnapshot),
}))
assert.match(modern.text, /MCP 服务器/, 'card title rendered')
assert.match(modern.text, /github/, 'enabled server listed')
assert.match(modern.text, /工具 5/, 'tool count rendered')
assert.match(modern.text, /gitee/, 'disabled server listed')
assert.match(modern.text, /已关闭/, 'disabled state rendered')
const buttons = modern.host.filter((node) => node.type === 'button')
assert.equal(buttons.length, 2, 'one toggle button per server')

// ── 2. toggling dispatches the same command line the composer uses ──────────
await buttons[1].props.onClick()
assert.deepEqual(calls[0], ['s1', '/mcp on gitee', []], 'enable dispatch')
await buttons[0].props.onClick()
assert.deepEqual(calls[1], ['s1', '/mcp off github', []], 'disable dispatch')

// ── 3. a 0.1.5 session snapshot without a chat slice must not break the card:
//       it falls back to this node's own outcome ─────────────────────────────
const fallback = walk(registration.component({
  ctx,
  sessionId: 's1',
  node: okNode(),
  useChat: undefined,
  useSession: (selector) => selector(modernSessionSnapshot),
}))
assert.match(fallback.text, /github/, 'card still renders from its own node')

// ── 4. the legacy path keeps working (older harness releases) ───────────────
const legacy = walk(registration.component({
  ctx,
  sessionId: 's1',
  node: commandNode('', { kind: 'success', text: '{}' }),
  useChat: undefined,
  useSession: (selector) => selector(legacySessionSnapshot),
}))
assert.match(legacy.text, /github/, 'legacy session snapshot still drives the card')

// ── 5. no hook at all: render the node's own state, never throw ─────────────
const bare = walk(registration.component({ ctx, sessionId: 's1', node: okNode() }))
assert.match(bare.text, /github/, 'node-only rendering')

// ── 6. toggle rows render compact, and an error outcome renders its text ────
const compact = walk(registration.component({
  ctx,
  sessionId: 's1',
  node: commandNode(' on gitee', { kind: 'success', text: JSON.stringify({ ...state, changed: 'gitee', to: true }) }),
}))
assert.match(compact.text, /gitee 已开启/, 'compact confirmation')
assert.doesNotMatch(compact.text, /MCP 服务器/, 'compact rows render no card')

const failed = walk(registration.component({
  ctx,
  sessionId: 's1',
  node: commandNode('', { kind: 'error', text: '未知服务器: nope' }),
}))
assert.match(failed.text, /未知服务器: nope/, 'error outcome surfaced')

// ── 7. an executing command (no outcome yet) renders a placeholder ──────────
const running = walk(registration.component({ ctx, sessionId: 's1', node: commandNode('', null) }))
assert.match(running.text, /执行中/, 'running placeholder')

console.log('all client tests passed')
