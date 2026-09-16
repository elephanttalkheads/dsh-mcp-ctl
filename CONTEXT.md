# CONTEXT — /mcp for DeepSeek Harness

This repo builds a Claude-Code-style `/mcp` command for DeepSeek Harness (DSH): a
human slash command that lists the harness's MCP servers with live status and
toggles each one on/off.

## Glossary

- **MCP Server** — an external Model Context Protocol server bridged into DSH so
  its tools become model-callable native tools. Bridging is done by the
  `@deepseek-ai/dsh-mcp-client` plugin.
- **Server Row** — one composition entry (loader entry) that runs
  `@deepseek-ai/dsh-mcp-client`. Identified by its loader entry id (e.g.
  `mcp-github`) and by its `serverName` (e.g. `github`), the namespace of its
  model-facing tool names (`mcp__<serverName>__<tool>`).
- **Enablement** — whether a server row is enabled or carries `disabled: true`
  in the composition. The loader is the sole lifecycle authority: a disabled row
  is never mounted and its tools never register. The *effective* value is the
  one set by the last patch layer — and the last mention inside it — that names
  the row, not merely the value written beside the row's definition.
- **Phase** — a server row's live fiber phase: `pending`, `loading`, `active`,
  `failed`, `unloading`; `null` when the row has no live fiber (or is
  `disposed`). Observed through the read-only `pluginInventory` projection.
- **Composition Patch** — a layered overlay YAML file (`cordis.patch.yml`, one
  per bundle, one per profile and one for `$DSH_HOME`) that
  inserts/overrides/removes rows. The profile patch is the deployment's
  hand-edited layer; HMR hot-applies saved edits without a process restart.
- **Hot Reload (HMR)** — the loader watches the profile patch directory and the
  home patch path and reloads changed config; an edited server row
  disconnects/reconnects its MCP client without restarting the harness. The
  `web` profile ships `patchReload: live`; `acp`, `headless` and the `sdk`
  profiles apply patches only at startup.
- **Toggle** — flipping a server row's enablement so its tools register
  (on) or unregister (off).
- **Patch Row Insert** — a patch entry shaped `- insert:` wrapping new rows.
  New plugins (including MCP servers) must be inserted this way; a top-level
  `- id: X` patch entry is an *override* of an already-existing entry and is
  silently skipped when `X` does not exist.
- **Override Row** — a top-level patch entry shaped `- id: X` carrying field
  values (in practice `disabled: true|false`). It mutates the row object an
  earlier layer inserted, so it is how one layer — a plugin manager such as
  `dshmarket`, or this plugin — pins a row it does not own. Patches apply in
  file order, so an override outranks the row's own inline `disabled:`.
- **Effective Row Mention** — the last block in a patch file that names a row
  id; it owns that row's effective fields, so it is the only mention a toggle
  may edit. That is the override when one exists, otherwise the insert row,
  otherwise a freshly appended override for a row a bundle layer defines.
- **Row Id** — the bare id a row was inserted under in the patch file
  (`mcp-github`). The loader may namespace live entry ids (`include:mcp-github`),
  so patch edits always target the raw row id (`entry.options.id`, falling
  back to the last id segment).
- **Client Chat Hook** — `useChat`, the session-scoped standard prop the Chat
  view contributes to every occupant of a session-scoped slot
  (`conversation.chat.commandview` included). It selects over the live
  `ChatSnapshot`, whose compatibility projection `legacy.nodes` carries the
  folded command nodes. DSH 0.1.5 removed the older `SessionSnapshot.chat`
  slice; the card still accepts `useSession(...).chat.legacy.nodes` from
  pre-0.1.5 releases.
- **Command Card** — the per-command interactive row in the chat view, keyed by
  command name in the `conversation.chat.commandview` slot. Cards render the
  state carried by the newest `mcp` command node in the conversation's node
  list, so every card converges on live state after any toggle.
- **Command Plane** — DSH's human slash-command registry (`ctx.commands`).
  Command results render in the UI and never enter model history.
- **Registry Install** — installing `dsh-mcp-ctl` from the npm registry
  (`pnpm add dsh-mcp-ctl`); the preferred distribution channel. Updates are a
  plain `pnpm update` plus one harness restart.
- **Git Install** — installing from the GitHub checkout
  (`pnpm add git+https://github.com/elephanttalkheads/dsh-mcp-ctl.git`); the
  fallback for unreleased code. Because the harness process's cwd is usually
  the workspace, Node self-reference can resolve the package to the checkout
  instead of the profile copy — keep both in sync.
