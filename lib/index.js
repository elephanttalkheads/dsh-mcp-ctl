/**
 * dsh-mcp-ctl — Host half.
 *
 * Registers the human slash command `/mcp`: lists every MCP server mounted in
 * the harness composition (each `@deepseek-ai/dsh-mcp-client` loader entry)
 * with its live enablement, loader fiber phase and registered tool count, and
 * toggles a server on/off.
 *
 * Toggling works in two steps:
 *   1. live:  `entry.update({ disabled })` restarts/disposes that loader entry
 *             (tools register/unregister immediately);
 *   2. durable: the row's `disabled:` flag is edited in the profile's
 *             `cordis.patch.yml` so the choice survives restarts. The loader's
 *             HMR watcher sees the file change; because the in-memory options
 *             already match, the reload is a no-op.
 *
 * The patch file is located by the `patchFile` config option, defaulting to
 * `<ctx.baseUrl>/cordis.patch.yml` (the profile the plugin was mounted from),
 * with a `$DSH_HOME/profiles/web/cordis.patch.yml` fallback.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'dsh-mcp-ctl'

/** Service keys this plugin requires before activation. */
export const inject = ['commands']

/** The composition plugin that bridges one MCP server. */
const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/**
 * Loader fiber state → human phase. Mirrors the mapping published by
 * `@deepseek-ai/dsh-host-plugin-inventory` (FIBER_STATE: pending 0, loading 1,
 * active 2, failed 3, unloading 5; state 4 is not mapped there either).
 */
const PHASE = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  5: 'unloading',
}

/** Resolve the profile patch file the plugin manages. */
export function defaultPatchFile(ctx) {
  if (ctx.baseUrl) {
    const candidate = path.join(ctx.baseUrl, 'cordis.patch.yml')
    if (fs.existsSync(candidate)) return candidate
  }
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', 'web', 'cordis.patch.yml')
}

/**
 * The raw row id a loader entry was inserted under in the patch file.
 * Loader trees namespace entry ids with group prefixes (the profile patch
 * mounts its rows under an `include:` group, and `entry.options.id` carries
 * the same prefix), so the patch row id is always the LAST id segment —
 * patch rows themselves never contain `:`.
 */
export function patchRowId(entry) {
  const raw = entry.options?.id || entry.id || ''
  const parts = String(raw).split(':')
  return parts[parts.length - 1] || raw
}

/**
 * Collect every MCP server row from the live loader tree.
 * @returns {{ servers: object[], byId: Map<string, object> }} `servers` is the
 *   JSON-safe snapshot; `byId` maps entry id → live loader Entry (never sent
 *   over any wire).
 */
export function collectServers(ctx) {
  const loader = ctx.get('loader')
  const tools = ctx.get('tools')
  const toolNames = tools ? new Set(tools.schemas().map((s) => s.name)) : new Set()
  const servers = []
  const byId = new Map()
  if (!loader) return { servers, byId }
  for (const entry of loader.entries()) {
    if (entry.options.name !== MCP_PLUGIN) continue
    const config = entry.options.config ?? {}
    const serverName = config.serverName ?? entry.id
    const prefix = `mcp__${serverName}__`
    let toolCount = 0
    for (const toolName of toolNames) {
      if (toolName.startsWith(prefix)) toolCount += 1
    }
    const server = {
      id: patchRowId(entry),
      serverName,
      transport: config.transport ?? 'unknown',
      enabled: !entry.disabled,
      phase: entry.fiber ? (PHASE[entry.fiber.state] ?? null) : null,
      toolCount,
    }
    servers.push(server)
    byId.set(server.id, entry)
  }
  return { servers, byId }
}

/**
 * Flip the `disabled:` flag of one server row inside a patch file text,
 * preserving every other byte (comments, `!!js` expressions, layout).
 * @param text  current file content
 * @param entryId  loader entry id of the row, e.g. `mcp-github`
 * @param enabled  desired enablement
 * @returns the edited text; throws when the row is not found.
 */
export function setRowDisabled(text, entryId, enabled) {
  const value = enabled ? 'false' : 'true'
  const lines = text.split(/\r?\n/)
  let rowIndex = -1
  let rowIndent = -1
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)- id: ([A-Za-z0-9_-]+)\s*$/.exec(lines[i])
    if (!m) continue
    if (m[2] === entryId) {
      rowIndex = i
      rowIndent = m[1].length
      break
    }
  }
  if (rowIndex === -1) throw new Error(`patch 中找不到服务器行 "${entryId}"`)
  const keyIndent = ' '.repeat(rowIndent + 2)
  // 1) flip an existing `disabled:` key inside the row block
  for (let i = rowIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*$/.test(line)) continue
    const list = /^(\s*)- /.exec(line)
    if (list && list[1].length <= rowIndent) break
    if (/^(\s*)disabled: /.test(line)) {
      lines[i] = keyIndent + 'disabled: ' + value
      return lines.join('\n')
    }
  }
  // 2) no `disabled:` key yet — insert one right after the `name:` key
  let insertAt = rowIndex + 1
  for (let i = rowIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*$/.test(line)) continue
    const list = /^(\s*)- /.exec(line)
    if (list && list[1].length <= rowIndent) break
    if (/^(\s*)name: /.test(line)) {
      insertAt = i + 1
      break
    }
  }
  lines.splice(insertAt, 0, keyIndent + 'disabled: ' + value)
  return lines.join('\n')
}

/** One `/mcp` snapshot: JSON-safe state the client card renders from. */
export function snapshot(ctx, patchFile) {
  const { servers } = collectServers(ctx)
  return { v: 1, patchFile, servers }
}

/**
 * Toggle one server row: apply the live loader effect first (deterministic),
 * then persist the flag in the patch file.
 */
export async function setEnabled(ctx, patchFile, entry, enabled) {
  await entry.update({ disabled: !enabled })
  const text = fs.readFileSync(patchFile, 'utf8')
  const next = setRowDisabled(text, entry.id, enabled)
  if (next !== text) fs.writeFileSync(patchFile, next)
}

/** Build the command handler for one plugin instance. */
export function makeHandler(ctx, config = {}) {
  return async (invocation) => {
    const patchFile = config.patchFile || defaultPatchFile(ctx)
    const raw = invocation.rawInput.trim()
    try {
      if (!raw) {
        return { kind: 'success', text: JSON.stringify(snapshot(ctx, patchFile)) }
      }
      const parts = raw.split(/\s+/)
      const verb = parts[0].toLowerCase()
      const target = parts[1]
      const { servers, byId } = collectServers(ctx)
      const find = (needle) => servers.find((s) => s.serverName === needle || s.id === needle)

      if (verb === 'on' || verb === 'off' || verb === 'toggle') {
        if (!target) {
          return { kind: 'error', text: `用法: /mcp ${verb} <serverName>` }
        }
        const server = find(target)
        if (!server) {
          return { kind: 'error', text: `未知服务器: ${target}` }
        }
        const want = verb === 'on' ? true : verb === 'off' ? false : !server.enabled
        if (server.enabled === want) {
          const state = server.enabled ? '开启' : '关闭'
          return { kind: 'error', text: `服务器 ${server.serverName} 已经是${state}状态` }
        }
        const entry = byId.get(server.id)
        await setEnabled(ctx, patchFile, entry, want)
        const result = snapshot(ctx, patchFile)
        result.changed = server.serverName
        result.to = want
        return { kind: 'success', text: JSON.stringify(result) }
      }

      if (parts.length === 1) {
        const server = find(verb)
        if (!server) {
          return { kind: 'error', text: `未知服务器: ${verb}` }
        }
        const result = snapshot(ctx, patchFile)
        result.focus = server.serverName
        return { kind: 'success', text: JSON.stringify(result) }
      }

      return {
        kind: 'error',
        text: '用法: /mcp | /mcp <serverName> | /mcp on|off|toggle <serverName>',
      }
    } catch (error) {
      return { kind: 'error', text: `/mcp 失败: ${error?.message ?? String(error)}` }
    }
  }
}

/** Cordis plugin entry: register the `/mcp` command for the plugin's lifetime. */
export function apply(ctx, config = {}) {
  const disposer = ctx.commands.register({
    name: 'mcp',
    description: '列出 MCP 服务器并切换开关 (list & toggle MCP servers)',
    handler: makeHandler(ctx, config),
  })
  ctx.effect(() => disposer)
}
