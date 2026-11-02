# Changelog

## 0.2.0

- CloakBrowser is now yours to install: install it from its maker (`npx cloakbrowser install`, or their own download) and
  paste the path of its program file into ⚙ → Plugins → CloakBrowser → **Program file**. VibeSpace checks that file,
  measures its version and runs it inside its allowlisting proxy. The plugin downloads nothing, pins no build and never
  opens the program's file itself.
- Removed: `kernel.json` (VibeSpace's download of the vendor's archive), `egress-proof.json` and its measuring script.
- Unchanged: the fingerprint seed per profile (`seeds.json`) and the setting «Sites it may open».
- Requires VibeSpace ≥ 2.369.371 <!-- set at publish: the first VibeSpace release whose browser engines run a program you name in a plugin's settings (the reserved executablePath setting) — the same version as engines.vibespace in vibespace-plugin.json -->

## 0.1.0

- First release: CloakBrowser's free build (Chromium 146.0.7680.177.5, Linux x64) as a VibeSpace browser engine, with the
  one setting «Sites it may open».
- Requires VibeSpace ≥ 2.369.371
