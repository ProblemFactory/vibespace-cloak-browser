# CloakBrowser for VibeSpace

A browser engine plugin that lets VibeSpace's agent browser run **CloakBrowser** — a Chromium build that sites are less
likely to block as a bot — instead of Chrome, for the browser profiles you choose.

This plugin is a wrapper. It contains no part of CloakBrowser and downloads nothing: you install CloakBrowser yourself,
from its maker, and tell the plugin where its program file is.

This project is not affiliated with CloakHQ. The CloakBrowser browser is theirs, under their
[CloakBrowser Binary License](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md).

## Install

1. **Install CloakBrowser the way its maker says** ([their instructions](https://github.com/CloakHQ/CloakBrowser)). With
   their npm package's tool:

   ```sh
   npx cloakbrowser install    # downloads their build and prints the path of its program file
   npx cloakbrowser info       # shows that path again
   ```

   The program file is the build's `chrome` file, usually `~/.cloakbrowser/chromium-<version>/chrome`. Copy its full path.
2. In VibeSpace: **⚙ → Tools ▸ Plugins… → Install plugin…**
   - Source: **Git repository URL**
   - Location: `https://github.com/ProblemFactory/vibespace-cloak-browser.git`
   - Ref: `main`
   - Credential: **None (a public repository)**
3. **Enable (trusted)**. VibeSpace asks for your consent because a browser engine names the browser VibeSpace starts for
   a profile, and this one runs the program you name in its settings, outside the plugin sandbox. The plugin's own
   process stays sandboxed: it reads only its own folder and its state folder, and it cannot start programs.
4. Open the plugin's settings — the **⚙** on its row in Tools ▸ Plugins… (**⚙ → Plugins → CloakBrowser → Program file**),
   or **⚙ → All Settings… → Plugin: CloakBrowser** — and paste the path from step 1 into **Program file**.
5. Choose it for a profile in **Change build…** (per profile), or make it the **Default browser engine** for new agent
   browsers in **⚙ → All Settings… → Agent browser**.

VibeSpace checks the program file before it starts it — it must be there, be a file you may run, and be a program for
this computer (not a script) — and measures its version once (again whenever the file changes). If something is wrong,
the profile's start is refused with a message that says what and points back to **Program file**.

## The settings

**⚙ → All Settings… → Plugin: CloakBrowser** (or the ⚙ on the plugin's row in Tools ▸ Plugins…):

- **Program file** — the CloakBrowser program (its `chrome` file). Required. Only you can set it: an agent cannot.
- **Sites it may open (host names, comma-separated)** — a CloakBrowser profile reaches **only** the sites in this list.
  VibeSpace starts its own allowlisting proxy for this browser and puts every connection through it: exact host names
  (`example.com`), or `.example.com` for a domain and all its sub-domains. Empty (the default) means it opens no site at
  all. Loopback and link-local addresses are never admitted. Sites outside the list are refused, and the agent is told
  which host was refused.

The proxy is VibeSpace's, not the plugin's: the plugin only declares the site list, and it never names a proxy of its
own. VibeSpace wraps the browser in its own proxy whenever the plugin declares the site list; the core refuses a plugin
version that drops the declaration. Whichever CloakBrowser build you install, the proxy bounds what it can reach.

## What you get, and what you don't

- **The build you installed.** VibeSpace runs exactly the program file you named, and shows the version it measured.
- **A fingerprint seed per profile.** Each profile gets its own seed (`--fingerprint=<seed>`). It is created the first
  time the profile starts, kept in the plugin's state folder (`seeds.json`) and never shared between profiles. A
  profile keeps its fingerprint across restarts, and when you point **Program file** at a newer build.
- **No licence key is passed.** The plugin never hands a key to the browser: the browser's environment is empty. A key
  you saved with CloakBrowser's own tool only changes which build that tool downloads for you.
- **Updates are yours.** Update CloakBrowser with its maker's tool (`npx cloakbrowser update`). A new build lands in a new
  folder: paste its path into **Program file** when you want profiles to use it.

## Requirements

- VibeSpace ≥ the release noted in [CHANGELOG.md](CHANGELOG.md): the first release whose browser engines run a program
  you name in a plugin's settings (the reserved setting `executablePath`), with the engine features this plugin relies
  on (the probe feature `egress-allowlist` and the plugin setting `egressAllowlist`). The manifest's `engines.vibespace`
  names that release, and VibeSpace enforces it at install: an older VibeSpace refuses to install the plugin («requires
  VibeSpace ≥ …»).
- A CloakBrowser build for your computer, installed by you. Tested on Linux x64.

## Licences

- **This plugin** — its code, tests and documents — is [MIT](LICENSE). It contains no part of CloakBrowser, and neither
  it nor VibeSpace downloads CloakBrowser: you obtain the browser from its maker.
- **CloakBrowser** is CloakHQ's, under its [Binary License](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md):
  using it for your own work is fine; a hosted or API-facing VibeSpace, where other people drive the browser, needs
  CloakHQ's separate OEM/SaaS licence.

## Files

| File | What it is |
|---|---|
| `vibespace-plugin.json` | The plugin's manifest: a browser engine with two settings (the program file, the sites). |
| `CHANGELOG.md` | Each plugin version and the VibeSpace release it needs. |
| `server.js`, `lib/engine.js` | The plugin's process. It answers VibeSpace's two engine questions about the program VibeSpace hands it: what it speaks (`GET /probe`), and how a profile starts it (`POST /resolve-launch`). It never opens that program's file. |
| `test/` | `npm test`. |

## Development

```sh
npm test                                   # the plugin under the same node --permission sandbox VibeSpace uses
VIBESPACE_DIR=<a VibeSpace checkout> npm test   # + VibeSpace's own manifest / answer checks and its real plugin loader
CLOAK_EXPECT_HOST_REFUSES=1 VIBESPACE_DIR=<an older checkout> npm test   # that checkout predates the program setting: its refusals pass by name
CLOAK_PROGRAM=<the chrome you installed> VIBESPACE_DIR=<checkout> npm test   # + VibeSpace judges and measures that real program
```

The tests need Node 22 or later and install nothing; with `strace` on PATH they also trace the plugin's process and
count the system calls that name the program it is handed (zero). Against a VibeSpace checkout without the program
setting, the `HOST:` legs fail by name («THE HOST REFUSES THE PLUGIN») unless `CLOAK_EXPECT_HOST_REFUSES=1` says that
host is expected.
