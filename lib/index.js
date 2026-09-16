/**
 * dsh-mcp-ctl — Host half.
 *
 * Registers the human slash command `/mcp`: lists every MCP server mounted in
 * the harness composition (each `@deepseek-ai/dsh-mcp-client` loader entry)
 * with its live enablement, loader fiber phase and registered tool count, and
 * toggles a server on/off.
 *
 * Toggling works in two steps:
 *   1. durable: the row's effective `disabled:` value is edited in the
 *             profile's `cordis.patch.yml` so the choice survives restarts
 *             (see `setRowDisabled` for which occurrence that is);
 *   2. live:  `entry.update({ disabled })` restarts/disposes that loader entry
 *             (tools register/unregister immediately). The loader's HMR
 *             watcher then re-applies the edited patch layer; because the
 *             in-memory options already match, that reload is a no-op.
 *
 * The patch file is located by the `patchFile` config option, defaulting to
 * `<ctx.baseUrl>/cordis.patch.yml` (the profile directory the plugin was
 * mounted from), with a `$DSH_HOME/profiles/web/cordis.patch.yml` fallback.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-mcp-ctl'

/** Service keys this plugin requires before activation. */
export const inject = ['commands']

/** The composition plugin that bridges one MCP server. */
const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/**
 * Loader fiber state → human phase. Mirrors the mapping published by
 * `@deepseek-ai/dsh-host-plugin-inventory` (FIBER_STATE: pending 0, loading 1,
 * active 2, failed 3, disposed 4, unloading 5; `disposed` maps to null there
 * too).
 */
const PHASE = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  5: 'unloading',
}

/**
 * Resolve the profile patch file the plugin manages.
 *
 * `ctx.baseUrl` is a `file://` directory URL since DSH anchors the profile tree
 * with `pathToFileURL(profileDir)` (a plain filesystem path is still accepted,
 * for tests and older hosts). When neither the base URL nor the fallback
 * carries a patch file the fallback path is returned unvalidated, so callers
 * surface a plain "file not found" instead of silently toggling nothing.
 */
export function defaultPatchFile(ctx) {
  const base = ctx?.baseUrl
  if (typeof base === 'string' && base !== '') {
    let dir = base
    if (base.startsWith('file:')) {
      try {
        dir = fileURLToPath(base)
      } catch {
        dir = base
      }
    }
    try {
      if (fs.statSync(dir).isFile()) dir = path.dirname(dir)
    } catch {
      // Not an existing path: keep it as-is and let the patch lookup decide.
    }
    const candidate = path.join(dir, 'cordis.patch.yml')
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
    const serverName = config.serverName ?? patchRowId(entry)
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

/** Escape a row id for the literal `- id: <id>` pattern. */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Flip the effective `disabled:` value of one server row inside a patch file
 * text, preserving every other byte (comments, `!!js` expressions, layout and
 * the file's own line endings).
 *
 * Patch semantics (`@deepseek-ai/cordis-plugin-include`'s `applyEntryPatches`)
 * apply patch layers in file order, so the LAST block in the file mentioning
 * the row id owns its effective fields: a nested `- insert:` row carries the
 * row's definition, while a top-level `- id: X` block overrides fields of an
 * already-defined row — including one a bundle layer inserted. This helper
 * therefore edits that last mention, and appends a top-level override block
 * when the file never mentions the id (a server shipped by a bundle layer).
 *
 * @param text  current file content
 * @param entryId  raw patch row id of the row, e.g. `mcp-github`
 * @param enabled  desired enablement
 * @returns the edited text; throws when the row cannot be located or appended.
 */
export function setRowDisabled(text, entryId, enabled) {
  const value = enabled ? 'false' : 'true'
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const idLine = new RegExp(`^(\\s*)- id: ${escapeRegExp(entryId)}\\s*$`)
  const matches = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = idLine.exec(lines[i])
    if (m) matches.push({ index: i, indent: m[1].length })
  }
  if (matches.length === 0) return appendOverride(lines, entryId, value, eol)

  const { index: rowIndex, indent: rowIndent } = matches[matches.length - 1]
  const keyIndent = ' '.repeat(rowIndent + 2)
  // The row block ends at the next sibling (or shallower) list item.
  let blockEnd = lines.length
  for (let i = rowIndex + 1; i < lines.length; i += 1) {
    const list = /^(\s*)- /.exec(lines[i])
    if (list && list[1].length <= rowIndent) {
      blockEnd = i
      break
    }
  }
  // 1) flip an existing `disabled:` key inside the row block. Only the row's
  //    own key (exactly one level below the `- id:` line) counts: a `disabled`
  //    inside the row's `config:` block belongs to the plugin, not the loader,
  //    and must stay untouched.
  const keyLine = new RegExp(`^ {${rowIndent + 2}}disabled:(?:\\s|$)`)
  for (let i = rowIndex + 1; i < blockEnd; i += 1) {
    if (keyLine.test(lines[i])) {
      lines[i] = keyIndent + 'disabled: ' + value
      return lines.join(eol)
    }
  }
  // 2) no `disabled:` key yet — insert one right after the `name:` key
  let insertAt = rowIndex + 1
  let insertIndent = keyIndent
  for (let i = rowIndex + 1; i < blockEnd; i += 1) {
    const m = /^(\s*)name:/.exec(lines[i])
    if (m) {
      insertAt = i + 1
      insertIndent = m[1]
      break
    }
  }
  lines.splice(insertAt, 0, insertIndent + 'disabled: ' + value)
  return lines.join(eol)
}

/** Append a top-level `- id: X` override block, the layer's last word on the row. */
function appendOverride(lines, entryId, value, eol) {
  const out = lines.slice()
  while (out.length && out[out.length - 1] === '') out.pop()
  if (out.length) out.push('')
  out.push(`- id: ${entryId}`, `  disabled: ${value}`, '')
  return out.join(eol)
}

/** One `/mcp` snapshot: JSON-safe state the client card renders from. */
export function snapshot(ctx, patchFile) {
  const { servers } = collectServers(ctx)
  return { v: 1, patchFile, servers }
}

/**
 * Toggle one server row: persist the flag in the patch file first (durable
 * truth; the loader's live patch watcher applies it), then apply the live
 * loader effect. If the live update fails the file still converges on the
 * next config reload or restart.
 */
export async function setEnabled(ctx, patchFile, entry, enabled) {
  const text = fs.readFileSync(patchFile, 'utf8')
  const next = setRowDisabled(text, patchRowId(entry), enabled)
  if (next !== text) fs.writeFileSync(patchFile, next)
  try {
    await entry.update({ disabled: !enabled })
  } catch (error) {
    ctx.logger?.warn?.('[dsh-mcp-ctl] live loader update failed (patch file already persisted): %s', error)
  }
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
    input: { hint: '[on|off|toggle] <serverName>' },
    handler: makeHandler(ctx, config),
  })
  ctx.effect(() => disposer, 'dsh-mcp-ctl: /mcp command')
}
