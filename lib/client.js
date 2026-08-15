/**
 * dsh-mcp-ctl — Client half (Web).
 *
 * Built artifact in the harness's browser module format
 * (`window.__ModuleLoader__.load`). Renders the `/mcp` command row in the
 * conversation via the `conversation.chat.commandview` slot (key `mcp`):
 *  - a bare `/mcp` row renders the full interactive card (server list, live
 *    status, tool counts, per-server toggle buttons);
 *  - a row produced by `/mcp on|off|toggle <name>` renders a compact
 *    confirmation line.
 *
 * State travels inside the command result text (JSON), which the host writes
 * on every invocation. The card always prefers the newest `mcp` command node
 * found in the session snapshot, so every card converges on live state after
 * any toggle, on any tab. Toggle buttons dispatch through the existing
 * `commands.execute` Remote (the same path the composer uses), which logs the
 * lifecycle and produces the fresh command row the card then picks up.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mcp-ctl',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')

    const { createElement: h, useState, useMemo } = react

    // ── state parsing ────────────────────────────────────────────────────────

    /** Parse the host's JSON state out of one command node's outcome. */
    function parseState(node) {
      if (!node || node.kind !== 'command' || !node.outcome || node.outcome.kind !== 'success') return null
      try {
        const data = JSON.parse(node.outcome.text || '')
        if (data && Array.isArray(data.servers)) return data
      } catch (error) {
        // fall through
      }
      return null
    }

    /** A row that came from `/mcp on|off|toggle <name>` renders compact. */
    function isToggleNode(node) {
      const args = node && node.args ? node.args.trim() : ''
      return /^(on|off|toggle)\s+/i.test(args)
    }

    /** Newest parseable `mcp` command state in the session snapshot (seq order). */
    function latestState(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.nodes)) return null
      let best = null
      for (const node of snapshot.nodes) {
        if (node.kind !== 'command' || node.name !== 'mcp') continue
        const state = parseState(node)
        if (state) best = state
      }
      return best
    }

    // ── labels ───────────────────────────────────────────────────────────────

    const PHASE_TEXT = {
      pending: '连接中',
      loading: '加载中',
      active: '运行中',
      failed: '失败',
      unloading: '卸载中',
    }

    // ── shared styles (theme tokens) ─────────────────────────────────────────

    const cardStyle = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 10,
      background: 'var(--dsw-alias-bg-layer-1)',
      padding: '10px 12px',
      maxWidth: 640,
    }
    const titleStyle = {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary)',
      marginBottom: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }
    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '7px 8px',
      borderRadius: 8,
    }
    const rowFocusStyle = {
      ...rowStyle,
      background: 'var(--dsw-alias-bg-layer-2)',
    }
    const subStyle = {
      fontSize: 12,
      color: 'var(--dsw-alias-label-secondary)',
      marginTop: 2,
    }
    const btnStyle = {
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      borderRadius: 6,
      padding: '3px 12px',
      fontSize: 12,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const compactStyle = {
      fontSize: 13,
      color: 'var(--dsw-alias-label-primary)',
      padding: '2px 0',
    }
    const errorStyle = {
      ...compactStyle,
      color: 'var(--dsw-alias-state-error-primary)',
    }
    const warnStyle = {
      color: 'var(--dsw-alias-state-warn-primary)',
    }

    // ── components ───────────────────────────────────────────────────────────

    function StatusDot({ phase, enabled }) {
      const color = !enabled
        ? 'var(--dsw-alias-border-l2)'
        : phase === 'active'
          ? 'var(--dsw-alias-state-success-primary)'
          : phase === 'failed'
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-state-warn-primary)'
      return h('span', {
        style: {
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 4,
          background: color,
          marginRight: 6,
          flex: 'none',
        },
      })
    }

    function PhaseText({ server }) {
      if (!server.enabled) {
        return h('span', null, '已关闭')
      }
      if (!server.phase) {
        return h('span', null, '未挂载')
      }
      const warning = server.phase === 'active' && server.toolCount === 0
      return h('span', { style: warning ? warnStyle : null }, PHASE_TEXT[server.phase] || server.phase)
    }

    function ServerRow({ server, focus, busy, onToggle }) {
      const warning = server.enabled && server.phase === 'active' && server.toolCount === 0
      return h('div', { style: focus ? rowFocusStyle : rowStyle },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center' } },
            h(StatusDot, { phase: server.phase, enabled: server.enabled }),
            h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, server.serverName),
            h('span', {
              style: { marginLeft: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
            }, server.transport === 'streamable-http' ? 'http' : server.transport),
          ),
          h('div', { style: subStyle },
            h(PhaseText, { server }),
            ' · 工具 ' + server.toolCount,
            warning ? h('span', { style: warnStyle }, ' · ⚠ 已启用但无工具(可能连接失败)') : null,
          ),
        ),
        h('button', {
          style: btnStyle,
          disabled: busy === server.serverName,
          onClick: () => onToggle(server),
        }, busy === server.serverName ? '切换中…' : server.enabled ? '关闭' : '开启'),
      )
    }

    /** Full interactive card for a bare `/mcp` row. */
    function McpCard(props) {
      const { ctx, node, sessionId, useSession } = props
      const snapshot = typeof useSession === 'function' ? useSession() : null
      const state = useMemo(() => latestState(snapshot) || parseState(node), [snapshot, node])
      const [busy, setBusy] = useState(null)
      const [error, setError] = useState(null)

      if (!state) {
        if (node && node.outcome && node.outcome.kind === 'error') {
          return h('div', { style: errorStyle }, node.outcome.text)
        }
        return h('div', { style: compactStyle }, '/mcp 执行中…')
      }

      const toggle = async (server) => {
        setBusy(server.serverName)
        setError(null)
        try {
          const line = `/mcp ${server.enabled ? 'off' : 'on'} ${server.serverName}`
          const res = await ctx.remote.commands.execute(sessionId, line)
          if (!res.ok) {
            setError(`切换失败: ${res.error?.code ?? ''} ${res.error?.message ?? ''}`.trim())
          }
        } catch (err) {
          setError(`切换失败: ${err && err.message ? err.message : String(err)}`)
        } finally {
          setBusy(null)
        }
      }

      const rows = (state.servers || []).map((server) => h(ServerRow, {
        key: server.id,
        server,
        focus: server.serverName === state.focus,
        busy,
        onToggle: toggle,
      }))

      return h('div', { style: cardStyle },
        h('div', { style: titleStyle },
          h('span', null, 'MCP 服务器'),
          h('span', { style: { fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' } },
            state.servers ? state.servers.length + ' 台' : ''),
        ),
        rows,
        error ? h('div', { style: { ...errorStyle, marginTop: 6 } }, error) : null,
        h('div', { style: { ...subStyle, marginTop: 8, fontSize: 11 } },
          '配置: ' + (state.patchFile || ''),
        ),
      )
    }

    /** Compact confirmation line for `/mcp on|off|toggle <name>` rows. */
    function McpCompact(props) {
      const { node } = props
      if (node && node.outcome && node.outcome.kind === 'error') {
        return h('div', { style: errorStyle }, node.outcome.text)
      }
      const state = parseState(node)
      if (!state) {
        return h('div', { style: compactStyle }, '/mcp …')
      }
      const changed = (state.servers || []).find((s) => s.serverName === state.changed)
      const text = state.to ? '已开启' : '已关闭'
      return h('div', { style: compactStyle },
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '/mcp '),
        h('span', { style: { fontWeight: 600 } }, String(state.changed) + ' ' + text),
        changed ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', marginLeft: 8 } },
          '· ' + (changed.enabled ? '运行中' : '已关闭') + ' · 工具 ' + changed.toolCount) : null,
      )
    }

    function McpRow(props) {
      return isToggleNode(props.node) ? h(McpCompact, props) : h(McpCard, props)
    }

    // ── plugin body ───────────────────────────────────────────────────────────

    /** Required services for the client plugin fiber. */
    const inject = ['remote', 'remote.commands']

    function apply(ctx) {
      ctx.inject(['slots'], (scope) => {
        scope.slots.inject('conversation.chat.commandview', () => scope.slots.register(
          { name: 'conversation.chat.commandview', key: 'mcp' },
          (props) => h(McpRow, {
            ctx,
            node: props.node,
            sessionId: props.sessionId,
            useSession: props.useSession,
          }),
        ))
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
