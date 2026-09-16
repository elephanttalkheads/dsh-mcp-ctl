# dsh-mcp-ctl

Claude Code 风格的 `/mcp` 指令 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):
list every MCP server mounted in the harness with its live status, and toggle each one on/off — from the chat.

## What it does

In DSH, each MCP server is a composition row running `@deepseek-ai/dsh-mcp-client`
(one plugin instance per server, e.g. `mcp-github`, `mcp-gitee`). This plugin:

- registers the human slash command **`/mcp`** (command plane — results never enter model history);
- **auto-discovers** every `@deepseek-ai/dsh-mcp-client` row in the live loader tree
  (including disabled ones), reading its enablement, loader fiber phase
  (`pending` / `loading` / `active` / `failed` / `unloading`) and the number of
  tools registered as `mcp__<serverName>__*`;
- renders an **interactive card** in the conversation (via the
  `conversation.chat.commandview` slot, key `mcp`) with per-server toggle
  buttons, status dots and tool counts — a warning flag when a server is
  enabled but exposes zero tools (likely a failed connection);
- **toggles live and durably**: the loader entry is restarted/disposed
  immediately (`entry.update`), and the row's `disabled:` flag is written back
  into the profile's `cordis.patch.yml` so the choice survives restarts (HMR
  applies the file change; the in-memory state already matches, so the reload
  is a no-op).

## Usage

```
/mcp                          # open the interactive server card
/mcp github                   # open the card with that server highlighted
/mcp on github                # enable  (text shortcut, no card needed)
/mcp off gitee                # disable (text shortcut, no card needed)
/mcp toggle chrome-devtools   # flip
```

The card's buttons are equivalent to the text shortcuts — each toggle logs a
compact confirmation row in the chat, and every open card converges on the
fresh state.

## Install

### 首选:从 npm 安装

Requires a DSH `0.1.5-rc.x` web profile (pnpm workspace) — see
[Compatibility](#compatibility) for the exact contracts each half uses.
In the profile directory:

```bash
cd "$DSH_HOME/profiles/web"        # e.g. ~/.dsh/profiles/web
pnpm add dsh-mcp-ctl               # npm: npm install dsh-mcp-ctl
```

> 中国大陆镜像注意:若 npmmirror 尚未同步新版本,显式指定官方源
> `pnpm add dsh-mcp-ctl --registry=https://registry.npmjs.org/`。

Then add one row to the profile's `cordis.patch.yml` — **as an insert** (a
bare top-level `- id:` entry would be treated as an override of an existing
entry and silently skipped):

```yaml
- insert:
    - id: mcp-ctl
      name: 'dsh-mcp-ctl'
```

The loader's HMR mounts the host half immediately; the `/mcp` command works
right away. The Web client card appears after one browser refresh (the client
bundle is served by the profile's client-modules route once the entry is live).
No process restart is required.

### 备选:从源码安装 (git)

For unreleased code or development:

```bash
cd "$DSH_HOME/profiles/web"
pnpm add git+https://github.com/elephanttalkheads/dsh-mcp-ctl.git
```

Then add the same `- insert:` row shown above. Note the harness process
usually runs with the workspace directory as its cwd; a package with this
repo's `name`/`exports` can then resolve to the checkout itself (Node
self-reference) instead of the profile copy — keep the checkout in sync and
restart after updating.

### Config

| Field | Default | Description |
|---|---|---|
| `patchFile` | `<profile>/cordis.patch.yml` | Which composition patch file the toggle writes to. Defaults to `cordis.patch.yml` in the profile directory the plugin was mounted from (`ctx.baseUrl`, a `file://` URL), falling back to `$DSH_HOME/profiles/web/cordis.patch.yml`. Set it when your servers live in another file. |

Example:

```yaml
- id: mcp-ctl
  name: 'dsh-mcp-ctl'
  config:
    patchFile: 'C:/Users/me/.dsh/profiles/web/cordis.patch.yml'
```

### Re-enabling a row another manager disabled

A plugin manager (for example `dshmarket`) switches a row off by appending a
top-level override to the patch file:

```yaml
- id: mcp-ctl
  disabled: true
```

A file-order patch layer gives that override the last word, so `/mcp` (which
cannot run while its own row is disabled) will not start by itself. Flip it by
hand once — `/mcp` then keeps the row consistent from then on, because it edits
the row's *effective* (last) mention and adds the same kind of override for rows
a bundle layer defines.

### Updating

```bash
cd "$DSH_HOME/profiles/web"
pnpm update dsh-mcp-ctl            # or: pnpm add dsh-mcp-ctl@latest
# restart `dsh web` — loader HMR ignores node_modules, so a running process
# keeps the module it imported at startup
```

### Publishing

New versions go to the npm registry (account `elephantalker`). The npm
account's default registry is the npmmirror mirror, so always publish to the
official registry explicitly:

```bash
npm version patch    # or minor / major — semver: fixes=patch, features=minor
npm publish --registry=https://registry.npmjs.org/
git push --follow-tags
```

## How it works under the hood

| Piece | Mechanism |
|---|---|
| command | `ctx.commands.register` (`@deepseek-ai/dsh-commands`), with an `input.hint` for the composer |
| discovery | `ctx.loader.entries()` filtered by `name === '@deepseek-ai/dsh-mcp-client'` |
| status | `entry.disabled` + `entry.fiber.state` (same mapping as `dsh-host-plugin-inventory`) |
| tool count | `ctx.tools.schemas()` prefix-matched by `mcp__<serverName>__` |
| live toggle | `entry.update({ disabled })` — the loader's own mutation API |
| persistence | surgical edit of the row's *effective* `disabled:` value in `cordis.patch.yml` — the last block mentioning the row id, or a newly appended top-level `- id:` override when no layer in that file defines it (comments, `!!js` expressions and line endings elsewhere are byte-preserved) |
| card UI | `conversation.chat.commandview` keyed slot + the `useChat` session hook + `ctx.remote.commands.execute` |

State travels as JSON inside the command result text; the card always renders
the newest `mcp` command node found in the live chat snapshot.

## Compatibility

The package is tested against the contracts shipped in DSH `0.1.5-rc.x`
(harness packages `0.1.5-rc.2`). The version-sensitive points, all covered by
`npm test`:

| Half | Contract | Notes |
|---|---|---|
| Host | `ctx.commands.register({ name, description, input, handler })`; the handler receives `{ commandId, agent, rawInput, attachments, signal }` and returns `{ kind, text }` | `input.hint` was added to the descriptor in 0.1.5; the registry logs the `command/run`→`command/done` pair itself |
| Host | loader `Entry.disabled`, `Entry.fiber.state`, `Entry.update({ disabled })` | fiber state → phase mapping matches `dsh-host-plugin-inventory`; `Entry.update` changes live state only, which is why the patch file is the durable channel |
| Host | `ctx.baseUrl` is a **`file://` directory URL** (`dsh-app-boot` anchors it with `pathToFileURL`) | resolved with `fileURLToPath`; a plain directory path is still accepted |
| Host | patch layers apply in file order (`include`'s `applyEntryPatches`), so the last mention of a row id owns its fields, and a top-level `- id: X` overrides a row an earlier layer inserted | this is what makes a manager-written `disabled: true` override win |
| Client | `conversation.chat.commandview` is a **keyed, session-scoped** slot whose owner props are `{ node: CommandNode, compaction? }` | the key is the command name (`mcp`) |
| Client | the live conversation nodes come from the **`useChat`** session standard prop (contributed by the Chat view); `SessionSnapshot.chat` no longer exists | the card falls back to `useSession(...).chat.legacy.nodes` on older releases and to its own node when neither hook is present |
| Client | `ctx.remote.commands.execute(agentId, line, submittedAttachments, signal?)` returns `{ ok, value }` / `{ ok, error }` | the same Remote the composer dispatches through |
| Client | `dsh.client.inject` is an informational package-edge list (not Cordis service injection); the bundle itself only requires the platform seed word `react` | it now names `dsh-client-ui-chat`, `dsh-client-ui-slots`, `dsh-api-remotes` |

Known limitation: if the home-level layer (`$DSH_HOME/cordis.patch.yml`) pins the
same row, it is applied after the profile layer and outranks this plugin's edit;
remove the entry there, or point `patchFile` at that file.

## Development

```bash
pnpm check   # syntax-check host and client bundles
pnpm test    # patch semantics + client behaviour (incl. the real profile patch, read-only)
```

`test/patch.test.mjs` pins the patch-file editing rules (including the real
`$DSH_HOME/profiles/web/cordis.patch.yml`, read-only, when present);
`test/client.test.mjs` materializes the client bundle against a stub React and
stub slot runtime and drives both the modern `useChat` path and the legacy
`useSession` fallback.

The client half is a hand-written `window.__ModuleLoader__.load` bundle
(plain JS, no build step), the format the web client runtime consumes.

## License

MIT
