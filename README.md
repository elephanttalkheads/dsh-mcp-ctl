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

Requires DSH `0.1.0-rc.x` web profile (pnpm workspace). In the profile directory:

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
| `patchFile` | `<profile>/cordis.patch.yml` | Which composition patch file the toggle writes to. Defaults to `ctx.baseUrl/cordis.patch.yml` (the profile the plugin was mounted from), falling back to `$DSH_HOME/profiles/web/cordis.patch.yml`. Set it when your servers live in another file. |

Example:

```yaml
- id: mcp-ctl
  name: 'dsh-mcp-ctl'
  config:
    patchFile: 'C:/Users/me/.dsh/profiles/web/cordis.patch.yml'
```

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
| command | `ctx.commands.register` (`@deepseek-ai/dsh-commands`) |
| discovery | `ctx.loader.entries()` filtered by `name === '@deepseek-ai/dsh-mcp-client'` |
| status | `entry.disabled` + `entry.fiber.state` (same mapping as `dsh-host-plugin-inventory`) |
| tool count | `ctx.tools.schemas()` prefix-matched by `mcp__<serverName>__` |
| live toggle | `entry.update({ disabled })` — the loader's own mutation API |
| persistence | surgical edit of the row's `disabled:` key in `cordis.patch.yml` (comments and `!!js` expressions elsewhere are byte-preserved) |
| card UI | `conversation.chat.commandview` keyed slot + `ctx.remote.commands.execute` |

State travels as JSON inside the command result text; the card always renders
the newest `mcp` command node found in the session snapshot.

## Development

```bash
pnpm check   # syntax-check host and client bundles
pnpm test    # exercise the patch-editing helper (incl. the real profile patch, read-only)
```

The client half is a hand-written `window.__ModuleLoader__.load` bundle
(plain JS, no build step), the format the web client runtime consumes.

## License

MIT
