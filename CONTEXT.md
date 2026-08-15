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
  is never mounted and its tools never register.
- **Phase** — a server row's live fiber phase: `pending`, `loading`, `active`,
  `failed`, `unloading`; `null` when the row has no live fiber. Observed through
  the read-only `pluginInventory` projection.
- **Composition Patch** — a layered overlay YAML file (`cordis.patch.yml`, one
  per bundle plus one per profile) that inserts/overrides/removes rows. The
  profile patch is the deployment's hand-edited layer; HMR hot-applies saved
  edits without a process restart.
- **Hot Reload (HMR)** — the loader watches the profile directory and reloads
  changed config; an edited server row disconnects/reconnects its MCP client
  without restarting the harness.
- **Toggle** — flipping a server row's enablement so its tools register
  (on) or unregister (off).
- **Patch Row Insert** — a patch entry shaped `- insert:` wrapping new rows.
  New plugins (including MCP servers) must be inserted this way; a top-level
  `- id: X` patch entry is an *override* of an already-existing entry and is
  silently skipped when `X` does not exist.
- **Row Id** — the bare id a row was inserted under in the patch file
  (`mcp-github`). The loader may namespace live entry ids (`include:mcp-github`),
  so patch edits always target the raw row id (`entry.options.id`, falling
  back to the last id segment).
- **Command Card** — the per-command interactive row in the chat view, keyed by
  command name in the `conversation.chat.commandview` slot. Cards render the
  state carried by the newest `mcp` command node in the session's legacy node
  list, so every card converges on live state after any toggle.
- **Command Plane** — DSH's human slash-command registry (`ctx.commands`).
  Command results render in the UI and never enter model history.
- **Command Card** — the per-command interactive row in the chat view, keyed by
  command name in the `conversation.chat.commandview` slot.
