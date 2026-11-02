# CloakBrowser for VibeSpace

A browser engine plugin that lets VibeSpace's agent browser run **CloakBrowser** — a Chromium build that sites are less
likely to block as a bot — instead of Chrome, for the browser profiles you choose.

VibeSpace does not include CloakBrowser. Installing this plugin is how you add it.

This project is not affiliated with CloakHQ. The CloakBrowser browser is theirs, under their
[CloakBrowser Binary License](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md).

## Install

1. In VibeSpace: **⚙ → Tools ▸ Plugins… → Install plugin…**
   - Source: **Git repository URL**
   - Location: `https://github.com/ProblemFactory/vibespace-cloak-browser.git`
   - Ref: `main`
   - Credential: **None (a public repository)**
2. **Enable (trusted)**. VibeSpace asks for your consent because a browser engine names the program VibeSpace starts as
   a profile's browser. The plugin's own process runs sandboxed: it reads only its own folder and its state folder, and
   it cannot start programs.
3. Choose it for a profile in **Change build…** (per profile). The default-engine row in ⚙ Settings offers it from the
   VibeSpace release that carries the engine features (see [Requirements](#requirements)).

The first time a profile starts on CloakBrowser, VibeSpace downloads the browser (about 217 MB) from CloakHQ, checks its
length and its SHA-256 against [`kernel.json`](kernel.json), unpacks it into the plugin's state folder and measures its
version once. Until the download has finished, the profile's start is refused with a message that says so; start it
again when it is done.

## The one setting: the sites it may open

⚙ Settings → **Plugin: CloakBrowser** → **Sites it may open (host names, comma-separated)**

A CloakBrowser profile reaches **only** the sites in this list. VibeSpace starts its own allowlisting proxy for this
browser and puts every connection through it: exact host names (`example.com`), or `.example.com` for a domain and all
its sub-domains. Empty (the default) means it opens no site at all. Loopback and link-local addresses are never
admitted. Sites outside the list are refused, and the agent is told which host was refused.

The proxy is VibeSpace's, not the plugin's: the plugin only declares the site list, and it never names a proxy of its
own. VibeSpace wraps the browser in its own proxy whenever the plugin declares the site list; the core refuses a plugin
version that drops the declaration. CloakBrowser itself needs no site of its own (measured: see
[`egress-proof.json`](egress-proof.json)).

## What you get, and what you don't

- **The free CloakBrowser build only**: Chromium 146.0.7680.177.5 for **Linux x64**, the build whose network behaviour
  was measured. It needs no key and no sign-in.
- **No license key, no seats, no Pro build.** A key would make the vendor's tools fetch a different build, and that
  build has not been measured. This plugin never passes a key to the browser: the browser's environment is empty.
- **A fingerprint seed per profile.** Each profile gets its own seed (`--fingerprint=<seed>`). It is created the first
  time the profile starts, kept in the plugin's state folder (`seeds.json`) and never shared between profiles. A
  profile keeps its fingerprint across restarts.
- **Windows and macOS are not supported** (no measured build). VibeSpace says so when you choose it there, and nothing is
  downloaded.

## Requirements

- VibeSpace ≥ the release noted in [CHANGELOG.md](CHANGELOG.md): the first release with the engine features this
  plugin relies on (the probe feature `egress-allowlist` — the allowlisting proxy for a plugin engine —, the plugin
  setting `egressAllowlist`, and `tar.gz` browser downloads). The manifest's `engines.vibespace` names that release, and
  VibeSpace enforces it at install: an older VibeSpace refuses to install the plugin («requires VibeSpace ≥ …»).
- Linux x64.

## Licences

- **This repository** (the plugin's code, tests and documents): [MIT](LICENSE).
- **The CloakBrowser browser** is CloakHQ's. It is not in this repository, and this plugin does not redistribute it.
  VibeSpace downloads it on your computer from CloakHQ's own download address, and you use it under CloakHQ's
  [CloakBrowser Binary License](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md). In short: free to
  use for your own browsing and automation, no redistribution. A **separate licence from CloakHQ** is required if you
  give other people control of the browser, for example a hosted VibeSpace whose users drive CloakBrowser. Read the
  licence's "Cloud, Container, OEM/SaaS" and "Acceptable Use" sections before you use it.
- CloakBrowser's own wrapper code (not used here) is MIT; CloakBrowser is built on Chromium (BSD 3-Clause).

## Files

| File | What it is |
|---|---|
| `vibespace-plugin.json` | The plugin's manifest: a browser engine with one setting. |
| `CHANGELOG.md` | Each plugin version and the VibeSpace release it needs. |
| `server.js`, `lib/engine.js` | The plugin's process. It answers VibeSpace's two engine questions: is the browser installed (`GET /probe`), and how is it started for a profile (`POST /resolve-launch`). |
| `kernel.json` | Where VibeSpace downloads the browser from, its SHA-256 and length, and the archive's layout. The SHA-256 is the control: an archive that does not match is never unpacked. |
| `egress-proof.json` | What the free build was measured to reach (documentation; the proxy enforces it). |
| `scripts/measure-egress.mjs` | Re-measures that, for a new build. |
| `test/` | `npm test`. |

## Development

```sh
npm test                                   # the plugin under the same node --permission sandbox VibeSpace uses
VIBESPACE_DIR=<a VibeSpace checkout> npm test   # + VibeSpace's own manifest / kernel / answer checks and its real plugin loader
CLOAK_EXPECT_HOST_REFUSES=1 VIBESPACE_DIR=<an older checkout> npm test   # that checkout predates the engine features: its refusals pass by name
CLOAK_ARCHIVE=<the downloaded .tar.gz> VIBESPACE_DIR=<checkout> npm test   # + the real archive against kernel.json
```

The tests need Node 22 or later and install nothing. Against a VibeSpace checkout without the engine features, the
`HOST:` legs fail by name («THE HOST REFUSES THE PLUGIN») unless `CLOAK_EXPECT_HOST_REFUSES=1` says that host is expected.

### Moving to a new CloakBrowser build

1. Download the new archive once and take its length and SHA-256.
2. Update `kernel.json`: `version`, `platforms['linux-x64']` (`url`, `sha256`, `bytes`, `version`) and, if the archive's
   layout changed, `layout`.
3. Re-measure: `node scripts/measure-egress.mjs --work <empty dir> --download --agent-browser <the real agent-browser>`
   (needs `strace`). Record the result in `egress-proof.json`. A build that reaches anything beyond the loopback port its
   driver opened is not shipped.
4. `CLOAK_ARCHIVE=… VIBESPACE_DIR=… npm test`, then bump the plugin's `version`, add its CHANGELOG entry and tag a release.
