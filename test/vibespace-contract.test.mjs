// THE CONTRACT — this package judged by VibeSpace's OWN pure verdicts, imported from a VibeSpace checkout (VIBESPACE_DIR):
// src/plugin-manifest.js validateManifest / capabilitySummary, src/engine-kernel.js kernelManifestVerdict,
// src/browser-engines.js engineAnswerVerdict. Without VIBESPACE_DIR only the self-contained shape checks run.
//
// The three engine-SPI fields this plugin relies on (VibeSpace's engine plugin contract):
//   ① the probe `features` word `egress-allowlist` (and `surfaces` optional)   ② the reserved settings row `egressAllowlist`
//   ③ kernel.json `layout.archiveFormat: 'tar.gz'`
// On a VibeSpace that predates them the verdicts below refuse ① and ③ BY NAME — the legs assert that the refusal is
// exactly that one rule (the same document with that one field changed passes), so a base without the SPI is a named
// RED and a base with it is GREEN, never a silent pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { vibespaceDir } from './harness.mjs';
const require = createRequire(import.meta.url);
const manifest = require('../vibespace-plugin.json');
const kernel = require('../kernel.json');
const E = require('../lib/engine.js');
const VS = vibespaceDir();
const vs = (rel) => require(path.join(VS, rel));
const needVS = VS ? {} : { skip: 'VIBESPACE_DIR is not set to a VibeSpace checkout' };

test('kernel.json, self-contained: one linux-x64 artifact on https, the vendor\'s measured archive, tar.gz at the archive\'s root', () => {
  assert.equal(kernel.schemaVersion, 1);
  assert.deepEqual(Object.keys(kernel.platforms), ['linux-x64']);
  const p = kernel.platforms['linux-x64'];
  assert.match(p.url, /^https:\/\/cloakbrowser\.dev\/chromium-v146\.0\.7680\.177\.5\/cloakbrowser-linux-x64\.tar\.gz$/);
  assert.equal(p.sha256, '4a12bcde95fa1bb1beef2b41ab5e5c27c36be78e3be3d0dac8c64d705216670e');
  assert.equal(p.bytes, 216890134);
  assert.equal(p.version, '146.0.7680.177.5');
  assert.deepEqual({ ...kernel.layout, requiredFiles: undefined }, { archiveFormat: 'tar.gz', stripComponents: 0, binaryRelPath: 'chrome', requiredFiles: undefined });
  assert.ok(kernel.layout.requiredFiles.every((f) => /^[A-Za-z0-9._+@-]+(\/[A-Za-z0-9._+@-]+)*$/.test(f)));
});

test('egress-proof.json describes the archive kernel.json pins, and its measured browser reached nothing but loopback', () => {
  const proof = require('../egress-proof.json');
  const p = kernel.platforms['linux-x64'];
  assert.equal(proof.plugin, E.ID);
  for (const d of [proof.road.download, proof.record.download]) assert.deepEqual([d.url, d.sha256, d.bytes], [p.url, p.sha256, p.bytes]);
  assert.equal(proof.record.chromium, p.version);
  assert.ok(proof.road.download.hops.every((h) => /^[a-z0-9.-]+$/.test(h.host)));
  assert.equal(proof.remeasured.binary.sha256, proof.record.binary.sha256, 'the re-measured binary is the recorded one');
  const browserHosts = [...proof.record.runs, ...proof.remeasured.runs].flatMap((r) => r.targets).filter((t) => t.by === 'chrome' || (t.phase === 'launch' && t.host !== 'loopback'));
  assert.deepEqual(browserHosts, [], 'no run of the browser reached a host');
  assert.equal(proof.remeasured.verdict.onlyLoopback, true);
});

test('the manifest, self-contained: the engine id, server + routes + browserEngine, ONE string setting egressAllowlist, no capability', () => {
  assert.equal(manifest.id, E.ID);
  assert.equal(manifest.label, 'CloakBrowser');
  assert.equal(manifest.server, true);
  assert.deepEqual({ ...manifest.contributes, settings: undefined }, { routes: true, browserEngine: true, settings: undefined });
  assert.equal(manifest.contributes.settings.length, 1);
  const s = manifest.contributes.settings[0];
  assert.deepEqual([s.key, s.type, s.default], ['egressAllowlist', 'string', '']);
  assert.deepEqual(manifest.capabilities, { server: {} });
});

test('VibeSpace validateManifest: valid, no warning, nothing clipped; the consent names a server process + the browser engine and nothing more', needVS, (t) => {
  const PM = vs('src/plugin-manifest.js');
  const v = PM.validateManifest(manifest, { folderName: manifest.id, hostVersion: manifest.engines.vibespace });
  assert.ok(v.ok, v.errors.join('; '));
  assert.deepEqual(v.warnings, []);
  const row = v.manifest.contributes.settings[0];
  const s = manifest.contributes.settings[0];
  assert.deepEqual(row, { key: s.key, type: 'string', label: s.label, description: s.description, default: '' }, 'the label and description arrive whole (≤ 80 / ≤ 300 characters)');
  assert.equal(v.manifest.description, manifest.description, 'the description arrives whole (≤ 500)');
  assert.equal(v.manifest.contributes.browserEngine, true);
  assert.ok(PM.needsConsent(v.manifest));
  assert.deepEqual(PM.capabilitySummary(v.manifest).map((i) => i.id), ['server-process', 'browser-engine']);
  assert.ok(PM.ID_RE.test(manifest.id) && vs('src/browser-engines.js').ID_RE.test(manifest.id));
});

test('VibeSpace kernelManifestVerdict: kernel.json is ONE artifact for linux-x64 (tar.gz needs the SPI\'s third field)', needVS, (t) => {
  const EK = vs('src/engine-kernel.js');
  const v = EK.kernelManifestVerdict(kernel, { tag: 'linux-x64', id: manifest.id, label: manifest.label });
  const same = { url: kernel.platforms['linux-x64'].url, sha256: kernel.platforms['linux-x64'].sha256, bytes: 216890134, version: '146.0.7680.177.5', source: 'package' };
  if (EK.ARCHIVE_FORMATS.includes('tar.gz')) {
    assert.ok(v.ok, v.error);
    assert.deepEqual({ url: v.url, sha256: v.sha256, bytes: v.bytes, version: v.version, source: v.source }, same);
    assert.deepEqual(v.layout, { archiveFormat: 'tar.gz', stripComponents: 0, binaryRelPath: 'chrome', requiredFiles: ['chrome', ...kernel.layout.requiredFiles] });
    assert.equal(v.host, 'cloakbrowser.dev');
  } else {
    // a VibeSpace before the SPI: refused by name for the archive format — and for nothing else
    assert.ok(!v.ok && v.code === 'browser_engine_protocol' && /archive format tar\.gz/.test(v.error), JSON.stringify(v));
    const z = EK.kernelManifestVerdict({ ...kernel, layout: { ...kernel.layout, archiveFormat: EK.ARCHIVE_FORMATS[0] } }, { tag: 'linux-x64' });
    assert.ok(z.ok, z.error);
    assert.deepEqual({ url: z.url, sha256: z.sha256, bytes: z.bytes, version: z.version, source: z.source }, same);
    t.diagnostic(`this VibeSpace unpacks ${EK.ARCHIVE_FORMATS.join(', ')} — kernel.json needs the tar.gz field (engine SPI ③)`);
  }
  const arm = EK.kernelManifestVerdict(kernel, { tag: 'linux-arm64' });
  assert.equal(arm.code, 'build_platform_unsupported', 'another machine: refused by name, nothing downloaded');
});

test('VibeSpace engineAnswerVerdict: the probe answer (no surfaces needs the SPI\'s first field) and the launch answer', needVS, (t) => {
  const BE = vs('src/browser-engines.js');
  const kp = '/data/plugins-state/vibespace.cloak-browser/kernel/linux-x64/chrome';
  const probe = E.probeAnswer({ binaryPath: kp, installed: true, executable: true, size: 465371408, receipt: { sha256: E.pinOf(kernel), bytes: 465371408, verifiedAt: 1, version: '146.0.7680.177' }, kernel });
  const v = BE.engineAnswerVerdict('probe', { status: 200, body: probe }, { id: manifest.id, label: manifest.label });
  const surfacesOptional = !!(BE.ENGINE_FEATURES && BE.ENGINE_FEATURES.includes('egress-allowlist'));
  if (v.ok) {
    assert.deepEqual(v.fact.features, ['egress-allowlist']);
    assert.equal(v.fact.binaryPath, kp);
    assert.equal(v.fact.declaredVersion, '146.0.7680.177.5');
    assert.deepEqual(v.fact.integrity, { verified: true, sha256: E.pinOf(kernel), verifiedAt: 1 });
  } else {
    // a VibeSpace before the SPI: the ONE refusal is the surfaces rule (the same answer + 'surfaces' passes)
    assert.ok(!surfacesOptional, 'a VibeSpace that knows egress-allowlist must accept this probe: ' + v.error);
    assert.ok(v.code === 'browser_engine_protocol' && /surfaces/.test(v.error), JSON.stringify(v));
    assert.ok(BE.engineAnswerVerdict('probe', { status: 200, body: { ...probe, features: ['surfaces', ...probe.features] } }, { id: manifest.id }).ok);
    t.diagnostic('this VibeSpace requires the surfaces feature — the probe needs engine SPI ①');
  }
  const launch = BE.engineAnswerVerdict('launchOptions', { status: 200, body: E.launchAnswer({ binaryPath: kp, seed: 1234567 }) }, { id: manifest.id });
  assert.ok(launch.ok, launch.error);
  assert.deepEqual(launch.launch, { executablePath: kp, args: ['--no-sandbox', '--fingerprint=1234567'], env: {} });
  assert.ok(!launch.launch.args.some((a) => BE.OWN_ARG_RE.test(a)));
  const missing = BE.engineAnswerVerdict('launchOptions', { status: 409, body: { error: 'x', code: 'no_binary' } }, { id: manifest.id });
  assert.equal(missing.code, 'browser_engine_kernel_missing', 'the plugin\'s 409 no_binary is VibeSpace\'s kernel_missing');
  if (BE.OWN_ARG_RE.test('--proxy-server=http://127.0.0.1:1')) t.diagnostic('this VibeSpace refuses a plugin-named proxy (engine SPI rule) — this plugin never names one');
});
